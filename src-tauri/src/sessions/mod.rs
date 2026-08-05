//! Session tracking: the append-only event log that records everything a
//! practice session does (reps, block open/close, metronome actions, intake
//! edits) and, at the end, exports a human-readable summary into the vault.
//!
//! A *session* is opened lazily on the first logged event and reused across an
//! app restart (via [`Store::latest_open_session`]) so a crash mid-session does
//! not fork the log. Every log both persists to SQLite and emits a
//! `session://event` so the frontend session panel updates live.

pub mod export;

use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::store::model::{sqlite_ts_to_rfc3339, ExportResult, SessionView};
use crate::store::{EventKind, Store};

/// Sink for app-facing events (`rep://state`, `session://event`). Mirrors the
/// `VoiceEmitter` seam pattern: the production impl wraps a Tauri `AppHandle`;
/// tests record calls. Set after construction because the `AppHandle` only
/// exists once the app is built. Shared by [`SessionService`] and the rep engine.
pub trait StateEmitter: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
}

/// Test seam for "now", mirroring `crate::rep::PracticeClock`: production wraps
/// [`Store::now_rfc3339`]; tests inject a fixed/movable value so the
/// same-local-calendar-day session adoption boundary (task A5) never depends on
/// wall-clock time or a sleep.
pub(crate) trait SessionClock: Send + Sync {
    fn now(&self, store: &Store) -> Result<String, String>;
}

struct StoreSessionClock;

impl SessionClock for StoreSessionClock {
    fn now(&self, store: &Store) -> Result<String, String> {
        store.now_rfc3339().map_err(|error| error.to_string())
    }
}

/// Pauses whatever practice set is currently active, through the *same*
/// internal store path the `rep_pause` command uses (never a raw `UPDATE`, never
/// a new write path) — at an explicit already-committed timestamp rather than
/// "now". Wired to the rep engine after construction (the `AppHandle`-style seam
/// again) so the rep engine's own in-memory active-block cache never diverges
/// from a pause `resolve_session()` performs on its behalf at a day-rollover
/// boundary. A no-op (`Ok`) when nothing is currently active.
pub trait RolloverPauseHook: Send + Sync {
    fn pause_active_at_rollover(&self, session_id: i64, at: &str) -> Result<(), String>;
}

/// The session log service. Managed by Tauri behind an `Arc`; the rep engine,
/// the voice loop, and the command layer all log through the one instance.
pub struct SessionService {
    store: Arc<Store>,
    /// Serializes event insertion with export/end. Without this boundary a
    /// metronome event could resolve the old session, then land after its export
    /// snapshot and durable close, disappearing from the written summary.
    lifecycle: Mutex<()>,
    /// The open session id, or `None` before the first event of the process's
    /// lifetime. Resolved lazily (reusing a store-side open session on restart).
    current: Mutex<Option<i64>>,
    emitter: Mutex<Option<Arc<dyn StateEmitter>>>,
    clock: Arc<dyn SessionClock>,
    /// The rep engine's rollover-pause seam (task A5). `None` until the app
    /// wires it post-construction; a rollover with no hook installed simply
    /// closes/opens sessions without pausing anything.
    pause_hook: Mutex<Option<Arc<dyn RolloverPauseHook>>>,
}

impl SessionService {
    pub fn new(store: Arc<Store>) -> Self {
        Self::new_with_clock(store, Arc::new(StoreSessionClock))
    }

    pub(crate) fn new_with_clock(store: Arc<Store>, clock: Arc<dyn SessionClock>) -> Self {
        SessionService {
            store,
            lifecycle: Mutex::new(()),
            current: Mutex::new(None),
            emitter: Mutex::new(None),
            clock,
            pause_hook: Mutex::new(None),
        }
    }

    /// Install the event emitter (once the Tauri `AppHandle` is available).
    pub fn set_emitter(&self, emitter: Arc<dyn StateEmitter>) {
        if let Ok(mut g) = self.emitter.lock() {
            *g = Some(emitter);
        }
    }

    /// Install the rollover-pause hook (once the rep engine exists — it is
    /// constructed with an `Arc` to this service, so wiring happens after).
    pub fn set_rollover_pause_hook(&self, hook: Arc<dyn RolloverPauseHook>) {
        if let Ok(mut g) = self.pause_hook.lock() {
            *g = Some(hook);
        }
    }

