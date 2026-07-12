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

/// The session log service. Managed by Tauri behind an `Arc`; the rep engine,
/// the voice loop, and the command layer all log through the one instance.
pub struct SessionService {
    store: Arc<Store>,
    /// The open session id, or `None` before the first event of the process's
    /// lifetime. Resolved lazily (reusing a store-side open session on restart).
    current: Mutex<Option<i64>>,
    emitter: Mutex<Option<Arc<dyn StateEmitter>>>,
}

impl SessionService {
    pub fn new(store: Arc<Store>) -> Self {
        SessionService {
            store,
            current: Mutex::new(None),
            emitter: Mutex::new(None),
        }
    }

    /// Install the event emitter (once the Tauri `AppHandle` is available).
    pub fn set_emitter(&self, emitter: Arc<dyn StateEmitter>) {
        if let Ok(mut g) = self.emitter.lock() {
            *g = Some(emitter);
        }
    }

    fn emit(&self, event: &str, payload: Value) {
        let e = self
            .emitter
            .lock()
            .ok()
            .and_then(|g| g.as_ref().cloned());
        if let Some(e) = e {
            e.emit(event, payload);
        }
    }

    /// Resolve the current session id, opening (or adopting a store-side open)
    /// session on demand. Best-effort: returns `None` only if the store errors.
    fn resolve_session(&self) -> Option<i64> {
        let mut cur = self.current.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(sid) = *cur {
            return Some(sid);
        }
        let sid = match self.store.latest_open_session() {
            Ok(Some(sid)) => sid,
            Ok(None) => match self.store.open_session() {
                Ok(sid) => {
                    // Durable canonical log: a genuinely new session begins (not on
                    // restart-adoption of an already-open session above).
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
            },
            Err(e) => {
                eprintln!("session: failed to query open session: {e}");
                return None;
            }
        };
        *cur = Some(sid);
        Some(sid)
    }

    /// Append an event to the current session and emit it. Auto-opens a session
    /// on the first call. Best-effort — a store error is logged, never fatal.
    pub fn log(&self, kind: &str, payload: Value) {
        let Some(sid) = self.resolve_session() else {
            return;
        };
        let event_id = match self.store.insert_session_event(sid, kind, &payload) {
            Ok(id) => id,
            Err(e) => {
                eprintln!("session: failed to log {kind} event: {e}");
                return;
            }
        };
        // Emit the just-logged event with its stored (converted) timestamp so the
        // frontend panel shows the same ts SQLite recorded.
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
    pub fn end_raw(&self) -> Option<i64> {
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
        let sid = self.current_id()?;
        // Export BEFORE ending: reads the event log (ending does not touch it).
        let result = export::write_session_md(store, sid, pieces_dir);
        self.end_raw();
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
        assert!(svc.current().is_none(), "ended session is no longer current");
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
        assert_eq!(b.current().unwrap().events.len(), 2, "both events in one session");
    }
}
