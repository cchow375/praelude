import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Popover } from "../../components/Popover";
import {
  MAX_BEATS_PER_BAR,
  MAX_GAIN,
  MAX_SUBDIVISION,
  MIN_BEATS_PER_BAR,
  SOUNDS,
  parseBpmInput,
  tempoName,
  useMetronome,
} from "./useMetronome";
import "./MetronomePopover.css";

// Pixels of horizontal drag per 1 bpm on the tempo wheel — a light touch so the
// tempo responds immediately but stays controllable.
const PX_PER_BPM = 3.2;

interface MetronomePopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}

/**
 * The metronome instrument: a single popover with a large tempo readout (tap
 * ±1, drag-wheel, direct type), Italian tempo name, beats-per-bar & subdivision
 * steppers, a 6-sound picker with instant preview, a gain slider, a boost
 * toggle, and start/stop. Space toggles start/stop while the popover is open.
 * Nothing is pinned outside the popover.
 */
export function MetronomePopover({ anchorRef, open, onClose }: MetronomePopoverProps) {
  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} label="Metronome">
      <MetronomePanel open={open} />
    </Popover>
  );
}

function MetronomePanel({ open }: { open: boolean }) {
  const m = useMetronome();
  const { state } = m;

  // Direct-typing draft for the tempo readout. Null = show the live bpm.
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitDraft = useCallback(() => {
    setDraft((d) => {
      if (d != null) {
        const parsed = parseBpmInput(d);
        if (parsed != null) m.setBpm(parsed);
      }
      return null;
    });
  }, [m]);

  // Space toggles start/stop while open — unless the user is typing in a field.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      m.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, m]);

  // --- Tempo wheel (horizontal drag = ±1 bpm / few px, with pointer capture) --
  const drag = useRef<{ startX: number; startBpm: number } | null>(null);

  const onWheelPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startX: e.clientX, startBpm: state.bpm };
    },
    [state.bpm],
  );

  const onWheelPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      const next = d.startBpm + Math.round((e.clientX - d.startX) / PX_PER_BPM);
      if (next !== state.bpm) m.setBpm(next);
    },
    [m, state.bpm],
  );

  const endWheelDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    drag.current = null;
  }, []);

  // Beat-flash sweep: pure CSS. The dots animate at the bar/beat period derived
  // from bpm — durations set here, never a per-beat JS timer.
  const beatPeriod = 60 / Math.max(state.bpm, 1);
  const barPeriod = beatPeriod * Math.max(state.beats_per_bar, 1);
  const beats = Math.min(Math.max(state.beats_per_bar, 1), MAX_BEATS_PER_BAR);
  const beatDots = useMemo(() => Array.from({ length: beats }, (_, i) => i), [beats]);

  const tempoValue = draft ?? String(state.bpm);

  return (
    <div className="metro">
      {/* Tempo readout ------------------------------------------------------ */}
      <section className="metro-tempo">
        <div className="metro-tempo-row">
          <button
            type="button"
            className="metro-nudge"
            aria-label="Decrease tempo"
            onClick={() => m.nudgeBpm(-1)}
          >
            −
          </button>
          <div className="metro-readout">
            <input
              ref={inputRef}
              className="metro-bpm"
              type="text"
              inputMode="numeric"
              aria-label="Tempo, beats per minute"
              value={tempoValue}
              onFocus={(e) => {
                setDraft(String(state.bpm));
                e.currentTarget.select();
              }}
              onChange={(e) => setDraft(e.currentTarget.value.replace(/[^0-9]/g, ""))}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitDraft();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setDraft(null);
                  e.currentTarget.blur();
                }
              }}
            />
            <span className="metro-bpm-unit">BPM</span>
          </div>
          <button
            type="button"
            className="metro-nudge"
            aria-label="Increase tempo"
            onClick={() => m.nudgeBpm(1)}
          >
            +
          </button>
        </div>
        <p className="metro-tempo-name">{tempoName(state.bpm)}</p>
        <div
          className="metro-wheel"
          role="slider"
          aria-label="Tempo wheel"
          aria-valuemin={20}
          aria-valuemax={300}
          aria-valuenow={state.bpm}
          tabIndex={0}
          onPointerDown={onWheelPointerDown}
          onPointerMove={onWheelPointerMove}
          onPointerUp={endWheelDrag}
          onPointerCancel={endWheelDrag}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              m.nudgeBpm(-1);
            } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              m.nudgeBpm(1);
            }
          }}
        >
          <div
            className="metro-wheel-ticks"
            style={{ backgroundPositionX: `${-state.bpm * 6}px` }}
          />
        </div>
      </section>

      {/* Beat-flash indicator ---------------------------------------------- */}
      <div
        className="metro-beats"
        data-running={state.running}
        aria-hidden="true"
        style={
          {
            "--bar-period": `${barPeriod}s`,
            "--beat-period": `${beatPeriod}s`,
          } as React.CSSProperties
        }
      >
        {beatDots.map((i) => (
          <span
            key={i}
            className="metro-beat-dot"
            data-accent={state.accent_first && i === 0}
            style={{ animationDelay: `${i * beatPeriod}s` }}
          />
        ))}
      </div>

      {/* Steppers ----------------------------------------------------------- */}
      <div className="metro-steppers">
        <Stepper
          label="Beats"
          value={state.beats_per_bar}
          min={MIN_BEATS_PER_BAR}
          max={MAX_BEATS_PER_BAR}
          onChange={m.setBeatsPerBar}
        />
        <Stepper
          label="Subdiv"
          value={state.subdivision}
          min={1}
          max={MAX_SUBDIVISION}
          onChange={m.setSubdivision}
        />
      </div>

      {/* Accent toggle ------------------------------------------------------ */}
      <label className="metro-accent">
        <span className="metro-accent-label">Accent first beat</span>
        <Switch checked={state.accent_first} onChange={m.setAccent} label="Accent first beat" />
      </label>

      {/* Sound picker ------------------------------------------------------- */}
      <section className="metro-sounds" aria-label="Click sound">
        {SOUNDS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="metro-sound"
            aria-pressed={state.sound === s.id}
            data-selected={state.sound === s.id}
            onClick={() => void m.selectSound(s.id)}
          >
            {s.label}
          </button>
        ))}
      </section>

      {/* Gain slider -------------------------------------------------------- */}
      <div className="metro-gain">
        <div className="metro-gain-head">
          <span className="metro-gain-label">Volume</span>
          <span className="metro-gain-value">{Math.round(state.gain * 100)}%</span>
        </div>
        <input
          className="metro-slider"
          type="range"
          min={0}
          max={MAX_GAIN}
          step={0.05}
          value={state.gain}
          aria-label="Click volume"
          onChange={(e) => m.setGain(Number(e.currentTarget.value))}
        />
      </div>

      {/* Boost toggle ------------------------------------------------------- */}
      <label className="metro-boost">
        <span className="metro-boost-text">
          <span className="metro-boost-label">Boost</span>
          <span className="metro-boost-hint">Raises system volume while playing</span>
        </span>
        <Switch checked={state.boost} onChange={m.setBoost} label="Boost system volume" />
      </label>

      {/* Transport ---------------------------------------------------------- */}
      <button
        type="button"
        className="metro-transport"
        data-running={state.running}
        onClick={m.toggle}
      >
        {state.running ? "Stop" : "Start"}
      </button>

      {/* Inline rejection notice ------------------------------------------- */}
      {m.error && (
        <div className="metro-error" role="status">
          <span>{m.error}</span>
          <button
            type="button"
            className="metro-error-dismiss"
            aria-label="Dismiss"
            onClick={m.clearError}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="metro-stepper">
      <span className="metro-stepper-label">{label}</span>
      <div className="metro-stepper-control">
        <button
          type="button"
          className="metro-step"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          −
        </button>
        <span className="metro-stepper-value">{value}</span>
        <button
          type="button"
          className="metro-step"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="metro-switch"
      data-on={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="metro-switch-thumb" />
    </button>
  );
}
