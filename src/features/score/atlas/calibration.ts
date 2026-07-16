import type { MappingCandidate, MeasureRange } from "./model";
import type { DomainResult } from "./result";
import { failure, success } from "./result";

export interface NormalizedPdfPosition {
  x: number;
  y: number;
}

export interface MusicXmlMeasureIdentity {
  xml_fingerprint: string;
  measure_number: number;
  /** Native MusicXML identity when present; number alone remains the display coordinate. */
  measure_id?: string;
}

export interface CalibrationCorrection {
  correction_id: string;
  previous_measure: MusicXmlMeasureIdentity;
  corrected_measure: MusicXmlMeasureIdentity;
  corrected_by: "user";
  corrected_at: string;
  reason?: string;
}

export interface CalibrationPoint {
  id: string;
  edition_fingerprint: string;
  page: number;
  system_index: number;
  position: NormalizedPdfPosition;
  measure: MusicXmlMeasureIdentity;
  confidence: number;
  revision: number;
  corrections: CalibrationCorrection[];
}

export interface CalibrationQuery {
  edition_fingerprint: string;
  page: number;
  system_index: number;
  position: NormalizedPdfPosition;
}

export type CalibrationIssueCode =
  | "invalid_point"
  | "invalid_correction"
  | "duplicate_point_id"
  | "duplicate_correction_id"
  | "ambiguous_position"
  | "non_monotonic_measures";

export interface CalibrationIssue {
  code: CalibrationIssueCode;
  point_id?: string;
  message: string;
}

export interface CalibrationValidation {
  valid: boolean;
  issues: CalibrationIssue[];
}

export type CalibrationUnknownReason =
  | "invalid_query"
  | "invalid_calibration"
  | "no_edition_calibration"
  | "unbounded_position"
  | "mixed_musicxml_identity";

export interface UnknownCalibrationEstimate {
  status: "unknown";
  reason: CalibrationUnknownReason;
  rationale: string;
  confidence: null;
}

export interface BoundedCalibrationEstimate {
  status: "bounded_candidate";
  authoritative: false;
  estimated_measure: number;
  containing_measure_range: MeasureRange;
  edition_fingerprint: string;
  xml_fingerprint: string;
  calibration_point_ids: string[];
  confidence: number;
  rationale: string;
}

export type CalibrationEstimate =
  | UnknownCalibrationEstimate
  | BoundedCalibrationEstimate;

export type SelectionCalibrationResult =
  | { status: "unknown"; rationale: string; confidence: null }
  | { status: "candidate"; candidate: MappingCandidate };

export type CorrectionError =
  | "point_not_found"
  | "duplicate_correction"
  | "invalid_correction"
  | "correction_breaks_calibration";

export interface CalibrationCorrectionInput {
  correction_id: string;
  corrected_measure: MusicXmlMeasureIdentity;
  corrected_by: "user";
  corrected_at: string;
  reason?: string;
}

function finiteUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validMeasureIdentity(measure: MusicXmlMeasureIdentity): boolean {
  return (
    Boolean(measure.xml_fingerprint.trim()) &&
    Number.isSafeInteger(measure.measure_number) &&
    measure.measure_number >= 1 &&
    (measure.measure_id === undefined || Boolean(measure.measure_id.trim()))
  );
}

function validPoint(point: CalibrationPoint): boolean {
  return (
    Boolean(point.id.trim()) &&
    Boolean(point.edition_fingerprint.trim()) &&
    Number.isSafeInteger(point.page) &&
    point.page >= 1 &&
    Number.isSafeInteger(point.system_index) &&
    point.system_index >= 1 &&
    finiteUnit(point.position.x) &&
    finiteUnit(point.position.y) &&
    validMeasureIdentity(point.measure) &&
    Number.isFinite(point.confidence) &&
    point.confidence >= 0 &&
    point.confidence <= 1 &&
    Number.isSafeInteger(point.revision) &&
    point.revision >= 1 &&
    Array.isArray(point.corrections)
  );
}

function sameMeasure(
  left: MusicXmlMeasureIdentity,
  right: MusicXmlMeasureIdentity,
): boolean {
  return (
    left.xml_fingerprint === right.xml_fingerprint &&
    left.measure_number === right.measure_number &&
    left.measure_id === right.measure_id
  );
}

function groupKey(point: CalibrationPoint): string {
  return `${point.edition_fingerprint}\u0000${point.page}\u0000${point.system_index}\u0000${point.measure.xml_fingerprint}`;
}

