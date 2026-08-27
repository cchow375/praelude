//! Serde types for the P3 data layer — the wire contract between the SQLite
//! store, the Tauri command boundary, and the React frontend.
//!
//! WHY these live in one module: the same struct is used in three places — read
//! out of SQLite, serialized across the Tauri IPC boundary, and consumed by the
//! frontend. Keeping them together means the JSON field names (which the
//! frontend hard-codes) have exactly one definition. All field names are
//! `snake_case` and serde's default (no `rename_all`) already emits them
//! verbatim, so what the DB columns are named, what Rust sees, and what crosses
//! the IPC boundary all line up.
//!
//! JSON-shaped SQLite columns (`goals`, `hard_spots`, `variants`,
//! `increment_rule`, `payload`) are stored as TEXT holding a serialized JSON
//! string; [`json_to_sql`]/[`json_from_sql`] are the single conversion seam so a
//! malformed value surfaces as a `rusqlite::Error` rather than a panic.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};

/// Serde normally collapses both an omitted field and an explicit JSON null
/// for nested Options. Patch commands need three states, so every present
/// field is wrapped in the outer Some here.
fn deserialize_nullable_patch<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// A piece as discovered by a read-only vault scan (see `vault::scan_pieces`).
///
/// This is the *only* input to [`Store::upsert_piece`](crate::store::Store::upsert_piece):
/// it carries the four fields a rescan is allowed to refresh (title, composer,
/// xml/pdf paths) keyed on `folder_path`. It deliberately holds none of the
/// human-authored intake fields — a rescan must never clobber those.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScanPiece {
    /// Absolute path of the piece folder. The upsert key (UNIQUE in SQL).
    pub folder_path: String,
    /// Display title parsed from the folder name.
    pub title: String,
    /// Composer parsed from the folder name (the part before `" - "`), if any.
    pub composer: Option<String>,
    /// First `*.musicxml`/`*.mxl` score found, if any.
    pub xml_path: Option<std::path::PathBuf>,
    /// First `*.pdf` score found, if any.
    pub pdf_path: Option<std::path::PathBuf>,
}

/// Row-level summary for the piece list. `has_xml`/`has_pdf` are derived
/// (`path IS NOT NULL`) so the frontend never sees raw filesystem paths in the
/// list view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PieceSummary {
    pub id: i64,
    pub title: String,
    pub composer: Option<String>,
    pub has_xml: bool,
    pub has_pdf: bool,
    pub intake_done: bool,
    /// Unix seconds when the piece was reversibly archived; `None` = active.
    pub archived_at: Option<i64>,
    /// Most recent recorded attempt timestamp, used for recent-first library
    /// ordering. `None` means the piece has never had a recorded attempt.
    pub last_practiced: Option<String>,
}

/// Full piece record for the detail view: the summary fields plus the paths and
/// all intake fields (deserialized out of their JSON columns).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PieceDetail {
    pub id: i64,
    pub title: String,
    pub composer: Option<String>,
    pub has_xml: bool,
    pub has_pdf: bool,
    pub intake_done: bool,
    pub archived_at: Option<i64>,
    pub last_practiced: Option<String>,
    pub folder_path: String,
    pub xml_path: Option<String>,
    pub pdf_path: Option<String>,
    pub goals: Vec<String>,
    pub deadline: Option<String>,
    pub target_tempo: Option<f64>,
    pub hard_spots: Vec<HardSpot>,
    pub current_state: Option<String>,
    pub notes: Option<String>,
    /// The one goal sentence pinned over this piece's score (schema v14).
    /// `None` = no banner. Bounded to 140 characters by both the Rust command
    /// and the column's CHECK constraint.
    pub banner_text: Option<String>,
}

/// One named page-range start inside a piece PDF (schema v17). The end page is
/// intentionally derived from the next movement's `start_page` and the live
/// document page count, so PDF replacement never leaves a stale stored end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PieceMovement {
    pub id: i64,
    pub piece_id: i64,
    pub title: String,
    pub start_page: u32,
    pub display_order: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PieceMovementCreate {
    pub piece_id: i64,
    pub title: String,
    pub start_page: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct PieceMovementPatch {
    pub title: Option<String>,
    pub start_page: Option<u32>,
    pub display_order: Option<i64>,
}

/// A trouble spot the user flagged during intake: a measure range and a note.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HardSpot {
    pub measures: String,
    pub note: String,
}

/// The user-authored intake payload. `save_intake` writes exactly these fields
/// (and flips `intake_done`); a later rescan preserves all of them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Intake {
    pub goals: Vec<String>,
    pub deadline: Option<String>,
    pub target_tempo: Option<f64>,
    pub hard_spots: Vec<HardSpot>,
    pub current_state: Option<String>,
}

/// A resolved tempo-increment rule for a rep block: after `clean_needed` clean
/// reps at the current tempo, bump the BPM by `bpm_step`. Stored resolved (an
/// `"auto"` request is resolved to concrete numbers when the block opens).
// Consumed by the Task 17 rep engine; only tests construct it in this task.
#[allow(dead_code)]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct IncrementRule {
    pub clean_needed: u32,
    pub bpm_step: f64,
    /// A1: per-set override of `rep.demote_enabled`. `None` = use the global
    /// setting. `#[serde(default)]` so old stored JSON (and the nullable
    /// `increment_rule` column) deserializes unchanged.
    #[serde(default)]
    pub demote_enabled: Option<bool>,
    /// A1: per-set override of `rep.demote_first` (consecutive sloppy reps
    /// before the first demotion in a set). `None` = use the global setting.
    #[serde(default)]
    pub demote_first: Option<u32>,
    /// A1: per-set override of `rep.demote_repeat` (consecutive sloppy reps
    /// required for subsequent demotions once `demoted_this_set` is true).
    /// `None` = use the global setting.
    #[serde(default)]
    pub demote_repeat: Option<u32>,
}

