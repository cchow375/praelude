import { describe, expect, it } from "vitest";
import {
  INITIAL_TARGET_MODE,
  MAX_MARKERS,
  TRACE_EVENT_COUNT,
  TRACE_WINDOW_MS,
  landingFor,
  reduceTargetMode,
  targetZone,
  type TargetModeState,
} from "./targetMode";
import type { DynamicsProfile } from "./calibration";

const profile: DynamicsProfile = {
  id: 1,
  device_id: "default-input",
  label: "Steinway",
  active: true,
  created_at: "",
  points: [
    { dynamic_label: "pp", measured_db: -48 },
    { dynamic_label: "p", measured_db: -38 },
    { dynamic_label: "mf", measured_db: -28 },
    { dynamic_label: "f", measured_db: -18 },
    { dynamic_label: "ff", measured_db: -9 },
  ],
};

describe("targetZone", () => {
  it("gives a single dynamic a zone halfway to each neighbour", () => {
    expect(targetZone({ kind: "single", dynamic: "mf" }, profile)).toEqual({
      lowDb: -33,
      highDb: -23,
    });
  });

  it("clamps the outermost dynamics' zones to the calibrated ends", () => {
    expect(targetZone({ kind: "single", dynamic: "pp" }, profile).lowDb).toBe(
      -48,
    );
    expect(targetZone({ kind: "single", dynamic: "ff" }, profile).highDb).toBe(
      -9,
    );
  });

  it("spans a crescendo from the low edge of `from` to the high edge of `to`", () => {
    expect(
      targetZone({ kind: "crescendo", from: "p", to: "f" }, profile),
    ).toEqual({ lowDb: -43, highDb: -13.5 });
  });

  it("reports a backwards crescendo range as the range it covers", () => {
    expect(
      targetZone({ kind: "crescendo", from: "f", to: "p" }, profile),
    ).toEqual({ lowDb: -33, highDb: -23 });
  });
});

describe("landingFor", () => {
  const zone = { lowDb: -33, highDb: -23 };

  it("lands on the trace median, so one stray bang cannot flip the marker", () => {
    expect(landingFor([-29, -28, -30, -28, -4], zone)).toBe("in");
  });

  it("reports under and over honestly", () => {
    expect(landingFor([-40, -41, -39], zone)).toBe("under");
    expect(landingFor([-15, -14, -16], zone)).toBe("over");
  });

  it("treats the zone edges as inside it", () => {
    expect(landingFor([-33], zone)).toBe("in");
    expect(landingFor([-23], zone)).toBe("in");
  });
});

describe("reduceTargetMode", () => {
  const level = (state: TargetModeState, rmsDb: number, count: number) => {
    let next = state;
    for (let i = 0; i < count; i += 1) {
      next = reduceTargetMode(next, {
        type: "level",
        rmsDb,
        tsMs: i * 125,
        profile,
      });
    }
    return next;
  };

  it("ignores levels while target mode is off", () => {
    const next = level(INITIAL_TARGET_MODE, -28, TRACE_EVENT_COUNT * 2);
    expect(next).toEqual(INITIAL_TARGET_MODE);
  });

  it("ignores levels while no target has been chosen", () => {
    const on = reduceTargetMode(INITIAL_TARGET_MODE, { type: "toggle" });
    expect(level(on, -28, TRACE_EVENT_COUNT).markers).toEqual([]);
  });

  it("appends one marker per completed trace", () => {
    let state = reduceTargetMode(INITIAL_TARGET_MODE, { type: "toggle" });
    state = reduceTargetMode(state, {
      type: "setTarget",
      target: { kind: "single", dynamic: "mf" },
    });
    state = level(state, -28, TRACE_EVENT_COUNT - 1);
    expect(state.markers).toHaveLength(0);
    state = level(state, -28, 1);
    expect(state.markers).toHaveLength(1);
    expect(state.markers[0].landing).toBe("in");
    expect(state.markers[0].medianDb).toBe(-28);
    expect(state.trace).toEqual([]);
  });

  it("keeps at most six markers", () => {
    let state = reduceTargetMode(INITIAL_TARGET_MODE, {
      type: "setTarget",
      target: { kind: "single", dynamic: "mf" },
    });
    for (let t = 0; t < MAX_MARKERS + 3; t += 1) {
      state = level(state, -28, TRACE_EVENT_COUNT);
    }
    expect(state.markers).toHaveLength(MAX_MARKERS);
    // The six KEPT markers are the six most recent ones.
    expect(state.markers.map((m) => m.id)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it("clears the markers when target mode turns off", () => {
    let state = reduceTargetMode(INITIAL_TARGET_MODE, {
      type: "setTarget",
      target: { kind: "single", dynamic: "mf" },
    });
    state = level(state, -28, TRACE_EVENT_COUNT);
    expect(state.markers).toHaveLength(1);
    state = reduceTargetMode(state, { type: "toggle" });
    expect(state.on).toBe(false);
    expect(state.markers).toEqual([]);
    expect(state.target).toBeNull();
  });

  it("clears the trace and markers when the target changes", () => {
    let state = reduceTargetMode(INITIAL_TARGET_MODE, {
      type: "setTarget",
      target: { kind: "single", dynamic: "mf" },
    });
    state = level(state, -28, TRACE_EVENT_COUNT + 3);
    expect(state.markers).toHaveLength(1);
    expect(state.trace).toHaveLength(3);
    state = reduceTargetMode(state, {
      type: "setTarget",
      target: { kind: "single", dynamic: "f" },
    });
    expect(state.markers).toEqual([]);
    expect(state.trace).toEqual([]);
  });

  it("reports under and over traces honestly", () => {
    let state = reduceTargetMode(INITIAL_TARGET_MODE, {
      type: "setTarget",
      target: { kind: "single", dynamic: "mf" },
    });
    state = level(state, -45, TRACE_EVENT_COUNT);
    state = level(state, -12, TRACE_EVENT_COUNT);
    expect(state.markers.map((m) => m.landing)).toEqual(["under", "over"]);
  });

  it("keeps the 3s trace window and the 8 Hz tick count in agreement", () => {
    expect(TRACE_EVENT_COUNT).toBe(TRACE_WINDOW_MS / 125);
  });
});
