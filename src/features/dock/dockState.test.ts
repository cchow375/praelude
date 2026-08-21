import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCK_PANEL_MIN_HEIGHT_PX,
  DOCK_STORAGE_KEY,
  MIN_PANEL_WIDTH,
  MIN_VISIBLE_ON_OPEN_PX,
  PANEL_WIDTH_EDGE_MARGIN,
  clampPanelWidth,
  clampPosition,
  defaultPanelState,
  dockPanelMaxHeight,
  loadDockState,
  raiseZ,
  rectsIntersect,
  resetDockLayout,
  resolveCollision,
  saveDockState,
  withPanel,
  type DockState,
} from "./dockState";

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

describe("clampPosition", () => {
  it("clamps a panel dragged far off the left edge so >=48px of it stays visible at 720x520", () => {
    const size = { width: 260, height: 200 };
    const viewport = { width: 720, height: 520 };
    const { x } = clampPosition(-500, 100, size, viewport);
    // minX = 48 - 260 = -212 -> at x=-212 exactly 48px of the 260px-wide
    // panel remains on screen (260 - 212 = 48).
    expect(x).toBe(-212);
    expect(size.width + x).toBeGreaterThanOrEqual(48);
  });

  it("clamps a panel dragged far off the right/bottom edge", () => {
    const size = { width: 260, height: 200 };
    const viewport = { width: 720, height: 520 };
    const { x, y } = clampPosition(5000, 5000, size, viewport);
    // maxX = 720 - 48 = 672; maxY = 520 - 48 = 472.
    expect(x).toBe(672);
    expect(y).toBe(472);
  });

  it("leaves an in-bounds position untouched", () => {
    const size = { width: 260, height: 200 };
    const viewport = { width: 720, height: 520 };
    expect(clampPosition(100, 80, size, viewport)).toEqual({ x: 100, y: 80 });
  });
});

describe("clampPosition with a custom minVisible (residuals fix wave, defect 1)", () => {
  it("keeps a much larger portion of the panel on screen than the drag floor", () => {
    const size = { width: 260, height: 200 };
    const viewport = { width: 720, height: 520 };
    // The clock's real off-screen-open bug: y near the bottom of a 520-tall
    // viewport, well past what the OLD 48px drag floor would have caught.
    const { y } = clampPosition(0, 464, size, viewport, MIN_VISIBLE_ON_OPEN_PX);
    expect(y).toBe(520 - MIN_VISIBLE_ON_OPEN_PX);
    expect(y).toBeLessThan(464);
  });

  it("defaults to MIN_VISIBLE_PX (48) when no minVisible is passed, unchanged from before", () => {
    const size = { width: 260, height: 200 };
    const viewport = { width: 720, height: 520 };
    expect(clampPosition(5000, 5000, size, viewport)).toEqual({
      x: 672,
      y: 472,
    });
  });
});

