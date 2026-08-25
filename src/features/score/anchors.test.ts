import { describe, expect, it } from "vitest";
import {
  anchorForEdition,
  normalizeDrag,
  rectCentreIsInsideAnchor,
  replaceEditionRects,
  validAnchorMap,
} from "./anchors";

describe("score Region anchors", () => {
  it("normalizes reverse drags and clamps them to the page", () => {
    expect(normalizeDrag(900, 700, -20, 100, 1000, 800, 3)).toEqual({
      page: 3,
      x: 0,
      y: 0.125,
      w: 0.9,
      h: 0.75,
    });
  });

  it("rejects clicks and non-finite page geometry", () => {
    expect(normalizeDrag(10, 10, 11, 11, 1000, 800, 1)).toBeNull();
    expect(normalizeDrag(0, 0, 20, 20, 0, 800, 1)).toBeNull();
    expect(normalizeDrag(0, 0, 20, 20, 100, 100, 0)).toBeNull();
  });

  it("stores anchors per edition and hides fingerprint mismatches", () => {
    const first = replaceEditionRects(null, "score/urtext.pdf", "fp-a", [
      { page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
    ]);
    const second = replaceEditionRects(first, "score/fingered.pdf", "fp-b", [
      { page: 4, x: 0.2, y: 0.3, w: 0.4, h: 0.2 },
    ]);

    expect(anchorForEdition(second, "score/urtext.pdf", "fp-a")?.rects).toHaveLength(1);
    expect(anchorForEdition(second, "score/fingered.pdf", "fp-b")?.rects[0].page).toBe(4);
    expect(anchorForEdition(second, "score/urtext.pdf", "wrong")).toBeNull();
    expect(validAnchorMap(second)).toBe(true);
  });

  it("stores highlight and note overlays while old rectangles remain boxes", () => {
    expect(normalizeDrag(10, 20, 60, 50, 100, 100, 2, "highlight")).toEqual({
      page: 2, x: 0.1, y: 0.2, w: 0.5, h: 0.3, kind: "highlight",
    });
    expect(validAnchorMap({
      v: 1,
      editions: {
        score: {
          fingerprint: "fp",
          rects: [
            { page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
            { page: 1, x: 0.4, y: 0.4, w: 0.2, h: 0.2, kind: "note" },
          ],
        },
      },
    })).toBe(true);
  });

  it("treats malformed legacy/foreign JSON as unmapped", () => {
    expect(validAnchorMap({ page: 1, x: 4 })).toBe(false);
    expect(anchorForEdition("garbage", "x", "y")).toBeNull();
  });
});

describe("rectCentreIsInsideAnchor (B1: 'drag inside' must mean inside)", () => {
  const parent = {
    fingerprint: "fp",
    rects: [{ page: 2, x: 0.2, y: 0.2, w: 0.4, h: 0.4 }],
  };

  it("treats a drag whose centre lands in the section's mark as inside", () => {
    expect(
      rectCentreIsInsideAnchor({ page: 2, x: 0.3, y: 0.3, w: 0.1, h: 0.1 }, parent),
    ).toBe(true);
  });

  it("is forgiving of a sloppy drag that overhangs the mark's edges", () => {
    // Centre (0.32, 0.32) is inside even though the rect spills past x = 0.2.
    expect(
      rectCentreIsInsideAnchor({ page: 2, x: 0.14, y: 0.14, w: 0.36, h: 0.36 }, parent),
    ).toBe(true);
  });

  it("does NOT claim a drag elsewhere on the page — the defect this fixes", () => {
    expect(
      rectCentreIsInsideAnchor({ page: 2, x: 0.7, y: 0.7, w: 0.1, h: 0.1 }, parent),
    ).toBe(false);
  });

  it("does not match the same coordinates on a different page", () => {
    expect(
      rectCentreIsInsideAnchor({ page: 3, x: 0.3, y: 0.3, w: 0.1, h: 0.1 }, parent),
    ).toBe(false);
  });

  it("treats a section with no mark on this edition as nothing to be inside of", () => {
    expect(
      rectCentreIsInsideAnchor({ page: 2, x: 0.3, y: 0.3, w: 0.1, h: 0.1 }, null),
    ).toBe(false);
    expect(
      rectCentreIsInsideAnchor(
        { page: 2, x: 0.3, y: 0.3, w: 0.1, h: 0.1 },
        { fingerprint: "fp", rects: [] },
      ),
    ).toBe(false);
  });
});
