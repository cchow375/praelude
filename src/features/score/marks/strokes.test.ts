import { describe, expect, it } from "vitest";
import {
  finishStroke,
  isNewSample,
  PENCIL_WIDTH,
  simplify,
  strokePath,
  strokePayload,
  strokePixelWidth,
  toPagePoint,
  type StrokePoint,
} from "./strokes";

const BOX = { left: 40, top: 100, width: 600, height: 800 };

describe("normalized stroke geometry", () => {
  it("stores a pointer position as a fraction of the page box", () => {
    expect(toPagePoint(340, 500, BOX)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps a drag that leaves the paper instead of storing off-page geometry", () => {
    expect(toPagePoint(-500, 5000, BOX)).toEqual({ x: 0, y: 1 });
  });

  it("refuses to normalize against a page box with no area", () => {
    expect(toPagePoint(10, 10, { ...BOX, width: 0 })).toBeNull();
  });

  // THE anchoring property. The same stored stroke, laid out in a page box that
  // is 2.5× larger (a zoom, a resize, a fit-mode change — the overlay cannot
  // tell them apart, they are all just a bigger box), must land on exactly the
  // same spot of the engraving, i.e. every coordinate scales by 2.5 and nothing
  // shifts.
  it("renders at the same page position under any scale", () => {
    const points: StrokePoint[] = [
      { x: 0.25, y: 0.4 },
      { x: 0.3, y: 0.5 },
      { x: 0.75, y: 0.6 },
    ];
    const small = { width: 600, height: 800 };
    const large = { width: 1500, height: 2000 };

    const numbers = (path: string) => path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const scaled = numbers(strokePath(points, small)).map(
      (value) => value * 2.5,
    );
    const drawnLarge = numbers(strokePath(points, large));

    expect(drawnLarge.length).toBe(scaled.length);
    drawnLarge.forEach((value, index) => {
      expect(value).toBeCloseTo(scaled[index], 6);
    });
  });

  it("scales the line width with the page, off the short edge", () => {
    expect(
      strokePixelWidth(PENCIL_WIDTH, { width: 600, height: 800 }),
    ).toBeCloseTo(PENCIL_WIDTH * 600, 6);
    // Same page, zoomed 2×: the graphite thickens with it.
    expect(
      strokePixelWidth(PENCIL_WIDTH, { width: 1200, height: 1600 }),
    ).toBeCloseTo(PENCIL_WIDTH * 1200, 6);
    // Landscape: still the short edge, so a mark is not fatter on a wide page.
    expect(
      strokePixelWidth(PENCIL_WIDTH, { width: 900, height: 600 }),
    ).toBeCloseTo(PENCIL_WIDTH * 600, 6);
  });

  it("drops samples too close to carry shape, in zoom-independent units", () => {
    expect(isNewSample({ x: 0.5, y: 0.5 }, { x: 0.5001, y: 0.5 })).toBe(false);
    expect(isNewSample({ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.5 })).toBe(true);
  });
});

describe("stroke simplification", () => {
  it("collapses a straight run to its endpoints and keeps corners", () => {
    const straight = Array.from({ length: 40 }, (_, index) => ({
      x: index / 40,
      y: 0.5,
    }));
    expect(simplify(straight)).toEqual([
      { x: 0, y: 0.5 },
      { x: 39 / 40, y: 0.5 },
    ]);

    const corner = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.5 },
    ];
    expect(simplify(corner)).toEqual(corner);
  });

  it("keeps the shape of a circle a pianist drew around a notehead", () => {
    const circle = Array.from({ length: 200 }, (_, index) => {
      const angle = (index / 200) * Math.PI * 2;
      return {
        x: 0.5 + 0.04 * Math.cos(angle),
        y: 0.5 + 0.04 * Math.sin(angle),
      };
    });
    const simplified = simplify(circle);
    expect(simplified.length).toBeLessThan(circle.length);
    // Still recognisably a circle: every kept point sits on the same radius.
    for (const point of simplified) {
      expect(Math.hypot(point.x - 0.5, point.y - 0.5)).toBeCloseTo(0.04, 3);
    }
  });
});

describe("finishing a stroke", () => {
  it("turns a tap into a two-point dot the backend accepts", () => {
    const stroke = finishStroke([{ x: 0.2, y: 0.3 }], 4);
    expect(stroke).toEqual({
      id: null,
      page: 4,
      width: PENCIL_WIDTH,
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.2, y: 0.3 },
      ],
    });
  });

  it("is nothing at all when no point was captured", () => {
    expect(finishStroke([], 1)).toBeNull();
  });

  it("serializes only normalized x/y, which is what the store validates", () => {
    const stroke = finishStroke(
      [
        { x: 0.1, y: 0.2 },
        { x: 0.9, y: 0.8 },
      ],
      2,
    )!;
    expect(strokePayload(stroke)).toEqual({
      page: 2,
      width: PENCIL_WIDTH,
      points_json: '[{"x":0.1,"y":0.2},{"x":0.9,"y":0.8}]',
    });
  });
});
