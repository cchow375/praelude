import { deriveUniverseGame, type UniverseGameEvidence } from "./game";
import type { UniverseTotals } from "./types";

function completedCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  const completed = Math.floor(value);
  return Number.isSafeInteger(completed) ? completed : 0;
}

export function normalizeGameEvidence(
  evidence: UniverseGameEvidence,
): UniverseGameEvidence {
  return {
    lifetimeFocusedSeconds: completedCount(evidence.lifetimeFocusedSeconds),
    lifetimeActiveDays: completedCount(evidence.lifetimeActiveDays),
    bestStreakDays: completedCount(evidence.bestStreakDays),
    revisitedTargets: completedCount(evidence.revisitedTargets),
    masteredTargets: completedCount(evidence.masteredTargets),
    recoveredTargets: completedCount(evidence.recoveredTargets),
  };
}

/**
 * Translate the current database's native all-history counters into the only
 * evidence the game layer accepts. Nothing outside the canonical snapshot may
 * add, retain, or override progress.
 */
export function gameEvidenceFromTotals(
  totals: UniverseTotals,
): UniverseGameEvidence {
  return normalizeGameEvidence({
    lifetimeFocusedSeconds:
      totals.lifetime_focused_seconds ?? totals.focused_seconds,
    lifetimeActiveDays: totals.lifetime_active_days ?? totals.active_days_28,
    bestStreakDays: totals.best_streak_days,
    revisitedTargets: totals.revisited_targets ?? totals.regions_revisited,
    masteredTargets: totals.mastered_targets,
    recoveredTargets: totals.recovered_targets,
  });
}

/** A deliberately bounded announcement: milestones, never every new XP. */
export function earnedGameStatus(
  previous: UniverseGameEvidence,
  current: UniverseGameEvidence,
): string | null {
  const before = deriveUniverseGame(normalizeGameEvidence(previous));
  const after = deriveUniverseGame(normalizeGameEvidence(current));
  const previousBadgeIds = new Set(
    before.earnedBadges.map((badge) => badge.id),
  );
  const newBadges = after.earnedBadges.filter(
    (badge) => !previousBadgeIds.has(badge.id),
  );
  const reachedLevel = after.level.level > before.level.level;

  if (reachedLevel && newBadges.length === 1) {
    return `Practice Level ${after.level.level} reached · Badge earned: ${newBadges[0].title}.`;
  }
  if (reachedLevel && newBadges.length > 1) {
    return `Practice Level ${after.level.level} reached · ${newBadges.length} badges earned.`;
  }
  if (reachedLevel) return `Practice Level ${after.level.level} reached.`;
  if (newBadges.length === 1) return `Badge earned: ${newBadges[0].title}.`;
  if (newBadges.length > 1) {
    return `${newBadges.length} badges earned, including ${newBadges[newBadges.length - 1].title}.`;
  }
  return null;
}
