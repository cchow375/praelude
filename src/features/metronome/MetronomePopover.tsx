import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Popover } from "../../components/Popover";
import {
  MAX_BEATS_PER_BAR,
  MAX_GAIN,
  MAX_SUBDIVISION,
  MIN_BEATS_PER_BAR,
  SOUNDS,
  UI_BPM_MAX,
  UI_BPM_MIN,
  parseBpmInput,
  tempoName,
  useMetronome,
} from "./useMetronome";
import { useTempoScrubber } from "./useTempoScrubber";
import {
  AccentGlyph,
  BeatsGlyph,
  BoostGlyph,
  MinusGlyph,
  PlayGlyph,
  PlusGlyph,
  SoundGlyph,
  StopGlyph,
  SubdivGlyph,
  VolumeGlyph,
} from "./MetronomeIcons";
import "./MetronomePopover.css";

// Interactive controls that must keep native Space/Enter activation — the
// space-toggle window listener must never hijack Space from these.
const INTERACTIVE_SELECTOR =
  'button, input, textarea, select, [role="switch"], [role="slider"], [contenteditable]';

interface MetronomePopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}

/**
 * The metronome instrument: a single fixed-grid popover that never scrolls at
 * the default window size. A large tempo readout (nudge ±1, drag/scroll wheel,
 * direct type) with its Italian tempo name, icon-labelled beats-per-bar &
 * subdivision steppers, a 6-sound picker with instant preview, an icon volume
 * slider, accent + boost toggles, and start/stop. Space toggles start/stop
 * while the popover is open. Nothing is pinned outside the popover.
 */
export function MetronomePopover({
  anchorRef,
  open,
  onClose,
}: MetronomePopoverProps) {
  return (
    <Popover
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      label="Metronome"
    >
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

  // Space toggles start/stop while open — unless an interactive control (a
  // button, the tempo input, a switch, the wheel slider, etc.) has focus, in
  // which case native Space/Enter activation of THAT control must proceed
  // untouched (no preventDefault, no toggle from here).
  const { toggle } = m;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const t =
        (e.target as HTMLElement | null) ??
        (document.activeElement as HTMLElement | null);
      if (t?.closest(INTERACTIVE_SELECTOR)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, toggle]);

  // Shared drag/scroll/arrow tempo gestures for the wheel band.
  const scrub = useTempoScrubber(m, state.bpm);

  // Beat-flash sweep: pure CSS. The dots animate at the bar/beat period derived
  // from bpm — durations set here, never a per-beat JS timer.
  const beatPeriod = 60 / Math.max(state.bpm, 1);
  const barPeriod = beatPeriod * Math.max(state.beats_per_bar, 1);
  const beats = Math.min(Math.max(state.beats_per_bar, 1), MAX_BEATS_PER_BAR);
  const beatDots = useMemo(
    () => Array.from({ length: beats }, (_, i) => i),
    [beats],
  );

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
            <MinusGlyph size={18} />
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
              onChange={(e) =>
                setDraft(e.currentTarget.value.replace(/[^0-9]/g, ""))
              }
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
            <PlusGlyph size={18} />
          </button>
        </div>
        <p className="metro-tempo-name">{tempoName(state.bpm)}</p>
        <div
          className="metro-wheel"
          role="slider"
          aria-label="Tempo wheel"
          aria-valuemin={UI_BPM_MIN}
          aria-valuemax={UI_BPM_MAX}
          aria-valuenow={state.bpm}
          tabIndex={0}
          {...scrub.dragHandlers}
          onWheel={scrub.onWheel}
          onKeyDown={scrub.onKeyDown}
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
      <div className="metro-grid">
        <Stepper
          icon={<BeatsGlyph size={17} />}
          label="Beats"
          value={state.beats_per_bar}
          min={MIN_BEATS_PER_BAR}
          max={MAX_BEATS_PER_BAR}
          onChange={m.setBeatsPerBar}
        />
        <Stepper
          icon={<SubdivGlyph size={17} />}
          label="Subdivision"
          value={state.subdivision}
          min={1}
          max={MAX_SUBDIVISION}
          onChange={m.setSubdivision}
        />
      </div>

      {/* Sound picker ------------------------------------------------------- */}
      <section className="metro-sound-group" aria-label="Click sound">
        <span className="metro-section-label">
          <SoundGlyph size={16} />
          Sound
        </span>
        <div className="metro-sounds">
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
        </div>
      </section>

      {/* Volume ------------------------------------------------------------- */}
      <div className="metro-volume">
        <span className="metro-volume-icon" aria-hidden="true">
          <VolumeGlyph size={18} />
        </span>
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
        <span className="metro-volume-value">
          {Math.round(state.gain * 100)}%
        </span>
      </div>

      {/* Toggles ------------------------------------------------------------ */}
      <div className="metro-toggles">
        <IconToggle
          icon={<AccentGlyph size={17} />}
          label="Accent"
          checked={state.accent_first}
          onChange={m.setAccent}
          switchLabel="Accent first beat"
        />
        <IconToggle
          icon={<BoostGlyph size={17} />}
          label="Boost"
          checked={state.boost}
          onChange={m.setBoost}
          switchLabel="Boost system volume"
        />
      </div>

      {/* Transport ---------------------------------------------------------- */}
      <button
        type="button"
        className="metro-transport"
        data-running={state.running}
        onClick={m.toggle}
      >
        {state.running ? <StopGlyph size={18} /> : <PlayGlyph size={18} />}
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
  icon,
  label,
  value,
  min,
  max,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="metro-stepper">
      <span className="metro-stepper-label">
        <span className="metro-stepper-icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </span>
      <div className="metro-stepper-control">
        <button
          type="button"
          className="metro-step"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          <MinusGlyph size={14} />
        </button>
        <span className="metro-stepper-value">{value}</span>
        <button
          type="button"
          className="metro-step"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          <PlusGlyph size={14} />
        </button>
      </div>
    </div>
  );
}

function IconToggle({
  icon,
  label,
  checked,
  onChange,
  switchLabel,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  switchLabel: string;
}) {
  return (
    <div className="metro-toggle" data-on={checked}>
      <span className="metro-toggle-label">
        <span className="metro-toggle-icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </span>
      <Switch checked={checked} onChange={onChange} label={switchLabel} />
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
