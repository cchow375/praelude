import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
  | "chain_complete"
  /** An unfinished set left the active workspace: visual exit only, never a reward. */
  | "set_exit"
  | "mastery_landing"
  | "variant_stage"
  | "warmup_routine"
  | "rotation_cycle"
  | "reference_take"
  | "day_close";

/** Small moments stay brief; set and chain finales have a longer musical landing. */
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
    if (next?.variant_chain_complete && !previous.variant_chain_complete)
      return "chain_complete";
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
    // Pausing or closing an unfinished set is a quiet transition, not an
    // earned completion. Keep the existing visual exit receipt without
    // attaching the grand set fanfare.
    return "set_exit";
  }
  return null;
}

/** Reward only a fresh saved attempt; administrative repairs are silent. */
export function useRepCompletion(
  snap: RepSnapshot | null,
  fire: (moment: CompletionMoment) => void,
) {
  const previous = useRef<RepSnapshot | null>(null);
  const highWater = useRef(0);
  useEffect(() => {
    const before = previous.current;
    previous.current = snap;
    if (!before || !snap || before.block_id !== snap.block_id) {
      highWater.current = snap?.last_attempt_id ?? 0;
      if (before && !snap && before.set_state === "active") fire("set_exit");
      return;
    }
    const fresh = (snap.last_attempt_id ?? 0) > highWater.current;
    highWater.current = Math.max(highWater.current, snap.last_attempt_id ?? 0);
    const moment = detectMoment(before, snap);
    if (moment && (moment === "set_exit" || fresh)) fire(moment);
  }, [snap, fire]);
}

/** Fire-and-forget; the overlay removes itself. */
export function useCompletionFx() {
  const [moment, setMoment] = useState<CompletionMoment | null>(null);
  const [sequence, setSequence] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback((next: CompletionMoment) => {
    if (timer.current) clearTimeout(timer.current);
    if (next !== "set_exit") playCompletionSound(next);
    setMoment(next);
    setSequence((value) => value + 1);
    const duration =
      next === "chain_complete"
        ? 2800
        : next === "mastery_landing" || next === "set_complete"
          ? 2200
          : FX_DURATION_MS;
    timer.current = setTimeout(() => setMoment(null), duration);
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
        key={sequence}
        className="completion-fx"
        data-testid="completion-fx"
        data-moment={moment}
        // Decorative, and it must not steal a screen reader's attention from
        // whatever the user is actually doing.
        aria-hidden="true"
      >
        <span className="completion-fx-mark" />
        {moment !== "set_exit" && (
          <>
            <div className="completion-fx-aura" />
            <div className="completion-fx-wave" />
            <div className="completion-fx-wave completion-fx-wave-late" />
            <div className="completion-fx-rays">
              {Array.from(
                { length: moment === "chain_complete" ? 72 : 40 },
                (_, index) => (
                  <i
                    key={index}
                    style={
                      {
                        "--angle": `${index * 137.508}deg`,
                        "--distance": `${110 + (index % 7) * 23}px`,
                        "--delay": `${(index % 6) * 35}ms`,
                        "--size": `${3 + (index % 4) * 2}px`,
                      } as CSSProperties
                    }
                  />
                ),
              )}
            </div>
            <div className="completion-fx-seal">
              <span className="completion-fx-star">✦</span>
              <span className="completion-fx-title">
                {moment === "chain_complete"
                  ? "Chain complete"
                  : moment === "variant_stage"
                    ? "Variation complete"
                    : moment === "mastery_landing" || moment === "set_complete"
                      ? "Set complete"
                      : "Beautiful work"}
              </span>
              <span className="completion-fx-caption">
                {moment === "chain_complete"
                  ? "Every variation. One complete arc."
                  : moment === "variant_stage"
                    ? "Carry it into the next"
                    : moment === "mastery_landing"
                      ? "You built this, rep by rep"
                      : moment === "set_complete"
                        ? "Your play target, reached"
                        : "A moment worth keeping"}
              </span>
            </div>
          </>
        )}
      </div>
    ) : null,
  };
}