/// A1: the resolved tempo-demotion configuration for one projection. Resolved
/// OUTSIDE the store's `conn` lock (in `rep::mod`, from the per-set
/// [`IncrementRule`] overrides and the `rep.demote_*` settings) and passed in
/// as a plain parameter — never read from settings inside `project_tempo`,
/// which runs while the store's connection mutex is held (see the lock-trap
/// note on `project_tempo`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DemotionConfig {
    pub enabled: bool,
    /// Consecutive `flawed` reps before the first demotion in a set.
    pub first: u32,
    /// Consecutive `flawed` reps before each subsequent demotion, once a set
    /// has already demoted once (`demoted_this_set`).
    pub repeat: u32,
}

impl Default for DemotionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            first: 3,
            repeat: 2,
        }
    }
}

/// A named practice variant within a block (e.g. "hands separate", `reps`
/// planned for it).
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VariantSpec {
    pub name: String,
    pub reps: u32,
    /// A2: the clean-streak length that clears this stage before the chain
    /// auto-advances to the next one (or completes, at the last stage).
    /// `#[serde(default)]` because **legacy stored payloads have no such
    /// key** — `None` means "fall back to `reps`", which preserves today's
    /// per-rep lane cycling byte-for-byte for every set already on disk. No
    /// migration: this rides the existing `variants` JSON TEXT column.
    #[serde(default)]
    pub clean_streak: Option<u32>,
}

/// The note value a set's bpm number counts — a LABEL only. `ClickPattern.bpm`
/// (`audio/clock.rs`) has no note-value semantics anywhere in the engine: the
/// entered number IS the click rate. Changing `beat_unit` must never multiply,
/// divide, or otherwise convert the stored bpm — doing so would silently
/// change the tempo of every existing set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BeatUnit {
    #[default]
    Quarter,
    Eighth,
    DottedQuarter,
    Half,
}

/// A set's own metronome tuning (A5): the beat-unit label plus the engine's
/// existing `subdivision`/`beats_per_bar` dimensions (`audio/clock.rs:21-52`),
/// which already support 1-16 and are not locked to a quarter note. This
/// struct is what a set remembers between opens/restarts; `#[serde(default)]`
/// on every field means `{}` and every pre-v16 row (which has none of these
/// keys) deserialize to today's behaviour exactly (quarter / 1 / 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SetTuning {
    #[serde(default)]
    pub beat_unit: BeatUnit,
    #[serde(default = "default_subdivision")]
    pub subdivision: u8,
    #[serde(default = "default_beats_per_bar")]
    pub beats_per_bar: u8,
}

fn default_subdivision() -> u8 {
    1
}

fn default_beats_per_bar() -> u8 {
    4
}

impl Default for SetTuning {
    fn default() -> Self {
        SetTuning {
            beat_unit: BeatUnit::Quarter,
            subdivision: default_subdivision(),
            beats_per_bar: default_beats_per_bar(),
        }
    }
}

/// Tally of rep verdicts, used in block history and rep snapshots.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct VerdictCounts {
    pub clean: u32,
    pub flawed: u32,
    pub failed: u32,
}

/// A rep block plus its rolled-up rep counts — one row of a piece's block
/// history (`rep_blocks_for_piece`).
///
/// The serialized shape (field names + order) is a hard frontend contract:
/// `{ block_id, m_start, m_end, label, start_bpm, bpm, target_bpm, planned_reps,
/// reps_done, status, verdicts }`. `bpm` is the block's *latest* rep bpm (or
/// `start_bpm` when the block has no reps yet), so the history row shows where a
/// block topped out, not just where it started.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlockHistory {
    pub block_id: i64,
    pub m_start: u32,
    pub m_end: u32,
    pub label: Option<String>,
    pub start_bpm: Option<f64>,
    pub bpm: Option<f64>,
    pub target_bpm: Option<f64>,
    pub planned_reps: u32,
    /// Semantic v2 review boundary captured by the immutable contract. The
    /// physical `planned_reps` column is compatibility storage only.
    pub attempt_ceiling: Option<u32>,
    /// Provenance of the captured contract (`user_click`, `voice_hot_loop`, or
    /// `migration_legacy`); distinct from attempt provenance.
    pub contract_source: String,
    pub reps_done: u32,
    pub attempts_recorded: u32,
    pub tries: u32,
    pub voided_attempts: u32,
    pub current_clean_streak: u32,
    pub mastery_progress_streak: u32,
    pub best_clean_streak: u32,
    pub reset_count: u32,
    pub accuracy: Option<f64>,
    pub required_clean_streak: u32,
    pub effective_required_clean_streak: u32,
    pub recovery_remaining: u32,
    pub review_boundary_reached: bool,
    pub mastery_status: String,
    pub mastery_verified: bool,
    pub set_state: String,
    pub last_attempt_id: Option<i64>,
    pub last_adjustment_id: Option<i64>,
    pub status: String,
    pub verdicts: VerdictCounts,
    pub region_id: Option<i64>,
    pub focus: String,
    pub use_metronome: bool,
}

/// One session-log event as shown in the session view. `payload` is opaque JSON
/// (its shape depends on `kind`); the store round-trips it untouched.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionEventView {
    pub ts: String,
    pub kind: String,
    pub payload: serde_json::Value,
}

/// One row of the durable canonical `event` log (Task 2). Distinct from
/// [`SessionEventView`] (the live session-feed shape): this is the persistent
/// append-only record that export/metrics derive from, with nullable
/// `session_id`/`piece_id` FK links and the row `id`/`ts` exposed.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub id: i64,
    pub ts: String,
    pub session_id: Option<i64>,
    pub piece_id: Option<i64>,
    pub kind: String,
    pub payload: serde_json::Value,
}

// ── Rep engine wire types (Task 17) ───────────────────────────────────────

