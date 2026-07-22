import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { formatFocusedTime, RepHud } from "./RepHud";
import type { RepSnapshot } from "./useRep";

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

describe("RepHud", () => {
  it("formats the persisted focus clock without inventing fractional time", () => {
    expect(formatFocusedTime(0)).toBe("0:00");
    expect(formatFocusedTime(125.9)).toBe("2:05");
    expect(formatFocusedTime(Number.NaN)).toBe("0:00");
  });

  it("renders nothing when there is no active set", () => {
    const { container } = render(
      <RepHud snap={null} feed={[]} error={null} {...callbacks()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("offers a compact state without making the active set disappear", () => {
    const onToggleCollapsed = vi.fn();
    render(
      <RepHud
        snap={makeSnap()}
        feed={[]}
        error={null}
        collapsed
        onToggleCollapsed={onToggleCollapsed}
        {...callbacks()}
      />,
    );
    const hud = screen.getByRole("region", { name: "Active practice set" });
    expect(hud.classList.contains("is-collapsed")).toBe(true);
    expect(screen.getByText("Gymnopédie No. 1")).toBeTruthy();
    const expand = screen.getByRole("button", { name: "Expand set" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Pain, numbness, or weakness — stop" })
        .getAttribute("data-compact-visible"),
    ).toBe("true");
    fireEvent.click(expand);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("shows the moving rung streak while climbing to target, not a frozen mastery fraction", () => {
    // Regression: Christian opened a tempo set at 45 with target 52, clicked
    // Clean repeatedly, and the prominent number sat at "0/7" the whole time —
    // because below target the target-mastery streak is legitimately 0. The big
    // number must instead show the rung streak, which moves on every clean.
    render(
      <RepHud
        snap={makeSnap({ variant: "hands separate" })}
        feed={[]}
        error={null}
        {...callbacks()}
      />,
    );
    expect(screen.getByText("Gymnopédie No. 1")).toBeTruthy();
    expect(screen.getByText("mm. 1–8")).toBeTruthy();
    // Below target (72 < 84) the primary number is the moving rung streak, and
    // it is NOT mislabeled as a mastery fraction.
    expect(
      screen.getByLabelText(
        "Clean streak at this rung 2 of 3, climbing to 84 BPM",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/Mastery proof at target/)).toBeNull();
    const climb = screen.getByRole("status");
    expect(climb.textContent).toContain("Climbing to");
    expect(climb.textContent).toContain("84");
    expect(climb.textContent).toContain("5 clean");
    expect(screen.queryByText("Mastery not yet satisfied")).toBeNull();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("hands separate")).toBeTruthy();
    expect(screen.queryByText("4/30")).toBeNull();
  });

  it("switches to the N-in-a-row target proof once the working tempo reaches target", () => {
    render(
      <RepHud
        snap={makeSnap({
          bpm: 84,
          target_bpm: 84,
          current_clean_streak: 4,
          mastery_progress_streak: 3,
        })}
        feed={[]}
        error={null}
        {...callbacks()}
      />,
    );
    // At target the primary number is the target-mastery proof, and the
    // climbing caption is gone.
    expect(
      screen.getByLabelText("Mastery proof at target 3 of 5"),
    ).toBeTruthy();
    expect(screen.queryByText(/Climbing to/)).toBeNull();
  });

  it("never infers mastery from a legacy attempt count", () => {
    render(
      <RepHud
        snap={makeSnap({
          attempts_recorded: undefined,
          tries: undefined,
          current_clean_streak: undefined,
          mastery_progress_streak: undefined,
          required_clean_streak: undefined,
          effective_required_clean_streak: undefined,
          mastery_status: undefined,
          mastery_verified: undefined,
          set_state: undefined,
          reps_done: 30,
          planned_reps: 30,
        })}
        feed={[]}
        error={null}
        {...callbacks()}
      />,
    );
    expect(screen.getByText("Mastery unverified")).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Mastery proof at target unavailable of unavailable",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Mastery verified")).toBeNull();
  });

  it("maps Clean / Sloppy / Again to ledger verdicts and carries a note", async () => {
    const handlers = callbacks();
    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
    const note = screen.getByLabelText("Attempt note") as HTMLInputElement;
    fireEvent.change(note, { target: { value: "dragged the trill" } });
    fireEvent.click(screen.getByRole("button", { name: "Clean" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Sloppy" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sloppy" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Again" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    await waitFor(() => expect(handlers.onCheck).toHaveBeenCalledTimes(3));
    expect(handlers.onCheck).toHaveBeenNthCalledWith(
      1,
      "clean",
      "dragged the trill",
    );
    expect(handlers.onCheck).toHaveBeenNthCalledWith(2, "flawed", null);
    expect(handlers.onCheck).toHaveBeenNthCalledWith(3, "failed", null);
    expect(note.value).toBe("");
  });

  it("serializes overlapping HUD verdicts so a later check cannot suppress an earlier rung retune", async () => {
    let resolveFirst: () => void = () => undefined;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const handlers = callbacks();
    handlers.onCheck.mockImplementationOnce(() => first);
    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);

    fireEvent.click(screen.getByRole("button", { name: "Clean" }));
    fireEvent.click(screen.getByRole("button", { name: "Sloppy" }));

    expect(handlers.onCheck).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Sloppy" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByLabelText("Attempt note").hasAttribute("disabled")).toBe(
      true,
    );

    resolveFirst();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Sloppy" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sloppy" }));
    await waitFor(() => expect(handlers.onCheck).toHaveBeenCalledTimes(2));
  });

  it("keeps the safety stop available while another practice mutation is pending", async () => {
    let resolveCheck: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      resolveCheck = resolve;
    });
    const handlers = callbacks();
    handlers.onCheck.mockImplementationOnce(() => pending);
    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);

    fireEvent.click(screen.getByRole("button", { name: "Clean" }));
    const safety = screen.getByRole("button", {
      name: "Pain, numbness, or weakness — stop",
    });
    expect(safety.hasAttribute("disabled")).toBe(false);
    fireEvent.click(safety);

    await waitFor(() => expect(handlers.onSafetyStop).toHaveBeenCalledTimes(1));
    expect(handlers.onCheck).toHaveBeenCalledTimes(1);
    resolveCheck();
  });

  it("restores the attempt note after a rejected save and keeps Close out of the mutation race", async () => {
    let rejectCheck: (cause: Error) => void = () => undefined;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectCheck = reject;
    });
    const handlers = callbacks();
    handlers.onCheck.mockImplementationOnce(() => pending);
    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
    const note = screen.getByLabelText("Attempt note") as HTMLInputElement;
    fireEvent.change(note, { target: { value: "keep this evidence" } });

    fireEvent.click(screen.getByRole("button", { name: "Clean" }));
    expect(
      screen
        .getByRole("button", { name: "Close practice set" })
        .hasAttribute("disabled"),
    ).toBe(true);
    rejectCheck(new Error("write rejected"));

    await waitFor(() => expect(note.value).toBe("keep this evidence"));
    expect(
      screen
        .getByRole("button", { name: "Close practice set" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("makes verified mastery unmistakable and blocks extra verdicts", () => {
    render(
      <RepHud
        snap={makeSnap({
          current_clean_streak: 5,
          mastery_progress_streak: 5,
          mastery_status: "satisfied",
          mastery_verified: true,
          set_state: "mastered",
        })}
        feed={[]}
        error={null}
        {...callbacks()}
      />,
    );
    expect(screen.getByText("Mastery verified")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Clean" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Restart set" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("undoes without optimistic state and corrects the latest attempt", async () => {
    const handlers = callbacks();
    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(handlers.onUndo).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Correct latest" }));
    fireEvent.change(screen.getByLabelText("Corrected verdict"), {
      target: { value: "clean" },
    });
    fireEvent.change(screen.getByLabelText("Corrected note"), {
      target: { value: "steady now" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() =>
      expect(handlers.onCorrect).toHaveBeenCalledWith(
        44,
        "clean",
        "steady now",
      ),
    );
  });

  it("offers append-only reversal for the latest active adjustment", async () => {
    const handlers = callbacks();
    render(
      <RepHud
        snap={makeSnap({ last_adjustment_id: 19 })}
        feed={[]}
        error={null}
        {...handlers}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Reverse latest adjustment" }),
    );
    await waitFor(() =>
      expect(handlers.onReverseAdjustment).toHaveBeenCalledWith(19),
    );
    expect(document.body.textContent).not.toContain("19");
  });

  it("requires explicit restart confirmation and explains preserved history", async () => {
    const handlers = callbacks();
    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart set" }));
    expect(
      screen.getByRole("group", { name: "Restart this set?" }).textContent,
    ).toContain("marked restarted");
    expect(
      screen.getByRole("group", { name: "Restart this set?" }).textContent,
    ).toContain("attempts stay in history");
    expect(document.activeElement).toBe(
      screen.getAllByRole("button", { name: "Restart set" })[1],
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Restart set" })[1]);
    await waitFor(() => expect(handlers.onRestart).toHaveBeenCalledWith(5));
  });

  it("drives pause, resume, reflection, safety, and explicit recovery through callbacks", async () => {
    const handlers = callbacks();
    const { rerender } = render(
      <RepHud
        snap={makeSnap({
          timer_state: "active",
          active_seconds: 125,
          intention: "Even release",
          judging_axis: "pulse",
        })}
        feed={[]}
        error={null}
        {...handlers}
      />,
    );

    expect(screen.getByText("2:05")).toBeTruthy();
    expect(screen.getByText("Even release")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(handlers.onPause).toHaveBeenCalledTimes(1));

    rerender(
      <RepHud
        snap={makeSnap({
          timer_state: "paused",
          set_state: "paused",
          active_seconds: 125,
        })}
        feed={[]}
        error={null}
        {...handlers}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(handlers.onResume).toHaveBeenCalledTimes(1));

    rerender(
      <RepHud
        snap={makeSnap({
          timer_state: "active",
          set_state: "active",
          active_seconds: 125,
        })}
        feed={[]}
        error={null}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reflect" }));
    fireEvent.change(
      screen.getByLabelText("What changed? Keep it short and observable."),
      { target: { value: "Pulse stayed even below 72." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save reflection" }));
    await waitFor(() =>
      expect(handlers.onReflect).toHaveBeenCalledWith(
        "Pulse stayed even below 72.",
      ),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Pain, numbness, or weakness — stop",
      }),
    );
    await waitFor(() =>
      expect(handlers.onSafetyStop).toHaveBeenCalledWith(
        "Pain, numbness, or weakness reported by the pianist.",
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add 2 recovery cleans" }),
    );
    await waitFor(() =>
      expect(handlers.onRecover).toHaveBeenCalledWith({
        kind: "clean_debt",
        clean_count: 2,
        rationale: "Pianist chose two additional recovery cleans.",
      }),
    );
  });

  it("shows a review boundary without calling the set complete", () => {
    render(
      <RepHud
        snap={makeSnap({ review_boundary_reached: true })}
        feed={[]}
        error={null}
        {...callbacks()}
      />,
    );
    const prompt = screen.getByText(/Review boundary reached/);
    expect(prompt.textContent).toContain(
      "continue, change strategy, restart, or close",
    );
    expect(prompt.textContent?.toLowerCase()).not.toContain("complete");
  });

  it("renders recent attempts and closes the set", () => {
    const handlers = callbacks();
    render(
      <RepHud
        snap={makeSnap()}
        feed={[
          { verdict: "clean", note: null, bpm: 72 },
          { verdict: "flawed", note: "rushed", bpm: 68 },
        ]}
        error={null}
        {...handlers}
      />,
    );
    expect(screen.getByLabelText("Recent attempt verdicts")).toBeTruthy();
    expect(screen.getByText("rushed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close practice set" }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not present a compatibility zero BPM as musical tempo", () => {
    render(
      <RepHud
        snap={makeSnap({ focus: "memory", use_metronome: false, bpm: 0 })}
        feed={[{ verdict: "clean", note: "from memory", bpm: null }]}
        error={null}
        {...callbacks()}
      />,
    );
    const feed = screen.getByLabelText("Recent attempt verdicts");
    expect(within(feed).queryByText("0")).toBeNull();
    expect(screen.getByText("memory")).toBeTruthy();
  });

  it("does not render a null active tempo as copy", () => {
    render(
      <RepHud
        snap={makeSnap({ bpm: null, focus: "tempo", use_metronome: true })}
        feed={[]}
        error={null}
        {...callbacks()}
      />,
    );
    expect(document.body.textContent).not.toContain("♩ null");
    // A null tempo renders no tempo chip at all in the compact HUD.
    expect(document.body.textContent).not.toContain("♩");
  });
});
