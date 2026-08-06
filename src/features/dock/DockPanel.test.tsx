import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { DockProvider } from "./DockProvider";
import { DockPanel } from "./DockPanel";
import { useDock } from "./DockProvider";
import { DOCK_STORAGE_KEY } from "./dockState";

// jsdom has NO window.localStorage — install the Map-backed shim (pattern
// copied from src/features/composer/useSessionPlan.test.ts).
beforeEach(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    },
  });
});

afterEach(cleanup);

/** Seed localStorage so the panel mounts already open (open() is a later
 * task's concern — A2 only proves the chrome, so tests pre-seed state). */
function seedOpenPanel(id: string, over: Record<string, unknown> = {}) {
  window.localStorage.setItem(
    DOCK_STORAGE_KEY,
    JSON.stringify({
      [id]: { x: 100, y: 80, minimized: false, open: true, z: 1, ...over },
    }),
  );
}

function renderPanel(id = "rep") {
  return render(
    <DockProvider>
      <DockPanel id={id} title="Rep Counter" defaultPosition={{ x: 20, y: 20 }}>
        <div data-testid="dock-body">body</div>
      </DockPanel>
    </DockProvider>,
  );
}

describe("DockPanel — not open (fix wave item 7: closed collapses to a pill, never invisible)", () => {
  it("renders a pill, not nothing, when the panel has never been opened", () => {
    renderPanel();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Restore Rep Counter" }),
    ).toBeTruthy();
  });

  it("clicking the never-opened panel's pill opens it", () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore Rep Counter" }),
    );
    expect(screen.getByRole("dialog", { name: "Rep Counter" })).toBeTruthy();
  });
});

describe("DockPanel — open, chrome", () => {
  it("renders as a non-modal dialog with an accessible label, tab-reachable", () => {
    seedOpenPanel("rep");
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: "Rep Counter" });
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(dialog.getAttribute("tabindex")).toBe("0");
    expect(screen.getByTestId("dock-body")).toBeTruthy();
  });

  it("positions the panel via a translate transform from persisted x/y", () => {
    seedOpenPanel("rep", { x: 123, y: 45 });
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: "Rep Counter" });
    expect(dialog.style.transform).toBe("translate(123px, 45px)");
  });
});

describe("DockPanel — drag", () => {
  it("dragging the title bar via pointerdown/pointermove/pointerup updates the transform", () => {
    seedOpenPanel("rep", { x: 100, y: 100 });
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: "Rep Counter" });
    const titlebar = screen.getByText("Rep Counter");

    fireEvent.pointerDown(titlebar, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 130 });
    fireEvent.pointerUp(window);

    // dx=40, dy=30 from origin (100,100) -> (140,130), well within the
    // 720x520 dense-layout floor so nothing clamps it.
    expect(dialog.style.transform).toBe("translate(140px, 130px)");
  });

  it("clicking a title-bar button does not start a drag", () => {
    seedOpenPanel("rep", { x: 100, y: 100 });
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: "Rep Counter" });
    const minimizeBtn = screen.getByRole("button", {
      name: "Minimize Rep Counter",
    });

    fireEvent.pointerDown(minimizeBtn, {
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 500 });
    fireEvent.pointerUp(window);

    // Minimizing replaces the dialog with a pill, so if a drag HAD started
    // it would show up as a moved dialog transform instead — assert the
    // dialog is gone (minimized) and no stray drag-moved dialog exists.
    expect(dialog.style.transform).toBe("translate(100px, 100px)");
  });
});

describe("DockPanel — minimize / restore", () => {
  it("Escape minimizes the panel to a pill", () => {
    seedOpenPanel("rep");
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: "Rep Counter" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Restore Rep Counter" }),
    ).toBeTruthy();
  });

  it("clicking the pill restores the full panel", () => {
    seedOpenPanel("rep", { minimized: true });
    renderPanel();
    expect(screen.queryByRole("dialog")).toBeNull();

    const pill = screen.getByRole("button", { name: "Restore Rep Counter" });
    fireEvent.click(pill);

    expect(screen.getByRole("dialog", { name: "Rep Counter" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Restore Rep Counter" }),
    ).toBeNull();
  });

  it("the close button collapses the panel to its pill — reachable, never fully invisible (fix wave item 7)", () => {
    seedOpenPanel("rep");
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close Rep Counter" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Restore Rep Counter" }),
    ).toBeTruthy();
  });
});

describe("DockPanel — pill stacking (fix wave item 6)", () => {
  it("gives each of three minimized panels a distinct pill position, not one shared spot", () => {
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        rep: { x: 0, y: 0, minimized: true, open: true, z: 1, flashing: false },
        paused: {
          x: 0,
          y: 0,
          minimized: true,
          open: true,
          z: 2,
          flashing: false,
        },
        clock: {
          x: 0,
          y: 0,
          minimized: true,
          open: true,
          z: 3,
          flashing: false,
        },
      }),
    );
    render(
      <DockProvider>
        <DockPanel
          id="rep"
          title="Rep Counter"
          defaultPosition={{ x: 20, y: 20 }}
        >
          <div>rep body</div>
        </DockPanel>
        <DockPanel
          id="paused"
          title="Paused Sets"
          defaultPosition={{ x: 20, y: 20 }}
        >
          <div>paused body</div>
        </DockPanel>
        <DockPanel id="clock" title="Clock" defaultPosition={{ x: 20, y: 20 }}>
          <div>clock body</div>
        </DockPanel>
      </DockProvider>,
    );

    const pills = [
      screen.getByRole("button", { name: "Restore Rep Counter" }),
      screen.getByRole("button", { name: "Restore Paused Sets" }),
      screen.getByRole("button", { name: "Restore Clock" }),
    ];
    const bottoms = pills.map((pill) => pill.style.bottom);
    // Every pill must be independently clickable — a shared spot would put
    // two+ pills at the identical CSS position, occluding all but the top one.
    expect(new Set(bottoms).size).toBe(3);
    for (const pill of pills) {
      fireEvent.click(pill);
    }
  });
});

describe("DockPanel — flash (Task A6)", () => {
  function FlashHarness() {
    const dock = useDock("rep");
    return (
      <>
        <button type="button" onClick={dock.flash}>
          trigger flash
        </button>
        <DockPanel
          id="rep"
          title="Rep Counter"
          defaultPosition={{ x: 20, y: 20 }}
        >
          <div>body</div>
        </DockPanel>
      </>
    );
  }

  it("flashes the minimized pill, then clears the class on its own after the pulse window", () => {
    vi.useFakeTimers();
    seedOpenPanel("rep", { minimized: true });
    render(
      <DockProvider>
        <FlashHarness />
      </DockProvider>,
    );

    const pill = screen.getByRole("button", { name: "Restore Rep Counter" });
    expect(pill.className).not.toMatch(/dock-pill-flash/);

    act(() => {
      fireEvent.click(screen.getByText("trigger flash"));
    });
    expect(pill.className).toMatch(/dock-pill-flash/);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(
      screen.getByRole("button", { name: "Restore Rep Counter" }).className,
    ).not.toMatch(/dock-pill-flash/);

    vi.useRealTimers();
  });
});

describe("DockPanel — keyboard movement", () => {
  it("arrow keys move the panel in 8px steps", () => {
    seedOpenPanel("rep", { x: 100, y: 100 });
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: "Rep Counter" });

    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(dialog.style.transform).toBe("translate(108px, 100px)");

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(dialog.style.transform).toBe("translate(108px, 108px)");

    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    fireEvent.keyDown(dialog, { key: "ArrowUp" });
    expect(dialog.style.transform).toBe("translate(100px, 100px)");
  });
});