describe("dockPanelMaxHeight (residuals fix wave, defect 2)", () => {
  it("caps a panel's height well under the 720x520 dense-layout floor, leaving room to stack another panel below it", () => {
    const cap = dockPanelMaxHeight(520);
    expect(cap).toBeLessThan(520);
    expect(cap).toBeGreaterThan(0);
  });

  it("never drops below a usable floor even on a very short viewport", () => {
    expect(dockPanelMaxHeight(100)).toBeGreaterThanOrEqual(120);
  });

  describe("round 2 (defect 1 REFUTED): the y-aware ceiling", () => {
    it("shrinks a panel's max-height so its bottom edge never crosses the viewport, at the lowest y the become-visible clamp/resolveCollision ever allow", () => {
      // The `y`-side of this guarantee: clampPosition/resolveCollision (both
      // called with MIN_VISIBLE_ON_OPEN_PX) never let `y` exceed
      // `viewportHeight - MIN_VISIBLE_ON_OPEN_PX` in the first place — this
      // proves the height side holds at exactly that worst-case y.
      const viewportHeight = 520;
      const y = viewportHeight - MIN_VISIBLE_ON_OPEN_PX; // the lowest legal y
      const cap = dockPanelMaxHeight(viewportHeight, y);
      expect(y + cap).toBeLessThanOrEqual(viewportHeight);
    });

    it("CANNOT guarantee containment on its own if the caller ignores the y floor (documents why the two constants must move together)", () => {
      // y=472 is BELOW the MIN_VISIBLE_ON_OPEN_PX floor (360 at this
      // viewport) — dockPanelMaxHeight still refuses to squeeze the panel
      // below DOCK_PANEL_MIN_HEIGHT_PX, so containment can be violated. This
      // is exactly why clampPosition/resolveCollision are ALWAYS called
      // with MIN_VISIBLE_ON_OPEN_PX in DockPanel.tsx — never a smaller
      // floor — for the become-visible path.
      const viewportHeight = 520;
      const y = 472;
      const cap = dockPanelMaxHeight(viewportHeight, y);
      expect(y + cap).toBeGreaterThan(viewportHeight);
    });

    it("still caps a panel positioned near the top to the fixed per-viewport budget — one panel opening alone must not hog the whole screen", () => {
      // At y=16 there is plenty of room below (504px) — the fixed budget
      // (dense-layout floor: 520-220=300) must be what actually limits it,
      // not the (much larger) dynamic room, so a second panel can still
      // find somewhere to stack.
      const cap = dockPanelMaxHeight(520, 16);
      expect(cap).toBe(300);
    });

    it("never squeezes a panel below the usable minimum, even with almost no room left below y", () => {
      const cap = dockPanelMaxHeight(520, 510);
      expect(cap).toBeGreaterThanOrEqual(DOCK_PANEL_MIN_HEIGHT_PX);
    });

    it("defaults y to 0 (unchanged single-arg call sites keep behaving exactly as round 1)", () => {
      expect(dockPanelMaxHeight(520)).toBe(dockPanelMaxHeight(520, 0));
    });
  });
});

describe("rectsIntersect", () => {
  it("detects overlap between two rects", () => {
    expect(
      rectsIntersect(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 50, y: 50, width: 100, height: 100 },
      ),
    ).toBe(true);
  });

  it("returns false for rects that only touch at an edge", () => {
    expect(
      rectsIntersect(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 100, y: 0, width: 100, height: 100 },
      ),
    ).toBe(false);
  });

  it("returns false for rects with no overlap at all", () => {
    expect(
      rectsIntersect(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 500, y: 500, width: 10, height: 10 },
      ),
    ).toBe(false);
  });
});

describe("resolveCollision (residuals fix wave, defect 2)", () => {
  it("pushes a candidate below a colliding rect", () => {
    const rep = { x: 160, y: 16, width: 440, height: 300 };
    const trayCandidate = { x: 160, y: 340, width: 260, height: 40 };
    const resolved = resolveCollision(trayCandidate, [rep], {
      width: 720,
      height: 520,
    });
    expect(rectsIntersect({ ...trayCandidate, ...resolved }, rep)).toBe(false);
    expect(resolved.y).toBeGreaterThanOrEqual(rep.y + rep.height);
  });

  it("leaves a non-colliding candidate untouched", () => {
    const rep = { x: 160, y: 16, width: 440, height: 300 };
    const clockCandidate = { x: 160, y: 400, width: 260, height: 40 };
    const resolved = resolveCollision(clockCandidate, [rep], {
      width: 720,
      height: 520,
    });
    expect(resolved).toEqual({ x: clockCandidate.x, y: clockCandidate.y });
  });
});

describe("clampPanelWidth", () => {
  it("leaves a requested width alone when the viewport has room for it", () => {
    // 720 - 2*24 = 672px available; 440 (the rep panel's requested width)
    // fits with margin to spare at the 720x520 dense-layout floor.
    expect(clampPanelWidth(440, 720)).toBe(440);
  });

  it("clamps to the viewport minus the edge margin on a narrower window", () => {
    expect(clampPanelWidth(440, 300)).toBe(300 - PANEL_WIDTH_EDGE_MARGIN * 2);
  });

  it("never clamps below MIN_PANEL_WIDTH even on a very narrow viewport", () => {
    expect(clampPanelWidth(440, 100)).toBe(MIN_PANEL_WIDTH);
  });

  it("never grows a small requested width beyond what was asked for", () => {
    expect(clampPanelWidth(200, 1200)).toBe(200);
  });
});

