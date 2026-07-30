import { describe, expect, it } from "vitest";

import {
  buildMeasureStrip,
  measureRangeForSystem,
  placeMeasure,
  readingOrder,
  landmarksFromMeasureFacts,
  selectSystemForMeasure,
  systemForMeasure,
  type MeasureLandmark,
} from "./strip";
import type { LineAnchor } from "./anchors";

/**
 * Geometry is normalized 0–1 (top = 0), matching the atlas stack. These fixtures
 * describe systems the wizard's line anchors have marked: reading order is
 * (page, yPct).
 */

// Page 1: three systems — m.1 @ y=0.20, m.5 @ y=0.40, m.9 @ y=0.60.
const monotonic: LineAnchor[] = [
  { page: 1, yPct: 0.2, measure: 1 },
  { page: 1, yPct: 0.4, measure: 5 },
  { page: 1, yPct: 0.6, measure: 9 },
];

describe("readingOrder", () => {
  it("sorts by page then vertical position without mutating input", () => {
    const shuffled: LineAnchor[] = [
      { page: 2, yPct: 0.1, measure: 20 },
      { page: 1, yPct: 0.6, measure: 9 },
      { page: 1, yPct: 0.2, measure: 1 },
    ];
    const before = [...shuffled];
    const ordered = readingOrder(shuffled);
    expect(ordered.map((a) => a.measure)).toEqual([1, 9, 20]);
    expect(shuffled).toEqual(before); // non-mutating
  });
});

describe("buildMeasureStrip — systems from anchors", () => {
  it("bounds each system by the next anchor's start (inclusive mEnd)", () => {
    const strip = buildMeasureStrip(monotonic);
    expect(strip.systems).toHaveLength(3);
    // m.1 system spans measures 1..4 (up to the bar before m.5).
    expect(strip.systems[0]).toMatchObject({
      mStart: 1,
      mEnd: 4,
      bars: 4,
      bounded: true,
    });
    expect(strip.systems[1]).toMatchObject({
      mStart: 5,
      mEnd: 8,
      bounded: true,
    });
    // The final system is open (no next anchor, no XML total): coarse, mEnd=mStart.
    expect(strip.systems[2]).toMatchObject({
      mStart: 9,
      mEnd: 9,
      bounded: false,
    });
  });

  it("carries a system's vertical band to the next same-page anchor", () => {
    const strip = buildMeasureStrip(monotonic);
    expect(strip.systems[0].yTop).toBeCloseTo(0.2);
    expect(strip.systems[0].yBottom).toBeCloseTo(0.4);
    // Last system on the page runs to the page bottom.
    expect(strip.systems[2].yBottom).toBeCloseTo(1);
  });

  it("extends the final system to the XML total when known", () => {
    const strip = buildMeasureStrip(monotonic, { xmlMaxMeasure: 12 });
    expect(strip.systems[2]).toMatchObject({ mStart: 9, mEnd: 12, bars: 4 });
    expect(strip.maxMeasure).toBe(12);
  });
});

