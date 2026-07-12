//! The rep engine: the stateful service that owns the one active rep block,
//! records each rep, climbs the tempo ladder, and narrates the outcome.
//!
//! At most one block is open at a time (opening while one is active is rejected
//! for voice safety — see [`RepEngine::open`]). Every mutation persists to the
//! store, logs a session event, and emits `rep://state` so the UI and the voice
//! layer see the same truth. The spoken/UI line for each rep is composed *here*
//! ([`compose_say`]) so voice and the frontend never diverge.
//!
//! The pure ladder arithmetic lives in [`ladder`]; this module is the I/O + state
//! shell around it.

pub mod ladder;

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use crate::sessions::{SessionService, StateEmitter};
use crate::store::model::{
    CheckOutcome, LastRep, RepOpenArgs, RepSnapshot, VerdictCounts,
};
use crate::store::{EventKind, Store};

/// A rep verdict. The wire/store form is the lowercase string ("clean" /
/// "flawed" / "failed"); the voice layer maps its three-way [`crate::intent::Verdict`]
/// onto this.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepVerdict {
    Clean,
    Flawed,
    Failed,
}

impl RepVerdict {
    /// The store/IPC string form.
    pub fn as_str(self) -> &'static str {
        match self {
            RepVerdict::Clean => "clean",
            RepVerdict::Flawed => "flawed",
            RepVerdict::Failed => "failed",
        }
    }

    /// Parse the store/IPC string form (used by the `rep_check` command).
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "clean" => Some(RepVerdict::Clean),
            "flawed" => Some(RepVerdict::Flawed),
            "failed" => Some(RepVerdict::Failed),
            _ => None,
        }
    }
}

/// The rep engine. Managed by Tauri behind an `Arc`; the command layer and the
/// voice loop drive the same instance so a block opened by voice is the same
/// block the UI sees.
pub struct RepEngine {
    store: Arc<Store>,
    sessions: Arc<SessionService>,
    /// The one open block, or `None`. `Some` ⇒ [`Self::active`] is true.
    active: Mutex<Option<RepSnapshot>>,
    emitter: Mutex<Option<Arc<dyn StateEmitter>>>,
}

impl RepEngine {
    pub fn new(store: Arc<Store>, sessions: Arc<SessionService>) -> Self {
        RepEngine {
            store,
            sessions,
            active: Mutex::new(None),
            emitter: Mutex::new(None),
        }
    }

    /// Install the `rep://state` emitter (once the Tauri `AppHandle` exists).
    pub fn set_emitter(&self, emitter: Arc<dyn StateEmitter>) {
        if let Ok(mut g) = self.emitter.lock() {
            *g = Some(emitter);
        }
    }

