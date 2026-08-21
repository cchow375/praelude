import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DockProvider } from "./DockProvider";
import { DockPanel } from "./DockPanel";
import { DockPillBar } from "./DockPillBar";
import {
  DOCK_STORAGE_KEY,
  MIN_VISIBLE_ON_OPEN_PX,
  MIN_VISIBLE_PX,
  rectsIntersect,
  type Rect,
} from "./dockState";

// Residuals fix wave — DOM-level coverage for defects 1, 2 and 4, which the
// existing constants-only dockDefaultLayout.test.ts cannot exercise (jsdom
// always reports a zero-size layout, so a real panel's rendered footprint
// has to be mocked in here rather than measured).

const VIEWPORT = { width: 720, height: 520 };

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
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: VIEWPORT.width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: VIEWPORT.height,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Waits for the become-visible clamp effect's `requestAnimationFrame` to
 * actually run (see DockPanel.tsx) — real timers only; a plain synchronous
 * assertion right after a click would run BEFORE the frame fires. */
async function flushClampFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Mocks every element's `getBoundingClientRect` to return `size` — good
 * enough here because each test only ever has one dock panel's `<div
 * role="dialog">` actually measured by `panelSize()` at a time. */
function mockMeasuredSize(size: { width: number; height: number }) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    top: 0,
    left: 0,
    right: size.width,
    bottom: size.height,
    toJSON() {
      return this;
    },
  });
}

describe("DockPanel — become-visible clamp (residuals fix wave, defect 1: clock opens off-screen)", () => {
  it("pulls a panel whose default position would leave only its title bar on screen back into view", async () => {
    // Mirrors the live-QA bug: ClockPanel's real default y (464) at a 520px
    // viewport, with a realistic ~300px-tall rendered panel.
    mockMeasuredSize({ width: 260, height: 300 });
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        clock: {
          x: 24,
          y: 464,
          minimized: false,
          open: false,
          z: 1,
          flashing: false,
        },
      }),
    );
    render(
      <DockProvider>
        <DockPanel id="clock" title="Clock" defaultPosition={{ x: 24, y: 464 }}>
          <div>clock body</div>
        </DockPanel>
      </DockProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore Clock" }));
    await flushClampFrame();

    const dialog = screen.getByRole("dialog", { name: "Clock" });
    const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(
      dialog.style.transform,
    );
    expect(match).not.toBeNull();
    const y = Number(match![2]);
    // At least the title bar + a first row of content must be on screen —
    // the panel's top can be no lower than viewport.height - the open floor.
    expect(y).toBeLessThanOrEqual(VIEWPORT.height - MIN_VISIBLE_ON_OPEN_PX);
    // And it actually moved — this is the bug: it used to stay at 464.
    expect(y).toBeLessThan(464);
  });

  it("round 2 (REFUTED first pass): with the rep panel already expanded, opening the clock keeps the clock's OWN box fully inside the viewport, not just its top-left corner", async () => {
    // Live-QA repro: rep expanded first (a real ~470px-tall drawer, well
    // over the per-panel budget so it gets capped), THEN the clock opened
    // from the pill bar. Round 1 only clamped the clock's top-left position
    // — its max-height was still the SAME FIXED budget regardless of where
    // it landed, so pushed-below-rep it still rendered a box whose bottom
    // edge fell well past the viewport (QA measured the stopwatch Start
    // button at top:525.9 in a 520px-tall viewport) with no way to scroll
    // those off-viewport pixels back on screen — overflow-y only helps for
    // content taller than the panel's OWN box, not a box that itself
    // extends past the viewport.
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        rep: {
          x: 160,
          y: 16,
          minimized: false,
          open: true,
          z: 1,
          flashing: false,
        },
        clock: {
          x: 24,
          y: 504,
          minimized: false,
          open: false,
          z: 2,
          flashing: false,
        },
      }),
    );

    mockMeasuredSize({ width: 440, height: 470 });
    const { rerender } = render(
      <DockProvider>
        <DockPanel
          id="rep"
          title="Rep Counter"
          defaultPosition={{ x: 160, y: 16 }}
          width={440}
        >
          <div>rep body</div>
        </DockPanel>
        <DockPanel id="clock" title="Clock" defaultPosition={{ x: 24, y: 504 }}>
          <div>clock body</div>
        </DockPanel>
      </DockProvider>,
    );
    await flushClampFrame();

    // The rep panel's OWN rendered rect must already be honest about its
    // enforced ceiling (its real content, 470, exceeds the per-panel budget
    // at y=16, so it should be capped, not the raw 470).
    const repDialog = screen.getByRole("dialog", { name: "Rep Counter" });
    const repMaxHeight = Number(
      /^(\d+)px$/.exec(repDialog.style.maxHeight)?.[1] ?? NaN,
    );
    expect(repMaxHeight).toBeLessThan(470);
    expect(repMaxHeight).toBeGreaterThan(0);

    mockMeasuredSize({ width: 260, height: 300 });
    fireEvent.click(screen.getByRole("button", { name: "Restore Clock" }));
    await flushClampFrame();
    rerender(
      <DockProvider>
        <DockPanel
          id="rep"
          title="Rep Counter"
          defaultPosition={{ x: 160, y: 16 }}
          width={440}
        >
          <div>rep body</div>
        </DockPanel>
        <DockPanel id="clock" title="Clock" defaultPosition={{ x: 24, y: 504 }}>
          <div>clock body</div>
        </DockPanel>
      </DockProvider>,
    );

    const clockDialog = screen.getByRole("dialog", { name: "Clock" });
    const clockMatch = /translate\((-?\d+)px, (-?\d+)px\)/.exec(
      clockDialog.style.transform,
    );
    expect(clockMatch).not.toBeNull();
    const clockY = Number(clockMatch![2]);
    const clockMaxHeight = Number(
      /^(\d+)px$/.exec(clockDialog.style.maxHeight)?.[1] ?? NaN,
    );
    expect(Number.isFinite(clockMaxHeight)).toBe(true);

    // The hard requirement the round-2 report demands: the panel's OWN
    // bottom edge (y + its enforced max-height) must never cross the
    // viewport bottom — a genuinely reachable box, whatever is inside it,
    // rather than one whose lower portion is physically off-screen.
    expect(clockY + clockMaxHeight).toBeLessThanOrEqual(VIEWPORT.height);
    // And it must still be a genuinely usable box, not squeezed to nothing.
    expect(clockMaxHeight).toBeGreaterThanOrEqual(120);
  });
});

describe("DockPanel — become-visible collision resolution (residuals fix wave, defect 2: rep panel overlaps tray)", () => {
  it("keeps a newly-opened tray's rect clear of an already-open, real-sized rep panel", async () => {
    // The rep panel is already open at its real default (16), with a real
    // expanded-drawer height live QA measured at ~450-500px.
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        rep: {
          x: 160,
          y: 16,
          minimized: false,
          open: true,
          z: 1,
          flashing: false,
        },
        paused: {
          x: 160,
          y: 340,
          minimized: false,
          open: false,
          z: 2,
          flashing: false,
        },
      }),
    );

    // The rep panel measures at its real (CSS-capped) height first...
    mockMeasuredSize({ width: 440, height: 300 });
    const { rerender } = render(
      <DockProvider>
        <DockPanel
          id="rep"
          title="Rep Counter"
          defaultPosition={{ x: 160, y: 16 }}
          width={440}
        >
          <div>rep body</div>
        </DockPanel>
        <DockPanel
          id="paused"
          title="Paused Sets"
          defaultPosition={{ x: 160, y: 340 }}
        >
          <div>paused body</div>
        </DockPanel>
      </DockProvider>,
    );
    // Let the rep panel's own (no-op, already in range) become-visible effect
    // + rect report settle before the tray opens.
    await flushClampFrame();

    // ...then the tray measures its own (smaller) real size once it opens.
    mockMeasuredSize({ width: 260, height: 140 });
    fireEvent.click(
      screen.getByRole("button", { name: "Restore Paused Sets" }),
    );
    await flushClampFrame();
    rerender(
      <DockProvider>
        <DockPanel
          id="rep"
          title="Rep Counter"
          defaultPosition={{ x: 160, y: 16 }}
          width={440}
        >
          <div>rep body</div>
        </DockPanel>
        <DockPanel
          id="paused"
          title="Paused Sets"
          defaultPosition={{ x: 160, y: 340 }}
        >
          <div>paused body</div>
        </DockPanel>
      </DockProvider>,
    );

    const repRect = readDialogRect("Rep Counter", { width: 440, height: 300 });
    const trayRect = readDialogRect("Paused Sets", { width: 260, height: 140 });
    expect(rectsIntersect(repRect, trayRect)).toBe(false);
  });
});

function readDialogRect(
  name: string,
  size: { width: number; height: number },
): Rect {
  const dialog = screen.getByRole("dialog", { name });
  const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(
    dialog.style.transform,
  );
  if (!match) throw new Error(`${name} has no translate transform`);
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    width: size.width,
    height: size.height,
  };
}

describe("v6.0.1 — persisted off-viewport position is re-clamped on ensurePanel", () => {
  it("clamps a panel that mounts already open at a position persisted from a larger/different viewport back into view", () => {
    // No prior "restore" click, no visibility transition at all — this
    // panel is ALREADY `open` in the persisted blob, so DockPanel's
    // become-visible effect (which only fires on a false->true transition)
    // never runs for it. `ensurePanel` itself is the only seam that ever
    // sees this panel on this mount, so it is the only place that can catch
    // a position like this one that predates a resize/display change.
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        clock: {
          x: 5000,
          y: 5000,
          minimized: false,
          open: true,
          z: 1,
          flashing: false,
        },
      }),
    );

    render(
      <DockProvider>
        <DockPanel id="clock" title="Clock" defaultPosition={{ x: 24, y: 464 }}>
          <div>clock body</div>
        </DockPanel>
      </DockProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Clock" });
    const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(
      dialog.style.transform,
    );
    expect(match).not.toBeNull();
    const x = Number(match![1]);
    const y = Number(match![2]);

    // At least MIN_VISIBLE_PX must remain on screen in both axes — the
    // persisted 5000,5000 (from a larger window or a different display)
    // must never be reused verbatim.
    expect(x).toBeLessThanOrEqual(VIEWPORT.width - MIN_VISIBLE_PX);
    expect(y).toBeLessThanOrEqual(VIEWPORT.height - MIN_VISIBLE_PX);
    expect(x).toBeLessThan(5000);
    expect(y).toBeLessThan(5000);
  });

  it("leaves an already-on-screen persisted position untouched", () => {
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        clock: {
          x: 24,
          y: 64,
          minimized: false,
          open: true,
          z: 1,
          flashing: false,
        },
      }),
    );

    render(
      <DockProvider>
        <DockPanel id="clock" title="Clock" defaultPosition={{ x: 24, y: 464 }}>
          <div>clock body</div>
        </DockPanel>
      </DockProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Clock" });
    const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(
      dialog.style.transform,
    );
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(24);
    expect(Number(match![2])).toBe(64);
  });

  it("round 2 (finding 1, HIGH): a WIDE panel's legitimately-dragged position, legal under its own real width but not under the 260px fallback, is left EXACTLY untouched", () => {
    // RepPanel's real width is 440 (RepPanel.tsx). At the 720px viewport
    // here, clampPanelWidth(440, 720) === 440, so a dragged x of -392 is
    // perfectly legal (minX = MIN_VISIBLE_PX - 440 = -392) — the panel's
    // title bar/controls are still MIN_VISIBLE_PX reachable on the right
    // edge. Under the WRONG 260px fallback, minX would be 48 - 260 = -212,
    // so -392 reads as out-of-range and gets shifted 180px on every single
    // mount — this must never happen.
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        rep: {
          x: -392,
          y: 16,
          minimized: false,
          open: true,
          z: 1,
          flashing: false,
        },
      }),
    );

    render(
      <DockProvider>
        <DockPanel
          id="rep"
          title="Rep Counter"
          defaultPosition={{ x: 160, y: 16 }}
          width={440}
        >
          <div>rep body</div>
        </DockPanel>
      </DockProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Rep Counter" });
    const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(
      dialog.style.transform,
    );
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(-392);
    expect(Number(match![2])).toBe(16);
  });

  it("round 2 (finding 1): a WIDE panel's genuinely off-viewport persisted position is still corrected, using its OWN real width", () => {
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        rep: {
          x: 5000,
          y: 5000,
          minimized: false,
          open: true,
          z: 1,
          flashing: false,
        },
      }),
    );

    render(
      <DockProvider>
        <DockPanel
          id="rep"
          title="Rep Counter"
          defaultPosition={{ x: 160, y: 16 }}
          width={440}
        >
          <div>rep body</div>
        </DockPanel>
      </DockProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Rep Counter" });
    const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(
      dialog.style.transform,
    );
    expect(match).not.toBeNull();
    const x = Number(match![1]);
    const y = Number(match![2]);
    // clampPanelWidth(440, 720) === 440, so maxX = 720 - MIN_VISIBLE_PX.
    expect(x).toBeLessThanOrEqual(VIEWPORT.width - MIN_VISIBLE_PX);
    expect(y).toBeLessThanOrEqual(VIEWPORT.height - MIN_VISIBLE_PX);
    expect(x).toBeLessThan(5000);
    expect(y).toBeLessThan(5000);
  });

  it("round 2 (finding 2, LOW): a minimized (pill-form) panel is left untouched on mount — no rect to protect, and the become-visible effect will re-clamp it for real once it opens", () => {
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        clock: {
          x: 5000,
          y: 5000,
          minimized: true,
          open: true,
          z: 1,
          flashing: false,
        },
      }),
    );

    render(
      <DockProvider>
        <DockPanel id="clock" title="Clock" defaultPosition={{ x: 24, y: 464 }}>
          <div>clock body</div>
        </DockPanel>
      </DockProvider>,
    );

    // Renders as a pill (minimized), never a dialog with a position at all.
    expect(
      screen.getByRole("button", { name: "Restore Clock" }),
    ).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: "Clock" })).toBeNull();

    // And the persisted position itself was never rewritten by ensurePanel
    // — no state change means no `saveDockState` write.
    const raw = window.localStorage.getItem(DOCK_STORAGE_KEY);
    const stored = JSON.parse(raw ?? "{}");
    expect(stored.clock.x).toBe(5000);
    expect(stored.clock.y).toBe(5000);
  });
});

describe("DockPillBar (residuals fix wave, defect 4: pill occludes page content)", () => {
  // A live-QA reproduction at 720x520 showed a day sheet's carry-forward
  // button sitting under the fixed pill stack on the very FIRST (unscrolled)
  // paint — a scroll-container-padding fix cannot catch that (nothing was
  // scrolled), which is why pills now portal into a REAL shell grid row
  // instead. This harness mirrors that shell shape closely enough to prove
  // pills never become their own layer stacked on top of `<main>`'s content:
  // a fixed-height flex column with `<main>` given `flex: 1 1 auto;
  // min-height: 0` (matching `.shell-stage`'s `min-height: 0` in shell.css)
  // and the bar as a normal sibling below it, never absolutely/fixed
  // positioned.
  function Harness({ pillCount }: { pillCount: number }) {
    const ids = ["rep", "paused", "clock"].slice(0, pillCount);
    return (
      <DockProvider>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: VIEWPORT.height,
          }}
        >
          <main style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
            <button type="button" data-testid="carry">
              → today
            </button>
          </main>
          <DockPillBar />
        </div>
        {ids.map((id) => (
          <DockPanel
            key={id}
            id={id}
            title={id}
            defaultPosition={{ x: 0, y: 0 }}
          >
            <div>{id} body</div>
          </DockPanel>
        ))}
      </DockProvider>
    );
  }

  it("portals pills into the real bar instead of a fixed overlay — the carry button is never covered, at ANY scroll position, because it is never behind them at all", () => {
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
    render(<Harness pillCount={3} />);

    const bar = document.getElementById("dock-pill-bar");
    expect(bar).not.toBeNull();
    const pills = [
      screen.getByRole("button", { name: "Restore rep" }),
      screen.getByRole("button", { name: "Restore paused" }),
      screen.getByRole("button", { name: "Restore clock" }),
    ];
    // Every pill actually lives inside the bar (a real DOM child, not a
    // fixed-position element floating independently of it) — by
    // construction, a sibling's real layout (the carry button in `<main>`,
    // above the bar) can never be underneath something that is INSIDE a
    // later sibling's own box.
    for (const pill of pills) {
      expect(bar!.contains(pill)).toBe(true);
      expect(pill.className).not.toMatch(/dock-pill--fixed-fallback/);
    }
    // The carry button is unaffected — still a normal, clickable button in
    // `<main>`, nothing stacked on top of it.
    const carry = screen.getByTestId("carry");
    expect(carry.closest("main")).not.toBeNull();
    fireEvent.click(carry);
  });

  it("falls back to the old fixed-position pill when no bar is mounted (e.g. a standalone test)", () => {
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        rep: { x: 0, y: 0, minimized: true, open: true, z: 1, flashing: false },
      }),
    );
    render(
      <DockProvider>
        <DockPanel
          id="rep"
          title="Rep Counter"
          defaultPosition={{ x: 0, y: 0 }}
        >
          <div>rep body</div>
        </DockPanel>
      </DockProvider>,
    );
    const pill = screen.getByRole("button", { name: "Restore Rep Counter" });
    expect(pill.className).toMatch(/dock-pill--fixed-fallback/);
  });
});