/// Arguments to open a rep block. Received from the frontend (`rep_open`) and
/// synthesized by the voice layer. Optional fields carry serde defaults so the
/// caller may omit them; `increment` unset means "auto-resolve the ladder".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepOpenArgs {
    pub piece_id: i64,
    /// When the block is opened from a selected score Tricky Section, preserve
    /// that explicit canonical relationship even if the user adjusts measures.
    /// Voice/general forms omit it and retain deterministic range-based linking.
    #[serde(default)]
    pub region_id: Option<i64>,
    pub m_start: u32,
    pub m_end: u32,
    #[serde(default)]
    pub label: Option<String>,
    /// Frontend non-tempo blocks intentionally send `null`. The live engine
    /// uses 0 as a harmless internal sentinel while SQLite stores NULL.
    #[serde(deserialize_with = "deserialize_nullable_bpm")]
    pub start_bpm: f64,
    #[serde(default)]
    pub target_bpm: Option<f64>,
    #[serde(default)]
    pub planned_reps: Option<u32>,
    /// v2 mastery target. Omitted snapshots the validated global default when
    /// the set opens; later setting changes cannot rewrite an existing set.
    #[serde(default)]
    pub required_clean_streak: Option<u32>,
    #[serde(default)]
    pub increment: Option<IncrementRule>,
    #[serde(default)]
    pub variants: Vec<VariantSpec>,
    /// The block's practice focus. Only a `"tempo"` block carries a tempo ladder;
    /// any other focus counts rep verdicts without advancing BPM. Defaults to
    /// `"tempo"` so existing callers (and JS payloads that omit it) are unchanged.
    #[serde(default = "default_focus")]
    pub focus: String,
    /// Whether a ladder step should retune the metronome. Defaults to `true`.
    #[serde(default = "default_use_metronome")]
    pub use_metronome: bool,
    /// A5: the set's own metronome tuning (beat-unit label + subdivision +
    /// beats-per-bar). Omitted by every existing caller and stored payload,
    /// so `#[serde(default)]` preserves today's behaviour exactly.
    #[serde(default)]
    pub tuning: SetTuning,
}

/// Optional per-set demotion policy supplied beside `RepOpenArgs`. Keeping it
/// separate lets an auto ladder resolve its clean/rung arithmetic natively,
/// then overlays only the three demotion fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DemotionOverride {
    pub enabled: bool,
    pub first: u32,
    pub repeat: u32,
}

/// Optional focus-loop evidence supplied beside `RepOpenArgs` at the IPC
/// boundary. Keeping it separate preserves all established voice/test struct
/// constructors while still capturing these fields atomically with set open.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SetFocusContextInput {
    #[serde(default)]
    pub intention: Option<String>,
    #[serde(default)]
    pub judging_axis: Option<String>,
    #[serde(default)]
    pub hands: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub planned_seconds: Option<u32>,
    #[serde(default)]
    pub reflection: Option<String>,
    /// Task A10: estimated seconds for one pass through the set's ladder.
    /// Persists to `set_contract.pass_seconds` (nullable, CHECK 1-3600); the
    /// column enforces the range so out-of-bounds values reject at the DB.
    #[serde(default)]
    pub pass_seconds: Option<i64>,
}

fn deserialize_nullable_bpm<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<f64>::deserialize(deserializer)?.unwrap_or(0.0))
}

#[cfg(test)]
mod nullable_bpm_tests {
    use super::*;

    #[test]
    fn rep_open_accepts_null_bpm_from_non_tempo_frontend() {
        let args: RepOpenArgs = serde_json::from_value(serde_json::json!({
            "piece_id": 1,
            "m_start": 1,
            "m_end": 8,
            "start_bpm": null,
            "focus": "notes",
            "use_metronome": false
        }))
        .unwrap();
        assert_eq!(args.start_bpm, 0.0);
    }

    /// A `RepOpenArgs` payload omitting `tuning` entirely (every existing
    /// caller and every stored pre-v16 payload) must load with today's
    /// defaults, never fail deserialization.
    #[test]
    fn rep_open_args_without_tuning_key_defaults_to_quarter_1_4() {
        let args: RepOpenArgs = serde_json::from_value(serde_json::json!({
            "piece_id": 1,
            "m_start": 1,
            "m_end": 8,
            "start_bpm": 80.0,
        }))
        .unwrap();
        assert_eq!(args.tuning, SetTuning::default());
        assert_eq!(args.tuning.beat_unit, BeatUnit::Quarter);
        assert_eq!(args.tuning.subdivision, 1);
        assert_eq!(args.tuning.beats_per_bar, 4);
    }
}

#[cfg(test)]
mod set_tuning_tests {
    use super::*;

    #[test]
    fn set_tuning_round_trips_through_json() {
        let tuning = SetTuning {
            beat_unit: BeatUnit::DottedQuarter,
            subdivision: 3,
            beats_per_bar: 6,
        };
        let raw = json_to_sql(&tuning).unwrap();
        let back: SetTuning = json_from_sql(&raw).unwrap();
        assert_eq!(tuning, back);
    }

    /// The empty-object default written by the v16 migration for every
    /// existing row must deserialize to quarter / 1 / 4 — today's behaviour.
    #[test]
    fn empty_json_object_yields_the_default_tuning() {
        let tuning: SetTuning = json_from_sql("{}").unwrap();
        assert_eq!(tuning, SetTuning::default());
        assert_eq!(tuning.beat_unit, BeatUnit::Quarter);
        assert_eq!(tuning.subdivision, 1);
        assert_eq!(tuning.beats_per_bar, 4);
    }

