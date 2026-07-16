import { describe, expect, it } from "vitest";
import {
  correctCalibrationPoint,
  estimateMeasureAtPosition,
  estimateSelectionMapping,
  validateCalibrationPoints,
  type CalibrationPoint,
  type CalibrationQuery,
} from "./calibration";

function point(
  id: string,
  x: number,
  measure: number,
  overrides: Partial<CalibrationPoint> = {},
): CalibrationPoint {
  return {
    id,
    edition_fingerprint: "pdf-fp",
    page: 2,
    system_index: 3,
    position: { x, y: 0.45 },
    measure: { xml_fingerprint: "xml-fp", measure_number: measure },
    confidence: 0.8,
    revision: 1,
    corrections: [],
    ...overrides,
  };
}

function query(x: number, overrides: Partial<CalibrationQuery> = {}): CalibrationQuery {
  return {
    edition_fingerprint: "pdf-fp",
    page: 2,
    system_index: 3,
    position: { x, y: 0.45 },
    ...overrides,
  };
}

describe("Score Atlas calibration", () => {
  it("interpolates only inside a segment bounded on the same page and system", () => {
    const result = estimateMeasureAtPosition(
      [point("left", 0.1, 10), point("right", 0.5, 14)],
      query(0.3),
    );
    expect(result).toEqual({
      status: "bounded_candidate",
      authoritative: false,
      estimated_measure: 12,
      containing_measure_range: { m_start: 10, m_end: 14 },
      edition_fingerprint: "pdf-fp",
      xml_fingerprint: "xml-fp",
      calibration_point_ids: ["left", "right"],
      confidence: 0.8,
      rationale:
        "Linear candidate inside user-bounded segment left–right; no extrapolation and not authoritative until confirmed.",
    });
  });

  it("refuses sparse calibration and extrapolation", () => {
    expect(estimateMeasureAtPosition([point("only", 0.1, 10)], query(0.2))).toMatchObject({
      status: "unknown",
      reason: "unbounded_position",
      confidence: null,
    });
    expect(
      estimateMeasureAtPosition(
        [point("left", 0.1, 10), point("right", 0.5, 14)],
        query(0.8),
      ),
    ).toMatchObject({ status: "unknown", reason: "unbounded_position" });
  });

  it("does not borrow calibration from another page, system, or edition", () => {
    const points = [point("left", 0.1, 10), point("right", 0.5, 14)];
    expect(estimateMeasureAtPosition(points, query(0.3, { page: 4 }))).toMatchObject({
      status: "unknown",
      reason: "no_edition_calibration",
    });
    expect(
      estimateMeasureAtPosition(points, query(0.3, { edition_fingerprint: "new-scan" })),
    ).toMatchObject({ status: "unknown", reason: "no_edition_calibration" });
  });

  it("returns a visibly non-authoritative, outward-rounded range candidate", () => {
    const points = [point("left", 0.1, 10), point("right", 0.5, 14)];
    const result = estimateSelectionMapping(points, query(0.22), query(0.38));
    expect(result).toMatchObject({
      status: "candidate",
      candidate: {
        candidate_range: { m_start: 11, m_end: 13 },
        authoritative: false,
        confidence: 0.8,
      },
    });
    if (result.status === "candidate") {
      expect(result.candidate.rationale).toContain("review or correct");
    }
  });

  it("refuses a calibrated selection whose endpoint order implies a reversed range", () => {
    const points = [point("left", 0.1, 10), point("right", 0.5, 14)];
    expect(estimateSelectionMapping(points, query(0.4), query(0.2))).toMatchObject({
      status: "unknown",
      confidence: null,
    });
  });

  it("refuses mixed MusicXML identities within one visible system", () => {
    const points = [
      point("left", 0.1, 10),
      point("right", 0.5, 14, {
        measure: { xml_fingerprint: "other-xml", measure_number: 14 },
      }),
    ];
    expect(estimateMeasureAtPosition(points, query(0.3))).toMatchObject({
      status: "unknown",
      reason: "mixed_musicxml_identity",
    });
  });

  it("appends a user correction without mutating the original calibration", () => {
    const points = [point("left", 0.1, 10), point("right", 0.5, 14)];
    const result = correctCalibrationPoint(points, "right", {
      correction_id: "fix-1",
      corrected_measure: { xml_fingerprint: "xml-fp", measure_number: 15 },
      corrected_by: "user",
      corrected_at: "2026-07-15T12:00:00Z",
      reason: "Printed count includes the pickup.",
    });
    expect(result.ok).toBe(true);
    expect(points[1].measure.measure_number).toBe(14);
    expect(points[1].corrections).toEqual([]);
    if (result.ok) {
      expect(result.value[1]).toMatchObject({
        revision: 2,
        measure: { measure_number: 15 },
        corrections: [
          {
            correction_id: "fix-1",
            previous_measure: { measure_number: 14 },
            corrected_measure: { measure_number: 15 },
          },
        ],
      });
    }
  });

  it("rejects corrections that invert a calibrated system", () => {
    const points = [point("left", 0.1, 10), point("right", 0.5, 14)];
    expect(
      correctCalibrationPoint(points, "right", {
        correction_id: "bad-fix",
        corrected_measure: { xml_fingerprint: "xml-fp", measure_number: 9 },
        corrected_by: "user",
        corrected_at: "2026-07-15T12:00:00Z",
      }),
    ).toMatchObject({ ok: false, code: "correction_breaks_calibration" });
  });

  it("validates duplicate positions and non-monotonic measure anchors", () => {
    const validation = validateCalibrationPoints([
      point("a", 0.2, 12),
      point("b", 0.2, 11),
    ]);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["ambiguous_position", "non_monotonic_measures"]),
    );
  });
});
