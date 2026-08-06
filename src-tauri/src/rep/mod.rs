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

use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::ledger::MutationSource;
use crate::protocol::PracticeContract;
use crate::sessions::{RolloverPauseHook, SessionService, StateEmitter};
use crate::store::model::{
    CheckOutcome, ExportResult, MutationReceipt, PausedSetRow, RecoveryActionRequest, RepOpenArgs,
    RepSnapshot, RetentionCheckView, RetentionResult, SetFocusContextInput,
};
use crate::store::{
    v2_command_id, v2_validate_open, EventKind, SessionPlanStartOutcome, SessionPlanStartPayload,
    Store,
};

pub(crate) trait PracticeClock: Send + Sync {
    fn now(&self, store: &Store) -> Result<String, String>;
}

struct StorePracticeClock;

impl PracticeClock for StorePracticeClock {
    fn now(&self, store: &Store) -> Result<String, String> {
        store.now_rfc3339().map_err(|error| error.to_string())
    }
}

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
    clock: Arc<dyn PracticeClock>,
}

impl RepEngine {
    pub fn new(store: Arc<Store>, sessions: Arc<SessionService>) -> Self {
        Self::new_with_clock(store, sessions, Arc::new(StorePracticeClock))
    }

    pub(crate) fn new_with_clock(
        store: Arc<Store>,
        sessions: Arc<SessionService>,
        clock: Arc<dyn PracticeClock>,
    ) -> Self {
        let restored_result = clock
            .now(&store)
            .map_err(rusqlite::Error::InvalidParameterName)
            .and_then(|now| store.v2_restore_active_at(&now));
        let (restored, restore_error) = match restored_result {
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
            clock,
        }
    }