    /// A partial object (only `beat_unit` set, as a composer control might
    /// send) must default the remaining fields rather than fail to parse.
    #[test]
    fn partial_json_object_defaults_the_missing_fields() {
        let tuning: SetTuning = json_from_sql(r#"{"beat_unit":"eighth"}"#).unwrap();
        assert_eq!(tuning.beat_unit, BeatUnit::Eighth);
        assert_eq!(tuning.subdivision, 1);
        assert_eq!(tuning.beats_per_bar, 4);
    }

    #[test]
    fn beat_unit_serializes_to_the_documented_wire_strings() {
        assert_eq!(json_to_sql(&BeatUnit::Quarter).unwrap(), "\"quarter\"");
        assert_eq!(json_to_sql(&BeatUnit::Eighth).unwrap(), "\"eighth\"");
        assert_eq!(
            json_to_sql(&BeatUnit::DottedQuarter).unwrap(),
            "\"dotted_quarter\""
        );
        assert_eq!(json_to_sql(&BeatUnit::Half).unwrap(), "\"half\"");
    }

    /// `beat_unit` is a label, never a bpm conversion: changing it alone must
    /// not touch anything else stored in `SetTuning`.
    #[test]
    fn changing_beat_unit_does_not_touch_subdivision_or_beats_per_bar() {
        let mut tuning = SetTuning {
            beat_unit: BeatUnit::Quarter,
            subdivision: 2,
            beats_per_bar: 3,
        };
        tuning.beat_unit = BeatUnit::Half;
        assert_eq!(tuning.subdivision, 2);
        assert_eq!(tuning.beats_per_bar, 3);
    }
}

/// serde default for [`RepOpenArgs::focus`] / [`RepSnapshot::focus`].
pub(crate) fn default_focus() -> String {
    "tempo".to_string()
}

/// serde default for [`RepOpenArgs::use_metronome`] / [`RepSnapshot::use_metronome`].
pub(crate) fn default_use_metronome() -> bool {
    true
}

/// The most recent rep recorded in a block (for the snapshot's "last" field).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LastRep {
    pub verdict: String,
    pub note: Option<String>,
    pub bpm: Option<f64>,
}

/// Stable reference carried by a durable mutation receipt. It deliberately
/// avoids filesystem or UI identity and can outlive deletion of a projection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutationEntityRef {
    pub entity_type: String,
    pub entity_id: i64,
}

/// Outer write contract for V2.4 commands. Committed receipts are persisted in
/// `practice_operation`; rejected receipts are returned without practice-state
/// rows. `replayed` is true only when the same command id and fingerprint load
/// the already-committed value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MutationReceipt<T> {
    pub receipt_id: String,
    /// Stable delivery identity returned on both the first commit and replay.
    pub command_id: String,
    pub status: String,
    pub summary: String,
    pub value: Option<T>,
    pub entity_refs: Vec<MutationEntityRef>,
    pub event_ids: Vec<i64>,
    pub undo_action: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    /// True when this response loaded an already-committed operation.
    pub replayed: bool,
    pub committed_ts: Option<String>,
    /// Internal cache-adoption hint. Session identity is already represented by
    /// the durable event graph and is not part of the public receipt envelope.
    #[serde(skip)]
    pub(crate) session_id: Option<i64>,
}

impl<T> MutationReceipt<T> {
    pub fn rejected(
        command_id: impl Into<String>,
        code: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        let command_id = command_id.into();
        let detail = detail.into();
        Self {
            receipt_id: format!("rejected:{command_id}"),
            command_id,
            status: "rejected".into(),
            summary: detail.clone(),
            value: None,
            entity_refs: Vec::new(),
            event_ids: Vec::new(),
            undo_action: None,
            error_code: Some(code.into()),
            error_detail: Some(detail),
            replayed: false,
            committed_ts: None,
            session_id: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecoveryActionView {
    pub id: i64,
    pub kind: String,
    pub after_attempt_id: Option<i64>,
    pub payload: serde_json::Value,
    pub rationale: String,
    pub source: String,
    pub created_ts: String,
}

/// Accepted recovery choice. Every variant is explicit and deterministic; no
/// model output can enter this enum without first becoming a reviewed draft.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RecoveryActionRequest {
    ResetStreak {
        rationale: String,
    },
    CleanDebt {
        clean_count: u32,
        rationale: String,
    },
    TempoBackoff {
        bpm: f64,
        rationale: String,
    },
    NarrowTarget {
        m_start: u32,
        m_end: u32,
        rationale: String,
    },
    ChangeHands {
        hands: String,
        rationale: String,
    },
    ChangeMethod {
        method: String,
        rationale: String,
    },
    Break {
        #[serde(default)]
        planned_seconds: Option<u32>,
        rationale: String,
    },
    ScheduleRetention {
        due_date: String,
        #[serde(default)]
        condition: RetentionCondition,
        rationale: String,
    },
}

/// A concrete condition at which retention is scheduled or observed. This is
/// intentionally bounded and typed: arbitrary JSON cannot silently become a
/// contradictory future work instruction.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetentionCondition {
    #[serde(default)]
    pub bpm: Option<f64>,
    #[serde(default)]
    pub m_start: Option<u32>,
    #[serde(default)]
    pub m_end: Option<u32>,
    #[serde(default)]
    pub hands: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub judging_axis: Option<String>,
    #[serde(default)]
    pub required_clean_streak: Option<u32>,
    #[serde(default)]
    pub cold: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetentionDecision {
    ConfirmRetained,
    LowerWorkingCondition,
    ReopenTarget,
}

/// Reviewed evidence for resolving one retention check. Endpoint and decision
/// must agree; observed/next conditions keep lower/reopen evidence usable by a
/// future linked-set workflow without accepting opaque JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetentionResult {
    pub decision: RetentionDecision,
    pub note: String,
    pub checked_as_of: String,
    #[serde(default)]
    pub observed_condition: Option<RetentionCondition>,
    #[serde(default)]
    pub next_condition: Option<RetentionCondition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RetentionCheckView {
    pub id: i64,
    pub region_id: i64,
    pub source_set_id: Option<i64>,
    pub due_date: String,
    pub original_due_date: String,
    pub condition: RetentionCondition,
    pub state: String,
    pub result: Option<RetentionResult>,
    pub completed_ts: Option<String>,
    pub created_ts: String,
    pub updated_ts: String,
}

/// One persisted Brain conversation turn, loaded when a thread resumes.
/// `citations` is the parsed `citations_json` column; the frontend renders it
/// directly. Turns are always returned oldest→newest.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrainTurnRow {
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub citations: serde_json::Value,
    pub created_ts: String,
}

/// The active (most-recent non-cleared) Brain thread for a piece plus its
/// bounded recent turns. Returned by the resume-or-create accessor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrainThreadResume {
    pub thread_id: i64,
    pub turns: Vec<BrainTurnRow>,
}

