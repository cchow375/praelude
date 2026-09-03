import { useCallback, useEffect, useRef, useState } from "react";
import type { RepSnapshot } from "../rep/useRep";
import { playCompletionSound } from "./completionSound";
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
 *   - A small local sound palette mirrors the visual hierarchy. It is entirely
 *     best-effort and never participates in the practice write path.
 *   - Deterministic: the same transition always produces the same flourish.
 */

export type CompletionMoment =
  | "set_complete"
  | "mastery_landing"
  | "variant_stage"
  | "warmup_routine"
  | "rotation_cycle"
  | "reference_take"
  | "day_close";

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
  // Genuine mastery outranks set-completion: you land mastery once, and that
  // is the moment worth marking. The backend's historical status vocabulary
  // also uses `satisfied` for a total-attempt volume target, so its immutable
  // basis must route that edge to ordinary set completion instead.
  // mastery_status is otherwise the ONLY authoritative signal
  // here — set_state === "mastered" is a real, intentional, non-satisfied
  // state (a mastered set keeps its terminal lineage even when a repaired
  // ledger would cease to satisfy mastery; store/practice_v2.rs:1329-1332,
  // rep/mod.rs:4614). Firing on set_state alone, without edge detection,
  // used to re-fire a full celebration on every identical rep_state poll —
  // exactly the earned-only violation ("a visual may never cite a field
  // whose value is zero/false") that got the galaxy refuted. Edge-detected
  // on mastery_status alone: fires only the instant it flips to satisfied.
  if (!satisfied(previous) && satisfied(next)) {
    if (next?.mastery_basis === "total_attempts") return "set_complete";
    return "mastery_landing";
  }
  if (
    next != null &&
    !next.variant_chain_complete &&
    previous.variant_stage_index != null &&
    next.variant_stage_index != null &&
    next.variant_stage_index > previous.variant_stage_index
  ) {
    return "variant_stage";
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
    playCompletionSound(next);
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