    fn now(&self) -> Result<String, String> {
        self.clock.now(&self.store)
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
        self.active.lock().map(|g| g.is_some()).unwrap_or(false)
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

    /// Task A4: every currently-paused set, independent of which one (if any)
    /// this engine instance holds as its own live block.
    pub fn paused_sets_list(&self) -> Result<Vec<PausedSetRow>, String> {
        self.store
            .paused_sets_list()
            .map_err(|error| error.to_string())
    }

    /// Open a rep block. Rejects opening while one is already active (the caller
    /// must close it first — this keeps a mis-heard "open a tracker" from silently
    /// abandoning a block mid-practice). Resolves an "auto" ladder to concrete
    /// numbers, persists the block, and emits/logs the fresh snapshot.
    pub fn open(&self, args: RepOpenArgs) -> Result<RepSnapshot, String> {
        self.open_from(args, None, MutationSource::UserClick)
    }

    pub fn open_with_context(
        &self,
        args: RepOpenArgs,
        context: Option<SetFocusContextInput>,
    ) -> Result<RepSnapshot, String> {
        self.open_from(args, context, MutationSource::UserClick)
    }

    pub fn open_voice(&self, args: RepOpenArgs) -> Result<RepSnapshot, String> {
        self.open_from(args, None, MutationSource::VoiceHotLoop)
    }

    fn open_from(
        &self,
        args: RepOpenArgs,
        context: Option<SetFocusContextInput>,
        source: MutationSource,
    ) -> Result<RepSnapshot, String> {
        if let Some(error) = &self.restore_error {
            return Err(error.clone());
        }
        // Quick peek, no side effects: reject immediately if a block is
        // already active (mirrors the original early-out). Re-checked below
        // after the guard is retaken, since it must be dropped before
        // resolving the session — see the comment there.
        //
        // Task A4b: this only blocks on a genuinely ACTIVE tracked block, not
        // a paused one — the one-ACTIVE-set invariant
        // (`set_contract_one_active_v2_idx`, SCHEMA_V14) permits opening a
        // fresh set while this engine's own tracked block sits paused; that
        // paused block stays exactly as it is (discoverable via
        // `paused_sets_list`), and `self.active` simply moves its focus to
        // the newly opened block. Matches `open_set_in_tx`'s own DB-level
        // check.
        {
            let active = self.active.lock().unwrap_or_else(|p| p.into_inner());
            if active
                .as_ref()
                .is_some_and(|snap| snap.set_state == "active")
            {
                return Err("close the current block first".to_string());
            }
        }

        self.store
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

        // Only after validation passes do we touch the session — preserves
        // "an invalid open touches zero rows" — and only while `self.active`
        // is NOT held: the day-rollover boundary may need to pause whatever
        // set is active, which locks `self.active` itself (see
        // `pause_for_rollover`); holding it here first would deadlock (task
        // A5 fix round 1, CRITICAL 2).
        let session_hint = Some(self.sessions.ensure_session()?);
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        if active
            .as_ref()
            .is_some_and(|snap| snap.set_state == "active")
        {
            return Err("close the current block first".to_string());
        }

        let command_id = v2_command_id(source, "open");
        let now = self.now()?;
        let opened = self
            .store
            .v2_open_set(
                session_hint,
                &args,
                &rule,
                planned,
                &contract,
                context.as_ref(),
                source,
                &command_id,
                &now,
            )
            .map_err(|e| e.to_string())?;
        let snap = opened.snapshot;
        *active = Some(snap.clone());
        // `adopt_committed_practice_session` locks `sessions.current` — moved
        // here, AFTER `drop(active)` (fix round 2: a rollover on another
        // thread holds `current` while it locks `active` via the pause hook;
        // holding `active` while THIS thread locks `current` would be the
        // reverse order, an ABBA deadlock between the two threads).
        drop(active);
        self.sessions
            .adopt_committed_practice_session(opened.session_id);
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
    pub fn check(&self, verdict: RepVerdict, note: Option<String>) -> Result<CheckOutcome, String> {
        self.check_from(verdict, note, MutationSource::UserClick, None)
    }

    pub fn check_voice(
        &self,
        verdict: RepVerdict,
        note: Option<String>,
    ) -> Result<CheckOutcome, String> {
        self.check_from(verdict, note, MutationSource::VoiceHotLoop, None)
    }

    pub fn check_idempotent(
        &self,
        command_id: &str,
        verdict: RepVerdict,
        note: Option<String>,
    ) -> Result<CheckOutcome, String> {
        self.check_from(verdict, note, MutationSource::UserClick, Some(command_id))
    }

    fn check_from(
        &self,
        verdict: RepVerdict,
        note: Option<String>,
        source: MutationSource,
        command_id_override: Option<&str>,
    ) -> Result<CheckOutcome, String> {
        // Quick peek, no side effects (fix round 2, N1): a failing check
        // with nothing active must never mint/roll a session — see
        // `open_from`.
        {
            let active = self.active.lock().unwrap_or_else(|p| p.into_inner());
            if active.is_none() {
                return Err("no active rep block".to_string());
            }
        }
        // Resolved BEFORE the active-set guard is retaken — see `open_from`
        // (same deadlock hazard: the day-rollover pause locks `self.active`
        // too).
        let session_hint = Some(self.sessions.ensure_session()?);
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let snap = active
            .as_ref()
            .ok_or_else(|| "no active rep block".to_string())?;
        let cur_lane = ladder::variant_index_for_rep(&snap.variants, snap.tries + 1);
        let rep_variant = cur_lane.map(|i| snap.variants[i].name.clone());
        let block_id = snap.block_id;
        let generated_command_id;
        let command_id = if let Some(command_id) = command_id_override {
            command_id
        } else {
            generated_command_id = v2_command_id(source, "check");
            &generated_command_id
        };
        let now = self.now()?;
        let mutation = self
            .store
            .v2_record_attempt(
                session_hint,
                block_id,
                rep_variant.as_deref(),
                verdict,
                note.as_deref(),
                source,
                command_id,
                &now,
            )
            .map_err(|error| error.to_string())?;
        let mut receipt = mutation.receipt.clone();
        let replayed = receipt.as_ref().is_some_and(|receipt| receipt.replayed);
        let out_snap = if replayed {
            self.store
                .v2_snapshot(block_id)
                .map_err(|error| error.to_string())?
        } else {
            mutation.snapshot
        };
        if replayed {
            if let Some(receipt) = &mut receipt {
                receipt.value = Some(out_snap.clone());
            }
        }
        let new_bpm = mutation.new_bpm;
        let block_done = out_snap.mastery_status == "satisfied";
        let say = compose_v2_say(&out_snap, verdict, new_bpm);
        *active = Some(out_snap.clone());
        // `adopt_committed_practice_session` locks `sessions.current` —
        // moved here, AFTER `drop(active)` (fix round 2: see `open_from`).
        drop(active);
        if let Some(session_id) = receipt.as_ref().and_then(|value| value.session_id) {
            self.sessions.adopt_committed_practice_session(session_id);
        }
        if let Some(feed_id) = mutation.feed_id {
            self.sessions
                .emit_persisted_practice(feed_id, EventKind::REP);
        }
        self.emit_state(Some(&out_snap));

        Ok(CheckOutcome {
            snap: out_snap,
            new_bpm,
            block_done,
            say,
            receipt,
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

    /// End and export the practice session only when no set is live.
    ///
    /// Quick peek, no side effects, guard dropped immediately (fix round 2,
    /// N2): `sessions.end_and_export` acquires `sessions.lifecycle`, and
    /// every practice mutation now takes `lifecycle` → `current` → `active`
    /// (via `ensure_session` → a same-thread rollover pause). Holding
    /// `self.active` here across that call would be the reverse order
    /// (`active` → `lifecycle`) on a DIFFERENT thread — a cross-thread ABBA
    /// deadlock the instant the two interleave (e.g. "End my day"/app-exit
    /// racing a voice rep at a day boundary). `self.active` is never held
    /// across any `SessionService` call anywhere in this file — see the
    /// module-level audit note near the bottom of this impl block.
    pub fn end_session_and_export(
        &self,
        pieces_dir: &Path,
    ) -> Result<Option<ExportResult>, String> {
        {
            let active = self.active.lock().unwrap_or_else(|p| p.into_inner());
            if active.is_some() {
                return Err("Close the current practice set before ending the session.".into());
            }
        }
        Ok(self.sessions.end_and_export(&self.store, pieces_dir))
    }

    fn close_from(&self, source: MutationSource) -> Result<Option<RepSnapshot>, String> {
        // Quick peek, no side effects (fix round 2, N1): a no-op close with
        // nothing active must never mint/roll a session — see `open_from`.
        {
            let active = self.active.lock().unwrap_or_else(|p| p.into_inner());
            if active.is_none() {
                return Ok(None);
            }
        }
        // Resolved BEFORE the active-set guard is retaken — see `open_from`.
        let sid = self.sessions.ensure_session()?;
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let Some(current) = active.as_ref() else {
            return Ok(None);
        };
        let command_id = v2_command_id(source, "close");
        let now = self.now()?;
        let mutation = self
            .store
            .v2_close(sid, current.block_id, source, &command_id, &now)
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
        // Quick peek, no side effects (fix round 2, N1): a failing undo with
        // nothing active must never mint/roll a session — see `open_from`.
        {
            let active = self.active.lock().unwrap_or_else(|p| p.into_inner());
            if active.is_none() {
                return Err("no active rep block".to_string());
            }
        }
        // Resolved BEFORE the active-set guard is retaken — see `open_from`.
        let sid = self.sessions.ensure_session()?;
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no active rep block".to_string())?
            .block_id;
        let command_id = v2_command_id(MutationSource::UserClick, "undo");
        let now = self.now()?;
        let mutation = self
            .store
            .v2_undo(
                sid,
                block_id,
                MutationSource::UserClick,
                &command_id,
                Some(&now),
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
            receipt: None,
        })
    }

    pub fn correct(
        &self,
        attempt_id: Option<i64>,
        verdict: RepVerdict,
        note: Option<String>,
        replace_note: bool,
    ) -> Result<CheckOutcome, String> {
        // Quick peek, no side effects (fix round 2, N1): a failing correct
        // with nothing active must never mint/roll a session — see
        // `open_from`.
        {
            let active = self.active.lock().unwrap_or_else(|p| p.into_inner());
            if active.is_none() {
                return Err("no active rep block".to_string());
            }
        }
        // Resolved BEFORE the active-set guard is retaken — see `open_from`.
        let sid = self.sessions.ensure_session()?;
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no active rep block".to_string())?
            .block_id;
        let command_id = v2_command_id(MutationSource::UserClick, "correct");
        let now = self.now()?;
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
                Some(&now),
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
            receipt: None,
        })
    }

    pub fn reverse_adjustment(&self, adjustment_id: i64) -> Result<CheckOutcome, String> {
        // Quick peek, no side effects (fix round 2, N1): a failing reversal
        // with nothing active must never mint/roll a session — see
        // `open_from`.
        {
            let active = self.active.lock().unwrap_or_else(|p| p.into_inner());
            if active.is_none() {
                return Err("no active rep block".to_string());
            }
        }
        // Resolved BEFORE the active-set guard is retaken — see `open_from`.
        let sid = self.sessions.ensure_session()?;
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no active rep block".to_string())?
            .block_id;
        let command_id = v2_command_id(MutationSource::UserClick, "reverse_adjustment");
        let now = self.now()?;
        let mutation = self
            .store
            .v2_reverse_adjustment(
                sid,
                block_id,
                adjustment_id,
                MutationSource::UserClick,
                &command_id,
                Some(&now),
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
            receipt: None,
        })
    }

    pub fn restart(&self, required_clean_streak: Option<u32>) -> Result<RepSnapshot, String> {
        // Quick peek, no side effects (fix round 2, N1): a failing restart
        // with nothing active must never mint/roll a session — see
        // `open_from`.
        {
            let active = self.active.lock().unwrap_or_else(|p| p.into_inner());
            if active.is_none() {
                return Err("no active rep block".to_string());
            }
        }
        // Resolved BEFORE the active-set guard is retaken — see `open_from`.
        let sid = self.sessions.ensure_session()?;
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no active rep block".to_string())?
            .block_id;
        let command_id = v2_command_id(MutationSource::UserClick, "restart");
        let now = self.now()?;
        let opened = self
            .store
            .v2_restart(
                sid,
                block_id,
                required_clean_streak,
                MutationSource::UserClick,
                &command_id,
                &now,
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

    /// Start one reviewed session plan item as the live block. Mirrors [`open`]
    /// for in-memory state ownership: it holds the active-set guard across the
    /// durable store command so a start while a block is already live is
    /// rejected without touching the live set, and a replay resyncs the same
    /// block instead of opening a second one.
    pub fn session_plan_start(
        &self,
        payload: &SessionPlanStartPayload,
    ) -> Result<MutationReceipt<SessionPlanStartOutcome>, String> {
        if let Some(error) = &self.restore_error {
            return Err(error.clone());
        }
        // Resolved BEFORE the active-set guard — see `open_from`.
        let session_hint = Some(self.sessions.ensure_session()?);
        let mut active = self.active.lock().unwrap_or_else(|p| p.into_inner());
        let now = self.now()?;
        let receipt = self
            .store
            .session_plan_start(session_hint, payload, MutationSource::UserClick, &now)
            .map_err(|error| error.to_string())?;
        let snapshot = receipt
            .value
            .as_ref()
            .map(|outcome| outcome.snapshot.clone())
            .ok_or_else(|| "session plan receipt has no snapshot".to_string())?;
        *active = Some(snapshot.clone());
        // `adopt_receipt_session` locks `sessions.current` — moved here,
        // AFTER `drop(active)` (fix round 2: see `open_from`).
        drop(active);
        self.adopt_receipt_session(&receipt);
        self.emit_state(Some(&snapshot));
        Ok(receipt)
    }

    fn apply_snapshot_receipt(
        &self,
        active: &mut Option<RepSnapshot>,
        block_id: i64,
        receipt: &mut MutationReceipt<RepSnapshot>,
    ) -> Result<RepSnapshot, String> {
        let snapshot = if receipt.replayed {
            self.store
                .v2_snapshot(block_id)
                .map_err(|error| error.to_string())?
        } else {
            receipt
                .value
                .clone()
                .ok_or_else(|| "committed practice receipt has no snapshot".to_string())?
        };
        if receipt.replayed {
            receipt.value = Some(snapshot.clone());
        }
        *active = Some(snapshot.clone());
        Ok(snapshot)
    }

    fn adopt_receipt_session<T>(&self, receipt: &MutationReceipt<T>) {
        if let Some(session_id) = receipt.session_id {
            self.sessions.adopt_committed_practice_session(session_id);
        }
    }

    pub fn pause(&self, command_id: &str) -> Result<MutationReceipt<RepSnapshot>, String> {
        // Quick peek, no side effects (fix round 2, N1): a failing pause
        // with nothing active must never mint/roll a session — see
        // `open_from`.
        {
            let active = self
                .active
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if active.is_none() {
                return Err("no live practice set".to_string());
            }
        }
        // Resolved BEFORE the active-set guard is retaken — see `open_from`.
        let session_hint = Some(self.sessions.ensure_session()?);
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no live practice set".to_string())?
            .block_id;
        let now = self.now()?;
        let mut receipt = self
            .store
            .v2_pause(
                session_hint,
                block_id,
                MutationSource::UserClick,
                command_id,
                &now,
            )
            .map_err(|error| error.to_string())?;
        let snapshot = self.apply_snapshot_receipt(&mut active, block_id, &mut receipt)?;
        // `adopt_receipt_session` locks `sessions.current` — moved here,
        // AFTER `drop(active)` (fix round 2: see `open_from`).
        drop(active);
        self.adopt_receipt_session(&receipt);
        self.emit_state(Some(&snapshot));
        Ok(receipt)
    }

    /// Resume a practice set. Task A4b: `target_set_id` picks WHICH set.
    ///
    /// `Some(id)` resumes exactly that set (the paused-sets tray's per-row
    /// Resume button always passes this). If some OTHER set is currently
    /// active, it is auto-paused and the target activated in one atomic
    /// transaction (`Store::v2_resume`) — a failure there leaves both sets
    /// exactly as they were. `Store::v2_resume` itself rejects a target that
    /// is not currently `paused`.
    ///
    /// `None` keeps the pre-A4b behavior EXACTLY: resume THIS engine's own
    /// tracked block (`self.active`), whatever state it is in right now —
    /// this is what the rep HUD's own Resume chip calls, and it must keep
    /// working through a day-rollover boundary, where `ensure_session()`
    /// below may auto-pause that very block via `pause_for_rollover` a
    /// moment before `Store::v2_resume` validates it. Only when this engine
    /// instance isn't tracking any block at all (e.g. freshly relaunched
    /// into a database that has paused rows but no active one, so
    /// `v2_restore_active_at` restored nothing) does `None` fall back to a
    /// DB-wide lookup: resume the only paused set, or reject as ambiguous if
    /// several are paused.
    ///
    /// Task A4b fix round 1: `active` is taken BEFORE `Store::v2_resume` and
    /// held across it (for both branches), exactly like `pause` and
    /// `safety_stop_after_commit` already do — this restores the pre-A4b
    /// guarantee that a concurrent resume cannot overtake a safety physical
    /// stop, which holds `active` across its own `after_commit()` callback
    /// (see `resume_cannot_overtake_the_safety_physical_stop` and
    /// `resume_with_explicit_target_cannot_overtake_the_safety_physical_stop`).
    /// Legal under this file's lock order (`active` < `store.conn` —
    /// `Store::v2_resume` takes `store.conn` internally, strictly after
    /// `active`, never the reverse).
    pub fn resume(
        &self,
        command_id: &str,
        target_set_id: Option<i64>,
    ) -> Result<MutationReceipt<RepSnapshot>, String> {
        // Quick peek, no side effects (fix round 2, N1 discipline): when
        // there is no explicit target AND this engine isn't tracking any
        // block, resolve the DB-wide fallback ("the only paused set") here,
        // before minting/rolling a session — a plain read, so it cannot
        // leave any partial state behind on the early-return failure paths.
        // `Some(id)` needs no peek at all: the target is already known and
        // `Store::v2_resume` validates it.
        let untracked_fallback_id = if target_set_id.is_none() {
            let tracked = {
                let active = self
                    .active
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner());
                active.is_some()
            };
            if tracked {
                None
            } else {
                let paused = self
                    .store
                    .paused_sets_list()
                    .map_err(|error| error.to_string())?;
                match paused.as_slice() {
                    [] => return Err("no paused practice set".to_string()),
                    [only] => Some(only.set_id),
                    _ => {
                        return Err(
                            "multiple sets are paused; choose which one to resume".to_string()
                        )
                    }
                }
            }
        } else {
            None
        };

        let session_hint = Some(self.sessions.ensure_session()?);
        // Task A4b fix round 1: `active` is taken BEFORE `Store::v2_resume`
        // and held across it — see the doc comment above.
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let target_block_id = match target_set_id {
            Some(id) => id,
            None => match untracked_fallback_id {
                Some(id) => id,
                // The common case: this engine's own tracked block, re-read
                // fresh from the just-(re)taken guard rather than trusting
                // any earlier peek — matches `pause`'s own pattern.
                None => {
                    active
                        .as_ref()
                        .ok_or_else(|| "no paused practice set".to_string())?
                        .block_id
                }
            },
        };
        let now = self.now()?;
        let mut receipt = self
            .store
            .v2_resume(
                session_hint,
                target_block_id,
                MutationSource::UserClick,
                command_id,
                &now,
            )
            .map_err(|error| error.to_string())?;
        let snapshot = self.apply_snapshot_receipt(&mut active, target_block_id, &mut receipt)?;
        // `adopt_receipt_session` locks `sessions.current` — moved here,
        // AFTER `drop(active)` (fix round 2: see `open_from`).
        drop(active);
        self.adopt_receipt_session(&receipt);
        self.emit_state(Some(&snapshot));
        Ok(receipt)
    }

    /// Task A5 rollover hook: pause whatever set is active, at an explicit
    /// already-committed boundary timestamp, through the exact same store path
    /// [`Self::pause`] uses — but attributed to `session_id` (the closing
    /// session) and without touching the session cache at all (never calls
    /// `adopt_committed_practice_session`; `SessionService` owns updating its
    /// own cache around the rollover it is already mid-way through).
    ///
    /// Called from `SessionService::resolve_session()` — every mutation entry
    /// point above resolves its session (`ensure_session()`/`self.now()`
    /// wiring) *before* taking the `self.active` lock precisely so this can
    /// safely acquire it here: if a caller held `self.active` across its own
    /// `ensure_session()` call, a rollover on that same thread would recurse
    /// into this function and self-deadlock on the same non-reentrant mutex
    /// (fix round 1, CRITICAL 2). A no-op when nothing is active.
    fn pause_for_rollover(&self, session_id: i64, at: &str) -> Result<(), String> {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let Some(block_id) = active.as_ref().map(|snapshot| snapshot.block_id) else {
            return Ok(());
        };
        let command_id = v2_command_id(MutationSource::SystemSchedule, "day_rollover_pause");
        let mut receipt = self
            .store
            .v2_pause(
                Some(session_id),
                block_id,
                MutationSource::SystemSchedule,
                &command_id,
                at,
            )
            .map_err(|error| error.to_string())?;
        let snapshot = self.apply_snapshot_receipt(&mut active, block_id, &mut receipt)?;
        drop(active);
        self.emit_state(Some(&snapshot));
        Ok(())
    }

    pub fn checkpoint(&self, command_id: &str) -> Result<MutationReceipt<RepSnapshot>, String> {
        // Quick peek, no side effects (fix round 2, N1): a failing
        // checkpoint with nothing active must never mint/roll a session —
        // see `open_from`.
        {
            let active = self
                .active
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if active.is_none() {
                return Err("no live practice set".to_string());
            }
        }
        // Resolved BEFORE the active-set guard is retaken — see `open_from`.
        let session_hint = Some(self.sessions.ensure_session()?);
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no live practice set".to_string())?
            .block_id;
        let now = self.now()?;
        let mut receipt = self
            .store
            .v2_checkpoint(
                session_hint,
                block_id,
                MutationSource::UserClick,
                command_id,
                &now,
            )
            .map_err(|error| error.to_string())?;
        let snapshot = self.apply_snapshot_receipt(&mut active, block_id, &mut receipt)?;
        // `adopt_receipt_session` locks `sessions.current` — moved here,
        // AFTER `drop(active)` (fix round 2: see `open_from`).
        drop(active);
        self.adopt_receipt_session(&receipt);
        self.emit_state(Some(&snapshot));
        Ok(receipt)
    }

    pub fn reflect(
        &self,
        command_id: &str,
        reflection: &str,
    ) -> Result<MutationReceipt<RepSnapshot>, String> {
        // Quick peek, no side effects (fix round 2, N1): a failing reflect
        // with nothing active must never mint/roll a session — see
        // `open_from`.
        {
            let active = self
                .active
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if active.is_none() {
                return Err("no live practice set".to_string());
            }
        }
        // Resolved BEFORE the active-set guard is retaken — see `open_from`.
        let session_hint = Some(self.sessions.ensure_session()?);
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no live practice set".to_string())?
            .block_id;
        let now = self.now()?;
        let mut receipt = self
            .store
            .v2_reflect(
                session_hint,
                block_id,
                reflection,
                MutationSource::UserClick,
                command_id,
                &now,
            )
            .map_err(|error| error.to_string())?;
        let snapshot = self.apply_snapshot_receipt(&mut active, block_id, &mut receipt)?;
        // `adopt_receipt_session` locks `sessions.current` — moved here,
        // AFTER `drop(active)` (fix round 2: see `open_from`).
        drop(active);
        self.adopt_receipt_session(&receipt);
        self.emit_state(Some(&snapshot));
        Ok(receipt)
    }

    /// Persist the safety pause, then perform the first delivery's physical
    /// stop while still holding the active-set guard. A concurrent resume
    /// cannot overtake the physical stop. Replays resync current state and do
    /// not repeat the physical side effect or emit a stale rep projection.
    fn safety_stop_after_commit<F, R>(
        &self,
        command_id: &str,
        reason: Option<&str>,
        after_commit: F,
    ) -> Result<(MutationReceipt<RepSnapshot>, Option<R>), String>
    where
        F: FnOnce() -> R,
    {
        // Quick peek, no side effects (fix round 2, N1): a failing safety
        // stop with nothing active must never mint/roll a session — see
        // `open_from`. `execute_safety_stop` still runs the physical stop on
        // this early `Err` (its fail-safe closure fires whenever the
        // closure passed in here was never consumed).
        {
            let active = self
                .active
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if active.is_none() {
                return Err("no live practice set".to_string());
            }
        }
        // Resolved BEFORE the active-set guard is retaken — see `open_from`.
        let session_hint = Some(self.sessions.ensure_session()?);
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no live practice set".to_string())?
            .block_id;
        let now = self.now()?;
        let mut receipt = self
            .store
            .v2_safety_stop(
                session_hint,
                block_id,
                reason,
                MutationSource::UserClick,
                command_id,
                &now,
            )
            .map_err(|error| error.to_string())?;
        let snapshot = self.apply_snapshot_receipt(&mut active, block_id, &mut receipt)?;
        // `adopt_receipt_session` locks `sessions.current` — moved to AFTER
        // `drop(active)` on both exits below (fix round 2: see `open_from`).
        // `after_commit()` (the physical stop) still runs WHILE `active` is
        // held, unchanged — that ordering guarantee (a concurrent resume
        // cannot overtake the physical stop) is independent of the
        // session-cache update and must stay put.
        if receipt.replayed {
            drop(active);
            self.adopt_receipt_session(&receipt);
            return Ok((receipt, None));
        }
        let physical_state = after_commit();
        drop(active);
        self.adopt_receipt_session(&receipt);
        self.emit_state(Some(&snapshot));
        Ok((receipt, Some(physical_state)))
    }

    /// Command-boundary fail-safe: a persistence error records no practice
    /// rows but must still stop the metronome once. A successful stale replay
    /// is the sole path that deliberately performs no physical stop.
    pub(crate) fn execute_safety_stop<F, R>(
        &self,
        command_id: &str,
        reason: Option<&str>,
        stop: F,
    ) -> (Result<MutationReceipt<RepSnapshot>, String>, Option<R>)
    where
        F: FnOnce() -> R,
    {
        let mut pending_stop = Some(stop);
        match self.safety_stop_after_commit(command_id, reason, || {
            pending_stop
                .take()
                .expect("safety physical stop executes at most once")()
        }) {
            Ok((receipt, state)) => (Ok(receipt), state),
            Err(error) => {
                let state = pending_stop.map(|stop| stop());
                (Err(error), state)
            }
        }
    }

    pub fn recover(
        &self,
        command_id: &str,
        action: &RecoveryActionRequest,
    ) -> Result<MutationReceipt<RepSnapshot>, String> {
        // Quick peek, no side effects (fix round 2, N1): a failing recover
        // with nothing active must never mint/roll a session — see
        // `open_from`.
        {
            let active = self
                .active
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if active.is_none() {
                return Err("no live practice set".to_string());
            }
        }
        // Resolved BEFORE the active-set guard is retaken — see `open_from`.
        let session_hint = Some(self.sessions.ensure_session()?);
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let block_id = active
            .as_ref()
            .ok_or_else(|| "no live practice set".to_string())?
            .block_id;
        let now = self.now()?;
        let mut receipt = self
            .store
            .v2_recover(
                session_hint,
                block_id,
                action,
                MutationSource::UserClick,
                command_id,
                &now,
            )
            .map_err(|error| error.to_string())?;
        let snapshot = self.apply_snapshot_receipt(&mut active, block_id, &mut receipt)?;
        // `adopt_receipt_session` locks `sessions.current` — moved here,
        // AFTER `drop(active)` (fix round 2: see `open_from`).
        drop(active);
        self.adopt_receipt_session(&receipt);
        self.emit_state(Some(&snapshot));
        Ok(receipt)
    }

    pub fn retention_due(&self, as_of_date: &str) -> Result<Vec<RetentionCheckView>, String> {
        self.store
            .retention_due(as_of_date)
            .map_err(|error| error.to_string())
    }

    pub fn retention_snooze(
        &self,
        command_id: &str,
        check_id: i64,
        due_date: &str,
    ) -> Result<MutationReceipt<RetentionCheckView>, String> {
        let now = self.now()?;
        let session_hint = Some(self.sessions.ensure_session()?);
        let receipt = self
            .store
            .retention_snooze(
                session_hint,
                check_id,
                due_date,
                MutationSource::UserClick,
                command_id,
                &now,
            )
            .map_err(|error| error.to_string())?;
        self.adopt_receipt_session(&receipt);
        Ok(receipt)
    }

    fn retention_result(
        &self,
        command_id: &str,
        check_id: i64,
        result: &RetentionResult,
        transition: &str,
    ) -> Result<MutationReceipt<RetentionCheckView>, String> {
        let now = self.now()?;
        let session_hint = Some(self.sessions.ensure_session()?);
        let outcome = match transition {
            "confirm" => self.store.retention_confirm(
                session_hint,
                check_id,
                result,
                MutationSource::UserClick,
                command_id,
                &now,
            ),
            "lower" => self.store.retention_lower(
                session_hint,
                check_id,
                result,
                MutationSource::UserClick,
                command_id,
                &now,
            ),
            "reopen" => self.store.retention_reopen(
                session_hint,
                check_id,
                result,
                MutationSource::UserClick,
                command_id,
                &now,
            ),
            _ => return Err("unknown retention transition".into()),
        };
        let receipt = outcome.map_err(|error| error.to_string())?;
        self.adopt_receipt_session(&receipt);
        Ok(receipt)
    }

    pub fn retention_confirm(
        &self,
        command_id: &str,
        check_id: i64,
        result: &RetentionResult,
    ) -> Result<MutationReceipt<RetentionCheckView>, String> {
        self.retention_result(command_id, check_id, result, "confirm")
    }

    pub fn retention_lower(
        &self,
        command_id: &str,
        check_id: i64,
        result: &RetentionResult,
    ) -> Result<MutationReceipt<RetentionCheckView>, String> {
        self.retention_result(command_id, check_id, result, "lower")
    }

    pub fn retention_reopen(
        &self,
        command_id: &str,
        check_id: i64,
        result: &RetentionResult,
    ) -> Result<MutationReceipt<RetentionCheckView>, String> {
        self.retention_result(command_id, check_id, result, "reopen")
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
        let Some(current) = active.as_ref() else {
            return;
        };
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

    // ── Task A5 fix round 2 audit note ──────────────────────────────────────
    // Every path in this file that locks `self.active` and then calls into
    // `self.sessions` was walked (grep for `self.active.lock` ×
    // `self.sessions.`/`ensure_session`) and confirmed to release `active`
    // FIRST:
    //   - `ensure_session()`/session_hint resolution: `open_from`,
    //     `check_from`, `close_from`, `undo`, `correct`, `reverse_adjustment`,
    //     `restart`, `session_plan_start`, `pause`, `resume`, `checkpoint`,
    //     `reflect`, `safety_stop_after_commit`, `recover` — all resolve the
    //     session (and, for the ones that can no-op/fail on "nothing
    //     active", quick-peek `active` first) BEFORE taking the guard that
    //     spans the store mutation (round 1 CRITICAL 2 / round 2 N1).
    //   - `adopt_committed_practice_session`/`adopt_receipt_session` (locks
    //     `sessions.current`): `open_from`, `check_from`, `session_plan_start`,
    //     `pause`, `resume`, `checkpoint`, `reflect`,
    //     `safety_stop_after_commit`, `recover` all now call it AFTER
    //     `drop(active)`, not before (round 2 — a rollover on another thread
    //     holds `current` while locking `active` via the pause hook; the
    //     reverse order on this thread was a second ABBA hazard).
    //   - `emit_persisted_practice`/`emit_state` never lock a `sessions`
    //     mutex (only `store` reads and the `emitter` mutex) — safe to call
    //     while `active` is held or not.
    //   - `end_session_and_export` and `pause_for_rollover` never hold
    //     `active` across a `sessions.*` call (round 2 N2; the latter is the
    //     CALLEE the whole invariant protects against re-entering).
    //   - `resync_active_if` locks `active` but never touches `self.sessions`.
    // No remaining path holds `self.active` while calling into
    // `self.sessions`.
    //
    // ── Task A4b addendum (fix round 1) ────────────────────────────────────
    // `resume` gained a `target_set_id: Option<i64>` (Task A4b) and now takes
    // `active` BEFORE `Store::v2_resume` and holds it across that call, on
    // BOTH branches — restoring the pre-A4b guarantee that a concurrent
    // resume cannot overtake `safety_stop_after_commit`'s physical stop
    // (which holds `active` across its own `after_commit()` callback). This
    // is the same shape every other mutation in this file already uses
    // (`pause`, `checkpoint`, `reflect`, `safety_stop_after_commit`, …):
    // resolve the session BEFORE taking `active` (`target_set_id: None`'s
    // DB-wide "untracked" fallback, when it applies, is resolved even
    // earlier still, via a separate lock-and-drop peek with no session risk
    // either way), then take `active` once and hold it for the store call
    // and the snapshot it returns. `active` is never held across a
    // `self.sessions` call anywhere in `resume`.
}

impl RolloverPauseHook for RepEngine {
    fn pause_active_at_rollover(&self, session_id: i64, at: &str) -> Result<(), String> {
        self.pause_for_rollover(session_id, at)
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
        && snap
            .target_bpm
            .is_some_and(|target| snap.bpm.is_some_and(|bpm| bpm + 0.000_001 < target));
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
            snap.tries, verdict_text, progress_label, progress, required
        )
    } else {
        format!(
            "Attempt {} saved — {}. {} reset to {} of {}.",
            snap.tries, verdict_text, progress_label, progress, required
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
    use crate::store::model::{
        IncrementRule, RegionCreate, RepPatch, RetentionCondition, RetentionDecision,
        RetentionResult, ScanPiece, SetFocusContextInput, VariantSpec, VerdictCounts,
    };
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

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

    struct FixedClock {
        value: Mutex<String>,
    }

    impl FixedClock {
        fn new(value: &str) -> Self {
            Self {
                value: Mutex::new(value.to_string()),
            }
        }

        fn set(&self, value: &str) {
            *self.value.lock().unwrap() = value.to_string();
        }
    }

    impl PracticeClock for FixedClock {
        fn now(&self, _store: &Store) -> Result<String, String> {
            Ok(self.value.lock().unwrap().clone())
        }
    }

    // Task A5: `resolve_session()` now reads its own clock to enforce the
    // same-local-day adoption boundary, so a simulated-relaunch test that
    // rebuilds the session service must feed it the SAME fixed clock the rep
    // engine uses — otherwise the service falls back to real wall time and
    // sees an unrelated calendar day, forking the session lineage.
    impl crate::sessions::SessionClock for FixedClock {
        fn now(&self, _store: &Store) -> Result<String, String> {
            Ok(self.value.lock().unwrap().clone())
        }
    }

    fn timestamp_after(seconds: u32) -> String {
        let hour = 12 + seconds / 3_600;
        let minute = (seconds % 3_600) / 60;
        let second = seconds % 60;
        format!("2026-07-15T{hour:02}:{minute:02}:{second:02}Z")
    }

    fn engine_with_fixed_clock(
        path: &Path,
        clock: Arc<FixedClock>,
    ) -> (RepEngine, i64, Arc<Store>) {
        let store = Arc::new(Store::open(path).expect("test store"));
        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/V2.4 fixed clock".into(),
                title: "V2.4 fixed clock".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let sessions = Arc::new(SessionService::new_with_clock(store.clone(), clock.clone()));
        let engine = RepEngine::new_with_clock(store.clone(), sessions, clock);
        (engine, piece_id, store)
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
                .test_scalar_string(&format!("SELECT status FROM rep_block WHERE id={block_id}"))
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
        let correction_id = store
            .v2_snapshot(block_id)
            .unwrap()
            .last_adjustment_id
            .unwrap();
        let session_id = store.open_session().unwrap();
        store
            .v2_reverse_adjustment(
                session_id,
                block_id,
                correction_id,
                MutationSource::UserClick,
                &v2_command_id(MutationSource::UserClick, "terminal_correct_reverse"),
                None,
            )
            .unwrap();
        assert_set_lifecycle(store, block_id, state, "abandoned");

        store.rep_delete(attempt_id).unwrap();
        assert_set_lifecycle(store, block_id, state, "abandoned");
        let void_id = store
            .v2_snapshot(block_id)
            .unwrap()
            .last_adjustment_id
            .unwrap();
        store
            .v2_reverse_adjustment(
                session_id,
                block_id,
                void_id,
                MutationSource::UserClick,
                &v2_command_id(MutationSource::UserClick, "terminal_void_reverse"),
                None,
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
    fn open_args_tempo(
        use_metronome: bool,
        clean_needed: u32,
        step: f64,
        start: f64,
    ) -> RepOpenArgs {
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
            increment: Some(IncrementRule {
                clean_needed,
                bpm_step: step,
            }),
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
            increment: Some(IncrementRule {
                clean_needed: 1,
                bpm_step: 4.0,
            }),
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

    fn retention_condition(bpm: f64) -> RetentionCondition {
        RetentionCondition {
            bpm: Some(bpm),
            hands: Some("together".into()),
            cold: Some(true),
            ..RetentionCondition::default()
        }
    }

    fn retention_result(
        decision: RetentionDecision,
        checked_as_of: &str,
        note: &str,
    ) -> RetentionResult {
        RetentionResult {
            decision,
            note: note.into(),
            checked_as_of: checked_as_of.into(),
            observed_condition: Some(retention_condition(80.0)),
            next_condition: None,
        }
    }

    #[test]
    fn focus_intervals_exclude_pauses_and_relaunch_gaps_and_preserve_context() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("focus.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T12:00:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        let opened = engine
            .open_with_context(
                strict_notes_args(piece_id, 50),
                Some(SetFocusContextInput {
                    intention: Some("Even pulse through the leap".into()),
                    judging_axis: Some("pulse".into()),
                    hands: Some("left".into()),
                    method: Some("blocked".into()),
                    planned_seconds: Some(300),
                    reflection: None,
                    pass_seconds: None,
                }),
            )
            .unwrap();
        assert_eq!(opened.active_seconds, 0);
        assert_eq!(opened.timer_state, "active");
        assert_eq!(opened.judging_axis, "pulse");

        clock.set("2026-07-15T12:00:10Z");
        assert_eq!(
            engine
                .checkpoint("focus-check-1")
                .unwrap()
                .value
                .unwrap()
                .active_seconds,
            10
        );
        clock.set("2026-07-15T12:00:20Z");
        let first_pause = engine.pause("focus-pause-1").unwrap();
        assert_eq!(first_pause.value.as_ref().unwrap().active_seconds, 20);
        let replay = engine.pause("focus-pause-1").unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.receipt_id, first_pause.receipt_id);
        assert!(
            engine.resume("focus-pause-1", None).is_err(),
            "same id cannot change payload/kind"
        );
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT count(*) FROM practice_operation WHERE command_id='focus-pause-1'"
                )
                .unwrap(),
            1
        );

        clock.set("2026-07-15T12:02:00Z");
        let resumed = engine.resume("focus-resume-1", None).unwrap();
        assert_eq!(resumed.value.as_ref().unwrap().active_seconds, 20);
        clock.set("2026-07-15T12:02:10Z");
        assert_eq!(
            engine
                .checkpoint("focus-check-2")
                .unwrap()
                .value
                .unwrap()
                .active_seconds,
            30
        );
        let block_id = opened.block_id;
        drop(engine);
        drop(store);

        // Relaunch 110 seconds later: the old interval closes at its last
        // checkpoint and a new interval starts now, so the gap adds nothing.
        clock.set("2026-07-15T12:04:00Z");
        let (engine, _, _) = engine_with_fixed_clock(&path, clock.clone());
        let restored = engine.state().unwrap().unwrap();
        assert_eq!(restored.block_id, block_id);
        assert_eq!(restored.active_seconds, 30);
        assert_eq!(
            restored.intention.as_deref(),
            Some("Even pulse through the leap")
        );
        assert_eq!(restored.hands, "left");
        assert_eq!(restored.method, "blocked");
        assert_eq!(restored.planned_seconds, Some(300));

        clock.set("2026-07-15T12:04:10Z");
        assert_eq!(
            engine
                .checkpoint("focus-check-3")
                .unwrap()
                .value
                .unwrap()
                .active_seconds,
            40
        );
        clock.set("2026-07-15T12:04:20Z");
        let closed = engine.close().unwrap().unwrap();
        assert_eq!(closed.active_seconds, 50);
        assert_eq!(closed.timer_state, "stopped");
    }

    /// Task A10: `rep_open`'s optional `context.pass_seconds` persists into
    /// `set_contract.pass_seconds`. `Some(30)` round-trips, an absent value
    /// stores NULL, and an out-of-range value is rejected by the column's
    /// existing CHECK (1-3600, added in the v14 migration for Task A1).
    #[test]
    fn open_with_context_persists_pass_seconds_and_enforces_the_check() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pass_seconds.sqlite");
        let clock = Arc::new(FixedClock::new("2026-08-05T09:00:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());

        let opened = engine
            .open_with_context(
                strict_notes_args(piece_id, 3),
                Some(SetFocusContextInput {
                    intention: None,
                    judging_axis: None,
                    hands: None,
                    method: None,
                    planned_seconds: None,
                    reflection: None,
                    pass_seconds: Some(30),
                }),
            )
            .unwrap();
        assert_eq!(
            store
                .test_scalar_i64_opt(&format!(
                    "SELECT pass_seconds FROM set_contract WHERE set_id={}",
                    opened.block_id
                ))
                .unwrap(),
            Some(30)
        );
        engine.close().unwrap();

        // Absent pass_seconds stores NULL, not a sentinel.
        let opened_none = engine
            .open_with_context(strict_notes_args(piece_id, 3), None)
            .unwrap();
        assert_eq!(
            store
                .test_scalar_i64_opt(&format!(
                    "SELECT pass_seconds FROM set_contract WHERE set_id={}",
                    opened_none.block_id
                ))
                .unwrap(),
            None
        );
        engine.close().unwrap();

        // Out-of-bounds (CHECK is 1-3600) is rejected; no set opens.
        let before_count = store
            .test_scalar_i64("SELECT count(*) FROM set_contract")
            .unwrap();
        let rejected = engine.open_with_context(
            strict_notes_args(piece_id, 3),
            Some(SetFocusContextInput {
                intention: None,
                judging_axis: None,
                hands: None,
                method: None,
                planned_seconds: None,
                reflection: None,
                pass_seconds: Some(3601),
            }),
        );
        assert!(rejected.is_err());
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM set_contract")
                .unwrap(),
            before_count,
            "a rejected open must not leave a partial set_contract row"
        );
    }

    /// A live set whose process stalls mid-practice (a laptop-sleep gap, no
    /// pause and no relaunch) must not bank the wall-clock gap as focus time.
    /// The delayed heartbeat is capped at the 60s ceiling, the stalled interval
    /// closes as a suspension, a fresh interval starts, and the receipt says so.
    #[test]
    fn live_uncheckpointed_gap_is_capped_and_suspends_the_interval() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("focus-cap.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T14:30:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        engine.open(strict_notes_args(piece_id, 50)).unwrap();

        clock.set("2026-07-15T14:30:10Z");
        let before = engine
            .checkpoint("cap-cp-1")
            .unwrap()
            .value
            .unwrap()
            .active_seconds;
        assert_eq!(before, 10);

        // Five minutes elapse with no pause and no relaunch — a live stall.
        clock.set("2026-07-15T14:35:10Z");
        let capped = engine.checkpoint("cap-cp-2").unwrap();
        let after = capped.value.as_ref().unwrap().active_seconds;
        assert!(
            after - before <= 60,
            "a live gap banks at most the 60s ceiling, grew {after} from {before}"
        );
        assert_eq!(
            capped.summary,
            "A delayed heartbeat was capped; suspended time was excluded."
        );
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT count(*) FROM practice_interval WHERE end_reason='suspension'"
                )
                .unwrap(),
            1,
            "the stalled interval closed as a suspension"
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM practice_interval WHERE ended_ts IS NULL")
                .unwrap(),
            1,
            "a fresh interval resumed live capture"
        );

        // A backward clock is rejected outright and changes no durable state.
        clock.set("2026-07-15T14:35:00Z");
        let error = engine.checkpoint("cap-back").unwrap_err();
        assert!(error.contains("practice clock moved backward"), "{error}");
        assert_eq!(
            store
                .test_scalar_string(
                    "SELECT last_checkpoint_ts FROM practice_interval WHERE ended_ts IS NULL"
                )
                .unwrap(),
            "2026-07-15T14:35:10Z",
            "the rejected checkpoint left the live interval untouched"
        );
    }

    /// A safety stop must perform its physical metronome stop exactly once. A
    /// replay of the same command id resyncs state but never repeats the
    /// side effect, and returns no physical-stop handle to the caller.
    #[test]
    fn safety_replay_does_not_repeat_the_physical_stop() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("safety-replay.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T14:40:00Z"));
        let (engine, piece_id, _store) = engine_with_fixed_clock(&path, clock.clone());
        engine.open(strict_notes_args(piece_id, 5)).unwrap();
        let stops = AtomicUsize::new(0);

        clock.set("2026-07-15T14:40:05Z");
        let (first, physical) = engine
            .safety_stop_after_commit("s1", Some("pain in wrist"), || {
                stops.fetch_add(1, Ordering::SeqCst);
            })
            .unwrap();
        assert!(!first.replayed);
        assert!(
            physical.is_some(),
            "first delivery performs the physical stop"
        );
        assert_eq!(stops.load(Ordering::SeqCst), 1);

        let (replay, physical_replay) = engine
            .safety_stop_after_commit("s1", Some("pain in wrist"), || {
                stops.fetch_add(1, Ordering::SeqCst);
            })
            .unwrap();
        assert!(replay.replayed);
        assert!(
            physical_replay.is_none(),
            "a replay returns no physical-stop handle"
        );
        assert_eq!(
            stops.load(Ordering::SeqCst),
            1,
            "the physical stop is never repeated"
        );
    }