/// Task A4: one row of the paused-sets tray — a set currently sitting in
/// `set_contract.set_state='paused'`, joined out to its piece and working
/// range. `paused_since_ts` is the timestamp of that set's most recent
/// `rep_pause` event (the same durable ledger `rep_pause`/`rep_resume`
/// already write); falls back to the contract's `created_ts` for a paused
/// row with no recorded pause event (legacy/migrated data only — every
/// pause taken through `rep_pause` always has one).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PausedSetRow {
    pub set_id: i64,
    pub block_id: i64,
    pub piece_id: i64,
    pub piece_title: String,
    pub m_start: i64,
    pub m_end: i64,
    pub bpm: i64,
    pub target_bpm: i64,
    pub paused_since_ts: String,
    pub current_clean_streak: i64,
}

/// Read-only summary of one recent recovery action, for Brain grounding only.
/// Carries no internal set/attempt ids; `m_start`/`m_end` locate the set and
/// `region_id` is resolved to a name by the context builder, never serialized.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecoveryActionRow {
    pub kind: String,
    pub rationale: String,
    pub created_ts: String,
    pub m_start: u32,
    pub m_end: u32,
    pub region_id: Option<i64>,
}

/// The full live state of the active rep block. Emitted as `rep://state`,
/// returned by `rep_open`/`rep_state`, and carried inside a [`CheckOutcome`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepSnapshot {
    pub block_id: i64,
    pub piece_id: i64,
    pub piece_title: String,
    /// Canonical Region judged by this set, when it has one.
    #[serde(default)]
    pub region_id: Option<i64>,
    /// The Region's persistent sound target (`region.notes`) projected into
    /// the hot loop so the verdict surface can show/edit it without guessing.
    #[serde(default)]
    pub sound_target: Option<String>,
    pub m_start: u32,
    pub m_end: u32,
    pub label: Option<String>,
    /// The block's current working tempo. Non-tempo sets carry no fabricated BPM.
    pub bpm: Option<f64>,
    pub start_bpm: f64,
    pub target_bpm: Option<f64>,
    pub planned_reps: u32,
    /// Semantic review boundary from the immutable contract. `planned_reps` is
    /// retained only for physical v1 compatibility.
    pub attempt_ceiling: Option<u32>,
    pub contract_source: String,
    pub reps_done: u32,
    /// Durable v2 ledger projection. `reps_done` remains a compatibility alias
    /// for `tries`; physical `planned_reps` is never a mastery condition.
    pub attempts_recorded: u32,
    pub tries: u32,
    pub voided_attempts: u32,
    pub current_clean_streak: u32,
    pub mastery_progress_streak: u32,
    pub best_clean_streak: u32,
    pub reset_count: u32,
    pub accuracy: Option<f64>,
    pub required_clean_streak: u32,
    pub effective_required_clean_streak: u32,
    pub recovery_remaining: u32,
    pub review_boundary_reached: bool,
    pub mastery_status: String,
    pub mastery_verified: bool,
    pub set_state: String,
    pub last_attempt_id: Option<i64>,
    pub last_adjustment_id: Option<i64>,
    /// Clean reps accumulated at the current rung; resets to 0 on a step.
    pub cleans_at_step: u32,
    pub rule: IncrementRule,
    /// The current clean-streak chain stage, if the block has variants. This is
    /// also the variant attributed to the next attempt; Sloppy/Again never move
    /// it merely by increasing the raw attempt count.
    pub variant: Option<String>,
    pub variants: Vec<VariantSpec>,
    pub verdicts: VerdictCounts,
    pub last: Option<LastRep>,
    pub status: String,
    /// The block's practice focus (see [`RepOpenArgs::focus`]). Gates the ladder:
    /// only `"tempo"` advances BPM.
    #[serde(default = "default_focus")]
    pub focus: String,
    /// Whether a ladder step retunes the metronome (see [`RepOpenArgs::use_metronome`]).
    #[serde(default = "default_use_metronome")]
    pub use_metronome: bool,
    /// Persisted focus time. Only closed/checkpointed interval time counts;
    /// pauses and relaunch gaps are excluded by construction.
    #[serde(default)]
    pub active_seconds: u32,
    #[serde(default)]
    pub timer_state: String,
    #[serde(default)]
    pub intention: Option<String>,
    #[serde(default)]
    pub judging_axis: String,
    #[serde(default)]
    pub hands: String,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub planned_seconds: Option<u32>,
    #[serde(default)]
    pub reflection: Option<String>,
    #[serde(default)]
    pub safety_state: String,
    #[serde(default)]
    pub manual_clean_debt: u32,
    #[serde(default)]
    pub recovery_actions: Vec<RecoveryActionView>,
    #[serde(default)]
    pub retention_check: Option<RetentionCheckView>,
    #[serde(default)]
    pub working_m_start: u32,
    #[serde(default)]
    pub working_m_end: u32,
    /// A5: the set's own metronome tuning. See [`RepOpenArgs::tuning`].
    #[serde(default)]
    pub tuning: SetTuning,
    /// A1: consecutive `flawed` reps accumulated toward the next automatic
    /// demotion. Resets to 0 on a `clean` rep or a demotion; untouched by
    /// `failed`.
    #[serde(default)]
    pub current_sloppy_streak: u32,
    /// A1: whether an automatic demotion has occurred anywhere in this set.
    /// Once true, the demotion threshold for the rest of the set is
    /// `rep.demote_repeat` rather than `rep.demote_first`.
    #[serde(default)]
    pub demoted_this_set: bool,
    /// A2: the 0-based index of the current stage in the block's variant
    /// chain. `None` when the block has no variants — the chain is a no-op,
    /// exactly like today.
    #[serde(default)]
    pub variant_stage_index: Option<usize>,
    /// A2: clean reps landed so far at the current stage.
    #[serde(default)]
    pub variant_stage_cleans: u32,
    /// A2: clean reps required to clear the current stage (the stage's own
    /// `clean_streak`, or its `reps` for a legacy variant).
    #[serde(default)]
    pub variant_stage_required: u32,
    /// A2: the name of the stage after the current one, for the HUD's
    /// "next: …" headline. `None` at the last stage or with no variants.
    #[serde(default)]
    pub next_variant_stage_name: Option<String>,
    /// A2: whether every stage in the chain has been cleared this pass. With
    /// a tempo ladder this coincides with a step (the chain then restarts at
    /// the new tempo); without one, it means the set itself is complete.
    #[serde(default)]
    pub variant_chain_complete: bool,
}