export function validateCalibrationPoints(
  points: CalibrationPoint[],
): CalibrationValidation {
  const issues: CalibrationIssue[] = [];
  const ids = new Set<string>();
  const correctionIds = new Set<string>();
  const groups = new Map<string, CalibrationPoint[]>();

  for (const point of points) {
    if (!validPoint(point)) {
      issues.push({
        code: "invalid_point",
        point_id: point.id,
        message: "Calibration points need finite normalized geometry and positive score identities.",
      });
      continue;
    }
    if (ids.has(point.id)) {
      issues.push({
        code: "duplicate_point_id",
        point_id: point.id,
        message: `Calibration point ${point.id} appears more than once.`,
      });
    }
    ids.add(point.id);
    let correctionCursor: MusicXmlMeasureIdentity | null = null;
    for (const correction of point.corrections) {
      if (!correction.correction_id.trim() || correctionIds.has(correction.correction_id)) {
        issues.push({
          code: "duplicate_correction_id",
          point_id: point.id,
          message: "Calibration correction identities must be non-empty and unique.",
        });
      }
      correctionIds.add(correction.correction_id);
      if (
        correction.corrected_by !== "user" ||
        !correction.corrected_at.trim() ||
        !validMeasureIdentity(correction.previous_measure) ||
        !validMeasureIdentity(correction.corrected_measure) ||
        correction.previous_measure.xml_fingerprint !== point.measure.xml_fingerprint ||
        correction.corrected_measure.xml_fingerprint !== point.measure.xml_fingerprint ||
        (correctionCursor !== null && !sameMeasure(correction.previous_measure, correctionCursor))
      ) {
        issues.push({
          code: "invalid_correction",
          point_id: point.id,
          message: "Calibration correction provenance is incomplete or has a broken chain.",
        });
      }
      correctionCursor = correction.corrected_measure;
    }
    if (correctionCursor !== null && !sameMeasure(correctionCursor, point.measure)) {
      issues.push({
        code: "invalid_correction",
        point_id: point.id,
        message: "The correction chain does not resolve to the point's current measure.",
      });
    }
    const group = groups.get(groupKey(point)) ?? [];
    group.push(point);
    groups.set(groupKey(point), group);
  }

  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (left, right) => left.position.x - right.position.x || left.id.localeCompare(right.id),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (Math.abs(previous.position.x - current.position.x) < Number.EPSILON) {
        issues.push({
          code: "ambiguous_position",
          point_id: current.id,
          message: "Two calibration anchors occupy the same horizontal system position.",
        });
      }
      if (current.measure.measure_number <= previous.measure.measure_number) {
        issues.push({
          code: "non_monotonic_measures",
          point_id: current.id,
          message: "Calibration measures must increase from left to right within one system.",
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

function unknown(
  reason: CalibrationUnknownReason,
  rationale: string,
): UnknownCalibrationEstimate {
  return { status: "unknown", reason, rationale, confidence: null };
}

function validQuery(query: CalibrationQuery): boolean {
  return (
    Boolean(query.edition_fingerprint.trim()) &&
    Number.isSafeInteger(query.page) &&
    query.page >= 1 &&
    Number.isSafeInteger(query.system_index) &&
    query.system_index >= 1 &&
    finiteUnit(query.position.x) &&
    finiteUnit(query.position.y)
  );
}

function roundedEstimate(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * Estimates only inside a segment bounded by two calibration points on the
 * same edition, page, system, and MusicXML source. It never extrapolates.
 */
export function estimateMeasureAtPosition(
  points: CalibrationPoint[],
  query: CalibrationQuery,
): CalibrationEstimate {
  if (!validQuery(query)) {
    return unknown("invalid_query", "The PDF position is incomplete or outside normalized bounds.");
  }
  const validation = validateCalibrationPoints(points);
  if (!validation.valid) {
    return unknown(
      "invalid_calibration",
      `Calibration needs correction before use: ${validation.issues[0]?.message ?? "invalid points"}`,
    );
  }
  const local = points
    .filter(
      (point) =>
        point.edition_fingerprint === query.edition_fingerprint &&
        point.page === query.page &&
        point.system_index === query.system_index,
    )
    .sort((left, right) => left.position.x - right.position.x);
  if (local.length === 0) {
    return unknown(
      "no_edition_calibration",
      "No calibration points exist for this edition, page, and system.",
    );
  }

  const xmlFingerprints = new Set(local.map((point) => point.measure.xml_fingerprint));
  if (xmlFingerprints.size !== 1) {
    return unknown(
      "mixed_musicxml_identity",
      "This system's calibration points refer to different MusicXML sources.",
    );
  }

  const exact = local.find(
    (point) => Math.abs(point.position.x - query.position.x) <= Number.EPSILON,
  );
  if (exact) {
    return {
      status: "bounded_candidate",
      authoritative: false,
      estimated_measure: exact.measure.measure_number,
      containing_measure_range: {
        m_start: exact.measure.measure_number,
        m_end: exact.measure.measure_number,
      },
      edition_fingerprint: query.edition_fingerprint,
      xml_fingerprint: exact.measure.xml_fingerprint,
      calibration_point_ids: [exact.id],
      confidence: exact.confidence,
      rationale: `Position coincides with user calibration anchor ${exact.id}; range still requires review before save.`,
    };
  }

  for (let index = 1; index < local.length; index += 1) {
    const left = local[index - 1];
    const right = local[index];
    if (left.position.x < query.position.x && query.position.x < right.position.x) {
      const ratio =
        (query.position.x - left.position.x) /
        (right.position.x - left.position.x);
      const estimated =
        left.measure.measure_number +
        ratio * (right.measure.measure_number - left.measure.measure_number);
      return {
        status: "bounded_candidate",
        authoritative: false,
        estimated_measure: roundedEstimate(estimated),
        containing_measure_range: {
          m_start: left.measure.measure_number,
          m_end: right.measure.measure_number,
        },
        edition_fingerprint: query.edition_fingerprint,
        xml_fingerprint: left.measure.xml_fingerprint,
        calibration_point_ids: [left.id, right.id],
        confidence: Math.min(left.confidence, right.confidence),
        rationale: `Linear candidate inside user-bounded segment ${left.id}–${right.id}; no extrapolation and not authoritative until confirmed.`,
      };
    }
  }

  return unknown(
    "unbounded_position",
    "The position falls outside a pair of calibration anchors; extrapolation is refused.",
  );
}

export function estimateSelectionMapping(
  points: CalibrationPoint[],
  start: CalibrationQuery,
  end: CalibrationQuery,
): SelectionCalibrationResult {
  const startEstimate = estimateMeasureAtPosition(points, start);
  if (startEstimate.status === "unknown") {
    return { status: "unknown", rationale: startEstimate.rationale, confidence: null };
  }
  const endEstimate = estimateMeasureAtPosition(points, end);
  if (endEstimate.status === "unknown") {
    return { status: "unknown", rationale: endEstimate.rationale, confidence: null };
  }
  if (
    startEstimate.edition_fingerprint !== endEstimate.edition_fingerprint ||
    startEstimate.xml_fingerprint !== endEstimate.xml_fingerprint
  ) {
    return {
      status: "unknown",
      rationale: "Selection endpoints do not share one edition and MusicXML identity.",
      confidence: null,
    };
  }
  if (startEstimate.estimated_measure > endEstimate.estimated_measure) {
    return {
      status: "unknown",
      rationale: "Calibrated endpoints produce a reversed measure range; correct the anchors.",
      confidence: null,
    };
  }

  const candidateRange: MeasureRange = {
    m_start: Math.max(1, Math.floor(startEstimate.estimated_measure)),
    m_end: Math.ceil(endEstimate.estimated_measure),
  };
  return {
    status: "candidate",
    candidate: {
      edition_fingerprint: startEstimate.edition_fingerprint,
      xml_fingerprint: startEstimate.xml_fingerprint,
      candidate_range: candidateRange,
      confidence: Math.min(startEstimate.confidence, endEstimate.confidence),
      rationale:
        "Outward-rounded interpolation inside explicit calibration bounds; review or correct before asserting the range.",
      calibration_point_ids: [
        ...new Set([
          ...startEstimate.calibration_point_ids,
          ...endEstimate.calibration_point_ids,
        ]),
      ],
      authoritative: false,
    },
  };
}

function correctionIds(points: CalibrationPoint[]): Set<string> {
  return new Set(
    points.flatMap((point) => point.corrections.map((correction) => correction.correction_id)),
  );
}

/** Appends correction provenance to a copied point; the input array and point stay unchanged. */
export function correctCalibrationPoint(
  points: CalibrationPoint[],
  pointId: string,
  correction: CalibrationCorrectionInput,
): DomainResult<CalibrationPoint[], CorrectionError> {
  const pointIndex = points.findIndex((point) => point.id === pointId);
  if (pointIndex < 0) {
    return failure("point_not_found", `Calibration point ${pointId} does not exist.`);
  }
  if (
    !correction.correction_id.trim() ||
    correctionIds(points).has(correction.correction_id)
  ) {
    return failure("duplicate_correction", "Calibration correction IDs must be non-empty and unique.");
  }
  const current = points[pointIndex];
  if (
    correction.corrected_by !== "user" ||
    !correction.corrected_at.trim() ||
    !validMeasureIdentity(correction.corrected_measure) ||
    correction.corrected_measure.xml_fingerprint !== current.measure.xml_fingerprint
  ) {
    return failure(
      "invalid_correction",
      "A correction needs an explicit user receipt and the same MusicXML source.",
    );
  }

  const nextPoint: CalibrationPoint = {
    ...current,
    measure: { ...correction.corrected_measure },
    revision: current.revision + 1,
    corrections: [
      ...current.corrections,
      {
        correction_id: correction.correction_id.trim(),
        previous_measure: { ...current.measure },
        corrected_measure: { ...correction.corrected_measure },
        corrected_by: "user",
        corrected_at: correction.corrected_at.trim(),
        ...(correction.reason?.trim() ? { reason: correction.reason.trim() } : {}),
      },
    ],
  };
  const next = points.map((point, index) => (index === pointIndex ? nextPoint : point));
  const validation = validateCalibrationPoints(next);
  if (!validation.valid) {
    return failure(
      "correction_breaks_calibration",
      `Correction would make the calibration inconsistent: ${validation.issues[0]?.message}`,
    );
  }
  return success(next);
}
