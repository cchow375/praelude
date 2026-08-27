import { describe, expect, it } from "vitest";
import type { UniverseGameEvidence } from "./game";
import {
  earnedGameStatus,
  gameEvidenceFromTotals,
  normalizeGameEvidence,
} from "./gameEvidence";

function evidence(
  overrides: Partial<UniverseGameEvidence> = {},
): UniverseGameEvidence {
  return {
    lifetimeFocusedSeconds: 0,
    lifetimeActiveDays: 0,
    bestStreakDays: 0,
    revisitedTargets: 0,
    masteredTargets: 0,
    recoveredTargets: 0,
    ...overrides,
  };
}

describe("Universe canonical game evidence", () => {
  it("maps the current database's canonical lifetime counters directly", () => {
    expect(
      gameEvidenceFromTotals({
        focused_seconds: 600,
        lifetime_focused_seconds: 7_200,
        active_days_28: 4,
        lifetime_active_days: 33,
        best_streak_days: 8,
        regions_practiced: 4,
        regions_revisited: 2,
        revisited_targets: 12,
        mastered_targets: 5,
        recovered_targets: 3,
      }),
    ).toEqual(
      evidence({
        lifetimeFocusedSeconds: 7_200,
        lifetimeActiveDays: 33,
        bestStreakDays: 8,
        revisitedTargets: 12,
        masteredTargets: 5,
        recoveredTargets: 3,
      }),
    );
  });

  it("keeps old-snapshot fallbacks read-only and sanitizes malformed counts", () => {
    expect(
      gameEvidenceFromTotals({
        focused_seconds: 600,
        lifetime_focused_seconds: undefined as unknown as number,
        active_days_28: 4,
        lifetime_active_days: undefined as unknown as number,
        best_streak_days: undefined as unknown as number,
        regions_practiced: 4,
        regions_revisited: 2,
        revisited_targets: undefined as unknown as number,
      }),
    ).toEqual(
      evidence({
        lifetimeFocusedSeconds: 600,
        lifetimeActiveDays: 4,
        revisitedTargets: 2,
      }),
    );
    expect(
      normalizeGameEvidence({
        lifetimeFocusedSeconds: Number.MAX_VALUE,
        lifetimeActiveDays: -1,
        bestStreakDays: Number.NaN,
        revisitedTargets: 1.9,
        masteredTargets: Infinity,
        recoveredTargets: 2,
      }),
    ).toEqual(evidence({ revisitedTargets: 1, recoveredTargets: 2 }));
  });
});

describe("earnedGameStatus", () => {
  it("announces only a newly crossed level or badge threshold", () => {
    expect(
      earnedGameStatus(
        evidence({ lifetimeFocusedSeconds: 29 * 60 }),
        evidence({ lifetimeFocusedSeconds: 30 * 60 }),
      ),
    ).toBe("Practice Level 2 reached.");
    expect(
      earnedGameStatus(
        evidence({ masteredTargets: 0 }),
        evidence({ masteredTargets: 1 }),
      ),
    ).toBe("Badge earned: First verified mastery.");
    expect(
      earnedGameStatus(
        evidence({ lifetimeFocusedSeconds: 60 }),
        evidence({ lifetimeFocusedSeconds: 119 }),
      ),
    ).toBeNull();
  });

  it("does not announce a database repair or replacement as a gain", () => {
    expect(
      earnedGameStatus(
        evidence({
          lifetimeFocusedSeconds: 7_200,
          lifetimeActiveDays: 20,
          bestStreakDays: 9,
          masteredTargets: 5,
        }),
        evidence({
          lifetimeFocusedSeconds: 60,
          lifetimeActiveDays: 1,
          bestStreakDays: 1,
          masteredTargets: 0,
        }),
      ),
    ).toBeNull();
  });
});