/// The result of recording one rep (`rep_check`): the updated snapshot, the new
/// tempo if the rep stepped the ladder, whether the block just completed, and the
/// spoken/UI line — composed once in the engine so voice and UI never diverge.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CheckOutcome {
    pub snap: RepSnapshot,
    pub new_bpm: Option<f64>,
    pub block_done: bool,
    pub say: String,
    #[serde(default)]
    pub receipt: Option<MutationReceipt<RepSnapshot>>,
}

/// A session and its event log for the frontend session panel. `events` are
/// newest-first and capped; `started_at` is RFC3339 UTC.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionView {
    pub id: i64,
    pub started_at: String,
    pub events: Vec<SessionEventView>,
}

/// The outcome of ending a session and writing its vault summary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportResult {
    pub session_id: i64,
    pub files: Vec<String>,
    pub pieces: u32,
    pub reps: u32,
}

// ── Regions, goals, and the T3-T7 CRUD wire types ─────────────────────────

/// A named span of measures within a piece (a section, phrase, or hard spot).
/// `order` is the wire name for the SQL `sort_order` column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Region {
    pub id: i64,
    pub piece_id: i64,
    /// Short, scannable header shown in the Tricky Sections list.
    pub name: String,
    /// Longer practice instruction, deliberately independent from `name`.
    pub notes: Option<String>,
    pub m_start: u32,
    pub m_end: u32,
    pub kind: String,
    #[serde(rename = "order")]
    pub order: i64,
    pub color: Option<String>,
    /// Reserved for P4 (score-viewer anchor); opaque JSON, unused this phase.
    pub pdf_anchor: Option<serde_json::Value>,
    /// Task C5: the sub-section's parent region, from `target_meta`. `None`
    /// for every region that is not a child (which is every region that
    /// existed before this task). Nesting is capped at one level — a region
    /// with `parent_region_id` set can never itself be a parent.
    #[serde(default)]
    pub parent_region_id: Option<i64>,
}

/// Arguments to create a region.
#[derive(Debug, Clone, Deserialize)]
pub struct RegionCreate {
    pub piece_id: i64,
    pub name: String,
    #[serde(default)]
    pub notes: Option<String>,
    pub m_start: u32,
    pub m_end: u32,
    pub kind: String,
}

/// Task C5: `region_delete` mode when the region being deleted has children
/// (via `target_meta.parent_region_id`). Irrelevant (either behaves
/// identically) when the region has no children, so it defaults to the mode
/// closest to the old unconditional-delete behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RegionDeleteMode {
    /// Delete the region and every child region too.
    #[default]
    Cascade,
    /// Delete only the region; its children survive as top-level regions
    /// (their `parent_region_id` is cleared).
    Promote,
}

/// A partial region update. Every field is `Option`-absent-means-unchanged;
/// `color` and `pdf_anchor` are additionally nullable (outer `None` = leave,
/// `Some(None)` = clear, `Some(Some(v))` = set).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct RegionPatch {
    pub name: Option<String>,
    /// Outer `None` leaves notes unchanged; `Some(None)` clears them.
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub notes: Option<Option<String>>,
    pub m_start: Option<u32>,
    pub m_end: Option<u32>,
    pub kind: Option<String>,
    #[serde(rename = "order")]
    pub order: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub color: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub pdf_anchor: Option<Option<serde_json::Value>>,
}

// ── Local tutorial videos and per-Region clips ───────────────────────────

/// One seekable excerpt of a local tutorial video mapped to a Region.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TutorialClip {
    pub id: i64,
    pub chapter_id: i64,
    pub video_id: i64,
    pub region_id: i64,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub title: String,
    pub notes: Option<String>,
    #[serde(rename = "order")]
    pub order: i64,
}

/// Metadata for a local video. `file_path` is streamed through Tauri's asset
/// protocol by the frontend; video bytes never cross IPC.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TutorialVideo {
    pub id: i64,
    pub piece_id: i64,
    pub title: String,
    pub file_path: String,
    pub duration_seconds: Option<f64>,
    pub clips: Vec<TutorialClip>,
}

/// Explicit registration/upsert boundary for a file already inside the
/// piece's `tutorials/` directory.
#[derive(Debug, Clone, Deserialize)]
pub struct TutorialVideoUpsert {
    pub piece_id: i64,
    pub title: String,
    pub file_path: String,
    #[serde(default)]
    pub duration_seconds: Option<f64>,
}

/// Mutable video metadata. `duration_seconds: null` clears a value populated
/// from the HTML video element after metadata loads.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct TutorialVideoPatch {
    pub title: Option<String>,
    pub file_path: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub duration_seconds: Option<Option<f64>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TutorialClipCreate {
    pub video_id: i64,
    pub region_id: i64,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub title: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(rename = "order")]
    pub order: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct TutorialClipPatch {
    pub video_id: Option<i64>,
    pub region_id: Option<i64>,
    pub start_seconds: Option<f64>,
    pub end_seconds: Option<f64>,
    pub title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub notes: Option<Option<String>>,
    #[serde(rename = "order")]
    pub order: Option<i64>,
}

/// A single logged rep, as read back by [`reps_for_block`](crate::store::Store::reps_for_block).
/// Lands with T3: `reps_for_block` is one of the shared readers T3 introduces
/// (see foundation-context.md), so its return-element type lands alongside it
/// rather than waiting for T5 (which only adds [`RepPatch`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rep {
    pub id: i64,
    pub block_id: i64,
    pub ts: String,
    pub bpm: Option<f64>,
    pub variant: Option<String>,
    pub verdict: String,
    pub note: Option<String>,
    pub original_verdict: String,
    pub voided: bool,
    pub source: String,
    pub active_adjustment_ids: Vec<i64>,
}

