import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepSnapshot } from "../rep/useRep";
import { practiceProgress, usePracticeEnergy } from "./practiceEnergy";
import { playRepFeedback } from "./completionSound";
vi.mock("./completionSound", () => ({ playRepFeedback: vi.fn() }));
const base = {
  block_id: 1,
  last_attempt_id: null,
  last: null,
  set_state: "active",
  mastery_status: "not_satisfied",
  current_clean_streak: 0,
  required_clean_streak: 5,
  focus: "accuracy",
  rule: { clean_needed: 3, bpm_step: 2 },
} as RepSnapshot;
const attempt = (
  id: number,
  verdict = "clean",
  over: Partial<RepSnapshot> = {},
): RepSnapshot => ({
  ...base,
  last_attempt_id: id,
  last: { verdict, bpm: null, note: null },
  current_clean_streak: verdict === "clean" ? id : 0,
  ...over,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("practice energy", () => {
  it("uses the working goal for streak, stage, rung, target and volume", () => {
    expect(practiceProgress(attempt(3))).toBe(0.6);
    expect(
      practiceProgress(
        attempt(3, "clean", {
          variant_stage_index: 1,
          variant_stage_cleans: 1,
          variant_stage_required: 3,
        }),
      ),
    ).toBeCloseTo(1 / 3);
    expect(
      practiceProgress(
        attempt(2, "clean", { focus: "tempo", bpm: 60, target_bpm: 80 }),
      ),
    ).toBeCloseTo(2 / 3);
    expect(
      practiceProgress(
        attempt(3, "clean", {
          focus: "tempo",
          bpm: 80,
          target_bpm: 80,
          mastery_progress_streak: 1,
        }),
      ),
    ).toBe(0.2);
    expect(
      practiceProgress(
        attempt(3, "failed", {
          mastery_basis: "total_attempts",
          tries: 3,
          attempt_target: 5,
        }),
      ),
    ).toBe(0.6);
  });
  it("seeds silently, rewards only new commits, does not replay on undo/redo/correction", () => {
    const { rerender, result } = renderHook(
      ({ snap }) => usePracticeEnergy(snap),
      { initialProps: { snap: attempt(1) } },
    );
    expect(playRepFeedback).not.toHaveBeenCalled();
    rerender({ snap: attempt(2) });
    expect(result.current?.progress).toBe(0.4);
    rerender({ snap: { ...attempt(2) } });
    rerender({ snap: attempt(1) });
    rerender({ snap: attempt(2, "failed", { last_adjustment_id: 10 }) });
    expect(playRepFeedback).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current).toBeNull();
  });
  it("escalates successive setbacks to a bounded third level and resets on clean", () => {
    const { rerender, result } = renderHook(
      ({ snap }) => usePracticeEnergy(snap),
      { initialProps: { snap: base } },
    );
    for (let i = 1; i <= 4; i++) {
      rerender({ snap: attempt(i, i % 2 ? "failed" : "flawed") });
      expect(result.current?.setbackCount).toBe(Math.min(3, i));
    }
    rerender({ snap: attempt(5) });
    expect(result.current?.setbackCount).toBe(0);
    rerender({ snap: { ...base, block_id: 2 } });
    expect(result.current).toBeNull();
    rerender({ snap: attempt(8, "failed", { block_id: 2 }) });
    expect(result.current?.setbackCount).toBe(1);
  });
  it("holds filled energy on clean advancement and leaves milestone audio to Shell", () => {
    const { rerender, result } = renderHook(
      ({ snap }) => usePracticeEnergy(snap),
      {
        initialProps: { snap: attempt(2, "clean", { variant_stage_index: 0 }) },
      },
    );
    rerender({
      snap: attempt(3, "clean", {
        variant_stage_index: 1,
        variant_stage_cleans: 0,
        variant_stage_required: 3,
      }),
    });
    expect(result.current?.progress).toBe(1);
    expect(playRepFeedback).not.toHaveBeenCalled();
    rerender({
      snap: attempt(4, "clean", {
        mastery_status: "satisfied",
        variant_chain_complete: true,
      }),
    });
    expect(playRepFeedback).not.toHaveBeenCalled();
  });
  it("does not cancel its expiry on timer polls and clears on unmount", () => {
    const { rerender, result, unmount } = renderHook(
      ({ snap }) => usePracticeEnergy(snap),
      { initialProps: { snap: base } },
    );
    rerender({ snap: attempt(1) });
    act(() => vi.advanceTimersByTime(800));
    rerender({ snap: { ...attempt(1), active_seconds: 4 } });
    act(() => vi.advanceTimersByTime(700));
    expect(result.current).toBeNull();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
