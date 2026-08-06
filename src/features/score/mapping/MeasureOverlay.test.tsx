import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MeasureOverlay } from "./MeasureOverlay";
import type { MapConflict, MeasureMapPage } from "./measureMap";

afterEach(() => cleanup());

function samplePage(): MeasureMapPage {
  return {
    version: 1,
    systems: [
      {
        y_top: 0.1,
        y_bottom: 0.2,
        x_left: 0.05,
        x_right: 0.95,
        bars: [
          { x_right: 0.3, number: 1, source: "model" },
          { x_right: 0.6, number: 2, source: "model" },
          { x_right: 0.95, number: 3, source: "user" },
        ],
      },
    ],
  };
}

describe("MeasureOverlay", () => {
  it("renders nothing when visible is false", () => {
    render(
      <MeasureOverlay
        page={samplePage()}
        pageNumber={1}
        conflicts={[]}
        visible={false}
        stale={false}
      />,
    );
    expect(screen.queryByTestId("measure-map-overlay-1")).toBeNull();
  });

  it("renders every bar's number at its x_right/system baseline when visible", () => {
    render(
      <MeasureOverlay
        page={samplePage()}
        pageNumber={1}
        conflicts={[]}
        visible
        stale={false}
      />,
    );
    const numbers = screen.getAllByTestId("measure-map-number");
    expect(numbers.map((el) => el.textContent)).toEqual(["1", "2", "3"]);
    expect(numbers[0].style.left).toBe("30%");
    expect(numbers[0].style.top).toBe("20%");
  });

  it("bands the affected system amber when a conflict names it", () => {
    const conflicts: MapConflict[] = [
      { kind: "continuity_break", page: 1, system: 1, expected: 2, found: 1 },
    ];
    render(
      <MeasureOverlay
        page={samplePage()}
        pageNumber={1}
        conflicts={conflicts}
        visible
        stale={false}
      />,
    );
    expect(screen.getByTestId("measure-map-conflict-1-1")).toBeTruthy();
    for (const el of screen.getAllByTestId("measure-map-number")) {
      expect(el.className).toContain("is-conflict");
    }
  });

  it("does not band a system a conflict does not name", () => {
    const conflicts: MapConflict[] = [
      { kind: "continuity_break", page: 2, system: 1, expected: 2, found: 1 },
    ];
    render(
      <MeasureOverlay
        page={samplePage()}
        pageNumber={1}
        conflicts={conflicts}
        visible
        stale={false}
      />,
    );
    expect(screen.queryByTestId("measure-map-conflict-1-1")).toBeNull();
  });

  it("shows the stale notice regardless of the visible toggle, with a Re-scan affordance", () => {
    const onRescan = vi.fn();
    render(
      <MeasureOverlay
        page={null}
        pageNumber={1}
        conflicts={[]}
        visible={false}
        stale
        onRescan={onRescan}
      />,
    );
    expect(screen.getByTestId("measure-map-stale")).toBeTruthy();
    fireEvent.click(screen.getByText("Re-scan"));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it("calls onBarClick with the bar's location and current number", () => {
    const onBarClick = vi.fn();
    render(
      <MeasureOverlay
        page={samplePage()}
        pageNumber={1}
        conflicts={[]}
        visible
        stale={false}
        onBarClick={onBarClick}
      />,
    );
    fireEvent.click(screen.getAllByTestId("measure-map-number")[1]);
    expect(onBarClick).toHaveBeenCalledWith(0, 1, 2);
  });
});
