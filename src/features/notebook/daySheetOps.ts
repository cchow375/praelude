// Pure body transforms for the day-sheet editor (spec C1). No React, no Tauri —
// every function takes the ordered NotebookLine[] and returns a NEW body (plus,
// where a caret must follow the edit, where to put it). The editor keeps these
// pure so the tricky split/join/indent flows are unit-testable without a DOM,
// and so the whole sheet stays "a document you can edit as text" (spec 9/12):
// structure is only ever added or removed, never anything the user can't undo by
// typing/deleting.

import {
  MAX_BLOCK_MINUTES,
  MIN_BLOCK_MINUTES,
  type ItemLine,
  type LessonNotesLine,
  type NotebookLine,
  type TextLine,
} from "./lines";

/** A caret target after an edit: which line, and the character offset within it. */
export interface Caret {
  index: number;
  offset: number;
}

/** A body edit that moves the caret (Enter, Backspace-join). */
export interface Edit {
  body: NotebookLine[];
  caret: Caret;
}

/** The three lines that are plain editable text and freely split/join/merge. */
type PlainLine = TextLine | ItemLine | LessonNotesLine;

export function isPlainText(line: NotebookLine): line is PlainLine {
  return (
    line.type === "text" || line.type === "item" || line.type === "lesson_notes"
  );
}

/** The editable text of a plain line, or null for the widget lines. */
export function plainText(line: NotebookLine): string | null {
  return isPlainText(line) ? line.text : null;
}

/** Replace a plain line's text, preserving its type (and item checked/piece_id). */
export function withPlainText(line: NotebookLine, text: string): NotebookLine {
  switch (line.type) {
    case "text":
      return { type: "text", text };
    case "item":
      return { ...line, text };
    case "lesson_notes":
      return { type: "lesson_notes", text };
    default:
      return line;
  }
}

/** The piece heading a line sits under: the nearest preceding `piece` line's id. */
export function pieceContextAt(
  body: NotebookLine[],
  index: number,
): number | null {
  for (let i = Math.min(index, body.length - 1); i >= 0; i -= 1) {
    const line = body[i];
    if (line.type === "piece") return line.piece_id;
  }
  return null;
}

/** Sum every timed-block line — the header's "planned minutes" total (spec 1/2). */
export function totalMinutes(body: NotebookLine[]): number {
  return body.reduce(
    (sum, line) => (line.type === "block" ? sum + line.minutes : sum),
    0,
  );
}

export function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return MIN_BLOCK_MINUTES;
  return Math.max(
    MIN_BLOCK_MINUTES,
    Math.min(MAX_BLOCK_MINUTES, Math.round(value)),
  );
}

/** Enter: split a plain line at the caret; the tail continues the same kind. */
export function splitLine(
  body: NotebookLine[],
  index: number,
  offset: number,
): Edit {
  const line = body[index];
  const text = plainText(line);
  if (text == null) {
    // A widget line (piece/block/goal/prep): Enter just opens a text line below.
    const next = body.slice();
    next.splice(index + 1, 0, { type: "text", text: "" });
    return { body: next, caret: { index: index + 1, offset: 0 } };
  }
  const cut = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, cut);
  const after = text.slice(cut);
  const head = withPlainText(line, before);
  let tail: NotebookLine;
  if (line.type === "item") {
    // A new plan item continues the list under the same piece, unchecked.
    tail = { type: "item", text: after, checked: false };
    if (line.piece_id != null) tail.piece_id = line.piece_id;
  } else if (line.type === "lesson_notes") {
    tail = { type: "lesson_notes", text: after };
  } else {
    tail = { type: "text", text: after };
  }
  const next = body.slice();
  next.splice(index, 1, head, tail);
  return { body: next, caret: { index: index + 1, offset: 0 } };
}

/**
 * Backspace at the very start of a line (spec: "Backspace on empty joins/removes").
 * Merges into the previous plain line, removes an empty line, or softens a
 * top-of-sheet structured item back to text. Returns null when nothing should
 * happen (so the keystroke falls through to the browser).
 */
export function joinBackspace(
  body: NotebookLine[],
  index: number,
): Edit | null {
  const current = body[index];
  if (index <= 0) {
    // At the top: an empty checkbox de-structures to a plain line rather than
    // trapping the caret; anything else is left alone.
    if (current && current.type === "item" && current.text === "") {
      const next = body.slice();
      next[index] = { type: "text", text: "" };
      return { body: next, caret: { index, offset: 0 } };
    }
    return null;
  }
  const prev = body[index - 1];
  const curText = plainText(current);
  const prevText = plainText(prev);
  if (prevText != null && curText != null) {
    // Merge two plain lines; the previous line's kind wins and the caret lands
    // exactly where the join happened.
    const merged = withPlainText(prev, prevText + curText);
    const next = body.slice();
    next.splice(index - 1, 2, merged);
    return { body: next, caret: { index: index - 1, offset: prevText.length } };
  }
  if (curText === "") {
    // Previous line is a widget (piece/block/goal/prep): drop the empty line and
    // move up onto it rather than swallowing the widget.
    const next = body.slice();
    next.splice(index, 1);
    return {
      body: next,
      caret: {
        index: index - 1,
        offset: prevText != null ? prevText.length : 0,
      },
    };
  }
  return null;
}

/** Toggle a plan item's checkbox — display state on the sheet only (spec C3). */
export function toggleChecked(
  body: NotebookLine[],
  index: number,
): NotebookLine[] {
  const line = body[index];
  if (line.type !== "item") return body;
  const next = body.slice();
  next[index] = { ...line, checked: !line.checked };
  return next;
}

