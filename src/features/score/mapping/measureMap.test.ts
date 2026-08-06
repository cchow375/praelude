import { afterEach, describe, expect, it } from "vitest";
import {
  dragBarline,
  getMeasureMapEntry,
  isNeedsClientRaster,
  publishMeasureMap,
  renumberBar,
  resetMeasureMapStoreForTests,
  subscribeMeasureMap,
  type MapBar,
  type MapSystem,
  type MeasureMapPageRow,
} from "./measureMap";

function bar(
  number: number,
  xRight: number,
  source: MapBar["source"] = "model",
): MapBar {
  return { x_right: xRight, number, source };
}

function system(bars: MapBar[]): MapSystem {
  return { y_top: 0.1, y_bottom: 0.2, x_left: 0.05, x_right: 0.95, bars };
}

/** Two pages, two systems each, four bars per system — 16 bars total,
 * numbered 1..16, all model-sourced. A realistic post-reconcile shape. */
function freshPages(): MeasureMapPageRow[] {
  let n = 1;
  const mkSystem = () =>
    system([bar(n++, 0.3), bar(n++, 0.5), bar(n++, 0.7), bar(n++, 0.9)]);
  return [
    { page: 1, map: { version: 1, systems: [mkSystem(), mkSystem()] } },
    { page: 2, map: { version: 1, systems: [mkSystem(), mkSystem()] } },
  ];
}

function numbers(pages: MeasureMapPageRow[]): number[] {
  return pages.flatMap((row) =>
    row.map.systems.flatMap((sys) => sys.bars.map((b) => b.number)),
  );
}

describe("renumberBar", () => {
  it("forward-fills every bar after the pinned bar", () => {
    // Pin bar index 4 (page 1, system 1, bar 0 — 0-based across the flat
    // stream index 4) to 101; everything from there on should read
    // 101,102,103,... and the pinned bar becomes source:"user".
    const pages = freshPages();
    const { pages: next, conflicts } = renumberBar(
      pages,
      { pageIndex: 0, systemIndex: 1, barIndex: 0 },
      101,
    );
    expect(conflicts).toEqual([]);
    // Bars before the pin are the ONLY anchor's backward-fill (97..100);
    // everything from the pin on is its forward-fill (101..112).
    expect(numbers(next)).toEqual([
      97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111,
      112,
    ]);
    expect(next[0].map.systems[1].bars[0].source).toBe("user");
  });

  it("backward-fills every bar before the pinned bar", () => {
    const pages = freshPages();
    // Pin the very last bar (flat index 15) to 200; every earlier bar fills
    // backward from it: 200-15=185 .. 200.
    const { pages: next, conflicts } = renumberBar(
      pages,
      { pageIndex: 1, systemIndex: 1, barIndex: 3 },
      200,
    );
    expect(conflicts).toEqual([]);
    expect(numbers(next)).toEqual(
      Array.from({ length: 16 }, (_, i) => 200 - (15 - i)),
    );
  });

  it("fills sequentially between two agreeing user pins", () => {
    const pages = freshPages();
    // Pin flat index 0 to 1, then pin flat index 7 (8 bars later) to 8 — an
    // exact match for the gap, so no conflict and a clean 1..16 fill.
    const first = renumberBar(
      pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 0 },
      1,
    );
    const { pages: next, conflicts } = renumberBar(
      first.pages,
      { pageIndex: 0, systemIndex: 1, barIndex: 3 },
      8,
    );
    expect(conflicts).toEqual([]);
    expect(numbers(next)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it("flags a continuity_break when two user pins disagree", () => {
    const pages = freshPages();
    // Pin flat index 0 to 1, then pin flat index 3 (only 3 bars later) to 50
    // — the numbers imply a gap of 49 but only 3 bars separate them.
    const first = renumberBar(
      pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 0 },
      1,
    );
    const { conflicts } = renumberBar(
      first.pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 3 },
      50,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "continuity_break",
      expected: 49,
      found: 3,
    });
  });

  it("a later user pin overrides an earlier model number and clears once it agrees", () => {
    const pages = freshPages();
    // First pin creates a disagreement…
    const first = renumberBar(
      pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 0 },
      1,
    );
    const conflicted = renumberBar(
      first.pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 3 },
      50,
    );
    expect(conflicted.conflicts).toHaveLength(1);
    // …re-pinning the SAME bar to the number the gap actually implies clears it.
    const fixed = renumberBar(
      conflicted.pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 3 },
      4,
    );
    expect(fixed.conflicts).toEqual([]);
    expect(fixed.pages[0].map.systems[0].bars[3].source).toBe("user");
  });

  it("trusts the user pin over a printed-number model source at the same bar", () => {
    const pages = freshPages();
    pages[0].map.systems[0].bars[1] = {
      x_right: 0.5,
      number: 999,
      confidence: 0.97,
      source: "model",
    };
    const { pages: next } = renumberBar(
      pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 1 },
      2,
    );
    const pinned = next[0].map.systems[0].bars[1];
    expect(pinned.number).toBe(2);
    expect(pinned.source).toBe("user");
  });

  it("never lets a fill go negative", () => {
    const pages = freshPages();
    const { pages: next } = renumberBar(
      pages,
      { pageIndex: 1, systemIndex: 1, barIndex: 3 },
      2,
    );
    expect(
      next.flatMap((r) =>
        r.map.systems.flatMap((s) => s.bars.map((b) => b.number)),
      ),
    ).not.toContain(-1);
    expect(Math.min(...numbers(next))).toBeGreaterThanOrEqual(0);
  });
});

