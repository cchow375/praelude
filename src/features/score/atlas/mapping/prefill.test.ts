import { describe, expect, it } from "vitest";
import type { LineAnchor } from "./anchors";
import {
  measureFromAnchors,
  measureFromTextLayer,
  predictNextMeasure,
  suggestMeasure,
  type PrefillTextItem,
} from "./prefill";

const anchors: LineAnchor[] = [
  { page: 1, yPct: 0.2, measure: 1 },
  { page: 1, yPct: 0.34, measure: 5 },
  { page: 1, yPct: 0.48, measure: 9 },
  { page: 2, yPct: 0.2, measure: 40 },
];

describe("measureFromAnchors", () => {
  it("returns the exact measure when the click lands on a known system", () => {
    expect(measureFromAnchors(anchors, 1, 0.34)).toBe(5);
  });

  it("snaps to the nearest anchor within tolerance", () => {
    expect(measureFromAnchors(anchors, 1, 0.343)).toBe(5);
  });

  it("returns null when no anchor is close enough", () => {
    expect(measureFromAnchors(anchors, 1, 0.27)).toBeNull();
  });

  it("respects the page boundary", () => {
    expect(measureFromAnchors(anchors, 2, 0.34)).toBeNull();
    expect(measureFromAnchors(anchors, 2, 0.2)).toBe(40);
  });

  it("returns null with no anchors", () => {
    expect(measureFromAnchors([], 1, 0.2)).toBeNull();
  });
});

describe("measureFromTextLayer", () => {
  const items: PrefillTextItem[] = [
    { text: "5", xPct: 0.06, yPct: 0.33 },
    { text: "Allegro", xPct: 0.4, yPct: 0.12 },
    { text: "9", xPct: 0.05, yPct: 0.47 },
    { text: "page 1 of 25", xPct: 0.45, yPct: 0.02 },
  ];

  it("finds a standalone integer in the left margin near the system start", () => {
    expect(measureFromTextLayer(items, 0.34)).toBe(5);
  });

  it("ignores integers embedded in longer strings", () => {
    // "page 1 of 25" is not a standalone integer, so its 1/25 never match.
    expect(measureFromTextLayer(items, 0.03)).toBeNull();
  });

  it("ignores numbers outside the left margin band", () => {
    const right: PrefillTextItem[] = [{ text: "5", xPct: 0.8, yPct: 0.34 }];
    expect(measureFromTextLayer(right, 0.34)).toBeNull();
  });

  it("rejects a non-monotonic number versus the previous anchor", () => {
    expect(measureFromTextLayer(items, 0.34, { prev: 9 })).toBeNull();
  });

  it("rejects a number beyond the known XML total", () => {
    expect(measureFromTextLayer(items, 0.34, { xmlMaxMeasure: 4 })).toBeNull();
    expect(measureFromTextLayer(items, 0.34, { xmlMaxMeasure: 8 })).toBe(5);
  });

  it("returns null when there is no text layer", () => {
    expect(measureFromTextLayer([], 0.34)).toBeNull();
  });
});

describe("predictNextMeasure", () => {
  it("needs at least two run anchors", () => {
    expect(predictNextMeasure([anchors[0]])).toBeNull();
    expect(predictNextMeasure([])).toBeNull();
  });

  it("predicts last measure plus the median bars-per-system", () => {
    // diffs 4 and 4 → median 4 → next = 9 + 4 = 13.
    expect(predictNextMeasure([anchors[0], anchors[1], anchors[2]])).toBe(13);
  });

  it("uses the median, not the mean, so an outlier system does not skew it", () => {
    const run: LineAnchor[] = [
      { page: 1, yPct: 0.2, measure: 1 },
      { page: 1, yPct: 0.3, measure: 5 }, // +4
      { page: 1, yPct: 0.4, measure: 9 }, // +4
      { page: 1, yPct: 0.5, measure: 30 }, // +21 outlier
    ];
    // diffs 4,4,21 → median 4 → next = 30 + 4 = 34.
    expect(predictNextMeasure(run)).toBe(34);
  });

  it("clamps the prediction to the XML total when known", () => {
    expect(
      predictNextMeasure([anchors[0], anchors[1], anchors[2]], {
        xmlMaxMeasure: 10,
      }),
    ).toBe(10);
  });
});

describe("suggestMeasure priority", () => {
  const base = {
    anchors,
    runAnchors: [] as LineAnchor[],
    page: 1,
    xmlMaxMeasure: null,
  };

  it("prefers existing calibration anchors", () => {
    expect(
      suggestMeasure({
        ...base,
        yPct: 0.34,
        textItems: [{ text: "99", xPct: 0.05, yPct: 0.34 }],
      }),
    ).toEqual({ measure: 5, source: "anchors" });
  });

  it("falls back to the PDF text layer when anchors do not match", () => {
    expect(
      suggestMeasure({
        ...base,
        yPct: 0.6,
        textItems: [{ text: "12", xPct: 0.05, yPct: 0.6 }],
      }),
    ).toEqual({ measure: 12, source: "score" });
  });

  it("falls back to prediction when there is no text layer", () => {
    expect(
      suggestMeasure({
        anchors,
        runAnchors: [anchors[0], anchors[1], anchors[2]],
        page: 1,
        yPct: 0.7,
        textItems: null,
        xmlMaxMeasure: null,
      }),
    ).toEqual({ measure: 13, source: "estimated" });
  });

  it("returns null when nothing can suggest a measure", () => {
    expect(
      suggestMeasure({
        anchors: [],
        runAnchors: [],
        page: 1,
        yPct: 0.7,
        textItems: null,
        xmlMaxMeasure: null,
      }),
    ).toBeNull();
  });
});
