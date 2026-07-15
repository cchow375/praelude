import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RepHud } from "./RepHud";
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
    onClose: vi.fn(),
  };
}

describe("RepHud", () => {
  it("renders nothing when there is no active set", () => {
    const { container } = render(
      <RepHud snap={null} feed={[]} error={null} {...callbacks()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("separates the current tempo rung from target-condition mastery proof", () => {
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
    expect(screen.getByLabelText("Mastery proof at target 0 of 5")).toBeTruthy();
    expect(screen.getByText("2/3")).toBeTruthy();
    expect(screen.getByText("Mastery not yet satisfied")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("hands separate")).toBeTruthy();
    expect(screen.queryByText("4/30")).toBeNull();
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
    expect(screen.getByLabelText("Mastery proof at target unavailable of unavailable")).toBeTruthy();
    expect(screen.queryByText("Mastery verified")).toBeNull();
  });

  it("maps Clean / Sloppy / Again to ledger verdicts and carries a note", async () => {
    const handlers = callbacks();
    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
    const note = screen.getByLabelText("Attempt note") as HTMLInputElement;
    fireEvent.change(note, { target: { value: "dragged the trill" } });
    fireEvent.click(screen.getByRole("button", { name: "Clean" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sloppy" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Sloppy" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Again" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    await waitFor(() => expect(handlers.onCheck).toHaveBeenCalledTimes(3));
    expect(handlers.onCheck).toHaveBeenNthCalledWith(1, "clean", "dragged the trill");
    expect(handlers.onCheck).toHaveBeenNthCalledWith(2, "flawed", null);
    expect(handlers.onCheck).toHaveBeenNthCalledWith(3, "failed", null);
    expect(note.value).toBe("");
  });

  it("serializes overlapping HUD verdicts so a later check cannot suppress an earlier rung retune", async () => {
    let resolveFirst: () => void = () => undefined;
    const first = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const handlers = callbacks();
    handlers.onCheck.mockImplementationOnce(() => first);
    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);

    fireEvent.click(screen.getByRole("button", { name: "Clean" }));
    fireEvent.click(screen.getByRole("button", { name: "Sloppy" }));

    expect(handlers.onCheck).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sloppy" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Attempt note").hasAttribute("disabled")).toBe(true);

    resolveFirst();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sloppy" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Sloppy" }));
    await waitFor(() => expect(handlers.onCheck).toHaveBeenCalledTimes(2));
  });

  it("restores the attempt note after a rejected save and keeps Close out of the mutation race", async () => {
    let rejectCheck: (cause: Error) => void = () => undefined;
    const pending = new Promise<void>((_resolve, reject) => { rejectCheck = reject; });
    const handlers = callbacks();
    handlers.onCheck.mockImplementationOnce(() => pending);
    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
    const note = screen.getByLabelText("Attempt note") as HTMLInputElement;
    fireEvent.change(note, { target: { value: "keep this evidence" } });

    fireEvent.click(screen.getByRole("button", { name: "Clean" }));
    expect(screen.getByRole("button", { name: "Close practice set" }).hasAttribute("disabled")).toBe(true);
    rejectCheck(new Error("write rejected"));

    await waitFor(() => expect(note.value).toBe("keep this evidence"));
    expect(screen.getByRole("button", { name: "Close practice set" }).hasAttribute("disabled")).toBe(false);
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
    expect(screen.getByRole("button", { name: "Clean" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Restart set" }).hasAttribute("disabled")).toBe(false);
  });

  it("undoes without optimistic state and corrects the latest attempt", async () => {
    const handlers = callbacks();
    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo last" }));
    await waitFor(() => expect(handlers.onUndo).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Correct latest" }));
    fireEvent.change(screen.getByLabelText("Corrected verdict"), { target: { value: "clean" } });
    fireEvent.change(screen.getByLabelText("Corrected note"), { target: { value: "steady now" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(handlers.onCorrect).toHaveBeenCalledWith(44, "clean", "steady now"));
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

    fireEvent.click(screen.getByRole("button", { name: "Reverse latest adjustment" }));
    await waitFor(() => expect(handlers.onReverseAdjustment).toHaveBeenCalledWith(19));
    expect(document.body.textContent).not.toContain("19");
  });

  it("requires explicit restart confirmation and explains preserved history", async () => {
    const handlers = callbacks();
    render(<RepHud snap={makeSnap()} feed={[]} error={null} {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart set" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("marked restarted");
    expect(screen.getByRole("alertdialog").textContent).toContain("attempts stay in history");
    fireEvent.click(screen.getAllByRole("button", { name: "Restart set" })[1]);
    await waitFor(() => expect(handlers.onRestart).toHaveBeenCalledWith(5));
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
    expect(prompt.textContent).toContain("continue, change strategy, restart, or close");
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
    expect(screen.getByText("—")).toBeTruthy();
  });
});
