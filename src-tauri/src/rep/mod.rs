//! The rep engine: the stateful service that owns the one active rep block,
//! records each rep, climbs the tempo ladder, and narrates the outcome.
//!
//! At most one block is open at a time (opening while one is active is rejected
//! for voice safety — see [`RepEngine::open`]). Every mutation persists to the
//! store, logs a session event, and emits `rep://state` so the UI and the voice
//! layer see the same truth. The spoken/UI line for each rep is composed *here*
//! ([`compose_v2_say`]) so voice and the frontend never diverge.
//!
//! The pure ladder arithmetic lives in [`ladder`]; this module is the I/O + state
//! shell around it.

pub mod ladder;

use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::ledger::MutationSource;
use crate::protocol::PracticeContract;
use crate::sessions::{SessionService, StateEmitter};
use crate::store::model::{CheckOutcome, RepOpenArgs, RepSnapshot};
use crate::store::{v2_command_id, v2_validate_open, EventKind, Store};

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
    /// A malformed durable live-set state must never masquerade as an empty
    /// engine: `rep_state` and every open attempt surface this recovery error.
    restore_error: Option<String>,
    emitter: Mutex<Option<Arc<dyn StateEmitter>>>,
}

impl RepEngine {
    pub fn new(store: Arc<Store>, sessions: Arc<SessionService>) -> Self {
        let (restored, restore_error) = match store.v2_restore_active() {
            Ok(snapshot) => (snapshot, None),
            Err(error) => {
                let message = format!("could not restore active practice set: {error}");
                eprintln!("rep: {message}");
                (None, Some(message))
            }
        };
        RepEngine {
            store,
            sessions,
            active: Mutex::new(restored),
            restore_error,
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

    /// IPC-facing state read. Unlike the internal best-effort observer, this
    /// preserves a relaunch integrity error instead of returning a false empty
    /// state that can neither be closed nor replaced.
    pub fn state(&self) -> Result<Option<RepSnapshot>, String> {
        if let Some(error) = &self.restore_error {
            return Err(error.clone());
        }
        Ok(self.snapshot())
    }

    /// Open a rep block. Rejects opening while one is already active (the caller
    /// must close it first — this keeps a mis-heard "open a tracker" from silently
    /// abandoning a block mid-practice). Resolves an "auto" ladder to concrete
    /// numbers, persists the block, and emits/logs the fresh snapshot.
    pub fn open(&self, args: RepOpenArgs) -> Result<RepSnapshot, String> {
        self.open_from(args, MutationSource::UserClick)
    }

    pub fn open_voice(&self, args: RepOpenArgs) -> Result<RepSnapshot, String> {
        self.open_from(args, MutationSource::VoiceHotLoop)
    }

    fn open_from(
        &self,
        args: RepOpenArgs,
        source: MutationSource,
    ) -> Result<RepSnapshot, String> {
        if let Some(error) = &self.restore_error {
            return Err(error.clone());
        }
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        if active.is_some() {
            return Err("close the current block first".to_string());
        }

        self
            .store
            .get_piece(args.piece_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("piece {} not found", args.piece_id))?;

        // An explicit caller value is a contract, not a hint: reject malformed
        // input instead of quietly replacing it with the default. Only a missing
        // caller value may fall back through the persisted setting to five.
        let required_clean_streak = match args.required_clean_streak {
            Some(value) => value,
            None => self
                .store
                .get_setting("practice.default_clean_streak")
                .ok()
                .flatten()
                .and_then(|value| value.parse::<u32>().ok())
                .filter(|value| (1..=100).contains(value))
                .unwrap_or(5),
        };
        let default_ladder_budget = self
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
        let compatibility_planned = args.planned_reps.unwrap_or(required_clean_streak);
        let (auto_rule, variant_planned) = ladder::resolve_auto_with_defaults(
            args.start_bpm,
            args.target_bpm,
            args.planned_reps,
            &args.variants,
            default_ladder_budget,
            bpm_step,
        );
        let rule = args.increment.clone().unwrap_or(auto_rule);
        let planned = if args.variants.is_empty() {
            compatibility_planned
        } else {
            variant_planned
        };
        let mut contract = PracticeContract::consecutive_clean(required_clean_streak);
        contract.attempt_ceiling = args.planned_reps;
        v2_validate_open(&args, &rule, planned, &contract).map_err(|error| error.to_string())?;
        let session_id = self.sessions.ensure_session()?;
        let command_id = v2_command_id(source, "open");
        let opened = self
            .store
            .v2_open_set(
                session_id,
                &args,
                &rule,
                planned,
                &contract,
                source,
                &command_id,
            )
            .map_err(|e| e.to_string())?;
        let snap = opened.snapshot;
        *active = Some(snap.clone());
        drop(active);
        self.sessions
            .emit_persisted_practice(opened.feed_id, EventKind::REP_OPEN);
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
        self.check_from(verdict, note, MutationSource::UserClick)
    }

    pub fn check_voice(
        &self,
        verdict: RepVerdict,
        note: Option<String>,
    ) -> Result<CheckOutcome, String> {
        self.check_from(verdict, note, MutationSource::VoiceHotLoop)
    }

    fn check_from(
        &self,
        verdict: RepVerdict,
        note: Option<String>,
        source: MutationSource,
    ) -> Result<CheckOutcome, String> {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let snap = active
            .as_ref()
            .ok_or_else(|| "no active rep block".to_string())?;
        let cur_lane = ladder::variant_index_for_rep(&snap.variants, snap.tries + 1);
        let rep_variant = cur_lane.map(|i| snap.variants[i].name.clone());
        let block_id = snap.block_id;
        let sid = self.sessions.ensure_session()?;
        let command_id = v2_command_id(source, "check");
        let mutation = self
            .store
            .v2_record_attempt(
                sid,
                block_id,
                rep_variant.as_deref(),
                verdict,
                note.as_deref(),
                source,
                &command_id,
            )
            .map_err(|error| error.to_string())?;
        let out_snap = mutation.snapshot;
        let new_bpm = mutation.new_bpm;
        let block_done = out_snap.mastery_status == "satisfied";
        let say = compose_v2_say(&out_snap, verdict, new_bpm);
        *active = Some(out_snap.clone());
        drop(active);
        if let Some(feed_id) = mutation.feed_id {
            self.sessions.emit_persisted_practice(feed_id, EventKind::REP);
        }
        self.emit_state(Some(&out_snap));

        Ok(CheckOutcome {
            snap: out_snap,
            new_bpm,
            block_done,
            say,
        })
    }

    /// Close the active set as mastered only when its contract is satisfied;
    /// otherwise close it unresolved. Database failure is returned without
    /// clearing the in-memory set.
    pub fn close(&self) -> Result<Option<RepSnapshot>, String> {
        self.close_from(MutationSource::UserClick)
    }

    pub fn close_voice(&self) -> Result<Option<RepSnapshot>, String> {
        self.close_from(MutationSource::VoiceHotLoop)
    }

    fn close_from(&self, source: MutationSource) -> Result<Option<RepSnapshot>, String> {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let Some(current) = active.as_ref() else { return Ok(None) };
        let sid = self.sessions.ensure_session()?;
        let command_id = v2_command_id(source, "close");
        let mutation = self
            .store
            .v2_close(sid, current.block_id, source, &command_id)
            .map_err(|error| error.to_string())?;
        let snap = mutation.snapshot;
        *active = None;
        drop(active);
        if let Some(feed_id) = mutation.feed_id {
            self.sessions.emit_persisted_practice(feed_id, "rep_close");
        }
        self.emit_state(None);
        Ok(Some(snap))
    }

    pub fn undo(&self) -> Result<CheckOutcome, String> {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no active rep block".to_string())?
            .block_id;
        let sid = self.sessions.ensure_session()?;
        let command_id = v2_command_id(MutationSource::UserClick, "undo");
        let mutation = self
            .store
            .v2_undo(
                sid,
                block_id,
                MutationSource::UserClick,
                &command_id,
            )
            .map_err(|error| error.to_string())?;
        let snap = mutation.snapshot;
        *active = Some(snap.clone());
        drop(active);
        if let Some(feed_id) = mutation.feed_id {
            self.sessions.emit_persisted_practice(feed_id, "rep_edit");
        }
        self.emit_state(Some(&snap));
        Ok(CheckOutcome {
            block_done: snap.mastery_status == "satisfied",
            say: format!("Attempt undone. {} tries remain.", snap.tries),
            snap,
            new_bpm: mutation.new_bpm,
        })
    }

    pub fn correct(
        &self,
        attempt_id: Option<i64>,
        verdict: RepVerdict,
        note: Option<String>,
        replace_note: bool,
    ) -> Result<CheckOutcome, String> {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no active rep block".to_string())?
            .block_id;
        let sid = self.sessions.ensure_session()?;
        let command_id = v2_command_id(MutationSource::UserClick, "correct");
        let mutation = self
            .store
            .v2_correct(
                Some(sid),
                block_id,
                attempt_id,
                verdict,
                note.as_deref(),
                replace_note,
                MutationSource::UserClick,
                &command_id,
                true,
            )
            .map_err(|error| error.to_string())?;
        let snap = mutation.snapshot;
        *active = Some(snap.clone());
        drop(active);
        if let Some(feed_id) = mutation.feed_id {
            self.sessions.emit_persisted_practice(feed_id, "rep_edit");
        }
        self.emit_state(Some(&snap));
        Ok(CheckOutcome {
            block_done: snap.mastery_status == "satisfied",
            say: format!("Attempt corrected to {}.", verdict.as_str()),
            snap,
            new_bpm: mutation.new_bpm,
        })
    }

    pub fn reverse_adjustment(&self, adjustment_id: i64) -> Result<CheckOutcome, String> {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no active rep block".to_string())?
            .block_id;
        let sid = self.sessions.ensure_session()?;
        let command_id = v2_command_id(MutationSource::UserClick, "reverse_adjustment");
        let mutation = self
            .store
            .v2_reverse_adjustment(
                sid,
                block_id,
                adjustment_id,
                MutationSource::UserClick,
                &command_id,
            )
            .map_err(|error| error.to_string())?;
        let snap = mutation.snapshot;
        *active = Some(snap.clone());
        drop(active);
        if let Some(feed_id) = mutation.feed_id {
            self.sessions.emit_persisted_practice(feed_id, "rep_edit");
        }
        self.emit_state(Some(&snap));
        Ok(CheckOutcome {
            block_done: snap.mastery_status == "satisfied",
            say: "Correction reversed.".into(),
            snap,
            new_bpm: mutation.new_bpm,
        })
    }

    pub fn restart(&self, required_clean_streak: Option<u32>) -> Result<RepSnapshot, String> {
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no active rep block".to_string())?
            .block_id;
        let sid = self.sessions.ensure_session()?;
        let command_id = v2_command_id(MutationSource::UserClick, "restart");
        let opened = self
            .store
            .v2_restart(
                sid,
                block_id,
                required_clean_streak,
                MutationSource::UserClick,
                &command_id,
            )
            .map_err(|error| error.to_string())?;
        let snap = opened.snapshot;
        *active = Some(snap.clone());
        drop(active);
        self.sessions
            .emit_persisted_practice(opened.feed_id, EventKind::REP_OPEN);
        self.emit_state(Some(&snap));
        Ok(snap)
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
        let Some(current) = active.as_ref() else { return };
        if current.block_id != block_id {
            return;
        }
        let out = match self.store.v2_snapshot(block_id) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                *active = None;
                drop(active);
                self.emit_state(None);
                return;
            }
        };
        *active = Some(out.clone());
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

fn compose_v2_say(snap: &RepSnapshot, verdict: RepVerdict, new_bpm: Option<f64>) -> String {
    if snap.mastery_status == "satisfied" {
        return format!(
            "Mastery earned: {} clean in a row.",
            snap.current_clean_streak
        );
    }
    let verdict_text = verdict.as_str();
    let below_tempo_target = snap.focus == "tempo"
        && snap.target_bpm.is_some_and(|target| {
            snap.bpm
                .is_some_and(|bpm| bpm + 0.000_001 < target)
        });
    let (progress_label, progress, required) = if below_tempo_target {
        ("Rung", snap.current_clean_streak, snap.rule.clean_needed)
    } else {
        (
            "Streak",
            snap.mastery_progress_streak,
            snap.effective_required_clean_streak,
        )
    };
    let mut message = if matches!(verdict, RepVerdict::Clean) {
        format!(
            "Attempt {} saved — {}. {} {} of {}.",
            snap.tries,
            verdict_text,
            progress_label,
            progress,
            required
        )
    } else {
        format!(
            "Attempt {} saved — {}. {} reset to {} of {}.",
            snap.tries,
            verdict_text,
            progress_label,
            progress,
            required
        )
    };
    if let Some(bpm) = new_bpm {
        message.push_str(&format!(" Up to {}.", fmt_bpm(bpm)));
    }
    message
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::{IncrementRule, RepPatch, ScanPiece, VariantSpec, VerdictCounts};
    use std::path::Path;

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

    fn engine_with_piece_at(path: &Path) -> (RepEngine, i64, Arc<Store>) {
        let store = Arc::new(Store::open(path).expect("test store"));
        let pid = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/Terminal lineage".into(),
                title: "Terminal lineage".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let sessions = Arc::new(SessionService::new(store.clone()));
        (RepEngine::new(store.clone(), sessions), pid, store)
    }

    fn assert_set_lifecycle(store: &Store, block_id: i64, state: &str, status: &str) {
        let projected = store.v2_snapshot(block_id).unwrap();
        assert_eq!(projected.set_state, state);
        assert_eq!(projected.status, status);
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={block_id}"
                ))
                .unwrap(),
            state
        );
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT status FROM rep_block WHERE id={block_id}"
                ))
                .unwrap(),
            status
        );
    }

    fn exercise_terminal_history_adjustments(
        store: &Store,
        block_id: i64,
        attempt_id: i64,
        state: &str,
    ) {
        store
            .rep_update(
                attempt_id,
                RepPatch {
                    verdict: Some("clean".into()),
                    note: None,
                },
            )
            .unwrap();
        assert_set_lifecycle(store, block_id, state, "abandoned");
        let correction_id = store.v2_snapshot(block_id).unwrap().last_adjustment_id.unwrap();
        let session_id = store.open_session().unwrap();
        store
            .v2_reverse_adjustment(
                session_id,
                block_id,
                correction_id,
                MutationSource::UserClick,
                &v2_command_id(MutationSource::UserClick, "terminal_correct_reverse"),
            )
            .unwrap();
        assert_set_lifecycle(store, block_id, state, "abandoned");

        store.rep_delete(attempt_id).unwrap();
        assert_set_lifecycle(store, block_id, state, "abandoned");
        let void_id = store.v2_snapshot(block_id).unwrap().last_adjustment_id.unwrap();
        store
            .v2_reverse_adjustment(
                session_id,
                block_id,
                void_id,
                MutationSource::UserClick,
                &v2_command_id(MutationSource::UserClick, "terminal_void_reverse"),
            )
            .unwrap();
        assert_set_lifecycle(store, block_id, state, "abandoned");
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
            required_clean_streak: None,
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
            required_clean_streak: None,
            increment: Some(IncrementRule { clean_needed, bpm_step: step }),
            variants: vec![],
            focus: "tempo".into(),
            use_metronome,
        }
    }

    /// A block with the given non-`tempo` focus, carrying a ladder that WOULD step
    /// on the first clean rep were it a tempo block — proving the focus gate, not a
    /// missing ladder, is what holds the BPM. A target is deliberately absent:
    /// mastery targets are meaningful only for tempo-focus contracts.
    fn open_args_focus(focus: &str) -> RepOpenArgs {
        RepOpenArgs {
            piece_id: 1,
            region_id: None,
            m_start: 1,
            m_end: 8,
            label: None,
            start_bpm: 40.0,
            target_bpm: None,
            planned_reps: Some(30),
            required_clean_streak: None,
            increment: Some(IncrementRule { clean_needed: 1, bpm_step: 4.0 }),
            variants: vec![],
            focus: focus.into(),
            use_metronome: true,
        }
    }

    fn strict_notes_args(piece_id: i64, required: u32) -> RepOpenArgs {
        RepOpenArgs {
            piece_id,
            region_id: None,
            m_start: 1,
            m_end: 8,
            label: Some("strict ledger".into()),
            start_bpm: 0.0,
            target_bpm: None,
            planned_reps: None,
            required_clean_streak: Some(required),
            increment: None,
            variants: vec![],
            focus: "notes".into(),
            use_metronome: false,
        }
    }

    #[test]
    fn ladder_advances_with_metronome_off() {
        let (engine, _emit) = engine_with_capture();
        let args = open_args_tempo(/*use_metronome*/ false, /*clean_needed*/ 2, /*step*/ 4.0, /*start*/ 40.0);
        let snap = engine.open(args).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let out = engine.check(RepVerdict::Clean, None).unwrap(); // hits the step
        assert_eq!(out.snap.bpm, Some(44.0)); // advanced
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
    fn non_tempo_metronome_block_keeps_factual_bpm_without_climbing() {
        let (engine, _emit) = engine_with_capture();
        let snap = engine.open(open_args_focus("notes")).unwrap();
        let out = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(snap.bpm, Some(40.0));
        assert_eq!(out.snap.bpm, Some(40.0));
        assert_eq!(out.new_bpm, None, "notes focus never climbs the ladder");
        assert_eq!(
            engine.store.test_scalar_i64("SELECT bpm=40 FROM rep").unwrap(),
            1,
            "metronome condition is factual attempt tempo"
        );
        // And no tempo_change was logged for a non-tempo block.
        let evs = engine.store.events_for_piece(snap.piece_id).unwrap();
        assert!(!evs.iter().any(|e| e.kind == "tempo_change"));
        let rep_event = evs.iter().find(|event| event.kind == "rep").unwrap();
        assert_eq!(rep_event.payload["bpm"], 40.0);
    }

    #[test]
    fn metronome_free_non_tempo_block_persists_without_fake_bpm() {
        let (engine, _emit) = engine_with_capture();
        let mut args = open_args_focus("phrasing");
        args.start_bpm = 0.0;
        args.use_metronome = false;
        let snap = engine.open(args).unwrap();
        assert_eq!(snap.bpm, None);
        let checked = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(checked.snap.bpm, None);
        assert_eq!(checked.new_bpm, None);
        let history = engine.store.block_row(snap.block_id).unwrap().unwrap();
        assert_eq!(history.start_bpm, None);
        assert_eq!(history.bpm, None);
        assert_eq!(history.focus, "phrasing");
        assert!(!history.use_metronome);
        assert_eq!(
            engine
                .store
                .test_scalar_i64(&format!(
                    "SELECT bpm=0 FROM rep WHERE block_id={}",
                    snap.block_id
                ))
                .unwrap(),
            1,
            "only the metronome-free condition uses the physical sentinel"
        );
        let rep_event = engine
            .store
            .events_for_piece(snap.piece_id)
            .unwrap()
            .into_iter()
            .find(|event| event.kind == "rep")
            .unwrap();
        assert!(rep_event.payload["bpm"].is_null());
    }

    #[test]
    fn open_resolves_ladder_and_persists() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let snap = engine.open(open_args(pid)).unwrap();
        assert_eq!(snap.piece_title, "Scherzo");
        assert_eq!(snap.bpm, Some(80.0));
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
        assert_eq!(out.say, "Attempt 3 saved — clean. Rung 0 of 3. Up to 84.");
        assert!(!out.block_done);
        let snap = engine.snapshot().unwrap();
        assert_eq!(snap.bpm, Some(84.0));
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
        assert_eq!(snap.cleans_at_step, 0, "an error resets rung progress");
        assert_eq!(snap.current_clean_streak, 0, "an error resets mastery progress");
        assert_eq!(snap.reps_done, 3, "but every attempt is a rep");
        assert_eq!(snap.bpm, Some(80.0), "no step yet");
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
            required_clean_streak: Some(4),
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
        assert_eq!(o1.say, "Attempt 1 saved — clean. Streak 1 of 4.");
        // rep 2 finishes lane 0; the next rep is lane 1 → announce it.
        let o2 = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(o2.say, "Attempt 2 saved — clean. Streak 2 of 4.");
        assert_eq!(o2.snap.variant.as_deref(), Some("hands together"));
        let o3 = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(o3.say, "Attempt 3 saved — clean. Streak 3 of 4.");
        let o4 = engine.check(RepVerdict::Clean, None).unwrap();
        assert!(o4.block_done);
        assert_eq!(o4.say, "Mastery earned: 4 clean in a row.");
    }

    #[test]
    fn close_marks_done_when_planned_met_else_abandoned() {
        let (engine, pid, store, _rec) = engine_with_piece();
        // planned 2, no target: two reps then done.
        let args = RepOpenArgs {
            planned_reps: Some(2),
            required_clean_streak: Some(2),
            target_bpm: None,
            ..open_args(pid)
        };
        engine.open(args).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let closed = engine.close().unwrap().unwrap();
        assert_eq!(closed.status, "done");
        assert!(!engine.active(), "no block open after close");
        assert_eq!(store.block_history(pid).unwrap()[0].status, "done");

        // A block closed before meeting the plan is abandoned.
        engine.open(open_args(pid)).unwrap(); // planned 30
        engine.check(RepVerdict::Clean, None).unwrap();
        let closed = engine.close().unwrap().unwrap();
        assert_eq!(closed.status, "abandoned");
        assert!(engine.close().unwrap().is_none(), "nothing to close now");
    }

    #[test]
    fn editing_active_block_is_rejected_without_mutating_or_reemitting() {
        use crate::store::model::BlockPatch;

        let (engine, pid, _store, rec) = engine_with_piece();
        let snap = engine.open(open_args(pid)).unwrap();
        let events_before = rec.events.lock().unwrap().len();
        let error = engine
            .store
            .block_update(
                snap.block_id,
                BlockPatch {
                    label: Some(Some("legato".into())),
                    target_bpm: Some(Some(120.0)),
                    ..Default::default()
                },
            )
            .unwrap_err()
            .to_string();
        assert!(error.contains("immutable"), "{error}");
        assert_eq!(rec.events.lock().unwrap().len(), events_before);
        assert_eq!(engine.snapshot().unwrap(), snap);
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
        let (engine, pid, _store, _rec) = engine_with_piece();
        let snap = engine.open(open_args(pid)).unwrap(); // 80→120/30 auto: step +4 every 3 cleans
        // Climb the ladder past the start: 3 clean reps steps 80 → 84.
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let out = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(out.new_bpm, Some(84.0), "3 cleans should step the ladder");
        assert_eq!(engine.snapshot().unwrap().bpm, Some(84.0), "working tempo stepped");

        // Reprojection from the immutable contract + effective attempts must
        // preserve the derived rung; it may never fall back to the start BPM.
        engine.resync_active_if(snap.block_id);
        assert_eq!(
            engine.snapshot().unwrap().bpm,
            Some(84.0),
            "working tempo preserved across resync"
        );
        assert_eq!(engine.snapshot().unwrap().label, None);
    }

    #[test]
    fn resync_evicts_the_active_block_when_its_row_is_gone() {
        let (engine, pid, store, rec) = engine_with_piece();
        let snap = engine.open(open_args(pid)).unwrap();
        assert!(engine.active());

        // Simulate external database loss. The public block_delete command now
        // protects native v2 ledgers; resync still fails closed if the row is
        // missing for any other reason.
        store
            .test_execute_batch(&format!("DELETE FROM rep_block WHERE id={}", snap.block_id))
            .unwrap();
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
    fn resync_preserves_the_immutable_contract_rule() {
        let (engine, pid, _store, _rec) = engine_with_piece();
        let snap = engine.open(open_args(pid)).unwrap();
        let captured_rule = snap.rule.clone();
        engine.resync_active_if(snap.block_id);
        assert_eq!(engine.snapshot().unwrap().rule, captured_rule);
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

    #[test]
    fn strict_mastery_resets_then_requires_five_following_cleans() {
        let (engine, pid, _store, _rec) = engine_with_piece();
        engine.open(strict_notes_args(pid, 5)).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let failed = engine.check(RepVerdict::Failed, Some("missed landing".into())).unwrap();
        assert_eq!(failed.snap.current_clean_streak, 0);
        assert_eq!(failed.snap.best_clean_streak, 2);
        assert_eq!(failed.snap.reset_count, 1);
        assert_eq!(failed.snap.mastery_status, "not_satisfied");
        for index in 1..=5 {
            let outcome = engine.check(RepVerdict::Clean, None).unwrap();
            assert_eq!(outcome.snap.current_clean_streak, index);
            assert_eq!(outcome.block_done, index == 5);
        }
        let mastered = engine.snapshot().unwrap();
        assert_eq!(mastered.tries, 8);
        assert_eq!(mastered.mastery_status, "satisfied");
        assert!(mastered.mastery_verified);
        assert_eq!(mastered.set_state, "mastered");
    }

    #[test]
    fn failures_and_accuracy_are_attempt_evidence_not_completion() {
        let (engine, pid, _store, _rec) = engine_with_piece();
        let mut args = strict_notes_args(pid, 20);
        args.planned_reps = Some(10); // review boundary only
        engine.open(args).unwrap();
        for _ in 0..10 {
            engine.check(RepVerdict::Failed, None).unwrap();
        }
        let failed = engine.snapshot().unwrap();
        assert_eq!(failed.tries, 10);
        assert_eq!(failed.reset_count, 10);
        assert_eq!(failed.accuracy, Some(0.0));
        assert!(failed.review_boundary_reached);
        assert_eq!(failed.mastery_status, "not_satisfied");

        engine.close().unwrap();
        engine.open(strict_notes_args(pid, 20)).unwrap();
        for _ in 0..5 {
            engine.check(RepVerdict::Clean, None).unwrap();
            engine.check(RepVerdict::Failed, None).unwrap();
        }
        let half = engine.snapshot().unwrap();
        assert_eq!(half.accuracy, Some(0.5));
        assert_eq!(half.verdicts, VerdictCounts { clean: 5, flawed: 0, failed: 5 });
        assert_eq!(half.mastery_status, "not_satisfied");
    }

    #[test]
    fn setting_snapshots_five_without_reusing_legacy_default_reps() {
        let (engine, pid, store, _rec) = engine_with_piece();
        store.set_setting("rep.default_reps", "99").unwrap();
        store
            .set_setting("practice.default_clean_streak", "7")
            .unwrap();
        let mut args = strict_notes_args(pid, 5);
        args.required_clean_streak = None;
        let snapshot = engine.open(args).unwrap();
        assert_eq!(snapshot.required_clean_streak, 7);
        assert_eq!(snapshot.planned_reps, 7);
        assert_eq!(
            store
                .test_scalar_i64(&format!(
                    "SELECT attempt_ceiling IS NULL FROM set_contract WHERE set_id={}",
                    snapshot.block_id
                ))
                .unwrap(),
            1
        );
    }

    #[test]
    fn tempo_mastery_requires_full_streak_at_target_condition() {
        let (engine, pid, _store, _rec) = engine_with_piece();
        let args = RepOpenArgs {
            piece_id: pid,
            region_id: None,
            m_start: 1,
            m_end: 4,
            label: None,
            start_bpm: 60.0,
            target_bpm: Some(64.0),
            planned_reps: None,
            required_clean_streak: Some(2),
            increment: Some(IncrementRule { clean_needed: 1, bpm_step: 4.0 }),
            variants: vec![],
            focus: "tempo".into(),
            use_metronome: false,
        };
        engine.open(args).unwrap();
        let reach = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(reach.new_bpm, Some(64.0));
        assert_eq!(reach.snap.current_clean_streak, 0);
        assert!(!reach.block_done);
        assert!(!engine.check(RepVerdict::Clean, None).unwrap().block_done);
        let mastered = engine.check(RepVerdict::Clean, None).unwrap();
        assert!(mastered.block_done);
        assert_eq!(mastered.snap.current_clean_streak, 2);
        assert_eq!(mastered.snap.bpm, Some(64.0));
    }

    #[test]
    fn tempo_mastery_accepts_overshoot_and_never_steps_down_to_target() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let opened = engine
            .open(RepOpenArgs {
                piece_id: pid,
                region_id: None,
                m_start: 1,
                m_end: 4,
                label: None,
                start_bpm: 60.0,
                target_bpm: Some(64.0),
                planned_reps: None,
                required_clean_streak: Some(2),
                increment: Some(IncrementRule { clean_needed: 10, bpm_step: 4.0 }),
                variants: vec![],
                focus: "tempo".into(),
                use_metronome: true,
            })
            .unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        store
            .test_execute_batch(&format!(
                "UPDATE rep SET bpm=66 WHERE block_id={}",
                opened.block_id
            ))
            .unwrap();
        engine.resync_active_if(opened.block_id);
        let projected = engine.snapshot().unwrap();
        assert_eq!(projected.bpm, Some(66.0));
        assert_eq!(projected.mastery_progress_streak, 2);
        assert_eq!(projected.mastery_status, "satisfied");

        let outcome = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(outcome.snap.bpm, Some(66.0));
        assert_eq!(outcome.new_bpm, None, "an overshoot must never step down to target");
        assert!(outcome.block_done, "clean work above target is target-eligible");
    }

    #[test]
    fn sub_target_speech_reports_rung_not_a_false_mastery_fraction() {
        let (engine, pid, _store, _rec) = engine_with_piece();
        engine
            .open(RepOpenArgs {
                piece_id: pid,
                region_id: None,
                m_start: 1,
                m_end: 4,
                label: None,
                start_bpm: 60.0,
                target_bpm: Some(68.0),
                planned_reps: None,
                required_clean_streak: Some(3),
                increment: Some(IncrementRule { clean_needed: 5, bpm_step: 4.0 }),
                variants: vec![],
                focus: "tempo".into(),
                use_metronome: false,
            })
            .unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let third = engine.check(RepVerdict::Clean, None).unwrap();
        assert_eq!(third.say, "Attempt 3 saved — clean. Rung 3 of 5.");
        assert_eq!(third.snap.current_clean_streak, 3);
        assert_eq!(third.snap.mastery_progress_streak, 0);
        assert_eq!(third.snap.mastery_status, "not_satisfied");
        assert!(!third.block_done);
    }

    #[test]
    fn undo_correction_and_reversal_are_append_only() {
        let (engine, pid, store, _rec) = engine_with_piece();
        engine.open(strict_notes_args(pid, 3)).unwrap();
        let original = engine
            .check(RepVerdict::Failed, Some("old note".into()))
            .unwrap();
        let attempt_id = original.snap.last_attempt_id.unwrap();
        let corrected = engine
            .correct(
                Some(attempt_id),
                RepVerdict::Clean,
                Some("new note".into()),
                true,
            )
            .unwrap();
        assert_eq!(corrected.snap.verdicts.clean, 1);
        let correction_id = corrected.snap.last_adjustment_id.unwrap();
        assert_eq!(
            store
                .test_scalar_string(&format!("SELECT verdict FROM rep WHERE id={attempt_id}"))
                .unwrap(),
            "failed",
            "physical attempt is immutable"
        );
        let reverted = engine.reverse_adjustment(correction_id).unwrap();
        assert_eq!(reverted.snap.verdicts.failed, 1);
        let reversal_id = reverted.snap.last_adjustment_id.unwrap();
        let restored_correction = engine.reverse_adjustment(reversal_id).unwrap();
        assert_eq!(restored_correction.snap.verdicts.clean, 1);

        let undone = engine.undo().unwrap();
        assert_eq!(undone.snap.tries, 0);
        assert_eq!(undone.snap.attempts_recorded, 1);
        assert_eq!(undone.snap.voided_attempts, 1);
        let void_id = undone.snap.last_adjustment_id.unwrap();
        let restored = engine.reverse_adjustment(void_id).unwrap();
        assert_eq!(restored.snap.tries, 1);
        assert_eq!(restored.snap.verdicts.clean, 1);
        assert_eq!(store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(), 1);
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM attempt_adjustment")
                .unwrap(),
            5
        );
    }

    #[test]
    fn correction_note_patch_is_true_tristate_and_reverses_exactly() {
        let (engine, pid, store, _rec) = engine_with_piece();
        engine.open(strict_notes_args(pid, 5)).unwrap();
        let original = engine
            .check(RepVerdict::Failed, Some("missed landing".into()))
            .unwrap();
        let attempt_id = original.snap.last_attempt_id.unwrap();

        let verdict_only = engine
            .correct(Some(attempt_id), RepVerdict::Clean, None, false)
            .unwrap();
        assert_eq!(verdict_only.snap.last.as_ref().unwrap().verdict, "clean");
        assert_eq!(
            verdict_only.snap.last.as_ref().unwrap().note.as_deref(),
            Some("missed landing"),
            "omitting note preserves it"
        );
        let verdict_adjustment = verdict_only.snap.last_adjustment_id.unwrap();
        let original_again = engine.reverse_adjustment(verdict_adjustment).unwrap();
        assert_eq!(original_again.snap.last.as_ref().unwrap().verdict, "failed");
        assert_eq!(
            original_again.snap.last.as_ref().unwrap().note.as_deref(),
            Some("missed landing")
        );

        let cleared = engine
            .correct(Some(attempt_id), RepVerdict::Clean, None, true)
            .unwrap();
        assert_eq!(cleared.snap.last.as_ref().unwrap().verdict, "clean");
        assert_eq!(cleared.snap.last.as_ref().unwrap().note, None, "explicit null clears");
        let clear_adjustment = cleared.snap.last_adjustment_id.unwrap();
        let restored = engine.reverse_adjustment(clear_adjustment).unwrap();
        assert_eq!(restored.snap.last.as_ref().unwrap().verdict, "failed");
        assert_eq!(
            restored.snap.last.as_ref().unwrap().note.as_deref(),
            Some("missed landing"),
            "reversal restores the exact prior verdict and note"
        );
        assert_eq!(
            store
                .test_scalar_string(&format!("SELECT verdict||':'||note FROM rep WHERE id={attempt_id}"))
                .unwrap(),
            "failed:missed landing",
            "source attempt never changes"
        );
    }

    #[test]
    fn effective_adjustments_retune_both_directions_and_survive_relaunch() {
        let (engine, pid, store, _rec) = engine_with_piece();
        engine
            .open(RepOpenArgs {
                piece_id: pid,
                region_id: None,
                m_start: 1,
                m_end: 8,
                label: None,
                start_bpm: 80.0,
                target_bpm: Some(92.0),
                planned_reps: None,
                required_clean_streak: Some(8),
                increment: Some(IncrementRule { clean_needed: 3, bpm_step: 4.0 }),
                variants: vec![],
                focus: "tempo".into(),
                use_metronome: true,
            })
            .unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let stepped = engine.check(RepVerdict::Clean, None).unwrap();
        let third_attempt = stepped.snap.last_attempt_id.unwrap();
        assert_eq!(stepped.new_bpm, Some(84.0));
        assert_eq!(stepped.snap.bpm, Some(84.0));

        // If the audit append fails, adjustment + projection + memory all stay
        // at the prior committed rung.
        store
            .test_execute_batch(
                "CREATE TRIGGER fail_adjustment_tempo BEFORE INSERT ON event
                 WHEN NEW.kind='tempo_change'
                 BEGIN SELECT RAISE(ABORT,'injected adjustment tempo failure'); END;",
            )
            .unwrap();
        assert!(engine.undo().is_err());
        assert_eq!(engine.snapshot().unwrap().bpm, Some(84.0));
        assert_eq!(engine.snapshot().unwrap().tries, 3);
        assert_eq!(store.test_scalar_i64("SELECT count(*) FROM attempt_adjustment").unwrap(), 0);
        store
            .test_execute_batch("DROP TRIGGER fail_adjustment_tempo;")
            .unwrap();

        let undone = engine.undo().unwrap();
        assert_eq!(undone.new_bpm, Some(80.0));
        assert_eq!(undone.snap.bpm, Some(80.0));
        let void_id = undone.snap.last_adjustment_id.unwrap();

        let relaunched = RepEngine::new(
            store.clone(),
            Arc::new(SessionService::new(store.clone())),
        );
        assert_eq!(relaunched.snapshot().unwrap().bpm, Some(80.0));
        let restored_step = relaunched.reverse_adjustment(void_id).unwrap();
        assert_eq!(restored_step.new_bpm, Some(84.0));
        assert_eq!(restored_step.snap.bpm, Some(84.0));

        let relaunched_again = RepEngine::new(
            store.clone(),
            Arc::new(SessionService::new(store.clone())),
        );
        assert_eq!(relaunched_again.snapshot().unwrap().bpm, Some(84.0));
        let corrected = relaunched_again
            .correct(Some(third_attempt), RepVerdict::Failed, None, false)
            .unwrap();
        assert_eq!(corrected.new_bpm, Some(80.0));
        assert_eq!(corrected.snap.bpm, Some(80.0));
        let correction_id = corrected.snap.last_adjustment_id.unwrap();
        let correction_reversed = relaunched_again.reverse_adjustment(correction_id).unwrap();
        assert_eq!(correction_reversed.new_bpm, Some(84.0));
        assert_eq!(correction_reversed.snap.bpm, Some(84.0));

        let tempo_events = store
            .events_for_piece(pid)
            .unwrap()
            .into_iter()
            .filter(|event| event.kind == "tempo_change")
            .collect::<Vec<_>>();
        let destinations = tempo_events
            .iter()
            .map(|event| event.payload["to_bpm"].as_f64().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(destinations, vec![84.0, 80.0, 84.0, 80.0, 84.0]);
        assert_eq!(tempo_events[0].payload["reason"], "effective_ladder_step");
        assert!(tempo_events[1..]
            .iter()
            .all(|event| event.payload["reason"] == "effective_attempt_adjustment"));
    }

    #[test]
    fn native_v2_block_cascade_cannot_erase_attempts() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let opened = engine.open(strict_notes_args(pid, 5)).unwrap();
        engine.check(RepVerdict::Failed, None).unwrap();
        assert!(store.block_delete(opened.block_id).is_err());
        assert_eq!(store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(), 1);
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM attempt_provenance")
                .unwrap(),
            1
        );
        assert_eq!(engine.snapshot().unwrap().tries, 1);
    }

    #[test]
    fn restart_is_atomic_lineage_and_relaunch_restores_exact_state() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let old = engine.open(strict_notes_args(pid, 5)).unwrap();
        engine.check(RepVerdict::Clean, None).unwrap();
        let restarted = engine.restart(Some(3)).unwrap();
        assert_ne!(restarted.block_id, old.block_id);
        assert_eq!(restarted.required_clean_streak, 3);
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={}",
                    old.block_id
                ))
                .unwrap(),
            "restarted"
        );
        assert_eq!(
            store
                .test_scalar_i64(&format!(
                    "SELECT restart_of_set_id FROM set_contract WHERE set_id={}",
                    restarted.block_id
                ))
                .unwrap(),
            old.block_id
        );
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.check(RepVerdict::Flawed, Some("uneven".into())).unwrap();

        let sessions = Arc::new(SessionService::new(store.clone()));
        let relaunched = RepEngine::new(store, sessions);
        let restored = relaunched.snapshot().expect("active set restored");
        assert_eq!(restored.block_id, restarted.block_id);
        assert_eq!(restored.tries, 2);
        assert_eq!(restored.verdicts.clean, 1);
        assert_eq!(restored.verdicts.flawed, 1);
        assert_eq!(restored.current_clean_streak, 0);
        assert_eq!(restored.reset_count, 1);
        assert_eq!(restored.last.as_ref().unwrap().note.as_deref(), Some("uneven"));
    }

    #[test]
    fn restarted_set_keeps_terminal_lineage_through_history_repairs_and_relaunch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("restarted.db");
        let (engine, pid, store) = engine_with_piece_at(&path);
        let original = engine.open(strict_notes_args(pid, 1)).unwrap();
        let failed = engine.check(RepVerdict::Failed, Some("landing".into())).unwrap();
        let attempt_id = failed.snap.last_attempt_id.unwrap();
        let replacement = engine.restart(Some(1)).unwrap();
        assert_set_lifecycle(&store, original.block_id, "restarted", "abandoned");

        exercise_terminal_history_adjustments(
            &store,
            original.block_id,
            attempt_id,
            "restarted",
        );

        let fresh = Arc::new(Store::open(&path).unwrap());
        assert_set_lifecycle(&fresh, original.block_id, "restarted", "abandoned");
        let relaunched = RepEngine::new(
            fresh.clone(),
            Arc::new(SessionService::new(fresh)),
        );
        assert_eq!(
            relaunched.state().unwrap().unwrap().block_id,
            replacement.block_id,
            "only the linked replacement restores as live"
        );
    }

    #[test]
    fn abandoned_set_keeps_terminal_lineage_through_history_repairs_and_relaunch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("abandoned.db");
        let (engine, pid, store) = engine_with_piece_at(&path);
        let opened = engine.open(strict_notes_args(pid, 1)).unwrap();
        let failed = engine.check(RepVerdict::Failed, Some("landing".into())).unwrap();
        let attempt_id = failed.snap.last_attempt_id.unwrap();
        store
            .test_execute_batch(&format!(
                "UPDATE set_contract SET set_state='abandoned' WHERE set_id={0};
                 UPDATE rep_block SET status='abandoned' WHERE id={0};",
                opened.block_id
            ))
            .unwrap();
        assert_set_lifecycle(&store, opened.block_id, "abandoned", "abandoned");

        exercise_terminal_history_adjustments(
            &store,
            opened.block_id,
            attempt_id,
            "abandoned",
        );

        let fresh = Arc::new(Store::open(&path).unwrap());
        assert_set_lifecycle(&fresh, opened.block_id, "abandoned", "abandoned");
        let relaunched = RepEngine::new(
            fresh.clone(),
            Arc::new(SessionService::new(fresh)),
        );
        assert_eq!(relaunched.state().unwrap(), None);
    }

    #[test]
    fn closed_unresolved_set_stays_closed_through_history_repairs_and_relaunch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("closed-unresolved.db");
        let (engine, pid, store) = engine_with_piece_at(&path);
        let opened = engine.open(strict_notes_args(pid, 1)).unwrap();
        let failed = engine.check(RepVerdict::Failed, Some("landing".into())).unwrap();
        let attempt_id = failed.snap.last_attempt_id.unwrap();
        let closed = engine.close().unwrap().unwrap();
        assert_eq!(closed.set_state, "closed_unresolved");
        assert_set_lifecycle(
            &store,
            opened.block_id,
            "closed_unresolved",
            "abandoned",
        );

        exercise_terminal_history_adjustments(
            &store,
            opened.block_id,
            attempt_id,
            "closed_unresolved",
        );

        let fresh = Arc::new(Store::open(&path).unwrap());
        assert_set_lifecycle(
            &fresh,
            opened.block_id,
            "closed_unresolved",
            "abandoned",
        );
        let relaunched = RepEngine::new(
            fresh.clone(),
            Arc::new(SessionService::new(fresh)),
        );
        assert_eq!(relaunched.state().unwrap(), None);
    }

    #[test]
    fn schema_v9_unique_index_rejects_a_second_live_set_but_ignores_legacy_state() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let original = engine.open(strict_notes_args(pid, 3)).unwrap();
        let replacement = engine.restart(Some(3)).unwrap();
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT count(*) FROM sqlite_master
                     WHERE type='index' AND name='set_contract_one_live_v2_idx'",
                )
                .unwrap(),
            1
        );

        store
            .test_execute_batch(&format!(
                "UPDATE set_contract SET set_state='legacy_open' WHERE set_id={}",
                original.block_id
            ))
            .unwrap();
        let error = store
            .test_execute_batch(&format!(
                "UPDATE set_contract SET set_state='paused' WHERE set_id={}",
                original.block_id
            ))
            .unwrap_err()
            .to_string();
        assert!(error.contains("UNIQUE constraint failed"), "{error}");
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={}",
                    original.block_id
                ))
                .unwrap(),
            "legacy_open",
            "failed transition leaves the ignored legacy state intact"
        );
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={}",
                    replacement.block_id
                ))
                .unwrap(),
            "active"
        );
    }

    #[test]
    fn malformed_two_live_sets_surface_recovery_error_on_state_and_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("malformed-two-live.db");
        let (engine, pid, store) = engine_with_piece_at(&path);
        let original = engine.open(strict_notes_args(pid, 3)).unwrap();
        let _replacement = engine.restart(Some(3)).unwrap();
        store
            .test_execute_batch(&format!(
                "DROP INDEX set_contract_one_live_v2_idx;
                 UPDATE set_contract SET set_state='active' WHERE set_id={0};
                 UPDATE rep_block SET status='open' WHERE id={0};",
                original.block_id
            ))
            .unwrap();
        let rows_before = store.test_scalar_i64("SELECT count(*) FROM rep_block").unwrap();
        drop(engine);
        drop(store);

        let reopened = Arc::new(Store::open(&path).unwrap());
        let sessions = Arc::new(SessionService::new(reopened.clone()));
        let malformed = RepEngine::new(reopened.clone(), sessions);
        let state_error = malformed.state().unwrap_err();
        assert!(state_error.contains("multiple active practice sets"), "{state_error}");
        let open_error = malformed.open(strict_notes_args(pid, 3)).unwrap_err();
        assert_eq!(open_error, state_error);
        assert_eq!(
            reopened.test_scalar_i64("SELECT count(*) FROM rep_block").unwrap(),
            rows_before,
            "recovery error must not masquerade as empty state and open a third set"
        );
    }

    #[test]
    fn legacy_zero_bpm_notes_project_as_tempo_none_without_rewriting_rows() {
        let (_engine, pid, store, _rec) = engine_with_piece();
        let block_id = store
            .insert_rep_block(
                pid,
                1,
                4,
                None,
                None,
                None,
                &IncrementRule { clean_needed: 3, bpm_step: 4.0 },
                5,
                &[],
                "notes",
                false,
            )
            .unwrap();
        store
            .insert_rep(block_id, 0.0, None, "clean", Some("legacy notes"))
            .unwrap();
        let snapshot = store.v2_snapshot(block_id).unwrap();
        assert_eq!(snapshot.mastery_status, "unverified_legacy");
        assert_eq!(snapshot.tries, 1);
        assert_eq!(snapshot.last.as_ref().unwrap().bpm, None);
        assert_eq!(
            store
                .test_scalar_i64(&format!("SELECT bpm=0 FROM rep WHERE block_id={block_id}"))
                .unwrap(),
            1,
            "legacy row remains byte-semantically unchanged"
        );
    }

    #[test]
    fn negative_non_tempo_physical_bpm_is_a_projection_error() {
        let (_engine, pid, store, _rec) = engine_with_piece();
        let block_id = store
            .insert_rep_block(
                pid,
                1,
                4,
                None,
                None,
                None,
                &IncrementRule { clean_needed: 3, bpm_step: 4.0 },
                5,
                &[],
                "notes",
                false,
            )
            .unwrap();
        store.insert_rep(block_id, -1.0, None, "clean", None).unwrap();
        let error = store.v2_snapshot(block_id).unwrap_err().to_string();
        assert!(error.contains("invalid physical BPM -1"), "{error}");
        assert_eq!(
            store
                .test_scalar_i64(&format!("SELECT bpm=-1 FROM rep WHERE block_id={block_id}"))
                .unwrap(),
            1,
            "corrupt source evidence is surfaced, never rewritten"
        );
    }

    #[test]
    fn metronome_on_zero_physical_bpm_is_a_projection_error() {
        let (_engine, pid, store, _rec) = engine_with_piece();
        let block_id = store
            .insert_rep_block(
                pid,
                1,
                4,
                None,
                Some(60.0),
                None,
                &IncrementRule { clean_needed: 3, bpm_step: 4.0 },
                5,
                &[],
                "notes",
                true,
            )
            .unwrap();
        store.insert_rep(block_id, 0.0, None, "clean", None).unwrap();
        let error = store.v2_snapshot(block_id).unwrap_err().to_string();
        assert!(error.contains("invalid physical BPM 0"), "{error}");
    }

    #[test]
    fn tempo_focus_zero_physical_bpm_is_a_projection_error() {
        let (_engine, pid, store, _rec) = engine_with_piece();
        let block_id = store
            .insert_rep_block(
                pid,
                1,
                4,
                None,
                Some(60.0),
                Some(80.0),
                &IncrementRule { clean_needed: 3, bpm_step: 4.0 },
                5,
                &[],
                "tempo",
                true,
            )
            .unwrap();
        store.insert_rep(block_id, 0.0, None, "clean", None).unwrap();
        let error = store.v2_snapshot(block_id).unwrap_err().to_string();
        assert!(error.contains("invalid physical BPM 0"), "{error}");
    }

    #[test]
    fn legacy_tempo_evidence_never_becomes_verified_mastery() {
        let (_engine, pid, store, _rec) = engine_with_piece();
        let block_id = store
            .insert_rep_block(
                pid,
                1,
                4,
                None,
                Some(60.0),
                Some(60.0),
                &IncrementRule { clean_needed: 1, bpm_step: 4.0 },
                3,
                &[],
                "tempo",
                true,
            )
            .unwrap();
        for _ in 0..3 {
            store.insert_rep(block_id, 60.0, None, "clean", None).unwrap();
        }

        let history = store.block_row(block_id).unwrap().unwrap();
        assert_eq!(history.bpm, Some(60.0), "factual legacy tempo remains visible");
        assert_eq!(history.contract_source, "migration_legacy");
        assert_eq!(history.mastery_status, "unverified_legacy");
        assert!(!history.mastery_verified);
        assert_eq!(history.set_state, "legacy_open");
    }

    #[test]
    fn malformed_new_set_inputs_reject_without_any_rows() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let base = open_args(pid);
        let mut invalid = Vec::new();

        let mut value = base.clone();
        value.start_bpm = 0.0;
        invalid.push(value);
        let mut value = base.clone();
        value.focus = "notes".into();
        value.start_bpm = 0.0;
        value.use_metronome = true;
        invalid.push(value);
        let mut value = base.clone();
        value.target_bpm = Some(0.0);
        invalid.push(value);
        let mut value = base.clone();
        value.target_bpm = Some(79.0);
        invalid.push(value);
        let mut value = base.clone();
        value.target_bpm = Some(f64::NAN);
        invalid.push(value);
        let mut value = base.clone();
        value.required_clean_streak = Some(0);
        invalid.push(value);
        let mut value = base.clone();
        value.required_clean_streak = Some(101);
        invalid.push(value);
        let mut value = base.clone();
        value.focus = "notes".into();
        value.target_bpm = Some(120.0);
        invalid.push(value);
        let mut value = base.clone();
        value.increment = Some(IncrementRule { clean_needed: 0, bpm_step: 4.0 });
        invalid.push(value);
        let mut value = base.clone();
        value.increment = Some(IncrementRule { clean_needed: 3, bpm_step: 0.0 });
        invalid.push(value);
        let mut value = base.clone();
        value.increment = Some(IncrementRule { clean_needed: 3, bpm_step: f64::NAN });
        invalid.push(value);
        let mut value = base.clone();
        value.planned_reps = Some(0);
        invalid.push(value);
        let mut value = base.clone();
        value.variants = vec![VariantSpec { name: " ".into(), reps: 1 }];
        invalid.push(value);
        let mut value = base;
        value.variants = vec![VariantSpec { name: "hands".into(), reps: 0 }];
        invalid.push(value);

        for args in invalid {
            assert!(engine.open(args).is_err());
        }
        assert_eq!(store.test_scalar_i64("SELECT count(*) FROM rep_block").unwrap(), 0);
        assert_eq!(store.test_scalar_i64("SELECT count(*) FROM set_contract").unwrap(), 0);
        assert_eq!(store.test_scalar_i64("SELECT count(*) FROM event").unwrap(), 0);
    }

    #[test]
    fn attempt_transaction_rolls_back_every_row_and_memory_on_failure() {
        let (engine, pid, store, _rec) = engine_with_piece();
        engine.open(strict_notes_args(pid, 5)).unwrap();
        store
            .test_execute_batch(
                "CREATE TRIGGER fail_attempt_provenance BEFORE INSERT ON attempt_provenance
                 BEGIN SELECT RAISE(ABORT,'injected provenance failure'); END;",
            )
            .unwrap();
        assert!(engine.check(RepVerdict::Clean, None).is_err());
        assert_eq!(engine.snapshot().unwrap().tries, 0);
        assert_eq!(store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(), 0);
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM attempt_provenance")
                .unwrap(),
            0
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM event WHERE kind='rep'")
                .unwrap(),
            0
        );
        store
            .test_execute_batch("DROP TRIGGER fail_attempt_provenance;")
            .unwrap();
    }

    #[test]
    fn paused_set_rejects_verdict_writes_until_a_future_resume_command() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let opened = engine.open(strict_notes_args(pid, 5)).unwrap();
        store
            .test_execute_batch(&format!(
                "UPDATE set_contract SET set_state='paused' WHERE set_id={}",
                opened.block_id
            ))
            .unwrap();
        engine.resync_active_if(opened.block_id);
        assert_eq!(engine.snapshot().unwrap().set_state, "paused");
        assert!(engine.check(RepVerdict::Clean, None).is_err());
        assert_eq!(store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(), 0);
        assert_eq!(engine.snapshot().unwrap().tries, 0);
    }

    #[test]
    fn correction_on_a_paused_set_does_not_silently_resume_it() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let opened = engine.open(strict_notes_args(pid, 5)).unwrap();
        let attempt = engine
            .check(RepVerdict::Failed, Some("landing".into()))
            .unwrap();
        let attempt_id = attempt.snap.last_attempt_id.unwrap();
        store
            .test_execute_batch(&format!(
                "UPDATE set_contract SET set_state='paused' WHERE set_id={}",
                opened.block_id
            ))
            .unwrap();
        engine.resync_active_if(opened.block_id);

        let corrected = engine
            .correct(Some(attempt_id), RepVerdict::Clean, None, false)
            .unwrap();
        assert_eq!(corrected.snap.set_state, "paused");
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={}",
                    opened.block_id
                ))
                .unwrap(),
            "paused"
        );
    }

    #[test]
    fn close_failure_is_returned_and_does_not_clear_active_state() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let opened = engine.open(strict_notes_args(pid, 5)).unwrap();
        store
            .test_execute_batch(
                "CREATE TRIGGER fail_v2_close BEFORE UPDATE OF set_state ON set_contract
                 BEGIN SELECT RAISE(ABORT,'injected close failure'); END;",
            )
            .unwrap();
        assert!(engine.close().is_err());
        assert!(engine.active());
        assert_eq!(engine.snapshot().unwrap().block_id, opened.block_id);
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={}",
                    opened.block_id
                ))
                .unwrap(),
            "active"
        );
        store.test_execute_batch("DROP TRIGGER fail_v2_close;").unwrap();
        assert!(engine.close().unwrap().is_some());
    }

    #[test]
    fn voice_hot_loop_source_and_command_identity_are_durable() {
        let (engine, pid, store, _rec) = engine_with_piece();
        engine.open_voice(strict_notes_args(pid, 5)).unwrap();
        engine.check_voice(RepVerdict::Clean, None).unwrap();
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT count(*) FROM attempt_provenance
                     WHERE source='voice_hot_loop' AND command_id IS NOT NULL
                       AND canonical_event_id IS NOT NULL",
                )
                .unwrap(),
            1
        );
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT count(*) FROM event WHERE source='voice_hot_loop'
                     AND command_id IS NOT NULL AND entity_type IN ('set','attempt')",
                )
                .unwrap(),
            2
        );
    }
}
