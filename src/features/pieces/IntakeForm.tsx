import { useState } from "react";
import type { HardSpot, Intake, PieceDetailData } from "./types";

// ---------------------------------------------------------------------------
// First-run intake for a piece. Captured once (until `intake_done`), it seeds
// the practice plan: goals, a deadline, a target tempo, the known hard spots,
// and a free-text "where I am now". Submitting builds an `Intake` serde bag and
// hands it up; the parent persists via `piece_intake_save`.
// ---------------------------------------------------------------------------

interface IntakeFormProps {
  piece: PieceDetailData;
  onSave: (intake: Intake) => void;
  saving?: boolean;
}

/** Parse a tempo input into a finite number, or null when blank/invalid. */
function parseTempo(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function IntakeForm({ piece, onSave, saving = false }: IntakeFormProps) {
  const [goals, setGoals] = useState<string[]>(
    piece.goals.length ? piece.goals : [""],
  );
  const [deadline, setDeadline] = useState<string>(piece.deadline ?? "");
  const [targetTempo, setTargetTempo] = useState<string>(
    piece.target_tempo != null ? String(piece.target_tempo) : "",
  );
  const [hardSpots, setHardSpots] = useState<HardSpot[]>(
    piece.hard_spots.length ? piece.hard_spots : [{ measures: "", note: "" }],
  );
  const [currentState, setCurrentState] = useState<string>(
    piece.current_state ?? "",
  );

  const setGoal = (i: number, v: string) =>
    setGoals((g) => g.map((x, idx) => (idx === i ? v : x)));
  const addGoal = () => setGoals((g) => [...g, ""]);
  const removeGoal = (i: number) =>
    setGoals((g) => (g.length > 1 ? g.filter((_, idx) => idx !== i) : g));

  const setSpot = (i: number, patch: Partial<HardSpot>) =>
    setHardSpots((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const addSpot = () =>
    setHardSpots((s) => [...s, { measures: "", note: "" }]);
  const removeSpot = (i: number) =>
    setHardSpots((s) => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const intake: Intake = {
      goals: goals.map((g) => g.trim()).filter((g) => g !== ""),
      deadline: deadline.trim() === "" ? null : deadline,
      target_tempo: parseTempo(targetTempo),
      hard_spots: hardSpots
        .map((s) => ({ measures: s.measures.trim(), note: s.note.trim() }))
        .filter((s) => s.measures !== "" || s.note !== ""),
      current_state: currentState.trim() === "" ? null : currentState.trim(),
    };
    onSave(intake);
  };

  return (
    <form className="intake-form" onSubmit={submit}>
      <h3 className="ck-form-heading">Set up “{piece.title}”</h3>
      <p className="ck-form-sub">
        A one-time intake so practice sessions know where you’re headed.
      </p>

      <fieldset className="ck-field">
        <legend className="ck-label">Goals</legend>
        {goals.map((g, i) => (
          <div className="ck-row" key={i}>
            <input
              className="ck-input"
              type="text"
              value={g}
              placeholder="e.g. play the A section from memory"
              aria-label={`Goal ${i + 1}`}
              onChange={(e) => setGoal(i, e.target.value)}
            />
            <button
              type="button"
              className="ck-row-remove"
              aria-label={`Remove goal ${i + 1}`}
              onClick={() => removeGoal(i)}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="ck-add" onClick={addGoal}>
          + Add goal
        </button>
      </fieldset>

      <div className="ck-field-grid">
        <label className="ck-field">
          <span className="ck-label">Deadline</span>
          <input
            className="ck-input"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>
        <label className="ck-field">
          <span className="ck-label">Target tempo (bpm)</span>
          <input
            className="ck-input"
            type="number"
            inputMode="numeric"
            min={1}
            value={targetTempo}
            placeholder="e.g. 120"
            onChange={(e) => setTargetTempo(e.target.value)}
          />
        </label>
      </div>

      <fieldset className="ck-field">
        <legend className="ck-label">Hard spots</legend>
        {hardSpots.map((s, i) => (
          <div className="ck-row" key={i}>
            <input
              className="ck-input ck-input-measures"
              type="text"
              value={s.measures}
              placeholder="mm. 17–24"
              aria-label={`Hard spot ${i + 1} measures`}
              onChange={(e) => setSpot(i, { measures: e.target.value })}
            />
            <input
              className="ck-input"
              type="text"
              value={s.note}
              placeholder="what's hard about it"
              aria-label={`Hard spot ${i + 1} note`}
              onChange={(e) => setSpot(i, { note: e.target.value })}
            />
            <button
              type="button"
              className="ck-row-remove"
              aria-label={`Remove hard spot ${i + 1}`}
              onClick={() => removeSpot(i)}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="ck-add" onClick={addSpot}>
          + Add hard spot
        </button>
      </fieldset>

      <label className="ck-field">
        <span className="ck-label">Where I am now</span>
        <textarea
          className="ck-input ck-textarea"
          rows={3}
          value={currentState}
          placeholder="Current state — tempo reached, sections learned, recurring mistakes…"
          onChange={(e) => setCurrentState(e.target.value)}
        />
      </label>

      <button type="submit" className="ck-primary" disabled={saving}>
        {saving ? "Saving…" : "Save intake"}
      </button>
    </form>
  );
}
