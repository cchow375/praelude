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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IncrementRule {
    pub clean_needed: u32,
    pub bpm_step: f64,
}

/// A named practice variant within a block (e.g. "hands separate", `reps`
/// planned for it).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VariantSpec {
    pub name: String,
    pub reps: u32,
}

/// Tally of rep verdicts, used in block history and rep snapshots.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct VerdictCounts {
    pub clean: u32,
    pub flawed: u32,
    pub failed: u32,
}

/// A rep block plus its rolled-up rep counts — one row of a piece's block
/// history (`rep_blocks_for_piece`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlockHistory {
    pub id: i64,
    pub piece_id: i64,
    pub m_start: u32,
    pub m_end: u32,
    pub label: Option<String>,
    pub start_bpm: f64,
    pub target_bpm: Option<f64>,
    pub planned_reps: u32,
    pub status: String,
    pub reps_done: u32,
    pub verdicts: VerdictCounts,
}

/// One session-log event as shown in the session view. `payload` is opaque JSON
/// (its shape depends on `kind`); the store round-trips it untouched.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionEventView {
    pub ts: String,
    pub kind: String,
    pub payload: serde_json::Value,
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