    /// Whether a block is currently open. The voice layer reads this live to
    /// decide whether rep-check phrases (`done`, `again`) route as reps.
    pub fn active(&self) -> bool {
        self.active
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    /// The current block snapshot, or `None` when no block is open.
    pub fn snapshot(&self) -> Option<RepSnapshot> {
        self.active
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// Open a rep block. Rejects opening while one is already active (the caller
    /// must close it first — this keeps a mis-heard "open a tracker" from silently
    /// abandoning a block mid-practice). Resolves an "auto" ladder to concrete
    /// numbers, persists the block, and emits/logs the fresh snapshot.
    pub fn open(&self, args: RepOpenArgs) -> Result<RepSnapshot, String> {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        if active.is_some() {
            return Err("close the current block first".to_string());
        }

        let piece = self
            .store
            .get_piece(args.piece_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("piece {} not found", args.piece_id))?;

        let (auto_rule, planned) =
            ladder::resolve_auto(args.start_bpm, args.target_bpm, args.planned_reps, &args.variants);
        let rule = args.increment.clone().unwrap_or(auto_rule);

        let block_id = self
            .store
            .insert_rep_block(
                args.piece_id,
                args.m_start,
                args.m_end,
                args.label.as_deref(),
                args.start_bpm,
                args.target_bpm,
                &rule,
                planned,
                &args.variants,
            )
            .map_err(|e| e.to_string())?;

        let variant = ladder::variant_index_for_rep(&args.variants, 1)
            .map(|i| args.variants[i].name.clone());

        let snap = RepSnapshot {
            block_id,
            piece_id: args.piece_id,
            piece_title: piece.title,
            m_start: args.m_start,
            m_end: args.m_end,
            label: args.label,
            bpm: args.start_bpm,
            start_bpm: args.start_bpm,
            target_bpm: args.target_bpm,
            planned_reps: planned,
            reps_done: 0,
            cleans_at_step: 0,
            rule,
            variant,
            variants: args.variants,
            verdicts: VerdictCounts::default(),
            last: None,
            status: "open".to_string(),
        };
        *active = Some(snap.clone());
        drop(active);

        let snap_val = serde_json::to_value(&snap).unwrap_or(Value::Null);
        self.sessions.log("rep_open", snap_val.clone());
        // Durable canonical log (separate from the live session_event feed above).
        if let Some(sid) = self.sessions.current_id() {
            if let Err(e) =
                self.store
                    .append_event(EventKind::REP_OPEN, Some(sid), Some(snap.piece_id), &snap_val)
            {
                eprintln!("rep: failed to append REP_OPEN event: {e}");
            }
        }
        self.emit_state(Some(&snap));
        Ok(snap)
    }

    /// Record one rep against the active block. Advances `reps_done` for every
    /// verdict (an attempt is a rep); only a clean rep advances `cleans_at_step`
    /// and can step the ladder. Returns the composed outcome (updated snapshot,
    /// the new tempo if it stepped, whether the block finished, and the spoken
    /// line). Errors if no block is open.
    pub fn check(
        &self,
        verdict: RepVerdict,
        note: Option<String>,
    ) -> Result<CheckOutcome, String> {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let snap = active
            .as_mut()
            .ok_or_else(|| "no active rep block".to_string())?;

        // The rep is performed at the block's current tempo, in the lane of the
        // rep about to be recorded (1-based).
        let rep_bpm = snap.bpm;
        let cur_lane = ladder::variant_index_for_rep(&snap.variants, snap.reps_done + 1);
        let rep_variant = cur_lane.map(|i| snap.variants[i].name.clone());

        self.store
            .insert_rep(
                snap.block_id,
                rep_bpm,
                rep_variant.as_deref(),
                verdict.as_str(),
                note.as_deref(),
            )
            .map_err(|e| e.to_string())?;

        snap.reps_done += 1;
        match verdict {
            RepVerdict::Clean => {
                snap.verdicts.clean += 1;
                snap.cleans_at_step += 1;
            }
            RepVerdict::Flawed => snap.verdicts.flawed += 1,
            RepVerdict::Failed => snap.verdicts.failed += 1,
        }
        snap.last = Some(LastRep {
            verdict: verdict.as_str().to_string(),
            note: note.clone(),
            bpm: rep_bpm,
        });

        // Only a clean rep can step the ladder (only it advances cleans_at_step).
        let new_bpm = if matches!(verdict, RepVerdict::Clean) {
            ladder::step(&snap.rule, snap.cleans_at_step, snap.bpm, snap.target_bpm)
        } else {
            None
        };
        if let Some(nb) = new_bpm {
            snap.bpm = nb;
            snap.cleans_at_step = 0;
        }

        // Which lane the *next* rep belongs to, and whether that is a change.
        let next_lane = ladder::variant_index_for_rep(&snap.variants, snap.reps_done + 1);
        let lane_changed = next_lane.is_some() && next_lane != cur_lane;
        let next_variant = next_lane.map(|i| snap.variants[i].name.clone());
        snap.variant = next_variant.clone();

        let block_done = snap.reps_done >= snap.planned_reps;
        let say = compose_say(snap, new_bpm, block_done, lane_changed, next_variant.as_deref());

        let out_snap = snap.clone();
        drop(active);

        let rep_payload = json!({
            "block_id": out_snap.block_id,
            "piece_id": out_snap.piece_id,
            "bpm": rep_bpm,
            "variant": rep_variant,
            "verdict": verdict.as_str(),
            "note": note,
        });
        self.sessions.log("rep", rep_payload.clone());
        // Durable canonical log (separate from the live session_event feed above).
        if let Some(sid) = self.sessions.current_id() {
            if let Err(e) =
                self.store
                    .append_event(EventKind::REP, Some(sid), Some(out_snap.piece_id), &rep_payload)
            {
                eprintln!("rep: failed to append REP event: {e}");
            }
        }
        self.emit_state(Some(&out_snap));

        Ok(CheckOutcome {
            snap: out_snap,
            new_bpm,
            block_done,
            say,
        })
    }

    /// Close the active block: `done` when the planned reps were met, else
    /// `abandoned`. Returns the final snapshot (with `status` set), or `None`
    /// when no block was open.
    pub fn close(&self) -> Option<RepSnapshot> {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let mut snap = active.take()?;
        let status = if snap.reps_done >= snap.planned_reps {
            "done"
        } else {
            "abandoned"
        };
        snap.status = status.to_string();
        if let Err(e) = self.store.update_block_status(snap.block_id, status) {
            eprintln!("rep: failed to update block {} status: {e}", snap.block_id);
        }
        drop(active);

        self.sessions.log(
            "rep_close",
            json!({
                "block_id": snap.block_id,
                "piece_id": snap.piece_id,
                "status": status,
                "reps_done": snap.reps_done,
                "planned_reps": snap.planned_reps,
                "bpm": snap.bpm,
            }),
        );
        self.emit_state(None);
        Some(snap)
    }


    /// Reload a live-editable block's mutable fields from the store into the
    /// in-memory active snapshot and re-emit `rep://state`, but only when
    /// `block_id` is the currently open block (a no-op otherwise). Called by
    /// the `block_update`/`block_delete`/`rep_update`/`rep_delete` commands
    /// after their store mutation succeeds, so an edit made while a block is
    /// open (e.g. from a drill-in panel) is reflected immediately without a
    /// UI refetch.
    pub fn resync_active_if(&self, block_id: i64) {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let Some(snap) = active.as_mut() else { return };
        if snap.block_id != block_id {
            return;
        }
        let Ok(Some(row)) = self.store.block_row(block_id) else {
            return;
        };
        snap.label = row.label;
        snap.m_start = row.m_start;
        snap.m_end = row.m_end;
        snap.start_bpm = row.start_bpm;
        snap.target_bpm = row.target_bpm;
        snap.bpm = row.bpm;
        snap.planned_reps = row.planned_reps;
        snap.reps_done = row.reps_done;
        snap.verdicts = row.verdicts;
        snap.status = row.status;
        let out = snap.clone();
        drop(active);
        self.emit_state(Some(&out));
    }

    fn emit_state(&self, snap: Option<&RepSnapshot>) {
        let e = self.emitter.lock().ok().and_then(|g| g.as_ref().cloned());
        if let Some(e) = e {
            let payload = match snap {
                Some(s) => serde_json::to_value(s).unwrap_or(Value::Null),
                None => Value::Null,
            };
            e.emit("rep://state", payload);
        }
    }
}

/// Format a BPM for a spoken/UI line: a whole number prints without a decimal
/// (ladders step by whole amounts, so this is the common case).
fn fmt_bpm(bpm: f64) -> String {
    if bpm.fract() == 0.0 {
        (bpm as i64).to_string()
    } else {
        bpm.to_string()
    }
}

/// Compose the single spoken/UI line for a rep outcome. Block completion wins
/// over everything (its summary replaces the running count); otherwise the base
/// is `"{n} of {planned}."`, gaining `" Up to {bpm}."` on a step and
/// `" {Name} next."` when the variant lane changes.
fn compose_say(
    snap: &RepSnapshot,
    new_bpm: Option<f64>,
    block_done: bool,
    lane_changed: bool,
    next_variant: Option<&str>,
) -> String {
    if block_done {
        return format!(
            "Block done: {} reps, {} clean, topped out at {}.",
            snap.planned_reps,
            snap.verdicts.clean,
            fmt_bpm(snap.bpm)
        );
    }
    let mut s = match new_bpm {
        Some(nb) => format!(
            "{} of {}. Up to {}.",
            snap.reps_done,
            snap.planned_reps,
            fmt_bpm(nb)
        ),
        None => format!("{} of {}.", snap.reps_done, snap.planned_reps),
    };
    if lane_changed {
        if let Some(name) = next_variant {
            s.push_str(&format!(" {name} next."));
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::{ScanPiece, VariantSpec};

    #[derive(Default)]
    struct RecEmitter {
        events: Mutex<Vec<(String, Value)>>,
    }
    impl StateEmitter for RecEmitter {
        fn emit(&self, event: &str, payload: Value) {
            self.events
                .lock()
                .unwrap()
                .push((event.to_string(), payload));
        }
    }

    /// A rep engine over an in-memory store with one piece (id returned) and a
    /// recording emitter shared with the session service.
    fn engine_with_piece() -> (RepEngine, i64, Arc<Store>, Arc<RecEmitter>) {
        let store = Arc::new(Store::open(":memory:").expect("memory store"));
        let pid = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/Chopin - Scherzo".into(),
                title: "Scherzo".into(),
                composer: Some("Chopin".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let sessions = Arc::new(SessionService::new(store.clone()));
        let rec = Arc::new(RecEmitter::default());
        sessions.set_emitter(rec.clone());
        let engine = RepEngine::new(store.clone(), sessions);
        engine.set_emitter(rec.clone());
        (engine, pid, store, rec)
    }

    impl RecEmitter {
        /// The payload of the most recently emitted `rep://state`, deserialized
        /// as a [`RepSnapshot`]. Panics if none has been emitted (test-only).
        fn last_state(&self) -> RepSnapshot {
            let events = self.events.lock().unwrap();
            let (_, payload) = events
                .iter()
                .rev()
                .find(|(e, _)| e == "rep://state")
                .expect("no rep://state emitted");
            serde_json::from_value(payload.clone()).expect("payload is a RepSnapshot")
        }
    }

    fn open_args(pid: i64) -> RepOpenArgs {
        RepOpenArgs {
            piece_id: pid,
            m_start: 40,
            m_end: 56,
            label: None,
            start_bpm: 80.0,
            target_bpm: Some(120.0),
            planned_reps: Some(30),
            increment: None,
            variants: vec![],
        }
    }

    #[test]
    fn open_resolves_ladder_and_persists() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let snap = engine.open(open_args(pid)).unwrap();
        assert_eq!(snap.piece_title, "Scherzo");
        assert_eq!(snap.bpm, 80.0);
        assert_eq!(snap.planned_reps, 30);
        assert_eq!(snap.rule.clean_needed, 3, "auto-resolved 80→120/30 → 3");
        assert_eq!(snap.rule.bpm_step, 4.0);
        assert_eq!(snap.status, "open");
        assert!(engine.active());
        // Persisted as an open block.
        let hist = store.block_history(pid).unwrap();
        assert_eq!(hist.len(), 1);
        assert_eq!(hist[0].status, "open");
        assert_eq!(hist[0].reps_done, 0);
    }

    #[test]
    fn double_open_is_rejected() {
        let (engine, pid, _store, _rec) = engine_with_piece();
        engine.open(open_args(pid)).unwrap();
        let err = engine.open(open_args(pid)).unwrap_err();
        assert!(err.contains("close the current block first"), "got: {err}");
    }

    #[test]
    fn check_without_a_block_errs() {
        let (engine, _pid, _store, _rec) = engine_with_piece();
        assert!(engine.check(RepVerdict::Clean, None).is_err());
    }

    #[test]
    fn checks_persist_reps_with_verdict_tallies() {
        let (engine, pid, store, _rec) = engine_with_piece();
        engine.open(open_args(pid)).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Flawed, Some("rushed".into())).unwrap();
        engine.check(RepVerdict::Failed, None).unwrap();

        let snap = engine.snapshot().unwrap();
        assert_eq!(snap.reps_done, 3);
        assert_eq!(snap.verdicts, VerdictCounts { clean: 1, flawed: 1, failed: 1 });
        assert_eq!(snap.last.as_ref().unwrap().verdict, "failed");

        let h = &store.block_history(pid).unwrap()[0];
        assert_eq!(h.reps_done, 3);
        assert_eq!(h.verdicts, VerdictCounts { clean: 1, flawed: 1, failed: 1 });
    }

    #[test]
    fn clean_reps_step_the_ladder_and_announce() {
        let (engine, pid, _store, _rec) = engine_with_piece();
        engine.open(open_args(pid)).unwrap(); // 80→120, clean_needed 3
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let out = engine.check(RepVerdict::Clean, None).unwrap(); // 3rd clean → step
        assert_eq!(out.new_bpm, Some(84.0), "stepped up one rung");
        assert_eq!(out.say, "3 of 30. Up to 84.");
        assert!(!out.block_done);
        let snap = engine.snapshot().unwrap();
        assert_eq!(snap.bpm, 84.0);
        assert_eq!(snap.cleans_at_step, 0, "reset after the step");
    }

    #[test]
    fn only_clean_reps_advance_cleans_at_step() {
        let (engine, pid, _store, _rec) = engine_with_piece();
        engine.open(open_args(pid)).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Failed, None).unwrap();
        engine.check(RepVerdict::Flawed, None).unwrap();
        let snap = engine.snapshot().unwrap();
        assert_eq!(snap.cleans_at_step, 1, "only the clean rep counted toward a step");
        assert_eq!(snap.reps_done, 3, "but every attempt is a rep");
        assert_eq!(snap.bpm, 80.0, "no step yet");
    }

    #[test]
    fn variants_lane_through_and_announce_next() {
        let (engine, pid, _store, _rec) = engine_with_piece();
        let args = RepOpenArgs {
            piece_id: pid,
            m_start: 1,
            m_end: 4,
            label: None,
            start_bpm: 80.0,
            target_bpm: None, // no ladder climb, isolates the variant behaviour
            planned_reps: None,
            increment: None,
            variants: vec![
                VariantSpec { name: "hands separate".into(), reps: 2 },
                VariantSpec { name: "hands together".into(), reps: 2 },
            ],
        };
        let snap = engine.open(args).unwrap();
        assert_eq!(snap.planned_reps, 4, "Σ variant reps");
        assert_eq!(snap.variant.as_deref(), Some("hands separate"));

        let o1 = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(o1.say, "1 of 4.");
        // rep 2 finishes lane 0; the next rep is lane 1 → announce it.
        let o2 = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(o2.say, "2 of 4. hands together next.");
        assert_eq!(o2.snap.variant.as_deref(), Some("hands together"));
        let o3 = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(o3.say, "3 of 4.");
        let o4 = engine.check(RepVerdict::Clean, None).unwrap();
        assert!(o4.block_done);
        assert_eq!(o4.say, "Block done: 4 reps, 4 clean, topped out at 80.");
    }

    #[test]
    fn close_marks_done_when_planned_met_else_abandoned() {
        let (engine, pid, store, _rec) = engine_with_piece();
        // planned 2, no target: two reps then done.
        let args = RepOpenArgs {
            planned_reps: Some(2),
            target_bpm: None,
            ..open_args(pid)
        };
        engine.open(args).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let closed = engine.close().unwrap();
        assert_eq!(closed.status, "done");
        assert!(!engine.active(), "no block open after close");
        assert_eq!(store.block_history(pid).unwrap()[0].status, "done");

        // A block closed before meeting the plan is abandoned.
        engine.open(open_args(pid)).unwrap(); // planned 30
        engine.check(RepVerdict::Clean, None).unwrap();
        let closed = engine.close().unwrap();
        assert_eq!(closed.status, "abandoned");
        assert!(engine.close().is_none(), "nothing to close now");
    }

    #[test]
    fn editing_active_block_reemits_snapshot() {
        use crate::store::model::BlockPatch;

        let (engine, pid, _store, rec) = engine_with_piece();
        let snap = engine.open(open_args(pid)).unwrap();
        engine
            .store
            .block_update(
                snap.block_id,
                BlockPatch {
                    label: Some(Some("legato".into())),
                    target_bpm: Some(Some(120.0)),
                    ..Default::default()
                },
            )
            .unwrap();
        engine.resync_active_if(snap.block_id);
        let last = rec.last_state();
        assert_eq!(last.label.as_deref(), Some("legato"));
        assert_eq!(last.target_bpm, Some(120.0));
    }

    #[test]
    fn resync_active_if_is_a_no_op_for_a_different_block() {
        use crate::store::model::BlockPatch;

        let (engine, pid, store, rec) = engine_with_piece();
        let snap = engine.open(open_args(pid)).unwrap();
        let events_before = rec.events.lock().unwrap().len();
        store
            .block_update(
                snap.block_id,
                BlockPatch { label: Some(Some("noop".into())), ..Default::default() },
            )
            .ok();
        engine.resync_active_if(snap.block_id + 999);
        assert_eq!(rec.events.lock().unwrap().len(), events_before, "no re-emit");
        assert_eq!(engine.snapshot().unwrap().label, None, "unrelated edit not applied");
    }

    #[test]
    fn open_and_check_emit_rep_state_and_log_session() {
        let (engine, pid, _store, rec) = engine_with_piece();
        engine.open(open_args(pid)).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let events = rec.events.lock().unwrap();
        // rep://state emitted on open + check; session://event for rep_open + rep.
        assert!(events.iter().any(|(e, _)| e == "rep://state"));
        assert!(events
            .iter()
            .any(|(e, p)| e == "session://event" && p["kind"] == "rep_open"));
        assert!(events
            .iter()
            .any(|(e, p)| e == "session://event" && p["kind"] == "rep"));
    }
}
