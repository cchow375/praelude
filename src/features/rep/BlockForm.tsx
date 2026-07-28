import { useEffect, useRef, useState } from "react";
import type { RepOpenArgs, VariantSpec } from "./useRep";
import "../../ui/forms.css";

// ---------------------------------------------------------------------------
// Compose a practice block, then open it. Measures + start/target tempo define
// the drill. Mastery is an explicit consecutive-clean target, while the
// optional legacy planned-reps field is only a neutral review boundary; it
// neither blocks continued attempts nor proves mastery. Increment is "auto"
// by default — the backend resolves the tempo rule — or manual.
//
// Layout (v4/B3): the common case is frictionless — section + target only.
// A one-line plain-words summary shows every strategy default, and a single
// "More" disclosure holds the editable controls (focus, clean streak, tempo
// ladder, variants, review boundary). The submitted RepOpenArgs shape is
// unchanged; only the arrangement collapsed.
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
  /** Prevents a guaranteed backend rejection while another set owns the loop. */
  blockedReason?: string | null;
}

/** Short, plain-words labels for the summary line (no niche jargon). */
const FOCUS_LABELS: Record<string, string> = {
  tempo: "Tempo",
  notes: "Notes",
  phrasing: "Phrasing",
  dynamics: "Dynamics",
  memory: "Memory",
  hands: "Hands",
  other: "Other",
};

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

/** Decorative disclosure caret. Monochrome inline SVG, 1.5px currentColor. */
function DisclosureCaret({ open }: { open: boolean }) {
  return (
    <svg
      className={`block-more-caret${open ? " is-open" : ""}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  );
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
  blockedReason = null,
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
  const [moreOpen, setMoreOpen] = useState(false);

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
  const addVariant = () => setVariants((v) => [...v, { name: "", reps: 5 }]);
  const removeVariant = (i: number) =>
    setVariants((v) => v.filter((_, idx) => idx !== i));

  // Effective consecutive-clean target — same resolution the payload uses.
  const resolvedStreak = Math.max(
    1,
    streakChoice === "custom"
      ? (parseIntOrNull(customStreak) ?? defaultCleanStreak)
      : Number(streakChoice),
  );

  // One-line, plain-words summary of the strategy defaults tucked in "More".
  // Recomputed each render so edits made in the disclosure show immediately.
  const summaryParts: string[] = [
    FOCUS_LABELS[focus] ?? focus,
    `${resolvedStreak} clean in a row`,
  ];
  if (focus === "tempo") {
    summaryParts.push(
      mode === "auto"
        ? "auto tempo ladder"
        : `+${parseNumOr(bpmStep, 4)} bpm every ${parseIntOrNull(cleanNeeded) ?? 3} clean`,
    );
  }
  if (useMetronome) summaryParts.push("metronome");
  const namedVariants = variants.filter((v) => v.name.trim() !== "").length;
  if (namedVariants > 0) {
    summaryParts.push(
      `${namedVariants} variant${namedVariants > 1 ? "s" : ""}`,
    );
  }
  const reviewAt = parseIntOrNull(plannedReps);
  if (reviewAt != null) summaryParts.push(`review at ${reviewAt}`);
  const defaultsSummary = summaryParts.join(" · ");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (opening || blockedReason) return;
    const args: RepOpenArgs = {
      piece_id: pieceId,
      region_id: regionId,
      m_start: parseIntOrNull(mStart) ?? 1,
      m_end: parseIntOrNull(mEnd) ?? parseIntOrNull(mStart) ?? 1,
      label: label.trim() === "" ? null : label.trim(),
      start_bpm:
        focus === "tempo" || useMetronome ? parseNumOr(startBpm, 60) : null,
      target_bpm: focus === "tempo" ? parseIntOrNull(targetBpm) : null,
      planned_reps: parseIntOrNull(plannedReps),
      required_clean_streak: Math.max(
        1,
        streakChoice === "custom"
          ? (parseIntOrNull(customStreak) ?? defaultCleanStreak)
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

      {/* Section context: which measures (and an optional free label). */}
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
      ) : null}

      {/* Target: the tempo the pianist is driving toward (or a plain metronome
          beat when a non-tempo focus still wants the click). */}
      {(focus === "tempo" || useMetronome) && (
        <div className="ck-field-grid">
          <label className="ck-field">
            <span className="ck-label">
              {focus === "tempo" ? "Start bpm" : "Metronome bpm"}
            </span>
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
          {focus === "tempo" && (
            <label className="ck-field">
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
            </label>
          )}
        </div>
      )}

      {/* One-line editable defaults summary + the single "More" disclosure. */}
      <div className="block-more">
        <button
          type="button"
          className="block-more-toggle"
          aria-expanded={moreOpen}
          aria-controls="block-more-panel"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <span className="block-defaults" title={defaultsSummary}>
            {defaultsSummary}
          </span>
          <span className="block-more-cue">
            {moreOpen ? "Fewer" : "More"}
            <DisclosureCaret open={moreOpen} />
          </span>
        </button>

        {moreOpen && (
          <div id="block-more-panel" className="block-more-panel">
            <div className="ck-field-grid">
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
                <input
                  type="checkbox"
                  aria-label="Use metronome"
                  checked={useMetronome}
                  onChange={(event) => setUseMetronome(event.target.checked)}
                />
                <span>
                  <strong>Metronome</strong>
                </span>
              </label>
            </div>

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
                  <option value="3">3 cleans</option>
                  <option value="5">5 cleans</option>
                  <option value="7">7 cleans</option>
                  <option value="10">10 cleans</option>
                  <option value="custom">Custom…</option>
                </select>
              </label>
              {streakChoice === "custom" && (
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
              )}
            </div>

            {focus === "tempo" && (
              <fieldset className="ck-field">
                <legend className="ck-label">Tempo ladder</legend>
                <div
                  className="ck-segmented"
                  role="radiogroup"
                  aria-label="Increment mode"
                >
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
                      <span className="ck-label">
                        Clean attempts before tempo step
                      </span>
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
              </fieldset>
            )}

            <label className="ck-field">
              <span className="ck-label">
                Attempt review boundary (optional)
              </span>
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
            </label>

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
                      setVariant(i, {
                        reps: parseIntOrNull(e.target.value) ?? 1,
                      })
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
          </div>
        )}
      </div>

      {blockedReason && (
        <p className="ck-inline-status" role="status">
          {blockedReason}
        </p>
      )}
      <button
        type="submit"
        className="ck-primary"
        disabled={opening || Boolean(blockedReason)}
      >
        {opening ? "Starting…" : "Start set"}
      </button>
    </form>
  );
}