    fn emit(&self, event: &str, payload: Value) {
        let e = self.emitter.lock().ok().and_then(|g| g.as_ref().cloned());
        if let Some(e) = e {
            e.emit(event, payload);
        }
    }

    /// Resolve the current session id, opening (or adopting a store-side open)
    /// session on demand. Best-effort: returns `None` only if the store errors.
    ///
    /// Task A5 (day-scoped sessions): the process-cached session and a
    /// store-side still-open session (restart-adoption) are both subject to
    /// the same rule — adopted ONLY if their last event (falling back to
    /// `started_at`) is on the same LOCAL calendar day as now. Otherwise the
    /// old session is closed retroactively at that last-event timestamp (never
    /// "now" — no phantom overnight focused time), any still-active practice
    /// set is paused through the standard pause path first, and a fresh
    /// session opens. Checked lazily on every call (no timer, no sleep) so a
    /// session left open for several days closes the same way on the next
    /// event, and exactly one new session opens — never one per skipped day.
    fn resolve_session(&self) -> Option<i64> {
        let mut cur = self.current.lock().unwrap_or_else(|p| p.into_inner());

        let now = match self.clock.now(&self.store) {
            Ok(now) => now,
            Err(e) => {
                eprintln!("session: failed to read clock: {e}");
                // Fail open: adopt whatever is cached/open rather than block
                // practice on a clock read error.
                if let Some(sid) = *cur {
                    return Some(sid);
                }
                match self.store.latest_open_session() {
                    Ok(Some(sid)) => {
                        *cur = Some(sid);
                        return Some(sid);
                    }
                    Ok(None) => return self.open_fresh_session(&mut cur),
                    Err(e) => {
                        eprintln!("session: failed to query open session: {e}");
                        return None;
                    }
                }
            }
        };

        let candidate = match *cur {
            Some(sid) => Some(sid),
            None => match self.store.latest_open_session() {
                Ok(open) => open,
                Err(e) => {
                    eprintln!("session: failed to query open session: {e}");
                    None
                }
            },
        };

        if let Some(sid) = candidate {
            match self.store.session_last_event_and_same_local_day(sid, &now) {
                Ok(Some((_, true))) => {
                    *cur = Some(sid);
                    return Some(sid);
                }
                Ok(Some((last_ts, false))) => {
                    self.rollover_close(sid, &last_ts);
                    *cur = None;
                    // Falls through to open a fresh session below.
                }
                Ok(None) => {
                    // The session row is gone; nothing to adopt or close.
                    *cur = None;
                }
                Err(e) => {
                    eprintln!("session: failed to check session day boundary for {sid}: {e}");
                    // Fail open rather than fork a duplicate session.
                    *cur = Some(sid);
                    return Some(sid);
                }
            }
        }

        self.open_fresh_session(&mut cur)
    }

    /// Open a genuinely new session (not restart-adoption of an already-open
    /// one), append its canonical `SESSION_START` evidence, and cache it.
    fn open_fresh_session(&self, cur: &mut std::sync::MutexGuard<'_, Option<i64>>) -> Option<i64> {
        // Stamped through the same clock the day-rollover boundary reads (see
        // `log()`); a clock-read error falls back to SQLite's own `now()`.
        let opened = match self.clock.now(&self.store) {
            Ok(now) => self.store.open_session_at(&now),
            Err(_) => self.store.open_session(),
        };
        let sid = match opened {
            Ok(sid) => {
                if let Err(e) = self.store.append_event(
                    EventKind::SESSION_START,
                    Some(sid),
                    None,
                    &Value::Object(Default::default()),
                ) {
                    eprintln!("session: failed to append SESSION_START event: {e}");
                }
                sid
            }
            Err(e) => {
                eprintln!("session: failed to open session: {e}");
                return None;
            }
        };
        **cur = Some(sid);
        Some(sid)
    }

