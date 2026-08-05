import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { DockProvider } from "./DockProvider";
import { RepPanel } from "./RepPanel";
import { PANEL_WIDTH_EDGE_MARGIN, clampPanelWidth } from "./dockState";
import type { RepSnapshot } from "../rep/useRep";

// Task A3: RepHud's render host moved from an in-flow shell strip / the
// Today's-Practice window strip into a shell-level floating dock panel
// (`<DockPanel id="rep">`). These tests cover the NEW behavior this task adds
// — auto-open on the inactive->active transition only, the subdued empty
// state, and that relocating the render host changed nothing about the
// verdict buttons' IPC args. RepHud's own internal logic/tests are untouched
// and covered exhaustively by RepHud.test.tsx.

afterEach(cleanup);

function makeSnap(over: Partial<RepSnapshot> = {}): RepSnapshot {
  return {
    block_id: 1,
    piece_id: 7,
    piece_title: "Gymnopédie No. 1",
    m_start: 1,
    m_end: 8,
    label: null,
    bpm: 72,
    start_bpm: 60,
    target_bpm: 84,
    planned_reps: 30,
    reps_done: 4,
    cleans_at_step: 1,
    rule: { clean_needed: 3, bpm_step: 4 },
    variant: null,
    variants: [],
    verdicts: { clean: 3, flawed: 1, failed: 0 },
    last: { verdict: "flawed", note: "rushed", bpm: 72 },
    status: "active",
    focus: "tempo",
    use_metronome: true,
    attempts_recorded: 4,
    tries: 4,
    voided_attempts: 0,
    current_clean_streak: 2,
    mastery_progress_streak: 0,
    best_clean_streak: 3,
    reset_count: 1,
    accuracy: 0.75,
    required_clean_streak: 5,
    effective_required_clean_streak: 5,
    recovery_remaining: 0,
    mastery_status: "not_satisfied",
    mastery_verified: true,
    set_state: "active",
    last_attempt_id: 44,
    last_adjustment_id: null,
    ...over,
  };
}

function callbacks() {
  return {
    onCheck: vi.fn().mockResolvedValue(undefined),
    onUndo: vi.fn().mockResolvedValue(undefined),
    onCorrect: vi.fn().mockResolvedValue(undefined),
    onReverseAdjustment: vi.fn().mockResolvedValue(undefined),
    onRestart: vi.fn().mockResolvedValue(undefined),
    onPause: vi.fn().mockResolvedValue(undefined),
    onResume: vi.fn().mockResolvedValue(undefined),
    onReflect: vi.fn().mockResolvedValue(undefined),
    onSafetyStop: vi.fn().mockResolvedValue(undefined),
    onRecover: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
  };
}

function Harness({
  snap,
  handlers,
}: {
  snap: RepSnapshot | null;
  handlers?: ReturnType<typeof callbacks>;
}) {
  return (
    <DockProvider>
      <RepPanel
        snap={snap}
        feed={[]}
        error={null}
        {...(handlers ?? callbacks())}
      />
    </DockProvider>
  );
}

