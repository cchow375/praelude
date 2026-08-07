//! Score Atlas target persistence: one atomic write that turns a validated
//! frontend target draft into a real Region plus its `target_meta` sidecar.
//!
//! The wire contract mirrors `src/features/score/atlas/savePayload.ts` field for
//! field (snake_case, `deny_unknown_fields`). This module owns only additive
//! writes over the immutable v1 graph: it reuses the existing `region` +
//! `target_meta` machinery and never rebuilds or migrates a table. Durability is
//! the slice's receipts model — a repeated `command_id` replays the committed
//! Region instead of creating a second one.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::model::{json_to_sql, sqlite_ts_to_rfc3339, MutationEntityRef, Region};
use super::practice_loop::{
    begin_operation, finish_operation, request_fingerprint, OperationStart,
};
use super::practice_v2::invalid;
use super::Store;
use crate::ledger::MutationSource;

/// Kind assigned to a Region created from a Score Atlas target. Matches the kind
/// the legacy "add tricky section" form uses so targets and sections share one
/// selectable list.
const TARGET_REGION_KIND: &str = "hard_spot";

/// One rectangle of edition-bound, zoom-independent normalized PDF geometry.
/// Mirrors `PdfAnchorRect` in `src/features/score/types.ts`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PdfAnchorRect {
    pub page: i64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// Mirrors `EditionIdentity` in `atlas/model.ts`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditionIdentity {
    pub edition_id: String,
    pub edition_fingerprint: String,
}

/// Mirrors `PersistentPdfSelectionAnchor` in `atlas/model.ts`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersistentPdfSelectionAnchor {
    pub schema_version: i64,
    pub edition_id: String,
    pub edition_fingerprint: String,
    pub rects: Vec<PdfAnchorRect>,
}

/// Mirrors `MeasureRange` in `atlas/model.ts`.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MeasureRange {
    pub m_start: i64,
    pub m_end: i64,
}

/// Mirrors `MappingCandidate` in `atlas/model.ts`. Fields beyond the edition
/// fingerprint exist to pin the strict `deny_unknown_fields` wire contract; the
/// frontend already validated their content before save.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MappingCandidate {
    pub edition_fingerprint: String,
    pub xml_fingerprint: String,
    pub candidate_range: MeasureRange,
    pub confidence: f64,
    pub rationale: String,
    pub calibration_point_ids: Vec<String>,
    pub authoritative: bool,
}

/// Mirrors `ExactCompatibleMapping.evidence` in `atlas/model.ts`. Fields beyond
/// the edition fingerprint exist to pin the strict wire contract.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExactCompatibleEvidence {
    pub kind: String,
    pub edition_fingerprint: String,
    pub xml_fingerprint: String,
    pub compatibility_id: String,
    pub verified_at: String,
}

/// Mirrors `CalibratedUserConfirmedMapping.evidence` in `atlas/model.ts`. Fields
/// beyond the edition fingerprint exist to pin the strict wire contract.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalibratedUserConfirmedEvidence {
    pub kind: String,
    pub edition_fingerprint: String,
    pub xml_fingerprint: String,
    pub calibration_point_ids: Vec<String>,
    pub candidate_range: MeasureRange,
    pub confirmation_id: String,
    pub confirmed_by: String,
    pub confirmed_at: String,
}

/// Mirrors the `TargetMappingState` discriminated union in `atlas/model.ts`.
///
/// `deny_unknown_fields` is intentionally not applied here: serde does not
/// support it on internally tagged enums. Each variant's fields are still fixed,
/// and the leaf structs above remain strict. Confidence/rationale and the
/// location-only variant exist to pin the wire contract, not to drive the write.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TargetMappingState {
    ExactCompatible {
        asserted_range: MeasureRange,
        confidence: f64,
        rationale: String,
        evidence: ExactCompatibleEvidence,
    },
    CalibratedUserConfirmed {
        asserted_range: MeasureRange,
        confidence: f64,
        rationale: String,
        evidence: CalibratedUserConfirmedEvidence,
    },
    Unknown {
        asserted_range: Option<MeasureRange>,
        confidence: Option<f64>,
        rationale: String,
        #[serde(default)]
        candidate: Option<MappingCandidate>,
    },
}

impl TargetMappingState {
    /// The authoritative range an asserting mapping commits to, or `None` for an
    /// unknown/location-only mapping.
    fn asserted_range(&self) -> Option<MeasureRange> {
        match self {
            Self::ExactCompatible { asserted_range, .. }
            | Self::CalibratedUserConfirmed { asserted_range, .. } => Some(*asserted_range),
            Self::Unknown { .. } => None,
        }
    }

