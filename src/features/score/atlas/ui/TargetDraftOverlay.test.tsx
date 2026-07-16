import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistentPdfSelectionAnchor } from "../model";
import { TargetDraftOverlay, type PageGeometrySnapshot } from "./TargetDraftOverlay";

afterEach(cleanup);

const edition = { edition_id: "score.pdf", edition_fingerprint: "pdf-fp" };

function geometry(
  width: number,
  height: number,
  page = 3,
): PageGeometrySnapshot {
  return { page, left: 0, top: 0, width, height };
}

function renderOverlay(input: {
  geometryForEvent: () => PageGeometrySnapshot;
  onSelection?: (anchor: PersistentPdfSelectionAnchor) => void;
  onSelectionError?: (code: string, message: string) => void;
}) {
  render(
    <>
      <p id="draw-help">Drag over the score, or use numeric geometry.</p>
      <TargetDraftOverlay
        pageNumber={3}
        edition={edition}
        selectedAnchor={null}
        instructionsId="draw-help"
        geometryForEvent={input.geometryForEvent}
        onSelection={input.onSelection ?? vi.fn()}
        onSelectionError={input.onSelectionError ?? vi.fn()}
      />
    </>,
  );
  return screen.getByRole("region", { name: "Draw a practice target on PDF page 3" });
}

describe("TargetDraftOverlay", () => {
  it("emits identical normalized geometry at two viewer zoom levels", () => {
    const normalSelection = vi.fn();
    const normal = renderOverlay({
      geometryForEvent: () => geometry(1000, 800),
      onSelection: normalSelection,
    });
    fireEvent.pointerDown(normal, { button: 0, pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerUp(normal, { pointerId: 1, clientX: 400, clientY: 480 });
    const normalAnchor = normalSelection.mock.calls[0][0] as PersistentPdfSelectionAnchor;

    cleanup();
    const zoomedSelection = vi.fn();
    const zoomed = renderOverlay({
      geometryForEvent: () => geometry(2500, 2000),
      onSelection: zoomedSelection,
    });
    fireEvent.pointerDown(zoomed, { button: 0, pointerId: 2, clientX: 250, clientY: 500 });
    fireEvent.pointerUp(zoomed, { pointerId: 2, clientX: 1000, clientY: 1200 });
    const zoomedAnchor = zoomedSelection.mock.calls[0][0] as PersistentPdfSelectionAnchor;

    expect(zoomedAnchor).toEqual(normalAnchor);
    expect(normalAnchor.rects[0]).toEqual({
      page: 3,
      x: 0.1,
      y: 0.25,
      w: 0.3,
      h: 0.35,
    });
  });

  it("rejects click-sized selections with a concise reason", () => {
    const onSelection = vi.fn();
    const onSelectionError = vi.fn();
    const overlay = renderOverlay({
      geometryForEvent: () => geometry(1000, 800),
      onSelection,
      onSelectionError,
    });
    fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 11, clientY: 11 });
    expect(onSelection).not.toHaveBeenCalled();
    expect(onSelectionError).toHaveBeenCalledWith(
      "selection_too_small",
      "Drag a visible score area rather than a click-sized point.",
    );
  });

  it("rejects a page change during a captured drag", () => {
    const onSelection = vi.fn();
    const onSelectionError = vi.fn();
    let call = 0;
    const overlay = renderOverlay({
      geometryForEvent: () => geometry(1000, 800, call++ === 0 ? 3 : 4),
      onSelection,
      onSelectionError,
    });
    fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(onSelection).not.toHaveBeenCalled();
    expect(onSelectionError).toHaveBeenCalledWith(
      "cross_page_drag",
      expect.stringContaining("cannot cross PDF pages"),
    );
  });

  it("exposes focus and the linked keyboard-alternative instructions", () => {
    const overlay = renderOverlay({ geometryForEvent: () => geometry(1000, 800) });
    expect(overlay.tabIndex).toBe(0);
    expect(overlay.getAttribute("aria-describedby")).toBe("draw-help");
  });
});