describe("buildMeasureStrip — measure rows + density-aware weight", () => {
  it("emits one row per measure across the anchored span", () => {
    const strip = buildMeasureStrip(monotonic);
    expect(strip.measures.map((m) => m.measure)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("marks anchored measures at full weight", () => {
    const strip = buildMeasureStrip(monotonic);
    const m5 = strip.measures.find((m) => m.measure === 5)!;
    expect(m5.anchored).toBe(true);
    expect(m5.weight).toBe(1);
    expect(m5.systemIndex).toBe(1);
  });

  it("weights an interior measure of a denser (fewer-bar) system higher than a sparser one", () => {
    // Dense: 2 systems 2 bars apart. Sparse: 2 systems 8 bars apart.
    const dense = buildMeasureStrip([
      { page: 1, yPct: 0.2, measure: 1 },
      { page: 1, yPct: 0.4, measure: 3 }, // system 0 spans 1..2 (2 bars)
    ]);
    const sparse = buildMeasureStrip([
      { page: 1, yPct: 0.2, measure: 1 },
      { page: 1, yPct: 0.4, measure: 9 }, // system 0 spans 1..8 (8 bars)
    ]);
    const denseInterior = dense.measures.find((m) => m.measure === 2)!;
    const sparseInterior = sparse.measures.find((m) => m.measure === 2)!;
    expect(denseInterior.anchored).toBe(false);
    expect(sparseInterior.anchored).toBe(false);
    expect(denseInterior.weight).toBeGreaterThan(sparseInterior.weight);
  });

  it("attaches landmarks to their measure row verbatim", () => {
    const landmarks: MeasureLandmark[] = [
      { measure: 5, label: "3/4", kind: "time" },
      { measure: 9, label: "A", kind: "rehearsal" },
    ];
    const strip = buildMeasureStrip(monotonic, { landmarks });
    expect(strip.measures.find((m) => m.measure === 5)!.landmark).toEqual({
      measure: 5,
      label: "3/4",
      kind: "time",
    });
    expect(strip.measures.find((m) => m.measure === 9)!.landmark?.label).toBe(
      "A",
    );
    expect(
      strip.measures.find((m) => m.measure === 2)!.landmark,
    ).toBeUndefined();
  });

  it("returns an empty strip for no anchors", () => {
    const strip = buildMeasureStrip([]);
    expect(strip.systems).toHaveLength(0);
    expect(strip.measures).toHaveLength(0);
    expect(strip.warnings).toHaveLength(0);
  });
});

describe("buildMeasureStrip — monotonicity + clamping (surfacing disagreements)", () => {
  it("surfaces a quiet warning when an anchor goes backward, and does not interpolate across the break", () => {
    const anchors: LineAnchor[] = [
      { page: 1, yPct: 0.2, measure: 10 },
      { page: 1, yPct: 0.4, measure: 14 },
      { page: 1, yPct: 0.6, measure: 3 }, // backward — section boundary / mis-entry
    ];
    const strip = buildMeasureStrip(anchors);
    const warning = strip.warnings.find((w) => w.kind === "non_monotonic");
    expect(warning).toBeDefined();
    expect(warning!.measure).toBe(3);
    expect(warning!.message).toMatch(/backward|check|won't interpolate/i);
    // The m.14 system can't be bounded by the backward anchor, so it clamps to
    // its own start; the earlier m.10 system stays bounded.
    expect(strip.systems[0]).toMatchObject({
      mStart: 10,
      mEnd: 13,
      bounded: true,
    });
    expect(strip.systems[1]).toMatchObject({
      mStart: 14,
      mEnd: 14,
      bounded: false,
    });
    expect(strip.systems[2]).toMatchObject({
      mStart: 3,
      mEnd: 3,
      bounded: false,
    });
  });

  it("flags a duplicated measure without dropping the anchor", () => {
    const anchors: LineAnchor[] = [
      { page: 1, yPct: 0.2, measure: 5 },
      { page: 1, yPct: 0.4, measure: 5 }, // repeat
    ];
    const strip = buildMeasureStrip(anchors);
    expect(strip.warnings.some((w) => w.kind === "duplicate")).toBe(true);
    expect(strip.systems).toHaveLength(2);
  });

  it("flags an anchor beyond the XML total", () => {
    const anchors: LineAnchor[] = [
      { page: 1, yPct: 0.2, measure: 1 },
      { page: 1, yPct: 0.4, measure: 40 },
    ];
    const strip = buildMeasureStrip(anchors, { xmlMaxMeasure: 30 });
    expect(strip.warnings.some((w) => w.kind === "beyond_xml")).toBe(true);
  });

  it("does not warn on a clean monotonic map", () => {
    expect(buildMeasureStrip(monotonic).warnings).toHaveLength(0);
  });
});

describe("systemForMeasure", () => {
  it("finds the containing system by inclusive span", () => {
    const strip = buildMeasureStrip(monotonic, { xmlMaxMeasure: 12 });
    expect(systemForMeasure(strip.systems, 3)!.index).toBe(0);
    expect(systemForMeasure(strip.systems, 5)!.index).toBe(1);
    expect(systemForMeasure(strip.systems, 11)!.index).toBe(2);
  });

  it("returns null below the first anchor", () => {
    const strip = buildMeasureStrip(monotonic);
    expect(systemForMeasure(strip.systems, 0)).toBeNull();
  });
});

describe("two-way highlight selection", () => {
  it("placeMeasure → page + system band (measure → PDF direction)", () => {
    const strip = buildMeasureStrip(monotonic);
    const placed = placeMeasure(strip, 6)!;
    expect(placed.systemIndex).toBe(1);
    expect(placed.page).toBe(1);
    expect(placed.yTop).toBeCloseTo(0.4);
    expect(placed.yBottom).toBeCloseTo(0.6);
    expect(placed.anchored).toBe(false); // m.6 is interior to the m.5 system
    expect(placed.weight).toBeGreaterThan(0);
    expect(placed.weight).toBeLessThan(1);
  });

  it("placeMeasure marks an exact anchor measure as anchored, full weight", () => {
    const strip = buildMeasureStrip(monotonic);
    const placed = placeMeasure(strip, 5)!;
    expect(placed.anchored).toBe(true);
    expect(placed.weight).toBe(1);
  });

  it("placeMeasure returns null for an unplaceable measure", () => {
    const strip = buildMeasureStrip(monotonic);
    expect(placeMeasure(strip, 0)).toBeNull();
  });

  it("measureRangeForSystem → strip rows (system → measure direction)", () => {
    const strip = buildMeasureStrip(monotonic);
    expect(measureRangeForSystem(strip, 0)).toEqual({ mStart: 1, mEnd: 4 });
    expect(measureRangeForSystem(strip, 1)).toEqual({ mStart: 5, mEnd: 8 });
    expect(measureRangeForSystem(strip, 99)).toBeNull();
  });

  it("selectSystemForMeasure round-trips against measureRangeForSystem", () => {
    const strip = buildMeasureStrip(monotonic);
    const idx = selectSystemForMeasure(strip, 6)!;
    const range = measureRangeForSystem(strip, idx)!;
    expect(6).toBeGreaterThanOrEqual(range.mStart);
    expect(6).toBeLessThanOrEqual(range.mEnd);
  });
});

describe("landmarksFromMeasureFacts", () => {
  it("maps key/time/tempo/rehearsal facts to verbatim landmark labels", () => {
    const landmarks = landmarksFromMeasureFacts([
      { number: 1, key: "-2 fifths", time: "3/4" },
      { number: 9, tempo: "quarter ≈ 92 BPM" },
      { number: 17, rehearsal: "A" },
      { number: 33, section: "Trio" },
    ]);
    expect(landmarks).toEqual([
      { measure: 1, kind: "time", label: "3/4" },
      { measure: 9, kind: "tempo", label: "quarter ≈ 92 BPM" },
      { measure: 17, kind: "rehearsal", label: "A" },
      { measure: 33, kind: "section", label: "Trio" },
    ]);
  });

  it("keeps at most one landmark per measure, by rehearsal → section → tempo → time → key priority", () => {
    const landmarks = landmarksFromMeasureFacts([
      { number: 1, key: "0 fifths", time: "4/4", tempo: "♩=120", rehearsal: "A" },
      { number: 2, key: "1 fifths", time: "6/8" },
    ]);
    expect(landmarks).toEqual([
      { measure: 1, kind: "rehearsal", label: "A" },
      { measure: 2, kind: "time", label: "6/8" },
    ]);
  });

  it("ignores blank facts and measures with no facts at all", () => {
    expect(
      landmarksFromMeasureFacts([
        { number: 1 },
        { number: 2, time: "   ", rehearsal: "" },
        { number: 3, key: "2 fifths" },
      ]),
    ).toEqual([{ measure: 3, kind: "key", label: "2 fifths" }]);
  });
});