    fn edition_fingerprint(&self) -> Option<&str> {
        match self {
            Self::ExactCompatible { evidence, .. } => Some(&evidence.edition_fingerprint),
            Self::CalibratedUserConfirmed { evidence, .. } => Some(&evidence.edition_fingerprint),
            Self::Unknown { candidate, .. } => {
                candidate.as_ref().map(|c| c.edition_fingerprint.as_str())
            }
        }
    }
}

/// One atomic Score Atlas target write. Mirrors `AtomicTargetSavePayload` in
/// `atlas/savePayload.ts`; `command_id` is the durable idempotency key the
/// frontend derives from the target draft.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AtomicTargetSavePayload {
    pub piece_id: i64,
    #[serde(default)]
    pub command_id: Option<String>,
    #[serde(default)]
    pub target_id: Option<i64>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    // Accepted to pin the wire contract; no v8 column persists them yet.
    #[serde(default)]
    #[allow(dead_code)]
    pub hands: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    pub method: Option<String>,
    #[serde(default)]
    pub edition: Option<EditionIdentity>,
    #[serde(default)]
    pub anchor: Option<PersistentPdfSelectionAnchor>,
    #[serde(default)]
    pub mapping_evidence: Option<TargetMappingState>,
    #[serde(default)]
    pub asserted_measure_range: Option<MeasureRange>,
}

/// A payload validated into exactly the values one Region write needs.
struct ValidatedTarget<'a> {
    piece_id: i64,
    command_id: String,
    name: String,
    notes: Option<String>,
    m_start: u32,
    m_end: u32,
    edition: &'a EditionIdentity,
    rects: &'a [PdfAnchorRect],
}

fn trimmed_nonempty(value: Option<&String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Validate the immutable geometry/identity contract, mirroring the frontend's
/// `saveTarget` receipt guard and `validateAtomicTargetSavePayload` boundary.
fn validate(payload: &AtomicTargetSavePayload) -> rusqlite::Result<ValidatedTarget<'_>> {
    if payload.piece_id < 1 {
        return Err(invalid("a target save needs a valid piece id"));
    }
    if payload.target_id.is_some_and(|target_id| target_id < 1) {
        return Err(invalid("target id must be a positive identity"));
    }
    let command_id = trimmed_nonempty(payload.command_id.as_ref())
        .ok_or_else(|| invalid("a Score Atlas target save needs a command id"))?;

    let edition = payload
        .edition
        .as_ref()
        .ok_or_else(|| invalid("a target save needs its score edition identity"))?;
    let anchor = payload
        .anchor
        .as_ref()
        .ok_or_else(|| invalid("a target save needs a PDF selection anchor"))?;
    let mapping = payload
        .mapping_evidence
        .as_ref()
        .ok_or_else(|| invalid("a target save needs mapping evidence"))?;

    if anchor.schema_version != 1 {
        return Err(invalid(
            "the PDF selection anchor uses an unsupported schema version",
        ));
    }
    if edition.edition_id.trim().is_empty() || edition.edition_fingerprint.trim().is_empty() {
        return Err(invalid("the score edition identity is incomplete"));
    }
    if anchor.edition_id != edition.edition_id
        || anchor.edition_fingerprint != edition.edition_fingerprint
    {
        return Err(invalid(
            "the selection anchor belongs to a different score edition or fingerprint",
        ));
    }
    if let Some(mapped) = mapping.edition_fingerprint() {
        if mapped != edition.edition_fingerprint {
            return Err(invalid(
                "mapping evidence belongs to a different score edition fingerprint",
            ));
        }
    }
    if anchor.rects.is_empty() {
        return Err(invalid("a target save needs at least one score rectangle"));
    }
    for rect in &anchor.rects {
        validate_rect(rect)?;
    }

    // Save only ever commits an asserting mapping with a concrete range; a
    // location-only (unknown) mapping cannot become a selectable measure Region.
    let range = payload
        .asserted_measure_range
        .ok_or_else(|| invalid("a target save needs an asserted measure range"))?;
    if range.m_start < 1 || range.m_end < range.m_start {
        return Err(invalid(
            "the asserted measure range must be positive and ordered",
        ));
    }
    if let Some(mapped_range) = mapping.asserted_range() {
        if mapped_range.m_start != range.m_start || mapped_range.m_end != range.m_end {
            return Err(invalid(
                "the asserted range does not match the committed mapping evidence",
            ));
        }
    } else {
        return Err(invalid(
            "an unknown mapping cannot assert a target measure range",
        ));
    }
    let m_start = u32::try_from(range.m_start)
        .map_err(|_| invalid("the asserted measure range is out of bounds"))?;
    let m_end = u32::try_from(range.m_end)
        .map_err(|_| invalid("the asserted measure range is out of bounds"))?;

    let name = trimmed_nonempty(payload.title.as_ref())
        .filter(|value| value.chars().count() <= 500)
        .unwrap_or_else(|| format!("Target · mm. {m_start}\u{2013}{m_end}"));
    let notes = trimmed_nonempty(payload.note.as_ref());
    if notes
        .as_ref()
        .is_some_and(|value| value.chars().count() > 10_000)
    {
        return Err(invalid("target note must be 10000 characters or fewer"));
    }

    Ok(ValidatedTarget {
        piece_id: payload.piece_id,
        command_id,
        name,
        notes,
        m_start,
        m_end,
        edition,
        rects: &anchor.rects,
    })
}

