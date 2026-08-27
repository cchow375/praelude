import { describe, expect, it } from "vitest";
import {
  deriveUniverseProgress,
  evidenceRatio,
  momentumCopy,
  nextLandmarks,
  recentEvidence,
} from "./progress";
import type { RegionSignal, UniversePiece, UniverseSnapshot } from "./types";

const NOW = "2026-08-27T12:00:00Z";

function iso(daysAgo: number): string {
  return new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();
}

function region(overrides: Partial<RegionSignal> = {}): RegionSignal {
  return {
    region_id: 1,
    name: "Opening",
    kind: "section",
    focused_seconds: 600,
    active_days_28: 1,
    practiced: true,
    revisited: false,
    quality_brightness: 0.95,
    last_practiced: iso(1),
    practice_events: 3,
    rated_rep_events: 2,
    clean_rep_events: 1,
    distinct_practice_dates: 1,
    mastery_contracts_completed: 0,
    recovered: false,
    open_recovery_debt: 0,
    practice_sessions: 1,
    ...overrides,
  };
}

function piece(overrides: Partial<UniversePiece> = {}): UniversePiece {
  return {
    piece_id: 1,
    title: "Scherzo",
    composer: "Chopin",
    focused_seconds: 600,
    active_days_28: 1,
    regions_total: 2,
    regions_practiced: 1,
    regions_revisited: 0,
    mastered_targets: 0,
    recovered_targets: 0,
    open_recovery_debt: 0,
    practice_sessions: 1,
    quality_brightness: 0.95,
    last_practiced: iso(1),
    region_signals: [
      region(),
      region({
        region_id: 2,
        name: "Coda",
        focused_seconds: 0,
        active_days_28: 0,
        practiced: false,
        last_practiced: null,
        practice_events: 0,
        rated_rep_events: 0,
        clean_rep_events: 0,
        distinct_practice_dates: 0,
        practice_sessions: 0,
      }),
    ],
    ...overrides,
  };
}

function snapshot(overrides: Partial<UniverseSnapshot> = {}): UniverseSnapshot {
  return {
    generated_at: NOW,
    definitions: [],
    traces: {
      source: "canonical events",
      practice_event_kinds: ["rep"],
      idle_threshold_seconds: 300,
      active_window_start: "2026-07-31",
      active_window_end: "2026-08-27",
      quality_formula: "unused",
    },
    totals: {
      focused_seconds: 3600,
      active_days_28: 6,
      regions_practiced: 2,
      regions_revisited: 1,
      mastered_targets: 1,
      recovered_targets: 1,
      practice_sessions: 4,
    },
    pieces: [piece()],
    ...overrides,
  };
}

describe("evidenceRatio", () => {
  it("keeps exact counts while bounding only the visual fill", () => {
    expect(evidenceRatio(3, 8)).toEqual({ value: 3, total: 8, percent: 38 });
    expect(evidenceRatio(9, 8)).toEqual({ value: 9, total: 8, percent: 100 });
  });

  it("turns invalid and negative data into an honest zero", () => {
    expect(evidenceRatio(Number.NaN, -3)).toEqual({
      value: 0,
      total: 0,
      percent: 0,
    });
  });
});

describe("deriveUniverseProgress", () => {
  it("uses canonical day totals and the active repertoire graph for coverage", () => {
    expect(deriveUniverseProgress(snapshot(), { current_days: 4 })).toEqual({
      focusedSeconds: 3600,
      activeDays: { value: 6, total: 28, percent: 21 },
      currentStreak: 4,
      practiceSessions: 4,
      coverage: { value: 1, total: 2, percent: 50 },
      revisited: { value: 0, total: 1, percent: 0 },
      mastery: { value: 0, total: 2, percent: 0 },
      recovered: 0,
      recoveryDebt: 0,
    });
  });

  it("uses per-piece mastery even when all-history totals include more work", () => {
    const input = snapshot({
      totals: {
        ...snapshot().totals,
        mastered_targets: undefined,
      },
      pieces: [piece({ mastered_targets: 2 })],
    });
    expect(deriveUniverseProgress(input, null).mastery).toEqual({
      value: 2,
      total: 2,
      percent: 100,
    });
  });

  it("keeps archived history out of every current repertoire rail", () => {
    const active = piece({
      regions_total: 2,
      regions_practiced: 1,
      regions_revisited: 1,
      mastered_targets: 1,
      recovered_targets: 1,
    });
    const archived = piece({
      piece_id: 2,
      archived_at: 1_787_000_000,
      regions_total: 20,
      regions_practiced: 20,
      regions_revisited: 20,
      mastered_targets: 20,
      recovered_targets: 20,
      open_recovery_debt: 20,
    });
    const progress = deriveUniverseProgress(
      snapshot({ pieces: [active, archived] }),
      null,
    );
    expect(progress.coverage).toEqual({ value: 1, total: 2, percent: 50 });
    expect(progress.revisited).toEqual({ value: 1, total: 1, percent: 100 });
    expect(progress.mastery).toEqual({ value: 1, total: 2, percent: 50 });
    expect(progress.recovered).toBe(1);
    expect(progress.recoveryDebt).toBe(0);
  });
});