/// Compatibility wire shape for the retired physical block-edit endpoint.
/// Deserialization remains stable for old callers, but the store now rejects
/// every patch because practice-set source rows are immutable evidence.
#[allow(dead_code)]
#[derive(Debug, Clone, Default, Deserialize)]
pub struct BlockPatch {
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub label: Option<Option<String>>,
    pub m_start: Option<u32>,
    pub m_end: Option<u32>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub start_bpm: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub target_bpm: Option<Option<f64>>,
    pub planned_reps: Option<u32>,
    pub focus: Option<String>,
    pub use_metronome: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub region_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub increment_rule: Option<Option<IncrementRule>>,
}

/// A partial rep edit: verdict is a plain replace, `note` is nullable.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct RepPatch {
    pub verdict: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub note: Option<Option<String>>,
}

/// A practice goal for a piece ("big" top-level or a "sub" goal under a
/// parent). `order` is the wire name for the SQL `sort_order` column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Goal {
    pub id: i64,
    pub piece_id: i64,
    pub text: String,
    pub kind: String,
    pub parent_goal_id: Option<i64>,
    pub done: bool,
    #[serde(rename = "order")]
    pub order: i64,
    pub target_date: Option<String>,
    pub created_ts: String,
}

/// Arguments to create a goal.
#[derive(Debug, Clone, Deserialize)]
pub struct GoalCreate {
    pub piece_id: i64,
    pub text: String,
    pub kind: String,
    pub parent_goal_id: Option<i64>,
    pub target_date: Option<String>,
}

/// A partial goal update; `target_date`/`parent_goal_id` are nullable.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct GoalPatch {
    pub text: Option<String>,
    pub done: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub target_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub parent_goal_id: Option<Option<i64>>,
}

// ── P5.5 daily-work wire types ─────────────────────────────────────────────

/// Exact `daily_work_create` payload. The wire names intentionally match the
/// public runtime contract (`minutes`, `date`) while the stored row uses the
/// more explicit `planned_minutes` and `scheduled_date` names.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct DailyWorkCreate {
    pub goal_id: i64,
    pub region_id: Option<i64>,
    pub block_id: Option<i64>,
    pub title: String,
    pub minutes: u32,
    pub date: String,
    pub source: String,
}

/// Mutable daily-work fields. Omitted means unchanged; nested options preserve
/// the existing nullable-patch convention. `origin_date`, provenance `source`,
/// and Goal ownership are intentionally absent and therefore immutable.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct DailyWorkPatch {
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub region_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub block_id: Option<Option<i64>>,
    pub title: Option<String>,
    pub planned_minutes: Option<u32>,
    pub scheduled_date: Option<String>,
    pub status: Option<String>,
    pub sort_order: Option<i64>,
}

/// A partial edit to a piece's inline-editable intake metadata. Every field is
/// nullable (absent = unchanged, `Some(None)` = clear, `Some(Some(v))` = set).
/// Deliberately does not append an `event` row: this is metadata, not part of
/// the practice-event stream metrics derive from.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PieceFieldPatch {
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub current_state: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub deadline: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub target_tempo: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_nullable_patch")]
    pub notes: Option<Option<String>>,
}

// ── Derived-metrics wire types (Task 9) ───────────────────────────────────

/// Minimal per-block metadata the metrics layer groups on: which region a block
/// belongs to and its practice focus. Read by [`Store::blocks_meta`](crate::store::Store::blocks_meta);
/// not itself sent to the frontend (it feeds the pure metric functions).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlockMeta {
    pub block_id: i64,
    pub region_id: Option<i64>,
    pub focus: String,
}

/// Rolled-up practice mastery for one region: how many blocks/reps it holds, the
/// fraction of reps that were clean, the fastest clean tempo reached, and when it
/// was last practiced.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RegionMastery {
    pub region_id: i64,
    pub name: String,
    pub blocks: u32,
    pub reps: u32,
    pub clean_ratio: f64,
    pub best_bpm: Option<f64>,
    pub last_practiced: Option<String>,
}

/// Focused practice seconds attributed to one practice `focus` (e.g. "tempo",
/// "notes"), derived from the event-gap heuristic within that focus's blocks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FocusTime {
    pub focus: String,
    pub seconds: u64,
}

/// A piece's derived progress dashboard, assembled by the `progress_summary`
/// command from the durable event log + canonical graph. All fields are derived
/// (never stored) so they always reflect the current graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProgressSummary {
    pub piece_id: i64,
    pub focused_seconds: u64,
    pub per_region_mastery: Vec<RegionMastery>,
    pub streak: u32,
    pub best_tempo_reached: Option<f64>,
    pub time_by_focus: Vec<FocusTime>,
}

/// Persisted geometry for one movable UI panel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PanelGeometry {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub collapsed: bool,
    pub z: i64,
}

/// The complete floating-panel layout, stored as one JSON setting so updates
/// are atomic and future panel types can be added without a schema migration.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PanelLayout {
    pub panels: Vec<PanelGeometry>,
}

/// Convert a SQLite-native timestamp (`"YYYY-MM-DD HH:MM:SS"`, always UTC via
/// `datetime('now')`) into the RFC3339 form the frontend expects
/// (`"YYYY-MM-DDTHH:MM:SSZ"`). SQLite stays native; conversion happens only at
/// the command/emit boundary. Idempotent: a value that already looks RFC3339
/// (has a `T` or trailing `Z`) is returned unchanged.
pub(crate) fn sqlite_ts_to_rfc3339(ts: &str) -> String {
    if ts.is_empty() || ts.contains('T') || ts.ends_with('Z') {
        return ts.to_string();
    }
    format!("{}Z", ts.replacen(' ', "T", 1))
}

/// One `data_anomaly` row as read from SQLite. Crate-private: the frontend
/// never sees this raw record. The `anomalies` module parses
/// `observed_facts_json` and groups these into the serialized wire report.
/// `observed_facts_json` is kept as the stored TEXT so the reader — not the
/// store — owns the JSON parse seam.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AnomalyRow {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: i64,
    pub kind: String,
    pub observed_facts_json: String,
    pub severity: String,
    pub review_state: String,
    pub created_ts: String,
    pub reviewed_ts: Option<String>,
}