    /// Retroactively close `sid` at `last_ts` (its own last event, verbatim —
    /// never "now"), pausing any still-active practice set through the
    /// standard pause path first so the pause event lands inside the closing
    /// session's own log, at the same boundary timestamp.
    fn rollover_close(&self, sid: i64, last_ts: &str) {
        if let Some(hook) = self.pause_hook.lock().ok().and_then(|g| g.clone()) {
            if let Err(e) = hook.pause_active_at_rollover(sid, last_ts) {
                eprintln!("session: rollover auto-pause failed for session {sid}: {e}");
            }
        }
        if let Err(e) = self.store.end_session_at(sid, last_ts, "") {
            eprintln!("session: failed to retroactively close session {sid}: {e}");
        }
        if let Err(e) = self.store.append_event(
            EventKind::SESSION_END,
            Some(sid),
            None,
            &Value::Object(Default::default()),
        ) {
            eprintln!("session: failed to append SESSION_END event: {e}");
        }
    }

    /// Append an event to the current session and emit it. Auto-opens a session
    /// on the first call. Best-effort — a store error is logged, never fatal.
    pub fn log(&self, kind: &str, payload: Value) {
        let _lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let Some(sid) = self.resolve_session() else {
            return;
        };
        // Stamped through the same clock the day-rollover boundary reads (in
        // production this is still real time; a clock-read error falls back to
        // SQLite's own `datetime('now')` rather than dropping the event).
        let event_id = match self.clock.now(&self.store) {
            Ok(now) => self
                .store
                .insert_session_event_at(sid, kind, &payload, &now),
            Err(_) => self.store.insert_session_event(sid, kind, &payload),
        };
        let event_id = match event_id {
            Ok(id) => id,
            Err(e) => {
                eprintln!("session: failed to log {kind} event: {e}");
                return;
            }
        };
        self.emit_logged_event(event_id, kind);
    }

    /// Resolve or open the session required by a rep transaction. Unlike the
    /// generic best-effort logger, practice mutations propagate failure.
    pub(crate) fn ensure_session(&self) -> Result<i64, String> {
        let _lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        self.resolve_session()
            .ok_or_else(|| "Could not open a practice session.".to_string())
    }