/** Tab: indent a line into a checkbox item under the enclosing piece heading. */
export function indent(body: NotebookLine[], index: number): NotebookLine[] {
  const line = body[index];
  const context = pieceContextAt(body, index);
  if (line.type === "text") {
    const item: ItemLine = { type: "item", text: line.text, checked: false };
    if (context != null) item.piece_id = context;
    const next = body.slice();
    next[index] = item;
    return next;
  }
  if (line.type === "item" && context != null && line.piece_id !== context) {
    const next = body.slice();
    next[index] = { ...line, piece_id: context };
    return next;
  }
  return body;
}

/** Shift+Tab: outdent a checkbox item back to a plain, piece-free text line. */
export function outdent(body: NotebookLine[], index: number): NotebookLine[] {
  const line = body[index];
  if (line.type !== "item") return body;
  const next = body.slice();
  next[index] = { type: "text", text: line.text };
  return next;
}

/** Insert one line after `index`, returning the new body and the inserted index. */
export function insertAfter(
  body: NotebookLine[],
  index: number,
  line: NotebookLine,
): { body: NotebookLine[]; index: number } {
  const at = Math.min(Math.max(index + 1, 0), body.length);
  const next = body.slice();
  next.splice(at, 0, line);
  return { body: next, index: at };
}

export function insertPiece(
  body: NotebookLine[],
  index: number,
  pieceId: number,
): { body: NotebookLine[]; index: number } {
  return insertAfter(body, index, { type: "piece", piece_id: pieceId });
}

/** Add a timed block after a piece/item line, inheriting its piece context. */
export function insertBlock(
  body: NotebookLine[],
  index: number,
  minutes: number,
): { body: NotebookLine[]; index: number } {
  const line: NotebookLine = { type: "block", minutes: clampMinutes(minutes) };
  const context = pieceContextAt(body, index);
  if (context != null) line.piece_id = context;
  return insertAfter(body, index, line);
}

export function setMinutes(
  body: NotebookLine[],
  index: number,
  minutes: number,
): NotebookLine[] {
  const line = body[index];
  if (line.type !== "block") return body;
  const next = body.slice();
  next[index] = { ...line, minutes: clampMinutes(minutes) };
  return next;
}

/** Turn a "/piece" (or picked) text line into a piece heading in place. */
export function convertToPiece(
  body: NotebookLine[],
  index: number,
  pieceId: number,
): NotebookLine[] {
  const next = body.slice();
  next[index] = { type: "piece", piece_id: pieceId };
  return next;
}

/** Swap a plan item for the goal_ref it was promoted into (spec 13). */
export function toGoalRef(
  body: NotebookLine[],
  index: number,
  goalId: number,
): NotebookLine[] {
  const next = body.slice();
  next[index] = { type: "goal_ref", goal_id: goalId };
  return next;
}

/** Insert a chip's text into a plain line at the caret; returns line + new caret. */
export function insertIntoText(
  line: NotebookLine,
  offset: number,
  snippet: string,
): { line: NotebookLine; caret: number } {
  const text = plainText(line);
  if (text == null) return { line, caret: offset };
  const cut = Math.max(0, Math.min(offset, text.length));
  const next = text.slice(0, cut) + snippet + text.slice(cut);
  return { line: withPlainText(line, next), caret: cut + snippet.length };
}

export function removeAt(body: NotebookLine[], index: number): NotebookLine[] {
  const next = body.slice();
  next.splice(index, 1);
  return next;
}

/** Copy-yesterday: every plan item comes across UNCHECKED (spec 11). */
export function unchecked(lines: NotebookLine[]): NotebookLine[] {
  return lines.map((line) =>
    line.type === "item" ? { ...line, checked: false } : line,
  );
}

// --- Lesson prep (two quick lists) ----------------------------------------

export function addBring(
  body: NotebookLine[],
  index: number,
  pieceId: number,
): NotebookLine[] {
  const line = body[index];
  if (line.type !== "lesson_prep" || line.bring.includes(pieceId)) return body;
  const next = body.slice();
  next[index] = { ...line, bring: [...line.bring, pieceId] };
  return next;
}

export function removeBring(
  body: NotebookLine[],
  index: number,
  pieceId: number,
): NotebookLine[] {
  const line = body[index];
  if (line.type !== "lesson_prep") return body;
  const next = body.slice();
  next[index] = { ...line, bring: line.bring.filter((id) => id !== pieceId) };
  return next;
}

export function setWant(
  body: NotebookLine[],
  index: number,
  want: string,
): NotebookLine[] {
  const line = body[index];
  if (line.type !== "lesson_prep") return body;
  const next = body.slice();
  next[index] = { ...line, want };
  return next;
}

/** Nearest text/item line before `from` for ArrowUp navigation (else null). */
export function prevEditableIndex(
  body: NotebookLine[],
  from: number,
): number | null {
  for (let i = from - 1; i >= 0; i -= 1) {
    if (body[i].type === "text" || body[i].type === "item") return i;
  }
  return null;
}

/** Nearest text/item line after `from` for ArrowDown navigation (else null). */
export function nextEditableIndex(
  body: NotebookLine[],
  from: number,
): number | null {
  for (let i = from + 1; i < body.length; i += 1) {
    if (body[i].type === "text" || body[i].type === "item") return i;
  }
  return null;
}
