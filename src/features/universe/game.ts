/**
 * Earned-only game projection for Practice Universe.
 *
 * This module is deliberately pure and storage-agnostic. Its caller supplies
 * monotonic, canonical evidence; it never awards XP for UI activity, guesses,
 * randomness, quality grades, or an imposed practice plan.
 */

export const XP_PER_FOCUSED_MINUTE = 1;

/**
 * Each new level costs 30 XP more than the previous one:
 * L1 0 · L2 30 · L3 90 · L4 180 · L5 300 …
 */
export const LEVEL_XP_STEP = 30;

// Focused seconds arrive as a JavaScript safe integer. Dividing that ceiling
// into completed minutes is therefore the largest XP value this contract can
// honestly represent, even when `levelProgress` is called directly.
const MAX_PRACTICE_XP = Math.floor(Number.MAX_SAFE_INTEGER / 60);

export type BadgeTrack =
  | "active_days"
  | "streak"
  | "focused_hours"
  | "revisits"
  | "mastery"
  | "recovery";

/** Stable display/integration order for the six evidence tracks. */
export const UNIVERSE_BADGE_TRACKS: readonly BadgeTrack[] = Object.freeze([
  "active_days",
  "streak",
  "focused_hours",
  "revisits",
  "mastery",
  "recovery",
]);

/**
 * Badge inputs are the current database's all-history evidence. Unlike rolling
 * views, they include archived repertoire and technique; a legitimate database
 * repair or restore may still revise them, and the canonical snapshot wins.
 *
 * - `lifetimeActiveDays`: distinct qualifying dates in this practice record.
 * - `bestStreakDays`: longest qualifying-day streak, not the current streak.
 * - target counts include archived repertoire in the current practice record.
 */
export interface UniverseGameEvidence {
  lifetimeFocusedSeconds: number | null | undefined;
  lifetimeActiveDays: number | null | undefined;
  bestStreakDays: number | null | undefined;
  revisitedTargets: number | null | undefined;
  masteredTargets: number | null | undefined;
  recoveredTargets: number | null | undefined;
}

export interface BadgeDefinition {
  id: string;
  track: BadgeTrack;
  threshold: number;
  title: string;
  detail: string;
}

export interface NextBadge {
  badge: BadgeDefinition;
  evidence: number;
  remaining: number;
  percent: number;
}

export interface LevelProgress {
  level: number;
  startXp: number;
  nextXp: number;
  xpIntoLevel: number;
  xpToNext: number;
  percent: number;
}

export interface UniverseGameState {
  practiceXp: number;
  level: LevelProgress;
  earnedBadges: readonly BadgeDefinition[];
  /** At most one next badge per track, in the stable catalog order. */
  nextBadges: readonly NextBadge[];
}

interface BadgeTrackSpec {
  track: BadgeTrack;
  thresholds: readonly number[];
}

const BADGE_TRACK_SPECS: readonly BadgeTrackSpec[] = [
  {
    track: "active_days",
    thresholds: [1, 3, 7, 14, 30, 60, 100, 180, 365],
  },
  { track: "streak", thresholds: [3, 7, 14, 30, 60, 100] },
  {
    track: "focused_hours",
    thresholds: [1, 5, 10, 25, 50, 100, 250, 500, 1_000],
  },
  { track: "revisits", thresholds: [1, 5, 10, 25, 50, 100] },
  { track: "mastery", thresholds: [1, 5, 10, 25, 50, 100] },
  { track: "recovery", thresholds: [1, 3, 10, 25, 50, 100] },
] as const;

function completedCount(value: number | null | undefined): number {
  if (!Number.isFinite(value) || value == null || value <= 0) return 0;
  const completed = Math.floor(value);
  return Number.isSafeInteger(completed) ? completed : 0;
}

function plural(
  value: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return value === 1 ? singular : pluralForm;
}

function badgeCopy(
  track: BadgeTrack,
  threshold: number,
): Pick<BadgeDefinition, "title" | "detail"> {
  switch (track) {
    case "active_days":
      return {
        title:
          threshold === 1 ? "First active day" : `${threshold} active days`,
        detail: `Earned from ${threshold} distinct qualifying focused-practice ${plural(threshold, "day")}.`,
      };
    case "streak":
      return {
        title: `${threshold}-day streak`,
        detail: `Earned when the recorded best qualifying-day streak reached ${threshold} ${plural(threshold, "day")}.`,
      };
    case "focused_hours":
      return {
        title:
          threshold === 1 ? "First focused hour" : `${threshold} focused hours`,
        detail: `Earned from ${threshold} completed focused ${plural(threshold, "hour")}; idle gaps do not count.`,
      };
    case "revisits":
      return {
        title:
          threshold === 1
            ? "First target revisited"
            : `${threshold} targets revisited`,
        detail: `Earned when ${threshold} ${plural(threshold, "target")} had recorded practice on at least two dates.`,
      };
    case "mastery":
      return {
        title:
          threshold === 1
            ? "First verified mastery"
            : `${threshold} verified masteries`,
        detail: `Earned when ${threshold} ${plural(threshold, "target")} satisfied a verified clean contract.`,
      };
    case "recovery":
      return {
        title:
          threshold === 1
            ? "First honest recovery"
            : `${threshold} honest recoveries`,
        detail: `Earned when ${threshold} ${plural(threshold, "target")} ${threshold === 1 ? "was" : "were"} won back after recorded recovery debt.`,
      };
  }
}

