import { blockState, daysSince } from "./repertoire";
import type { RegionSignal, UniversePiece, UniverseSnapshot } from "./types";

const CONSISTENCY_LANDMARKS = [7, 14, 21, 28] as const;
const RECENT_WINDOW_DAYS = 14;

function count(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;
}

export interface EvidenceRatio {
  value: number;
  total: number;
  /** A bounded rendering aid. The exact numerator/denominator remain visible. */
  percent: number;
}

export function evidenceRatio(
  value: number | null | undefined,
  total: number | null | undefined,
): EvidenceRatio {
  const safeValue = count(value);
  const safeTotal = count(total);
  return {
    value: safeValue,
    total: safeTotal,
    percent:
      safeTotal === 0
        ? 0
        : Math.round(Math.min(1, safeValue / safeTotal) * 100),
  };
}

export interface UniverseProgress {
  focusedSeconds: number;
  activeDays: EvidenceRatio;
  currentStreak: number;
  practiceSessions: number;
  coverage: EvidenceRatio;
  revisited: EvidenceRatio;
  mastery: EvidenceRatio;
  recovered: number;
  recoveryDebt: number;
}

/**
 * The small set of numbers that makes the practice record legible at a glance.
 * Every value is either carried by the read model or summed from its current
 * Piece/Region graph. These current-state ratios remain separate from the
 * transparent all-history Practice XP and badges rendered by the game layer.
 */
export function deriveUniverseProgress(
  snapshot: UniverseSnapshot,
  streak: { current_days: number } | null,
): UniverseProgress {
  // Coverage is about repertoire Christian can practise now. Archived pieces
  // remain visible as dim history and still feed all-history XP/badges, but
  // they cannot dilute or inflate these current repertoire rails.
  const activePieces = snapshot.pieces.filter(
    (piece) => piece.archived_at == null,
  );
  const totalTargets = activePieces.reduce(
    (sum, piece) => sum + count(piece.regions_total),
    0,
  );
  const practiced = activePieces.reduce(
    (sum, piece) => sum + count(piece.regions_practiced),
    0,
  );
  const revisited = activePieces.reduce(
    (sum, piece) => sum + count(piece.regions_revisited),
    0,
  );
  const mastered = activePieces.reduce(
    (sum, piece) =>
      sum +
      (piece.mastered_targets == null
        ? piece.region_signals.filter(
            (region) => count(region.mastery_contracts_completed) > 0,
          ).length
        : count(piece.mastered_targets)),
    0,
  );
  const recovered = activePieces.reduce(
    (sum, piece) =>
      sum +
      (piece.recovered_targets == null
        ? piece.region_signals.filter((region) => region.recovered).length
        : count(piece.recovered_targets)),
    0,
  );

  return {
    focusedSeconds: count(snapshot.totals.focused_seconds),
    activeDays: evidenceRatio(snapshot.totals.active_days_28, 28),
    currentStreak: count(streak?.current_days),
    practiceSessions: count(snapshot.totals.practice_sessions),
    coverage: evidenceRatio(practiced, totalTargets),
    revisited: evidenceRatio(revisited, practiced),
    mastery: evidenceRatio(mastered, totalTargets),
    recovered,
    recoveryDebt: activePieces.reduce(
      (sum, piece) => sum + count(piece.open_recovery_debt),
      0,
    ),
  };
}

export interface MomentumCopy {
  title: string;
  detail: string;
}

/** Calm, deterministic language. It describes evidence; it never grades it. */
export function momentumCopy(progress: UniverseProgress): MomentumCopy {
  if (progress.focusedSeconds === 0) {
    return {
      title: "Ready for the first mark.",
      detail:
        "The page will change only after focused practice is recorded. Nothing fills itself in for show.",
    };
  }
  if (progress.currentStreak >= 7) {
    return {
      title: `${progress.currentStreak} days in motion.`,
      detail:
        "That streak comes from qualifying focused days, with every target state grounded in your own verdicts.",
    };
  }
  if (progress.currentStreak >= 3) {
    return {
      title: "Momentum is holding.",
      detail: `${progress.currentStreak} consecutive qualifying days are visible in the record.`,
    };
  }
  if (progress.activeDays.value >= 7) {
    return {
      title: "A practice rhythm is visible.",
      detail: `${progress.activeDays.value} active days are recorded in the current 28-day window.`,
    };
  }
  if (progress.mastery.value > 0) {
    return {
      title: "The work has proof behind it.",
      detail: `${progress.mastery.value} ${progress.mastery.value === 1 ? "target has" : "targets have"} satisfied a verified clean contract.`,
    };
  }
  return {
    title: "The record is taking shape.",
    detail: `${progress.activeDays.value} ${progress.activeDays.value === 1 ? "active day is" : "active days are"} visible in the current 28-day window.`,
  };
}

export interface RecentEvidence {
  pieceId: number;
  pieceTitle: string;
  regionId: number;
  regionName: string;
  region: RegionSignal;
  lastPracticed: string;
  days: number;
}

/**
 * Current earned state for the targets touched most recently. This deliberately
 * does not call a state change a "gain": the snapshot knows the latest touch
 * and the current state, but not the exact event on which mastery was earned.
 */
