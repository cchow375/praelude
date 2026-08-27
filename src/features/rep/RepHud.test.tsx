import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
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

  it("keeps the Region Sound target beside verdicts and persists edits", async () => {
    const onSoundTargetSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <RepHud
        snap={makeSnap({
          region_id: 41,
          sound_target: "Bell-like, never percussive",
        })}
        feed={[]}
        error={null}
        onSoundTargetSave={onSoundTargetSave}
        {...callbacks()}
      />,
    );

    const target = screen.getByText("Bell-like, never percussive");
    const targetRow = target.closest(".rep-hud-sound-target");
    expect(targetRow?.hasAttribute("data-compact-visible")).toBe(true);
    fireEvent.click(target);
    const input = screen.getByRole("textbox", { name: "Region sound target" });
    fireEvent.change(input, { target: { value: "  A singing inner voice  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSoundTargetSave).toHaveBeenCalledWith(
        41,
        "A singing inner voice",
      ),
    );
    expect(screen.getByText("A singing inner voice")).toBeTruthy();

    rerender(
      <RepHud
        snap={makeSnap({ region_id: null, sound_target: null })}
        feed={[]}
        error={null}
        onSoundTargetSave={onSoundTargetSave}
        {...callbacks()}
      />,
    );
    expect(screen.queryByText("Sound target")).toBeNull();
  });

  it("keeps the verdict buttons rendered when the set is collapsed (B82)", () => {
    render(
      <RepHud
        snap={makeSnap()}
        feed={[]}
        error={null}
        collapsed
        onToggleCollapsed={() => {}}
        {...callbacks()}
      />,
    );
    const hud = screen.getByRole("region", { name: "Active practice set" });
    expect(hud.classList.contains("is-collapsed")).toBe(true);

    // The CSS hides every direct child of a collapsed HUD that is not context,
    // not main, and not explicitly marked compact-visible. The verdict row must
    // carry that mark, or Clean/Sloppy/Again vanish at the 720x520 floor.
    const entry = hud.querySelector(".rep-hud-entry");
    expect(entry).toBeTruthy();
    expect(entry?.hasAttribute("data-compact-visible")).toBe(true);

    for (const name of ["Clean", "Sloppy", "Again"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
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

  it.each([
    ["eighth", "♪", "Eighth note"],
    ["dotted_quarter", "♩.", "Dotted quarter note"],
    ["half", "𝅗𝅥", "Half note"],
  ] as const)(
    "renders %s tuning truthfully without converting the BPM number",
    (beatUnit, mark, spokenLabel) => {
      const { container } = render(
        <RepHud
          snap={makeSnap({
            tuning: {
              beat_unit: beatUnit,
              beats_per_bar: 6,
              subdivision: 3,
            },
          })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );

      const tempo = container.querySelector(".rep-hud-tempo");
      expect(tempo?.textContent).toContain(`${mark} 72`);
      expect(tempo?.textContent).toContain("6 beats/bar · subdivision 3");
      expect(
        screen.getByLabelText(
          `${spokenLabel} 72 BPM, 6 beats/bar · subdivision 3`,
        ),
      ).toBeTruthy();
    },
  );

  it("offers compact subdivision steps only while the set metronome is running", () => {
    const setSubdivision = vi.fn();
    const { rerender } = render(
      <RepHud
        snap={makeSnap()}
        feed={[]}
        error={null}
        metroRunning
        runningSubdivision={3}
        onSetRunningSubdivision={setSubdivision}
        {...callbacks()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Increase running subdivision" }),
    );
    expect(setSubdivision).toHaveBeenCalledWith(4);
    fireEvent.click(
      screen.getByRole("button", { name: "Decrease running subdivision" }),
    );
    expect(setSubdivision).toHaveBeenCalledWith(2);

    rerender(
      <RepHud
        snap={makeSnap()}
        feed={[]}
        error={null}
        metroRunning={false}
        runningSubdivision={3}
        onSetRunningSubdivision={setSubdivision}
        {...callbacks()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Increase running subdivision" }),
    ).toBeNull();
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

  it("makes Listen Back a visible soft nudge and reports ownership to the voice gate", async () => {
    const handlers = callbacks();
    const onReplayModeChange = vi.fn();
    render(
      <RepHud
        snap={makeSnap()}
        feed={[]}
        error={null}
        onReplayModeChange={onReplayModeChange}
        {...handlers}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Review each rep by listening back/i,
      }),
    );
    await waitFor(() => expect(onReplayModeChange).toHaveBeenCalledWith(true));
    const clean = screen.getByRole("button", { name: "Clean" });
    expect((clean as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(clean);
    expect(handlers.onCheck).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Judge without listening" }),
    );
    fireEvent.click(clean);
    await waitFor(() => expect(handlers.onCheck).toHaveBeenCalledTimes(1));
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

  describe("rung-completion celebration (display only)", () => {
    afterEach(() => vi.useRealTimers());

    // A tempo set climbing 44 -> target 52, rung = 3 clean, +4 BPM per rung.
    function climbSnap(over: Partial<RepSnapshot> = {}): RepSnapshot {
      return makeSnap({
        bpm: 44,
        start_bpm: 40,
        target_bpm: 52,
        rule: { clean_needed: 3, bpm_step: 4 },
        current_clean_streak: 2,
        mastery_progress_streak: 0,
        mastery_status: "not_satisfied",
        last: { verdict: "flawed", note: null, bpm: 44 },
        last_attempt_id: 100,
        ...over,
      });
    }

    const headline = (c: HTMLElement | Element) =>
      c.querySelector(".rep-hud-streak-value strong")?.textContent;

    it("holds the FILLED rung receipt before the new rung, and never jumps downward on a clean", () => {
      vi.useFakeTimers();
      const { container, rerender } = render(
        <RepHud snap={climbSnap()} feed={[]} error={null} {...callbacks()} />,
      );
      // Climbing: the big number is the moving rung streak — 2 of 3 at ♩44.
      expect(headline(container)).toBe("2");

      // The clean that COMPLETES the rung: the engine steps 44 -> 48 and resets
      // the rung streak to 0 in the SAME snapshot Christian sees.
      act(() => {
        rerender(
          <RepHud
            snap={climbSnap({
              bpm: 48,
              current_clean_streak: 0,
              last: { verdict: "clean", note: null, bpm: 48 },
              last_attempt_id: 101,
            })}
            feed={[]}
            error={null}
            {...callbacks()}
          />,
        );
      });

      // (a) + (b): the immediate rendered consequence of the clean is the FILLED
      // rung 3/3 with a step receipt — the headline moved UP (2 -> 3), never the
      // downward 2 -> 0 drop the raw snapshot would show.
      expect(headline(container)).toBe("3");
      expect(headline(container)).not.toBe("0");
      expect(container.textContent).toContain("✓ → ♩48");
      expect(
        screen.getByLabelText("Rung 3 of 3 clean at ♩44 — stepping to ♩48"),
      ).toBeTruthy();

      // After the ~1.2s hold, the live new rung takes over: 0/3 at the new ♩48.
      act(() => vi.advanceTimersByTime(1200));
      expect(headline(container)).toBe("0");
      expect(container.querySelector(".rep-hud-tempo")?.textContent).toContain(
        "48",
      );
      expect(container.textContent).not.toContain("✓ → ♩");
    });

    it("releases the filled-rung hold early when the next verdict arrives", () => {
      vi.useFakeTimers();
      const { container, rerender } = render(
        <RepHud snap={climbSnap()} feed={[]} error={null} {...callbacks()} />,
      );
      act(() => {
        rerender(
          <RepHud
            snap={climbSnap({
              bpm: 48,
              current_clean_streak: 0,
              last: { verdict: "clean", note: null, bpm: 48 },
              last_attempt_id: 101,
            })}
            feed={[]}
            error={null}
            {...callbacks()}
          />,
        );
      });
      expect(headline(container)).toBe("3");

      // A clean at the NEW rung lands before the hold elapses — the receipt gives
      // way immediately to the live rung streak (now 1), no stale 3/3 lingering.
      act(() => {
        rerender(
          <RepHud
            snap={climbSnap({
              bpm: 48,
              current_clean_streak: 1,
              last: { verdict: "clean", note: null, bpm: 48 },
              last_attempt_id: 102,
            })}
            feed={[]}
            error={null}
            {...callbacks()}
          />,
        );
      });
      expect(headline(container)).toBe("1");
      expect(container.textContent).not.toContain("✓ → ♩");
    });
  });

  describe("A2 variant chain stage (a headline, not drawer content)", () => {
    it("names the current variant, its progress, and what comes next", () => {
      const { container } = render(
        <RepHud
          snap={makeSnap({
            variant: "dotted",
            variant_stage_index: 0,
            variant_stage_cleans: 3,
            variant_stage_required: 5,
            next_variant_stage_name: "reverse dotted",
          })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );
      const stage = container.querySelector(".rep-hud-variant-stage");
      expect(stage).not.toBeNull();
      expect(stage?.textContent).toContain("dotted");
      expect(stage?.textContent).toContain("3/5");
      expect(stage?.textContent).toContain("next: reverse dotted");
    });

    it("says when this is the last stage rather than promising a next one", () => {
      const { container } = render(
        <RepHud
          snap={makeSnap({
            variant: "staccato",
            variant_stage_index: 2,
            variant_stage_cleans: 1,
            variant_stage_required: 5,
            next_variant_stage_name: null,
          })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );
      const stage = container.querySelector(".rep-hud-variant-stage");
      expect(stage?.textContent).toContain("last in the chain");
      expect(stage?.textContent).not.toContain("next:");
    });

    it("renders nothing at all for a set with no variant chain", () => {
      const { container } = render(
        <RepHud
          snap={makeSnap({ variant: null, variant_stage_index: null })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );
      expect(container.querySelector(".rep-hud-variant-stage")).toBeNull();
    });
  });

  describe("B3 — the stage counter is the headline while a chain runs", () => {
    const headline = (c: HTMLElement | Element) =>
      c.querySelector(".rep-hud-streak-value strong")?.textContent;
    const required = (c: HTMLElement | Element) =>
      c.querySelector(".rep-hud-streak-value span:last-of-type")?.textContent;

    function chainSnap(over: Partial<RepSnapshot> = {}): RepSnapshot {
      return makeSnap({
        variant: "dotted",
        variants: [
          { name: "dotted", reps: 30 },
          { name: "reverse dotted", reps: 30 },
          { name: "staccato", reps: 30 },
        ],
        variant_stage_index: 0,
        variant_stage_cleans: 4,
        variant_stage_required: 5,
        next_variant_stage_name: "reverse dotted",
        variant_chain_complete: false,
        current_clean_streak: 4,
        mastery_progress_streak: 0,
        last: { verdict: "flawed", note: null, bpm: 72 },
        last_attempt_id: 200,
        ...over,
      });
    }

    it("shows the stage progress and the variant name, not the mastery streak", () => {
      const { container } = render(
        <RepHud snap={chainSnap()} feed={[]} error={null} {...callbacks()} />,
      );
      expect(headline(container)).toBe("4");
      expect(required(container)).toBe("5");
      expect(container.querySelector(".rep-hud-stage-name")?.textContent).toBe(
        "dotted",
      );
      expect(
        screen.getByLabelText(
          "dotted 4 of 5 clean, next variation reverse dotted",
        ),
      ).toBeTruthy();
    });

    it("plays one acknowledgement chime while holding the filled stage, then shows the next variant at 0", () => {
      vi.useFakeTimers();
      const play = vi.fn().mockResolvedValue(undefined);
      const factory = vi.fn().mockReturnValue({ play });
      const { container, rerender } = render(
        <RepHud
          snap={chainSnap()}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );
      expect(headline(container)).toBe("4");
      expect(play).not.toHaveBeenCalled();

      // The clean that CLEARS "dotted": the engine advances the chain and
      // resets the stage counter to 0 in the same snapshot.
      const advanced = chainSnap({
        variant: "reverse dotted",
        variant_stage_index: 1,
        variant_stage_cleans: 0,
        next_variant_stage_name: "staccato",
        last: { verdict: "clean", note: null, bpm: 72 },
        last_attempt_id: 201,
      });
      act(() => {
        rerender(
          <RepHud
            snap={advanced}
            feed={[]}
            error={null}
            {...callbacks()}
            audioFactory={factory}
          />,
        );
      });
      // The big number moved UP to the filled 5/5 of the stage just cleared —
      // never the downward 4 -> 0 the raw snapshot would show.
      expect(headline(container)).toBe("5");
      expect(required(container)).toBe("5");
      expect(container.querySelector(".rep-hud-stage-name")?.textContent).toBe(
        "dotted",
      );
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith("/chime.wav");
      expect(play).toHaveBeenCalledTimes(1);

      // A parent re-render carrying the same committed attempt is not a new
      // transition and must not acknowledge it again.
      act(() => {
        rerender(
          <RepHud
            snap={{ ...advanced }}
            feed={[]}
            error={null}
            {...callbacks()}
            audioFactory={factory}
          />,
        );
      });
      expect(play).toHaveBeenCalledTimes(1);

      // Then the next variation takes over at 0/5 — "5/5 -> 0/5 · reverse dotted".
      act(() => vi.advanceTimersByTime(1200));
      expect(headline(container)).toBe("0");
      expect(container.querySelector(".rep-hud-stage-name")?.textContent).toBe(
        "reverse dotted",
      );
      vi.useRealTimers();
    });

    it("does not chime when Undo moves the chain backward", () => {
      const play = vi.fn().mockResolvedValue(undefined);
      const factory = vi.fn().mockReturnValue({ play });
      const { rerender } = render(
        <RepHud
          snap={chainSnap({
            variant: "reverse dotted",
            variant_stage_index: 1,
            variant_stage_cleans: 1,
            next_variant_stage_name: "staccato",
            last: { verdict: "clean", note: null, bpm: 72 },
            last_attempt_id: 202,
          })}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );

      rerender(
        <RepHud
          snap={chainSnap({
            variant_stage_index: 0,
            variant_stage_cleans: 4,
            last: { verdict: "clean", note: null, bpm: 72 },
            last_attempt_id: 201,
          })}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );

      expect(factory).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
    });

    it("chimes when the first committed clean clears a one-clean opening stage", () => {
      const play = vi.fn().mockResolvedValue(undefined);
      const factory = vi.fn().mockReturnValue({ play });
      const { rerender } = render(
        <RepHud
          snap={chainSnap({
            variant_stage_index: 0,
            variant_stage_cleans: 0,
            variant_stage_required: 1,
            last: null,
            last_attempt_id: null,
          })}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );

      rerender(
        <RepHud
          snap={chainSnap({
            variant: "reverse dotted",
            variant_stage_index: 1,
            variant_stage_cleans: 0,
            variant_stage_required: 5,
            last: { verdict: "clean", note: null, bpm: 72 },
            last_attempt_id: 1,
          })}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );

      expect(factory).toHaveBeenCalledTimes(1);
      expect(play).toHaveBeenCalledTimes(1);
    });

    it("does not chime for final-chain completion or an extra clean after completion", () => {
      const play = vi.fn().mockResolvedValue(undefined);
      const factory = vi.fn().mockReturnValue({ play });
      const { rerender } = render(
        <RepHud
          snap={chainSnap({
            variant: "staccato",
            variant_stage_index: 2,
            variant_stage_cleans: 4,
            variant_stage_required: 5,
            next_variant_stage_name: null,
            last: { verdict: "clean", note: null, bpm: 84 },
            last_attempt_id: 300,
          })}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );

      const complete = chainSnap({
        variant: "staccato",
        variant_stage_index: 2,
        variant_stage_cleans: 5,
        variant_stage_required: 5,
        next_variant_stage_name: null,
        variant_chain_complete: true,
        mastery_status: "not_satisfied",
        last: { verdict: "clean", note: null, bpm: 84 },
        last_attempt_id: 301,
      });
      rerender(
        <RepHud
          snap={complete}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );
      rerender(
        <RepHud
          snap={{ ...complete, last_attempt_id: 302 }}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );

      expect(factory).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
    });

    it("leaves the headline exactly as before for a set with no chain", () => {
      const { container } = render(
        <RepHud
          snap={makeSnap({
            variant_stage_index: null,
            bpm: 84,
            target_bpm: 84,
            mastery_progress_streak: 3,
          })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );
      expect(headline(container)).toBe("3");
      expect(container.querySelector(".rep-hud-stage-name")).toBeNull();
    });
  });

  describe("B2 — a finished set closes itself", () => {
    const unfinished = () =>
      makeSnap({ mastery_status: "not_satisfied", mastery_verified: true });
    const satisfied = () =>
      makeSnap({ mastery_status: "satisfied", mastery_verified: true });

    /** Render the HUD watching the set FINISH, which is the only case that
     * counts down — a set already satisfied on first render is the
     * re-opened-from-the-tray case and is deliberately left alone. */
    function renderFinishing(props: ReturnType<typeof callbacks>) {
      const view = render(
        <RepHud snap={unfinished()} feed={[]} error={null} {...props} />,
      );
      act(() => {
        view.rerender(
          <RepHud snap={satisfied()} feed={[]} error={null} {...props} />,
        );
      });
      return view;
    }

    it("counts down and calls onClose after six seconds — not instantly", () => {
      vi.useFakeTimers();
      const props = callbacks();
      renderFinishing(props);
      expect(screen.getByText(/Set complete · closing in 6/)).toBeTruthy();
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByText(/Set complete · closing in 1/)).toBeTruthy();
      expect(props.onClose).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1000));
      expect(props.onClose).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("offers Stay open, which cancels the close for good", () => {
      vi.useFakeTimers();
      const props = callbacks();
      renderFinishing(props);
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Stay open" }));
      });
      expect(screen.queryByText(/Set complete/)).toBeNull();
      act(() => vi.advanceTimersByTime(60000));
      expect(props.onClose).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it.each([
      [
        "Reset clean proof",
        {
          kind: "reset_streak",
          rationale: "Pianist chose to restart the clean proof after an error.",
        },
      ],
      [
        "Add 2 recovery cleans",
        {
          kind: "clean_debt",
          clean_count: 2,
          rationale: "Pianist chose two additional recovery cleans.",
        },
      ],
    ])(
      "%s cancels a completion close synchronously at the deadline",
      (buttonName, expectedAction) => {
        vi.useFakeTimers();
        const props = callbacks();
        renderFinishing(props);
        act(() => vi.advanceTimersByTime(5000));
        expect(screen.getByText(/Set complete · closing in 1/)).toBeTruthy();

        act(() => {
          fireEvent.click(screen.getByRole("button", { name: buttonName }));
        });
        expect(props.onRecover).toHaveBeenCalledWith(expectedAction);
        expect(screen.queryByText(/Set complete/)).toBeNull();

        act(() => vi.advanceTimersByTime(1000));
        expect(props.onClose).not.toHaveBeenCalled();
        vi.useRealTimers();
      },
    );

    it("shows no banner for a set that is not satisfied", () => {
      render(
        <RepHud snap={makeSnap()} feed={[]} error={null} {...callbacks()} />,
      );
      expect(screen.queryByText(/Set complete/)).toBeNull();
    });

    it("leaves a set that was already finished when it opened alone", () => {
      // Re-opened from the paused-sets tray. He asked for the set he just
      // finished to close itself, not for one he deliberately re-opened to be
      // taken away from him.
      vi.useFakeTimers();
      const props = callbacks();
      render(<RepHud snap={satisfied()} feed={[]} error={null} {...props} />);
      expect(screen.queryByText(/Set complete/)).toBeNull();
      act(() => vi.advanceTimersByTime(60000));
      expect(props.onClose).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe("A1 demotion moment (display + chime, not a celebration)", () => {
    afterEach(() => vi.useRealTimers());

    function tempoSnap(over: Partial<RepSnapshot> = {}): RepSnapshot {
      return makeSnap({
        bpm: 68,
        start_bpm: 60,
        target_bpm: 260,
        rule: { clean_needed: 1, bpm_step: 4 },
        current_sloppy_streak: 0,
        demoted_this_set: false,
        last: { verdict: "flawed", note: null, bpm: 68 },
        last_attempt_id: 200,
        ...over,
      });
    }

    function fakeAudioFactory() {
      const play = vi.fn().mockResolvedValue(undefined);
      const factory = vi.fn().mockReturnValue({ play });
      return { factory, play };
    }

    it("shows a building sloppy run so a demotion can be seen coming", () => {
      const { container } = render(
        <RepHud
          snap={tempoSnap({ current_sloppy_streak: 2 })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );
      const run = container.querySelector(".rep-hud-sloppy-run");
      expect(run).not.toBeNull();
      expect(run?.textContent).toContain("2 sloppy in a row");
    });

    it("shows nothing once a clean rep has reset the sloppy run", () => {
      const { container } = render(
        <RepHud
          snap={tempoSnap({ current_sloppy_streak: 0 })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );
      expect(container.querySelector(".rep-hud-sloppy-run")).toBeNull();
    });

    it("renders the demotion moment and names the new tempo when bpm decreases", () => {
      vi.useFakeTimers();
      const { factory, play } = fakeAudioFactory();
      const { container, rerender } = render(
        <RepHud
          snap={tempoSnap()}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );
      expect(container.querySelector(".rep-hud-demotion")).toBeNull();

      // Three consecutive Flawed reps just pulled the tempo back one rung:
      // 68 -> 64 (see `three_consecutive_sloppy_reps_pull_the_tempo_back_one_rung`
      // in `rep/mod.rs`).
      act(() => {
        rerender(
          <RepHud
            snap={tempoSnap({
              bpm: 64,
              demoted_this_set: true,
              current_sloppy_streak: 0,
              last: { verdict: "flawed", note: null, bpm: 64 },
              last_attempt_id: 201,
            })}
            feed={[]}
            error={null}
            {...callbacks()}
            audioFactory={factory}
          />,
        );
      });

      expect(container.textContent).toContain("Tempo pulled back to ♩64");
      expect(factory).toHaveBeenCalledWith("/chime.wav");
      expect(play).toHaveBeenCalledTimes(1);

      // Calm, ink-colored — never the celebration/rung-complete styling.
      const moment = container.querySelector(".rep-hud-demotion");
      expect(moment).toBeTruthy();
      expect(container.querySelector(".is-rung-complete")).toBeNull();

      // Holds briefly, then clears.
      act(() => vi.advanceTimersByTime(1200));
      expect(container.querySelector(".rep-hud-demotion")).toBeNull();
    });

    it("does not render on a normal step-up (bpm increasing)", () => {
      vi.useFakeTimers();
      const { factory, play } = fakeAudioFactory();
      const { container, rerender } = render(
        <RepHud
          snap={tempoSnap({
            bpm: 60,
            last: { verdict: "clean", note: null, bpm: 60 },
          })}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );
      act(() => {
        rerender(
          <RepHud
            snap={tempoSnap({
              bpm: 64,
              last: { verdict: "clean", note: null, bpm: 64 },
              last_attempt_id: 201,
            })}
            feed={[]}
            error={null}
            {...callbacks()}
            audioFactory={factory}
          />,
        );
      });
      expect(container.querySelector(".rep-hud-demotion")).toBeNull();
      expect(container.textContent).not.toContain("pulled back");
      expect(play).not.toHaveBeenCalled();
    });

    it("does not render for a manual tempo backoff (only a check outcome counts)", () => {
      vi.useFakeTimers();
      const { factory, play } = fakeAudioFactory();
      const { container, rerender } = render(
        <RepHud
          snap={tempoSnap()}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );
      // A bpm decrease with no accompanying `flawed` check (e.g. the last
      // verdict is still clean/failed) is not an automatic demotion.
      act(() => {
        rerender(
          <RepHud
            snap={tempoSnap({
              bpm: 62,
              last: { verdict: "failed", note: null, bpm: 68 },
              last_attempt_id: 201,
            })}
            feed={[]}
            error={null}
            {...callbacks()}
            audioFactory={factory}
          />,
        );
      });
      expect(container.querySelector(".rep-hud-demotion")).toBeNull();
      expect(play).not.toHaveBeenCalled();
    });

    it("is absent when nothing changed between snapshots", () => {
      vi.useFakeTimers();
      const { factory, play } = fakeAudioFactory();
      const { container, rerender } = render(
        <RepHud
          snap={tempoSnap()}
          feed={[]}
          error={null}
          {...callbacks()}
          audioFactory={factory}
        />,
      );
      expect(container.querySelector(".rep-hud-demotion")).toBeNull();
      // Same bpm, same everything — a re-render carrying no transition at all.
      act(() => {
        rerender(
          <RepHud
            snap={tempoSnap()}
            feed={[]}
            error={null}
            {...callbacks()}
            audioFactory={factory}
          />,
        );
      });
      expect(container.querySelector(".rep-hud-demotion")).toBeNull();
      expect(container.textContent).not.toContain("pulled back");
      expect(play).not.toHaveBeenCalled();
    });

    it("remains visible in a compact HUD (B82 mechanism)", () => {
      vi.useFakeTimers();
      const { factory } = fakeAudioFactory();
      const { container, rerender } = render(
        <RepHud
          snap={tempoSnap()}
          feed={[]}
          error={null}
          collapsed
          {...callbacks()}
          audioFactory={factory}
        />,
      );
      act(() => {
        rerender(
          <RepHud
            snap={tempoSnap({
              bpm: 64,
              demoted_this_set: true,
              current_sloppy_streak: 0,
              last: { verdict: "flawed", note: null, bpm: 64 },
              last_attempt_id: 201,
            })}
            feed={[]}
            error={null}
            collapsed
            {...callbacks()}
            audioFactory={factory}
          />,
        );
      });
      const hud = screen.getByRole("region", { name: "Active practice set" });
      expect(hud.classList.contains("is-collapsed")).toBe(true);
      const moment = container.querySelector(".rep-hud-demotion");
      expect(moment).toBeTruthy();
      expect(moment?.getAttribute("data-compact-visible")).toBe("true");
      expect(container.textContent).toContain("Tempo pulled back to ♩64");
    });

    it("shows an approaching-demotion count that clears once the streak resets", () => {
      const { rerender } = render(
        <RepHud
          snap={tempoSnap({ current_sloppy_streak: 0 })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );
      expect(screen.queryByText(/sloppy in a row/)).toBeNull();

      rerender(
        <RepHud
          snap={tempoSnap({ current_sloppy_streak: 2 })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );
      expect(screen.getByText("2 sloppy in a row")).toBeTruthy();

      rerender(
        <RepHud
          snap={tempoSnap({
            current_sloppy_streak: 0,
            last: { verdict: "clean", note: null, bpm: 68 },
          })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );
      expect(screen.queryByText(/sloppy in a row/)).toBeNull();
    });
  });

  describe("streak-reset pulse (display only)", () => {
    afterEach(() => vi.useRealTimers());

    it("does NOT announce a reset when the broken streak was already zero", () => {
      vi.useFakeTimers();
      const { rerender } = render(
        <RepHud
          snap={makeSnap({
            current_clean_streak: 0,
            reset_count: 2,
            last: { verdict: "flawed", note: null, bpm: 72 },
            last_attempt_id: 200,
          })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );
      // A resetting verdict against an already-zero streak: reset_count ticks up
      // but nothing was lost, so the pulse must stay silent.
      act(() => {
        rerender(
          <RepHud
            snap={makeSnap({
              current_clean_streak: 0,
              reset_count: 3,
              last: { verdict: "failed", note: null, bpm: 72 },
              last_attempt_id: 201,
            })}
            feed={[]}
            error={null}
            {...callbacks()}
          />,
        );
      });
      act(() => vi.advanceTimersByTime(40));
      expect(screen.queryByText(/Streak reset\./)).toBeNull();
      const hud = screen.getByRole("region", { name: "Active practice set" });
      expect(hud.classList.contains("is-reset-pulse")).toBe(false);
    });

    it("still announces a reset when a real streak was broken (control)", () => {
      vi.useFakeTimers();
      const { rerender } = render(
        <RepHud
          snap={makeSnap({
            current_clean_streak: 2,
            reset_count: 2,
            last: { verdict: "clean", note: null, bpm: 72 },
            last_attempt_id: 200,
          })}
          feed={[]}
          error={null}
          {...callbacks()}
        />,
      );
      act(() => {
        rerender(
          <RepHud
            snap={makeSnap({
              current_clean_streak: 0,
              reset_count: 3,
              last: { verdict: "failed", note: null, bpm: 72 },
              last_attempt_id: 201,
            })}
            feed={[]}
            error={null}
            {...callbacks()}
          />,
        );
      });
      act(() => vi.advanceTimersByTime(40));
      expect(screen.getByText(/Streak reset\./)).toBeTruthy();
    });
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

  describe("verdict hotkeys (A6)", () => {
    const hint = /Space = clean · Right-Shift = sloppy · Return = again/;

    it("teaches the mapping on one line in the HUD itself, not in the drawer", async () => {
      render(
        <RepHud snap={makeSnap()} feed={[]} error={null} {...callbacks()} />,
      );
      const line = (await screen.findByText(hint)) as HTMLElement;
      expect(line.textContent).toContain(
        "Space = clean · Right-Shift = sloppy · Return = again",
      );
      // §4b: it must be a DIRECT child of the HUD (the drawer would bury it),
      // and it must survive a compact HUD while it is still teaching.
      expect(line.parentElement?.classList.contains("rep-hud")).toBe(true);
      expect(line.getAttribute("data-compact-visible")).toBe("true");
      expect(document.querySelector(".rep-hud-drawer")!.contains(line)).toBe(
        false,
      );
    });

    it("records each verdict through the same path as the buttons", async () => {
      const props = callbacks();
      render(<RepHud snap={makeSnap()} feed={[]} error={null} {...props} />);
      await screen.findByText(hint);
      fireEvent.keyDown(document.body, { code: "Space", key: " " });
      await waitFor(() =>
        expect(props.onCheck).toHaveBeenCalledWith("clean", null),
      );
    });

    it("does not let the persistent panel record keys from another workspace", async () => {
      const props = callbacks();
      render(
        <RepHud
          snap={makeSnap()}
          feed={[]}
          error={null}
          hotkeysActive={false}
          {...props}
        />,
      );
      await screen.findByText(hint);
      fireEvent.keyDown(document.body, { code: "Space", key: " " });
      fireEvent.keyDown(document.body, { code: "Enter", key: "Enter" });
      expect(props.onCheck).not.toHaveBeenCalled();
    });

    it("carries the typed attempt note exactly as a click would", async () => {
      const props = callbacks();
      render(<RepHud snap={makeSnap()} feed={[]} error={null} {...props} />);
      await screen.findByText(hint);
      fireEvent.change(screen.getByLabelText("Attempt note"), {
        target: { value: "  left hand rushed  " },
      });
      fireEvent.keyDown(document.body, { code: "ShiftRight", key: "Shift" });
      await waitFor(() =>
        expect(props.onCheck).toHaveBeenCalledWith(
          "flawed",
          "left hand rushed",
        ),
      );
    });

    it("does not record while the pianist is typing that note", async () => {
      const props = callbacks();
      render(<RepHud snap={makeSnap()} feed={[]} error={null} {...props} />);
      await screen.findByText(hint);
      const note = screen.getByLabelText("Attempt note");
      fireEvent.keyDown(note, { code: "Space", key: " " });
      fireEvent.keyDown(note, { code: "Enter", key: "Enter" });
      expect(props.onCheck).not.toHaveBeenCalled();
    });

    it("compacts the hint once a hotkey has recorded a rep", async () => {
      const props = callbacks();
      render(<RepHud snap={makeSnap()} feed={[]} error={null} {...props} />);
      expect(await screen.findByText(hint)).toBeTruthy();
      fireEvent.keyDown(document.body, { code: "Enter", key: "Enter" });
      await waitFor(() => expect(screen.queryByText(hint)).toBeNull());
      const compact = document.querySelector(".rep-hud-hotkeys")!;
      expect(compact.textContent).toContain(
        "Keys: Space · Right-Shift · Return",
      );
      // Its compact-mode slot goes back to the controls once it has taught.
      expect(compact.getAttribute("data-compact-visible")).toBeNull();
    });

    it("stays silent once the set is mastered, exactly like the buttons", () => {
      const props = callbacks();
      render(
        <RepHud
          snap={makeSnap({
            mastery_status: "satisfied",
            mastery_verified: true,
          })}
          feed={[]}
          error={null}
          {...props}
        />,
      );
      fireEvent.keyDown(document.body, { code: "Space", key: " " });
      expect(props.onCheck).not.toHaveBeenCalled();
      expect(screen.queryByText(hint)).toBeNull();
    });
  });

  describe("± reps (A7)", () => {
    it("shows both adjustments during a live set without opening the drawer", () => {
      render(
        <RepHud snap={makeSnap()} feed={[]} error={null} {...callbacks()} />,
      );
      const drawer = document.querySelector(".rep-hud-drawer")!;
      for (const name of ["＋ clean", "↩ undo last"]) {
        const control = screen.getByRole("button", { name });
        expect(control).toBeTruthy();
        // §4b: one gesture. Neither control may live inside the "More" drawer.
        expect(drawer.contains(control)).toBe(false);
      }
      // The drawer is genuinely still closed — nothing was expanded to find them.
      expect((drawer as HTMLDetailsElement).open).toBe(false);
    });

    it("carries data-compact-visible so the row survives a compact HUD (B82)", () => {
      render(
        <RepHud
          snap={makeSnap()}
          feed={[]}
          error={null}
          collapsed
          onToggleCollapsed={() => {}}
          {...callbacks()}
        />,
      );
      const hud = screen.getByRole("region", { name: "Active practice set" });
      const row = hud.querySelector(".rep-hud-adjust") as HTMLElement;
      expect(row).toBeTruthy();
      // The CSS hides every DIRECT child of a collapsed HUD that is not
      // context, not main, and not explicitly marked compact-visible — the
      // exact mechanism that rendered the verdict buttons at 0x0 (B82). The
      // row rides inside .rep-hud-main, which the rule exempts, and it carries
      // the mark anyway so promoting it to a top-level row can never regress.
      expect(row.closest(".rep-hud-main")).toBeTruthy();
      expect(row.getAttribute("data-compact-visible")).toBe("true");
      // Belt-and-braces is not the proof. This is: the controls still render
      // with the HUD collapsed, and the drawer is still shut.
      expect(hud.classList.contains("is-collapsed")).toBe(true);
      expect(
        (document.querySelector(".rep-hud-drawer") as HTMLDetailsElement).open,
      ).toBe(false);
      expect(screen.getByRole("button", { name: "＋ clean" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "↩ undo last" })).toBeTruthy();
    });

    it("routes ＋ clean through the same rep_check path as the Clean button", async () => {
      const props = callbacks();
      render(<RepHud snap={makeSnap()} feed={[]} error={null} {...props} />);
      fireEvent.change(screen.getByLabelText("Attempt note"), {
        target: { value: "  count drifted  " },
      });
      fireEvent.click(screen.getByRole("button", { name: "＋ clean" }));
      await waitFor(() =>
        expect(props.onCheck).toHaveBeenCalledWith("clean", "count drifted"),
      );
      expect(props.onCheck).toHaveBeenCalledTimes(1);
    });

    it("routes ↩ undo last through the existing undo path", async () => {
      const props = callbacks();
      render(<RepHud snap={makeSnap()} feed={[]} error={null} {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "↩ undo last" }));
      await waitFor(() => expect(props.onUndo).toHaveBeenCalledTimes(1));
    });

    it("cannot undo an attempt that was never recorded", () => {
      const props = callbacks();
      render(
        <RepHud
          snap={makeSnap({ attempts_recorded: 0, tries: 0, reps_done: 0 })}
          feed={[]}
          error={null}
          {...props}
        />,
      );
      const undo = screen.getByRole("button", { name: "↩ undo last" });
      expect((undo as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(undo);
      expect(props.onUndo).not.toHaveBeenCalled();
    });

    it("stops adding reps to a mastered set, exactly like the verdict buttons", () => {
      const props = callbacks();
      render(
        <RepHud
          snap={makeSnap({
            mastery_status: "satisfied",
            mastery_verified: true,
          })}
          feed={[]}
          error={null}
          {...props}
        />,
      );
      const add = screen.getByRole("button", { name: "＋ clean" });
      expect((add as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(add);
      expect(props.onCheck).not.toHaveBeenCalled();
    });
  });
});