    /// The active-set mutex held across the safety physical stop orders a
    /// concurrent resume strictly after it: resume blocks on `self.active` until
    /// the stop closure finishes, so it can never observe a half-applied stop.
    ///
    /// Task A4b fix round 1: also checks `set_contract.set_state` directly at
    /// the 50ms checkpoint, not just whether `resume()` has returned —
    /// `resume()` returning is not on its own a reliable signal (every path
    /// locks `active` at least once in `apply_snapshot_receipt` right before
    /// returning, regardless of whether the DB write itself was properly
    /// ordered), so the DB check is the assertion that actually matters. See
    /// `resume_with_explicit_target_cannot_overtake_the_safety_physical_stop`
    /// for the sibling case this reasoning was discovered fixing.
    #[test]
    fn resume_cannot_overtake_the_safety_physical_stop() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("safety-resume-race.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T14:50:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        let opened = engine.open(strict_notes_args(piece_id, 5)).unwrap();
        let block_id = opened.block_id;
        let engine = Arc::new(engine);

        let order = Arc::new(Mutex::new(Vec::<&'static str>::new()));
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let (inside_tx, inside_rx) = std::sync::mpsc::channel::<()>();

        clock.set("2026-07-15T14:50:05Z");
        let stop_engine = engine.clone();
        let stop_order = order.clone();
        let stopper = std::thread::spawn(move || {
            stop_engine
                .safety_stop_after_commit("safety-race", Some("pain in wrist"), || {
                    // Signal we are inside the physical stop (holding `active`),
                    // then block until the test releases us.
                    inside_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    stop_order.lock().unwrap().push("physical_stop");
                })
                .unwrap();
        });

        // The stopper now holds `active` inside the physical-stop closure.
        inside_rx.recv().unwrap();
        let resume_engine = engine.clone();
        let resume_order = order.clone();
        let resumer = std::thread::spawn(move || {
            resume_engine.resume("safety-race-resume", None).unwrap();
            resume_order.lock().unwrap().push("resume");
        });

        // Give the resumer time to reach the lock; it must stay blocked there
        // — checked at the DB layer directly (see the doc comment above).
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={block_id}"
                ))
                .unwrap(),
            "paused",
            "the resume's DB write must not land before the physical stop finishes"
        );
        assert!(
            order.lock().unwrap().is_empty(),
            "resume must not complete before the physical stop finishes"
        );

