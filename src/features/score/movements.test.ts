import { describe, expect, it } from "vitest";
import type { PieceMovement, Region } from "../pieces/types";
import {
  movementForPage,
  movementForStoredStarts,
  movementRanges,
  regionAnchorPage,
  regionAnyAnchorPage,
} from "./movements";

const movements: PieceMovement[] = [
  { id: 2, piece_id: 1, title: "II", start_page: 7, display_order: 1 },
  { id: 1, piece_id: 1, title: "I", start_page: 1, display_order: 0 },
  { id: 3, piece_id: 1, title: "III", start_page: 12, display_order: 2 },
];

describe("movement page scoping", () => {
  it("derives inclusive boundaries and resolves both sides exactly", () => {
    const ranges = movementRanges(movements, 20);
    expect(ranges.map(({ start, end }) => [start, end])).toEqual([
      [1, 6],
      [7, 11],
      [12, 20],
    ]);
    expect(movementForPage(ranges, 6)?.movement.title).toBe("I");
    expect(movementForPage(ranges, 7)?.movement.title).toBe("II");
    expect(movementForPage(ranges, 20)?.movement.title).toBe("III");
  });

  it("has an honest zero-movement passthrough", () => {
    expect(movementRanges([], 12)).toEqual([]);
    expect(movementForPage([], 4)).toBeNull();
  });

  it("uses only the current edition fingerprint for Region membership", () => {
    const region = {
      id: 9,
      piece_id: 1,
      name: "Coda",
      notes: null,
      m_start: 40,
      m_end: 44,
      kind: "section",
      parent_region_id: null,
      order: 0,
      color: null,
      pdf_anchor: {
        v: 1,
        editions: {
          urtext: {
            fingerprint: "fp",
            rects: [{ page: 8, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
          },
        },
      },
    } satisfies Region;
    expect(regionAnchorPage(region, "urtext", "fp")).toBe(8);
    expect(regionAnchorPage(region, "urtext", "changed")).toBeNull();
    expect(regionAnyAnchorPage(region)).toBe(8);
    expect(movementForStoredStarts(movements, 8)?.title).toBe("II");
  });
});
