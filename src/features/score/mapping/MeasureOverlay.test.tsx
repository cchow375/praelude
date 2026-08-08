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

  it("calls onBarClick on a pointer down/up that never moves past the drag threshold, followed by the native click", () => {
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
    mockOverlayWidth(1000);
    const bar = screen.getAllByTestId("measure-map-number")[1];
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 500, clientY: 100 });
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 500, clientY: 100 });
    // The browser fires a native `click` right after mouse pointerup — jsdom
    // does not synthesize it automatically, so the test fires it explicitly.
    fireEvent.click(bar);
    expect(onBarClick).toHaveBeenCalledWith(0, 1, 2);
  });

  it("activates via keyboard alone (a real <button>'s Enter/Space -> click, no pointer events at all)", () => {
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
    const bar = screen.getAllByTestId("measure-map-number")[1];
    expect(bar.tagName).toBe("BUTTON");
    bar.focus();
    expect(document.activeElement).toBe(bar);
    // Enter/Space activation on a native <button> dispatches `click`
    // directly — no pointerdown/pointermove/pointerup ever fires.
    fireEvent.click(bar);
    expect(onBarClick).toHaveBeenCalledWith(0, 1, 2);
  });

  it("wires the barline-drag gesture: a real pointer drag calls onBarDrag with the new x_right, and the trailing synthetic click never renumbers", () => {
    const onBarClick = vi.fn();
    const onBarDrag = vi.fn();
    render(
      <MeasureOverlay
        page={samplePage()}
        pageNumber={1}
        conflicts={[]}
        visible
        stale={false}
        onBarClick={onBarClick}
        onBarDrag={onBarDrag}
      />,
    );
    mockOverlayWidth(1000);
    const bar = screen.getAllByTestId("measure-map-number")[1]; // x_right 0.6
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 500, clientY: 100 });
    // 100px right, over a 1000px-wide overlay = +0.1 normalized.
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 600, clientY: 100 });
    expect(onBarDrag).toHaveBeenCalledWith(0, 1, expect.closeTo(0.7, 5));
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 600, clientY: 100 });
    // A completed mouse drag still fires a native `click` on the same
    // element right after pointerup — that one must be swallowed, not
    // treated as a spurious renumber.
    fireEvent.click(bar);
    expect(onBarClick).not.toHaveBeenCalled();
  });

  it("a genuine click right after a suppressed drag-click still renumbers normally", () => {
    const onBarClick = vi.fn();
    const onBarDrag = vi.fn();
    render(
      <MeasureOverlay
        page={samplePage()}
        pageNumber={1}
        conflicts={[]}
        visible
        stale={false}
        onBarClick={onBarClick}
        onBarDrag={onBarDrag}
      />,
    );
    mockOverlayWidth(1000);
    const bar = screen.getAllByTestId("measure-map-number")[1];
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 500, clientY: 100 });
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 600, clientY: 100 });
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 600, clientY: 100 });
    fireEvent.click(bar); // suppressed (the drag's own synthetic click)
    expect(onBarClick).not.toHaveBeenCalled();

    // The NEXT, independent click (e.g. a keyboard activation right after)
    // is not permanently swallowed by the one-shot suppression flag.
    fireEvent.click(bar);
    expect(onBarClick).toHaveBeenCalledWith(0, 1, 2);
  });

  it("bands every system on the page for a page-level unapplyable conflict (system: 0)", () => {
    const conflicts: MapConflict[] = [
      { kind: "unapplyable", page: 1, system: 0, reason: "duplicate page" },
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
  });

  it("bands only the named system for a system-scoped unapplyable conflict", () => {
    const conflicts: MapConflict[] = [
      {
        kind: "unapplyable",
        page: 1,
        system: 1,
        reason: "bar x_right not increasing",
      },
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
  });

  it("bands the named system for an (informational) derived_bar_count conflict", () => {
    const conflicts: MapConflict[] = [
      { kind: "derived_bar_count", page: 1, system: 1, expected: 9, found: 3 },
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
  });

  it("does not band a derived_bar_count conflict on another page/system", () => {
    const conflicts: MapConflict[] = [
      { kind: "derived_bar_count", page: 1, system: 2, expected: 9, found: 3 },
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

  it("marks interpolated bars with their own class, distinct from model/user", () => {
    const page = samplePage();
    page.systems[0].bars[1].source = "interpolated";
    render(
      <MeasureOverlay
        page={page}
        pageNumber={1}
        conflicts={[]}
        visible
        stale={false}
      />,
    );
    const marks = screen.getAllByTestId("measure-map-number");
    expect(marks[0].className).toContain("is-model");
    expect(marks[1].className).toContain("is-interpolated");
    expect(marks[2].className).toContain("is-user");
  });

  it("read-only bars ignore clicks/drags and carry the re-scan-to-edit hint", () => {
    const onBarClick = vi.fn();
    const onBarDrag = vi.fn();
    render(
      <MeasureOverlay
        page={samplePage()}
        pageNumber={1}
        conflicts={[]}
        visible
        stale={false}
        onBarClick={onBarClick}
        onBarDrag={onBarDrag}
        readOnly
      />,
    );
    const bar = screen.getAllByTestId("measure-map-number")[0];
    expect(bar.tagName).toBe("SPAN");
    expect(bar.getAttribute("title")).toBe("Map applied — re-scan to edit");
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 500, clientY: 100 });
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 500, clientY: 100 });
    expect(onBarClick).not.toHaveBeenCalled();
    expect(onBarDrag).not.toHaveBeenCalled();
  });
});

/** Stub the overlay container's measured width — jsdom's real
 * `getBoundingClientRect` always returns 0, which the drag/click gesture
 * treats as "cannot measure, do nothing" (see `MeasureOverlay.beginDrag`). */
function mockOverlayWidth(width: number) {
  const container = document.querySelector(".measure-map-overlay");
  if (!container) throw new Error("measure-map-overlay container not found");
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: 100,
    width,
    height: 100,
    toJSON: () => ({}),
  });
}
