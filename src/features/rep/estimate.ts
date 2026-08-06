// Task A10: set time estimates. A PURE function over an optional one-pass
// duration and a tempo ladder — no IPC, no store, no clock. The Session
// Composer surface shows the result beside the optional "one pass ≈ [N] sec"
// field; the day sheet's BlockLine minutes (when a set is planned from the
// sheet) use `ceil(highSeconds / 60)`.
//
// Model: one pass through a rung at `rung.bpm` scales linearly against the
// pianist's entry tempo — a rung slower than entry takes proportionally
// LONGER per pass (entryBpm / rung.bpm > 1), a rung at or above entry takes
// proportionally less or the same. Each rep also carries a flat 3-second
// reset allowance (resetting hands/position between passes). `low` is that
// straight-through total; `high` allows for retries at 1.5x.

export interface LadderRung {
  readonly bpm: number;
  readonly reps: number;
}

export interface SetSecondsEstimate {
  readonly lowSeconds: number;
  readonly highSeconds: number;
}

const RESET_SECONDS_PER_REP = 3;
const RETRY_MULTIPLIER = 1.5;

export function estimateSetSeconds(
  passSeconds: number,
  ladder: readonly LadderRung[],
  entryBpm: number,
): SetSecondsEstimate {
  let lowSeconds = 0;
  for (const rung of ladder) {
    lowSeconds += rung.reps * passSeconds * (entryBpm / rung.bpm);
    lowSeconds += rung.reps * RESET_SECONDS_PER_REP;
  }
  return { lowSeconds, highSeconds: lowSeconds * RETRY_MULTIPLIER };
}

/** "≈ X–Y min", both bounds rounded UP to whole minutes (never "≈ 0–0 min"
 *  for a positive estimate — a sub-minute low still reads as "≈ 1"). */
export function formatSetEstimate(estimate: SetSecondsEstimate): string {
  const low = Math.ceil(estimate.lowSeconds / 60);
  const high = Math.ceil(estimate.highSeconds / 60);
  return `≈ ${low}–${high} min`;
}

/**
 * A client-side ladder preview for the live estimate, built from the same
 * start/target/step/reps-per-rung fields the block-open form already
 * collects. Not the backend's authoritative auto-ladder resolution (that
 * still happens server-side in `rep_open`) — a best-effort mirror so the
 * pianist sees a live number while composing the set, capped so a tiny or
 * zero step can never loop unbounded.
 */
export function buildLadderPreview(
  startBpm: number,
  targetBpm: number | null,
  bpmStep: number,
  repsPerRung: number,
): LadderRung[] {
  if (!Number.isFinite(startBpm) || startBpm <= 0 || repsPerRung <= 0) {
    return [];
  }
  if (
    targetBpm == null ||
    !Number.isFinite(targetBpm) ||
    targetBpm <= startBpm
  ) {
    return [{ bpm: startBpm, reps: repsPerRung }];
  }
  const step = Number.isFinite(bpmStep) && bpmStep > 0 ? bpmStep : 4;
  const MAX_RUNGS = 50;
  const rungs: LadderRung[] = [];
  let bpm = startBpm;
  while (bpm < targetBpm && rungs.length < MAX_RUNGS) {
    rungs.push({ bpm, reps: repsPerRung });
    bpm += step;
  }
  rungs.push({ bpm: targetBpm, reps: repsPerRung });
  return rungs;
}