/// Serialize a value into the TEXT form stored in a JSON-shaped column,
/// mapping any serde failure into a `rusqlite` error (never a panic).
pub(crate) fn json_to_sql<T: Serialize + ?Sized>(value: &T) -> rusqlite::Result<String> {
    serde_json::to_string(value).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
}

/// Deserialize a value out of a JSON-shaped TEXT column, mapping any serde
/// failure into a `rusqlite` error (never a panic).
pub(crate) fn json_from_sql<T: DeserializeOwned>(text: &str) -> rusqlite::Result<T> {
    serde_json::from_str(text).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}

#[cfg(test)]
mod nullable_patch_tests {
    use super::*;

    #[test]
    fn json_patch_distinguishes_omitted_null_and_value() {
        let omitted: RegionPatch = serde_json::from_str("{}").unwrap();
        assert!(omitted.notes.is_none());
        assert!(omitted.color.is_none());
        assert!(omitted.pdf_anchor.is_none());

        let cleared: RegionPatch =
            serde_json::from_str(r#"{"notes":null,"color":null,"pdf_anchor":null}"#).unwrap();
        assert!(matches!(cleared.notes, Some(None)));
        assert!(matches!(cleared.color, Some(None)));
        assert!(matches!(cleared.pdf_anchor, Some(None)));

        let set: RegionPatch =
            serde_json::from_str(r##"{"notes":"cue","color":"#fff","pdf_anchor":{"v":1}}"##)
                .unwrap();
        assert_eq!(set.notes.as_ref().and_then(Option::as_deref), Some("cue"));
        assert_eq!(set.color.as_ref().and_then(Option::as_deref), Some("#fff"));
        assert_eq!(set.pdf_anchor.flatten(), Some(serde_json::json!({"v": 1})));
    }

    #[test]
    fn every_nullable_command_patch_preserves_explicit_null() {
        let video: TutorialVideoPatch =
            serde_json::from_str(r#"{"duration_seconds":null}"#).unwrap();
        assert!(matches!(video.duration_seconds, Some(None)));
        let clip: TutorialClipPatch = serde_json::from_str(r#"{"notes":null}"#).unwrap();
        assert!(matches!(clip.notes, Some(None)));
        let block: BlockPatch = serde_json::from_str(
            r#"{"label":null,"start_bpm":null,"target_bpm":null,"region_id":null,"increment_rule":null}"#,
        )
        .unwrap();
        assert!(matches!(block.label, Some(None)));
        assert!(matches!(block.start_bpm, Some(None)));
        assert!(matches!(block.target_bpm, Some(None)));
        assert!(matches!(block.region_id, Some(None)));
        assert!(matches!(block.increment_rule, Some(None)));
        let rep: RepPatch = serde_json::from_str(r#"{"note":null}"#).unwrap();
        assert!(matches!(rep.note, Some(None)));
        let goal: GoalPatch =
            serde_json::from_str(r#"{"target_date":null,"parent_goal_id":null}"#).unwrap();
        assert!(matches!(goal.target_date, Some(None)));
        assert!(matches!(goal.parent_goal_id, Some(None)));
        let work: DailyWorkPatch =
            serde_json::from_str(r#"{"region_id":null,"block_id":null}"#).unwrap();
        assert!(matches!(work.region_id, Some(None)));
        assert!(matches!(work.block_id, Some(None)));
        let piece: PieceFieldPatch = serde_json::from_str(
            r#"{"current_state":null,"deadline":null,"target_tempo":null,"notes":null}"#,
        )
        .unwrap();
        assert!(matches!(piece.current_state, Some(None)));
        assert!(matches!(piece.deadline, Some(None)));
        assert!(matches!(piece.target_tempo, Some(None)));
        assert!(matches!(piece.notes, Some(None)));
    }
}

#[cfg(test)]
mod receipt_wire_contract_tests {
    use super::*;

    fn committed(replayed: bool) -> MutationReceipt<i64> {
        MutationReceipt {
            receipt_id: "receipt:cmd-x".into(),
            command_id: "cmd-x".into(),
            status: "committed".into(),
            summary: "Attempt 1 saved.".into(),
            value: Some(7),
            entity_refs: vec![MutationEntityRef {
                entity_type: "set".into(),
                entity_id: 3,
            }],
            event_ids: vec![11, 12],
            undo_action: Some("rep_undo".into()),
            error_code: None,
            error_detail: None,
            replayed,
            committed_ts: Some("2026-07-15T14:00:00Z".into()),
            session_id: Some(42),
        }
    }

    /// The receipt is the whole frontend delivery contract: `command_id`,
    /// `replayed`, and `committed_ts` are always present with their expected
    /// values; `committed_ts` is JSON null only on a rejection; and the internal
    /// `session_id` never crosses the wire.
    #[test]
    fn mutation_receipt_json_exposes_delivery_fields() {
        // (i) committed, first delivery.
        let first = serde_json::to_value(committed(false)).unwrap();
        assert_eq!(first["command_id"], "cmd-x");
        assert_eq!(first["replayed"], serde_json::Value::Bool(false));
        assert_eq!(first["committed_ts"], "2026-07-15T14:00:00Z");
        assert!(
            first.get("session_id").is_none(),
            "session identity stays off the public envelope"
        );

        // (ii) committed, replayed retry — same durable value, replayed=true.
        let replayed = serde_json::to_value(committed(true)).unwrap();
        assert_eq!(replayed["command_id"], "cmd-x");
        assert_eq!(replayed["replayed"], serde_json::Value::Bool(true));
        assert_eq!(replayed["committed_ts"], "2026-07-15T14:00:00Z");
        assert!(replayed.get("session_id").is_none());

        // (iii) rejected — no committed timestamp, never replayed.
        let rejected = serde_json::to_value(MutationReceipt::<i64>::rejected(
            "cmd-x",
            "invalid",
            "note must be 1 to 2000 characters",
        ))
        .unwrap();
        assert_eq!(rejected["command_id"], "cmd-x");
        assert_eq!(rejected["replayed"], serde_json::Value::Bool(false));
        assert_eq!(rejected["committed_ts"], serde_json::Value::Null);
        assert!(rejected.get("session_id").is_none());
    }
}
