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

use super::model::{json_to_sql, MutationEntityRef, Region};
use super::practice_loop::{begin_operation, finish_operation, request_fingerprint, OperationStart};
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
    if payload
        .target_id
        .is_some_and(|target_id| target_id < 1)
    {
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
        return Err(invalid("the PDF selection anchor uses an unsupported schema version"));
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
        return Err(invalid("the asserted measure range must be positive and ordered"));
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
        return Err(invalid("a score rectangle falls outside the normalized page"));
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

        let mut conn = self.conn.lock().unwrap_or_else(|poison| poison.into_inner());

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
            return Err(invalid("target save references a piece that does not exist"));
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
    fn region_row(
        conn: &rusqlite::Connection,
        id: i64,
    ) -> rusqlite::Result<Region> {
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
                })
            },
        )
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
