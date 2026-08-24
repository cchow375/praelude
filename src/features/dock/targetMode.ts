import {
  DYNAMIC_LABELS,
  medianDb,
  type DynamicLabel,
  type DynamicsProfile,
} from "./calibration";

/**
 * Target mode (Plan B, task B4): pick a dynamic (or a crescendo range), play,
 * and see where the playing actually landed on the calibrated band.
 *
 * THE LAW, and the reason this whole file is pure: the app reports levels and
 * Christian judges the music. There is no grade here, no verdict, no score.
 * A marker says "the median of those three seconds sat below / inside / above
 * the zone you asked for" — a measurement, not an opinion.
 *
 * ZERO WRITES. Every value here is React state and nothing else: no
 * persistence, no Tauri command, no event append, no localStorage. Markers live
 * for the life of the panel and are gone on reload — that is the point, and
 * `dynamicsNoWrites.test.tsx` is the standing proof.
 */

export type Target =
  | { kind: "single"; dynamic: DynamicLabel }
  | { kind: "crescendo"; from: DynamicLabel; to: DynamicLabel };

/** The dB window a target maps to under a profile. */
export interface TargetZone {
  lowDb: number;
  highDb: number;
}

export type Landing = "under" | "in" | "over";

export const TRACE_WINDOW_MS = 3_000;
/** The meter ticks at 8 Hz, so a 3 s trace is 24 events. */
export const TRACE_EVENT_COUNT = 24;
export const MAX_MARKERS = 6;

export interface LandedMarker {
  id: number;
  medianDb: number;
  landing: Landing;
  atMs: number;
}

function dbFor(profile: DynamicsProfile, dynamic: DynamicLabel): number {
  const point = profile.points.find((p) => p.dynamic_label === dynamic);
  return point ? point.measured_db : Number.NaN;
}

/** Half-way down to the quieter neighbour, or the calibrated end itself at pp. */
function lowEdge(profile: DynamicsProfile, dynamic: DynamicLabel): number {
  const index = DYNAMIC_LABELS.indexOf(dynamic);
  const here = dbFor(profile, dynamic);
  if (index <= 0) return here;
  const below = dbFor(profile, DYNAMIC_LABELS[index - 1]);
  return (here + below) / 2;
}

/** Half-way up to the louder neighbour, or the calibrated end itself at ff. */
function highEdge(profile: DynamicsProfile, dynamic: DynamicLabel): number {
  const index = DYNAMIC_LABELS.indexOf(dynamic);
  const here = dbFor(profile, dynamic);
  if (index < 0 || index >= DYNAMIC_LABELS.length - 1) return here;
  const above = dbFor(profile, DYNAMIC_LABELS[index + 1]);
  return (here + above) / 2;
}

/**
 * The dB window a target maps to under `profile`. A single dynamic gets a
 * tolerance band of half the distance to each neighbour, clamped to the
 * calibrated ends at pp and ff; a crescendo spans from the low edge of `from`
 * to the high edge of `to`.
 */
export function targetZone(
  target: Target,
  profile: DynamicsProfile,
): TargetZone {
  if (target.kind === "single") {
    return {
      lowDb: lowEdge(profile, target.dynamic),
      highDb: highEdge(profile, target.dynamic),
    };
  }
  const low = lowEdge(profile, target.from);
  const high = highEdge(profile, target.to);
  // A backwards range is still a range; report it the way it was asked for
  // rather than silently rewriting what the user chose.
  return low <= high
    ? { lowDb: low, highDb: high }
    : { lowDb: high, highDb: low };
}

/**
 * Where a completed trace sat relative to the zone. Uses the trace's MEDIAN
 * rms, so one accidental bang cannot decide the marker.
 */
export function landingFor(traceRmsDb: number[], zone: TargetZone): Landing {
  const median = medianDb(traceRmsDb);
  if (!Number.isFinite(median)) return "under";
  if (median < zone.lowDb) return "under";
  if (median > zone.highDb) return "over";
  return "in";
}

export interface TargetModeState {
  on: boolean;
  target: Target | null;
  /** The in-flight trace's rms samples. */
  trace: number[];
  markers: LandedMarker[];
  nextId: number;
}

export type TargetModeEvent =
  | { type: "toggle" }
  | { type: "setTarget"; target: Target }
  | { type: "level"; rmsDb: number; tsMs: number; profile: DynamicsProfile };

export const INITIAL_TARGET_MODE: TargetModeState = {
  on: false,
  target: null,
  trace: [],
  markers: [],
  nextId: 1,
};

/**
 * Pure reducer. `state` is React state and NOTHING else — no persistence, no
 * command, no event append.
 */
export function reduceTargetMode(
  state: TargetModeState,
  event: TargetModeEvent,
): TargetModeState {
  switch (event.type) {
    case "toggle":
      // Leaving target mode clears the markers: they are about the run that
      // just happened, not a record to keep.
      return state.on
        ? { ...INITIAL_TARGET_MODE, nextId: state.nextId }
        : { ...state, on: true, trace: [], markers: [] };

    case "setTarget":
      // A new target invalidates the in-flight trace and everything measured
      // against the old one.
      return { ...state, on: true, target: event.target, trace: [], markers: [] };

    case "level": {
      if (!state.on || !state.target) return state;
      const trace = [...state.trace, event.rmsDb];
      if (trace.length < TRACE_EVENT_COUNT) return { ...state, trace };
      const zone = targetZone(state.target, event.profile);
      const marker: LandedMarker = {
        id: state.nextId,
        medianDb: medianDb(trace),
        landing: landingFor(trace, zone),
        atMs: event.tsMs,
      };
      return {
        ...state,
        trace: [],
        markers: [...state.markers, marker].slice(-MAX_MARKERS),
        nextId: state.nextId + 1,
      };
    }

    default:
      return state;
  }
}
