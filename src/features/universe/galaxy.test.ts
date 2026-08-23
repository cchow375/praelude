import { describe, expect, it } from "vitest";
import { fnv1a32, galaxyLayout } from "./galaxy";
import type { UniversePiece, UniverseSnapshot } from "./types";

const VIEWPORT = { width: 720, height: 520 };

function region(
  id: number,
  over: Partial<UniversePiece["region_signals"][0]> = {},
) {
  return {
    region_id: id,
    name: `Region ${id}`,
    kind: "section",
    focused_seconds: 600,
    active_days_28: 1,
    practiced: true,
    revisited: false,
    quality_brightness: 0.96,
    last_practiced: "2026-08-20T10:00:00Z",
    practice_events: 4,
    rated_rep_events: 2,
    clean_rep_events: 1,
    distinct_practice_dates: 1,
    ...over,
  };
}

const CHOPIN: UniversePiece = {
  piece_id: 7,
  title: "Nocturne Op. 9 No. 2",
  composer: "Chopin",
  focused_seconds: 5430,
  active_days_28: 5,
  regions_total: 3,
  regions_practiced: 2,
  regions_revisited: 1,
  mastered_targets: 1,
  practice_sessions: 8,
  earned_maturity: 0.64,
  quality_brightness: 0.97,
  last_practiced: "2026-08-22T10:00:00Z",
  region_signals: [
    region(1, { mastery_contracts_completed: 1 }),
    region(2),
    region(3, { practiced: false, focused_seconds: 0 }),
  ],
};

const GRIFFES: UniversePiece = {
  ...CHOPIN,
  piece_id: 9,
  title: "The White Peacock",
  composer: "Griffes",
  focused_seconds: 600,
  earned_maturity: 0.11,
  quality_brightness: 0.93,
  region_signals: [region(21)],
};

const SNAPSHOT: UniverseSnapshot = {
  generated_at: "2026-08-23T09:00:00Z",
  definitions: [],
  traces: {
    source: "canonical practice events",
    practice_event_kinds: ["rep_open", "rep", "verdict", "tempo_change"],
    idle_threshold_seconds: 120,
    active_window_start: "2026-07-26",
    active_window_end: "2026-08-23",
    quality_formula: "bounded smoothing",
  },
  totals: {
    focused_seconds: 6030,
    active_days_28: 5,
    regions_practiced: 3,
    regions_revisited: 1,
  },
  pieces: [CHOPIN, GRIFFES],
};

describe("galaxyLayout", () => {
  it("is deterministic: the same snapshot lays out identically twice", () => {
    const a = galaxyLayout(SNAPSHOT, VIEWPORT, { current_days: 0 });
    const b = galaxyLayout(SNAPSHOT, VIEWPORT, { current_days: 0 });
    expect(a).toEqual(b);
  });

  it("places a piece in the same spot however the snapshot is ordered", () => {
    const forward = galaxyLayout(SNAPSHOT, VIEWPORT, null);
    const reversed = galaxyLayout(
      { ...SNAPSHOT, pieces: [GRIFFES, CHOPIN] },
      VIEWPORT,
      null,
    );
    expect(reversed.stars.map((s) => s.piece_id)).toEqual(
      forward.stars.map((s) => s.piece_id),
    );
    expect(reversed).toEqual(forward);
  });

  it("grows the star with focused time, log-scaled and bounded", () => {
    const { stars } = galaxyLayout(SNAPSHOT, VIEWPORT, null);
    const chopin = stars.find((s) => s.piece_id === 7)!;
    const griffes = stars.find((s) => s.piece_id === 9)!;
    expect(chopin.radius).toBeGreaterThan(griffes.radius);
    // Log-scaled, not linear: 9x the seconds is nowhere near 9x the radius.
    expect(chopin.radius).toBeLessThan(griffes.radius * 3);
    for (const star of stars) {
      expect(star.radius).toBeGreaterThanOrEqual(6);
      expect(star.radius).toBeLessThanOrEqual(34);
    }
  });

  it("orbits ONLY regions with a completed mastery contract", () => {
    const { stars } = galaxyLayout(SNAPSHOT, VIEWPORT, null);
    const chopin = stars.find((s) => s.piece_id === 7)!;
    expect(chopin.orbits.map((o) => o.region_id)).toEqual([1]);
    expect(chopin.orbits[0].evidence).toBe("mastery_contracts_completed");
    // Griffes has practice but no mastery contract: no bodies at all.
    expect(stars.find((s) => s.piece_id === 9)!.orbits).toEqual([]);
  });

  it("hashes the orbit phase from the region id — stable, spread, no randomness", () => {
    expect(fnv1a32("region:1")).toBe(fnv1a32("region:1"));
    expect(fnv1a32("region:1")).not.toBe(fnv1a32("region:2"));
    const { stars } = galaxyLayout(SNAPSHOT, VIEWPORT, null);
    const phase = stars.find((s) => s.piece_id === 7)!.orbits[0].phase;
    expect(phase).toBe(fnv1a32("region:1") % 360);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(360);
  });

  it("carries brightness and the growth ring straight off the snapshot", () => {
    const chopin = galaxyLayout(SNAPSHOT, VIEWPORT, null).stars.find(
      (s) => s.piece_id === 7,
    )!;
    expect(chopin.brightness).toBe(CHOPIN.quality_brightness);
    expect(chopin.ring).toBe(CHOPIN.earned_maturity);
    // A snapshot that never computed maturity gets no ring — not a guessed one.
    const bare = galaxyLayout(
      { ...SNAPSHOT, pieces: [{ ...CHOPIN, earned_maturity: undefined }] },
      VIEWPORT,
      null,
    );
    expect(bare.stars[0].ring).toBe(0);
  });

  it("glows only while a day streak is live", () => {
    expect(
      galaxyLayout(SNAPSHOT, VIEWPORT, { current_days: 3 }).stars.every(
        (s) => s.glow,
      ),
    ).toBe(true);
    expect(
      galaxyLayout(SNAPSHOT, VIEWPORT, { current_days: 0 }).stars.some(
        (s) => s.glow,
      ),
    ).toBe(false);
    expect(
      galaxyLayout(SNAPSHOT, VIEWPORT, null).stars.some((s) => s.glow),
    ).toBe(false);
  });

  it("no evidence, no visual: an empty snapshot lays out nothing", () => {
    const empty = galaxyLayout({ ...SNAPSHOT, pieces: [] }, VIEWPORT, {
      current_days: 9,
    });
    expect(empty.stars).toEqual([]);
  });

  it("keeps every star inside the 720x520 dense floor", () => {
    const many: UniverseSnapshot = {
      ...SNAPSHOT,
      pieces: Array.from({ length: 24 }, (_, i) => ({
        ...CHOPIN,
        piece_id: 100 + i,
        title: `Piece ${i}`,
        composer: `Composer ${String(i).padStart(2, "0")}`,
      })),
    };
    for (const star of galaxyLayout(many, VIEWPORT, null).stars) {
      expect(star.cx - star.radius).toBeGreaterThanOrEqual(0);
      expect(star.cx + star.radius).toBeLessThanOrEqual(VIEWPORT.width);
      expect(star.cy - star.radius).toBeGreaterThanOrEqual(0);
    }
  });
});
