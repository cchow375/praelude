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
 *   focused_seconds            -> star radius (log-scaled)
 *   quality_brightness         -> star/body brightness
 *   earned_maturity            -> growth-ring thickness
 *   mastery_contracts_completed-> whether a region orbits at all
 *   streak.current_days        -> whether the star glows
 * There is no sixth input. If a visual cannot name its field, it does not ship.
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

/** One piece, as a star system. */
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
}

export interface GalaxyLayout {
  viewport: GalaxyViewport;
  stars: GalaxyStar[];
}

/** Smallest and largest a star may draw, in px. */
export const STAR_MIN_RADIUS = 6;
export const STAR_MAX_RADIUS = 34;
/**
 * Twenty focused hours saturate the star, matching the `earned_maturity` time
 * term in `src-tauri/src/universe.rs` (`ln_1p(minutes) / ln_1p(1200)`), so the
 * ring and the disc never tell different stories about the same piece.
 */
const FOCUS_SATURATION_MINUTES = 1_200;

/** One grid cell per piece; sized so 720px fits five columns at the dense floor. */
const CELL_WIDTH = 132;
const CELL_HEIGHT = 132;
const GUTTER = 8;

/** Orbit geometry, all deterministic. */
const ORBIT_GAP = 11;
const ORBIT_BASE_PERIOD_SECONDS = 42;
const ORBIT_PERIOD_STEP_SECONDS = 9;

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

/** A region orbits only once it has a completed mastery contract on record. */
function orbiting(regions: RegionSignal[]): RegionSignal[] {
  return regions.filter(
    (region) => (region.mastery_contracts_completed ?? 0) > 0,
  );
}

function orbitsFor(piece: UniversePiece, radius: number): GalaxyOrbit[] {
  return orbiting(piece.region_signals).map((region, index) => ({
    region_id: region.region_id,
    name: region.name,
    radius: radius + ORBIT_GAP * (index + 1),
    phase: fnv1a32(`region:${region.region_id}`) % 360,
    period: ORBIT_BASE_PERIOD_SECONDS + ORBIT_PERIOD_STEP_SECONDS * index,
    brightness: region.quality_brightness,
    evidence: "mastery_contracts_completed",
  }));
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
  const glow = (streak?.current_days ?? 0) > 0;
  const columns = Math.max(1, Math.floor(viewport.width / CELL_WIDTH));
  const stars = stableOrder(snapshot.pieces).map((piece, index) => {
    const radius = starRadius(piece.focused_seconds);
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
      // guessed one.
      ring: piece.earned_maturity ?? 0,
      glow,
      orbits: orbitsFor(piece, radius),
    };
  });
  // Nothing may be drawn outside the viewport at the dense floor: the widest
  // thing in a cell is the star plus its outermost orbit, and GUTTER keeps that
  // off the edge.
  const maxExtent = CELL_WIDTH / 2 - GUTTER;
  for (const star of stars) {
    star.radius = Math.min(star.radius, maxExtent);
  }
  return { viewport, stars };
}
