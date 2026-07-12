import { useState } from "react";
import type { RepOpenArgs, VariantSpec } from "./useRep";

// ---------------------------------------------------------------------------
// Compose a practice block, then open it. Measures + start/target tempo define
// the drill; planned reps default to the backend's 30 when left blank (sent as
// null). Increment is "auto" by default — the backend resolves the rule — or
// manual (N cleans in a row bumps the tempo by S bpm). Optional variant rows
// carve the rep budget into named sub-drills (e.g. "hands separate": 5).
// ---------------------------------------------------------------------------

interface BlockFormProps {
  pieceId: number;
  /** Pre-fill start tempo from the piece's known state, when available. */
  defaultStartBpm?: number;
  /** Pre-fill target tempo from the piece's intake, when available. */
  defaultTargetBpm?: number | null;
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
  defaultStartBpm,
  defaultTargetBpm,
  onOpen,
  opening = false,
}: BlockFormProps) {
  const [mStart, setMStart] = useState<string>("");
  const [mEnd, setMEnd] = useState<string>("");
  const [label, setLabel] = useState<string>("");
  const [startBpm, setStartBpm] = useState<string>(
    defaultStartBpm != null ? String(defaultStartBpm) : "60",
  );
  const [targetBpm, setTargetBpm] = useState<string>(
    defaultTargetBpm != null ? String(defaultTargetBpm) : "",
  );
  const [plannedReps, setPlannedReps] = useState<string>("");
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [cleanNeeded, setCleanNeeded] = useState<string>("3");
  const [bpmStep, setBpmStep] = useState<string>("4");
  const [variants, setVariants] = useState<VariantSpec[]>([]);
  const [focus, setFocus] = useState("tempo");
  const [useMetronome, setUseMetronome] = useState(true);

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
      m_start: parseIntOrNull(mStart) ?? 1,
      m_end: parseIntOrNull(mEnd) ?? parseIntOrNull(mStart) ?? 1,
      label: label.trim() === "" ? null : label.trim(),
      start_bpm: focus === "tempo" || useMetronome ? parseNumOr(startBpm, 60) : null,
      target_bpm: focus === "tempo" ? parseIntOrNull(targetBpm) : null,
      planned_reps: parseIntOrNull(plannedReps), // null -> backend default (30)
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
      <h3 className="ck-form-heading">New practice block</h3>

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
          <span><strong>Metronome</strong><small>{useMetronome ? "On for this block" : "Off — reps still count"}</small></span>
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

      <label className="ck-field">
        <span className="ck-label">Label (optional)</span>
        <input
          className="ck-input"
          type="text"
          value={label}
          placeholder="e.g. left-hand leaps"
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>

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

      <label className="ck-field">
        <span className="ck-label">Planned reps</span>
        <input
          className="ck-input"
          type="number"
          inputMode="numeric"
          min={1}
          value={plannedReps}
          placeholder="30"
          aria-label="Planned reps"
          onChange={(e) => setPlannedReps(e.target.value)}
        />
      </label>

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
              <span className="ck-label">Cleans needed</span>
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
              aria-label={`Variant ${i + 1} reps`}
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

      <button type="submit" className="ck-primary" disabled={opening}>
        {opening ? "Opening…" : "Open block"}
      </button>
    </form>
  );
}
