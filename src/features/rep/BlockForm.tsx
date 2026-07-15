import { useEffect, useRef, useState } from "react";
import type { RepOpenArgs, VariantSpec } from "./useRep";

// ---------------------------------------------------------------------------
// Compose a practice block, then open it. Measures + start/target tempo define
// the drill. Mastery is an explicit consecutive-clean target, while the
// optional legacy planned-reps field is only a neutral review boundary; it
// neither blocks continued attempts nor proves mastery. Increment is "auto"
// by default — the backend resolves the tempo rule — or manual.
// ---------------------------------------------------------------------------

interface BlockFormProps {
  pieceId: number;
  /** Pre-fill start tempo from the piece's known state, when available. */
  defaultStartBpm?: number;
  /** Pre-fill target tempo from the piece's intake, when available. */
  defaultTargetBpm?: number | null;
  /** Pre-fill a score Region's measure range and label. */
  regionId?: number | null;
  defaultMeasureStart?: number;
  defaultMeasureEnd?: number;
  defaultLabel?: string;
  /** Persisted practice default; v2 defaults to five consecutive cleans. */
  defaultCleanStreak?: number;
  onOpen: (args: RepOpenArgs) => void;
  opening?: boolean;
}

function parseIntOrNull(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseNumOr(raw: string, fallback: number): number {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : fallback;
}

export function BlockForm({
  pieceId,
  regionId = null,
  defaultStartBpm,
  defaultTargetBpm,
  defaultMeasureStart,
  defaultMeasureEnd,
  defaultLabel,
  defaultCleanStreak = 5,
  onOpen,
  opening = false,
}: BlockFormProps) {
  const [mStart, setMStart] = useState<string>(
    defaultMeasureStart != null ? String(defaultMeasureStart) : "",
  );
  const [mEnd, setMEnd] = useState<string>(
    defaultMeasureEnd != null ? String(defaultMeasureEnd) : "",
  );
  const [label, setLabel] = useState<string>(defaultLabel ?? "");
  const [startBpm, setStartBpm] = useState<string>(
    defaultStartBpm != null ? String(defaultStartBpm) : "60",
  );
  const [targetBpm, setTargetBpm] = useState<string>(
    defaultTargetBpm != null ? String(defaultTargetBpm) : "",
  );
  const [plannedReps, setPlannedReps] = useState<string>("");
  const initialTarget = [3, 5, 7, 10].includes(defaultCleanStreak)
    ? String(defaultCleanStreak)
    : "custom";
  const [streakChoice, setStreakChoice] = useState(initialTarget);
  const [customStreak, setCustomStreak] = useState(String(defaultCleanStreak));
  const streakEdited = useRef(false);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [cleanNeeded, setCleanNeeded] = useState<string>("3");
  const [bpmStep, setBpmStep] = useState<string>("4");
  const [variants, setVariants] = useState<VariantSpec[]>([]);
  const [focus, setFocus] = useState("tempo");
  const [useMetronome, setUseMetronome] = useState(true);

  // Settings can finish saving while this form remains mounted. Adopt that
  // saved default until the pianist has started editing this form's target;
  // after that, the draft wins over later preference updates.
  useEffect(() => {
    if (streakEdited.current) return;
    setStreakChoice(
      [3, 5, 7, 10].includes(defaultCleanStreak)
        ? String(defaultCleanStreak)
        : "custom",
    );
    setCustomStreak(String(defaultCleanStreak));
  }, [defaultCleanStreak]);

  const setVariant = (i: number, patch: Partial<VariantSpec>) =>
    setVariants((v) => v.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const addVariant = () =>
    setVariants((v) => [...v, { name: "", reps: 5 }]);
  const removeVariant = (i: number) =>
    setVariants((v) => v.filter((_, idx) => idx !== i));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const args: RepOpenArgs = {
      piece_id: pieceId,
      region_id: regionId,
      m_start: parseIntOrNull(mStart) ?? 1,
      m_end: parseIntOrNull(mEnd) ?? parseIntOrNull(mStart) ?? 1,
      label: label.trim() === "" ? null : label.trim(),
      start_bpm: focus === "tempo" || useMetronome ? parseNumOr(startBpm, 60) : null,
      target_bpm: focus === "tempo" ? parseIntOrNull(targetBpm) : null,
      planned_reps: parseIntOrNull(plannedReps),
      required_clean_streak: Math.max(
        1,
        streakChoice === "custom"
          ? parseIntOrNull(customStreak) ?? defaultCleanStreak
          : Number(streakChoice),
      ),
      increment:
        focus !== "tempo" || mode === "auto"
          ? null // auto -> backend resolves the rule
          : {
              clean_needed: parseIntOrNull(cleanNeeded) ?? 3,
              bpm_step: parseNumOr(bpmStep, 4),
            },
      variants: variants
        .map((v) => ({ name: v.name.trim(), reps: v.reps }))
        .filter((v) => v.name !== ""),
      focus,
      use_metronome: useMetronome,
    };
    onOpen(args);
  };

  return (
    <form className="block-form" onSubmit={submit}>
      <h3 className="ck-form-heading">New practice set</h3>

      <div className="ck-field-grid block-mode-row">
        <label className="ck-field">
          <span className="ck-label">Practice focus</span>
          <select
            className="ck-input"
            aria-label="Focus"
            value={focus}
            onChange={(event) => {
              const next = event.target.value;
              setFocus(next);
              if (next !== "tempo") setUseMetronome(false);
            }}
          >
            <option value="tempo">Tempo</option>
            <option value="notes">Notes & accuracy</option>
            <option value="phrasing">Phrasing</option>
            <option value="dynamics">Dynamics</option>
            <option value="memory">Memory</option>
            <option value="hands">Hands / coordination</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="ck-toggle-field">
          <input type="checkbox" aria-label="Use metronome" checked={useMetronome} onChange={(event) => setUseMetronome(event.target.checked)} />
          <span><strong>Metronome</strong><small>{useMetronome ? "On for this set" : "Off — attempts are still recorded"}</small></span>
        </label>
      </div>

      <div className="ck-field-grid">
        <label className="ck-field">
          <span className="ck-label">From measure</span>
          <input
            className="ck-input"
            type="number"
            inputMode="numeric"
            min={1}
            value={mStart}
            placeholder="1"
            aria-label="From measure"
            onChange={(e) => setMStart(e.target.value)}
          />
        </label>
        <label className="ck-field">
          <span className="ck-label">To measure</span>
          <input
            className="ck-input"
            type="number"
            inputMode="numeric"
            min={1}
            value={mEnd}
            placeholder="8"
            aria-label="To measure"
            onChange={(e) => setMEnd(e.target.value)}
          />
        </label>
      </div>

      {regionId == null ? (
        <label className="ck-field">
          <span className="ck-label">Block label (optional)</span>
          <input
            className="ck-input"
            type="text"
            value={label}
            placeholder="e.g. left-hand leaps"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
      ) : (
        <p className="block-region-lock"><strong>Section:</strong> {defaultLabel}<span>Edit the section title in the row’s Edit tab.</span></p>
      )}

      {(focus === "tempo" || useMetronome) && <div className="ck-field-grid">
        <label className="ck-field">
          <span className="ck-label">{focus === "tempo" ? "Start bpm" : "Metronome bpm"}</span>
          <input
            className="ck-input"
            type="number"
            inputMode="numeric"
            min={1}
            value={startBpm}
            aria-label="Start bpm"
            onChange={(e) => setStartBpm(e.target.value)}
          />
        </label>
        {focus === "tempo" && <label className="ck-field">
          <span className="ck-label">Target bpm</span>
          <input
            className="ck-input"
            type="number"
            inputMode="numeric"
            min={1}
            value={targetBpm}
            placeholder="optional"
            aria-label="Target bpm"
            onChange={(e) => setTargetBpm(e.target.value)}
          />
        </label>}
      </div>}

      <div className="ck-field-grid">
        <label className="ck-field">
          <span className="ck-label">Clean streak target</span>
          <select
            className="ck-input"
            aria-label="Clean streak target"
            value={streakChoice}
            onChange={(event) => {
              streakEdited.current = true;
              setStreakChoice(event.target.value);
            }}
          >
            <option value="3">3 consecutive cleans</option>
            <option value="5">5 consecutive cleans</option>
            <option value="7">7 consecutive cleans</option>
            <option value="10">10 consecutive cleans</option>
            <option value="custom">Custom…</option>
          </select>
          <small>Mastery requires this streak; total tries do not complete the set.</small>
        </label>
        {streakChoice === "custom" ? (
          <label className="ck-field">
            <span className="ck-label">Custom clean streak</span>
            <input
              className="ck-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={customStreak}
              aria-label="Custom clean streak"
              onChange={(event) => {
                streakEdited.current = true;
                setCustomStreak(event.target.value);
              }}
            />
          </label>
        ) : (
          <label className="ck-field">
            <span className="ck-label">Attempt review boundary (optional)</span>
            <input
              className="ck-input"
              type="number"
              inputMode="numeric"
              min={1}
              value={plannedReps}
              placeholder="No boundary"
              aria-label="Attempt review boundary"
              onChange={(event) => setPlannedReps(event.target.value)}
            />
            <small>At this try count, review whether to continue, change strategy, restart, or close. Attempts remain available; this never proves mastery.</small>
          </label>
        )}
      </div>
      {streakChoice === "custom" && (
        <label className="ck-field">
          <span className="ck-label">Attempt review boundary (optional)</span>
          <input
            className="ck-input"
            type="number"
            inputMode="numeric"
            min={1}
            value={plannedReps}
            placeholder="No boundary"
            aria-label="Attempt review boundary"
            onChange={(event) => setPlannedReps(event.target.value)}
          />
          <small>At this try count, review whether to continue, change strategy, restart, or close. Attempts remain available; this never proves mastery.</small>
        </label>
      )}

      <details className="block-advanced">
        <summary>Advanced ladder + variants</summary>
      {focus === "tempo" && <fieldset className="ck-field">
        <legend className="ck-label">Tempo increment</legend>
        <div className="ck-segmented" role="radiogroup" aria-label="Increment mode">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "auto"}
            className={`ck-segment ${mode === "auto" ? "is-on" : ""}`}
            onClick={() => setMode("auto")}
          >
            Auto
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "manual"}
            className={`ck-segment ${mode === "manual" ? "is-on" : ""}`}
            onClick={() => setMode("manual")}
          >
            Manual
          </button>
        </div>
        {mode === "manual" && (
          <div className="ck-field-grid ck-manual-rule">
            <label className="ck-field">
              <span className="ck-label">Clean attempts before tempo step</span>
              <input
                className="ck-input"
                type="number"
                inputMode="numeric"
                min={1}
                value={cleanNeeded}
                aria-label="Cleans needed"
                onChange={(e) => setCleanNeeded(e.target.value)}
              />
            </label>
            <label className="ck-field">
              <span className="ck-label">Bpm step</span>
              <input
                className="ck-input"
                type="number"
                inputMode="numeric"
                value={bpmStep}
                aria-label="Bpm step"
                onChange={(e) => setBpmStep(e.target.value)}
              />
            </label>
          </div>
        )}
      </fieldset>}

      <fieldset className="ck-field">
        <legend className="ck-label">Variants (optional)</legend>
        {variants.map((v, i) => (
          <div className="ck-row" key={i}>
            <input
              className="ck-input"
              type="text"
              value={v.name}
              placeholder="hands separate"
              aria-label={`Variant ${i + 1} name`}
              onChange={(e) => setVariant(i, { name: e.target.value })}
            />
            <input
              className="ck-input ck-input-reps"
              type="number"
              inputMode="numeric"
              min={1}
              value={v.reps}
              aria-label={`Variant ${i + 1} attempts`}
              onChange={(e) =>
                setVariant(i, { reps: parseIntOrNull(e.target.value) ?? 1 })
              }
            />
            <button
              type="button"
              className="ck-row-remove"
              aria-label={`Remove variant ${i + 1}`}
              onClick={() => removeVariant(i)}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="ck-add" onClick={addVariant}>
          + Add variant
        </button>
      </fieldset>
      </details>

      <button type="submit" className="ck-primary" disabled={opening}>
        {opening ? "Starting…" : "Start set"}
      </button>
    </form>
  );
}