describe("DockProvider — ck:dock-reset (real-use fix wave item 4: Reset panel layout)", () => {
  it("snaps a dragged-away, minimized panel back to its default position and initial open/minimized flags", async () => {
    // Simulates the exact failure mode the brief calls out: a panel dragged
    // somewhere silly AND left minimized (a "lost" pill) — a reset that only
    // fixed position and left it stuck minimized would not be a real reset.
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        rep: {
          x: 999,
          y: 999,
          minimized: true,
          open: true,
          z: 7,
          flashing: true,
        },
      }),
    );

    render(
      <DockProvider>
        <DockPanel
          id="rep"
          title="Rep Counter"
          defaultPosition={{ x: 160, y: 300 }}
          width={440}
        >
          <div>rep body</div>
        </DockPanel>
      </DockProvider>,
    );

    // Still dragged-away and minimized before the reset.
    expect(
      screen.getByRole("button", { name: "Restore Rep Counter" }),
    ).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new Event("ck:dock-reset"));
    });

    // Pill vs. panel looks identical whether the panel is "closed" or
    // "minimized" (both render the same Restore pill) — inspect the
    // persisted state directly to prove the reset didn't just fix position
    // but ALSO cleared the minimized flag (a reset that left it stuck
    // minimized would not be a real reset) back to the same open:false,
    // minimized:false a never-touched panel starts at.
    const persisted = JSON.parse(
      window.localStorage.getItem(DOCK_STORAGE_KEY) ?? "{}",
    );
    expect(persisted.rep).toMatchObject({
      x: 160,
      y: 300,
      open: false,
      minimized: false,
    });

    // Open it back up and confirm it now renders at the real default
    // position, not the dragged-away one.
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Restore Rep Counter" }),
      );
    });
    await flushClampFrame();
    const dialog = screen.getByRole("dialog", { name: "Rep Counter" });
    const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(
      dialog.style.transform,
    );
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(160);
    expect(Number(match![2])).toBe(300);
  });
});