describe("z-order", () => {
  it("raises the focused panel above the current max z", () => {
    const state: DockState = {
      rep: defaultPanelState({ z: 3 }),
      paused: defaultPanelState({ z: 5 }),
    };
    const next = raiseZ(state, "rep");
    expect(next.rep.z).toBe(6);
    expect(next.paused.z).toBe(5); // untouched
  });

  it("raising a not-yet-registered panel still lands above the current max", () => {
    const state: DockState = { rep: defaultPanelState({ z: 2 }) };
    const next = raiseZ(state, "clock", { x: 10, y: 10 });
    expect(next.clock).toMatchObject({ x: 10, y: 10, z: 3 });
  });
});

describe("minimize round-trip", () => {
  it("minimizing then restoring returns the panel to its prior open position", () => {
    let state: DockState = {
      rep: defaultPanelState({ x: 40, y: 60, open: true, z: 1 }),
    };
    state = withPanel(state, "rep", { minimized: true });
    expect(state.rep.minimized).toBe(true);
    expect(state.rep.open).toBe(true); // still logically open, just collapsed
    expect(state.rep.x).toBe(40);
    expect(state.rep.y).toBe(60);

    state = withPanel(state, "rep", { minimized: false });
    expect(state.rep).toMatchObject({
      x: 40,
      y: 60,
      open: true,
      minimized: false,
    });
  });
});

describe("persistence round-trip", () => {
  it("saveDockState then loadDockState returns an equal state through the localStorage shim", () => {
    const state: DockState = {
      rep: defaultPanelState({ x: 12, y: 34, open: true, z: 2 }),
      clock: defaultPanelState({ x: 99, y: 1, minimized: true, z: 1 }),
    };
    saveDockState(state);
    expect(loadDockState()).toEqual(state);
  });

  it("writes under the ck.dock.v1 key", () => {
    saveDockState({ rep: defaultPanelState() });
    expect(window.localStorage.getItem(DOCK_STORAGE_KEY)).not.toBeNull();
  });
});

describe("defaultPanelState", () => {
  it("starts with flashing false", () => {
    expect(defaultPanelState().flashing).toBe(false);
  });
});

describe("resetDockLayout (real-use fix wave item 4)", () => {
  it("removes the persisted blob under DOCK_STORAGE_KEY", () => {
    saveDockState({ rep: defaultPanelState({ x: 999, y: 999 }) });
    expect(window.localStorage.getItem(DOCK_STORAGE_KEY)).not.toBeNull();

    resetDockLayout();

    expect(window.localStorage.getItem(DOCK_STORAGE_KEY)).toBeNull();
  });

  it("dispatches a ck:dock-reset window event", () => {
    const handler = vi.fn();
    window.addEventListener("ck:dock-reset", handler);

    resetDockLayout();

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("ck:dock-reset", handler);
  });

  it("is a no-op-safe when localStorage is unavailable (best-effort, same as the rest of this module)", () => {
    // @ts-expect-error -- simulating an environment with no localStorage
    delete window.localStorage;
    expect(() => resetDockLayout()).not.toThrow();
  });
});

describe("corrupt state", () => {
  it("falls back to an empty state when the stored value is not valid JSON", () => {
    window.localStorage.setItem(DOCK_STORAGE_KEY, "{not json");
    expect(loadDockState()).toEqual({});
  });

  it("falls back to an empty state when the stored value is a JSON array (wrong shape)", () => {
    window.localStorage.setItem(DOCK_STORAGE_KEY, "[1,2,3]");
    expect(loadDockState()).toEqual({});
  });

  it("returns an empty state when nothing has been stored yet", () => {
    expect(loadDockState()).toEqual({});
  });
});
