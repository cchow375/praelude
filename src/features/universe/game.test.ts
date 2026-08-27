import { describe, expect, it } from "vitest";
import {
  LEVEL_XP_STEP,
  UNIVERSE_BADGE_TRACKS,
  UNIVERSE_BADGES,
  XP_PER_FOCUSED_MINUTE,
  badgeProgress,
  deriveUniverseGame,
  levelProgress,
  levelStartXp,
  practiceXpFromFocusedSeconds,
  type BadgeTrack,
  type UniverseGameEvidence,
} from "./game";

function emptyEvidence(
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

function evidenceAt(track: BadgeTrack, value: number): UniverseGameEvidence {
  switch (track) {
    case "active_days":
      return emptyEvidence({ lifetimeActiveDays: value });
    case "streak":
      return emptyEvidence({ bestStreakDays: value });
    case "focused_hours":
      return emptyEvidence({ lifetimeFocusedSeconds: value * 3_600 });
    case "revisits":
      return emptyEvidence({ revisitedTargets: value });
    case "mastery":
      return emptyEvidence({ masteredTargets: value });
    case "recovery":
      return emptyEvidence({ recoveredTargets: value });
  }
}

describe("Practice XP", () => {
  it("awards exactly one XP per completed focused minute", () => {
    expect(XP_PER_FOCUSED_MINUTE).toBe(1);
    for (const [seconds, xp] of [
      [0, 0],
      [59, 0],
      [59.999, 0],
      [60, 1],
      [119.999, 1],
      [120, 2],
      [3_599, 59],
      [3_600, 60],
    ] as const) {
      expect(practiceXpFromFocusedSeconds(seconds)).toBe(xp);
    }
  });

  it("cannot mint XP from invalid, negative, or unfinished evidence", () => {
    for (const value of [
      undefined,
      null,
      Number.NaN,
      Infinity,
      -Infinity,
      -1,
      Number.MAX_VALUE,
    ]) {
      expect(practiceXpFromFocusedSeconds(value)).toBe(0);
    }
  });
});

describe("levels", () => {
  it("uses the published cumulative threshold curve", () => {
    expect(LEVEL_XP_STEP).toBe(30);
    expect(
      Array.from({ length: 8 }, (_, index) => levelStartXp(index + 1)),
    ).toEqual([0, 30, 90, 180, 300, 450, 630, 840]);
  });

  it("rejects meaningless or unrepresentable level requests", () => {
    for (const level of [0, -1, 1.5, Number.NaN, Infinity]) {
      expect(() => levelStartXp(level)).toThrow(RangeError);
    }
    expect(() => levelStartXp(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  it("is exact immediately before, at, and after every early boundary", () => {
    for (let level = 2; level <= 250; level += 1) {
      const threshold = levelStartXp(level);
      expect(levelProgress(threshold - 1).level).toBe(level - 1);
      expect(levelProgress(threshold)).toMatchObject({
        level,
        startXp: threshold,
        xpIntoLevel: 0,
        percent: 0,
      });
      expect(levelProgress(threshold + 1).level).toBe(level);
    }
  });

  it("matches the independent closed form at selected large boundaries", () => {
    for (const level of [251, 1_000, 10_000, 1_000_000]) {
      const expected = (30 * (level - 1) * level) / 2;
      expect(levelStartXp(level)).toBe(expected);
      expect(levelProgress(expected - 1).level).toBe(level - 1);
      expect(levelProgress(expected).level).toBe(level);
    }
  });

  it("shows bounded, non-rounded-up progress inside a level", () => {
    expect(levelProgress(89)).toEqual({
      level: 2,
      startXp: 30,
      nextXp: 90,
      xpIntoLevel: 59,
      xpToNext: 1,
      percent: 98,
    });
    expect(levelProgress(90)).toMatchObject({ level: 3, percent: 0 });
    expect(levelProgress(-12)).toEqual(levelProgress(0));
    expect(levelProgress(12.9)).toEqual(levelProgress(12));
  });

  it("stays deterministic at JavaScript's numeric ceiling", () => {
    const ceiling = levelProgress(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(ceiling.startXp)).toBe(true);
    expect(Number.isSafeInteger(ceiling.nextXp)).toBe(true);
    expect(ceiling.xpToNext).toBeGreaterThan(0);
    expect(ceiling.percent).toBeGreaterThanOrEqual(0);
    expect(ceiling.percent).toBeLessThan(100);
    expect(levelProgress(Infinity)).toEqual(levelProgress(0));
  });
});

describe("earned and next badges", () => {
  it("publishes six stable tracks with unique, increasing thresholds", () => {
    const tracks = [...new Set(UNIVERSE_BADGES.map((badge) => badge.track))];
    expect(tracks).toEqual(UNIVERSE_BADGE_TRACKS);
    expect(new Set(UNIVERSE_BADGES.map((badge) => badge.id)).size).toBe(
      UNIVERSE_BADGES.length,
    );
    for (const track of tracks) {
      const thresholds = UNIVERSE_BADGES.filter(
        (badge) => badge.track === track,
      ).map((badge) => badge.threshold);
      expect(thresholds.length).toBeGreaterThan(0);
      expect(
        thresholds.every((value) => Number.isSafeInteger(value) && value > 0),
      ).toBe(true);
      expect(thresholds).toEqual(
        [...thresholds].sort((left, right) => left - right),
      );
      expect(new Set(thresholds).size).toBe(thresholds.length);
    }
    const expectedThresholds: Record<BadgeTrack, readonly number[]> = {
      active_days: [1, 3, 7, 14, 30, 60, 100, 180, 365],
      streak: [3, 7, 14, 30, 60, 100],
      focused_hours: [1, 5, 10, 25, 50, 100, 250, 500, 1_000],
      revisits: [1, 5, 10, 25, 50, 100],
      mastery: [1, 5, 10, 25, 50, 100],
      recovery: [1, 3, 10, 25, 50, 100],
    };
    for (const track of UNIVERSE_BADGE_TRACKS) {
      expect(
        UNIVERSE_BADGES.filter((badge) => badge.track === track).map(
          (badge) => badge.threshold,
        ),
      ).toEqual(expectedThresholds[track]);
    }
  });

  it("awards every badge at its exact evidence boundary, never one unit early", () => {
    for (const badge of UNIVERSE_BADGES) {
      const before = badgeProgress(
        evidenceAt(badge.track, badge.threshold - 1),
      );
      expect(before.earnedBadges.map((entry) => entry.id)).not.toContain(
        badge.id,
      );
      expect(
        before.nextBadges.find((entry) => entry.badge.track === badge.track),
      ).toMatchObject({
        badge: { id: badge.id },
        evidence: badge.threshold - 1,
        remaining: 1,
      });

      const exact = badgeProgress(evidenceAt(badge.track, badge.threshold));
      expect(
        exact.earnedBadges
          .filter((entry) => entry.track === badge.track)
          .map((entry) => entry.id),
      ).toEqual(
        UNIVERSE_BADGES.filter(
          (entry) =>
            entry.track === badge.track && entry.threshold <= badge.threshold,
        ).map((entry) => entry.id),
      );
    }
  });

  it("returns one transparent next badge per unfinished track", () => {
    const result = badgeProgress(
      emptyEvidence({
        lifetimeActiveDays: 2,
        bestStreakDays: 6,
        lifetimeFocusedSeconds: 4 * 3_600 + 3_599,
        revisitedTargets: 4,
        masteredTargets: 9,
        recoveredTargets: 2,
      }),
    );
    expect(
      result.nextBadges.map(({ badge, evidence, remaining, percent }) => ({
        id: badge.id,
        evidence,
        remaining,
        percent,
      })),
    ).toEqual([
      { id: "active_days:3", evidence: 2, remaining: 1, percent: 66 },
      { id: "streak:7", evidence: 6, remaining: 1, percent: 85 },
      { id: "focused_hours:5", evidence: 4, remaining: 1, percent: 80 },
      { id: "revisits:5", evidence: 4, remaining: 1, percent: 80 },
      { id: "mastery:10", evidence: 9, remaining: 1, percent: 90 },
      { id: "recovery:3", evidence: 2, remaining: 1, percent: 66 },
    ]);
  });

  it("has no next badge after the published track is complete", () => {
    const maxima = new Map<BadgeTrack, number>();
    for (const badge of UNIVERSE_BADGES) {
      maxima.set(
        badge.track,
        Math.max(maxima.get(badge.track) ?? 0, badge.threshold),
      );
    }
    const evidence = emptyEvidence({
      lifetimeActiveDays: maxima.get("active_days"),
      bestStreakDays: maxima.get("streak"),
      lifetimeFocusedSeconds: (maxima.get("focused_hours") ?? 0) * 3_600,
      revisitedTargets: maxima.get("revisits"),
      masteredTargets: maxima.get("mastery"),
      recoveredTargets: maxima.get("recovery"),
    });
    const result = badgeProgress(evidence);
    expect(result.earnedBadges).toHaveLength(UNIVERSE_BADGES.length);
    expect(result.nextBadges).toEqual([]);
  });

  it("sanitizes malformed counts instead of inventing badge evidence", () => {
    const result = badgeProgress({
      lifetimeFocusedSeconds: Number.NaN,
      lifetimeActiveDays: -1,
      bestStreakDays: Infinity,
      revisitedTargets: 0.99,
      masteredTargets: -Infinity,
      recoveredTargets: undefined,
    });
    expect(result.earnedBadges).toEqual([]);
    expect(result.nextBadges).toHaveLength(6);
    expect(result.nextBadges.every((entry) => entry.evidence === 0)).toBe(true);
  });

  it("rejects finite unsafe counts instead of turning them into every badge", () => {
    const result = badgeProgress({
      lifetimeFocusedSeconds: Number.MAX_VALUE,
      lifetimeActiveDays: Number.MAX_VALUE,
      bestStreakDays: Number.MAX_VALUE,
      revisitedTargets: Number.MAX_VALUE,
      masteredTargets: Number.MAX_VALUE,
      recoveredTargets: Number.MAX_VALUE,
    });
    expect(result.earnedBadges).toEqual([]);
    expect(result.nextBadges.every((entry) => entry.evidence === 0)).toBe(true);
  });
});

describe("deriveUniverseGame integration API", () => {
  it("combines XP, level, earned badges and one next badge per track", () => {
    const state = deriveUniverseGame(
      emptyEvidence({
        lifetimeFocusedSeconds: 10 * 3_600,
        lifetimeActiveDays: 14,
        bestStreakDays: 7,
        revisitedTargets: 5,
        masteredTargets: 2,
        recoveredTargets: 1,
      }),
    );
    expect(state.practiceXp).toBe(600);
    expect(state.level.level).toBe(6);
    expect(state.earnedBadges.map((badge) => badge.id)).toEqual(
      expect.arrayContaining([
        "active_days:14",
        "streak:7",
        "focused_hours:10",
        "revisits:5",
        "mastery:1",
        "recovery:1",
      ]),
    );
    expect(state.nextBadges).toHaveLength(6);
  });

  it("XP depends only on focused minutes while badges stay evidence-specific", () => {
    const base = emptyEvidence({ lifetimeFocusedSeconds: 3_661 });
    const decorated = emptyEvidence({
      lifetimeFocusedSeconds: 3_661,
      lifetimeActiveDays: 365,
      bestStreakDays: 100,
      revisitedTargets: 100,
      masteredTargets: 100,
      recoveredTargets: 100,
    });
    expect(deriveUniverseGame(decorated).practiceXp).toBe(
      deriveUniverseGame(base).practiceXp,
    );
    expect(deriveUniverseGame(decorated).earnedBadges.length).toBeGreaterThan(
      deriveUniverseGame(base).earnedBadges.length,
    );
  });

  it("is deterministic and never mutates the evidence object", () => {
    const evidence = emptyEvidence({
      lifetimeFocusedSeconds: 7_777,
      lifetimeActiveDays: 8,
      bestStreakDays: 4,
      masteredTargets: 3,
    });
    const before = structuredClone(evidence);
    expect(deriveUniverseGame(evidence)).toEqual(deriveUniverseGame(evidence));
    expect(evidence).toEqual(before);
  });

  it("contains no grading, random reward, or imposed-drill language", () => {
    expect(JSON.stringify(UNIVERSE_BADGES)).not.toMatch(
      /grade|random|lucky|assignment|drill|talent score/i,
    );
  });
});