fn validate_rect(rect: &PdfAnchorRect) -> rusqlite::Result<()> {
    if rect.page < 1 {
        return Err(invalid("a score rectangle needs a positive page number"));
    }
    let coords = [rect.x, rect.y, rect.w, rect.h];
    if coords.iter().any(|value| !value.is_finite()) {
        return Err(invalid("a score rectangle has non-finite geometry"));
    }
    if rect.x < 0.0 || rect.y < 0.0 || rect.w <= 0.0 || rect.h <= 0.0 {
        return Err(invalid("a score rectangle has out-of-range geometry"));
    }
    // Match the frontend's normalized bounds (a small epsilon tolerates the
    // 6-decimal rounding `selection.ts` applies).
    if rect.x + rect.w > 1.000_001 || rect.y + rect.h > 1.000_001 {
        return Err(invalid(
            "a score rectangle falls outside the normalized page",
        ));
    }
    if let Some(kind) = &rect.kind {
        if !matches!(kind.as_str(), "box" | "highlight" | "note") {
            return Err(invalid("a score rectangle has an unknown annotation kind"));
        }
    }
    Ok(())
}

/// Build the legacy `region.pdf_anchor` v1 envelope from the persistent
/// selection anchor, mirroring `selectionAnchorToPdfAnchorMap` in
/// `atlas/selection.ts` so a saved target round-trips into a mapped Region.
fn pdf_anchor_map(edition: &EditionIdentity, rects: &[PdfAnchorRect]) -> serde_json::Value {
    json!({
        "v": 1,
        "editions": {
            &edition.edition_id: {
                "fingerprint": edition.edition_fingerprint,
                "rects": rects,
            }
        }
    })
}

impl Store {
    /// Persist a Score Atlas target as one Region (with edition-bound PDF
    /// geometry) plus its `target_meta` sidecar, in a single transaction. A
    /// repeated `command_id` replays the already-committed Region rather than
    /// creating a duplicate.
    pub(crate) fn score_atlas_target_save(
        &self,
        payload: AtomicTargetSavePayload,
    ) -> rusqlite::Result<Region> {
        let target = validate(&payload)?;
        let anchor_json = pdf_anchor_map(target.edition, target.rects);
        let anchor_sql = json_to_sql(&anchor_json)?;
        let command_id = format!("score-atlas-target:{}", target.command_id);
        let fingerprint = request_fingerprint(&json!({
            "piece_id": target.piece_id,
            "m_start": target.m_start,
            "m_end": target.m_end,
            "edition_id": target.edition.edition_id,
            "edition_fingerprint": target.edition.edition_fingerprint,
            "anchor": anchor_json,
        }))?;
        let now = self.now_rfc3339()?;

        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());

