import { describe, expect, it } from "vitest";

import {
  resolveMeasureRange,
  validateAgainstXml,
  type LineAnchor,
  type MappingBox,
} from "./anchors";

/**
 * The whole atlas stack (Rust `PdfAnchorRect.{x,y,w,h}: f64`, TS `finiteUnit`,
 * `NormalizedPdfPosition`) stores geometry as NORMALIZED 0–1 fractions, and the
 * plan's own Task 4.1 examples use y=0.20 / y=0.34. So the `*Pct` fields here are
 * 0–1 fractions, not 0–100 percentages. These fixtures follow that convention.
 */

// Two systems on page 1: the line starting at m.45 sits at y=0.20, the next
// line (starting at m.52) sits at y=0.34. Line 45 therefore spans measures
// 45→52 horizontally (52 is the downbeat of the following system).
const twoSystemPage: LineAnchor[] = [
  { page: 1, yPct: 0.2, measure: 45 },
  { page: 1, yPct: 0.34, measure: 52 },
];

function box(partial: Partial<MappingBox>): MappingBox {
  return {
    page: 1,
    xPct: 0.1,
    yPct: 0.25,
    wPct: 0.5,
    hPct: 0.04,
    ...partial,
  };
}

describe("resolveMeasureRange", () => {
  it("resolves a box on a known line to a range within the two bounding anchors", () => {
    const range = resolveMeasureRange(
      box({ xPct: 0.1, wPct: 0.5, yPct: 0.25 }),
      twoSystemPage,
    );
    expect(range.mStart).toBeGreaterThanOrEqual(45);
    expect(range.mEnd).toBeLessThanOrEqual(52);
    expect(range.mStart).toBeLessThanOrEqual(range.mEnd);
    // Interpolated between two adjacent known anchors → high confidence.
    expect(range.confidence).toBeGreaterThan(0.5);
  });

  it("interpolates measure position across a line by x (left box < right box)", () => {
    const left = resolveMeasureRange(
      box({ xPct: 0.0, wPct: 0.2, yPct: 0.25 }),
      twoSystemPage,
    );
    const right = resolveMeasureRange(
      box({ xPct: 0.6, wPct: 0.2, yPct: 0.25 }),
      twoSystemPage,
    );
    expect(right.mStart).toBeGreaterThanOrEqual(left.mStart);
    expect(left.mStart).toBe(45); // x=0 → the line's starting measure
  });

  it("returns confidence 0 when the box's page has no anchors (anchors on a different page)", () => {
    const otherPageBox = box({ page: 2, yPct: 0.25 });
    const range = resolveMeasureRange(otherPageBox, twoSystemPage);
    expect(range.confidence).toBe(0);
    expect(range.mStart).toBeLessThanOrEqual(range.mEnd);
  });

  it("returns confidence 0 for an empty anchor list", () => {
    const range = resolveMeasureRange(box({}), []);
    expect(range.confidence).toBe(0);
  });

  it("sorts anchors by yPct (out-of-order input yields the same result)", () => {
    const unordered: LineAnchor[] = [
      { page: 1, yPct: 0.34, measure: 52 },
      { page: 1, yPct: 0.2, measure: 45 },
    ];
    const ordered = resolveMeasureRange(box({ yPct: 0.25 }), twoSystemPage);
    const shuffled = resolveMeasureRange(box({ yPct: 0.25 }), unordered);
    expect(shuffled).toEqual(ordered);
  });

  it("spans both systems' measures when the box crosses a system break", () => {
    const threeSystems: LineAnchor[] = [
      { page: 1, yPct: 0.2, measure: 45 },
      { page: 1, yPct: 0.34, measure: 52 },
      { page: 1, yPct: 0.5, measure: 60 },
    ];
    // Box top on line 45 (y≈0.25), bottom on line 52 (y≈0.40).
    const range = resolveMeasureRange(
      box({ xPct: 0.1, wPct: 0.5, yPct: 0.25, hPct: 0.15 }),
      threeSystems,
    );
    expect(range.mStart).toBeLessThanOrEqual(52);
    expect(range.mEnd).toBeGreaterThanOrEqual(52); // crosses into the second system
    expect(range.mStart).toBeLessThan(range.mEnd);
    expect(range.confidence).toBeGreaterThan(0);
  });

  it("gives a coarse but usable low-confidence range on a single-anchor page", () => {
    const single: LineAnchor[] = [{ page: 1, yPct: 0.2, measure: 45 }];
    const range = resolveMeasureRange(box({ yPct: 0.25 }), single);
    expect(range.mStart).toBeGreaterThanOrEqual(1);
    expect(range.mStart).toBeLessThanOrEqual(range.mEnd);
    expect(range.confidence).toBeGreaterThan(0);
    expect(range.confidence).toBeLessThan(0.5); // coarse: no second anchor to bound the line
  });

  it("handles a degenerate zero-height box without throwing and keeps mStart<=mEnd", () => {
    const range = resolveMeasureRange(
      box({ hPct: 0, yPct: 0.25 }),
      twoSystemPage,
    );
    expect(Number.isFinite(range.mStart)).toBe(true);
    expect(Number.isFinite(range.mEnd)).toBe(true);
    expect(range.mStart).toBeLessThanOrEqual(range.mEnd);
  });

  it("always yields mStart<=mEnd even when anchor measures decrease down the page", () => {
    const reversed: LineAnchor[] = [
      { page: 1, yPct: 0.2, measure: 52 },
      { page: 1, yPct: 0.34, measure: 45 },
    ];
    const range = resolveMeasureRange(
      box({ xPct: 0.1, wPct: 0.6, yPct: 0.25 }),
      reversed,
    );
    expect(range.mStart).toBeLessThanOrEqual(range.mEnd);
  });
});

describe("validateAgainstXml", () => {
  it("warns and fails when mEnd is beyond the score's last measure", () => {
    const result = validateAgainstXml({ mStart: 45, mEnd: 50 }, 48, false);
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/beyond|last measure/i);
  });

  it("passes cleanly when the range fits and there is no pickup", () => {
    const result = validateAgainstXml({ mStart: 45, mEnd: 47 }, 48, false);
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("warns about ±1 ambiguity when the score has a pickup measure", () => {
    const result = validateAgainstXml({ mStart: 12, mEnd: 16 }, 48, true);
    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/pickup|±1|anacrusis/i);
  });

  it("treats a non-positive xmlMaxMeasure as 'XML unavailable' (optional) and does not flag beyond-score", () => {
    const result = validateAgainstXml({ mStart: 45, mEnd: 999 }, 0, false);
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});
