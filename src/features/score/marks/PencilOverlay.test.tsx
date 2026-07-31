import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PencilOverlay } from "./PencilOverlay";
import type { Stroke } from "./strokes";

const PAGE_BOX = {
  x: 40,
  y: 100,
  left: 40,
  top: 100,
  right: 640,
  bottom: 900,
  width: 600,
  height: 800,
  toJSON: () => ({}),
};

function mountLayer(props: {
  active?: boolean;
  strokes?: Stroke[];
  onStroke?: (stroke: Stroke) => void;
  box?: typeof PAGE_BOX;
}) {
  const onStroke = props.onStroke ?? vi.fn();
  render(
    <PencilOverlay
      pageNumber={1}
      strokes={props.strokes ?? []}
      active={props.active ?? true}
      onStroke={onStroke}
    />,
  );
  const layer = screen.getByTestId("pencil-layer-1");
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue(
    props.box ?? PAGE_BOX,
  );
  return { layer, onStroke };
}

function drag(
  layer: HTMLElement,
  path: Array<[number, number]>,
  { finish = true }: { finish?: boolean } = {},
) {
  const [firstX, firstY] = path[0];
  fireEvent.pointerDown(layer, {
    pointerId: 7,
    button: 0,
    clientX: firstX,
    clientY: firstY,
  });
  for (const [x, y] of path.slice(1)) {
    fireEvent.pointerMove(layer, { pointerId: 7, clientX: x, clientY: y });
  }
  const [lastX, lastY] = path[path.length - 1];
  if (finish) {
    fireEvent.pointerUp(layer, {
      pointerId: 7,
      clientX: lastX,
      clientY: lastY,
    });
  } else {
    fireEvent.pointerCancel(layer, {
      pointerId: 7,
      clientX: lastX,
      clientY: lastY,
    });
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PencilOverlay", () => {
  it("reports a finished stroke in normalized page coordinates", () => {
    const { layer, onStroke } = mountLayer({});
    // Page box is 600×800 at (40,100): these are the page's 1/4, 1/2 and 3/4.
    drag(layer, [
      [190, 300],
      [340, 500],
      [490, 700],
    ]);

    expect(onStroke).toHaveBeenCalledTimes(1);
    const stroke = onStroke.mock.calls[0][0] as Stroke;
    expect(stroke.page).toBe(1);
    expect(stroke.id).toBeNull();
    expect(stroke.points[0]).toEqual({ x: 0.25, y: 0.25 });
    expect(stroke.points[stroke.points.length - 1]).toEqual({
      x: 0.75,
      y: 0.75,
    });
    // Every point is inside the page, whatever the pointer did.
    for (const point of stroke.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });

  it("records the same stroke from a zoomed page box", () => {
    // The same physical gesture on a page rendered 2× larger. Because the page
    // box grew with it, the stored geometry is identical — which is exactly why
    // a mark stays on its notehead across a zoom.
    const zoomed = {
      ...PAGE_BOX,
      width: 1200,
      height: 1600,
      right: 1240,
      bottom: 1700,
    };
    const { layer, onStroke } = mountLayer({ box: zoomed });
    drag(layer, [
      [340, 500],
      [640, 900],
      [940, 1300],
    ]);

    const stroke = onStroke.mock.calls[0][0] as Stroke;
    expect(stroke.points[0]).toEqual({ x: 0.25, y: 0.25 });
    expect(stroke.points[stroke.points.length - 1]).toEqual({
      x: 0.75,
      y: 0.75,
    });
  });

  it("captures the samples the browser coalesced into one move event", () => {
    const { layer, onStroke } = mountLayer({});
    fireEvent.pointerDown(layer, {
      pointerId: 7,
      button: 0,
      clientX: 40,
      clientY: 100,
    });
    const move = new window.PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 7,
      clientX: 640,
      clientY: 900,
    });
    // jsdom has no getCoalescedEvents; stand in for the three intermediate
    // samples a real browser would hand over with one frame's move.
    Object.defineProperty(move, "getCoalescedEvents", {
      value: () => [
        { clientX: 190, clientY: 300 },
        { clientX: 340, clientY: 500 },
        { clientX: 490, clientY: 700 },
      ],
    });
    fireEvent(layer, move);
    fireEvent.pointerUp(layer, { pointerId: 7, clientX: 490, clientY: 700 });

    const stroke = onStroke.mock.calls[0][0] as Stroke;
    // Start plus three coalesced samples — a straight diagonal, so simplify
    // keeps the endpoints; the far corner it never saw is NOT in the stroke.
    expect(stroke.points[0]).toEqual({ x: 0, y: 0 });
    expect(stroke.points[stroke.points.length - 1]).toEqual({
      x: 0.75,
      y: 0.75,
    });
  });

  it("does not draw when the pencil is not down", () => {
    const { layer, onStroke } = mountLayer({ active: false });
    drag(layer, [
      [190, 300],
      [490, 700],
    ]);
    expect(onStroke).not.toHaveBeenCalled();
    expect(layer.dataset.active).toBe("false");
  });

  it("throws away a cancelled stroke rather than committing it", () => {
    const { layer, onStroke } = mountLayer({});
    drag(
      layer,
      [
        [190, 300],
        [490, 700],
      ],
      { finish: false },
    );
    expect(onStroke).not.toHaveBeenCalled();
  });

  it("ignores a non-primary button so a right-click never leaves graphite", () => {
    const { layer, onStroke } = mountLayer({});
    fireEvent.pointerDown(layer, {
      pointerId: 7,
      button: 2,
      clientX: 190,
      clientY: 300,
    });
    fireEvent.pointerUp(layer, { pointerId: 7, clientX: 490, clientY: 700 });
    expect(onStroke).not.toHaveBeenCalled();
  });

  it("paints only the strokes belonging to its own page", () => {
    mountLayer({
      strokes: [
        {
          id: 1,
          page: 1,
          width: 0.002,
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.2, y: 0.2 },
          ],
        },
        {
          id: 2,
          page: 2,
          width: 0.002,
          points: [
            { x: 0.3, y: 0.3 },
            { x: 0.4, y: 0.4 },
          ],
        },
      ],
    });
    expect(screen.getAllByTestId("pencil-stroke")).toHaveLength(1);
  });
});