        // A target save FKs onto piece; check first for an honest message
        // rather than a raw constraint failure.
        let piece_exists: bool = conn
            .query_row(
                "SELECT 1 FROM piece WHERE id = ?1",
                [target.piece_id],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        if !piece_exists {
            return Err(invalid(
                "target save references a piece that does not exist",
            ));
        }

        let tx = conn.transaction()?;
        let pending = match begin_operation::<Region>(
            &tx,
            &command_id,
            "score_atlas_target_save",
            &fingerprint,
            None,
            MutationSource::UserClick,
            &now,
        )? {
            OperationStart::Replay(receipt) => {
                return receipt
                    .value
                    .ok_or_else(|| invalid("replayed target receipt is missing its Region"));
            }
            OperationStart::New(pending) => pending,
        };

        let region_id: i64 = tx.query_row(
            "INSERT INTO region (piece_id, name, notes, m_start, m_end, kind, sort_order, pdf_anchor)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                 COALESCE((SELECT MAX(sort_order) + 1 FROM region WHERE piece_id = ?1), 0), ?7)
             RETURNING id",
            rusqlite::params![
                target.piece_id,
                target.name,
                target.notes,
                target.m_start,
                target.m_end,
                TARGET_REGION_KIND,
                anchor_sql,
            ],
            |row| row.get(0),
        )?;

        let region = Self::region_row(&tx, region_id)?;

        tx.execute(
            "INSERT INTO target_meta (region_id, color, display_order, mapping_evidence_version)
             VALUES (?1, ?2, ?3, 1)",
            rusqlite::params![region_id, region.color, region.order],
        )?;

        let event_id: i64 = tx.query_row(
            "INSERT INTO event (kind, session_id, piece_id, payload)
             VALUES ('region_change', NULL, ?1, ?2)
             RETURNING id",
            rusqlite::params![
                target.piece_id,
                json_to_sql(&json!({
                    "action": "create",
                    "region_id": region_id,
                    "source": "score_atlas_target_save",
                }))?,
            ],
            |row| row.get(0),
        )?;

        finish_operation(
            &tx,
            pending,
            "Score Atlas target saved as a Region.",
            &region,
            vec![MutationEntityRef {
                entity_type: "region".into(),
                entity_id: region_id,
            }],
            vec![event_id],
            None,
        )?;
        tx.commit()?;
        Ok(region)
    }

    /// Read one Region row in the exact shape `region_list` returns.
    fn region_row(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<Region> {
        conn.query_row(
            "SELECT id, piece_id, name, m_start, m_end, kind, sort_order, color, pdf_anchor, notes
             FROM region WHERE id = ?1",
            [id],
            |row| {
                let pdf_anchor_json: Option<String> = row.get(8)?;
                Ok(Region {
                    id: row.get(0)?,
                    piece_id: row.get(1)?,
                    name: row.get(2)?,
                    notes: row.get(9)?,
                    m_start: row.get(3)?,
                    m_end: row.get(4)?,
                    kind: row.get(5)?,
                    order: row.get(6)?,
                    color: row.get(7)?,
                    pdf_anchor: pdf_anchor_json
                        .map(|s| serde_json::from_str(&s))
                        .transpose()
                        .map_err(|e| {
                            rusqlite::Error::FromSqlConversionFailure(
                                8,
                                rusqlite::types::Type::Text,
                                Box::new(e),
                            )
                        })?,
                    // This region was just inserted by the target-save flow
                    // above and cannot have a `target_meta` row yet (that
                    // insert happens right after this read), so it can never
                    // already be a sub-section.
                    parent_region_id: None,
                })
            },
        )
    }
}

// ---------------------------------------------------------------------------
// Score edition calibration (line anchors)
//
// A calibration is a set of "line anchors": for one score edition, the vertical
// position of each system's start (normalized 0–1) and the printed measure
// number there. It is standalone (no target attached) and lives in the v8
// `score_edition_calibration` table, keyed uniquely by (piece, edition,
// fingerprint). This is the wizard's durable memory; the frontend interpolates
// drawn boxes to measures from it. Method is always `user_confirmed` here — the
// only source is a human placing anchors — and confidence is fixed conservatively
// (see `CALIBRATION_CONFIDENCE`). Raw JSON from the frontend is never stored: it
// is parsed into strict structs, validated, and re-serialized canonically.
// ---------------------------------------------------------------------------

/// Method recorded for every wizard-authored calibration. The wizard's only
/// source is a human placing anchors, so the row is always user-confirmed.
const CALIBRATION_METHOD: &str = "user_confirmed";

/// Fixed, conservative row-level confidence for a hand-placed calibration set.
/// Per-box confidence is computed separately by the frontend interpolation
/// (`resolveMeasureRange`); this metadata simply marks the set as a deliberate,
/// user-confirmed mapping rather than an exact-XML match (1.0) or a weak guess.
const CALIBRATION_CONFIDENCE: f64 = 0.75;

/// Upper bound on anchors in a single calibration set. Real scores have far
/// fewer systems; this only guards against a runaway/adversarial payload.
const MAX_CALIBRATION_POINTS: usize = 2000;

/// One line anchor. Mirrors `LineAnchor { page, yPct, measure }` in
/// `src/features/score/atlas/mapping/anchors.ts`; `y` is a normalized 0–1
/// fraction (the frontend keeps the historical `yPct` name for readability).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CalibrationPoint {
    pub page: i64,
    pub y: f64,
    pub measure: i64,
}