function makeBadge(track: BadgeTrack, threshold: number): BadgeDefinition {
  return Object.freeze({
    id: `${track}:${threshold}`,
    track,
    threshold,
    ...badgeCopy(track, threshold),
  });
}

/** Stable, transparent badge catalog. Thresholds are data, not hidden scoring. */
export const UNIVERSE_BADGES: readonly BadgeDefinition[] = Object.freeze(
  BADGE_TRACK_SPECS.flatMap(({ track, thresholds }) =>
    thresholds.map((threshold) => makeBadge(track, threshold)),
  ),
);

/** One Practice XP for each fully completed focused minute. */
export function practiceXpFromFocusedSeconds(
  focusedSeconds: number | null | undefined,
): number {
  return (
    Math.floor(completedCount(focusedSeconds) / 60) * XP_PER_FOCUSED_MINUTE
  );
}

function levelStartBigInt(level: number): bigint {
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new RangeError("level must be a positive safe integer");
  }
  const completedLevels = BigInt(level - 1);
  return (
    (BigInt(LEVEL_XP_STEP) * completedLevels * (completedLevels + 1n)) / 2n
  );
}

/** Exact cumulative XP required to enter a level. */
export function levelStartXp(level: number): number {
  const threshold = levelStartBigInt(level);
  if (threshold > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("level XP threshold exceeds Number.MAX_SAFE_INTEGER");
  }
  return Number(threshold);
}

/**
 * Deterministic level projection. Invalid/negative/fractional XP cannot create
 * progress; only completed integer XP is considered.
 */
export function levelProgress(practiceXp: number): LevelProgress {
  const xp = Math.min(MAX_PRACTICE_XP, completedCount(practiceXp));
  const target = BigInt(xp);
  let low = 1;
  let high = 2;

  while (levelStartBigInt(high) <= target) {
    low = high;
    high *= 2;
  }
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (levelStartBigInt(middle) <= target) low = middle;
    else high = middle;
  }

  const startXp = levelStartXp(low);
  const nextXp = levelStartXp(low + 1);
  const xpIntoLevel = xp - startXp;
  const xpToNext = nextXp - xp;
  const span = nextXp - startXp;

  return {
    level: low,
    startXp,
    nextXp,
    xpIntoLevel,
    xpToNext,
    percent: Math.min(99, Math.floor((xpIntoLevel / span) * 100)),
  };
}

function evidenceForTrack(
  track: BadgeTrack,
  evidence: UniverseGameEvidence,
): number {
  switch (track) {
    case "active_days":
      return completedCount(evidence.lifetimeActiveDays);
    case "streak":
      return completedCount(evidence.bestStreakDays);
    case "focused_hours":
      return Math.floor(
        completedCount(evidence.lifetimeFocusedSeconds) / 3_600,
      );
    case "revisits":
      return completedCount(evidence.revisitedTargets);
    case "mastery":
      return completedCount(evidence.masteredTargets);
    case "recovery":
      return completedCount(evidence.recoveredTargets);
  }
}

export function badgeProgress(evidence: UniverseGameEvidence): {
  earnedBadges: readonly BadgeDefinition[];
  nextBadges: readonly NextBadge[];
} {
  const earnedBadges: BadgeDefinition[] = [];
  const nextBadges: NextBadge[] = [];

  for (const spec of BADGE_TRACK_SPECS) {
    const value = evidenceForTrack(spec.track, evidence);
    const definitions = UNIVERSE_BADGES.filter(
      (badge) => badge.track === spec.track,
    );
    earnedBadges.push(
      ...definitions.filter((badge) => value >= badge.threshold),
    );
    const next = definitions.find((badge) => value < badge.threshold);
    if (next) {
      nextBadges.push({
        badge: next,
        evidence: value,
        remaining: next.threshold - value,
        percent: Math.min(99, Math.floor((value / next.threshold) * 100)),
      });
    }
  }

  return { earnedBadges, nextBadges };
}

/** The sole integration entry point needed by a Universe view. */
export function deriveUniverseGame(
  evidence: UniverseGameEvidence,
): UniverseGameState {
  const practiceXp = practiceXpFromFocusedSeconds(
    evidence.lifetimeFocusedSeconds,
  );
  const badges = badgeProgress(evidence);
  return {
    practiceXp,
    level: levelProgress(practiceXp),
    ...badges,
  };
}
