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
use serde::{Deserialize, Serialize};

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
    pub folder_path: String,
    pub xml_path: Option<String>,
    pub pdf_path: Option<String>,
    pub goals: Vec<String>,
    pub deadline: Option<String>,
    pub target_tempo: Option<f64>,
    pub hard_spots: Vec<HardSpot>,
    pub current_state: Option<String>,
    pub notes: Option<String>,
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IncrementRule {
    pub clean_needed: u32,
    pub bpm_step: f64,
}

/// A named practice variant within a block (e.g. "hands separate", `reps`
/// planned for it).
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VariantSpec {
    pub name: String,
    pub reps: u32,
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
    pub start_bpm: f64,
    pub bpm: f64,
    pub target_bpm: Option<f64>,
    pub planned_reps: u32,
    pub reps_done: u32,
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
    pub m_start: u32,
    pub m_end: u32,
    #[serde(default)]
    pub label: Option<String>,
    pub start_bpm: f64,
    #[serde(default)]
    pub target_bpm: Option<f64>,
    #[serde(default)]
    pub planned_reps: Option<u32>,
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
    pub bpm: f64,
}

/// The full live state of the active rep block. Emitted as `rep://state`,
/// returned by `rep_open`/`rep_state`, and carried inside a [`CheckOutcome`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepSnapshot {
    pub block_id: i64,
    pub piece_id: i64,
    pub piece_title: String,
    pub m_start: u32,
    pub m_end: u32,
    pub label: Option<String>,
    /// The block's current working tempo (steps up the ladder as reps land clean).
    pub bpm: f64,
    pub start_bpm: f64,
    pub target_bpm: Option<f64>,
    pub planned_reps: u32,
    pub reps_done: u32,
    /// Clean reps accumulated at the current rung; resets to 0 on a step.
    pub cleans_at_step: u32,
    pub rule: IncrementRule,
    /// The variant the *next* rep belongs to, if the block has variants.
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
    pub name: String,
    pub m_start: u32,
    pub m_end: u32,
    pub kind: String,
    #[serde(rename = "order")]
    pub order: i64,
    pub color: Option<String>,
    /// Reserved for P4 (score-viewer anchor); opaque JSON, unused this phase.
    pub pdf_anchor: Option<serde_json::Value>,
}

/// Arguments to create a region.
#[derive(Debug, Clone, Deserialize)]
pub struct RegionCreate {
    pub piece_id: i64,
    pub name: String,
    pub m_start: u32,
    pub m_end: u32,
    pub kind: String,
}

/// A partial region update. Every field is `Option`-absent-means-unchanged;
/// `color` is additionally nullable (`Option<Option<String>>`: absent = leave,
/// `Some(None)` = clear, `Some(Some(v))` = set).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct RegionPatch {
    pub name: Option<String>,
    pub m_start: Option<u32>,
    pub m_end: Option<u32>,
    pub kind: Option<String>,
    #[serde(rename = "order")]
    pub order: Option<i64>,
    pub color: Option<Option<String>>,
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
    pub bpm: f64,
    pub variant: Option<String>,
    pub verdict: String,
    pub note: Option<String>,
}

/// A rep block's mutable fields. Nullable columns use `Option<Option<T>>`
/// (absent = unchanged, `Some(None)` = set NULL, `Some(Some(v))` = set `v`);
/// non-nullable columns (`m_start`/`m_end`/`planned_reps`/`focus`/
/// `use_metronome`) use a plain `Option<T>` (absent = unchanged).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct BlockPatch {
    pub label: Option<Option<String>>,
    pub m_start: Option<u32>,
    pub m_end: Option<u32>,
    pub start_bpm: Option<Option<f64>>,
    pub target_bpm: Option<Option<f64>>,
    pub planned_reps: Option<u32>,
    pub focus: Option<String>,
    pub use_metronome: Option<bool>,
    pub region_id: Option<Option<i64>>,
    pub increment_rule: Option<Option<IncrementRule>>,
}

/// A partial rep edit: verdict is a plain replace, `note` is nullable.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct RepPatch {
    pub verdict: Option<String>,
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
    pub target_date: Option<Option<String>>,
    pub parent_goal_id: Option<Option<i64>>,
}

/// A partial edit to a piece's inline-editable intake metadata. Every field is
/// nullable (absent = unchanged, `Some(None)` = clear, `Some(Some(v))` = set).
/// Deliberately does not append an `event` row: this is metadata, not part of
/// the practice-event stream metrics derive from.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PieceFieldPatch {
    pub current_state: Option<Option<String>>,
    pub deadline: Option<Option<String>>,
    pub target_tempo: Option<Option<f64>>,
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

/// Serialize a value into the TEXT form stored in a JSON-shaped column,
/// mapping any serde failure into a `rusqlite` error (never a panic).
pub(crate) fn json_to_sql<T: Serialize + ?Sized>(value: &T) -> rusqlite::Result<String> {
    serde_json::to_string(value)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
}

/// Deserialize a value out of a JSON-shaped TEXT column, mapping any serde
/// failure into a `rusqlite` error (never a panic).
pub(crate) fn json_from_sql<T: DeserializeOwned>(text: &str) -> rusqlite::Result<T> {
    serde_json::from_str(text).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}