describe("RepPanel — rep HUD's shell-level dock host (Task A3)", () => {
  it("mounts closed and auto-opens the very first time set_state becomes active", async () => {
    const { rerender } = render(<Harness snap={null} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<Harness snap={makeSnap({ set_state: "active" })} />);

    const panel = await screen.findByRole("dialog", { name: "Rep Counter" });
    expect(within(panel).getByText("Gymnopédie No. 1")).toBeTruthy();
  });

  it("shows a subdued empty state, not the HUD, when no set is active", async () => {
    // Force the panel open via a real transition first — an empty state that
    // never opens would trivially "pass" without proving anything.
    const { rerender } = render(
      <Harness snap={makeSnap({ set_state: "active" })} />,
    );
    await screen.findByRole("dialog", { name: "Rep Counter" });

    rerender(<Harness snap={null} />);

    const panel = await screen.findByRole("dialog", { name: "Rep Counter" });
    expect(within(panel).getByText("No active set")).toBeTruthy();
    expect(
      within(panel).queryByRole("region", { name: "Active practice set" }),
    ).toBeNull();
  });

  it("does not reopen a panel the pianist minimized mid-set (only the transition opens it)", async () => {
    const snap = makeSnap({ set_state: "active" });
    render(<Harness snap={snap} />);
    await screen.findByRole("dialog", { name: "Rep Counter" });

    fireEvent.click(
      screen.getByRole("button", { name: "Minimize Rep Counter" }),
    );
    expect(screen.queryByRole("dialog", { name: "Rep Counter" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Restore Rep Counter" }),
    ).toBeTruthy();
  });

  it("DOES reopen a fully CLOSED (not minimized) panel on the next inactive->active transition", async () => {
    // Closed and minimized are different states in DockProvider (`open`
    // false vs `minimized` true) — a closed panel has no pill affordance at
    // all, so the only way back is the same auto-open transition that first
    // showed it. This must keep working even though the sibling test above
    // proves a MINIMIZED panel is deliberately left alone. Everything below
    // happens against the SAME DockProvider instance (one `render`, driven
    // only by `rerender`) so the panel's closed state genuinely persists
    // across the transition, rather than being reset by a fresh mount.
    const snap = makeSnap({ set_state: "active" });
    const { rerender } = render(<Harness snap={snap} />);
    await screen.findByRole("dialog", { name: "Rep Counter" });

    fireEvent.click(screen.getByRole("button", { name: "Close Rep Counter" }));
    expect(screen.queryByRole("dialog", { name: "Rep Counter" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Restore Rep Counter" }),
    ).toBeNull();

    // The set pauses (leaves "active" — set_state changes, so the effect's
    // dependency actually re-fires), then a later verdict resumes it — a
    // genuine inactive->active edge, same shape as the very first open.
    rerender(<Harness snap={{ ...snap, set_state: "paused" }} />);
    expect(screen.queryByRole("dialog", { name: "Rep Counter" })).toBeNull();

    rerender(<Harness snap={{ ...snap, set_state: "active" }} />);

    expect(
      await screen.findByRole("dialog", { name: "Rep Counter" }),
    ).toBeTruthy();
  });

  it("passes the exact verdict-button IPC args through unchanged from its new host", async () => {
    const handlers = callbacks();
    render(
      <Harness snap={makeSnap({ set_state: "active" })} handlers={handlers} />,
    );
    const panel = await screen.findByRole("dialog", { name: "Rep Counter" });

    fireEvent.click(within(panel).getByRole("button", { name: "Clean" }));

    expect(handlers.onCheck).toHaveBeenCalledTimes(1);
    // Byte-identical to RepHud's own contract: (verdict, null) with an empty
    // note field, exactly as RepHud.test.tsx spies on it directly.
    expect(handlers.onCheck).toHaveBeenCalledWith("clean", null);
  });

  // Task A4: the paused-sets tray relies on the SAME pause/resume write path
  // as the rep panel's own toggle (RepHud.tsx's Pause/Resume chip, which
  // calls onPause -> the existing `rep_pause` command). This proves that
  // control is reachable from an active set in its NEW dock host, exactly as
  // the brief requires ("a Pause button rendered in the rep panel, active
  // state only, calls rep_pause") — no new button was added for this, since
  // one already existed and just moved hosts under Task A3.
  it("renders a reachable Pause control in the active state that calls onPause", async () => {
    const handlers = callbacks();
    render(
      <Harness snap={makeSnap({ set_state: "active" })} handlers={handlers} />,
    );
    const panel = await screen.findByRole("dialog", { name: "Rep Counter" });

    fireEvent.click(within(panel).getByRole("button", { name: "Pause" }));

    expect(handlers.onPause).toHaveBeenCalledTimes(1);
  });

  describe("at the 720x520 dense-layout floor (binding global constraint)", () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    beforeEach(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 720,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 520,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      });
    });

    it("renders at its full requested width, with verdict buttons and the streak intact, inside the viewport clamp", async () => {
      render(<Harness snap={makeSnap({ set_state: "active" })} />);
      const panel = await screen.findByRole("dialog", { name: "Rep Counter" });

      // clampPanelWidth(440, 720) = 440 (well under the 720 - 2*24 = 672px
      // available at the floor) — the panel gets its full requested width,
      // not the framework's cramped 320px default.
      const width = Number((panel.style.width || "").replace("px", ""));
      expect(width).toBe(440);
      expect(width).toBeLessThanOrEqual(clampPanelWidth(width, 720));
      expect(width).toBeLessThanOrEqual(720 - PANEL_WIDTH_EDGE_MARGIN * 2);

      // The controls the old 320px cap put at risk of clipping/unusable
      // stacking are all present and reachable.
      expect(within(panel).getByRole("button", { name: "Clean" })).toBeTruthy();
      expect(
        within(panel).getByRole("button", { name: "Sloppy" }),
      ).toBeTruthy();
      expect(within(panel).getByRole("button", { name: "Again" })).toBeTruthy();
      expect(
        within(panel).getByLabelText(/clean streak|mastery proof/i),
      ).toBeTruthy();
    });

    it("clamps a panel that asks for more than the 720px floor allows", () => {
      // Not the rep panel itself (whose 440px fits) — proves the clamp math
      // that would protect a wider future panel at this same floor.
      expect(clampPanelWidth(1000, 720)).toBe(
        720 - PANEL_WIDTH_EDGE_MARGIN * 2,
      );
    });
  });
});