        release_tx.send(()).unwrap();
        stopper.join().unwrap();
        resumer.join().unwrap();
        assert_eq!(
            *order.lock().unwrap(),
            vec!["physical_stop", "resume"],
            "the physical stop is fully applied before resume proceeds"
        );
        let resumed = engine.state().unwrap().unwrap();
        assert_eq!(resumed.set_state, "active");
        assert_eq!(resumed.safety_state, "cleared");
    }

    /// Task A4b fix round 1 regression: the explicit-target `Some(id)` path
    /// must give the exact same ordering guarantee as `None` above — a
    /// resume of a SPECIFIC set (the paused-sets tray's per-row Resume) must
    /// not overtake a concurrent safety physical stop either. Before the fix
    /// round 1 fix, `resume`'s `Some` branch never touched `active` until
    /// AFTER `Store::v2_resume` had already committed, so it could race
    /// ahead of the stop instead of blocking on the mutex.
    ///
    /// Checks the underlying `set_contract.set_state` DIRECTLY at the 50ms
    /// checkpoint, not merely whether `resume()` has returned — every code
    /// path (buggy or fixed) locks `active` at least once, in
    /// `apply_snapshot_receipt`, right before returning, so a black-box
    /// "has `resume()` returned yet" check blocks identically either way and
    /// would NOT have caught this bug. The DB write itself is the thing that
    /// must not happen early.
    #[test]
    fn resume_with_explicit_target_cannot_overtake_the_safety_physical_stop() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("safety-resume-target-race.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T14:50:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        let opened = engine.open(strict_notes_args(piece_id, 5)).unwrap();
        let target_block_id = opened.block_id;
        let engine = Arc::new(engine);

        let order = Arc::new(Mutex::new(Vec::<&'static str>::new()));
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let (inside_tx, inside_rx) = std::sync::mpsc::channel::<()>();

        clock.set("2026-07-15T14:50:05Z");
        let stop_engine = engine.clone();
        let stop_order = order.clone();
        let stopper = std::thread::spawn(move || {
            stop_engine
                .safety_stop_after_commit("safety-target-race", Some("pain in wrist"), || {
                    // Signal we are inside the physical stop (holding `active`),
                    // then block until the test releases us.
                    inside_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    stop_order.lock().unwrap().push("physical_stop");
                })
                .unwrap();
        });

        // The stopper now holds `active` inside the physical-stop closure.
        // Its `v2_safety_stop` call has already committed by this point
        // (the DB write happens before `after_commit()`, per its own doc
        // comment), so the target is genuinely `paused` in the DB already —
        // a concurrent resume that doesn't block on `active` could commit
        // for real here, not just race a fake/inert lock.
        inside_rx.recv().unwrap();
        let resume_engine = engine.clone();
        let resume_order = order.clone();
        let resumer = std::thread::spawn(move || {
            resume_engine
                .resume("safety-target-race-resume", Some(target_block_id))
                .unwrap();
            resume_order.lock().unwrap().push("resume");
        });

        // Give the resumer time to reach the lock; it must stay blocked there
        // — checked at the DB layer directly, since `resume()` returning is
        // NOT a reliable signal (see the doc comment above).
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={target_block_id}"
                ))
                .unwrap(),
            "paused",
            "the resume's DB write must not land before the physical stop finishes"
        );
        assert!(
            order.lock().unwrap().is_empty(),
            "resume must not complete before the physical stop finishes"
        );

        release_tx.send(()).unwrap();
        stopper.join().unwrap();
        resumer.join().unwrap();
        assert_eq!(
            *order.lock().unwrap(),
            vec!["physical_stop", "resume"],
            "the physical stop is fully applied before the explicit-target resume proceeds"
        );
        let resumed = engine.state().unwrap().unwrap();
        assert_eq!(resumed.set_state, "active");
        assert_eq!(resumed.safety_state, "cleared");
    }

    /// Fix round 1, CRITICAL 2 regression: `close_from` (like `undo`,
    /// `correct`, `reverse_adjustment`, and `restart`) locks `self.active`
    /// and then resolves the session. The day-rollover pause hook
    /// (`pause_for_rollover`) re-locks `self.active` on whatever thread
    /// triggers the rollover — before the fix, a `close()` that was the
    /// first call to observe a day boundary with a set still active would
    /// self-deadlock on that non-reentrant `std::sync::Mutex`, hard-hanging
    /// (reachable in production from `finalize_practice_on_exit`, i.e.
    /// quitting the app with a set active across midnight). Runs on a
    /// background thread with a bounded wait so a regression fails this
    /// test instead of hanging the whole suite.
    #[test]
    fn day_rollover_pause_does_not_deadlock_a_practice_mutation_holding_active() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollover-deadlock.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T12:00:00Z"));
        let (engine, piece_id, _store) = engine_with_fixed_clock(&path, clock.clone());
        let engine = Arc::new(engine);
        engine.sessions.set_rollover_pause_hook(engine.clone());

        engine.open(strict_notes_args(piece_id, 5)).unwrap();

        // Three days later — a TZ-safe crossing (see the `sessions` module
        // tests' comments on why a wide gap is used instead of "just after
        // midnight").
        clock.set("2026-07-18T12:05:00Z");

        let (tx, rx) = std::sync::mpsc::channel();
        let close_engine = engine.clone();
        std::thread::spawn(move || {
            let _ = tx.send(close_engine.close());
        });

        let result = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("close() across a day boundary must not deadlock");
        let closed = result
            .unwrap()
            .expect("the live set closes despite the same-call rollover");
        assert_eq!(closed.set_state, "closed_unresolved");
    }

    /// Fix round 1, CRITICAL 1 regression: `rep_open` (via `RepEngine::open`,
    /// the UI/voice entry point) resolves its session through
    /// `ensure_session()` BEFORE its durable transaction starts, so the
    /// day-rollover boundary applies to practice writes, not only to
    /// `sessions.log()`/`ensure_session()` callers outside the practice loop.
    /// Before the fix, `v2_open_set`'s own `resolve_practice_session` adopted
    /// ANY still-open session with no day check — a rep opened after
    /// midnight would have silently landed in yesterday's session.
    #[test]
    fn rep_open_after_a_day_boundary_lands_in_a_new_session() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("open-day-boundary.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T12:00:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());

        engine.open(strict_notes_args(piece_id, 5)).unwrap();
        let old_sid = engine.sessions.current_id().unwrap();
        engine.close().unwrap();

        // Three days later — a TZ-safe crossing (see the `sessions` module
        // tests' comments).
        clock.set("2026-07-18T12:05:00Z");
        let opened = engine.open(strict_notes_args(piece_id, 5)).unwrap();
        let new_sid = engine.sessions.current_id().unwrap();

        assert_ne!(
            old_sid, new_sid,
            "the second rep_open crossed the day boundary into a fresh session"
        );
        let rep_open_session: i64 = store
            .test_scalar_i64(&format!(
                "SELECT session_id FROM event
                 WHERE kind='rep_open' AND entity_id={}
                 ORDER BY id DESC LIMIT 1",
                opened.block_id
            ))
            .unwrap();
        assert_eq!(
            rep_open_session, new_sid,
            "the post-boundary rep_open is canonically attributed to the new session, \
             not adopted into the prior day's session"
        );
    }

    /// Fix round 2, N1 regression: a call that will no-op or fail on
    /// "nothing active" must never resolve/mint a session as a side effect
    /// — round 1's blast radius had every such call resolve the session
    /// BEFORE its own "nothing active" early-out, so e.g. every graceful
    /// quit with no live set (`finalize_practice_on_exit` calls
    /// `rep.close()` unconditionally) opened a phantom session and
    /// immediately ended it.
    #[test]
    fn noop_close_with_nothing_active_does_not_mint_a_session() {
        let (engine, _pid, store, _rec) = engine_with_piece();
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM session")
                .unwrap(),
            0,
            "fresh store, nothing has opened a session yet"
        );

        let result = engine.close().unwrap();
        assert!(result.is_none(), "no-op: nothing was active to close");

        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM session")
                .unwrap(),
            0,
            "the no-op close must not have minted a session"
        );
    }

    #[test]
    fn failed_undo_and_check_with_nothing_active_do_not_mint_a_session() {
        let (engine, _pid, store, _rec) = engine_with_piece();
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM session")
                .unwrap(),
            0
        );

        assert!(engine.undo().is_err(), "nothing active: undo must fail");
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM session")
                .unwrap(),
            0,
            "the failed undo must not have minted a session"
        );

        assert!(
            engine.check(RepVerdict::Clean, None).is_err(),
            "nothing active: check must fail"
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM session")
                .unwrap(),
            0,
            "the failed check must not have minted a session"
        );
    }

    /// Fix round 2, N2 regression: `end_session_and_export` used to hold
    /// `self.active` across `sessions.end_and_export(...)` (which acquires
    /// `sessions.lifecycle`) — the reverse of the lock order every practice
    /// mutation's day-rollover pause takes (`lifecycle` → `current` →
    /// `active`, via the pause hook). A slow rollover hook forces the
    /// worst-case interleave deterministically: it stalls mid-rollover,
    /// holding `lifecycle` + `current`, while a concurrent
    /// `end_session_and_export` is confirmed blocked waiting on
    /// `lifecycle` — reproducing exactly the cross-thread ABBA shape (the
    /// re-reviewer's probe). Both sides must still complete once released;
    /// bounded by `recv_timeout` so a regression fails this test instead of
    /// hanging the suite.
    #[test]
    fn end_session_and_export_does_not_deadlock_with_a_concurrent_day_boundary_rollover() {
        struct SlowPauseHook {
            inner: Arc<RepEngine>,
            reached: std::sync::mpsc::Sender<()>,
            release: Mutex<std::sync::mpsc::Receiver<()>>,
        }
        impl RolloverPauseHook for SlowPauseHook {
            fn pause_active_at_rollover(&self, session_id: i64, at: &str) -> Result<(), String> {
                let _ = self.reached.send(());
                let _ = self.release.lock().unwrap().recv();
                self.inner.pause_active_at_rollover(session_id, at)
            }
        }

        let dir = tempfile::tempdir().unwrap();
        let pieces_dir = dir.path().to_path_buf();
        let path = dir.path().join("n2-abba.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T12:00:00Z"));
        let (engine, piece_id, _store) = engine_with_fixed_clock(&path, clock.clone());
        let engine = Arc::new(engine);

        let (reached_tx, reached_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        engine
            .sessions
            .set_rollover_pause_hook(Arc::new(SlowPauseHook {
                inner: engine.clone(),
                reached: reached_tx,
                release: Mutex::new(release_rx),
            }));

        // Establish a session (nothing active) to roll over.
        engine.sessions.ensure_session().unwrap();

        // Three days later — a TZ-safe crossing (see the sibling tests).
        clock.set("2026-07-18T12:05:00Z");

        // Thread B: a practice mutation (`open`) crosses the day boundary.
        // Its rollover reaches the stalled hook — holding
        // `sessions.lifecycle` + `sessions.current` — and blocks there.
        let open_engine = engine.clone();
        let opener = std::thread::spawn(move || open_engine.open(open_args(piece_id)));

        reached_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the rollover hook must be reached");

        // Thread A: end_session_and_export, concurrently, while B is
        // mid-rollover holding `lifecycle`. Under the pre-fix code (holding
        // `active` across this call) this is exactly the deadlock shape;
        // now it must simply block on `lifecycle` like any other caller.
        let export_engine = engine.clone();
        let (export_tx, export_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = export_tx.send(export_engine.end_session_and_export(&pieces_dir));
        });

        // Confirm A is genuinely blocked (not racing ahead) before releasing B.
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(
            export_rx.try_recv().is_err(),
            "export must still be waiting on `lifecycle`, held by the stalled rollover"
        );

        release_tx.send(()).unwrap();

        opener
            .join()
            .unwrap()
            .expect("the practice mutation completes once the rollover finishes");
        let exported = export_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("end_session_and_export must not deadlock and must complete");
        assert!(exported.is_ok(), "{exported:?}");
    }

    #[test]
    fn propagated_attempt_command_is_idempotent_concurrently_and_after_relaunch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("idempotency.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T13:00:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        engine.open(strict_notes_args(piece_id, 50)).unwrap();
        clock.set("2026-07-15T13:00:01Z");
        let engine = Arc::new(engine);
        let first_engine = engine.clone();
        let second_engine = engine.clone();
        let first = std::thread::spawn(move || {
            first_engine.check_idempotent("delivery-attempt-1", RepVerdict::Clean, None)
        });
        let second = std::thread::spawn(move || {
            second_engine.check_idempotent("delivery-attempt-1", RepVerdict::Clean, None)
        });
        let first = first.join().unwrap().unwrap();
        let second = second.join().unwrap().unwrap();
        assert_eq!(first.snap.tries, 1);
        assert_eq!(second.snap.tries, 1);
        let first_receipt = first.receipt.unwrap();
        let second_receipt = second.receipt.unwrap();
        assert_eq!(first_receipt.receipt_id, second_receipt.receipt_id);
        assert_ne!(first_receipt.replayed, second_receipt.replayed);
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(),
            1
        );
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT count(*) FROM practice_operation WHERE command_id='delivery-attempt-1'"
                )
                .unwrap(),
            1
        );
        assert!(engine
            .check_idempotent("delivery-attempt-1", RepVerdict::Failed, None)
            .is_err());
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(),
            1
        );
        drop(engine);
        drop(store);

        clock.set("2026-07-15T13:10:00Z");
        let (engine, _, store) = engine_with_fixed_clock(&path, clock);
        let replay = engine
            .check_idempotent("delivery-attempt-1", RepVerdict::Clean, None)
            .unwrap();
        assert!(replay.receipt.unwrap().replayed);
        assert_eq!(replay.snap.tries, 1);
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(),
            1
        );
    }

    #[test]
    fn attempt_retry_replays_original_receipt_when_the_next_variant_changed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("variant-idempotency.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T13:30:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        let mut args = strict_notes_args(piece_id, 50);
        args.variants = vec![
            VariantSpec {
                name: "blocked".into(),
                reps: 1,
            },
            VariantSpec {
                name: "as written".into(),
                reps: 1,
            },
        ];
        engine.open(args).unwrap();

        clock.set("2026-07-15T13:30:01Z");
        let first = engine
            .check_idempotent("variant-delivery-1", RepVerdict::Clean, None)
            .unwrap();
        let first_receipt = first.receipt.unwrap();
        assert!(!first_receipt.replayed);
        assert_eq!(first.snap.last.as_ref().unwrap().verdict, "clean");

        // The live projection now points at the second lane. The same caller
        // request must still load the first durable receipt, not reject or add
        // an "as written" attempt.
        let retry = engine
            .check_idempotent("variant-delivery-1", RepVerdict::Clean, None)
            .unwrap();
        let retry_receipt = retry.receipt.unwrap();
        assert!(retry_receipt.replayed);
        assert_eq!(retry_receipt.receipt_id, first_receipt.receipt_id);
        assert_eq!(retry.snap.tries, 1);
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT count(*) FROM rep WHERE variant='blocked' AND block_id=(SELECT max(id) FROM rep_block)"
                )
                .unwrap(),
            1
        );
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT count(*) FROM rep WHERE variant='as written' AND block_id=(SELECT max(id) FROM rep_block)"
                )
                .unwrap(),
            0
        );
        drop(engine);
        drop(store);

        clock.set("2026-07-15T13:40:00Z");
        let (engine, _, store) = engine_with_fixed_clock(&path, clock);
        let relaunched_retry = engine
            .check_idempotent("variant-delivery-1", RepVerdict::Clean, None)
            .unwrap();
        assert!(relaunched_retry.receipt.unwrap().replayed);
        assert_eq!(relaunched_retry.snap.tries, 1);
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(),
            1
        );
    }

    /// The very first attempt after a session ends must implicitly open exactly
    /// one session inside its own durable operation. A retry carrying the same
    /// caller command id replays that operation — it must not open a second
    /// session nor emit a second `session_start` event.
    #[test]
    fn idempotent_retry_after_session_end_opens_exactly_one_session() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session-idempotency.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T13:50:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        engine.open(strict_notes_args(piece_id, 50)).unwrap();
        // Retire the session the open created so the next attempt must take the
        // implicit-create path rather than adopting an already-open session.
        engine.sessions.end_raw().expect("open session ends");
        let sessions_before = store
            .test_scalar_i64("SELECT count(*) FROM session")
            .unwrap();

        clock.set("2026-07-15T13:50:01Z");
        let first = engine
            .check_idempotent("cmd-session-x", RepVerdict::Clean, None)
            .unwrap();
        assert!(!first.receipt.unwrap().replayed);
        let retry = engine
            .check_idempotent("cmd-session-x", RepVerdict::Clean, None)
            .unwrap();
        assert!(retry.receipt.unwrap().replayed);

        let sessions_after = store
            .test_scalar_i64("SELECT count(*) FROM session")
            .unwrap();
        assert_eq!(
            sessions_after,
            sessions_before + 1,
            "the replayed retry must not open a second session"
        );
        // Task A5 fix round 1 (CRITICAL 1): `check_from` now resolves/opens
        // the session through `SessionService::ensure_session()` BEFORE the
        // durable `check` transaction even starts (so the day-rollover
        // boundary applies to practice writes too), not inside it — so the
        // new session's `session_start` event no longer carries a
        // command-id-derived tag. What still must hold: exactly one
        // `session_start` per session that ever existed (one per row in
        // `session`, matching `sessions_after`) — proving the replayed retry
        // never mints a second one for the session it (re)opened.
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM event WHERE kind='session_start'")
                .unwrap(),
            sessions_after,
            "exactly one session_start per session, even after the replayed retry"
        );
    }

    #[test]
    fn public_session_end_rejects_a_live_set_then_exports_after_explicit_close() {
        let (engine, piece_id, _store, _rec) = engine_with_piece();
        let opened = engine.open(strict_notes_args(piece_id, 50)).unwrap();
        engine
            .check(RepVerdict::Flawed, Some("thumb arrived early".into()))
            .unwrap();
        let session_id = engine.sessions.current_id().expect("practice session");
        let export_root = tempfile::tempdir().unwrap();

        let error = engine
            .end_session_and_export(export_root.path())
            .expect_err("a live set cannot be split across sessions");
        assert!(error.contains("Close the current practice set"));
        assert_eq!(engine.snapshot().unwrap().block_id, opened.block_id);
        assert_eq!(engine.sessions.current_id(), Some(session_id));

        let closed = engine.close().unwrap().expect("set closes");
        assert_eq!(closed.set_state, "closed_unresolved");
        let exported = engine
            .end_session_and_export(export_root.path())
            .unwrap()
            .expect("session exports after close");
        assert_eq!(exported.session_id, session_id);
        assert_eq!(exported.reps, 1);
        assert!(engine.sessions.current_id().is_none());
    }

    #[test]
    fn long_stateful_practice_session_survives_retries_pauses_repairs_relaunch_restart_and_export()
    {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("long-stateful.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T12:00:00Z"));
        let (mut engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        let region = store
            .region_create(RegionCreate {
                piece_id,
                name: "Long-session landing".into(),
                notes: Some("measures 73–78".into()),
                m_start: 73,
                m_end: 78,
                kind: "hard_spot".into(),
            })
            .unwrap();
        let opened = engine
            .open_with_context(
                RepOpenArgs {
                    piece_id,
                    region_id: Some(region.id),
                    m_start: 73,
                    m_end: 78,
                    label: Some("long-session pulse audit".into()),
                    start_bpm: 60.0,
                    target_bpm: Some(300.0),
                    planned_reps: Some(240),
                    required_clean_streak: Some(50),
                    increment: Some(IncrementRule {
                        clean_needed: 4,
                        bpm_step: 2.0,
                    }),
                    variants: vec![
                        VariantSpec {
                            name: "blocked".into(),
                            reps: 60,
                        },
                        VariantSpec {
                            name: "dotted".into(),
                            reps: 60,
                        },
                        VariantSpec {
                            name: "reverse dotted".into(),
                            reps: 60,
                        },
                    ],
                    focus: "tempo".into(),
                    use_metronome: true,
                },
                Some(SetFocusContextInput {
                    intention: Some("Even pulse through the left-hand landing".into()),
                    judging_axis: Some("pulse".into()),
                    hands: Some("together".into()),
                    method: Some("rhythmic variants".into()),
                    planned_seconds: Some(1_200),
                    reflection: None,
                    pass_seconds: None,
                }),
            )
            .unwrap();
        let original_set_id = opened.block_id;
        let mut elapsed = 0u32;

        for attempt in 1..=180u32 {
            elapsed += 1;
            clock.set(&timestamp_after(elapsed));
            let (verdict, note) = if attempt % 11 == 0 {
                (
                    RepVerdict::Failed,
                    Some(format!("attempt {attempt}: lost pulse at landing")),
                )
            } else if attempt % 5 == 0 {
                (
                    RepVerdict::Flawed,
                    Some(format!("attempt {attempt}: uneven but recovered")),
                )
            } else {
                (RepVerdict::Clean, None)
            };

            let outcome = if attempt % 17 == 0 {
                let command_id = format!("long-attempt-{attempt}");
                let first = engine
                    .check_idempotent(&command_id, verdict, note.clone())
                    .unwrap();
                let replay = engine.check_idempotent(&command_id, verdict, note).unwrap();
                assert!(replay.receipt.as_ref().unwrap().replayed);
                assert_eq!(replay.snap.tries, first.snap.tries);
                replay
            } else {
                engine.check(verdict, note).unwrap()
            };

            assert_eq!(outcome.snap.tries, attempt);
            assert_eq!(outcome.snap.attempts_recorded, attempt);
            assert_eq!(outcome.snap.voided_attempts, 0);
            assert_eq!(
                outcome.snap.verdicts.clean
                    + outcome.snap.verdicts.flawed
                    + outcome.snap.verdicts.failed,
                attempt
            );
            assert!(outcome.snap.bpm.unwrap().is_finite());
            assert!(outcome.snap.bpm.unwrap() <= 300.0);

            if attempt % 30 == 0 {
                engine
                    .checkpoint(&format!("long-checkpoint-{attempt}"))
                    .unwrap();
            }
            if attempt == 60 || attempt == 120 {
                let paused = engine.pause(&format!("long-pause-{attempt}")).unwrap();
                assert_eq!(paused.value.as_ref().unwrap().timer_state, "paused");
                assert!(
                    engine.check(RepVerdict::Clean, None).is_err(),
                    "paused practice cannot accept a verdict"
                );
                elapsed += 10;
                clock.set(&timestamp_after(elapsed));
                let resumed = engine
                    .resume(&format!("long-resume-{attempt}"), None)
                    .unwrap();
                assert_eq!(resumed.value.as_ref().unwrap().timer_state, "active");
            }
            if attempt == 75 {
                let attempt_id = outcome.snap.last_attempt_id.unwrap();
                let corrected = engine
                    .correct(
                        Some(attempt_id),
                        RepVerdict::Clean,
                        Some("reviewed: landing was clean".into()),
                        true,
                    )
                    .unwrap();
                let adjustment = corrected.snap.last_adjustment_id.unwrap();
                let restored = engine.reverse_adjustment(adjustment).unwrap();
                assert_eq!(restored.snap.tries, attempt);
            }
            if attempt == 100 {
                let recovered = engine
                    .recover(
                        "long-reset-streak",
                        &RecoveryActionRequest::ResetStreak {
                            rationale: "reset after diagnosing pulse drift".into(),
                        },
                    )
                    .unwrap();
                assert_eq!(recovered.value.as_ref().unwrap().tries, attempt);
            }
            if attempt == 125 {
                let undone = engine.undo().unwrap();
                assert_eq!(undone.snap.tries, attempt - 1);
                let void = undone.snap.last_adjustment_id.unwrap();
                let restored = engine.reverse_adjustment(void).unwrap();
                assert_eq!(restored.snap.tries, attempt);
            }
            if attempt == 90 {
                // A three-minute app gap must not become practice time. The new
                // engine restores the same set and exact effective projection.
                elapsed += 180;
                clock.set(&timestamp_after(elapsed));
                engine = RepEngine::new_with_clock(
                    store.clone(),
                    Arc::new(SessionService::new_with_clock(store.clone(), clock.clone())),
                    clock.clone(),
                );
                let restored = engine.snapshot().expect("set restored after relaunch");
                assert_eq!(restored.block_id, original_set_id);
                assert_eq!(restored.tries, attempt);
            }
        }

        let original = engine.snapshot().unwrap();
        assert_eq!(original.tries, 180);
        assert_eq!(
            original.active_seconds, 180,
            "pause and relaunch gaps excluded"
        );
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(),
            180
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM attempt_adjustment")
                .unwrap(),
            4,
            "correction/reversal plus undo/reversal stay append-only"
        );

        elapsed += 1;
        clock.set(&timestamp_after(elapsed));
        let restarted = engine.restart(Some(20)).unwrap();
        assert_ne!(restarted.block_id, original_set_id);
        assert_eq!(
            restarted.bpm,
            Some(60.0),
            "restart returns to contract start tempo"
        );
        assert_eq!(restarted.tries, 0);
        for attempt in 1..=40u32 {
            elapsed += 1;
            clock.set(&timestamp_after(elapsed));
            let verdict = if attempt % 9 == 0 {
                RepVerdict::Failed
            } else if attempt % 4 == 0 {
                RepVerdict::Flawed
            } else {
                RepVerdict::Clean
            };
            let out = engine.check(verdict, None).unwrap();
            assert_eq!(out.snap.tries, attempt);
        }
        engine
            .recover(
                "long-schedule-retention",
                &RecoveryActionRequest::ScheduleRetention {
                    due_date: "2026-07-22".into(),
                    condition: retention_condition(engine.snapshot().unwrap().bpm.unwrap()),
                    rationale: "verify the landing cold next week".into(),
                },
            )
            .unwrap();
        assert_eq!(engine.retention_due("2026-07-22").unwrap().len(), 1);

        let closed = engine.close().unwrap().expect("replacement closes");
        assert_eq!(closed.set_state, "closed_unresolved");
        let exported = engine
            .end_session_and_export(dir.path())
            .unwrap()
            .expect("long session exports");
        assert_eq!(exported.reps, 220);
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(),
            220
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM session")
                .unwrap(),
            1,
            "the entire set lineage remains in one session"
        );
        assert!(engine.sessions.current_id().is_none());
    }

    #[test]
    fn safety_failure_never_stops_audio_or_records_a_failed_attempt() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("safety.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T14:00:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        engine.open(strict_notes_args(piece_id, 5)).unwrap();
        store
            .test_execute_batch(
                "CREATE TRIGGER fail_safety BEFORE INSERT ON practice_safety_event
                 BEGIN SELECT RAISE(ABORT,'injected safety failure'); END;",
            )
            .unwrap();
        let audio_stops = AtomicUsize::new(0);
        let audio_running = AtomicBool::new(true);
        let published_running = AtomicBool::new(true);
        clock.set("2026-07-15T14:00:05Z");
        let failed = engine.safety_stop_after_commit("safety-1", Some("pain in wrist"), || {
            audio_stops.fetch_add(1, Ordering::SeqCst);
            audio_running.store(false, Ordering::SeqCst);
            published_running.store(false, Ordering::SeqCst);
        });
        assert!(failed.is_err());
        assert_eq!(audio_stops.load(Ordering::SeqCst), 0);
        assert!(audio_running.load(Ordering::SeqCst));
        assert!(published_running.load(Ordering::SeqCst));
        let unchanged = engine.state().unwrap().unwrap();
        assert_eq!(unchanged.set_state, "active");
        assert_eq!(unchanged.tries, 0);
        assert_eq!(unchanged.reset_count, 0);
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM practice_operation")
                .unwrap(),
            0
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM practice_safety_event")
                .unwrap(),
            0
        );

        store
            .test_execute_batch("DROP TRIGGER fail_safety;")
            .unwrap();
        let (receipt, physical_stop) = engine
            .safety_stop_after_commit("safety-1", Some("pain in wrist"), || {
                audio_stops.fetch_add(1, Ordering::SeqCst);
                audio_running.store(false, Ordering::SeqCst);
                published_running.store(false, Ordering::SeqCst);
            })
            .unwrap();
        assert!(
            physical_stop.is_some(),
            "first delivery performs the physical stop"
        );
        let stopped = receipt.value.unwrap();
        assert_eq!(audio_stops.load(Ordering::SeqCst), 1);
        assert!(!audio_running.load(Ordering::SeqCst));
        assert!(!published_running.load(Ordering::SeqCst));
        assert_eq!(stopped.set_state, "paused");
        assert_eq!(stopped.safety_state, "stopped");
        assert_eq!(stopped.tries, 0);
        assert_eq!(stopped.verdicts.failed, 0);
        assert_eq!(stopped.reset_count, 0);
        clock.set("2026-07-15T14:00:10Z");
        let resumed = engine
            .resume("safety-resume-1", None)
            .unwrap()
            .value
            .unwrap();
        assert_eq!(resumed.set_state, "active");
        assert_eq!(resumed.safety_state, "cleared");
    }

    #[test]
    fn accepted_recovery_is_append_only_visible_and_does_not_rewrite_contract_or_attempts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recovery.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T15:00:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        let mut args = open_args_tempo(false, 3, 4.0, 80.0);
        args.piece_id = piece_id;
        args.required_clean_streak = Some(5);
        engine
            .open_with_context(
                args,
                Some(SetFocusContextInput {
                    intention: Some("Stabilize the leap".into()),
                    judging_axis: None,
                    hands: Some("both".into()),
                    method: Some("blocked".into()),
                    planned_seconds: Some(180),
                    reflection: None,
                    pass_seconds: None,
                }),
            )
            .unwrap();
        clock.set("2026-07-15T15:00:01Z");
        engine.check(RepVerdict::Clean, None).unwrap();
        clock.set("2026-07-15T15:00:02Z");
        engine.check(RepVerdict::Clean, None).unwrap();

        let reset = engine
            .recover(
                "recover-reset",
                &RecoveryActionRequest::ResetStreak {
                    rationale: "Re-establish pulse after the miss".into(),
                },
            )
            .unwrap()
            .value
            .unwrap();
        assert_eq!(reset.tries, 2);
        assert_eq!(reset.current_clean_streak, 0);
        assert_eq!(reset.best_clean_streak, 2);
        assert_eq!(reset.required_clean_streak, 5);

        let debt = engine
            .recover(
                "recover-debt",
                &RecoveryActionRequest::CleanDebt {
                    clean_count: 2,
                    rationale: "Two clean retrievals after the correction".into(),
                },
            )
            .unwrap()
            .value
            .unwrap();
        assert_eq!(debt.manual_clean_debt, 2);
        assert_eq!(debt.effective_required_clean_streak, 7);
        assert_eq!(
            debt.required_clean_streak, 5,
            "captured contract stays immutable"
        );

        let backed_off = engine
            .recover(
                "recover-tempo",
                &RecoveryActionRequest::TempoBackoff {
                    bpm: 70.0,
                    rationale: "Restore coordinated motion".into(),
                },
            )
            .unwrap()
            .value
            .unwrap();
        assert_eq!(backed_off.bpm, Some(70.0));
        let narrowed = engine
            .recover(
                "recover-narrow",
                &RecoveryActionRequest::NarrowTarget {
                    m_start: 2,
                    m_end: 6,
                    rationale: "Isolate the leap".into(),
                },
            )
            .unwrap()
            .value
            .unwrap();
        assert_eq!((narrowed.m_start, narrowed.m_end), (1, 8));
        assert_eq!((narrowed.working_m_start, narrowed.working_m_end), (2, 6));
        engine
            .recover(
                "recover-hands",
                &RecoveryActionRequest::ChangeHands {
                    hands: "left".into(),
                    rationale: "Clarify the bass line".into(),
                },
            )
            .unwrap();
        let method = engine
            .recover(
                "recover-method",
                &RecoveryActionRequest::ChangeMethod {
                    method: "serial chaining".into(),
                    rationale: "Add one note at a time".into(),
                },
            )
            .unwrap()
            .value
            .unwrap();
        assert_eq!(method.hands, "left");
        assert_eq!(method.method, "serial chaining");
        let reflected = engine
            .reflect("recover-reflect", "Pulse improved after narrowing.")
            .unwrap();
        assert_eq!(
            reflected.value.unwrap().reflection.as_deref(),
            Some("Pulse improved after narrowing.")
        );
        let paused = engine
            .recover(
                "recover-break",
                &RecoveryActionRequest::Break {
                    planned_seconds: Some(60),
                    rationale: "Release tension before another set".into(),
                },
            )
            .unwrap()
            .value
            .unwrap();
        assert_eq!(paused.set_state, "paused");
        assert_eq!(paused.recovery_actions.len(), 7);
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(),
            2
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM practice_recovery_action")
                .unwrap(),
            7
        );
        assert!(store
            .test_execute_batch(
                "UPDATE practice_recovery_action SET rationale='rewrite' WHERE id=1;"
            )
            .is_err());
    }

    /// Recovery is ordered after every physically committed attempt, including a
    /// latest one hidden behind append-only undo. The reset boundary must anchor
    /// on the physical MAX(id) — the voided row — not the effective last
    /// attempt, so restoring that attempt cannot slip it back into the streak.
    #[test]
    fn recovery_anchors_on_the_physical_watermark_not_the_effective_last_attempt() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recovery-watermark.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T16:30:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        let mut args = open_args_tempo(false, 5, 4.0, 80.0);
        args.piece_id = piece_id;
        args.required_clean_streak = Some(5);
        engine.open(args).unwrap();
        clock.set("2026-07-15T16:30:01Z");
        engine.check(RepVerdict::Clean, None).unwrap();
        clock.set("2026-07-15T16:30:02Z");
        engine.check(RepVerdict::Clean, None).unwrap();
        clock.set("2026-07-15T16:30:03Z");
        let third = engine.check(RepVerdict::Clean, None).unwrap();
        let physical_latest = third.snap.last_attempt_id.unwrap();
        assert_eq!(third.snap.current_clean_streak, 3);

        // Undo hides the newest attempt behind an append-only void; the physical
        // rep row survives as the durable commit watermark.
        let undone = engine.undo().unwrap();
        assert_eq!(undone.snap.current_clean_streak, 2);
        assert_eq!(
            store.test_scalar_i64("SELECT MAX(id) FROM rep").unwrap(),
            physical_latest
        );

        // A tempo backoff and a streak reset are accepted while the latest
        // attempt is voided.
        clock.set("2026-07-15T16:30:04Z");
        let backed_off = engine
            .recover(
                "recover-tempo-watermark",
                &RecoveryActionRequest::TempoBackoff {
                    bpm: 70.0,
                    rationale: "Restore coordinated motion before the reset".into(),
                },
            )
            .unwrap()
            .value
            .unwrap();
        assert_eq!(backed_off.bpm, Some(70.0));
        clock.set("2026-07-15T16:30:05Z");
        engine
            .recover(
                "recover-reset-watermark",
                &RecoveryActionRequest::ResetStreak {
                    rationale: "Re-establish the streak from scratch".into(),
                },
            )
            .unwrap();
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT after_attempt_id FROM practice_recovery_action WHERE kind='reset_streak'"
                )
                .unwrap(),
            physical_latest,
            "the reset anchors on the physical MAX(id), the voided row"
        );
        assert_eq!(engine.state().unwrap().unwrap().current_clean_streak, 0);

        // Restoring the voided attempt brings it back as clean, but it sits at
        // the physical reset boundary (not beyond it), so it must not re-enter
        // the post-reset streak — and the tempo backoff stays applied.
        let void_adjustment_id = store
            .v2_snapshot(third.snap.block_id)
            .unwrap()
            .last_adjustment_id
            .unwrap();
        let restored = engine.reverse_adjustment(void_adjustment_id).unwrap();
        assert_eq!(
            restored.snap.current_clean_streak, 0,
            "the restored attempt does not count into the post-reset streak"
        );
        assert_eq!(restored.snap.bpm, Some(70.0), "tempo backoff stays applied");
    }

    #[test]
    fn retention_due_snooze_confirm_lower_and_reopen_preserve_original_due_evidence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("retention.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T16:00:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        let region = store
            .region_create(RegionCreate {
                piece_id,
                name: "Retention target".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "hard_spot".into(),
            })
            .unwrap();
        let mut args = strict_notes_args(piece_id, 5);
        args.region_id = Some(region.id);
        engine.open(args).unwrap();

        let schedule = |command_id: &str, due_date: &str| {
            engine.recover(
                command_id,
                &RecoveryActionRequest::ScheduleRetention {
                    due_date: due_date.into(),
                    condition: retention_condition(80.0),
                    rationale: "Verify tomorrow before warm-up".into(),
                },
            )
        };
        let first = schedule("schedule-retention-1", "2026-07-16").unwrap();
        let first_id = first
            .value
            .as_ref()
            .unwrap()
            .retention_check
            .as_ref()
            .unwrap()
            .id;
        let duplicate = schedule("schedule-retention-1", "2026-07-16").unwrap();
        assert!(duplicate.replayed);
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM retention_check")
                .unwrap(),
            1
        );
        store
            .test_execute_batch(
                "CREATE TRIGGER fail_recovery_insert BEFORE INSERT ON practice_recovery_action
                 BEGIN SELECT RAISE(ABORT,'injected recovery failure'); END;",
            )
            .unwrap();
        assert!(schedule("schedule-retention-fail", "2026-07-20").is_err());
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM retention_check")
                .unwrap(),
            1
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM practice_operation WHERE command_id='schedule-retention-fail'")
                .unwrap(),
            0,
            "retention row, evidence event, action, and receipt roll back together"
        );
        store
            .test_execute_batch("DROP TRIGGER fail_recovery_insert;")
            .unwrap();
        assert!(engine.retention_due("2026-07-15").unwrap().is_empty());
        assert_eq!(engine.retention_due("2026-07-16").unwrap().len(), 1);

        let snoozed = engine
            .retention_snooze("retention-snooze-1", first_id, "2026-07-17")
            .unwrap();
        let snoozed_value = snoozed.value.as_ref().unwrap();
        assert_eq!(snoozed_value.due_date, "2026-07-17");
        assert_eq!(snoozed_value.original_due_date, "2026-07-16");
        let snooze_replay = engine
            .retention_snooze("retention-snooze-1", first_id, "2026-07-17")
            .unwrap();
        assert!(snooze_replay.replayed);
        assert!(engine.retention_due("2026-07-16").unwrap().is_empty());
        assert_eq!(engine.retention_due("2026-07-17").unwrap().len(), 1);
        store
            .test_execute_batch(
                "CREATE TRIGGER fail_retention_confirm BEFORE INSERT ON retention_check_event
                 WHEN NEW.to_state='confirmed'
                 BEGIN SELECT RAISE(ABORT,'injected retention failure'); END;",
            )
            .unwrap();
        assert!(engine
            .retention_confirm(
                "retention-confirm-fail",
                first_id,
                &retention_result(
                    RetentionDecision::ConfirmRetained,
                    "2026-07-17",
                    "clean on the first cold pass",
                ),
            )
            .is_err());
        assert_eq!(
            engine.retention_due("2026-07-17").unwrap()[0].state,
            "snoozed",
            "state update rolls back when append-only evidence fails"
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM practice_operation WHERE command_id='retention-confirm-fail'")
                .unwrap(),
            0
        );
        store
            .test_execute_batch("DROP TRIGGER fail_retention_confirm;")
            .unwrap();
        let confirmed = engine
            .retention_confirm(
                "retention-confirm-1",
                first_id,
                &retention_result(
                    RetentionDecision::ConfirmRetained,
                    "2026-07-17",
                    "clean at 80 before warm-up",
                ),
            )
            .unwrap()
            .value
            .unwrap();
        assert_eq!(confirmed.state, "confirmed");
        assert_eq!(confirmed.original_due_date, "2026-07-16");

        let second = schedule("schedule-retention-2", "2026-07-18")
            .unwrap()
            .value
            .unwrap()
            .retention_check
            .unwrap();
        let lowered = engine
            .retention_lower(
                "retention-lower-1",
                second.id,
                &RetentionResult {
                    decision: RetentionDecision::LowerWorkingCondition,
                    note: "held at 72, below the 80 peak".into(),
                    checked_as_of: "2026-07-18".into(),
                    observed_condition: Some(retention_condition(72.0)),
                    next_condition: Some(retention_condition(72.0)),
                },
            )
            .unwrap()
            .value
            .unwrap();
        assert_eq!(lowered.state, "lowered");
        let third = schedule("schedule-retention-3", "2026-07-19")
            .unwrap()
            .value
            .unwrap()
            .retention_check
            .unwrap();
        let reopened = engine
            .retention_reopen(
                "retention-reopen-1",
                third.id,
                &RetentionResult {
                    decision: RetentionDecision::ReopenTarget,
                    note: "cold check unstable".into(),
                    checked_as_of: "2026-07-19".into(),
                    observed_condition: None,
                    next_condition: None,
                },
            )
            .unwrap()
            .value
            .unwrap();
        assert_eq!(reopened.state, "reopened");
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM retention_check_event")
                .unwrap(),
            7,
            "three schedules + snooze + confirm + lower + reopen"
        );
    }

    /// Every retention entry point that accepts a date must reject an impossible
    /// calendar day before it writes any practice state, so a typo can never
    /// schedule, snooze, resolve, or query against a day that does not exist.
    #[test]
    fn retention_entry_points_reject_impossible_calendar_dates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("retention-dates.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T16:00:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        let region = store
            .region_create(RegionCreate {
                piece_id,
                name: "Date-guard target".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "hard_spot".into(),
            })
            .unwrap();
        let mut args = strict_notes_args(piece_id, 5);
        args.region_id = Some(region.id);
        engine.open(args).unwrap();

        let retention_rows = || {
            store
                .test_scalar_i64("SELECT count(*) FROM retention_check")
                .unwrap()
        };

        // (a) ScheduleRetention with a non-existent February day.
        assert!(engine
            .recover(
                "schedule-impossible",
                &RecoveryActionRequest::ScheduleRetention {
                    due_date: "2026-02-30".into(),
                    condition: retention_condition(80.0),
                    rationale: "should never persist".into(),
                },
            )
            .is_err());
        assert_eq!(retention_rows(), 0, "impossible schedule persists no check");

        // A real check to exercise the remaining entry points.
        let check = engine
            .recover(
                "schedule-valid",
                &RecoveryActionRequest::ScheduleRetention {
                    due_date: "2026-07-18".into(),
                    condition: retention_condition(80.0),
                    rationale: "Verify tomorrow".into(),
                },
            )
            .unwrap()
            .value
            .unwrap()
            .retention_check
            .unwrap();
        assert_eq!(retention_rows(), 1);

        // (b) snooze onto an impossible non-leap-year Feb 29.
        assert!(engine
            .retention_snooze("snooze-impossible", check.id, "2027-02-29")
            .is_err());
        let after_snooze = engine.retention_due("2026-07-18").unwrap();
        assert_eq!(after_snooze.len(), 1);
        assert_eq!(after_snooze[0].due_date, "2026-07-18");
        assert_eq!(after_snooze[0].state, "due");

        // (c) confirm with an impossible checked_as_of.
        assert!(engine
            .retention_confirm(
                "confirm-impossible",
                check.id,
                &retention_result(
                    RetentionDecision::ConfirmRetained,
                    "2026-02-30",
                    "clean cold pass",
                ),
            )
            .is_err());
        assert_eq!(engine.retention_due("2026-07-18").unwrap()[0].state, "due");

        // (d) retention_due queried with an impossible as-of date.
        assert!(engine.retention_due("2026-02-30").is_err());
    }

    /// Retention result evidence is bounded and typed. Every malformed field —
    /// wrong endpoint, empty note, bad date, a check date preceding the due
    /// date, or an out-of-range/empty condition — is rejected before any durable
    /// row is written, leaving no operation and no evidence event behind.
    #[test]
    fn retention_result_validation_rejects_bad_evidence_without_side_effects() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("retention-negatives.sqlite");
        let clock = Arc::new(FixedClock::new("2026-07-15T16:00:00Z"));
        let (engine, piece_id, store) = engine_with_fixed_clock(&path, clock.clone());
        let region = store
            .region_create(RegionCreate {
                piece_id,
                name: "Validation target".into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "hard_spot".into(),
            })
            .unwrap();
        let mut args = strict_notes_args(piece_id, 5);
        args.region_id = Some(region.id);
        engine.open(args).unwrap();
        let check = engine
            .recover(
                "schedule-negatives",
                &RecoveryActionRequest::ScheduleRetention {
                    due_date: "2026-07-18".into(),
                    condition: retention_condition(80.0),
                    rationale: "Verify tomorrow".into(),
                },
            )
            .unwrap()
            .value
            .unwrap()
            .retention_check
            .unwrap();
        let events_before = store
            .test_scalar_i64("SELECT count(*) FROM retention_check_event")
            .unwrap();

        let reject = |command_id: &str, result: RetentionResult| {
            assert!(
                engine
                    .retention_confirm(command_id, check.id, &result)
                    .is_err(),
                "{command_id} must be rejected"
            );
            assert_eq!(
                store
                    .test_scalar_i64(&format!(
                        "SELECT count(*) FROM practice_operation WHERE command_id='{command_id}'"
                    ))
                    .unwrap(),
                0,
                "{command_id} wrote no operation row"
            );
            assert_eq!(
                store
                    .test_scalar_i64("SELECT count(*) FROM retention_check_event")
                    .unwrap(),
                events_before,
                "{command_id} wrote no evidence event"
            );
        };

        // (i) endpoint/decision mismatch.
        reject(
            "confirm-mismatch",
            RetentionResult {
                decision: RetentionDecision::LowerWorkingCondition,
                note: "wrong endpoint".into(),
                checked_as_of: "2026-07-18".into(),
                observed_condition: None,
                next_condition: None,
            },
        );
        // (ii) empty/whitespace note.
        reject(
            "confirm-empty-note",
            retention_result(RetentionDecision::ConfirmRetained, "2026-07-18", "   "),
        );
        // (iii) malformed checked_as_of.
        reject(
            "confirm-bad-date",
            retention_result(
                RetentionDecision::ConfirmRetained,
                "2026-13-40",
                "clean pass",
            ),
        );
        // (iv) checked_as_of earlier than the due date.
        reject(
            "confirm-precedes-due",
            retention_result(
                RetentionDecision::ConfirmRetained,
                "2026-07-10",
                "too early",
            ),
        );
        // (v) invalid conditions: out-of-range bpm, inverted measures, and the
        // empty default that carries no condition at all.
        let with_condition = |condition: RetentionCondition| RetentionResult {
            decision: RetentionDecision::ConfirmRetained,
            note: "clean pass".into(),
            checked_as_of: "2026-07-18".into(),
            observed_condition: Some(condition),
            next_condition: None,
        };
        reject(
            "confirm-bpm-500",
            with_condition(RetentionCondition {
                bpm: Some(500.0),
                ..RetentionCondition::default()
            }),
        );
        reject(
            "confirm-inverted-measures",
            with_condition(RetentionCondition {
                m_start: Some(8),
                m_end: Some(4),
                ..RetentionCondition::default()
            }),
        );
        reject(
            "confirm-empty-condition",
            with_condition(RetentionCondition::default()),
        );

        assert_eq!(engine.retention_due("2026-07-18").unwrap()[0].state, "due");
    }

    /// The reviewed retention-result envelope is closed: an unknown field is
    /// rejected (`deny_unknown_fields`) and an unknown decision string cannot
    /// enter the closed enum. No opaque JSON becomes future work instruction.
    #[test]
    fn retention_result_rejects_unknown_fields_and_decisions() {
        assert!(serde_json::from_str::<RetentionResult>(
            r#"{"decision":"confirm_retained","note":"n","checked_as_of":"2026-07-18","surprise":1}"#
        )
        .is_err());
        assert!(serde_json::from_str::<RetentionResult>(
            r#"{"decision":"maybe_later","note":"n","checked_as_of":"2026-07-18"}"#
        )
        .is_err());
        let ok: RetentionResult = serde_json::from_str(
            r#"{"decision":"confirm_retained","note":"n","checked_as_of":"2026-07-18"}"#,
        )
        .unwrap();
        assert_eq!(ok.decision, RetentionDecision::ConfirmRetained);
    }

    #[test]
    fn ladder_advances_with_metronome_off() {
        let (engine, _emit) = engine_with_capture();
        let args = open_args_tempo(
            /*use_metronome*/ false, /*clean_needed*/ 2, /*step*/ 4.0,
            /*start*/ 40.0,
        );
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
        engine.open(open_args_tempo(true, 1, 4.0, 40.0)).unwrap();
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
            engine
                .store
                .test_scalar_i64("SELECT bpm=40 FROM rep")
                .unwrap(),
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
        let region = store
            .region_create(crate::store::model::RegionCreate {
                piece_id: pid,
                name: "LH landing".into(),
                notes: None,
                m_start: 38,
                m_end: 60,
                kind: "hard_spot".into(),
            })
            .unwrap();
        let snap = engine.open(open_args(pid)).unwrap();
        let history = store.block_row(snap.block_id).unwrap().unwrap();
        assert_eq!(history.region_id, Some(region.id));
    }

    #[test]
    fn score_selected_tricky_section_remains_linked_after_measure_adjustment() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let region = store
            .region_create(crate::store::model::RegionCreate {
                piece_id: pid,
                name: "RH shape".into(),
                notes: None,
                m_start: 40,
                m_end: 56,
                kind: "hard_spot".into(),
            })
            .unwrap();
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
        engine
            .check(RepVerdict::Flawed, Some("rushed".into()))
            .unwrap();
        engine.check(RepVerdict::Failed, None).unwrap();

        let snap = engine.snapshot().unwrap();
        assert_eq!(snap.reps_done, 3);
        assert_eq!(
            snap.verdicts,
            VerdictCounts {
                clean: 1,
                flawed: 1,
                failed: 1
            }
        );
        assert_eq!(snap.last.as_ref().unwrap().verdict, "failed");

        let h = &store.block_history(pid).unwrap()[0];
        assert_eq!(h.reps_done, 3);
        assert_eq!(
            h.verdicts,
            VerdictCounts {
                clean: 1,
                flawed: 1,
                failed: 1
            }
        );
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
        assert_eq!(
            snap.current_clean_streak, 0,
            "an error resets mastery progress"
        );
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
                VariantSpec {
                    name: "hands separate".into(),
                    reps: 2,
                },
                VariantSpec {
                    name: "hands together".into(),
                    reps: 2,
                },
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
                BlockPatch {
                    label: Some(Some("noop".into())),
                    ..Default::default()
                },
            )
            .ok();
        engine.resync_active_if(snap.block_id + 999);
        assert_eq!(
            rec.events.lock().unwrap().len(),
            events_before,
            "no re-emit"
        );
        assert_eq!(
            engine.snapshot().unwrap().label,
            None,
            "unrelated edit not applied"
        );
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
        assert_eq!(
            engine.snapshot().unwrap().bpm,
            Some(84.0),
            "working tempo stepped"
        );

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

        assert!(
            !engine.active(),
            "active snapshot evicted after its row is deleted"
        );
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
        let failed = engine
            .check(RepVerdict::Failed, Some("missed landing".into()))
            .unwrap();
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
        assert_eq!(
            half.verdicts,
            VerdictCounts {
                clean: 5,
                flawed: 0,
                failed: 5
            }
        );
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
            increment: Some(IncrementRule {
                clean_needed: 1,
                bpm_step: 4.0,
            }),
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
                increment: Some(IncrementRule {
                    clean_needed: 10,
                    bpm_step: 4.0,
                }),
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
        assert_eq!(
            outcome.new_bpm, None,
            "an overshoot must never step down to target"
        );
        assert!(
            outcome.block_done,
            "clean work above target is target-eligible"
        );
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
                increment: Some(IncrementRule {
                    clean_needed: 5,
                    bpm_step: 4.0,
                }),
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
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(),
            1
        );
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
        assert_eq!(
            cleared.snap.last.as_ref().unwrap().note,
            None,
            "explicit null clears"
        );
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
                .test_scalar_string(&format!(
                    "SELECT verdict||':'||note FROM rep WHERE id={attempt_id}"
                ))
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
                increment: Some(IncrementRule {
                    clean_needed: 3,
                    bpm_step: 4.0,
                }),
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
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM attempt_adjustment")
                .unwrap(),
            0
        );
        store
            .test_execute_batch("DROP TRIGGER fail_adjustment_tempo;")
            .unwrap();

        let undone = engine.undo().unwrap();
        assert_eq!(undone.new_bpm, Some(80.0));
        assert_eq!(undone.snap.bpm, Some(80.0));
        let void_id = undone.snap.last_adjustment_id.unwrap();

        let relaunched =
            RepEngine::new(store.clone(), Arc::new(SessionService::new(store.clone())));
        assert_eq!(relaunched.snapshot().unwrap().bpm, Some(80.0));
        let restored_step = relaunched.reverse_adjustment(void_id).unwrap();
        assert_eq!(restored_step.new_bpm, Some(84.0));
        assert_eq!(restored_step.snap.bpm, Some(84.0));

        let relaunched_again =
            RepEngine::new(store.clone(), Arc::new(SessionService::new(store.clone())));
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
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(),
            1
        );
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
        engine
            .check(RepVerdict::Flawed, Some("uneven".into()))
            .unwrap();

        let sessions = Arc::new(SessionService::new(store.clone()));
        let relaunched = RepEngine::new(store, sessions);
        let restored = relaunched.snapshot().expect("active set restored");
        assert_eq!(restored.block_id, restarted.block_id);
        assert_eq!(restored.tries, 2);
        assert_eq!(restored.verdicts.clean, 1);
        assert_eq!(restored.verdicts.flawed, 1);
        assert_eq!(restored.current_clean_streak, 0);
        assert_eq!(restored.reset_count, 1);
        assert_eq!(
            restored.last.as_ref().unwrap().note.as_deref(),
            Some("uneven")
        );
    }

    #[test]
    fn restarted_set_keeps_terminal_lineage_through_history_repairs_and_relaunch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("restarted.db");
        let (engine, pid, store) = engine_with_piece_at(&path);
        let original = engine.open(strict_notes_args(pid, 1)).unwrap();
        let failed = engine
            .check(RepVerdict::Failed, Some("landing".into()))
            .unwrap();
        let attempt_id = failed.snap.last_attempt_id.unwrap();
        let replacement = engine.restart(Some(1)).unwrap();
        assert_set_lifecycle(&store, original.block_id, "restarted", "abandoned");

        exercise_terminal_history_adjustments(&store, original.block_id, attempt_id, "restarted");

        let fresh = Arc::new(Store::open(&path).unwrap());
        assert_set_lifecycle(&fresh, original.block_id, "restarted", "abandoned");
        let relaunched = RepEngine::new(fresh.clone(), Arc::new(SessionService::new(fresh)));
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
        let failed = engine
            .check(RepVerdict::Failed, Some("landing".into()))
            .unwrap();
        let attempt_id = failed.snap.last_attempt_id.unwrap();
        store
            .test_execute_batch(&format!(
                "UPDATE set_contract SET set_state='abandoned' WHERE set_id={0};
                 UPDATE rep_block SET status='abandoned' WHERE id={0};",
                opened.block_id
            ))
            .unwrap();
        assert_set_lifecycle(&store, opened.block_id, "abandoned", "abandoned");

        exercise_terminal_history_adjustments(&store, opened.block_id, attempt_id, "abandoned");

        let fresh = Arc::new(Store::open(&path).unwrap());
        assert_set_lifecycle(&fresh, opened.block_id, "abandoned", "abandoned");
        let relaunched = RepEngine::new(fresh.clone(), Arc::new(SessionService::new(fresh)));
        assert_eq!(relaunched.state().unwrap(), None);
    }

    #[test]
    fn closed_unresolved_set_stays_closed_through_history_repairs_and_relaunch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("closed-unresolved.db");
        let (engine, pid, store) = engine_with_piece_at(&path);
        let opened = engine.open(strict_notes_args(pid, 1)).unwrap();
        let failed = engine
            .check(RepVerdict::Failed, Some("landing".into()))
            .unwrap();
        let attempt_id = failed.snap.last_attempt_id.unwrap();
        let closed = engine.close().unwrap().unwrap();
        assert_eq!(closed.set_state, "closed_unresolved");
        assert_set_lifecycle(&store, opened.block_id, "closed_unresolved", "abandoned");

        exercise_terminal_history_adjustments(
            &store,
            opened.block_id,
            attempt_id,
            "closed_unresolved",
        );

        let fresh = Arc::new(Store::open(&path).unwrap());
        assert_set_lifecycle(&fresh, opened.block_id, "closed_unresolved", "abandoned");
        let relaunched = RepEngine::new(fresh.clone(), Arc::new(SessionService::new(fresh)));
        assert_eq!(relaunched.state().unwrap(), None);
    }

    /// A mastered set is terminal: undo, correct, and reverse-adjustment history
    /// repairs record their append-only rows but must never recompute the set
    /// back to `active`, even when the repaired ledger no longer satisfies
    /// mastery. Only an explicit reviewed lifecycle command may reopen it.
    #[test]
    fn mastered_set_keeps_terminal_lineage_through_history_repairs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mastered.db");
        let (engine, pid, store) = engine_with_piece_at(&path);
        engine.open(strict_notes_args(pid, 1)).unwrap();
        let mastered = engine.check(RepVerdict::Clean, None).unwrap();
        let block_id = mastered.snap.block_id;
        let attempt_id = mastered.snap.last_attempt_id.unwrap();
        assert_eq!(mastered.snap.set_state, "mastered");
        assert_set_lifecycle(&store, block_id, "mastered", "done");

        let adjustments = || {
            store
                .test_scalar_i64(&format!(
                    "SELECT count(*) FROM attempt_adjustment WHERE rep_id={attempt_id}"
                ))
                .unwrap()
        };
        assert_eq!(adjustments(), 0);

        // Correcting the mastered attempt to flawed drops the streak below the
        // contract, yet the lineage stays mastered and the row is recorded.
        let corrected = engine
            .correct(
                Some(attempt_id),
                RepVerdict::Flawed,
                Some("actually uneven".into()),
                true,
            )
            .unwrap();
        assert_ne!(corrected.snap.set_state, "active");
        assert_eq!(corrected.snap.set_state, "mastered");
        assert_set_lifecycle(&store, block_id, "mastered", "done");
        assert_eq!(adjustments(), 1);
        let correction_id = corrected.snap.last_adjustment_id.unwrap();

        // Reversing the correction restores the clean verdict; still mastered.
        let reversed = engine.reverse_adjustment(correction_id).unwrap();
        assert_eq!(reversed.snap.set_state, "mastered");
        assert_set_lifecycle(&store, block_id, "mastered", "done");
        assert_eq!(adjustments(), 2);

        // Undo voids the attempt outright, again dropping mastery — the set is
        // still terminal, never recomputed back to active.
        let undone = engine.undo().unwrap();
        assert_ne!(undone.snap.set_state, "active");
        assert_eq!(undone.snap.set_state, "mastered");
        assert_set_lifecycle(&store, block_id, "mastered", "done");
        assert_eq!(adjustments(), 3);

        // The append-only repairs and terminal lineage survive a relaunch.
        let fresh = Arc::new(Store::open(&path).unwrap());
        assert_set_lifecycle(&fresh, block_id, "mastered", "done");
    }

    // Task A4b: the v9 one-live-set index was replaced by
    // `set_contract_one_active_v2_idx` (SCHEMA_V14) — the invariant relaxed
    // from one-LIVE-set (active OR paused) to one-ACTIVE-set. This test was
    // updated in place rather than duplicated: it still proves a second
    // ACTIVE row is rejected and a legacy state is ignored by the index, and
    // now additionally proves the relaxation itself — a PAUSED row no longer
    // conflicts with an existing ACTIVE row.
    #[test]
    fn schema_v14_unique_index_rejects_a_second_active_set_but_ignores_legacy_and_paused_state() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let original = engine.open(strict_notes_args(pid, 3)).unwrap();
        let replacement = engine.restart(Some(3)).unwrap();
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT count(*) FROM sqlite_master
                     WHERE type='index' AND name='set_contract_one_active_v2_idx'",
                )
                .unwrap(),
            1
        );
        assert_eq!(
            store
                .test_scalar_i64(
                    "SELECT count(*) FROM sqlite_master
                     WHERE type='index' AND name='set_contract_one_live_v2_idx'",
                )
                .unwrap(),
            0,
            "the v9 index must be dropped, not merely superseded"
        );

        store
            .test_execute_batch(&format!(
                "UPDATE set_contract SET set_state='legacy_open' WHERE set_id={}",
                original.block_id
            ))
            .unwrap();
        // A second ACTIVE row is still rejected.
        let error = store
            .test_execute_batch(&format!(
                "UPDATE set_contract SET set_state='active' WHERE set_id={}",
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

        // The relaxation itself: PAUSED no longer conflicts with an existing
        // ACTIVE row — `replacement` stays active throughout.
        store
            .test_execute_batch(&format!(
                "UPDATE set_contract SET set_state='paused' WHERE set_id={}",
                original.block_id
            ))
            .unwrap();
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={}",
                    original.block_id
                ))
                .unwrap(),
            "paused"
        );
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={}",
                    replacement.block_id
                ))
                .unwrap(),
            "active",
            "the pre-existing active row is unaffected"
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
                "DROP INDEX set_contract_one_active_v2_idx;
                 UPDATE set_contract SET set_state='active' WHERE set_id={0};
                 UPDATE rep_block SET status='open' WHERE id={0};",
                original.block_id
            ))
            .unwrap();
        let rows_before = store
            .test_scalar_i64("SELECT count(*) FROM rep_block")
            .unwrap();
        drop(engine);
        drop(store);

        let reopened = Arc::new(Store::open(&path).unwrap());
        let sessions = Arc::new(SessionService::new(reopened.clone()));
        let malformed = RepEngine::new(reopened.clone(), sessions);
        let state_error = malformed.state().unwrap_err();
        assert!(
            state_error.contains("multiple active practice sets"),
            "{state_error}"
        );
        let open_error = malformed.open(strict_notes_args(pid, 3)).unwrap_err();
        assert_eq!(open_error, state_error);
        assert_eq!(
            reopened
                .test_scalar_i64("SELECT count(*) FROM rep_block")
                .unwrap(),
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
                &IncrementRule {
                    clean_needed: 3,
                    bpm_step: 4.0,
                },
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
                &IncrementRule {
                    clean_needed: 3,
                    bpm_step: 4.0,
                },
                5,
                &[],
                "notes",
                false,
            )
            .unwrap();
        store
            .insert_rep(block_id, -1.0, None, "clean", None)
            .unwrap();
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
                &IncrementRule {
                    clean_needed: 3,
                    bpm_step: 4.0,
                },
                5,
                &[],
                "notes",
                true,
            )
            .unwrap();
        store
            .insert_rep(block_id, 0.0, None, "clean", None)
            .unwrap();
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
                &IncrementRule {
                    clean_needed: 3,
                    bpm_step: 4.0,
                },
                5,
                &[],
                "tempo",
                true,
            )
            .unwrap();
        store
            .insert_rep(block_id, 0.0, None, "clean", None)
            .unwrap();
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
                &IncrementRule {
                    clean_needed: 1,
                    bpm_step: 4.0,
                },
                3,
                &[],
                "tempo",
                true,
            )
            .unwrap();
        for _ in 0..3 {
            store
                .insert_rep(block_id, 60.0, None, "clean", None)
                .unwrap();
        }

        let history = store.block_row(block_id).unwrap().unwrap();
        assert_eq!(
            history.bpm,
            Some(60.0),
            "factual legacy tempo remains visible"
        );
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
        value.increment = Some(IncrementRule {
            clean_needed: 0,
            bpm_step: 4.0,
        });
        invalid.push(value);
        let mut value = base.clone();
        value.increment = Some(IncrementRule {
            clean_needed: 3,
            bpm_step: 0.0,
        });
        invalid.push(value);
        let mut value = base.clone();
        value.increment = Some(IncrementRule {
            clean_needed: 3,
            bpm_step: f64::NAN,
        });
        invalid.push(value);
        let mut value = base.clone();
        value.planned_reps = Some(0);
        invalid.push(value);
        let mut value = base.clone();
        value.variants = vec![VariantSpec {
            name: " ".into(),
            reps: 1,
        }];
        invalid.push(value);
        let mut value = base;
        value.variants = vec![VariantSpec {
            name: "hands".into(),
            reps: 0,
        }];
        invalid.push(value);

        for args in invalid {
            assert!(engine.open(args).is_err());
        }
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM rep_block")
                .unwrap(),
            0
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM set_contract")
                .unwrap(),
            0
        );
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM event").unwrap(),
            0
        );
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
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(),
            0
        );
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
        assert_eq!(
            store.test_scalar_i64("SELECT count(*) FROM rep").unwrap(),
            0
        );
        assert_eq!(engine.snapshot().unwrap().tries, 0);
    }

    fn tempo_args(piece_id: i64, target_bpm: f64) -> RepOpenArgs {
        RepOpenArgs {
            piece_id,
            region_id: None,
            m_start: 1,
            m_end: 8,
            label: None,
            start_bpm: 60.0,
            target_bpm: Some(target_bpm),
            planned_reps: None,
            required_clean_streak: Some(3),
            increment: None,
            variants: vec![],
            focus: "tempo".into(),
            use_metronome: true,
        }
    }

    // Task A4 note: originally the brief's acceptance test (seed two pieces,
    // pause one set each, one active elsewhere → `sets_paused_list` returns
    // exactly the two paused rows, newest-paused first) was schema-impossible
    // under `set_contract_one_live_v2_idx` (SCHEMA_V9), which allowed at most
    // ONE live (active OR paused) row database-wide. Task A4b (SCHEMA_V14)
    // relaxed that to `set_contract_one_active_v2_idx` — one ACTIVE row max,
    // any number paused — so the two tests below still cover the
    // single-paused-row join/field-mapping/exclusion behavior, and the
    // fixture test further down (`sets_paused_list_returns_two_paused_sets_...`)
    // now builds and asserts the real multi-row/newest-first fixture.
    #[test]
    fn sets_paused_list_returns_the_paused_set_with_correct_join_fields_and_streak() {
        let (engine, pid, store, _rec) = engine_with_piece();
        assert!(
            store.paused_sets_list().unwrap().is_empty(),
            "nothing paused yet"
        );

        let opened = engine.open(tempo_args(pid, 90.0)).unwrap();
        // One clean rep before pausing, so `current_clean_streak` proves it
        // is reusing the live projection rather than always reporting 0.
        engine.check(RepVerdict::Clean, None).unwrap();
        engine.pause("test-pause-1").unwrap();

        let rows = store.paused_sets_list().unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.set_id, opened.block_id);
        assert_eq!(row.block_id, opened.block_id);
        assert_eq!(row.piece_id, pid);
        assert_eq!(row.piece_title, "Scherzo");
        assert_eq!(row.m_start, 1);
        assert_eq!(row.m_end, 8);
        assert_eq!(row.bpm, 60);
        assert_eq!(row.target_bpm, 90);
        assert_eq!(row.current_clean_streak, 1);
        assert!(!row.paused_since_ts.is_empty());

        // Resuming takes it out of the tray.
        engine.resume("test-resume-1", None).unwrap();
        assert!(store.paused_sets_list().unwrap().is_empty());
    }

    #[test]
    fn sets_paused_list_excludes_sets_in_any_other_state() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let pid2 = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/Debussy - Clair de Lune".into(),
                title: "Clair de Lune".into(),
                composer: Some("Debussy".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();

        let opened = engine.open(tempo_args(pid, 90.0)).unwrap();
        engine.pause("test-pause-1").unwrap();

        // A second, unrelated set that never went through 'active'/'paused'
        // (so it never touches the single-live-set unique index) — proves
        // the WHERE clause, not just an accidental single-row table.
        store
            .test_execute_batch(&format!(
                "INSERT INTO rep_block
                     (id,piece_id,m_start,m_end,focus,use_metronome,status,
                      start_bpm,target_bpm,planned_reps,variants)
                 VALUES (9002,{pid2},1,8,'tempo',1,'done',60.0,100.0,0,'[]');
                 INSERT INTO set_contract
                     (set_id,contract_version,name,rationale,mastery_basis,required_success,
                      reset_on_flawed,reset_on_failed,recovery_policy,set_state,
                      mastery_verification,source)
                 VALUES (9002,1,'Seed mastered set','A non-paused control row.',
                         'consecutive_clean',3,1,0,'none','mastered','verified','user_click');"
            ))
            .unwrap();

        let rows = store.paused_sets_list().unwrap();
        assert_eq!(rows.len(), 1, "only the genuinely paused set");
        assert_eq!(rows[0].set_id, opened.block_id);
        assert_eq!(rows[0].piece_id, pid);
    }

    /// Task A4b: the real A4 acceptance fixture — two pieces each paused, one
    /// active elsewhere. Schema-impossible before this task (see the A4 note
    /// above); now buildable through the ordinary engine write path because
    /// `open_from`'s in-memory guard and `open_set_in_tx`'s DB-level guard
    /// both relaxed from "blocks on active-or-paused" to "blocks on active
    /// only" (SCHEMA_V14's `set_contract_one_active_v2_idx`). Also proves two
    /// paused rows coexist and the newest-paused-first ordering.
    #[test]
    fn sets_paused_list_returns_two_paused_sets_newest_first_with_one_active_elsewhere() {
        let (engine, pid1, store, _rec) = engine_with_piece();
        let pid2 = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/Debussy - Clair de Lune".into(),
                title: "Clair de Lune".into(),
                composer: Some("Debussy".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let pid3 = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/Ravel - Jeux d'eau".into(),
                title: "Jeux d'eau".into(),
                composer: Some("Ravel".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();

        let opened1 = engine.open(tempo_args(pid1, 90.0)).unwrap();
        engine.pause("fixture-pause-1").unwrap();

        let opened2 = engine.open(tempo_args(pid2, 80.0)).unwrap();
        engine.pause("fixture-pause-2").unwrap();

        // The third set stays active elsewhere — never paused.
        let opened3 = engine.open(tempo_args(pid3, 70.0)).unwrap();
        assert_eq!(opened3.set_state, "active");

        let rows = store.paused_sets_list().unwrap();
        assert_eq!(rows.len(), 2, "two paused rows coexist");
        assert_eq!(
            rows[0].set_id, opened2.block_id,
            "newest-paused (opened2) first"
        );
        assert_eq!(rows[1].set_id, opened1.block_id);
        assert!(
            rows.iter().all(|row| row.set_id != opened3.block_id),
            "the active set never appears in the paused tray"
        );
    }

    /// Task A4b: `rep_resume` targeting a set OTHER than the one currently
    /// active auto-pauses the old active set and activates the target, in one
    /// transaction — the receipt reflects both transitions.
    #[test]
    fn resume_with_another_active_auto_pauses_old_and_activates_target_atomically() {
        let (engine, pid1, store, _rec) = engine_with_piece();
        let pid2 = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/Debussy - Clair de Lune".into(),
                title: "Clair de Lune".into(),
                composer: Some("Debussy".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();

        let opened1 = engine.open(tempo_args(pid1, 90.0)).unwrap();
        engine.pause("auto-pause-fixture-1").unwrap();
        let opened2 = engine.open(tempo_args(pid2, 80.0)).unwrap();
        assert_eq!(opened2.set_state, "active");

        let receipt = engine
            .resume("resume-target-1", Some(opened1.block_id))
            .unwrap();
        assert_eq!(receipt.status, "committed");
        let snap = receipt.value.clone().unwrap();
        assert_eq!(snap.block_id, opened1.block_id);
        assert_eq!(snap.set_state, "active");
        assert!(
            receipt.summary.contains("Paused") && receipt.summary.contains("Resumed"),
            "{}",
            receipt.summary
        );
        assert_eq!(receipt.entity_refs.len(), 2);

        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={}",
                    opened1.block_id
                ))
                .unwrap(),
            "active"
        );
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={}",
                    opened2.block_id
                ))
                .unwrap(),
            "paused",
            "the previously active set was auto-paused"
        );
    }

    /// Task A4b: a mid-transaction failure during the auto-pause-then-resume
    /// leaves BOTH sets exactly as they were — the receipt's atomicity is not
    /// just claimed but exercised.
    #[test]
    fn resume_with_another_active_rolls_back_both_transitions_on_injected_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("resume-atomic.sqlite");
        let (engine, pid1, store) = engine_with_piece_at(&path);
        let pid2 = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/Debussy - Clair de Lune".into(),
                title: "Clair de Lune".into(),
                composer: Some("Debussy".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();

        let opened1 = engine.open(tempo_args(pid1, 90.0)).unwrap();
        engine.pause("rollback-fixture-1").unwrap();
        let opened2 = engine.open(tempo_args(pid2, 80.0)).unwrap();

        // Fires on `start_interval`'s INSERT for the TARGET's activation —
        // i.e. strictly after the other set's pause writes have already
        // happened inside the same transaction, so a real partial-commit bug
        // would leave `opened2` paused even though the overall op failed.
        store
            .test_execute_batch(
                "CREATE TRIGGER fail_resume_interval BEFORE INSERT ON practice_interval
                 BEGIN SELECT RAISE(ABORT,'injected resume failure'); END;",
            )
            .unwrap();

        let failed = engine.resume("resume-target-fail-1", Some(opened1.block_id));
        assert!(failed.is_err());

        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={}",
                    opened1.block_id
                ))
                .unwrap(),
            "paused",
            "target must remain paused when the transaction rolls back"
        );
        assert_eq!(
            store
                .test_scalar_string(&format!(
                    "SELECT set_state FROM set_contract WHERE set_id={}",
                    opened2.block_id
                ))
                .unwrap(),
            "active",
            "the auto-paused set must roll back to active too"
        );
    }

    /// Task A4b fix round 1: `resume(None)`'s DB-wide fallback ("the only
    /// paused set") rejects outright when this engine instance is tracking
    /// nothing AND nothing in the database is paused.
    #[test]
    fn resume_none_errors_when_nothing_is_tracked_and_nothing_is_paused() {
        let (engine, _pid, _store, _rec) = engine_with_piece();
        let error = engine.resume("resume-empty-1", None).unwrap_err();
        assert_eq!(error, "no paused practice set");
    }

    /// Task A4b fix round 1: `resume(None)`'s DB-wide fallback rejects as
    /// ambiguous — rather than silently picking one — when this engine
    /// instance is tracking nothing and SEVERAL sets are paused. The two
    /// paused rows are seeded via raw SQL specifically so this engine never
    /// opens/pauses either through its own API — `self.active` stays `None`
    /// throughout, exercising the untracked fallback path, not the "resume
    /// my own tracked block" path.
    #[test]
    fn resume_none_errors_as_ambiguous_when_several_sets_are_paused_and_nothing_is_tracked() {
        let (engine, pid, store, _rec) = engine_with_piece();
        let pid2 = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/Debussy - Clair de Lune".into(),
                title: "Clair de Lune".into(),
                composer: Some("Debussy".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();

        store
            .test_execute_batch(&format!(
                "INSERT INTO rep_block
                     (id,piece_id,m_start,m_end,focus,use_metronome,status,
                      start_bpm,target_bpm,planned_reps,variants)
                 VALUES (9101,{pid},1,8,'tempo',1,'open',60.0,90.0,0,'[]');
                 INSERT INTO set_contract
                     (set_id,contract_version,name,rationale,mastery_basis,required_success,
                      reset_on_flawed,reset_on_failed,recovery_policy,set_state,
                      mastery_verification,source)
                 VALUES (9101,1,'Seed paused A','Untracked fixture row.',
                         'consecutive_clean',3,1,0,'none','paused','verified','user_click');
                 INSERT INTO rep_block
                     (id,piece_id,m_start,m_end,focus,use_metronome,status,
                      start_bpm,target_bpm,planned_reps,variants)
                 VALUES (9102,{pid2},1,8,'tempo',1,'open',60.0,90.0,0,'[]');
                 INSERT INTO set_contract
                     (set_id,contract_version,name,rationale,mastery_basis,required_success,
                      reset_on_flawed,reset_on_failed,recovery_policy,set_state,
                      mastery_verification,source)
                 VALUES (9102,1,'Seed paused B','Untracked fixture row.',
                         'consecutive_clean',3,1,0,'none','paused','verified','user_click');"
            ))
            .unwrap();

        let error = engine.resume("resume-ambiguous-1", None).unwrap_err();
        assert_eq!(
            error,
            "multiple sets are paused; choose which one to resume"
        );
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
        store
            .test_execute_batch("DROP TRIGGER fail_v2_close;")
            .unwrap();
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
