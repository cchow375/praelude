import { describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_MINUTES,
  MIN_CUSTOM_MINUTES,
  clampCustomMinutes,
  createTimer,
  formatClock,
} from "./timerMachine";

const T0 = 1_700_000_000_000; // arbitrary fixed epoch ms anchor for all tests

describe("createTimer — stopwatch", () => {
  it("elapsed counts up from start, remaining stays 0, done stays false", () => {
    const sw = createTimer("stopwatch");
    sw.start(T0);
    expect(sw.tick(T0 + 3_000)).toEqual({
      remaining: 0,
      elapsed: 3,
      done: false,
    });
    expect(sw.tick(T0 + 12_500)).toEqual({
      remaining: 0,
      elapsed: 12.5,
      done: false,
    });
  });

  it("pause freezes elapsed; resume continues from the banked amount, not from 0", () => {
    const sw = createTimer("stopwatch");
    sw.start(T0);
    sw.pause(T0 + 5_000); // banked = 5s
    expect(sw.tick(T0 + 5_000)).toMatchObject({ elapsed: 5 });
    expect(sw.tick(T0 + 50_000)).toMatchObject({ elapsed: 5 }); // frozen while paused
    expect(sw.isRunning()).toBe(false);

    sw.start(T0 + 50_000); // resume
    expect(sw.tick(T0 + 52_000)).toMatchObject({ elapsed: 7 }); // 5 banked + 2 live
  });

  it("reset zeroes elapsed and stops the run", () => {
    const sw = createTimer("stopwatch");
    sw.start(T0);
    sw.reset();
    expect(sw.isRunning()).toBe(false);
    expect(sw.tick(T0 + 9_999)).toEqual({
      remaining: 0,
      elapsed: 0,
      done: false,
    });
  });

  it("start is a no-op while already running (does not reset the anchor)", () => {
    const sw = createTimer("stopwatch");
    sw.start(T0);
    sw.start(T0 + 4_000); // should be ignored — already running
    expect(sw.tick(T0 + 6_000)).toMatchObject({ elapsed: 6 });
  });
});

describe("createTimer — countdown", () => {
  it("counts down and reaches done exactly at the target, remaining 0", () => {
    const cd = createTimer("countdown", 10);
    cd.start(T0);
    expect(cd.tick(T0 + 4_000)).toEqual({
      remaining: 6,
      elapsed: 4,
      done: false,
    });
    expect(cd.tick(T0 + 10_000)).toEqual({
      remaining: 0,
      elapsed: 10,
      done: true,
    });
  });

  it("done is LEVEL truth: stays true on every subsequent tick past the target", () => {
    const cd = createTimer("countdown", 5);
    cd.start(T0);
    expect(cd.tick(T0 + 5_000).done).toBe(true);
    expect(cd.tick(T0 + 5_001).done).toBe(true);
    expect(cd.tick(T0 + 999_999).done).toBe(true);
    // elapsed/remaining stay clamped at the target rather than drifting past it.
    expect(cd.tick(T0 + 999_999)).toEqual({
      remaining: 0,
      elapsed: 5,
      done: true,
    });
  });

  it("pause/resume: a paused countdown does not keep counting down while frozen", () => {
    const cd = createTimer("countdown", 20);
    cd.start(T0);
    cd.pause(T0 + 6_000); // banked = 6s elapsed, 14s remaining
    expect(cd.tick(T0 + 6_000)).toMatchObject({ elapsed: 6, remaining: 14 });
    expect(cd.tick(T0 + 500_000)).toMatchObject({ elapsed: 6, remaining: 14 });

    cd.start(T0 + 500_000);
    expect(cd.tick(T0 + 503_000)).toMatchObject({ elapsed: 9, remaining: 11 });
  });

  it("is TIME-BASED: irregular/coalesced tick spacing never drifts the result (background-tab throttling)", () => {
    // A background interval that gets throttled to fire once every 4s
    // (instead of every 1s) must still land on the exact same remaining
    // value as a steady 1s cadence would have, because tick(now) always
    // recomputes from the anchor rather than accumulating per-call deltas.
    const cd = createTimer("countdown", 30);
    cd.start(T0);

    // Irregular, sparse calls simulating a minimized/throttled tab.
    cd.tick(T0 + 1_000);
    cd.tick(T0 + 1_050); // duplicate-ish call very soon after
    cd.tick(T0 + 9_000); // a big gap (throttled interval)
    const midway = cd.tick(T0 + 17_000);
    expect(midway).toEqual({ remaining: 13, elapsed: 17, done: false });

    // A steady-cadence machine started at the same instant and read at the
    // same wall-clock moment must agree exactly.
    const steady = createTimer("countdown", 30);
    steady.start(T0);
    for (let ms = 1_000; ms <= 17_000; ms += 1_000) {
      steady.tick(T0 + ms);
    }
    expect(steady.tick(T0 + 17_000)).toEqual(midway);
  });

  it("reset stops the run and clears banked elapsed", () => {
    const cd = createTimer("countdown", 10);
    cd.start(T0);
    cd.pause(T0 + 4_000);
    cd.reset();
    expect(cd.isRunning()).toBe(false);
    cd.start(T0 + 100_000);
    expect(cd.tick(T0 + 101_000)).toMatchObject({ elapsed: 1, remaining: 9 });
  });
});

describe("clampCustomMinutes", () => {
  it("passes through an in-range value unchanged", () => {
    expect(clampCustomMinutes(45)).toBe(45);
  });

  it("clamps below the floor up to MIN_CUSTOM_MINUTES", () => {
    expect(clampCustomMinutes(0)).toBe(MIN_CUSTOM_MINUTES);
    expect(clampCustomMinutes(-5)).toBe(MIN_CUSTOM_MINUTES);
  });

  it("clamps above the ceiling down to MAX_CUSTOM_MINUTES", () => {
    expect(clampCustomMinutes(181)).toBe(MAX_CUSTOM_MINUTES);
    expect(clampCustomMinutes(9999)).toBe(MAX_CUSTOM_MINUTES);
  });

  it("falls back to the floor for non-finite input", () => {
    expect(clampCustomMinutes(NaN)).toBe(MIN_CUSTOM_MINUTES);
    expect(clampCustomMinutes(Infinity)).toBe(MIN_CUSTOM_MINUTES);
  });

  it("rounds a fractional value to the nearest whole minute", () => {
    expect(clampCustomMinutes(12.6)).toBe(13);
  });
});

describe("formatClock", () => {
  it("formats sub-hour durations as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(599)).toBe("9:59");
  });

  it("formats hour-plus durations as h:mm:ss", () => {
    expect(formatClock(3661)).toBe("1:01:01");
  });

  it("clamps negative/NaN input to 0 rather than rendering garbage", () => {
    expect(formatClock(-10)).toBe("0:00");
    expect(formatClock(NaN)).toBe("0:00");
  });
});
