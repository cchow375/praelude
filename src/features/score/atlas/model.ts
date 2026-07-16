import type { PdfAnchorRect } from "../types";

export type MappingStatus =
  | "exact_compatible"
  | "calibrated_user_confirmed"
  | "unknown";

export interface MeasureRange {
  m_start: number;
  m_end: number;
}

export interface EditionIdentity {
  edition_id: string;
  edition_fingerprint: string;
}

/**
 * Edition-bound PDF geometry. Rectangles are normalized to page coordinates,
 * so this value does not change when the viewer zoom changes.
 */
export interface PersistentPdfSelectionAnchor {
  /** Separate from the legacy PdfAnchorMap `v: 1` envelope. */
  schema_version: 1;
  edition_id: string;
  edition_fingerprint: string;
  rects: PdfAnchorRect[];
}

export interface MappingCandidate {
  edition_fingerprint: string;
  xml_fingerprint: string;
  candidate_range: MeasureRange;
  confidence: number;
  rationale: string;
  calibration_point_ids: string[];
  /** Candidates are advisory until Christian confirms or corrects them. */
  authoritative: false;
}

export interface ExactCompatibleMapping {
  status: "exact_compatible";
  asserted_range: MeasureRange;
  confidence: 1;
  rationale: string;
  evidence: {
    kind: "compatible_musicxml";
    edition_fingerprint: string;
    xml_fingerprint: string;
    compatibility_id: string;
    verified_at: string;
  };
}

export interface CalibratedUserConfirmedMapping {
  status: "calibrated_user_confirmed";
  asserted_range: MeasureRange;
  confidence: number;
  rationale: string;
  evidence: {
    kind: "user_confirmation";
    edition_fingerprint: string;
    xml_fingerprint: string;
    calibration_point_ids: string[];
    candidate_range: MeasureRange;
    confirmation_id: string;
    confirmed_by: "user";
    confirmed_at: string;
  };
}

export interface UnknownMapping {
  status: "unknown";
  asserted_range: null;
  confidence: number | null;
  rationale: string;
  candidate?: MappingCandidate;
}

export type TargetMappingState =
  | ExactCompatibleMapping
  | CalibratedUserConfirmedMapping
  | UnknownMapping;

export interface TargetDraft {
  draft_id: string;
  piece_id: number;
  edition: EditionIdentity;
  anchor: PersistentPdfSelectionAnchor;
  title?: string;
  note?: string;
  hands?: string;
  method?: string;
  mapping: TargetMappingState;
}
