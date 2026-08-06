import { useEffect, useRef, useState } from "react";
import { DockPanel } from "./DockPanel";
import { useDock } from "./DockProvider";
import { Button } from "../../ui";
import { NAV_RAIL_WIDTH } from "./dockState";
import {
  ASSUMED_MAX_HEIGHT as PAUSED_ASSUMED_MAX_HEIGHT,
  DEFAULT_POSITION as PAUSED_DEFAULT_POSITION,
} from "./PausedSetsTray";
import {
  MAX_CUSTOM_MINUTES,
  MIN_CUSTOM_MINUTES,
  PRESET_MINUTES,
  clampCustomMinutes,
  createTimer,
  formatClock,
  type TimerMachine,
} from "./timerMachine";
import "./dock.css";

/** Fix wave item 9: below the paused-sets tray's own (rep-derived) default
 * spot, clear of the nav rail — see RepPanel.tsx/PausedSetsTray.tsx for the
 * same reasoning. All three panels default CLOSED (a pill, per item 7), so
 * this position is only ever used once a panel is actually opened. */
export const DEFAULT_POSITION = {
  x: NAV_RAIL_WIDTH + 12,
  y: PAUSED_DEFAULT_POSITION.y + PAUSED_ASSUMED_MAX_HEIGHT + 24,
};

/** How often the display re-renders. Purely cosmetic — the underlying
 * `timerMachine` is time-based (tick(now) diffs against an anchor
 * timestamp), so a throttled/coalesced background interval can slow this
 * display refresh down without ever drifting the actual elapsed/remaining
 * math once the tab/window regains focus and a tick finally fires. */
const DISPLAY_INTERVAL_MS = 1_000;

/** Minimal seam so tests can stub playback without touching the real
 * `HTMLAudioElement`/browser autoplay policy. Defaults to the real `Audio`
 * constructor. */
export type AudioFactory = (src: string) => { play: () => Promise<void> };

const defaultAudioFactory: AudioFactory = (src) =>
  new Audio(src) as unknown as { play: () => Promise<void> };

export interface ClockPanelProps {
  /** Test-only override; production always uses `new Audio(...)`. */
  audioFactory?: AudioFactory;
}

/**
 * Task A6: the clock dock panel — a local time-of-day readout, one
 * stopwatch, and one countdown (5/15/25/45-minute presets plus a 1–180
 * custom-minutes field) sharing the panel. Completion of the countdown
 * plays `chime.wav` and flashes the dock pill so it's noticeable even while
 * minimized.
 */
