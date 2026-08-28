import { useEffect, useRef, useState } from "react";
import type {
  BeatUnit,
  DemotionOverride,
  RepOpenArgs,
  SetFocusContextInput,
  SetTuning,
  VariantSpec,
} from "./useRep";
import {
  buildLadderPreview,
  estimateSetSeconds,
  formatSetEstimate,
} from "./estimate";
import "../../ui/forms.css";

// ---------------------------------------------------------------------------
// Compose a practice block, then open it. Measures + start/target tempo define
// the drill. The set target is either an explicit consecutive-clean proof or a
// finite total-play count; the optional legacy planned-reps field remains only
// a neutral review boundary for clean-streak sets. Increment is "auto" by
// default — the backend resolves the tempo rule — or manual.
//
// Layout (v5/A3, spec §5.3): Christian's diagnosis was "everything I'm asking
// for is because I don't see it" — the old single "More" disclosure buried
// practice focus, the variant chain, the clean-streak target, the tempo
// ladder and the review boundary behind one click. Now only the tempo ladder,
// the review boundary, the "one pass ≈" estimate, and per-set metronome tuning
// live behind a bottom "Advanced" disclosure (with room for a later per-set
// demotion override). Everything else — section,
// target, focus, the variant chain, and the clean-streak target — is always
// visible, zero clicks. Advanced also owns the per-set metronome tuning: its
// beat value is a label for the entered BPM, never a hidden conversion.
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
  /** Optional stored set tuning when a caller rehydrates an existing draft. */
  defaultTuning?: Partial<SetTuning>;
  /**
   * Task A10: `context` is passed ONLY when the pianist entered a one-pass
   * estimate — omitted (single-argument call) otherwise. Per-set tuning lives
   * inside the first argument and does not change that positional contract.
   */
  onOpen: (
    args: RepOpenArgs,
    context?: SetFocusContextInput,
    demotion?: DemotionOverride,
  ) => void;
  opening?: boolean;
  /** Prevents a guaranteed backend rejection while another set owns the loop. */
  blockedReason?: string | null;
}

/** One-tap variant presets (spec §5.3). Order matches Christian's list. */
const VARIANT_PRESETS: Array<{ label: string; name: string }> = [
  { label: "Slow", name: "slow" },
  { label: "Dotted", name: "dotted" },
  { label: "Reverse dotted", name: "reverse dotted" },
  { label: "Staccato", name: "staccato" },
  { label: "Tenuto", name: "tenuto" },
  { label: "Legato", name: "legato" },
  { label: "Hands separate", name: "hands separate" },
  { label: "Blocked chords", name: "blocked chords" },
];

const STREAK_TARGETS = [3, 5, 7, 10] as const;
const PLAY_TARGETS = [5, 10, 15, 25] as const;
type TargetMode = "streak" | "plays";
type DraftVariant = VariantSpec & { draftId: number };

const BEAT_UNIT_OPTIONS: Array<{ value: BeatUnit; label: string }> = [
  { value: "quarter", label: "Quarter note (♩)" },
  { value: "eighth", label: "Eighth note (♪)" },
  { value: "dotted_quarter", label: "Dotted quarter note (♩.)" },
  { value: "half", label: "Half note (𝅗𝅥)" },
];

const DEFAULT_TUNING: SetTuning = {
  beat_unit: "quarter",
  subdivision: 1,
  beats_per_bar: 4,
};

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.round(parsed)))
    : fallback;
}

