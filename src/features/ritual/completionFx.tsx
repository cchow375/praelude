import { useCallback, useEffect, useRef, useState } from "react";
import type { RepSnapshot } from "../rep/useRep";
import "./completionFx.css";

/**
 * The three completion moments (spec A4): set complete, mastery landing, day
 * close. One module, one overlay, three data-moment variants.
 *
 * Rules this module keeps:
 *   - CSS-only. No animation-frame loop, no randomised timing, no timeline
 *     library. The only JS timer is the one that unmounts the overlay.
 *   - pointer-events: none, and it removes itself. It can never sit on top of
 *     something he is trying to press.
 *   - No new audio path. The existing ack policy already covers these moments
 *     (Confirm::chime for routine confirmations, Confirm::say when there is
 *     something to say); this layer is purely visual.
 *   - Deterministic: the same transition always produces the same flourish.
 */

export type CompletionMoment = "set_complete" | "mastery_landing" | "day_close";

/** Long enough to read as a flourish, comfortably under the 1.5s ceiling. */
const FX_DURATION_MS = 1_100;

function satisfied(snapshot: RepSnapshot | null): boolean {
  return snapshot?.mastery_status === "satisfied";
}

/**
 * Which moment (if any) a rep-snapshot transition just crossed. PURE: two
 * snapshots in, at most one moment out. This is the whole detection layer —
 * there is no separate event, no new command and no new audio path.
 */
export function detectMoment(
  previous: RepSnapshot | null,
  next: RepSnapshot | null,
): CompletionMoment | null {
  if (!previous) return null;
  // A different set replacing this one is a switch, not a completion.
  if (next && next.block_id !== previous.block_id) return null;
  // Mastery outranks set-completion: you land mastery once, and that is the
  // moment worth marking.
  if (
    !satisfied(previous) &&
    (satisfied(next) || next?.set_state === "mastered")
  ) {
    return "mastery_landing";
  }
  if (previous.set_state === "active" && next?.set_state !== "active") {
    return "set_complete";
  }
  return null;
}

/** Fire-and-forget; the overlay removes itself. */
export function useCompletionFx() {
  const [moment, setMoment] = useState<CompletionMoment | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback((next: CompletionMoment) => {
    if (timer.current) clearTimeout(timer.current);
    setMoment(next);
    timer.current = setTimeout(() => setMoment(null), FX_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return {
    fire,
    overlay: moment ? (
      <div
        className="completion-fx"
        data-testid="completion-fx"
        data-moment={moment}
        // Decorative, and it must not steal a screen reader's attention from
        // whatever the user is actually doing.
        aria-hidden="true"
      >
        <span className="completion-fx-mark" />
      </div>
    ) : null,
  };
}
