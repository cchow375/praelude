import { composerSortKey } from "./repertoire";
import type { RegionSignal, UniversePiece, UniverseSnapshot } from "./types";

/**
 * The living galaxy's geometry — a PURE function of one universe snapshot.
 *
 * This module is where "living" is made honest. It computes positions, sizes,
 * ring thicknesses and orbit phases; it never animates anything. Motion is left
 * entirely to CSS @keyframes in universe.css, which means there is no
 * requestAnimationFrame, no simulation, no tick, and nothing to desynchronise —
 * exactly the property that killed the v5 d3-force galaxy.
 *
 * Everything here is derived from snapshot fields the Rust `universe::snapshot`
 * already earns from recorded practice events:
 *   focused_seconds/mastered_targets/region practice_events -> whether a piece
 *                                 is earned at all, and which field proves it
 *   focused_seconds            -> star radius (log-scaled)
 *   quality_brightness         -> star/body brightness
 *   earned_maturity            -> growth-ring thickness
 *   mastery_contracts_completed-> whether a region orbits at all
 *   streak.current_days        -> whether an EARNED star glows
 * There is no other input. If a visual cannot name its field, it does not ship
 * — and a `data-evidence` attribute may never name a field whose value is 0
 * (see `isEarned`/`evidenceField` below; a fix-wave finding, F1(d)).
 */

export interface GalaxyViewport {
  width: number;
  height: number;
}

/** The streak facts the galaxy is allowed to react to (A2's read model). */
export interface GalaxyStreak {
  current_days: number;
}

/** One mastered region, orbiting its piece's star. */
export interface GalaxyOrbit {
  region_id: number;
  name: string;
  radius: number;
  /** Degrees. */
  phase: number;
  /** Seconds per revolution. */
  period: number;
  brightness: number;
  evidence: "mastery_contracts_completed";
}

/** The specific snapshot field that proves a star is earned. `"none"` means
 * the piece has zero practice evidence and renders unlit — see `isEarned`. */
export type GalaxyEvidence =
  | "focused_seconds"
  | "mastered_targets"
  | "region_signals"
  | "none";

/** One piece, as a star system — or, with no practice evidence, an unlit marker. */
export interface GalaxyStar {
  piece_id: number;
  title: string;
  composer: string;
  cx: number;
  cy: number;
  radius: number;
  brightness: number;
  ring: number;
  glow: boolean;
  orbits: GalaxyOrbit[];
  /** False for a piece with zero recorded practice evidence — see `isEarned`.
   * An unearned piece stays present (so it is discoverable) but renders as a
   * hollow, non-animated marker: no disc, no glow, no ring, no orbits. */
  earned: boolean;
  /** The field that proves `earned`, or `"none"` when it is not earned. */
  evidence: GalaxyEvidence;
}

export interface GalaxyLayout {
  viewport: GalaxyViewport;
  stars: GalaxyStar[];
}

/** Smallest and largest an EARNED star may draw, in px. */
export const STAR_MIN_RADIUS = 6;
export const STAR_MAX_RADIUS = 34;
/** An unearned piece renders this small a hollow marker — never a filled
 * disc, never grown by a global streak or a neutral default brightness. */
export const STAR_UNLIT_RADIUS = 4;
/**
 * Twenty focused hours saturate the star, matching the `earned_maturity` time
 * term in `src-tauri/src/universe.rs` (`ln_1p(minutes) / ln_1p(1200)`), so the
 * ring and the disc never tell different stories about the same piece.
 */
const FOCUS_SATURATION_MINUTES = 1_200;

/** One grid cell per piece; sized so 720px fits five columns at the dense floor. */
const CELL_WIDTH = 132;
const CELL_HEIGHT = 132;

/**
 * Orbit geometry. Orbits are bounded to `MAX_ORBIT_RADIUS` (fix-wave F2): a
 * well-worked piece can easily carry 4+ mastered regions, and an unbounded
 * `radius + ORBIT_GAP * (index + 1)` walked bodies straight off the 720x520
 * canvas and into the neighbouring star's cell. The gap between orbits
 * shrinks (down to `ORBIT_MIN_GAP`) so every body still fits; bodies may sit
 * visually tight past ~13 mastered regions on a max-size star, which is
 * accepted as honest — hiding earned data is not.
 */
const ORBIT_INNER_GAP = 4;
const ORBIT_GAP = 11;
const ORBIT_MIN_GAP = 2;
/** Half a cell, minus a few px of margin so a fully-clamped orbit never
 * touches the neighbouring star's cell (cell half-width is 66). */
export const MAX_ORBIT_RADIUS = CELL_WIDTH / 2 - 6;
const ORBIT_BASE_PERIOD_SECONDS = 42;
const ORBIT_PERIOD_STEP_SECONDS = 9;
/** Drawn radius of one orbiting body (UniverseWorkspace.tsx renders this
 * literally) — exported so tests can compute an orbit's full swept-circle
 * extent without duplicating the number. */
export const ORBIT_BODY_RADIUS = 2.5;
/** How far the glow ring sits outside the star disc (UniverseWorkspace.tsx
 * renders this literally) — exported for the same reason. This bound also
 * covers the growth ring, whose outer edge (`radius + 3 + strokeWidth / 2`,
 * strokeWidth <= 4) never exceeds `radius + 5`. */
export const GLOW_RADIUS_GAP = 6;