function normalizeTuning(value?: Partial<SetTuning>): SetTuning {
  const beatUnit = BEAT_UNIT_OPTIONS.some(
    (option) => option.value === value?.beat_unit,
  )
    ? (value?.beat_unit as BeatUnit)
    : DEFAULT_TUNING.beat_unit;
  return {
    beat_unit: beatUnit,
    subdivision: clampInteger(value?.subdivision, 1, 16, 1),
    beats_per_bar: clampInteger(value?.beats_per_bar, 1, 16, 4),
  };
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

/** Same compact +/- idiom as the standalone metronome, scoped to a draft set. */
function TuningStepper({
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
  onChange: (value: number) => void;
}) {
  return (
    <div className="ck-tuning-stepper" role="group" aria-label={label}>
      <span className="ck-label">{label}</span>
      <div className="ck-tuning-stepper-control">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          −
        </button>
        <output aria-live="polite">{value}</output>
        <button
          type="button"
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

export function BlockForm({
  pieceId,
  regionId = null,
  defaultStartBpm,
  defaultTargetBpm,
  defaultMeasureStart,
  defaultMeasureEnd,
  defaultLabel,
  defaultCleanStreak = 5,
  defaultTuning,
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
  const initialTarget = STREAK_TARGETS.includes(
    defaultCleanStreak as (typeof STREAK_TARGETS)[number],
  )
    ? String(defaultCleanStreak)
    : "custom";
  const [targetMode, setTargetMode] = useState<TargetMode>("streak");
  const [streakChoice, setStreakChoice] = useState(initialTarget);
  const [customStreak, setCustomStreak] = useState(String(defaultCleanStreak));
  const [playChoice, setPlayChoice] = useState("10");
  const [customPlays, setCustomPlays] = useState("10");
  const targetEdited = useRef(false);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [cleanNeeded, setCleanNeeded] = useState<string>("3");
  const [bpmStep, setBpmStep] = useState<string>("4");
  const [demotionMode, setDemotionMode] = useState<"inherit" | "on" | "off">(
    "inherit",
  );
  const [demotionFirst, setDemotionFirst] = useState("3");
  const [demotionRepeat, setDemotionRepeat] = useState("2");
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const nextVariantId = useRef(1);
  const [focus, setFocus] = useState("tempo");
  const [useMetronome, setUseMetronome] = useState(true);
  const initialTuning = normalizeTuning(defaultTuning);
  const [beatUnit, setBeatUnit] = useState<BeatUnit>(initialTuning.beat_unit);
  const [subdivision, setSubdivision] = useState(initialTuning.subdivision);
  const [beatsPerBar, setBeatsPerBar] = useState(initialTuning.beats_per_bar);
  const tuningEdited = useRef(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Task A10: optional one-pass estimate. Empty by default — no field
  // touched means no context is sent and no estimate renders.
  const [passSeconds, setPassSeconds] = useState<string>("");
  // Task A3: free-text variant chips the pianist has typed this session are
  // remembered alongside the built-in presets, so re-adding one is one tap.
  const [customChips, setCustomChips] = useState<string[]>([]);
  const [customVariantText, setCustomVariantText] = useState<string>("");

  const chooseTargetMode = (next: TargetMode) => {
    targetEdited.current = true;
    setTargetMode(next);
  };

  // Settings can finish saving while this form remains mounted. Adopt that
  // saved default until the pianist has started editing this form's target;
  // after that, the draft wins over later preference updates.
  useEffect(() => {
    if (targetEdited.current) return;
    setStreakChoice(
      STREAK_TARGETS.includes(
        defaultCleanStreak as (typeof STREAK_TARGETS)[number],
      )
        ? String(defaultCleanStreak)
        : "custom",
    );
    setCustomStreak(String(defaultCleanStreak));
  }, [defaultCleanStreak]);

  // A stored draft/reopen may arrive after the surrounding view resolves its
  // data. Adopt it until the pianist touches any tuning control; from then on,
  // the in-progress draft wins over later prop refreshes.
  useEffect(() => {
    if (tuningEdited.current) return;
    const next = normalizeTuning(defaultTuning);
    setBeatUnit(next.beat_unit);
    setSubdivision(next.subdivision);
    setBeatsPerBar(next.beats_per_bar);
  }, [
    defaultTuning?.beat_unit,
    defaultTuning?.beats_per_bar,
    defaultTuning?.subdivision,
  ]);

  const setVariant = (i: number, patch: Partial<VariantSpec>) =>
    setVariants((v) => v.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  /** Tapping a preset (or submitting custom text) appends it to the chain. */
  const addVariant = (name: string = "") =>
    setVariants((v) => [
      ...v,
      {
        draftId: nextVariantId.current++,
        name,
        reps: 5,
        clean_streak: 5,
      },
    ]);
  const removeVariant = (i: number) =>
    setVariants((v) => v.filter((_, idx) => idx !== i));
  const moveVariant = (i: number, dir: -1 | 1) =>
    setVariants((v) => {
      const j = i + dir;
      if (j < 0 || j >= v.length) return v;
      const next = v.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addCustomVariant = () => {
    const name = customVariantText.trim();
    if (name === "") return;
    addVariant(name);
    setCustomChips((chips) =>
      chips.includes(name) || VARIANT_PRESETS.some((p) => p.name === name)
        ? chips
        : [...chips, name],
    );
    setCustomVariantText("");
  };

  // One-line, plain-words summary of what's tucked behind "Advanced" (the
  // tempo ladder and the review boundary — everything else is always
  // visible now). Recomputed each render so edits inside Advanced show
  // immediately without opening it again.
  const advancedParts: string[] = [];
  if (focus === "tempo" && targetMode === "streak") {
    advancedParts.push(
      mode === "auto"
        ? "auto tempo ladder"
        : `+${parseNumOr(bpmStep, 4)} bpm every ${parseIntOrNull(cleanNeeded) ?? 3} clean`,
    );
  }
  if (useMetronome) {
    const unit = BEAT_UNIT_OPTIONS.find(
      (option) => option.value === beatUnit,
    )?.label.replace(/\s*\([^)]*\)$/, "");
    advancedParts.push(`${unit ?? "Quarter note"} pulse`);
  }
  if (targetMode === "streak" && demotionMode !== "inherit") {
    advancedParts.push(
      demotionMode === "off"
        ? "demotion off for this set"
        : `demote after ${demotionFirst}, then ${demotionRepeat} sloppy`,
    );
  }
  const reviewAt = targetMode === "streak" ? parseIntOrNull(plannedReps) : null;
  if (reviewAt != null) advancedParts.push(`review at ${reviewAt}`);
  const advancedSummary =
    advancedParts.length > 0
      ? advancedParts.join(" · ")
      : "tempo ladder, review boundary";

  // Task A10: a live "≈ X–Y min" estimate beside the optional one-pass field.
  // Only meaningful for a tempo-focused set with a positive pass time; the
  // ladder is a client-side preview of the same start/target/step/reps
  // fields already on this form (see estimate.ts — not the backend's
  // authoritative auto-ladder resolution).
  const parsedPassSeconds = parseIntOrNull(passSeconds);
  const estimateText =
    focus === "tempo" &&
    targetMode === "streak" &&
    parsedPassSeconds != null &&
    parsedPassSeconds > 0
      ? formatSetEstimate(
          estimateSetSeconds(
            parsedPassSeconds,
            buildLadderPreview(
              parseNumOr(startBpm, 60),
              parseIntOrNull(targetBpm),
              parseNumOr(bpmStep, 4),
              parseIntOrNull(cleanNeeded) ?? 3,
            ),
            parseNumOr(startBpm, 60),
          ),
        )
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (opening || blockedReason) return;
    const streakTarget = Math.max(
      1,
      streakChoice === "custom"
        ? (parseIntOrNull(customStreak) ?? defaultCleanStreak)
        : Number(streakChoice),
    );
    const playTarget = clampInteger(
      playChoice === "custom" ? customPlays : playChoice,
      1,
      240,
      10,
    );
    const args: RepOpenArgs = {
      piece_id: pieceId,
      region_id: regionId,
      m_start: parseIntOrNull(mStart) ?? 1,
      m_end: parseIntOrNull(mEnd) ?? parseIntOrNull(mStart) ?? 1,
      label: label.trim() === "" ? null : label.trim(),
      start_bpm:
        focus === "tempo" || useMetronome ? parseNumOr(startBpm, 60) : null,
      target_bpm:
        focus === "tempo" && targetMode === "streak"
          ? parseIntOrNull(targetBpm)
          : null,
      planned_reps:
        targetMode === "streak" ? parseIntOrNull(plannedReps) : null,
      required_clean_streak: targetMode === "streak" ? streakTarget : null,
      ...(targetMode === "plays" ? { attempt_target: playTarget } : {}),
      increment:
        focus !== "tempo" || targetMode === "plays" || mode === "auto"
          ? null // auto -> backend resolves the rule
          : {
              clean_needed: parseIntOrNull(cleanNeeded) ?? 3,
              bpm_step: parseNumOr(bpmStep, 4),
            },
      variants: (targetMode === "streak" ? variants : [])
        .map((v) => ({
          name: v.name.trim(),
          // Keep `reps` populated for older stored/read paths while making
          // the A2 consecutive-clean contract explicit for new sets.
          reps: v.reps,
          clean_streak: v.clean_streak ?? v.reps,
        }))
        .filter((v) => v.name !== ""),
      focus,
      use_metronome: useMetronome,
      tuning: {
        beat_unit: beatUnit,
        subdivision,
        beats_per_bar: beatsPerBar,
      },
    };
    const demotion: DemotionOverride | undefined =
      targetMode === "plays" || demotionMode === "inherit"
        ? undefined
        : {
            enabled: demotionMode === "on",
            first: clampInteger(demotionFirst, 2, 10, 3),
            repeat: clampInteger(demotionRepeat, 1, 10, 2),
          };
    // Task A10 compatibility: untouched optional controls still mean a single
    // positional argument. A5's tuning is part of that RepOpenArgs object.
    if (
      targetMode === "streak" &&
      parsedPassSeconds != null &&
      parsedPassSeconds > 0
    ) {
      if (demotion) {
        onOpen(args, { pass_seconds: parsedPassSeconds }, demotion);
      } else {
        onOpen(args, { pass_seconds: parsedPassSeconds });
      }
    } else if (demotion) {
      onOpen(args, undefined, demotion);
    } else {
      onOpen(args);
    }
  };

  return (
    <form className="block-form" onSubmit={submit}>
      <h3 className="ck-form-heading">New practice set</h3>

      {/* Task A3 (§4b): the body scrolls internally so the composer still
          fits — and Start set stays reachable — at the app's 720×520 floor;
          the fix for "doesn't fit" is a scrollbar, never re-hiding a tool. */}
      <div className="block-form-body">
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

        {/* Target: the tempo the pianist is driving toward (or a plain
            metronome beat when a non-tempo focus still wants the click). */}
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
            {focus === "tempo" && targetMode === "streak" && (
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

        {/* Always visible from here down (Christian, spec §5.3): focus, the
            variant chain, and the clean-streak target need zero clicks. */}
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

        <fieldset className="ck-field ck-target-editor">
          <legend className="ck-label">Set target</legend>
          <div className="ck-target-line">
            <div
              className="ck-segmented ck-target-mode"
              role="radiogroup"
              aria-label="Target type"
              onKeyDown={(event) => {
                let next: TargetMode | null = null;
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  next = targetMode === "streak" ? "plays" : "streak";
                } else if (
                  event.key === "ArrowLeft" ||
                  event.key === "ArrowUp"
                ) {
                  next = targetMode === "plays" ? "streak" : "plays";
                } else if (event.key === "Home") {
                  next = "streak";
                } else if (event.key === "End") {
                  next = "plays";
                }
                if (next == null) return;
                event.preventDefault();
                chooseTargetMode(next);
                const index = next === "streak" ? 0 : 1;
                const group = event.currentTarget;
                requestAnimationFrame(() => {
                  group
                    .querySelectorAll<HTMLButtonElement>('[role="radio"]')
                    [index]?.focus();
                });
              }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={targetMode === "streak"}
                tabIndex={targetMode === "streak" ? 0 : -1}
                className={`ck-segment ${targetMode === "streak" ? "is-on" : ""}`}
                onClick={() => chooseTargetMode("streak")}
              >
                Clean streak
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={targetMode === "plays"}
                tabIndex={targetMode === "plays" ? 0 : -1}
                className={`ck-segment ${targetMode === "plays" ? "is-on" : ""}`}
                onClick={() => chooseTargetMode("plays")}
              >
                Total plays
              </button>
            </div>
            <select
              className="ck-input ck-target-count"
              aria-label={
                targetMode === "streak"
                  ? "Clean streak target"
                  : "Total plays target"
              }
              value={targetMode === "streak" ? streakChoice : playChoice}
              onChange={(event) => {
                targetEdited.current = true;
                if (targetMode === "streak") {
                  setStreakChoice(event.target.value);
                } else {
                  setPlayChoice(event.target.value);
                }
              }}
            >
              {(targetMode === "streak" ? STREAK_TARGETS : PLAY_TARGETS).map(
                (value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ),
              )}
              <option value="custom">Custom…</option>
            </select>
            {targetMode === "streak" && streakChoice === "custom" ? (
              <input
                className="ck-input ck-target-custom"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={customStreak}
                aria-label="Custom clean streak"
                onChange={(event) => {
                  targetEdited.current = true;
                  setCustomStreak(event.target.value);
                }}
              />
            ) : null}
            {targetMode === "plays" && playChoice === "custom" ? (
              <input
                className="ck-input ck-target-custom"
                type="number"
                inputMode="numeric"
                min={1}
                max={240}
                value={customPlays}
                aria-label="Custom total plays"
                onChange={(event) => {
                  targetEdited.current = true;
                  setCustomPlays(event.target.value);
                }}
              />
            ) : null}
          </div>
          <small>
            {targetMode === "streak"
              ? "Clean must be consecutive."
              : "Fixed tempo · no variants · every verdict counts; Undo removes one."}
          </small>
        </fieldset>

        {/* A chain is itself a clean-streak proof. Keep it out of total-play
            mode rather than inventing competing advancement semantics. The
            draft stays in memory if the pianist switches back. */}
        {targetMode === "streak" ? (
          <fieldset className="ck-field ck-variant-chain">
            <legend className="ck-label">Variant chain</legend>
            <div className="ck-chip-row" aria-label="Variant presets">
              {[
                ...VARIANT_PRESETS,
                ...customChips.map((name) => ({ label: name, name })),
              ].map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="ck-chip"
                  onClick={() => addVariant(preset.name)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="ck-row ck-variant-add-row">
              <input
                className="ck-input"
                type="text"
                value={customVariantText}
                placeholder="Custom variant…"
                aria-label="Custom variant name"
                onChange={(e) => setCustomVariantText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomVariant();
                  }
                }}
              />
              <button
                type="button"
                className="ck-add ck-variant-add"
                aria-label="Add custom variant"
                onClick={addCustomVariant}
              >
                +
              </button>
            </div>
            {variants.length > 0 ? (
              <>
                <small className="ck-chain-help">
                  Each stage advances after its clean count.
                </small>
                <ol className="ck-chain-list">
                  {variants.map((v, i) => (
                    <li className="ck-chain-item" key={v.draftId}>
                      <span className="ck-chain-index" aria-hidden="true">
                        {i + 1}
                      </span>
                      <input
                        className="ck-input ck-chain-name"
                        type="text"
                        value={v.name}
                        placeholder="hands separate"
                        aria-label={`Variant ${i + 1} name`}
                        onChange={(e) =>
                          setVariant(i, { name: e.target.value })
                        }
                      />
                      <input
                        className="ck-input ck-chain-count"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={100}
                        value={v.clean_streak ?? v.reps}
                        title="Consecutive cleans"
                        aria-label={`Variant ${i + 1} consecutive cleans`}
                        onChange={(e) => {
                          const requirement =
                            parseIntOrNull(e.target.value) ?? 1;
                          setVariant(i, {
                            reps: requirement,
                            clean_streak: requirement,
                          });
                        }}
                      />
                      <div className="ck-chain-actions">
                        <button
                          type="button"
                          className="ck-row-move"
                          aria-label={`Move variant ${i + 1} up`}
                          disabled={i === 0}
                          onClick={() => moveVariant(i, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="ck-row-move"
                          aria-label={`Move variant ${i + 1} down`}
                          disabled={i === variants.length - 1}
                          onClick={() => moveVariant(i, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="ck-row-remove"
                          aria-label={`Remove variant ${i + 1}`}
                          onClick={() => removeVariant(i)}
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </fieldset>
        ) : null}

        {/* One collapsed "Advanced" section at the bottom (§5.3): the tempo
            ladder, one-pass estimate, set metronome tuning, and review
            boundary. */}
        <div className="block-more">
          <button
            type="button"
            className="block-more-toggle"
            aria-expanded={advancedOpen}
            aria-controls="block-advanced-panel"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <span className="block-defaults" title={advancedSummary}>
              {advancedSummary}
            </span>
            <span className="block-more-cue">
              Advanced
              <DisclosureCaret open={advancedOpen} />
            </span>
          </button>

          {advancedOpen && (
            <div id="block-advanced-panel" className="block-more-panel">
              {focus === "tempo" && targetMode === "streak" && (
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
                  <div className="ck-field-grid ck-pass-estimate">
                    <label className="ck-field">
                      <span className="ck-label">
                        One pass ≈ (sec, optional)
                      </span>
                      <input
                        className="ck-input"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={3600}
                        value={passSeconds}
                        placeholder="No estimate"
                        aria-label="One pass seconds"
                        onChange={(e) => setPassSeconds(e.target.value)}
                      />
                    </label>
                    {estimateText && (
                      <span
                        className="ck-pass-estimate-text"
                        aria-label="Set time estimate"
                      >
                        {estimateText}
                      </span>
                    )}
                  </div>
                </fieldset>
              )}

              {focus === "tempo" && targetMode === "streak" && (
                <fieldset className="ck-field">
                  <legend className="ck-label">Tempo demotion</legend>
                  <label className="ck-field">
                    <span className="ck-label">For this set</span>
                    <select
                      className="ck-input"
                      aria-label="Tempo demotion for this set"
                      value={demotionMode}
                      onChange={(event) =>
                        setDemotionMode(
                          event.target.value as "inherit" | "on" | "off",
                        )
                      }
                    >
                      <option value="inherit">Use global setting</option>
                      <option value="on">On</option>
                      <option value="off">Off</option>
                    </select>
                  </label>
                  {demotionMode === "on" && (
                    <div className="ck-field-grid ck-manual-rule">
                      <label className="ck-field">
                        <span className="ck-label">First demotion after sloppy</span>
                        <input
                          className="ck-input"
                          type="number"
                          min={2}
                          max={10}
                          aria-label="First demotion after sloppy reps"
                          value={demotionFirst}
                          onChange={(event) => setDemotionFirst(event.target.value)}
                        />
                      </label>
                      <label className="ck-field">
                        <span className="ck-label">Later demotions after sloppy</span>
                        <input
                          className="ck-input"
                          type="number"
                          min={1}
                          max={10}
                          aria-label="Later demotions after sloppy reps"
                          value={demotionRepeat}
                          onChange={(event) => setDemotionRepeat(event.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  <p className="ck-tuning-note">
                    Sloppy resets the clean streak and can step tempo down; Again does neither.
                  </p>
                </fieldset>
              )}

              {useMetronome && (
                <fieldset className="ck-field ck-tuning">
                  <legend className="ck-label">Metronome tuning</legend>
                  <p className="ck-tuning-note">
                    BPM counts the note value you choose. Changing this label
                    never converts or changes the BPM number.
                  </p>
                  <div className="ck-tuning-grid">
                    <label className="ck-field ck-tuning-unit">
                      <span className="ck-label">BPM note value</span>
                      <select
                        className="ck-input"
                        aria-label="BPM note value"
                        value={beatUnit}
                        onChange={(event) => {
                          tuningEdited.current = true;
                          setBeatUnit(event.target.value as BeatUnit);
                        }}
                      >
                        {BEAT_UNIT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <TuningStepper
                      label="Beats per bar"
                      value={beatsPerBar}
                      min={1}
                      max={16}
                      onChange={(next) => {
                        tuningEdited.current = true;
                        setBeatsPerBar(next);
                      }}
                    />
                    <TuningStepper
                      label="Subdivision"
                      value={subdivision}
                      min={1}
                      max={16}
                      onChange={(next) => {
                        tuningEdited.current = true;
                        setSubdivision(next);
                      }}
                    />
                  </div>
                </fieldset>
              )}

              {targetMode === "streak" ? (
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
              ) : null}
            </div>
          )}
        </div>
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
