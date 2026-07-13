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

        let default_reps = self
            .store
            .get_setting("rep.default_reps")
            .ok()
            .flatten()
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|value| (1..=240).contains(value))
            .unwrap_or(ladder::DEFAULT_PLANNED);
        let bpm_step = self
            .store
            .get_setting("rep.bpm_step")
            .ok()
            .flatten()
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && (1.0..=24.0).contains(value))
            .unwrap_or(ladder::BPM_STEP);
        let (auto_rule, planned) = ladder::resolve_auto_with_defaults(
            args.start_bpm,
            args.target_bpm,
            args.planned_reps,
            &args.variants,
            default_reps,
            bpm_step,
        );
        let rule = args.increment.clone().unwrap_or(auto_rule);

        let variant = ladder::variant_index_for_rep(&args.variants, 1)
            .map(|i| args.variants[i].name.clone());
        let session_id = self.sessions.ensure_session()?;
        let (_block_id, event_id, snap) = self
            .store
            .insert_rep_block_with_practice_event(
                session_id,
                args.piece_id,
                args.m_start,
                args.m_end,
                args.label.as_deref(),
                if args.focus == "tempo" || args.use_metronome {
                    Some(args.start_bpm)
                } else {
                    None
                },
                args.target_bpm,
                &rule,
                planned,
                &args.variants,
                &args.focus,
                args.use_metronome,
                args.region_id,
                |block_id| {
                    let snap = RepSnapshot {
                        block_id,
                        piece_id: args.piece_id,
                        piece_title: piece.title.clone(),
                        m_start: args.m_start,
                        m_end: args.m_end,
                        label: args.label.clone(),
                        bpm: args.start_bpm,
                        start_bpm: args.start_bpm,
                        target_bpm: args.target_bpm,
                        planned_reps: planned,
                        reps_done: 0,
                        cleans_at_step: 0,
                        rule: rule.clone(),
                        variant: variant.clone(),
                        variants: args.variants.clone(),
                        verdicts: VerdictCounts::default(),
                        last: None,
                        status: "open".to_string(),
                        focus: args.focus.clone(),
                        use_metronome: args.use_metronome,
                    };
                    let payload = serde_json::to_value(&snap).map_err(|error| {
                        rusqlite::Error::ToSqlConversionFailure(Box::new(error))
                    })?;
                    Ok((payload, snap))
                },
            )
            .map_err(|e| e.to_string())?;
        *active = Some(snap.clone());
        drop(active);
        self.sessions
            .emit_persisted_practice(event_id, EventKind::REP_OPEN);
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
        let mut next_snap = snap.clone();

        next_snap.reps_done += 1;
        match verdict {
            RepVerdict::Clean => {
                next_snap.verdicts.clean += 1;
                next_snap.cleans_at_step += 1;
            }
            RepVerdict::Flawed => next_snap.verdicts.flawed += 1,
            RepVerdict::Failed => next_snap.verdicts.failed += 1,
        }
        next_snap.last = Some(LastRep {
            verdict: verdict.as_str().to_string(),
            note: note.clone(),
            bpm: rep_bpm,
        });

        // The tempo ladder is decoupled from the metronome and gated on focus:
        // only a `tempo` block climbs, and only a clean rep can step it (only a
        // clean rep advances cleans_at_step). A `focus != "tempo"` block counts
        // verdicts but never advances BPM. When it does step, we ALWAYS update the
        // working tempo + log a `tempo_change` event (below), regardless of whether
        // the metronome is running or `use_metronome` is set — retuning the actual
        // metronome is the consumer's job (voice loop), gated on `use_metronome`.
        let from_bpm = next_snap.bpm;
        let new_bpm = if next_snap.focus == "tempo" && matches!(verdict, RepVerdict::Clean) {
            ladder::step(
                &next_snap.rule,
                next_snap.cleans_at_step,
                next_snap.bpm,
                next_snap.target_bpm,
            )
        } else {
            None
        };
        if let Some(nb) = new_bpm {
            next_snap.bpm = nb;
            next_snap.cleans_at_step = 0;
        }

        // Which lane the *next* rep belongs to, and whether that is a change.
        let next_lane =
            ladder::variant_index_for_rep(&next_snap.variants, next_snap.reps_done + 1);
        let lane_changed = next_lane.is_some() && next_lane != cur_lane;
        let next_variant = next_lane.map(|i| next_snap.variants[i].name.clone());
        next_snap.variant = next_variant.clone();

        let block_done = next_snap.reps_done >= next_snap.planned_reps;
        let say = compose_say(
            &next_snap,
            new_bpm,
            block_done,
            lane_changed,
            next_variant.as_deref(),
        );

        let rep_payload = json!({
            "block_id": next_snap.block_id,
            "piece_id": next_snap.piece_id,
            "bpm": rep_bpm,
            "variant": rep_variant.clone(),
            "verdict": verdict.as_str(),
            "note": note.clone(),
        });
        let tempo_payload = new_bpm.map(|nb| {
            json!({
                "block_id": next_snap.block_id,
                "piece_id": next_snap.piece_id,
                "from_bpm": from_bpm,
                "to_bpm": nb,
            })
        });
        let sid = self.sessions.ensure_session()?;
        let (_, event_id) = self
            .store
            .insert_rep_with_practice_event(
                sid,
                next_snap.piece_id,
                next_snap.block_id,
                rep_bpm,
                rep_variant.as_deref(),
                verdict.as_str(),
                note.as_deref(),
                &rep_payload,
                tempo_payload.as_ref(),
            )
            .map_err(|error| error.to_string())?;
        *snap = next_snap.clone();
        let out_snap = next_snap;
        drop(active);
        self.sessions
            .emit_persisted_practice(event_id, EventKind::REP);
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
        // The active block's row is gone (it was just `block_delete`d): evict the
        // stranded snapshot so a later `check()` can't FK-error inserting a rep
        // against a phantom block. Emit a `None` state so the UI clears the panel.
        let Ok(Some(row)) = self.store.block_row(block_id) else {
            *active = None;
            drop(active);
            self.emit_state(None);
            return;
        };
        // Reload only the fields `block_update` can actually change. Crucially we
        // do NOT touch `snap.bpm`: that is the LIVE working tempo, advanced up the
        // ladder by `check()`, whereas `row.bpm` is derived from the last logged
        // rep's bpm — after a ladder step they diverge and copying `row.bpm` back
        // would silently drop the working tempo. `reps_done`/`verdicts` ARE
        // derived from surviving rep rows (a rep_delete/update changed them), so
        // those we do refresh.
        snap.label = row.label;
        snap.m_start = row.m_start;
        snap.m_end = row.m_end;
        snap.start_bpm = row.start_bpm.unwrap_or(0.0);
        snap.target_bpm = row.target_bpm;
        snap.planned_reps = row.planned_reps;
        snap.reps_done = row.reps_done;
        snap.verdicts = row.verdicts;
        snap.status = row.status;
        // On a not-yet-started block the working tempo tracks `start_bpm`, so an
        // edit to `start_bpm` moves it; once reps exist, the live `snap.bpm` (the
        // ladder position) is authoritative and left untouched.
        if snap.reps_done == 0 {
            snap.bpm = row.start_bpm.unwrap_or(0.0);
        }
        // Mirror a live edit of the block's ladder config too.
        if let Ok(Some(rule)) = self.store.block_rule(block_id) {
            snap.rule = rule;
        }
        // Mirror a live edit of the block's focus / metronome flag, so toggling a
        // block to (or from) `tempo` focus — or turning the metronome off — takes
        // effect on the active block without reopening it.
        if let Ok(Some((focus, use_metronome))) = self.store.block_focus_metronome(block_id) {
            snap.focus = focus;
            snap.use_metronome = use_metronome;
        }
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
    use crate::store::model::{IncrementRule, ScanPiece, VariantSpec};

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
            region_id: None,
            m_start: 40,
            m_end: 56,
            label: None,
            start_bpm: 80.0,
            target_bpm: Some(120.0),
            planned_reps: Some(30),
            increment: None,
            variants: vec![],
            focus: "tempo".into(),
            use_metronome: true,
        }
    }

    // ── T18 helpers ───────────────────────────────────────────────────────
    // `engine_with_capture` mirrors `engine_with_piece` but returns just the
    // engine + emitter (the seeded piece is id 1 in a fresh in-memory store).

    fn engine_with_capture() -> (RepEngine, Arc<RecEmitter>) {
        let (engine, _pid, _store, rec) = engine_with_piece();
        (engine, rec)
    }

    /// A `tempo`-focus block with an explicit ladder (so a step is deterministic)
    /// and a target far enough above `start` to leave headroom to climb.
    fn open_args_tempo(use_metronome: bool, clean_needed: u32, step: f64, start: f64) -> RepOpenArgs {
        RepOpenArgs {
            piece_id: 1,
            region_id: None,
            m_start: 1,
            m_end: 8,
            label: None,
            start_bpm: start,
            target_bpm: Some(start + 200.0),
            planned_reps: Some(30),
            increment: Some(IncrementRule { clean_needed, bpm_step: step }),
            variants: vec![],
            focus: "tempo".into(),
            use_metronome,
        }
    }

    /// A block with the given non-`tempo` focus, carrying a ladder that WOULD step
    /// on the first clean rep were it a tempo block — proving the focus gate, not a
    /// missing ladder, is what holds the BPM.
    fn open_args_focus(focus: &str) -> RepOpenArgs {
        RepOpenArgs {
            piece_id: 1,
            region_id: None,
            m_start: 1,
            m_end: 8,
            label: None,
            start_bpm: 40.0,
            target_bpm: Some(200.0),
            planned_reps: Some(30),
            increment: Some(IncrementRule { clean_needed: 1, bpm_step: 4.0 }),
            variants: vec![],
            focus: focus.into(),
            use_metronome: true,
        }
    }

    #[test]
    fn ladder_advances_with_metronome_off() {
        let (engine, _emit) = engine_with_capture();
        let args = open_args_tempo(/*use_metronome*/ false, /*clean_needed*/ 2, /*step*/ 4.0, /*start*/ 40.0);
        let snap = engine.open(args).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let out = engine.check(RepVerdict::Clean, None).unwrap(); // hits the step
        assert_eq!(out.snap.bpm, 44.0); // advanced
        let evs = engine.store.events_for_piece(snap.piece_id).unwrap();
        assert!(evs.iter().any(|e| e.kind == "tempo_change"));
    }

    #[test]
    fn step_after_session_end_uses_the_new_practice_session() {
        let (engine, _pid, store, _emit) = engine_with_piece();
        engine
            .open(open_args_tempo(true, 1, 4.0, 40.0))
            .unwrap();
        let ended = engine.sessions.end_raw().expect("open session ends");
        let out = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(out.new_bpm, Some(44.0));
        let events = store.events_for_piece(1).unwrap();
        let rep_session = events
            .iter()
            .rev()
            .find(|event| event.kind == EventKind::REP)
            .and_then(|event| event.session_id)
            .expect("rep opens a replacement session");
        let tempo_session = events
            .iter()
            .rev()
            .find(|event| event.kind == EventKind::TEMPO_CHANGE)
            .and_then(|event| event.session_id)
            .expect("step is logged in the replacement session");
        assert_ne!(rep_session, ended);
        assert_eq!(tempo_session, rep_session);
    }

    #[test]
    fn non_tempo_block_never_advances_bpm() {
        let (engine, _emit) = engine_with_capture();
        let snap = engine.open(open_args_focus("notes")).unwrap();
        let out = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(out.snap.bpm, snap.bpm); // unchanged
        // And no tempo_change was logged for a non-tempo block.
        let evs = engine.store.events_for_piece(snap.piece_id).unwrap();
        assert!(!evs.iter().any(|e| e.kind == "tempo_change"));
    }

    #[test]
    fn metronome_free_non_tempo_block_persists_without_fake_bpm() {
        let (engine, _emit) = engine_with_capture();
        let mut args = open_args_focus("phrasing");
        args.start_bpm = 0.0;
        args.use_metronome = false;
        let snap = engine.open(args).unwrap();
        let history = engine.store.block_row(snap.block_id).unwrap().unwrap();
        assert_eq!(history.start_bpm, None);
        assert_eq!(history.focus, "phrasing");
        assert!(!history.use_metronome);
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
    fn opening_reps_inside_a_tricky_section_links_the_same_canonical_region() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let region = store.region_create(crate::store::model::RegionCreate {
            piece_id: pid,
            name: "LH landing".into(),
            notes: None,
            m_start: 38,
            m_end: 60,
            kind: "hard_spot".into(),
        }).unwrap();
        let snap = engine.open(open_args(pid)).unwrap();
        let history = store.block_row(snap.block_id).unwrap().unwrap();
        assert_eq!(history.region_id, Some(region.id));
    }

    #[test]
    fn score_selected_tricky_section_remains_linked_after_measure_adjustment() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let region = store.region_create(crate::store::model::RegionCreate {
            piece_id: pid,
            name: "RH shape".into(),
            notes: None,
            m_start: 40,
            m_end: 56,
            kind: "hard_spot".into(),
        }).unwrap();
        let mut args = open_args(pid);
        args.region_id = Some(region.id);
        args.m_start = 38;
        args.m_end = 58;

        let snap = engine.open(args).unwrap();
        let history = store.block_row(snap.block_id).unwrap().unwrap();
        assert_eq!(history.region_id, Some(region.id));
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
            region_id: None,
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
            focus: "tempo".into(),
            use_metronome: true,
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
    fn resync_preserves_stepped_working_tempo() {
        use crate::store::model::BlockPatch;

        let (engine, pid, store, _rec) = engine_with_piece();
        let snap = engine.open(open_args(pid)).unwrap(); // 80→120/30 auto: step +4 every 3 cleans
        // Climb the ladder past the start: 3 clean reps steps 80 → 84.
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let out = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(out.new_bpm, Some(84.0), "3 cleans should step the ladder");
        assert_eq!(engine.snapshot().unwrap().bpm, 84.0, "working tempo stepped");

        // A live edit (relabel) must NOT reset the working tempo back to the
        // last-logged-rep bpm (80). This is the core bug: resync used to copy
        // block_row.bpm (derived from the last rep) over the live snap.bpm.
        store
            .block_update(
                snap.block_id,
                BlockPatch { label: Some(Some("legato".into())), ..Default::default() },
            )
            .unwrap();
        engine.resync_active_if(snap.block_id);
        assert_eq!(
            engine.snapshot().unwrap().bpm,
            84.0,
            "working tempo preserved across resync"
        );
        assert_eq!(engine.snapshot().unwrap().label.as_deref(), Some("legato"));
    }

    #[test]
    fn resync_evicts_the_active_block_when_its_row_is_gone() {
        let (engine, pid, store, rec) = engine_with_piece();
        let snap = engine.open(open_args(pid)).unwrap();
        assert!(engine.active());

        // The block_delete command deletes the row then calls resync_active_if.
        store.block_delete(snap.block_id).unwrap();
        engine.resync_active_if(snap.block_id);

        assert!(!engine.active(), "active snapshot evicted after its row is deleted");
        assert!(engine.snapshot().is_none());
        // The last rep://state emitted must be the cleared (null) state.
        let (_, payload) = rec
            .events
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|(e, _)| e == "rep://state")
            .cloned()
            .expect("a rep://state was emitted");
        assert!(payload.is_null(), "cleared state emitted on eviction");
    }

    #[test]
    fn resync_reloads_the_ladder_rule() {
        use crate::store::model::{BlockPatch, IncrementRule};

        let (engine, pid, store, _rec) = engine_with_piece();
        let snap = engine.open(open_args(pid)).unwrap();
        let new_rule = IncrementRule { clean_needed: 7, bpm_step: 2.0 };
        assert_ne!(engine.snapshot().unwrap().rule, new_rule);

        store
            .block_update(
                snap.block_id,
                BlockPatch { increment_rule: Some(Some(new_rule.clone())), ..Default::default() },
            )
            .unwrap();
        engine.resync_active_if(snap.block_id);
        assert_eq!(engine.snapshot().unwrap().rule, new_rule, "live rule edit reflected");
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
