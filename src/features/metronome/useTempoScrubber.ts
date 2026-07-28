import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { UseMetronome } from "./useMetronome";

// Pixels of horizontal drag per 1 bpm on a tempo scrubber — a light touch so the
// tempo responds immediately but stays controllable. Shared by the popover wheel
// and the quick-bar readout so both surfaces feel identical.
export const PX_PER_BPM = 3.2;

// Pixels of wheel travel per 1 bpm. Accumulated so a trackpad's momentum stream
// steps the tempo smoothly instead of rocketing it.
const WHEEL_PX_PER_BPM = 24;

interface TempoScrubber {
  /** Spread onto the draggable element (pointer-capture horizontal drag = ±bpm). */
  dragHandlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
  /** Scroll-to-change, accumulated to WHEEL_PX_PER_BPM per step. */
  onWheel: (e: ReactWheelEvent<HTMLElement>) => void;
  /** Arrow keys nudge ±1 bpm. */
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
}

/**
 * Shared tempo-scrubbing gestures for any element that should drag/scroll to
 * change the metronome tempo. `bpm` is the current live tempo captured at the
 * start of a drag. Optimistic updates flow through `setBpmDrag` (throttled) with
 * a single unconditional `commitBpmDrag` flush on release; a plain scroll/arrow
 * uses `nudgeBpm`.
 */
export function useTempoScrubber(m: UseMetronome, bpm: number): TempoScrubber {
  const drag = useRef<{
    startX: number;
    startBpm: number;
    lastBpm: number;
  } | null>(null);
  const wheelAcc = useRef(0);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Not implemented in some environments (e.g. jsdom) — degrades to plain
        // move tracking, which the tests exercise.
      }
      drag.current = { startX: e.clientX, startBpm: bpm, lastBpm: bpm };
    },
    [bpm],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const next = d.startBpm + Math.round((e.clientX - d.startX) / PX_PER_BPM);
      if (next !== d.lastBpm) {
        d.lastBpm = next;
        m.setBpmDrag(next);
      }
    },
    [m],
  );

  const end = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (d) {
        try {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        } catch {
          // Nothing to release in environments without pointer capture.
        }
        m.commitBpmDrag(d.lastBpm);
      }
      drag.current = null;
    },
    [m],
  );

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLElement>) => {
      wheelAcc.current += e.deltaY;
      let steps = 0;
      // Scroll up (deltaY < 0) speeds up; scroll down slows down.
      while (wheelAcc.current <= -WHEEL_PX_PER_BPM) {
        wheelAcc.current += WHEEL_PX_PER_BPM;
        steps += 1;
      }
      while (wheelAcc.current >= WHEEL_PX_PER_BPM) {
        wheelAcc.current -= WHEEL_PX_PER_BPM;
        steps -= 1;
      }
      if (steps !== 0) m.nudgeBpm(steps);
    },
    [m],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        m.nudgeBpm(-1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        m.nudgeBpm(1);
      }
    },
    [m],
  );

  return {
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
    onWheel,
    onKeyDown,
  };
}
