import { describe, expect, it } from "vitest";
import {
  anchorForEdition,
  normalizeDrag,
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

  it("treats malformed legacy/foreign JSON as unmapped", () => {
    expect(validAnchorMap({ page: 1, x: 4 })).toBe(false);
    expect(anchorForEdition("garbage", "x", "y")).toBeNull();
  });
});