export function ClockPanel({
  audioFactory = defaultAudioFactory,
}: ClockPanelProps = {}) {
  const dock = useDock("clock");

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(
      () => setNow(Date.now()),
      DISPLAY_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  const stopwatch = useRef<TimerMachine>(createTimer("stopwatch"));
  const [swRunning, setSwRunning] = useState(false);
  const [swSnap, setSwSnap] = useState(() =>
    stopwatch.current.tick(Date.now()),
  );

  const [customMinutes, setCustomMinutes] = useState(15);
  const countdownSeconds = useRef(customMinutes * 60);
  const countdown = useRef<TimerMachine>(
    createTimer("countdown", countdownSeconds.current),
  );
  const [cdRunning, setCdRunning] = useState(false);
  const [cdSnap, setCdSnap] = useState(() =>
    countdown.current.tick(Date.now()),
  );
  // Edge-detection: the machine's `done` is level truth (stays true on every
  // tick past the target — see timerMachine.ts). The chime/flash must fire
  // exactly once per run, so this tracks whether THIS run has already fired.
  const chimedThisRun = useRef(false);

  // Recompute both machines' snapshots on every `now` tick (display refresh)
  // AND immediately after any control click (start/pause/reset/preset),
  // rather than only on the interval — a click should update the readout at
  // once instead of waiting up to a second.
  const recompute = (at: number) => {
    setSwSnap(stopwatch.current.tick(at));
    const snap = countdown.current.tick(at);
    setCdSnap(snap);
    if (snap.done && !chimedThisRun.current) {
      chimedThisRun.current = true;
      void playChime();
      dock.flash();
    }
  };

  useEffect(() => {
    recompute(now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  async function playChime() {
    try {
      const audio = audioFactory("/chime.wav");
      await audio.play();
    } catch {
      // Autoplay can be blocked, or jsdom's stub can reject — the chime is a
      // nice-to-have signal, never load-bearing for the countdown's own
      // done/flash state, so a rejected play() promise is swallowed here.
    }
  }

  function startStopwatch() {
    stopwatch.current.start(Date.now());
    setSwRunning(true);
    recompute(Date.now());
  }
  function pauseStopwatch() {
    stopwatch.current.pause(Date.now());
    setSwRunning(false);
    recompute(Date.now());
  }
  function resetStopwatch() {
    stopwatch.current.reset();
    setSwRunning(false);
    recompute(Date.now());
  }

  function loadCountdown(minutes: number) {
    const bounded = clampCustomMinutes(minutes);
    countdownSeconds.current = bounded * 60;
    countdown.current = createTimer("countdown", countdownSeconds.current);
    chimedThisRun.current = false;
    setCdRunning(false);
    setCustomMinutes(bounded);
    recompute(Date.now());
  }
  function startCountdown() {
    countdown.current.start(Date.now());
    setCdRunning(true);
    recompute(Date.now());
  }
  function pauseCountdown() {
    countdown.current.pause(Date.now());
    setCdRunning(false);
    recompute(Date.now());
  }
  function resetCountdown() {
    countdown.current.reset();
    chimedThisRun.current = false;
    setCdRunning(false);
    recompute(Date.now());
  }

  return (
    <DockPanel id="clock" title="Clock" defaultPosition={DEFAULT_POSITION}>
      <div className="clock-panel-time" aria-label="Current time">
        {new Date(now).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        })}
      </div>

      <section className="clock-panel-section">
        <h3 className="clock-panel-heading">Stopwatch</h3>
        <div className="clock-panel-readout">{formatClock(swSnap.elapsed)}</div>
        <div className="clock-panel-controls">
          {swRunning ? (
            <Button type="button" onClick={pauseStopwatch}>
              Pause
            </Button>
          ) : (
            <Button type="button" onClick={startStopwatch}>
              {swSnap.elapsed > 0 ? "Resume" : "Start"}
            </Button>
          )}
          <Button type="button" onClick={resetStopwatch}>
            Reset
          </Button>
        </div>
      </section>

      <section className="clock-panel-section">
        <h3 className="clock-panel-heading">Countdown</h3>
        <div
          className={
            cdSnap.done
              ? "clock-panel-readout clock-panel-readout-done"
              : "clock-panel-readout"
          }
        >
          {formatClock(cdSnap.remaining)}
        </div>
        <div className="clock-panel-presets">
          {PRESET_MINUTES.map((minutes) => (
            <Button
              key={minutes}
              type="button"
              variant={customMinutes === minutes ? "primary" : "text"}
              disabled={cdRunning}
              onClick={() => loadCountdown(minutes)}
            >
              {minutes}m
            </Button>
          ))}
        </div>
        <label className="clock-panel-custom">
          Custom minutes
          <input
            type="number"
            className="ck-input"
            min={MIN_CUSTOM_MINUTES}
            max={MAX_CUSTOM_MINUTES}
            value={customMinutes}
            disabled={cdRunning}
            onChange={(e) => loadCountdown(Number(e.target.value))}
          />
        </label>
        <div className="clock-panel-controls">
          {cdRunning ? (
            <Button type="button" onClick={pauseCountdown}>
              Pause
            </Button>
          ) : (
            <Button
              type="button"
              onClick={startCountdown}
              disabled={cdSnap.done}
            >
              {cdSnap.elapsed > 0 ? "Resume" : "Start"}
            </Button>
          )}
          <Button type="button" onClick={resetCountdown}>
            Reset
          </Button>
        </div>
      </section>
    </DockPanel>
  );
}