export function recentEvidence(
  pieces: readonly UniversePiece[],
  reference: string | null | undefined,
  limit = 4,
): RecentEvidence[] {
  if (limit <= 0) return [];
  const rows: RecentEvidence[] = [];
  for (const piece of pieces) {
    for (const region of piece.region_signals) {
      if (!region.practiced || !region.last_practiced) continue;
      const days = daysSince(region.last_practiced, reference);
      if (days == null || days > RECENT_WINDOW_DAYS) continue;
      rows.push({
        pieceId: piece.piece_id,
        pieceTitle: piece.title,
        regionId: region.region_id,
        regionName: region.name,
        region,
        lastPracticed: region.last_practiced,
        days,
      });
    }
  }
  return rows
    .sort(
      (left, right) =>
        Date.parse(right.lastPracticed) - Date.parse(left.lastPracticed) ||
        compareText(left.pieceTitle, right.pieceTitle) ||
        compareText(left.regionName, right.regionName) ||
        left.regionId - right.regionId,
    )
    .slice(0, limit);
}

export type LandmarkKind = "recovery" | "consistency" | "mastery" | "coverage";

export interface PracticeLandmark {
  kind: LandmarkKind;
  title: string;
  detail: string;
  pieceId: number | null;
  regionId: number | null;
}

function mostRecentFirst(
  left: { last_practiced: string | null },
  right: { last_practiced: string | null },
): number {
  const leftStamp = Date.parse(left.last_practiced ?? "");
  const rightStamp = Date.parse(right.last_practiced ?? "");
  const safeLeft = Number.isFinite(leftStamp) ? leftStamp : -Infinity;
  const safeRight = Number.isFinite(rightStamp) ? rightStamp : -Infinity;
  return safeRight - safeLeft;
}

function compareText(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

function practicedWithoutProof(
  pieces: readonly UniversePiece[],
): { piece: UniversePiece; region: RegionSignal } | null {
  const candidates = pieces
    .filter((piece) => piece.archived_at == null)
    .flatMap((piece) =>
      piece.region_signals
        .filter(
          (region) =>
            region.practiced &&
            (region.mastery_contracts_completed ?? 0) === 0 &&
            (region.open_recovery_debt ?? 0) === 0,
        )
        .map((region) => ({ piece, region })),
    );
  candidates.sort(
    (left, right) =>
      mostRecentFirst(left.region, right.region) ||
      compareText(left.piece.title, right.piece.title) ||
      compareText(left.region.name, right.region.name) ||
      left.region.region_id - right.region.region_id,
  );
  return candidates[0] ?? null;
}

function unopenedTarget(
  pieces: readonly UniversePiece[],
): { piece: UniversePiece; region: RegionSignal } | null {
  const candidates = pieces
    .filter((piece) => piece.archived_at == null)
    .flatMap((piece) =>
      piece.region_signals
        .filter((region) => blockState(region) === "untouched")
        .map((region) => ({ piece, region })),
    );
  // Prefer a target inside a piece already in motion, then the most recently
  // touched piece. This is a discoverable landmark, never an imposed plan.
  candidates.sort(
    (left, right) =>
      Number(right.piece.focused_seconds > 0) -
        Number(left.piece.focused_seconds > 0) ||
      mostRecentFirst(left.piece, right.piece) ||
      compareText(left.piece.title, right.piece.title) ||
      compareText(left.region.name, right.region.name) ||
      left.region.region_id - right.region.region_id,
  );
  return candidates[0] ?? null;
}

/**
 * A bounded list of truthful next landmarks. These are observations the user
 * may choose, not due dates, assignments, forecasts or recommendations from a
 * hidden scoring system.
 */
export function nextLandmarks(
  snapshot: UniverseSnapshot,
  streak: { current_days: number } | null,
  limit = 3,
): PracticeLandmark[] {
  if (limit <= 0) return [];
  const landmarks: PracticeLandmark[] = [];

  const recovery = [...snapshot.pieces]
    .filter(
      (piece) =>
        piece.archived_at == null && (piece.open_recovery_debt ?? 0) > 0,
    )
    .sort(
      (left, right) =>
        count(right.open_recovery_debt) - count(left.open_recovery_debt) ||
        compareText(left.title, right.title) ||
        left.piece_id - right.piece_id,
    )[0];
  if (recovery) {
    const debt = count(recovery.open_recovery_debt);
    landmarks.push({
      kind: "recovery",
      title: "Recovery to clear",
      detail: `${recovery.title} has ${debt} ${debt === 1 ? "target" : "targets"} waiting to be won back.`,
      pieceId: recovery.piece_id,
      regionId: null,
    });
  }

  const progress = deriveUniverseProgress(snapshot, streak);
  const nextConsistency = CONSISTENCY_LANDMARKS.find(
    (landmark) => progress.activeDays.value < landmark,
  );
  if (progress.focusedSeconds > 0 && nextConsistency !== undefined) {
    const remaining = nextConsistency - progress.activeDays.value;
    landmarks.push({
      kind: "consistency",
      title: `${nextConsistency}-day consistency mark`,
      detail: `${remaining} more active ${remaining === 1 ? "day" : "days"} would reach ${nextConsistency} of this 28-day window.`,
      pieceId: null,
      regionId: null,
    });
  }

  const proof = practicedWithoutProof(snapshot.pieces);
  if (proof) {
    landmarks.push({
      kind: "mastery",
      title: "Proof still open",
      detail: `${proof.piece.title} · ${proof.region.name} has practice evidence, but no verified clean contract yet.`,
      pieceId: proof.piece.piece_id,
      regionId: proof.region.region_id,
    });
  }

  const unopened = unopenedTarget(snapshot.pieces);
  if (unopened) {
    landmarks.push({
      kind: "coverage",
      title: "Target still untouched",
      detail: `${unopened.piece.title} · ${unopened.region.name} is mapped, with no recorded practice yet.`,
      pieceId: unopened.piece.piece_id,
      regionId: unopened.region.region_id,
    });
  }

  return landmarks.slice(0, limit);
}

export { RECENT_WINDOW_DAYS };
