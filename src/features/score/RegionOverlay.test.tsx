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
        items={[
          {
            regionId: 7,
            label: "Development",
            color: "#8b7cf6",
            selected: false,
            active: true,
            isChild: false,
            rects: [{ page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
          },
        ]}
        onSelect={onSelect}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Development, box on page 2",
    });
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
        mapping={{
          regionId: 9,
          label: "Coda",
          color: null,
          draftRects: [],
          tool: "box",
          onAddRect,
          onUpdateRect: vi.fn(),
        }}
        onSelect={vi.fn()}
      />,
    );
    const overlay = screen.getByTestId("page-overlay-3");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(overlay, {
      pointerId: 1,
      clientX: 800,
      clientY: 600,
    });
    fireEvent.pointerMove(overlay, {
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(onAddRect).toHaveBeenCalledWith({
      page: 3,
      x: 0.2,
      y: 0.25,
      w: 0.6,
      h: 0.5,
    });
  });

  it("renders a color-coded note on the score and creates highlight geometry", () => {
    const onAddRect = vi.fn();
    render(
      <RegionOverlay
        pageNumber={1}
        items={[
          {
            regionId: 2,
            label: "Release the wrist",
            color: "#c93d45",
            selected: true,
            active: false,
            isChild: false,
            rects: [{ page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.08, kind: "note" }],
          },
        ]}
        mapping={{
          regionId: 2,
          label: "Release the wrist",
          color: "#c93d45",
          draftRects: [
            { page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.08, kind: "note" },
          ],
          tool: "highlight",
          onAddRect,
          onUpdateRect: vi.fn(),
        }}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Release the wrist")).toBeTruthy();
    const overlay = screen.getByTestId("page-overlay-1");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 60, clientY: 30 });
    expect(onAddRect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "highlight" }),
    );
  });

  it("marks the selected region so it can afford a drag-inside cursor", () => {
    render(
      <RegionOverlay
        pageNumber={2}
        items={[
          {
            regionId: 7,
            label: "Tricky bit",
            color: "#8b7cf6",
            selected: true,
            active: false,
            isChild: false,
            rects: [{ page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
          },
        ]}
        onSelect={vi.fn()}
      />,
    );
    const box = screen.getByRole("button", { name: /tricky bit/i });
    expect(box.className).toContain("is-selected");
  });

  it("lets a drag that starts INSIDE the selected box reach the create handler instead of only selecting it", () => {
    const onSelect = vi.fn();
    const onResolve = vi.fn();
    render(
      <RegionOverlay
        pageNumber={1}
        items={[
          {
            regionId: 7,
            label: "Tricky bit",
            color: "#8b7cf6",
            selected: true,
            active: false,
            isChild: false,
            rects: [{ page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
          },
        ]}
        createDrag={{ onResolve }}
        onSelect={onSelect}
      />,
    );
    const overlay = screen.getByTestId("page-overlay-1");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });
    const box = screen.getByRole("button", { name: /tricky bit/i });
    // Pointer events bubble in jsdom's fireEvent, so a pointerDown fired on
    // the box itself exercises the same propagation path a real drag inside
    // the selected box would.
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(overlay, {
      pointerId: 1,
      clientX: 700,
      clientY: 700,
    });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 700, clientY: 700 });
    expect(onResolve).toHaveBeenCalled();
  });

  it("still swallows a pointerDown on an UNSELECTED box so it only selects (no accidental drag-create)", () => {
    const onSelect = vi.fn();
    const onResolve = vi.fn();
    render(
      <RegionOverlay
        pageNumber={1}
        items={[
          {
            regionId: 7,
            label: "Tricky bit",
            color: "#8b7cf6",
            selected: false,
            active: false,
            isChild: false,
            rects: [{ page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
          },
        ]}
        createDrag={{ onResolve }}
        onSelect={onSelect}
      />,
    );
    const overlay = screen.getByTestId("page-overlay-1");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });
    const box = screen.getByRole("button", { name: /tricky bit/i });
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(overlay, {
      pointerId: 1,
      clientX: 700,
      clientY: 700,
    });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 700, clientY: 700 });
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("moves and resizes an existing draft annotation directly on the score", () => {
    const onUpdateRect = vi.fn();
    render(
      <RegionOverlay
        pageNumber={1}
        items={[]}
        mapping={{
          regionId: 2,
          label: "Release",
          color: "#c93d45",
          draftRects: [{ page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.1 }],
          tool: "box",
          onAddRect: vi.fn(),
          onUpdateRect,
        }}
        onSelect={vi.fn()}
      />,
    );
    const overlay = screen.getByTestId("page-overlay-1");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    const draft = screen.getByRole("button", { name: /Release, editable box/ });
    fireEvent.pointerDown(draft, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(draft, { pointerId: 1, clientX: 20, clientY: 20 });
    expect(onUpdateRect).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ x: 0.2, y: 0.2 }),
    );

    const handle = draft.querySelector<HTMLElement>(".score-region-resize")!;
    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 2,
      clientX: 40,
      clientY: 20,
    });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 50, clientY: 30 });
    expect(onUpdateRect).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ w: 0.4, h: 0.2 }),
    );
  });

  it("Task C3/C4: a spot is drawn dashed-and-faint, and a selected one offers Practice this as a sibling button", () => {
    const onPractice = vi.fn();
    render(
      <RegionOverlay
        pageNumber={1}
        items={[
          {
            regionId: 55,
            label: "Spot 1",
            color: "#4ab5f2",
            selected: true,
            active: false,
            isChild: true,
            onPractice,
            rects: [{ page: 1, x: 0.1, y: 0.2, w: 0.2, h: 0.1 }],
          },
        ]}
        onSelect={vi.fn()}
      />,
    );
    const box = screen.getByRole("button", { name: "Spot 1, box on page 1" });
    expect(box.className).toContain("is-child");

    const chip = screen.getByRole("button", { name: "Practice this" });
    // A <button> inside a <button> is invalid HTML and browsers un-nest it,
    // which would move the chip away from the box it belongs to.
    expect(chip.closest(".score-region-anchor")).toBeNull();
    // Pinned to the top-right corner of the spot's first rect on this page.
    expect(Number.parseFloat(chip.style.left)).toBeCloseTo(30);
    expect(Number.parseFloat(chip.style.top)).toBeCloseTo(20);

    fireEvent.click(chip);
    expect(onPractice).toHaveBeenCalledTimes(1);
  });

  it("Task C4: an unselected spot, and a selected top-level section, get no Practice chip", () => {
    render(
      <RegionOverlay
        pageNumber={1}
        items={[
          {
            regionId: 55,
            label: "Spot 1",
            color: null,
            selected: false,
            active: false,
            isChild: true,
            onPractice: vi.fn(),
            rects: [{ page: 1, x: 0.1, y: 0.2, w: 0.2, h: 0.1 }],
          },
          {
            regionId: 4,
            label: "Rolled Chords",
            color: null,
            selected: true,
            active: false,
            isChild: false,
            rects: [{ page: 1, x: 0, y: 0, w: 1, h: 1 }],
          },
        ]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Practice this" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Rolled Chords, box on page 1" })
        .className,
    ).not.toContain("is-child");
  });
});
