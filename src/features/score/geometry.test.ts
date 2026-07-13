import { describe, expect, it } from "vitest";
import {
  cappedDevicePixelRatio,
  clampZoom,
  fitPageScale,
  displaySize,
  fitWidthScale,
  renderWindow,
} from "./geometry";

describe("score geometry", () => {
  it("clamps zoom and rejects non-finite values", () => {
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(9)).toBe(3);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("fits a whole page using the tighter viewport axis", () => {
    expect(fitPageScale(1000, 700, 600, 800, 40, 40)).toBeCloseTo(0.825);
    expect(fitPageScale(500, 1000, 600, 800, 40, 40)).toBeCloseTo(0.7667, 3);
  });

  it("fits a page inside the available width with padding", () => {
    expect(fitWidthScale(644, 612, 32)).toBe(1);
    expect(fitWidthScale(338, 612, 32)).toBe(0.5);
  });

  it("caps high-density rendering at two", () => {
    expect(cappedDevicePixelRatio(3)).toBe(2);
    expect(cappedDevicePixelRatio(1.5)).toBe(1.5);
    expect(cappedDevicePixelRatio(0)).toBe(1);
  });

  it("adds one neighboring page without escaping the document", () => {
    expect([...renderWindow([1], 5)]).toEqual([1, 2]);
    expect([...renderWindow([3], 5)]).toEqual([2, 3, 4]);
    expect([...renderWindow([5], 5)]).toEqual([4, 5]);
  });

  it("computes stable integer placeholder geometry", () => {
    expect(displaySize({ width: 612, height: 792 }, 0.5)).toEqual({
      width: 306,
      height: 396,
    });
  });
});
