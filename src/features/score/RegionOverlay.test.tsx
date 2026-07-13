import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegionOverlay } from "./RegionOverlay";

afterEach(cleanup);

describe("RegionOverlay", () => {
  it("renders mapped regions and selects them", () => {
    const onSelect = vi.fn();
    render(
      <RegionOverlay
        pageNumber={2}
        items={[{
          regionId: 7,
          label: "Development",
          color: "#8b7cf6",
          selected: false,
          active: true,
          rects: [{ page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
        }]}
        onSelect={onSelect}
      />,
    );
    const button = screen.getByRole("button", { name: "Development, measures mapped on page 2" });
    expect(button.className).toContain("is-active");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it("turns a mapping drag into a normalized page rectangle", () => {
    const onAddRect = vi.fn();
    render(
      <RegionOverlay
        pageNumber={3}
        items={[]}
        mapping={{ regionId: 9, label: "Coda", color: null, draftRects: [], onAddRect }}
        onSelect={vi.fn()}
      />,
    );
    const overlay = screen.getByTestId("page-overlay-3");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800,
      width: 1000, height: 800, toJSON: () => ({}),
    });
    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 800, clientY: 600 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(onAddRect).toHaveBeenCalledWith({ page: 3, x: 0.2, y: 0.25, w: 0.6, h: 0.5 });
  });
});
