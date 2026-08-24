import { describe, expect, it } from "vitest";
import {
  fnv1a32,
  galaxyLayout,
  isEarned,
  MAX_ORBIT_RADIUS,
  ORBIT_BODY_RADIUS,
  GLOW_RADIUS_GAP,
  STAR_UNLIT_RADIUS,
} from "./galaxy";
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

/** Added on the shelf but never opened: zero focused seconds, zero mastered
 * targets, and every region shows zero practice_events. The earned-only law
 * (fix-wave F1) says this piece gets no star at all — not even a dim one. */
const UNTOUCHED: UniversePiece = {
  ...CHOPIN,
  piece_id: 3,
  title: "Prelude in C",
  composer: "Bach",
  focused_seconds: 0,
  mastered_targets: 0,
  earned_maturity: 0,
  quality_brightness: 0.96,
  last_practiced: null,
  region_signals: [
    region(31, { practiced: false, focused_seconds: 0, practice_events: 0 }),
  ],
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

describe("earned-only law (fix-wave F1)", () => {
  it("isEarned is true from any one of three independent signals", () => {
    expect(isEarned(CHOPIN)).toBe(true); // focused_seconds > 0
    expect(
      isEarned({ ...UNTOUCHED, focused_seconds: 0, mastered_targets: 1 }),
    ).toBe(true); // mastered_targets > 0, focused_seconds still 0
    expect(
      isEarned({
        ...UNTOUCHED,
        focused_seconds: 0,
        mastered_targets: 0,
        region_signals: [region(31, { practice_events: 1, focused_seconds: 0 })],
      }),
    ).toBe(true); // a single logged practice event, no gap yet to sum
    expect(isEarned(UNTOUCHED)).toBe(false);
  });

  it("a never-practised piece renders no star: hollow marker, no glow, no orbits, no ring", () => {
    const { stars } = galaxyLayout(
      { ...SNAPSHOT, pieces: [CHOPIN, UNTOUCHED] },
      VIEWPORT,
      { current_days: 5 }, // a LIVE global streak — must not leak onto this piece
    );
    const untouched = stars.find((s) => s.piece_id === 3)!;
    expect(untouched.earned).toBe(false);
    expect(untouched.evidence).toBe("none");
    expect(untouched.radius).toBe(STAR_UNLIT_RADIUS);
    expect(untouched.glow).toBe(false);
    expect(untouched.ring).toBe(0);
    expect(untouched.orbits).toEqual([]);

    // The earned piece in the SAME layout still glows: the streak only ever
    // withholds evidence, it never leaks it onto an unearned piece.
    const chopin = stars.find((s) => s.piece_id === 7)!;
    expect(chopin.earned).toBe(true);
    expect(chopin.glow).toBe(true);
  });

  it("law: a rendered evidence field is never tagged against a zero value", () => {
    const heavilyMastered: UniversePiece = {
      ...CHOPIN,
      piece_id: 77,
      region_signals: [
        region(1, { mastery_contracts_completed: 1 }),
        region(2, { mastery_contracts_completed: 1 }),
      ],
    };
    const { stars } = galaxyLayout(
      { ...SNAPSHOT, pieces: [CHOPIN, UNTOUCHED, heavilyMastered] },
      VIEWPORT,
      { current_days: 2 },
    );
    for (const star of stars) {
      const piece = [CHOPIN, UNTOUCHED, heavilyMastered].find(
        (p) => p.piece_id === star.piece_id,
      )!;
      if (star.evidence === "focused_seconds") {
        expect(piece.focused_seconds).toBeGreaterThan(0);
      } else if (star.evidence === "mastered_targets") {
        expect(piece.mastered_targets ?? 0).toBeGreaterThan(0);
      } else if (star.evidence === "region_signals") {
        expect(
          piece.region_signals.some((r) => (r.practice_events ?? 0) > 0),
        ).toBe(true);
      } else {
        expect(star.evidence).toBe("none");
        expect(star.earned).toBe(false);
      }
      // A glow is only ever tagged in the DOM as "streak.current_days" — never
      // "focused_seconds" — and only ever rendered when current_days > 0 AND
      // the star itself is earned (asserted structurally: glow implies earned).
      if (star.glow) expect(star.earned).toBe(true);
      // An orbit only ever exists on an earned star with a nonzero
      // mastery_contracts_completed on its region — never on an unearned one.
      if (star.orbits.length > 0) expect(star.earned).toBe(true);
    }
  });
});

describe("orbit geometry stays inside its own cell (fix-wave F2)", () => {
  function heavilyOrbited(regionCount: number): UniversePiece {
    return {
      ...CHOPIN,
      piece_id: 200,
      focused_seconds: 72_000, // saturates star radius at STAR_MAX_RADIUS
      region_signals: Array.from({ length: regionCount }, (_, i) =>
        region(500 + i, { mastery_contracts_completed: 1 }),
      ),
    };
  }

  it("bounds every orbit radius to MAX_ORBIT_RADIUS, even with many mastered regions", () => {
    for (const count of [1, 4, 8, 13, 20]) {
      const { stars } = galaxyLayout(
        { ...SNAPSHOT, pieces: [heavilyOrbited(count)] },
        VIEWPORT,
        null,
      );
      const star = stars[0];
      expect(star.orbits).toHaveLength(count);
      for (const orbit of star.orbits) {
        expect(orbit.radius).toBeLessThanOrEqual(MAX_ORBIT_RADIUS);
        // The full swept circle (rotation sweeps the body through 360deg)
        // must still sit inside the star's own 132px cell (half-width 66).
        expect(orbit.radius + ORBIT_BODY_RADIUS).toBeLessThanOrEqual(66);
      }
    }
  });

  it("keeps orbit radii non-decreasing by orbit index, even once clamped", () => {
    const { stars } = galaxyLayout(
      { ...SNAPSHOT, pieces: [heavilyOrbited(20)] },
      VIEWPORT,
      null,
    );
    const radii = stars[0].orbits.map((o) => o.radius);
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]).toBeGreaterThanOrEqual(radii[i - 1]);
    }
  });

  it("MUTATION GUARD: an orbit gap of 400 would blow past MAX_ORBIT_RADIUS — must stay bounded", () => {
    // This is the exact shape of the F2 bug report: a well-worked piece with
    // several mastered regions. If ORBIT_GAP (or the bound) regresses, this
    // is the test that must go red.
    const { stars } = galaxyLayout(
      { ...SNAPSHOT, pieces: [heavilyOrbited(4)] },
      VIEWPORT,
      null,
    );
    for (const orbit of stars[0].orbits) {
      expect(orbit.radius).toBeLessThanOrEqual(MAX_ORBIT_RADIUS);
    }
  });

  it("MUTATION GUARD: a single orbit with ample room sits at exactly ORBIT_INNER_GAP + ORBIT_GAP from the star edge", () => {
    // A bounds-only check ("stays <= MAX_ORBIT_RADIUS") does NOT catch
    // ORBIT_GAP being mutated to a much larger value when there is plenty of
    // room: `min(ORBIT_GAP, available / n)` still clamps the final radius
    // under MAX_ORBIT_RADIUS either way, so a bounds check alone is silently
    // blind to the gap itself changing. This pins the EXACT offset (a single
    // mastered region on a small, low-focus star, where `available` is large
    // enough that ORBIT_GAP — not `available / n` — is the binding term) so a
    // mutated ORBIT_GAP moves this number and the test goes red.
    const oneOrbit: UniversePiece = {
      ...GRIFFES,
      piece_id: 201,
      focused_seconds: 60, // near the STAR_MIN_RADIUS floor, plenty of room
      region_signals: [region(600, { mastery_contracts_completed: 1 })],
    };
    const { stars } = galaxyLayout(
      { ...SNAPSHOT, pieces: [oneOrbit] },
      VIEWPORT,
      null,
    );
    const star = stars[0];
    expect(star.orbits).toHaveLength(1);
    // ORBIT_INNER_GAP (4) + ORBIT_GAP (11) = 15, from galaxy.ts's own
    // (unexported, deliberately pinned-by-value-here) constants.
    expect(star.orbits[0].radius).toBe(star.radius + 15);
  });

  it("MUTATION GUARD: orbit period must vary by index, not collapse to a constant", () => {
    const { stars } = galaxyLayout(
      { ...SNAPSHOT, pieces: [heavilyOrbited(3)] },
      VIEWPORT,
      null,
    );
    const periods = stars[0].orbits.map((o) => o.period);
    expect(new Set(periods).size).toBe(periods.length);
    expect(Math.min(...periods)).toBeGreaterThan(0);
  });

  it("property: for 1..40 pieces and 0..20 mastered regions each, every drawn element stays within the 720x520 dense floor", () => {
    for (const pieceCount of [1, 2, 5, 12, 24, 40]) {
      for (const masteredCount of [0, 1, 4, 8, 13, 20]) {
        const pieces: UniversePiece[] = Array.from(
          { length: pieceCount },
          (_, i) => ({
            ...CHOPIN,
            piece_id: 1000 + i,
            title: `Piece ${i}`,
            composer: `Composer ${String(i).padStart(2, "0")}`,
            focused_seconds: 72_000,
            region_signals: Array.from({ length: masteredCount }, (_, r) =>
              region(9000 + i * 100 + r, { mastery_contracts_completed: 1 }),
            ),
          }),
        );
        const { stars } = galaxyLayout(
          { ...SNAPSHOT, pieces },
          VIEWPORT,
          { current_days: 3 },
        );
        for (const star of stars) {
          // Disc / ring / glow: the glow gap (6) is the largest of the three
          // optional extents, so it is the bounding radius to check.
          const outer = star.earned ? star.radius + GLOW_RADIUS_GAP : star.radius;
          expect(star.cx - outer).toBeGreaterThanOrEqual(0);
          expect(star.cx + outer).toBeLessThanOrEqual(VIEWPORT.width);
          expect(star.cy - outer).toBeGreaterThanOrEqual(0);
          // Orbits: the full swept circle of every orbiting body.
          for (const orbit of star.orbits) {
            const swept = orbit.radius + ORBIT_BODY_RADIUS;
            expect(star.cx - swept).toBeGreaterThanOrEqual(0);
            expect(star.cx + swept).toBeLessThanOrEqual(VIEWPORT.width);
            expect(star.cy - swept).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});