describe("momentumCopy", () => {
  it("does not award momentum to an empty record", () => {
    const progress = deriveUniverseProgress(
      snapshot({
        totals: {
          focused_seconds: 0,
          active_days_28: 0,
          regions_practiced: 0,
          regions_revisited: 0,
        },
        pieces: [piece({ focused_seconds: 0 })],
      }),
      { current_days: 12 },
    );
    expect(momentumCopy(progress).title).toBe("Ready for the first mark.");
  });

  it("describes a real streak without converting it to points", () => {
    const progress = deriveUniverseProgress(snapshot(), { current_days: 8 });
    expect(momentumCopy(progress)).toMatchObject({
      title: "8 days in motion.",
    });
    expect(JSON.stringify(momentumCopy(progress))).not.toMatch(
      /points|XP|level/i,
    );
  });
});

describe("recentEvidence", () => {
  it("sorts recent practiced targets by their real timestamp and excludes old/untouched rows", () => {
    const rows = recentEvidence(
      [
        piece({
          piece_id: 2,
          title: "Later title",
          region_signals: [
            region({ region_id: 20, name: "Fresh", last_practiced: iso(0) }),
            region({ region_id: 21, name: "Old", last_practiced: iso(15) }),
            region({
              region_id: 22,
              name: "Untouched",
              practiced: false,
              last_practiced: iso(0),
            }),
          ],
        }),
        piece({
          piece_id: 1,
          title: "Earlier title",
          region_signals: [region({ region_id: 10, last_practiced: iso(1) })],
        }),
      ],
      NOW,
    );
    expect(rows.map((row) => row.regionName)).toEqual(["Fresh", "Opening"]);
  });

  it("is bounded and leaves its input untouched", () => {
    const pieces = [piece()];
    const before = structuredClone(pieces);
    expect(recentEvidence(pieces, NOW, 0)).toEqual([]);
    expect(pieces).toEqual(before);
  });
});

describe("nextLandmarks", () => {
  it("orders real recovery, consistency and open proof ahead of untouched coverage", () => {
    const debtPiece = piece({
      piece_id: 2,
      title: "Peacock",
      open_recovery_debt: 1,
      region_signals: [
        region({
          region_id: 20,
          open_recovery_debt: 1,
          mastery_contracts_completed: 1,
        }),
      ],
    });
    const input = snapshot({ pieces: [piece(), debtPiece] });
    const all = nextLandmarks(input, { current_days: 2 }, 10);
    expect(all.map((landmark) => landmark.kind)).toEqual([
      "recovery",
      "consistency",
      "mastery",
      "coverage",
    ]);
    expect(all[0].detail).toContain("Peacock has 1 target");
    expect(all[1].detail).toContain("1 more active day");
    expect(all[2]).toMatchObject({ pieceId: 1, regionId: 1 });
    expect(all[3]).toMatchObject({ pieceId: 1, regionId: 2 });
  });

  it("returns the same bounded landmarks regardless of piece input order", () => {
    const a = piece({ piece_id: 1, title: "Alpha" });
    const b = piece({
      piece_id: 2,
      title: "Beta",
      open_recovery_debt: 2,
      region_signals: [region({ region_id: 20, open_recovery_debt: 2 })],
    });
    const forward = nextLandmarks(snapshot({ pieces: [a, b] }), null);
    const reverse = nextLandmarks(snapshot({ pieces: [b, a] }), null);
    expect(reverse).toEqual(forward);
    expect(forward).toHaveLength(3);
  });

  it("does not invent consistency progress before focused practice exists", () => {
    const input = snapshot({
      totals: {
        focused_seconds: 0,
        active_days_28: 0,
        regions_practiced: 0,
        regions_revisited: 0,
      },
      pieces: [piece({ focused_seconds: 0 })],
    });
    expect(
      nextLandmarks(input, { current_days: 9 }, 10).map((row) => row.kind),
    ).not.toContain("consistency");
  });

  it("never turns archived repertoire history into an active landmark", () => {
    const active = piece({
      regions_total: 1,
      regions_practiced: 1,
      mastered_targets: 1,
      region_signals: [
        region({
          mastery_contracts_completed: 1,
          open_recovery_debt: 0,
        }),
      ],
    });
    const archived = piece({
      piece_id: 2,
      title: "Archived Peacock",
      archived_at: 1_787_000_000,
      open_recovery_debt: 5,
      region_signals: [
        region({
          region_id: 20,
          open_recovery_debt: 5,
          mastery_contracts_completed: 0,
        }),
        region({
          region_id: 21,
          practiced: false,
          practice_events: 0,
          rated_rep_events: 0,
          clean_rep_events: 0,
          last_practiced: null,
        }),
      ],
    });
    const input = snapshot({
      totals: {
        focused_seconds: 0,
        active_days_28: 0,
        regions_practiced: 0,
        regions_revisited: 0,
      },
      pieces: [active, archived],
    });

    expect(nextLandmarks(input, null, 10)).toEqual([]);
  });
});