/// The frontend-facing view of one stored calibration row.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CalibrationView {
    pub piece_id: i64,
    pub edition_id: String,
    pub edition_fingerprint: String,
    pub method: String,
    pub confidence: f64,
    pub points: Vec<CalibrationPoint>,
    pub user_verified: bool,
    pub updated_ts: String,
}

/// Parse and validate the frontend's `points_json` into strict anchor structs.
/// Rejects invalid JSON, unknown fields, an empty set, an oversized set, and any
/// out-of-range point. The caller re-serializes the returned structs so only
/// validated, canonical JSON is ever persisted.
fn validate_calibration_points(points_json: &str) -> rusqlite::Result<Vec<CalibrationPoint>> {
    let points: Vec<CalibrationPoint> = serde_json::from_str(points_json)
        .map_err(|e| invalid(format!("calibration points are not valid JSON: {e}")))?;
    if points.is_empty() {
        return Err(invalid("a calibration needs at least one line anchor"));
    }
    if points.len() > MAX_CALIBRATION_POINTS {
        return Err(invalid(format!(
            "a calibration cannot exceed {MAX_CALIBRATION_POINTS} line anchors"
        )));
    }
    for point in &points {
        if point.page < 1 {
            return Err(invalid(
                "a calibration line anchor needs a positive page number",
            ));
        }
        if !point.y.is_finite() || point.y < 0.0 || point.y > 1.0 {
            return Err(invalid(
                "a calibration line anchor y must be a normalized 0..=1 fraction",
            ));
        }
        if point.measure < 1 {
            return Err(invalid(
                "a calibration line anchor needs a positive measure number",
            ));
        }
    }
    Ok(points)
}

impl Store {
    /// UPSERT one edition's calibration (line anchors) over the existing v8
    /// `score_edition_calibration` table. Method is fixed to `user_confirmed`
    /// and confidence is fixed conservatively; `points_json` is validated and
    /// re-serialized canonically before it is ever stored.
    pub(crate) fn score_calibration_save(
        &self,
        piece_id: i64,
        edition_id: &str,
        edition_fingerprint: &str,
        points_json: &str,
        user_verified: bool,
    ) -> rusqlite::Result<CalibrationView> {
        if piece_id < 1 {
            return Err(invalid("a calibration save needs a valid piece id"));
        }
        let edition_id = edition_id.trim();
        let edition_fingerprint = edition_fingerprint.trim();
        if edition_id.is_empty() || edition_id.chars().count() > 4096 {
            return Err(invalid("the calibration edition id is empty or too long"));
        }
        if edition_fingerprint.is_empty() || edition_fingerprint.chars().count() > 500 {
            return Err(invalid(
                "the calibration edition fingerprint is empty or too long",
            ));
        }
        let points = validate_calibration_points(points_json)?;
        // Never store the raw input: persist the canonical re-serialization of
        // the validated structs.
        let canonical_json = json_to_sql(&points)?;
        // Compute the timestamp before locking the connection (it locks too).
        let now = self.now_rfc3339()?;

        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());

        // FKs onto piece; check first for an honest message rather than a raw
        // constraint failure.
        let piece_exists: bool = conn
            .query_row("SELECT 1 FROM piece WHERE id = ?1", [piece_id], |_| {
                Ok(true)
            })
            .optional()?
            .unwrap_or(false);
        if !piece_exists {
            return Err(invalid(
                "calibration save references a piece that does not exist",
            ));
        }

        conn.execute(
            "INSERT INTO score_edition_calibration
                 (piece_id, edition_id, edition_fingerprint, method, confidence,
                  points_json, user_verified, created_ts, updated_ts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(piece_id, edition_id, edition_fingerprint) DO UPDATE SET
                 method = excluded.method,
                 confidence = excluded.confidence,
                 points_json = excluded.points_json,
                 user_verified = excluded.user_verified,
                 updated_ts = excluded.updated_ts",
            rusqlite::params![
                piece_id,
                edition_id,
                edition_fingerprint,
                CALIBRATION_METHOD,
                CALIBRATION_CONFIDENCE,
                canonical_json,
                i64::from(user_verified),
                now,
            ],
        )?;

        Self::calibration_row(&conn, piece_id, edition_id, edition_fingerprint)?
            .ok_or_else(|| invalid("calibration row missing immediately after save"))
    }

    /// Read one edition's stored calibration, or `None` when it has not been
    /// mapped yet.
    pub(crate) fn score_calibration_get(
        &self,
        piece_id: i64,
        edition_id: &str,
        edition_fingerprint: &str,
    ) -> rusqlite::Result<Option<CalibrationView>> {
        let edition_id = edition_id.trim();
        let edition_fingerprint = edition_fingerprint.trim();
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        Self::calibration_row(&conn, piece_id, edition_id, edition_fingerprint)
    }