describe("dragBarline", () => {
  it("moves x_right and keeps source unchanged", () => {
    const pages = freshPages();
    const next = dragBarline(
      pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 1 },
      0.6,
    );
    expect(next[0].map.systems[0].bars[1].x_right).toBeCloseTo(0.6);
    expect(next[0].map.systems[0].bars[1].source).toBe("model");
  });

  it("clamps between the previous and next bar", () => {
    const pages = freshPages(); // bars at 0.3, 0.5, 0.7, 0.9
    const tooFarLeft = dragBarline(
      pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 1 },
      0.1,
    );
    expect(tooFarLeft[0].map.systems[0].bars[1].x_right).toBeGreaterThan(0.3);
    expect(tooFarLeft[0].map.systems[0].bars[1].x_right).toBeLessThan(0.5);

    const tooFarRight = dragBarline(
      pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 1 },
      0.95,
    );
    expect(tooFarRight[0].map.systems[0].bars[1].x_right).toBeLessThan(0.7);
  });

  it("clamps the first bar against the system's x_left and the last against x_right", () => {
    const pages = freshPages();
    const first = dragBarline(
      pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 0 },
      -1,
    );
    expect(first[0].map.systems[0].bars[0].x_right).toBeGreaterThan(0.05);

    const last = dragBarline(
      pages,
      { pageIndex: 0, systemIndex: 0, barIndex: 3 },
      5,
    );
    expect(last[0].map.systems[0].bars[3].x_right).toBeLessThan(0.95);
  });
});

describe("isNeedsClientRaster", () => {
  it("matches the plain-string rejection", () => {
    expect(isNeedsClientRaster("needs_client_raster")).toBe(true);
  });

  it("matches an Error-wrapped rejection", () => {
    expect(isNeedsClientRaster(new Error("needs_client_raster"))).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isNeedsClientRaster("some other failure")).toBe(false);
    expect(isNeedsClientRaster(new Error("some other failure"))).toBe(false);
  });
});

describe("measure map store", () => {
  afterEach(() => resetMeasureMapStoreForTests());

  it("has no entry before anything is published", () => {
    expect(getMeasureMapEntry(1, "score/score.pdf")).toBeNull();
  });

  it("publishes and notifies subscribers synchronously", () => {
    const pages = freshPages();
    const received: unknown[] = [];
    const unsubscribe = subscribeMeasureMap(1, "score/score.pdf", (entry) => {
      received.push(entry);
    });
    publishMeasureMap(1, "score/score.pdf", "fp-1", pages);
    expect(received).toHaveLength(1);
    expect(getMeasureMapEntry(1, "score/score.pdf")).toEqual({
      fingerprint: "fp-1",
      pages,
    });
    unsubscribe();
    publishMeasureMap(1, "score/score.pdf", "fp-2", pages);
    expect(received).toHaveLength(1); // no further notification post-unsubscribe
  });

  it("keeps separate caches per piece+edition", () => {
    publishMeasureMap(1, "score/score.pdf", "fp-1", freshPages());
    expect(getMeasureMapEntry(2, "score/score.pdf")).toBeNull();
  });
});
