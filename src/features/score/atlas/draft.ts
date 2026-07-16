import type {
  CalibratedUserConfirmedMapping,
  EditionIdentity,
  ExactCompatibleMapping,
  MappingCandidate,
  MeasureRange,
  PersistentPdfSelectionAnchor,
  TargetDraft,
  TargetMappingState,
  UnknownMapping,
} from "./model";
import type { DomainResult } from "./result";
import { failure, success } from "./result";

export type RangeError = "invalid_measure_range";
export type DraftError =
  | "invalid_draft_identity"
  | "edition_anchor_mismatch";
export type MappingError =
  | RangeError
  | "invalid_exact_evidence"
  | "invalid_candidate"
  | "invalid_confirmation";

export interface ExactCompatibilityEvidence {
  edition_fingerprint: string;
  xml_fingerprint: string;
  compatibility_id: string;
  verified_at: string;
  rationale: string;
}

export interface CalibratedConfirmation {
  confirmation_id: string;
  confirmed_by: "user";
  confirmed_at: string;
  confirmed_range: MeasureRange;
  rationale?: string;
}

export interface TargetDraftDetails {
  title?: string | null;
  note?: string | null;
  hands?: string | null;
  method?: string | null;
}

export function validMeasureRange(range: MeasureRange): boolean {
  return (
    Number.isSafeInteger(range.m_start) &&
    Number.isSafeInteger(range.m_end) &&
    range.m_start >= 1 &&
    range.m_end >= range.m_start
  );
}

export function validateMeasureRange(
  range: MeasureRange,
): DomainResult<MeasureRange, RangeError> {
  if (!validMeasureRange(range)) {
    return failure(
      "invalid_measure_range",
      "A musical range needs positive integer measures in start-to-end order.",
    );
  }
  return success({ ...range });
}

export function unknownMapping(
  rationale: string,
  candidate?: MappingCandidate,
): UnknownMapping {
  return {
    status: "unknown",
    asserted_range: null,
    confidence: candidate?.confidence ?? null,
    rationale: rationale.trim() || "This PDF location has no defensible musical identity yet.",
    ...(candidate ? { candidate: { ...candidate, candidate_range: { ...candidate.candidate_range } } } : {}),
  };
}

export function createTargetDraft(input: {
  draft_id: string;
  piece_id: number;
  edition: EditionIdentity;
  anchor: PersistentPdfSelectionAnchor;
}): DomainResult<TargetDraft, DraftError> {
  if (!input.draft_id.trim() || !Number.isSafeInteger(input.piece_id) || input.piece_id < 1) {
    return failure("invalid_draft_identity", "A target draft needs stable draft and Piece identities.");
  }
  if (
    input.anchor.edition_id !== input.edition.edition_id ||
    input.anchor.edition_fingerprint !== input.edition.edition_fingerprint
  ) {
    return failure(
      "edition_anchor_mismatch",
      "The target selection belongs to a different score edition or fingerprint.",
    );
  }
  return success({
    draft_id: input.draft_id.trim(),
    piece_id: input.piece_id,
    edition: { ...input.edition },
    anchor: { ...input.anchor, rects: input.anchor.rects.map((rect) => ({ ...rect })) },
    mapping: unknownMapping("Select or confirm a musical range before asserting measure identity."),
  });
}

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function withTargetDraftDetails(
  draft: TargetDraft,
  details: TargetDraftDetails,
): TargetDraft {
  const title = optionalText(details.title);
  const note = optionalText(details.note);
  const hands = optionalText(details.hands);
  const method = optionalText(details.method);
  const next = { ...draft };
  delete next.title;
  delete next.note;
  delete next.hands;
  delete next.method;
  if (title) next.title = title;
  if (note) next.note = note;
  if (hands) next.hands = hands;
  if (method) next.method = method;
  return next;
}

export function exactCompatibleMapping(
  assertedRange: MeasureRange,
  evidence: ExactCompatibilityEvidence,
): DomainResult<ExactCompatibleMapping, MappingError> {
  const range = validateMeasureRange(assertedRange);
  if (!range.ok) return range;
  if (
    !evidence.edition_fingerprint.trim() ||
    !evidence.xml_fingerprint.trim() ||
    !evidence.compatibility_id.trim() ||
    !evidence.verified_at.trim() ||
    !evidence.rationale.trim()
  ) {
    return failure(
      "invalid_exact_evidence",
      "Exact mapping needs a compatible XML identity and a visible verification receipt.",
    );
  }
  return success({
    status: "exact_compatible",
    asserted_range: range.value,
    confidence: 1,
    rationale: evidence.rationale.trim(),
    evidence: {
      kind: "compatible_musicxml",
      edition_fingerprint: evidence.edition_fingerprint.trim(),
      xml_fingerprint: evidence.xml_fingerprint.trim(),
      compatibility_id: evidence.compatibility_id.trim(),
      verified_at: evidence.verified_at.trim(),
    },
  });
}

function validCandidate(candidate: MappingCandidate): boolean {
  return (
    candidate.authoritative === false &&
    Boolean(candidate.edition_fingerprint.trim()) &&
    Boolean(candidate.xml_fingerprint.trim()) &&
    validMeasureRange(candidate.candidate_range) &&
    Number.isFinite(candidate.confidence) &&
    candidate.confidence >= 0 &&
    candidate.confidence <= 1 &&
    Boolean(candidate.rationale.trim()) &&
    candidate.calibration_point_ids.length > 0 &&
    candidate.calibration_point_ids.every((id) => Boolean(id.trim()))
  );
}

/** A calibrated candidate becomes authoritative only through this explicit user-confirmation seam. */
export function confirmCalibratedMapping(
  candidate: MappingCandidate,
  confirmation: CalibratedConfirmation,
): DomainResult<CalibratedUserConfirmedMapping, MappingError> {
  if (!validCandidate(candidate)) {
    return failure("invalid_candidate", "The calibrated candidate is incomplete or out of bounds.");
  }
  const range = validateMeasureRange(confirmation.confirmed_range);
  if (!range.ok) return range;
  if (
    confirmation.confirmed_by !== "user" ||
    !confirmation.confirmation_id.trim() ||
    !confirmation.confirmed_at.trim()
  ) {
    return failure(
      "invalid_confirmation",
      "Calibrated measure identity requires an explicit user confirmation receipt.",
    );
  }
  return success({
    status: "calibrated_user_confirmed",
    asserted_range: range.value,
    confidence: candidate.confidence,
    rationale:
      confirmation.rationale?.trim() ||
      `User confirmed the calibrated candidate (${candidate.rationale})`,
    evidence: {
      kind: "user_confirmation",
      edition_fingerprint: candidate.edition_fingerprint,
      xml_fingerprint: candidate.xml_fingerprint,
      calibration_point_ids: [...candidate.calibration_point_ids],
      candidate_range: { ...candidate.candidate_range },
      confirmation_id: confirmation.confirmation_id.trim(),
      confirmed_by: "user",
      confirmed_at: confirmation.confirmed_at.trim(),
    },
  });
}

export function withTargetMapping(
  draft: TargetDraft,
  mapping: TargetMappingState,
): TargetDraft {
  return { ...draft, mapping };
}

/** Unknown/candidate states deliberately return null rather than a guessed range. */
export function authoritativeMeasureRange(
  mapping: TargetMappingState,
): MeasureRange | null {
  return mapping.status === "unknown" ? null : { ...mapping.asserted_range };
}