    fn calibration_row(
        conn: &rusqlite::Connection,
        piece_id: i64,
        edition_id: &str,
        edition_fingerprint: &str,
    ) -> rusqlite::Result<Option<CalibrationView>> {
        conn.query_row(
            "SELECT method, confidence, points_json, user_verified, updated_ts
             FROM score_edition_calibration
             WHERE piece_id = ?1 AND edition_id = ?2 AND edition_fingerprint = ?3",
            rusqlite::params![piece_id, edition_id, edition_fingerprint],
            |row| {
                let points_json: String = row.get(2)?;
                let points: Vec<CalibrationPoint> =
                    serde_json::from_str(&points_json).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2,
                            rusqlite::types::Type::Text,
                            Box::new(e),
                        )
                    })?;
                let user_verified: i64 = row.get(3)?;
                let updated_ts: String = row.get(4)?;
                Ok(CalibrationView {
                    piece_id,
                    edition_id: edition_id.to_string(),
                    edition_fingerprint: edition_fingerprint.to_string(),
                    method: row.get(0)?,
                    confidence: row.get(1)?,
                    points,
                    user_verified: user_verified != 0,
                    updated_ts: sqlite_ts_to_rfc3339(&updated_ts),
                })
            },
        )
        .optional()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::ScanPiece;

    fn memory_store_with_piece() -> Store {
        let store = Store::open(":memory:").expect("memory store");
        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/v/Atlas piece".into(),
                title: "Atlas piece".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        assert_eq!(piece_id, 1);
        store
    }

    fn rect(page: i64) -> PdfAnchorRect {
        PdfAnchorRect {
            page,
            x: 0.1,
            y: 0.2,
            w: 0.3,
            h: 0.15,
            kind: None,
        }
    }

    fn exact_payload(command_id: &str) -> AtomicTargetSavePayload {
        let edition = EditionIdentity {
            edition_id: "urtext".into(),
            edition_fingerprint: "fp-a".into(),
        };
        let range = MeasureRange {
            m_start: 40,
            m_end: 56,
        };
        AtomicTargetSavePayload {
            piece_id: 1,
            command_id: Some(command_id.into()),
            target_id: None,
            title: Some("Development leap".into()),
            note: Some("Even groups".into()),
            hands: None,
            method: None,
            edition: Some(EditionIdentity {
                edition_id: edition.edition_id.clone(),
                edition_fingerprint: edition.edition_fingerprint.clone(),
            }),
            anchor: Some(PersistentPdfSelectionAnchor {
                schema_version: 1,
                edition_id: edition.edition_id.clone(),
                edition_fingerprint: edition.edition_fingerprint.clone(),
                rects: vec![rect(2)],
            }),
            mapping_evidence: Some(TargetMappingState::ExactCompatible {
                asserted_range: range,
                confidence: 1.0,
                rationale: "Compatible MusicXML".into(),
                evidence: ExactCompatibleEvidence {
                    kind: "compatible_musicxml".into(),
                    edition_fingerprint: edition.edition_fingerprint.clone(),
                    xml_fingerprint: "xml-1".into(),
                    compatibility_id: "compat-1".into(),
                    verified_at: "2026-07-16T00:00:00Z".into(),
                },
            }),
            asserted_measure_range: Some(range),
        }
    }

    #[test]
    fn happy_path_creates_region_target_meta_and_maps_anchor() {
        let store = memory_store_with_piece();
        let region = store
            .score_atlas_target_save(exact_payload("draft-1"))
            .expect("target saves");

        assert!(region.id >= 1);
        assert_eq!(region.piece_id, 1);
        assert_eq!(region.name, "Development leap");
        assert_eq!(region.notes.as_deref(), Some("Even groups"));
        assert_eq!((region.m_start, region.m_end), (40, 56));
        assert_eq!(region.kind, "hard_spot");

        // The saved target round-trips into a mapped, selectable Region.
        let listed = store.region_list(1).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, region.id);
        let anchor = region.pdf_anchor.expect("pdf anchor stored");
        assert_eq!(anchor["v"], 1);
        assert_eq!(anchor["editions"]["urtext"]["fingerprint"], "fp-a");
        assert_eq!(anchor["editions"]["urtext"]["rects"][0]["page"], 2);

        assert_eq!(
            store
                .test_scalar_i64(&format!(
                    "SELECT count(*) FROM target_meta WHERE region_id = {}",
                    region.id
                ))
                .unwrap(),
            1
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM practice_operation WHERE operation_kind='score_atlas_target_save'")
                .unwrap(),
            1
        );
    }

    #[test]
    fn generates_a_default_name_when_no_title_is_supplied() {
        let store = memory_store_with_piece();
        let mut payload = exact_payload("draft-untitled");
        payload.title = None;
        let region = store.score_atlas_target_save(payload).expect("saves");
        assert_eq!(region.name, "Target · mm. 40\u{2013}56");
    }

    #[test]
    fn rejects_a_missing_asserted_range_without_writing_rows() {
        let store = memory_store_with_piece();
        let mut payload = exact_payload("draft-bad-range");
        payload.asserted_measure_range = None;
        let err = store.score_atlas_target_save(payload).unwrap_err();
        assert!(err.to_string().contains("asserted measure range"));
        assert_eq!(store.region_list(1).unwrap().len(), 0);
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM target_meta")
                .unwrap(),
            0
        );
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM practice_operation")
                .unwrap(),
            0
        );
    }

    #[test]
    fn rejects_an_anchor_from_a_different_edition_fingerprint() {
        let store = memory_store_with_piece();
        let mut payload = exact_payload("draft-fp-mismatch");
        if let Some(anchor) = payload.anchor.as_mut() {
            anchor.edition_fingerprint = "fp-other".into();
        }
        let err = store.score_atlas_target_save(payload).unwrap_err();
        assert!(err.to_string().contains("different score edition"));
        assert_eq!(store.region_list(1).unwrap().len(), 0);
    }

    #[test]
    fn rejects_a_save_for_a_missing_piece() {
        let store = memory_store_with_piece();
        let mut payload = exact_payload("draft-no-piece");
        payload.piece_id = 999;
        let err = store.score_atlas_target_save(payload).unwrap_err();
        assert!(err.to_string().contains("does not exist"));
    }

    #[test]
    fn replaying_the_same_command_id_returns_one_region() {
        let store = memory_store_with_piece();
        let first = store
            .score_atlas_target_save(exact_payload("draft-replay"))
            .expect("first save");
        let second = store
            .score_atlas_target_save(exact_payload("draft-replay"))
            .expect("replayed save");

        assert_eq!(first.id, second.id);
        assert_eq!(first, second);
        assert_eq!(store.region_list(1).unwrap().len(), 1);
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM practice_operation")
                .unwrap(),
            1
        );
    }

    // ----- Score edition calibration (line anchors) -----

    fn points_json(points: &[(i64, f64, i64)]) -> String {
        let items: Vec<serde_json::Value> = points
            .iter()
            .map(|(page, y, measure)| json!({ "page": page, "y": y, "measure": measure }))
            .collect();
        serde_json::to_string(&items).unwrap()
    }

    #[test]
    fn calibration_save_then_get_roundtrips() {
        let store = memory_store_with_piece();
        let saved = store
            .score_calibration_save(
                1,
                "score/Ekier.pdf",
                "fp-a",
                &points_json(&[(1, 0.20, 45), (1, 0.34, 52)]),
                true,
            )
            .expect("calibration saves");
        assert_eq!(saved.piece_id, 1);
        assert_eq!(saved.edition_id, "score/Ekier.pdf");
        assert_eq!(saved.edition_fingerprint, "fp-a");
        assert_eq!(saved.method, "user_confirmed");
        assert!(saved.user_verified);
        assert_eq!(saved.points.len(), 2);
        assert_eq!(saved.points[0].page, 1);
        assert!((saved.points[0].y - 0.20).abs() < 1e-9);
        assert_eq!(saved.points[1].measure, 52);
        assert!(saved.confidence >= 0.0 && saved.confidence <= 1.0);

        let fetched = store
            .score_calibration_get(1, "score/Ekier.pdf", "fp-a")
            .expect("get succeeds")
            .expect("calibration present");
        assert_eq!(fetched.points.len(), 2);
        assert_eq!(fetched.points[1].measure, 52);
        assert_eq!(fetched.method, "user_confirmed");
    }

    #[test]
    fn calibration_get_is_none_for_an_unmapped_edition() {
        let store = memory_store_with_piece();
        assert!(store
            .score_calibration_get(1, "score/Ekier.pdf", "fp-a")
            .expect("get succeeds")
            .is_none());
    }

    #[test]
    fn calibration_save_upserts_on_the_unique_edition_key() {
        let store = memory_store_with_piece();
        store
            .score_calibration_save(
                1,
                "score/Ekier.pdf",
                "fp-a",
                &points_json(&[(1, 0.2, 1)]),
                false,
            )
            .expect("first save");
        let second = store
            .score_calibration_save(
                1,
                "score/Ekier.pdf",
                "fp-a",
                &points_json(&[(1, 0.2, 10), (2, 0.5, 25)]),
                true,
            )
            .expect("overwriting save");
        assert_eq!(second.points.len(), 2);
        assert_eq!(second.points[0].measure, 10);
        assert!(second.user_verified);
        // Exactly one row survives for the unique edition key.
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM score_edition_calibration")
                .unwrap(),
            1
        );
    }

    #[test]
    fn calibration_save_rejects_empty_points() {
        let store = memory_store_with_piece();
        let err = store
            .score_calibration_save(1, "e", "fp", "[]", false)
            .unwrap_err();
        assert!(err.to_string().contains("at least one"));
        assert_eq!(
            store
                .test_scalar_i64("SELECT count(*) FROM score_edition_calibration")
                .unwrap(),
            0
        );
    }

    #[test]
    fn calibration_save_rejects_too_many_points() {
        let store = memory_store_with_piece();
        let many: Vec<(i64, f64, i64)> = (1..=2001).map(|m| (1, 0.5, m)).collect();
        let err = store
            .score_calibration_save(1, "e", "fp", &points_json(&many), false)
            .unwrap_err();
        assert!(err.to_string().contains("2000"));
    }

    #[test]
    fn calibration_save_rejects_a_nonpositive_page() {
        let store = memory_store_with_piece();
        let err = store
            .score_calibration_save(1, "e", "fp", &points_json(&[(0, 0.5, 3)]), false)
            .unwrap_err();
        assert!(err.to_string().contains("page"));
    }

    #[test]
    fn calibration_save_rejects_an_out_of_range_y() {
        let store = memory_store_with_piece();
        let err = store
            .score_calibration_save(1, "e", "fp", &points_json(&[(1, 1.5, 3)]), false)
            .unwrap_err();
        assert!(err.to_string().contains("y"));
    }

    #[test]
    fn calibration_save_rejects_a_nonpositive_measure() {
        let store = memory_store_with_piece();
        let err = store
            .score_calibration_save(1, "e", "fp", &points_json(&[(1, 0.5, 0)]), false)
            .unwrap_err();
        assert!(err.to_string().contains("measure"));
    }

    #[test]
    fn calibration_save_rejects_invalid_json_and_unknown_fields() {
        let store = memory_store_with_piece();
        assert!(store
            .score_calibration_save(1, "e", "fp", "not json", false)
            .unwrap_err()
            .to_string()
            .contains("JSON"));
        let unknown_field = r#"[{"page":1,"y":0.5,"measure":3,"rogue":9}]"#;
        assert!(store
            .score_calibration_save(1, "e", "fp", unknown_field, false)
            .is_err());
    }

    #[test]
    fn calibration_save_rejects_empty_or_whitespace_edition_ids() {
        let store = memory_store_with_piece();
        assert!(store
            .score_calibration_save(1, "   ", "fp", &points_json(&[(1, 0.5, 3)]), false)
            .unwrap_err()
            .to_string()
            .contains("edition id"));
        assert!(store
            .score_calibration_save(1, "e", "  ", &points_json(&[(1, 0.5, 3)]), false)
            .unwrap_err()
            .to_string()
            .contains("fingerprint"));
    }

    #[test]
    fn calibration_save_rejects_a_missing_piece() {
        let store = memory_store_with_piece();
        let err = store
            .score_calibration_save(999, "e", "fp", &points_json(&[(1, 0.5, 3)]), false)
            .unwrap_err();
        assert!(err.to_string().contains("does not exist"));
    }

    #[test]
    fn a_reused_command_id_with_a_different_payload_is_rejected() {
        let store = memory_store_with_piece();
        store
            .score_atlas_target_save(exact_payload("draft-conflict"))
            .expect("first save");
        let mut conflicting = exact_payload("draft-conflict");
        conflicting.asserted_measure_range = Some(MeasureRange {
            m_start: 1,
            m_end: 4,
        });
        if let Some(TargetMappingState::ExactCompatible { asserted_range, .. }) =
            conflicting.mapping_evidence.as_mut()
        {
            *asserted_range = MeasureRange {
                m_start: 1,
                m_end: 4,
            };
        }
        let err = store.score_atlas_target_save(conflicting).unwrap_err();
        assert!(err.to_string().contains("already committed"));
        assert_eq!(store.region_list(1).unwrap().len(), 1);
    }
}
