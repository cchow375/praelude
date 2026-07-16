import { validMeasureRange } from "./draft";
import type {
  EditionIdentity,
  MeasureRange,
  PersistentPdfSelectionAnchor,
  TargetMappingState,
} from "./model";
import type { DomainResult } from "./result";
import { failure, success } from "./result";
import { createPersistentSelectionAnchor } from "./selection";

export interface AtomicTargetSavePayload {
  piece_id: number;
  /** Durable idempotency key: a repeated command replays the committed target. */
  command_id?: string;
  target_id?: number;
  title?: string;
  note?: string;
  hands?: string;
  method?: string;
  edition?: EditionIdentity;
  anchor?: PersistentPdfSelectionAnchor;
  mapping_evidence?: TargetMappingState;
  asserted_measure_range?: MeasureRange | null;
}

export type SavePayloadError =
  | "invalid_target"
  | "partial_mapping_bundle"
  | "invalid_asserted_range"
  | "unknown_mapping_assertion"
  | "mapping_range_mismatch"
  | "edition_anchor_mismatch"
  | "invalid_anchor"
  | "edition_evidence_mismatch"
  | "incomplete_mapping_evidence";

function sameRange(left: MeasureRange, right: MeasureRange): boolean {
  return left.m_start === right.m_start && left.m_end === right.m_end;
}

function evidenceFingerprint(mapping: TargetMappingState): string | null {
  return mapping.status === "unknown"
    ? mapping.candidate?.edition_fingerprint ?? null
    : mapping.evidence.edition_fingerprint;
}

/**
 * Validates the single transaction payload boundary. An asserted musical
 * identity is never accepted separately from its edition, PDF geometry, and
 * exact/user-confirmed mapping evidence.
 */
export function validateAtomicTargetSavePayload(
  payload: AtomicTargetSavePayload,
): DomainResult<AtomicTargetSavePayload, SavePayloadError> {
  if (
    !Number.isSafeInteger(payload.piece_id) ||
    payload.piece_id < 1 ||
    (payload.target_id !== undefined &&
      (!Number.isSafeInteger(payload.target_id) || payload.target_id < 1))
  ) {
    return failure("invalid_target", "A target save needs valid Piece and target identities.");
  }

  const hasAssertedRange = payload.asserted_measure_range != null;
  const hasAnyMappingPart = Boolean(
    payload.edition || payload.anchor || payload.mapping_evidence || hasAssertedRange,
  );
  const hasMappingBundle = Boolean(payload.edition && payload.anchor && payload.mapping_evidence);

  if (hasAnyMappingPart && !hasMappingBundle) {
    return failure(
      "partial_mapping_bundle",
      "Edition, PDF selection anchor, and mapping evidence must save together.",
    );
  }
  if (!hasMappingBundle) return success({ ...payload });

  const edition = payload.edition as EditionIdentity;
  const anchor = payload.anchor as PersistentPdfSelectionAnchor;
  const mapping = payload.mapping_evidence as TargetMappingState;

  if (
    !createPersistentSelectionAnchor(edition, anchor.rects).ok ||
    anchor.schema_version !== 1
  ) {
    return failure("invalid_anchor", "The PDF selection anchor contains invalid normalized geometry.");
  }

  if (
    edition.edition_id !== anchor.edition_id ||
    edition.edition_fingerprint !== anchor.edition_fingerprint
  ) {
    return failure(
      "edition_anchor_mismatch",
      "The selection anchor belongs to a different score edition or fingerprint.",
    );
  }
  const mappedFingerprint = evidenceFingerprint(mapping);
  if (mappedFingerprint && mappedFingerprint !== edition.edition_fingerprint) {
    return failure(
      "edition_evidence_mismatch",
      "Mapping evidence belongs to a different score edition fingerprint.",
    );
  }

  if (mapping.status === "unknown") {
    if (hasAssertedRange) {
      return failure(
        "unknown_mapping_assertion",
        "Unknown or low-confidence mapping cannot assert a musical measure range.",
      );
    }
    if (mapping.asserted_range !== null) {
      return failure(
        "unknown_mapping_assertion",
        "Unknown mapping evidence must carry a null asserted range.",
      );
    }
    return success({ ...payload });
  }

  if (!payload.asserted_measure_range || !validMeasureRange(payload.asserted_measure_range)) {
    return failure(
      "invalid_asserted_range",
      "Exact or user-confirmed mapping needs a positive asserted measure range.",
    );
  }
  if (!sameRange(payload.asserted_measure_range, mapping.asserted_range)) {
    return failure(
      "mapping_range_mismatch",
      "The asserted range does not match the committed mapping evidence.",
    );
  }
  if (
    (mapping.status === "exact_compatible" &&
      (!mapping.evidence.compatibility_id.trim() || !mapping.evidence.xml_fingerprint.trim())) ||
    (mapping.status === "calibrated_user_confirmed" &&
      (!mapping.evidence.confirmation_id.trim() ||
        mapping.evidence.confirmed_by !== "user" ||
        mapping.evidence.calibration_point_ids.length === 0))
  ) {
    return failure(
      "incomplete_mapping_evidence",
      "Authoritative mapping evidence is incomplete and cannot be committed.",
    );
  }

  return success({ ...payload });
}