    /// Return only the in-process cache as a transaction hint. Practice writes
    /// resolve/adopt/create the authoritative open session inside their own
    /// SQLite transaction, after durable-command replay preflight.
    pub(crate) fn cached_practice_session(&self) -> Option<i64> {
        *self.current.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Update the process cache only after the practice transaction that
    /// adopted or created this session has committed successfully.
    pub(crate) fn adopt_committed_practice_session(&self, session_id: i64) {
        *self.current.lock().unwrap_or_else(|p| p.into_inner()) = Some(session_id);
    }

    /// Emit a practice-feed row only after its source/history transaction has
    /// committed successfully.
    pub(crate) fn emit_persisted_practice(&self, event_id: i64, kind: &str) {
        self.emit_logged_event(event_id, kind);
    }

    /// Emit one just-logged feed event with the exact timestamp SQLite stored.
    fn emit_logged_event(&self, event_id: i64, kind: &str) {
        match self.store.session_event(event_id) {
            Ok(mut view) => {
                view.ts = sqlite_ts_to_rfc3339(&view.ts);
                if let Ok(v) = serde_json::to_value(&view) {
                    self.emit("session://event", v);
                }
            }
            Err(e) => eprintln!("session: failed to read back {kind} event: {e}"),
        }
    }

    /// The current session and its event log (newest-first, capped at 200), or
    /// `None` when no session has been started. Timestamps are RFC3339 UTC.
    pub fn current(&self) -> Option<SessionView> {
        // Reflect an already-open session even before this process logged
        // anything (e.g. right after a restart), without opening a new one.
        let sid = {
            let cur = self.current.lock().unwrap_or_else(|p| p.into_inner());
            match *cur {
                Some(sid) => Some(sid),
                None => self.store.latest_open_session().ok().flatten(),
            }
        }?;

        let started_at = self
            .store
            .session_started_at(sid)
            .ok()
            .flatten()
            .map(|ts| sqlite_ts_to_rfc3339(&ts))?;

        let mut events = self.store.session_events(sid).unwrap_or_default();
        events.reverse(); // store is chronological; the view is newest-first
        events.truncate(200);
        for ev in &mut events {
            ev.ts = sqlite_ts_to_rfc3339(&ev.ts);
        }

        Some(SessionView {
            id: sid,
            started_at,
            events,
        })
    }

    /// The current session id, if one is open (without opening one).
    pub fn current_id(&self) -> Option<i64> {
        let cur = self.current.lock().unwrap_or_else(|p| p.into_inner());
        match *cur {
            Some(sid) => Some(sid),
            None => self.store.latest_open_session().ok().flatten(),
        }
    }

    /// Mark the current session ended (empty summary — the vault export in
    /// [`Self::end_and_export`] writes the real markdown) and clear it. Returns
    /// the ended session id, or `None` if none was open. Used by
    /// [`Self::end_and_export`] after the vault summary is written.
    #[cfg(test)]
    pub fn end_raw(&self) -> Option<i64> {
        let _lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        self.end_raw_locked()
    }

    fn end_raw_locked(&self) -> Option<i64> {
        let mut cur = self.current.lock().unwrap_or_else(|p| p.into_inner());
        let sid = match *cur {
            Some(sid) => sid,
            None => self.store.latest_open_session().ok().flatten()?,
        };
        if let Err(e) = self.store.end_session(sid, "") {
            eprintln!("session: failed to end session {sid}: {e}");
            return None;
        }
        // Durable canonical log: mark the session closed.
        if let Err(e) = self.store.append_event(
            EventKind::SESSION_END,
            Some(sid),
            None,
            &Value::Object(Default::default()),
        ) {
            eprintln!("session: failed to append SESSION_END event: {e}");
        }
        *cur = None;
        Some(sid)
    }

    /// End the session AND write its vault summary. Reconstructs the session from
    /// its event log, appends a section to each practiced piece's
    /// `(C) codakiller-sessions.md` under `pieces_dir`, then marks the session
    /// ended. Returns the export result, or `None` when no session was open
    /// (nothing to save). A session with no rep activity still ends but writes no
    /// vault files. Best-effort and quick — safe to call from the app-exit hook.
    pub fn end_and_export(&self, store: &Store, pieces_dir: &Path) -> Option<ExportResult> {
        let _lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let sid = self.current_id()?;
        // Export BEFORE ending: reads the event log (ending does not touch it).
        let result = export::write_session_md(store, sid, pieces_dir);
        self.end_raw_locked();
        Some(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Default)]
    pub(crate) struct RecEmitter {
        pub events: Mutex<Vec<(String, Value)>>,
    }
    impl StateEmitter for RecEmitter {
        fn emit(&self, event: &str, payload: Value) {
            self.events
                .lock()
                .unwrap()
                .push((event.to_string(), payload));
        }
    }

    fn service() -> (SessionService, Arc<RecEmitter>) {
        let store = Arc::new(Store::open(":memory:").expect("memory store"));
        let svc = SessionService::new(store);
        let rec = Arc::new(RecEmitter::default());
        svc.set_emitter(rec.clone());
        (svc, rec)
    }

    #[test]
    fn first_log_auto_opens_a_session_and_emits() {
        let (svc, rec) = service();
        assert!(svc.current().is_none(), "no session before the first log");

        svc.log("rep", json!({ "verdict": "clean", "bpm": 80 }));

        let view = svc.current().expect("a session now exists");
        assert_eq!(view.events.len(), 1);
        assert_eq!(view.events[0].kind, "rep");
        // Timestamps are RFC3339 (T + Z), not sqlite-native.
        assert!(view.started_at.contains('T') && view.started_at.ends_with('Z'));
        assert!(view.events[0].ts.ends_with('Z'));

        let emitted = rec.events.lock().unwrap();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].0, "session://event");
    }

    #[test]
    fn events_are_newest_first_in_the_view() {
        let (svc, _rec) = service();
        svc.log("a", json!({}));
        svc.log("b", json!({}));
        svc.log("c", json!({}));
        let view = svc.current().unwrap();
        let kinds: Vec<&str> = view.events.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, vec!["c", "b", "a"], "newest first");
    }

    #[test]
    fn end_raw_closes_the_session() {
        let (svc, _rec) = service();
        svc.log("rep", json!({}));
        let sid = svc.current_id().expect("open session");
        assert_eq!(svc.end_raw(), Some(sid));
        assert!(
            svc.current().is_none(),
            "ended session is no longer current"
        );
        assert_eq!(svc.end_raw(), None, "nothing left to end");
    }

    #[test]
    fn restart_reuses_the_open_session() {
        // A fresh service over the SAME store (as if the app restarted) must
        // adopt the still-open session rather than forking a new one.
        let store = Arc::new(Store::open(":memory:").unwrap());
        let a = SessionService::new(store.clone());
        a.log("rep", json!({ "n": 1 }));
        let sid = a.current_id().unwrap();

        let b = SessionService::new(store);
        b.log("rep", json!({ "n": 2 }));
        assert_eq!(b.current_id(), Some(sid), "same session adopted on restart");
        assert_eq!(
            b.current().unwrap().events.len(),
            2,
            "both events in one session"
        );
    }

    // ── Task A5: day-scoped sessions ────────────────────────────────────────

    /// A movable clock implementing both this module's [`SessionClock`] and
    /// `crate::rep::PracticeClock`, so one instance can drive a `SessionService`
    /// and a `RepEngine` in lockstep across a simulated midnight — never a real
    /// sleep or wall-clock dependency.
    struct FixedClock(Mutex<String>);

    impl FixedClock {
        fn new(value: &str) -> Arc<Self> {
            Arc::new(FixedClock(Mutex::new(value.to_string())))
        }
        fn set(&self, value: &str) {
            *self.0.lock().unwrap() = value.to_string();
        }
    }

    impl SessionClock for FixedClock {
        fn now(&self, _store: &Store) -> Result<String, String> {
            Ok(self.0.lock().unwrap().clone())
        }
    }

    impl crate::rep::PracticeClock for FixedClock {
        fn now(&self, _store: &Store) -> Result<String, String> {
            Ok(self.0.lock().unwrap().clone())
        }
    }

    #[test]
    fn same_calendar_day_restart_adopts_the_open_session() {
        let store = Arc::new(Store::open(":memory:").unwrap());
        let clock = FixedClock::new("2026-08-05T09:00:00Z");
        let a = SessionService::new_with_clock(store.clone(), clock.clone());
        a.log("rep", json!({ "n": 1 }));
        let sid = a.current_id().unwrap();

        // Later the SAME local day (still before midnight): a fresh service
        // instance (as if the app restarted) adopts the still-open session.
        clock.set("2026-08-05T22:30:00Z");
        let b = SessionService::new_with_clock(store, clock);
        b.log("rep", json!({ "n": 2 }));
        assert_eq!(b.current_id(), Some(sid), "same-day session is adopted");
        assert_eq!(b.current().unwrap().events.len(), 2);
    }

    #[test]
    fn first_event_after_midnight_closes_the_old_session_at_its_last_event() {
        let store = Arc::new(Store::open(":memory:").unwrap());
        let clock = FixedClock::new("2026-08-05T09:00:00Z");
        let svc = SessionService::new_with_clock(store.clone(), clock.clone());

        svc.log("rep", json!({ "n": 1 }));
        clock.set("2026-08-05T23:10:00Z");
        svc.log("rep", json!({ "n": 2 })); // last event of the old day
        let old_sid = svc.current_id().unwrap();

        // First event past local midnight rolls the day over.
        clock.set("2026-08-08T00:05:00Z");
        svc.log("rep", json!({ "n": 3 }));
        let new_sid = svc.current_id().unwrap();

        assert_ne!(old_sid, new_sid, "a fresh session opens after the boundary");
        let ended_at = store
            .test_scalar_string(&format!("SELECT ended_at FROM session WHERE id={old_sid}"))
            .unwrap();
        assert_eq!(
            ended_at, "2026-08-05T23:10:00Z",
            "closed at its own last event, never at rollover-detection time"
        );

        // The new session's only event is the post-midnight one; the old
        // session's events never gained a phantom overnight entry.
        let old_view_events = store.session_events(old_sid).unwrap();
        assert_eq!(old_view_events.len(), 2);
        let new_view_events = store.session_events(new_sid).unwrap();
        assert_eq!(new_view_events.len(), 1);
    }

    #[test]
    fn multi_day_gap_closes_once_and_opens_exactly_one_new_session() {
        // A session left open from three days ago closes the same way — no
        // synthetic sessions are created for the empty days in between.
        let store = Arc::new(Store::open(":memory:").unwrap());
        let clock = FixedClock::new("2026-08-02T10:00:00Z");
        let svc = SessionService::new_with_clock(store.clone(), clock.clone());
        svc.log("rep", json!({}));
        let old_sid = svc.current_id().unwrap();

        clock.set("2026-08-05T08:00:00Z");
        svc.log("rep", json!({}));
        let new_sid = svc.current_id().unwrap();

        assert_ne!(old_sid, new_sid);
        let ended_at = store
            .test_scalar_string(&format!("SELECT ended_at FROM session WHERE id={old_sid}"))
            .unwrap();
        assert_eq!(ended_at, "2026-08-02T10:00:00Z");
        let session_count: i64 = store
            .test_scalar_i64("SELECT COUNT(*) FROM session")
            .unwrap();
        assert_eq!(
            session_count, 2,
            "no synthetic sessions for the skipped days"
        );
    }

    #[test]
    fn day_rollover_pauses_a_still_active_set_through_the_standard_pause_path() {
        use crate::rep::RepEngine;
        use crate::store::model::{RepOpenArgs, ScanPiece};

        let store = Arc::new(Store::open(":memory:").unwrap());
        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/A5 rollover".into(),
                title: "A5 rollover".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();

        let clock = FixedClock::new("2026-08-05T20:00:00Z");
        let sessions = Arc::new(SessionService::new_with_clock(store.clone(), clock.clone()));
        let rep = Arc::new(RepEngine::new_with_clock(
            store.clone(),
            sessions.clone(),
            clock.clone(),
        ));
        sessions.set_rollover_pause_hook(rep.clone());

        let snapshot = rep
            .open(RepOpenArgs {
                piece_id,
                region_id: None,
                m_start: 1,
                m_end: 8,
                label: None,
                start_bpm: 80.0,
                target_bpm: Some(120.0),
                planned_reps: Some(10),
                required_clean_streak: None,
                increment: None,
                variants: vec![],
                focus: "tempo".into(),
                use_metronome: false,
            })
            .unwrap();
        let block_id = snapshot.block_id;
        let old_sid = sessions.current_id().unwrap();

        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={block_id}"
                ))
                .unwrap(),
            "active"
        );

        // First event past local midnight: rolls the day over, which must pause
        // the still-active set through the SAME store path `rep_pause` uses.
        clock.set("2026-08-08T00:05:00Z");
        sessions.log("misc", json!({}));
        let new_sid = sessions.current_id().unwrap();
        assert_ne!(old_sid, new_sid);

        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={block_id}"
                ))
                .unwrap(),
            "paused",
            "the active set is auto-paused at day rollover"
        );

        let pause_events: i64 = store
            .test_scalar_i64(&format!(
                "SELECT COUNT(*) FROM session_event
                 WHERE session_id={old_sid} AND kind='rep_pause'"
            ))
            .unwrap();
        assert_eq!(
            pause_events, 1,
            "the pause event lands in the closing (old) session, not the new one"
        );

        let ended_at = store
            .test_scalar_string(&format!("SELECT ended_at FROM session WHERE id={old_sid}"))
            .unwrap();
        assert_eq!(
            ended_at, "2026-08-05T20:00:00Z",
            "closed at its last event, unmoved by the pause landing at the same instant"
        );
    }

    #[test]
    fn focused_seconds_of_a_retro_closed_session_excludes_the_overnight_gap() {
        let store = Arc::new(Store::open(":memory:").unwrap());
        let clock = FixedClock::new("2026-08-05T21:00:00Z");
        let svc = SessionService::new_with_clock(store.clone(), clock.clone());

        // A session with an initial event, then a *canonical* practice-shaped
        // pair of events 30s apart (the shape `metrics::focused_seconds` reads
        // — `svc.log()` only writes the live session-panel feed, not the
        // durable `event` log, so these are inserted directly).
        svc.log("misc", json!({}));
        let old_sid = svc.current_id().unwrap();
        store
            .test_execute_batch(&format!(
                "INSERT INTO event (ts,session_id,kind,payload)
                 VALUES ('2026-08-05T21:00:00Z',{old_sid},'rep_open','{{}}'),
                        ('2026-08-05T21:00:30Z',{old_sid},'rep','{{}}');"
            ))
            .unwrap();

        // Next event is the next local day: rolls the old session closed at
        // its last SESSION_EVENT ("misc", at 21:00:00 — same instant as the
        // canonical rep_open above, so the boundary is unaffected).
        clock.set("2026-08-08T09:00:00Z");
        svc.log("rep_open", json!({}));

        let old_events = store.events_for_session(old_sid).unwrap();
        let seconds = crate::metrics::focused_seconds(&old_events);
        assert_eq!(
            seconds, 30,
            "only the intra-day 30s gap counts; the ~12h overnight gap is excluded"
        );
    }
}
