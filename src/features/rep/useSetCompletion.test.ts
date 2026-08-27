import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SET_COMPLETION_SECONDS,
  useSetCompletion,
  type SetCompletionSnapshot,
} from "./useSetCompletion";

/**
 * B2 — "it should close after a few seconds and move on (not just close
 * instantaneously)". These pin both halves of that sentence: it DOES close,
 * and it does NOT close instantly or behind his back.
 */

function snap(
  over: Partial<SetCompletionSnapshot> = {},
): SetCompletionSnapshot {
  return {
    block_id: 11,
    mastery_status: "satisfied",
    last_attempt_id: 42,
    timer_state: "running",
    set_state: "active",
    ...over,
  };
}

type Props = { s: SetCompletionSnapshot | null };

/**
 * Render the hook the way a set really finishes: watched while unfinished,
 * then satisfied. Starting from an already-satisfied snapshot would be the
 * re-opened-from-the-tray case, which deliberately does NOT count down — so
 * every test about the countdown has to go through the transition to be
 * testing the thing it says it is.
 */
function renderFinishing(
  onClose: () => void,
  over: Partial<SetCompletionSnapshot> = {},
) {
  const view = renderHook(
    ({ s }: Props) => useSetCompletion(s, onClose),
    {
      initialProps: {
        s: snap({ ...over, mastery_status: "not_satisfied" }),
      } as Props,
    },
  );
  act(() => view.rerender({ s: snap(over) }));
  return view;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function advance(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

describe("useSetCompletion", () => {
  it("closes the set once, after six seconds — not instantly", () => {
    const onClose = vi.fn();
    const { result } = renderFinishing(onClose);

    expect(result.current.secondsLeft).toBe(SET_COMPLETION_SECONDS);
    expect(onClose).not.toHaveBeenCalled();

    advance(5);
    expect(result.current.secondsLeft).toBe(1);
    expect(onClose, "still open at five seconds").not.toHaveBeenCalled();

    advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.secondsLeft).toBeNull();

    // And it stays closed exactly once, however long the HUD lingers.
    advance(30);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not count down while the set is unsatisfied", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useSetCompletion(snap({ mastery_status: "not_satisfied" }), onClose),
    );
    expect(result.current.secondsLeft).toBeNull();
    advance(30);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("starts counting on the transition into satisfied", () => {
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ status }: { status: string }) =>
        useSetCompletion(snap({ mastery_status: status }), onClose),
      { initialProps: { status: "not_satisfied" } },
    );
    expect(result.current.secondsLeft).toBeNull();
    rerender({ status: "satisfied" });
    expect(result.current.secondsLeft).toBe(SET_COMPLETION_SECONDS);
    advance(6);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves a set that was ALREADY finished when it first saw it alone", () => {
    // Re-opened from the paused-sets tray, or still on screen after a
    // relaunch. He went and opened this deliberately; closing it out from
    // under him would be a new annoyance wearing the costume of a fix.
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ s }: Props) => useSetCompletion(s, onClose),
      { initialProps: { s: snap() } as Props },
    );
    expect(result.current.secondsLeft).toBeNull();
    advance(60);
    expect(onClose).not.toHaveBeenCalled();
    // Still nothing, however many times it re-renders.
    act(() => rerender({ s: snap() }));
    advance(60);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still arms that set if he plays it back down and finishes it again", () => {
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ s }: Props) => useSetCompletion(s, onClose),
      { initialProps: { s: snap() } as Props },
    );
    expect(result.current.secondsLeft).toBeNull();
    // He adds a variant / narrows the range, so it is unfinished again…
    act(() => rerender({ s: snap({ mastery_status: "not_satisfied" }) }));
    // …and then finishes it in front of us. That IS the just-finished case.
    act(() => rerender({ s: snap() }));
    expect(result.current.secondsLeft).toBe(SET_COMPLETION_SECONDS);
    advance(6);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancel() stops it permanently for that set", () => {
    const onClose = vi.fn();
    const { result, rerender } = renderFinishing(onClose);
    expect(result.current.secondsLeft).toBe(SET_COMPLETION_SECONDS);
    advance(2);
    act(() => result.current.cancel());
    expect(result.current.secondsLeft).toBeNull();
    advance(60);
    expect(onClose).not.toHaveBeenCalled();
    // Re-rendering the same still-satisfied set must not re-arm it.
    act(() => rerender({ s: snap() }));
    advance(60);
    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.secondsLeft).toBeNull();
  });

  it("a new attempt landing cancels the countdown", () => {
    const onClose = vi.fn();
    const { result, rerender } = renderFinishing(onClose);
    expect(result.current.secondsLeft).toBe(SET_COMPLETION_SECONDS);
    advance(3);
    act(() => rerender({ s: snap({ last_attempt_id: 43 }) }));
    expect(result.current.secondsLeft).toBeNull();
    advance(60);
    expect(
      onClose,
      "he is still playing — do not close on him",
    ).not.toHaveBeenCalled();
  });

  it("pausing the set cancels the countdown", () => {
    const onClose = vi.fn();
    const { result, rerender } = renderFinishing(onClose);
    expect(result.current.secondsLeft).toBe(SET_COMPLETION_SECONDS);
    advance(2);
    act(() => rerender({ s: snap({ timer_state: "paused" }) }));
    expect(result.current.secondsLeft).toBeNull();
    advance(60);
    expect(onClose).not.toHaveBeenCalled();
    act(() => rerender({ s: snap({ timer_state: "running" }) }));
    advance(60);
    expect(onClose, "a paused set stays cancelled").not.toHaveBeenCalled();
  });

  it("treats a paused set_state the same as a paused timer", () => {
    const onClose = vi.fn();
    const { result } = renderFinishing(onClose, { set_state: "paused" });
    expect(result.current.secondsLeft).toBeNull();
    advance(60);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("never fires twice for one block_id, even if the set re-appears", () => {
    const onClose = vi.fn();
    const { rerender } = renderFinishing(onClose);
    advance(6);
    expect(onClose).toHaveBeenCalledTimes(1);
    // The close is async; the same snapshot can arrive again before it lands.
    act(() => rerender({ s: null }));
    act(() => rerender({ s: snap() }));
    advance(60);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("arms independently for the next set", () => {
    const onClose = vi.fn();
    const { rerender } = renderFinishing(onClose);
    advance(6);
    expect(onClose).toHaveBeenCalledTimes(1);
    // The next set arrives and is finished in front of us in its turn.
    act(() =>
      rerender({
        s: snap({ block_id: 12, mastery_status: "not_satisfied" }),
      }),
    );
    act(() => rerender({ s: snap({ block_id: 12 }) }));
    advance(6);
    expect(
      onClose,
      "the NEXT set gets its own countdown",
    ).toHaveBeenCalledTimes(2);
  });

  it("does nothing at all with no active set", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSetCompletion(null, onClose));
    expect(result.current.secondsLeft).toBeNull();
    act(() => result.current.cancel());
    advance(60);
    expect(onClose).not.toHaveBeenCalled();
  });
});
