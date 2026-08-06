// Pure, time-based stopwatch/countdown machine for the Clock dock panel
// (Task A6). No React, no timers, no `Date.now()` inside — every method
// takes the caller's `now` (epoch ms) explicitly, so all math is done by
// diffing against an anchor timestamp rather than accumulating interval
// ticks. That is the load-bearing property: a throttled/coalesced
// `setInterval` in the background (e.g. the tab is minimized and the browser
// slows timers to ~1/s or less) can NEVER drift the result — however late or
// irregularly `tick(now)` gets called, it always recomputes from the wall
// clock, not from "how many ticks happened".

export type TimerKind = "stopwatch" | "countdown";

export interface TimerSnapshot {
  /** Seconds left before a countdown reaches zero. Always 0 for a stopwatch
   * (a stopwatch has no target, so "remaining" is meaningless — 0 rather
   * than e.g. NaN/Infinity so callers can treat the field uniformly). */
  remaining: number;
  /** Seconds elapsed since the timer's own start (across pause/resume). For
   * a countdown this is clamped to the target — it never exceeds `seconds`. */
  elapsed: number;
  /** Countdown only: true once `elapsed >= seconds`. This is LEVEL truth —
   * it stays true on every subsequent tick, it is not an edge/pulse. Callers
   * that need a one-shot "just completed" signal (e.g. playing a chime) must
   * do their own false->true edge detection across calls; the machine does
   * not track "was this already reported" because that is UI/effect
   * concern, not timer state. Always false for a stopwatch. */
  done: boolean;
}

export interface TimerMachine {
  readonly kind: TimerKind;
  readonly seconds: number;
  /** Begins/resumes running from `now`. A no-op if already running. */
  start(now: number): void;
  /** Freezes the timer at `now`, banking elapsed time so a later `start`
   * resumes from here rather than losing the paused interval. A no-op if
   * already paused. */
  pause(now: number): void;
  /** Stops the timer and zeroes its banked elapsed time. */
  reset(): void;
  /** Pure read: computes {remaining, elapsed, done} as of `now`. Safe to
   * call any number of times with any spacing — never mutates run state. */
  tick(now: number): TimerSnapshot;
  isRunning(): boolean;
}

export const PRESET_MINUTES = [5, 15, 25, 45] as const;
export const MIN_CUSTOM_MINUTES = 1;
export const MAX_CUSTOM_MINUTES = 180;

/** Bounds a custom-minutes input to [MIN_CUSTOM_MINUTES, MAX_CUSTOM_MINUTES],
 * rounding to the nearest whole minute. Non-finite input (empty field mid-
 * edit, NaN) falls back to the floor rather than propagating garbage into
 * `createTimer`. */
export function clampCustomMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return MIN_CUSTOM_MINUTES;
  const rounded = Math.round(minutes);
  return Math.min(MAX_CUSTOM_MINUTES, Math.max(MIN_CUSTOM_MINUTES, rounded));
}

/** `mm:ss` (or `h:mm:ss` past an hour) display formatting shared by the
 * stopwatch and countdown readouts. Negative/NaN input is clamped to 0 —
 * a display helper never renders "-1:03". */
export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const whole = Math.floor(safe);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Creates a stopwatch (counts up, unbounded) or countdown (counts down from
 * `seconds`, `done` once it reaches zero) machine. `seconds` is ignored for
 * a stopwatch.
 */
export function createTimer(kind: TimerKind, seconds = 0): TimerMachine {
  let running = false;
  // The wall-clock instant the current run segment began.
  let anchor = 0;
  // Elapsed seconds banked from all PRIOR run segments (i.e. as of the last
  // pause). Combined with the live segment (now - anchor while running) this
  // gives total elapsed without ever accumulating per-tick deltas.
  let banked = 0;

  function elapsedAt(now: number): number {
    const live = running ? Math.max(0, (now - anchor) / 1000) : 0;
    return banked + live;
  }

  return {
    kind,
    seconds,
    start(now: number) {
      if (running) return;
      running = true;
      anchor = now;
    },
    pause(now: number) {
      if (!running) return;
      banked = elapsedAt(now);
      running = false;
    },
    reset() {
      running = false;
      anchor = 0;
      banked = 0;
    },
    isRunning() {
      return running;
    },
    tick(now: number): TimerSnapshot {
      const elapsed = elapsedAt(now);
      if (kind === "countdown") {
        const clampedElapsed = Math.min(elapsed, seconds);
        return {
          remaining: Math.max(0, seconds - elapsed),
          elapsed: clampedElapsed,
          done: elapsed >= seconds,
        };
      }
      return { remaining: 0, elapsed, done: false };
    },
  };
}
