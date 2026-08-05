import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { DockProvider } from "./DockProvider";
import { RepPanel } from "./RepPanel";
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
});
