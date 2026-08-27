import { useCallback, useEffect, useRef, useState } from "react";

/**
 * B2 — a finished set must finish itself.
 *
 * Christian: *"when i hit 5 out of 5 it just stays at 5/5 and i have to close
 * the set, manually X the one i just did and move onto the next variation it
 * doesnt do it automatically … it should close after a few seconds and move on
 * (not just close instantaneously)."*
 *
 * Before this hook nothing in the app ever closed a set: `rep_close` was only
 * ever reached from the HUD's Close button. So a mastered set sat on screen at
 * 5/5 until he dismissed it by hand — every single time.
 *
 * The parenthesis is a requirement, not an aside: **not instantaneous**. The
 * set holds for six seconds with a visible countdown and a "Stay open" escape,
 * so the completion is legible and always overridable. Auto-closing on the
 * same tick as the last clean would steal the receipt he just earned.
 */
export const SET_COMPLETION_SECONDS = 6;

/** The slice of the snapshot this hook reads — nothing else. */
export interface SetCompletionSnapshot {
  block_id: number;
  mastery_status?: string;
  last_attempt_id?: number | null;
  timer_state?: string;
  set_state?: string;
}

export interface SetCompletion {
  /** Whole seconds remaining, or null when no countdown is running. */
  secondsLeft: number | null;
  /** Stop the countdown permanently for THIS set ("Stay open"). */
  cancel: () => void;
}

interface Armed {
  blockId: number;
  attemptId: number | null;
}

/**
 * Counts a satisfied set down to its close.
 *
 * Everything that stops it is keyed on `block_id`, so a set that was cancelled
 * (or that already closed itself) can never be re-armed by a later re-render,
 * and `onClose` fires **at most once per set**.
 *
 * A running countdown is cancelled permanently by:
 *   - `cancel()` — the "Stay open" button;
 *   - a new attempt landing (`last_attempt_id` changed): he is still playing,
 *     so the app has no business closing anything;
 *   - the set being paused.
 * It simply does not run while the set is unsatisfied, paused, or gone — nor
 * for a set that was ALREADY satisfied the first time this hook saw it, which
 * is the re-opened-from-the-tray case rather than the just-finished one.
 */
export function useSetCompletion(
  snap: SetCompletionSnapshot | null,
  onClose: () => void,
  seconds: number = SET_COMPLETION_SECONDS,
): SetCompletion {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const cancelledRef = useRef<Set<number>>(new Set());
  const firedRef = useRef<Set<number>>(new Set());
  // Sets this hook has actually watched go from unfinished to finished. The
  // countdown is for the set he JUST finished, so a set that was already
  // satisfied the first time we saw it — re-opened from the paused-sets tray,
  // or still on screen after a relaunch — is left alone. Closing something he
  // deliberately went and re-opened would be a new annoyance wearing the
  // costume of a fix.
  const sawUnfinishedRef = useRef<Set<number>>(new Set());
  const armedRef = useRef<Armed | null>(null);
  // The live interval, so `cancel()` can kill it without waiting for the
  // effect to re-run — its dependencies do not change when he clicks
  // "Stay open", so nothing else would ever stop the ticking.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The callback is read at fire time, so a fresh `onClose` identity on every
  // render cannot restart the countdown.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const blockId = snap?.block_id ?? null;
  const satisfied = snap?.mastery_status === "satisfied";
  const paused = snap?.timer_state === "paused" || snap?.set_state === "paused";
  const attemptId = snap?.last_attempt_id ?? null;

  const cancel = useCallback(() => {
    if (blockId != null) cancelledRef.current.add(blockId);
    if (tickRef.current != null) clearInterval(tickRef.current);
    tickRef.current = null;
    armedRef.current = null;
    setSecondsLeft(null);
  }, [blockId]);

  useEffect(() => {
    // A previously armed countdown for THIS set, interrupted by a new attempt
    // or by a pause, is over for good.
    const armed = armedRef.current;
    if (
      armed &&
      armed.blockId === blockId &&
      (armed.attemptId !== attemptId || paused)
    ) {
      cancelledRef.current.add(armed.blockId);
      armedRef.current = null;
    }

    if (blockId != null && !satisfied) sawUnfinishedRef.current.add(blockId);

    if (
      blockId == null ||
      !satisfied ||
      paused ||
      !sawUnfinishedRef.current.has(blockId) ||
      cancelledRef.current.has(blockId) ||
      firedRef.current.has(blockId)
    ) {
      armedRef.current = null;
      setSecondsLeft(null);
      return;
    }

    // Arm (or re-arm). Deliberately unconditional: React.StrictMode replays
    // mount effects, and an "already counting" guard here would swallow the
    // replay's re-arm after the cleanup had already killed the first interval,
    // leaving a set that says "closing in 6…" forever.
    armedRef.current = { blockId, attemptId };
    setSecondsLeft(seconds);
    let remaining = seconds;
    const tick = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setSecondsLeft(remaining);
        return;
      }
      clearInterval(tick);
      tickRef.current = null;
      armedRef.current = null;
      setSecondsLeft(null);
      if (firedRef.current.has(blockId)) return;
      firedRef.current.add(blockId);
      onCloseRef.current();
    }, 1000);
    tickRef.current = tick;
    return () => {
      clearInterval(tick);
      if (tickRef.current === tick) tickRef.current = null;
    };
  }, [blockId, satisfied, paused, attemptId, seconds]);

  return { secondsLeft, cancel };
}
