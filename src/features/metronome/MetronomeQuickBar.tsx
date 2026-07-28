import { useCallback, useRef, useState } from "react";
import { MetronomePopover } from "./MetronomePopover";
import { UI_BPM_MAX, UI_BPM_MIN, useMetronome } from "./useMetronome";
import { useTempoScrubber } from "./useTempoScrubber";
import {
  MetronomeGlyph,
  PlayGlyph,
  StopGlyph,
  TapGlyph,
} from "./MetronomeIcons";
import "./MetronomeQuickBar.css";

// A tap older than this resets the tap-tempo buffer — a fresh count, not an
// average smeared across a pause.
const TAP_RESET_MS = 2000;
// Averaging window: the most recent taps only, so a settling tempo tracks.
const MAX_TAPS = 6;

/**
 * Always-available compact metronome controls for a workspace header: the
 * instrument icon (opens the full popover), a play/stop toggle, a live BPM
 * readout that drags/scrolls to change tempo, and tap-tempo. The play button is
 * a native button, so Space starts/stops it when focused; the full popover
 * keeps its own Space toggle. No global Space listener is installed here — that
 * would hijack Space from the notebook's text fields.
 */
export function MetronomeQuickBar() {
  const m = useMetronome();
  const { state } = m;
  const iconRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const scrub = useTempoScrubber(m, state.bpm);

  // Tap tempo: derive bpm from the average interval across recent taps. Uses
  // the wall clock (`Date.now`) — a few-second tap window is well within its
  // resolution, and it stays clear of React's scheduler clock (`performance`).
  const taps = useRef<number[]>([]);
  const onTap = useCallback(() => {
    const now = Date.now();
    const buf = taps.current;
    if (buf.length > 0 && now - buf[buf.length - 1] > TAP_RESET_MS) {
      buf.length = 0;
    }
    buf.push(now);
    if (buf.length > MAX_TAPS) buf.shift();
    if (buf.length >= 2) {
      let total = 0;
      for (let i = 1; i < buf.length; i += 1) total += buf[i] - buf[i - 1];
      const avg = total / (buf.length - 1);
      if (avg > 0) m.setBpm(Math.round(60000 / avg));
    }
  }, [m]);

  return (
    <div
      className="metro-qb"
      role="group"
      aria-label="Metronome quick controls"
    >
      <button
        ref={iconRef}
        type="button"
        className={`metro-qb-icon${open ? " is-open" : ""}`}
        aria-label="Open metronome"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MetronomeGlyph size={20} />
      </button>

      <button
        type="button"
        className="metro-qb-play"
        data-running={state.running}
        aria-label={state.running ? "Stop metronome" : "Start metronome"}
        aria-pressed={state.running}
        onClick={m.toggle}
      >
        {state.running ? <StopGlyph size={18} /> : <PlayGlyph size={18} />}
      </button>

      <div
        className="metro-qb-readout"
        role="slider"
        aria-label="Tempo, beats per minute"
        aria-valuemin={UI_BPM_MIN}
        aria-valuemax={UI_BPM_MAX}
        aria-valuenow={state.bpm}
        tabIndex={0}
        {...scrub.dragHandlers}
        onWheel={scrub.onWheel}
        onKeyDown={scrub.onKeyDown}
      >
        <span className="metro-qb-bpm">{state.bpm}</span>
        <span className="metro-qb-unit">BPM</span>
      </div>

      <button
        type="button"
        className="metro-qb-tap"
        aria-label="Tap tempo"
        onClick={onTap}
      >
        <TapGlyph size={16} />
        <span>Tap</span>
      </button>

      <MetronomePopover
        anchorRef={iconRef}
        open={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