/**
 * FNV-1a, 32-bit. Chosen for the orbit phase because it is a TOTAL function of
 * the region id: no seed, no clock, no PRNG state. Two databases with identical
 * event histories therefore place every orbiting body at the same angle, which
 * is the property test the spec asks for.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function starRadius(focusedSeconds: number): number {
  const minutes = Math.max(0, focusedSeconds) / 60;
  const scaled = Math.log1p(minutes) / Math.log1p(FOCUS_SATURATION_MINUTES);
  const bounded = Math.min(1, Math.max(0, scaled));
  return STAR_MIN_RADIUS + (STAR_MAX_RADIUS - STAR_MIN_RADIUS) * bounded;
}

/**
 * Earned-only law (fix-wave F1): a piece with zero recorded practice gets no
 * star. `focused_seconds` alone under-claims — it sums the GAPS between
 * consecutive practice events, so a piece with exactly one recorded event
 * still reads `focused_seconds === 0` even though something real happened.
 * The three clauses below are OR'd so under-claiming (missing a real event)
 * is impossible without over-claiming (crediting a piece with no evidence at
 * all); either signal alone is enough to earn a star.
 */
export function isEarned(piece: UniversePiece): boolean {
  return (
    piece.focused_seconds > 0 ||
    (piece.mastered_targets ?? 0) > 0 ||
    piece.region_signals.some((region) => (region.practice_events ?? 0) > 0)
  );
}

/** The specific field that proves `isEarned`, so a `data-evidence` attribute
 * never names a field whose value is 0 (fix-wave F1(d)). */
function evidenceField(piece: UniversePiece): GalaxyEvidence {
  if (piece.focused_seconds > 0) return "focused_seconds";
  if ((piece.mastered_targets ?? 0) > 0) return "mastered_targets";
  if (piece.region_signals.some((region) => (region.practice_events ?? 0) > 0)) {
    return "region_signals";
  }
  return "none";
}

/** A region orbits only once it has a completed mastery contract on record. */
function orbiting(regions: RegionSignal[]): RegionSignal[] {
  return regions.filter(
    (region) => (region.mastery_contracts_completed ?? 0) > 0,
  );
}

/**
 * Orbit radii, bounded to `MAX_ORBIT_RADIUS` so the outermost body's full
 * swept circle never leaves the star's own cell (fix-wave F2). The gap
 * shrinks to fit `n` orbits in the available space, floored at
 * `ORBIT_MIN_GAP`; if even the floor overflows, every radius clamps to
 * `MAX_ORBIT_RADIUS` (bodies may sit tight or overlap — still honest, unlike
 * hiding the region). Radii are non-decreasing by construction: `raw` grows
 * monotonically with `index` (gap > 0), and clamping an increasing sequence
 * to a constant ceiling can only flatten it, never reverse it.
 */
function orbitsFor(piece: UniversePiece, starRadiusPx: number): GalaxyOrbit[] {
  const regions = orbiting(piece.region_signals);
  const n = regions.length;
  if (n === 0) return [];
  const available = MAX_ORBIT_RADIUS - starRadiusPx - ORBIT_INNER_GAP;
  const gap = Math.max(ORBIT_MIN_GAP, Math.min(ORBIT_GAP, available / n));
  return regions.map((region, index) => {
    const raw = starRadiusPx + ORBIT_INNER_GAP + gap * (index + 1);
    return {
      region_id: region.region_id,
      name: region.name,
      radius: Math.min(raw, MAX_ORBIT_RADIUS),
      phase: fnv1a32(`region:${region.region_id}`) % 360,
      period: ORBIT_BASE_PERIOD_SECONDS + ORBIT_PERIOD_STEP_SECONDS * index,
      brightness: region.quality_brightness,
      evidence: "mastery_contracts_completed",
    };
  });
}

/** Composer sort key, then piece id — the order the paper index already uses. */
function stableOrder(pieces: UniversePiece[]): UniversePiece[] {
  return [...pieces].sort((a, b) => {
    const byComposer = composerSortKey(a.composer ?? "").localeCompare(
      composerSortKey(b.composer ?? ""),
    );
    return byComposer !== 0 ? byComposer : a.piece_id - b.piece_id;
  });
}

export function galaxyLayout(
  snapshot: UniverseSnapshot,
  viewport: GalaxyViewport,
  streak: GalaxyStreak | null,
): GalaxyLayout {
  const streakLive = (streak?.current_days ?? 0) > 0;
  const columns = Math.max(1, Math.floor(viewport.width / CELL_WIDTH));
  const stars = stableOrder(snapshot.pieces).map((piece, index) => {
    const earned = isEarned(piece);
    const radius = earned ? starRadius(piece.focused_seconds) : STAR_UNLIT_RADIUS;
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      piece_id: piece.piece_id,
      title: piece.title,
      composer: piece.composer ?? "",
      cx: column * CELL_WIDTH + CELL_WIDTH / 2,
      cy: row * CELL_HEIGHT + CELL_HEIGHT / 2,
      radius,
      brightness: piece.quality_brightness,
      // No maturity on the wire means no ring. An absent signal is never a
      // guessed one. An unearned piece never gets a ring either way.
      ring: earned ? (piece.earned_maturity ?? 0) : 0,
      // A never-practised piece does not glow just because the USER has a
      // global streak — that would attribute someone else's practice to this
      // piece. Glow requires the piece itself to be earned (fix-wave F1(c)).
      glow: earned && streakLive,
      orbits: earned ? orbitsFor(piece, radius) : [],
      earned,
      evidence: earned ? evidenceField(piece) : "none",
    };
  });
  return { viewport, stars };
}
