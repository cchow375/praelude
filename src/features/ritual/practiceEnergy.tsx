import { useEffect, useRef, useState, type CSSProperties } from "react";
import { repTries, type RepSnapshot, type Verdict } from "../rep/useRep";
import { playRepFeedback } from "./completionSound";
import { detectMoment } from "./completionFx";
import "./practiceEnergy.css";

export interface EnergyPulse {
  id: number;
  verdict: Verdict;
  progress: number;
  setbackCount: number;
}

/** Same working contract as the HUD: volume, variant stage, tempo rung, target. */
export function practiceProgress(snap: RepSnapshot): number {
  if (snap.mastery_status === "satisfied") return 1;
  let value = snap.current_clean_streak ?? 0;
  let required =
    snap.effective_required_clean_streak ?? snap.required_clean_streak ?? 0;
  if (snap.mastery_basis === "total_attempts") {
    value = repTries(snap);
    required = snap.attempt_target ?? snap.required_clean_streak ?? 0;
  } else if (snap.variant_stage_index != null && !snap.variant_chain_complete) {
    value = snap.variant_stage_cleans ?? 0;
    required = snap.variant_stage_required ?? 0;
  } else if (snap.focus === "tempo" && snap.target_bpm != null) {
    if (snap.bpm != null && snap.bpm < snap.target_bpm)
      required = snap.rule.clean_needed;
    else value = snap.mastery_progress_streak ?? value;
  }
  return required > 0 ? Math.max(0, Math.min(1, value / required)) : 0;
}

/** Committed attempt edges only. Polls, undo, corrections and remounts are silent. */
export function usePracticeEnergy(snap: RepSnapshot | null) {
  const previous = useRef<RepSnapshot | null | undefined>(undefined);
  const highWater = useRef(0);
  const setbacks = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pulse, setPulse] = useState<EnergyPulse | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = snap;
    if (!before || !snap || before.block_id !== snap.block_id) {
      highWater.current = snap?.last_attempt_id ?? 0;
      setbacks.current = 0;
      setPulse(null);
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    const id = snap.last_attempt_id ?? 0;
    if (id <= highWater.current) return;
    highWater.current = id;
    const verdict = snap.last?.verdict;
    if (verdict !== "clean" && verdict !== "flawed" && verdict !== "failed")
      return;
    setbacks.current =
      verdict === "clean" ? 0 : Math.min(3, setbacks.current + 1);
    const advanced =
      (snap.variant_stage_index ?? 0) > (before.variant_stage_index ?? 0) ||
      (snap.focus === "tempo" &&
        snap.bpm != null &&
        before.bpm != null &&
        snap.bpm > before.bpm);
    const progress =
      verdict === "clean" && advanced ? 1 : practiceProgress(snap);
    const next: EnergyPulse = {
      id,
      verdict,
      progress,
      setbackCount: setbacks.current,
    };
    // Shell owns milestone audio, so the final clean cannot double the fanfare.
    const moment = detectMoment(before, snap);
    if (!moment || moment === "set_exit") playRepFeedback(verdict, next);
    setPulse(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPulse(null), 1400);
  }, [snap]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return pulse;
}

/** Decorative companion to the existing accessible count; never consumes input. */
export function PracticeEnergy({
  progress,
  pulse,
  complete,
  paused = false,
}: {
  progress: number;
  pulse: EnergyPulse | null;
  complete: boolean;
  paused?: boolean;
}) {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const setback = pulse != null && pulse.verdict !== "clean";
  const level = Math.min(4, Math.ceil(p * 4));
  return (
    <div
      className="practice-energy"
      aria-hidden="true"
      data-testid="practice-energy"
      data-level={level}
      data-complete={complete}
      data-paused={paused}
      data-setback={setback ? pulse.setbackCount : 0}
      style={
        {
          "--charge": p,
          "--energy-hue": complete ? 42 : 175 + p * 95,
        } as CSSProperties
      }
    >
      <svg className="practice-energy-gauge" viewBox="0 0 120 120">
        <circle className="energy-track" cx="60" cy="60" r="49" />
        <circle
          className="energy-fill"
          cx="60"
          cy="60"
          r="49"
          pathLength="1"
          strokeDasharray={`${p} 1`}
        />
        {Array.from({ length: 12 }, (_, i) => (
          <path
            key={i}
            className="energy-tick"
            d="M60 3v5"
            transform={`rotate(${i * 30} 60 60)`}
            opacity={i < Math.ceil(p * 12) ? 1 : 0.12}
          />
        ))}
      </svg>
      <div className="energy-orbit energy-orbit-one" />
      <div className="energy-orbit energy-orbit-two" />
      <div className="energy-core">
        <span>✦</span>
      </div>
      {pulse && (
        <div
          key={pulse.id}
          className="energy-impact"
          data-verdict={pulse.verdict}
        >
          <span className="energy-wave" />
          {Array.from(
            { length: setback ? 10 : 10 + Math.ceil(pulse.progress * 22) },
            (_, i) => (
              <i
                key={i}
                style={
                  {
                    "--angle": `${i * 137.508}deg`,
                    "--reach": `${42 + (i % 5) * 9 + pulse.progress * 25}px`,
                    "--delay": `${(i % 4) * 30}ms`,
                  } as CSSProperties
                }
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
