// Frontend mirror of the backend `ProposedAction` (src-tauri/src/brain/mod.rs).
// The backend already validates and drops malformed proposals, but the union is
// re-narrowed here so a surprising IPC payload can never reach a slim card or a
// confirm→command mapping untyped. Anything off-shape parses to `null`.

export type ProposedVerdict = "clean" | "flawed" | "failed";

export interface ProposedVerdictAction {
  readonly kind: "verdict";
  readonly summary: string;
  readonly verdict: ProposedVerdict;
  readonly note: string | null;
}

export interface ProposedTempoAction {
  readonly kind: "tempo";
  readonly summary: string;
  readonly bpm: number;
}

export interface ProposedUndoAction {
  readonly kind: "undo";
  readonly summary: string;
}

export interface ProposedRestartAction {
  readonly kind: "restart";
  readonly summary: string;
  readonly required_clean_streak: number | null;
}

export type ProposedAction =
  | ProposedVerdictAction
  | ProposedTempoAction
  | ProposedUndoAction
  | ProposedRestartAction;

// Mirrors the backend metronome clamp (audio::clock) and note cap.
const MIN_BPM = 1;
const MAX_BPM = 1000;
const MAX_NOTE_CHARS = 200;
const MIN_STREAK = 1;
const MAX_STREAK = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/** Narrow an untrusted IPC value into the closed action union, or drop it. */
export function parseProposedAction(value: unknown): ProposedAction | null {
  if (!isRecord(value)) return null;
  const summary = boundedString(value.summary, 400);
  if (summary === null) return null;

  switch (value.kind) {
    case "verdict": {
      if (
        value.verdict !== "clean"
        && value.verdict !== "flawed"
        && value.verdict !== "failed"
      ) return null;
      let note: string | null = null;
      if (value.note != null) {
        note = boundedString(value.note, MAX_NOTE_CHARS);
        if (note === null) return null;
      }
      return { kind: "verdict", summary, verdict: value.verdict, note };
    }
    case "tempo": {
      const bpm = value.bpm;
      if (
        typeof bpm !== "number"
        || !Number.isFinite(bpm)
        || bpm < MIN_BPM
        || bpm > MAX_BPM
      ) return null;
      return { kind: "tempo", summary, bpm };
    }
    case "undo":
      return { kind: "undo", summary };
    case "restart": {
      let streak: number | null = null;
      if (value.required_clean_streak != null) {
        const raw = value.required_clean_streak;
        if (
          typeof raw !== "number"
          || !Number.isSafeInteger(raw)
          || raw < MIN_STREAK
          || raw > MAX_STREAK
        ) return null;
        streak = raw;
      }
      return { kind: "restart", summary, required_clean_streak: streak };
    }
    default:
      return null;
  }
}
