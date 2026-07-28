// NotebookLine — the seven typed lines of a day-sheet body (spec C1/C2), mirroring
// the frozen Rust backend contract (.workflow/scratch/day-sheet-contract.md):
// internally tagged `type`, snake_case fields, unknown type OR field rejected.
//
// This module is PURE (no React, no Tauri): the line types, the bounds the
// backend enforces, and the canonical re-serialization it performs on save. The
// dev mock reuses `parseBodyJson`/`assertPiecePlanText` so the browser harness
// validates and re-serializes exactly like native, and the editor reconciles
// against whatever canonical body the save returns.

export interface TextLine {
  type: "text";
  text: string;
}
export interface PieceLine {
  type: "piece";
  piece_id: number;
}
export interface ItemLine {
  type: "item";
  text: string;
  checked: boolean;
  piece_id?: number;
}
export interface BlockLine {
  type: "block";
  minutes: number;
  piece_id?: number;
}
export interface LessonNotesLine {
  type: "lesson_notes";
  text: string;
}
export interface LessonPrepLine {
  type: "lesson_prep";
  bring: number[];
  want: string;
}
export interface GoalRefLine {
  type: "goal_ref";
  goal_id: number;
}

export type NotebookLine =
  | TextLine
  | PieceLine
  | ItemLine
  | BlockLine
  | LessonNotesLine
  | LessonPrepLine
  | GoalRefLine;

export type NotebookLineType = NotebookLine["type"];

// Bounds — the backend rejects anything beyond these.
export const MAX_LINES = 2000;
export const MAX_TEXT_FIELD = 8000;
export const MAX_PIECE_PLAN_CHARS = 40000;
export const MIN_BLOCK_MINUTES = 1;
export const MAX_BLOCK_MINUTES = 1440;
export const MAX_LESSON_PREP_BRING = 200;

/** `day_sheet_get`/`day_sheet_save` return shape (body parsed to lines). */
export interface DaySheet {
  date: string;
  body: NotebookLine[];
  updated_at: string;
}

/** `piece_plan_get`/`piece_plan_save` return shape. */
export interface PiecePlan {
  piece_id: number;
  body_text: string;
  updated_at: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("notebook line must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be an integer >= 1`);
  }
  return value;
}

function boundedText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (value.length > MAX_TEXT_FIELD) {
    throw new Error(`${field} exceeds ${MAX_TEXT_FIELD} characters`);
  }
  return value;
}

function rejectUnknownFields(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  type: string,
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw new Error(`unknown field '${key}' on ${type} line`);
    }
  }
}

function optionalPieceId(raw: Record<string, unknown>): number | undefined {
  if (raw.piece_id == null) return undefined;
  return positiveInt(raw.piece_id, "piece_id");
}

/** Validate one raw line and return its canonical form, or throw on any breach. */
export function canonicalizeLine(input: unknown): NotebookLine {
  const raw = asRecord(input);
  const type = raw.type;
  switch (type) {
    case "text":
      rejectUnknownFields(raw, ["type", "text"], "text");
      return { type: "text", text: boundedText(raw.text, "text") };
    case "piece":
      rejectUnknownFields(raw, ["type", "piece_id"], "piece");
      return { type: "piece", piece_id: positiveInt(raw.piece_id, "piece_id") };
    case "item": {
      rejectUnknownFields(raw, ["type", "text", "checked", "piece_id"], "item");
      if (raw.checked != null && typeof raw.checked !== "boolean") {
        throw new Error("checked must be a boolean");
      }
      const line: ItemLine = {
        type: "item",
        text: boundedText(raw.text, "text"),
        checked: raw.checked === true,
      };
      const pieceId = optionalPieceId(raw);
      if (pieceId != null) line.piece_id = pieceId;
      return line;
    }
    case "block": {
      rejectUnknownFields(raw, ["type", "minutes", "piece_id"], "block");
      const minutes = raw.minutes;
      if (
        typeof minutes !== "number" ||
        !Number.isInteger(minutes) ||
        minutes < MIN_BLOCK_MINUTES ||
        minutes > MAX_BLOCK_MINUTES
      ) {
        throw new Error(
          `minutes must be an integer in ${MIN_BLOCK_MINUTES}..=${MAX_BLOCK_MINUTES}`,
        );
      }
      const line: BlockLine = { type: "block", minutes };
      const pieceId = optionalPieceId(raw);
      if (pieceId != null) line.piece_id = pieceId;
      return line;
    }
    case "lesson_notes":
      rejectUnknownFields(raw, ["type", "text"], "lesson_notes");
      return { type: "lesson_notes", text: boundedText(raw.text, "text") };
    case "lesson_prep": {
      rejectUnknownFields(raw, ["type", "bring", "want"], "lesson_prep");
      if (!Array.isArray(raw.bring)) throw new Error("bring must be an array");
      if (raw.bring.length > MAX_LESSON_PREP_BRING) {
        throw new Error(`bring exceeds ${MAX_LESSON_PREP_BRING} pieces`);
      }
      const bring = raw.bring.map((id) => positiveInt(id, "bring piece_id"));
      return {
        type: "lesson_prep",
        bring,
        want: boundedText(raw.want, "want"),
      };
    }
    case "goal_ref":
      rejectUnknownFields(raw, ["type", "goal_id"], "goal_ref");
      return { type: "goal_ref", goal_id: positiveInt(raw.goal_id, "goal_id") };
    default:
      throw new Error(
        `unknown notebook line type: ${
          typeof type === "string" ? type : JSON.stringify(type)
        }`,
      );
  }
}

/** Validate + canonicalize a whole body array (≤2000 lines), or throw. */
export function canonicalizeBody(input: unknown): NotebookLine[] {
  if (!Array.isArray(input)) throw new Error("day sheet body must be an array");
  if (input.length > MAX_LINES) {
    throw new Error(`day sheet exceeds ${MAX_LINES} lines`);
  }
  return input.map(canonicalizeLine);
}

/** Parse a body_json STRING (what `day_sheet_save` takes) into canonical lines. */
export function parseBodyJson(bodyJson: string): NotebookLine[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyJson);
  } catch {
    throw new Error("day sheet body is not valid JSON");
  }
  return canonicalizeBody(parsed);
}

/** Enforce the piece-plan text bound the backend enforces, or throw. */
export function assertPiecePlanText(bodyText: string): string {
  if (bodyText.length > MAX_PIECE_PLAN_CHARS) {
    throw new Error(`piece plan exceeds ${MAX_PIECE_PLAN_CHARS} characters`);
  }
  return bodyText;
}
