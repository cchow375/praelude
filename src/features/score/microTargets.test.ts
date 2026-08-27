import { describe, expect, it } from "vitest";
import { estimateSpotMeasures, nextSpotName } from "./microTargets";
import type { PdfAnchorRect } from "./types";

const box = (
  page: number,
  x: number,
  y: number,
  w: number,
  h: number,
): PdfAnchorRect => ({ page, x, y, w, h });

// One system, measures 10–17 (eight measures across one rect).
const oneSystem = [box(1, 0.1, 0.2, 0.8, 0.1)];

describe("estimateSpotMeasures", () => {
  it("puts a drag at the very start of the parent on the parent's first measure", () => {
    const spot = box(1, 0.1, 0.21, 0.04, 0.08);
    expect(
      estimateSpotMeasures({ m_start: 10, m_end: 17 }, oneSystem, spot),
    ).toEqual({ m_start: 10, m_end: 10 });
  });

  it("puts a drag at the very end of the parent on the parent's last measure", () => {
    const spot = box(1, 0.85, 0.21, 0.05, 0.08);
    expect(
      estimateSpotMeasures({ m_start: 10, m_end: 17 }, oneSystem, spot),
    ).toEqual({ m_start: 17, m_end: 17 });
  });

  it("interpolates a mid-system drag proportionally", () => {
    // Half-way across an eight-measure system lands on the fifth measure.
    const spot = box(1, 0.5, 0.21, 0.03, 0.08);
    expect(
      estimateSpotMeasures({ m_start: 10, m_end: 17 }, oneSystem, spot),
    ).toEqual({ m_start: 14, m_end: 14 });
  });

  it("widens the range for a drag that covers several measures", () => {
    const spot = box(1, 0.1, 0.21, 0.4, 0.08);
    const range = estimateSpotMeasures(
      { m_start: 10, m_end: 17 },
      oneSystem,
      spot,
    );
    expect(range.m_start).toBe(10);
    expect(range.m_end).toBeGreaterThan(range.m_start);
    expect(range.m_end).toBeLessThanOrEqual(17);
  });

  it("treats each rect of a multi-system parent as an equal slice", () => {
    const twoSystems = [
      box(1, 0.1, 0.2, 0.8, 0.1),
      box(1, 0.1, 0.5, 0.8, 0.1),
    ];
    // Start of the SECOND system is half-way through the parent: m. 14 of 10–17.
    const spot = box(1, 0.1, 0.51, 0.03, 0.08);
    expect(
      estimateSpotMeasures({ m_start: 10, m_end: 17 }, twoSystems, spot),
    ).toEqual({ m_start: 14, m_end: 14 });
  });

  it("orders rects by page before position, so a page-2 system comes second", () => {
    const acrossPages = [
      box(2, 0.1, 0.1, 0.8, 0.1),
      box(1, 0.1, 0.8, 0.8, 0.1),
    ];
    const onPageTwo = box(2, 0.1, 0.11, 0.03, 0.08);
    expect(
      estimateSpotMeasures({ m_start: 1, m_end: 8 }, acrossPages, onPageTwo),
    ).toEqual({ m_start: 5, m_end: 5 });
  });

  it("never returns a range outside the parent's own range", () => {
    for (const x of [-0.5, 0, 0.33, 0.99, 1.5]) {
      const spot = box(1, x, 0.21, 0.02, 0.08);
      const range = estimateSpotMeasures(
        { m_start: 10, m_end: 17 },
        oneSystem,
        spot,
      );
      expect(range.m_start).toBeGreaterThanOrEqual(10);
      expect(range.m_end).toBeLessThanOrEqual(17);
      expect(range.m_end).toBeGreaterThanOrEqual(range.m_start);
    }
  });

  it("falls back to the parent's whole range when the parent has no geometry", () => {
    expect(
      estimateSpotMeasures({ m_start: 4, m_end: 9 }, [], box(1, 0.2, 0.2, 0.1, 0.1)),
    ).toEqual({ m_start: 4, m_end: 9 });
  });

  it("returns the single measure when the parent is one measure long", () => {
    expect(
      estimateSpotMeasures({ m_start: 6, m_end: 6 }, oneSystem, box(1, 0.5, 0.21, 0.02, 0.08)),
    ).toEqual({ m_start: 6, m_end: 6 });
  });

  it("estimates from the nearest system for a drag that strays outside every rect", () => {
    // Just below the single system — an imprecise drag, not a reason to give up.
    const strayed = box(1, 0.5, 0.34, 0.03, 0.04);
    const range = estimateSpotMeasures(
      { m_start: 10, m_end: 17 },
      oneSystem,
      strayed,
    );
    expect(range.m_start).toBe(14);
  });

  it("tolerates a reversed parent range without inverting the result", () => {
    const range = estimateSpotMeasures(
      { m_start: 17, m_end: 10 },
      oneSystem,
      box(1, 0.1, 0.21, 0.03, 0.08),
    );
    expect(range.m_start).toBe(10);
    expect(range.m_end).toBeGreaterThanOrEqual(range.m_start);
  });
});

describe("nextSpotName", () => {
  it("starts at Spot 1 under a parent with no spots", () => {
    expect(nextSpotName([])).toBe("Spot 1");
  });

  it("counts up from the existing spots", () => {
    expect(nextSpotName(["Spot 1", "Spot 2"])).toBe("Spot 3");
  });

  it("never reuses a number after a delete", () => {
    // "Spot 2" was deleted; the next spot must not be a second "Spot 2".
    expect(nextSpotName(["Spot 1", "Spot 3"])).toBe("Spot 4");
  });

  it("ignores renamed siblings when numbering", () => {
    expect(nextSpotName(["left hand only", "Spot 1"])).toBe("Spot 2");
  });

  it("matches case-insensitively and tolerates padding", () => {
    expect(nextSpotName(["  spot 7 "])).toBe("Spot 8");
  });

  it("ignores names that only look numbered", () => {
    expect(nextSpotName(["Spot 2a", "Spot"])).toBe("Spot 1");
  });
});
