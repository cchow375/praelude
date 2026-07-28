// Pure lines <-> plaintext round-trip (spec items 9/12): every typed line renders
// to ONE visible, editable line of text and parses back. Text is the sigil-less
// fallback, so typing a marker — a `- [ ]` box, a `# @<piece>` heading, `25 min`,
// `> notes` — promotes a plain line into structure. The notebook is therefore
// edited as one document of text; it feels like typing on paper, not filling a form.
//
// Guarantee: parseLine(renderLine(line)) deep-equals `line` for every canonical
// line, and linesToText/textToLines are inverse for canonical text. Prose that
// literally equals a marker is intentionally re-read as that marker (the promote
// behaviour above), which is the only case the two are not inverse.

import type { NotebookLine } from "./lines";

export function renderLine(line: NotebookLine): string {
  switch (line.type) {
    case "text":
      return line.text;
    case "piece":
      return `# @${line.piece_id}`;
    case "item": {
      const box = line.checked ? "- [x]" : "- [ ]";
      const tag = line.piece_id != null ? ` @p${line.piece_id}` : "";
      return `${box} ${line.text}${tag}`;
    }
    case "block": {
      const tag = line.piece_id != null ? ` @p${line.piece_id}` : "";
      return `${line.minutes} min${tag}`;
    }
    case "lesson_notes":
      return `> ${line.text}`;
    case "lesson_prep":
      return `>> bring: ${line.bring.join(", ")} | want: ${line.want}`;
    case "goal_ref":
      return `goal @${line.goal_id}`;
  }
}

const PIECE_RE = /^# @(\d+)$/;
const ITEM_RE = /^- \[([ xX])\] ?(.*)$/;
const ITEM_PIECE_TAG_RE = /^(.*?)\s+@p(\d+)$/;
const PREP_RE = /^>> bring:\s*([\d,\s]*?)\s*\|\s*want:\s*(.*)$/;
const NOTES_RE = /^> (.*)$/;
const GOAL_RE = /^goal @(\d+)$/;
const BLOCK_RE = /^(\d+)\s*min(?:\s+@p(\d+))?$/;

export function parseLine(raw: string): NotebookLine {
  const piece = PIECE_RE.exec(raw);
  if (piece) return { type: "piece", piece_id: Number(piece[1]) };

  const item = ITEM_RE.exec(raw);
  if (item) {
    const checked = item[1] === "x" || item[1] === "X";
    let text = item[2];
    const tag = ITEM_PIECE_TAG_RE.exec(text);
    if (tag) {
      text = tag[1];
      return { type: "item", text, checked, piece_id: Number(tag[2]) };
    }
    return { type: "item", text, checked };
  }

  // Lesson prep (`>> ...`) is checked before lesson notes (`> ...`).
  const prep = PREP_RE.exec(raw);
  if (prep) {
    const bring = prep[1]
      .split(/[\s,]+/)
      .filter((token) => token.length > 0)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1);
    return { type: "lesson_prep", bring, want: prep[2] };
  }

  const notes = NOTES_RE.exec(raw);
  if (notes) return { type: "lesson_notes", text: notes[1] };

  const goal = GOAL_RE.exec(raw);
  if (goal) return { type: "goal_ref", goal_id: Number(goal[1]) };

  const block = BLOCK_RE.exec(raw);
  if (block) {
    const minutes = Number(block[1]);
    return block[2] != null
      ? { type: "block", minutes, piece_id: Number(block[2]) }
      : { type: "block", minutes };
  }

  return { type: "text", text: raw };
}

/** Render an ordered body to the editable document text (one line per node). */
export function linesToText(lines: NotebookLine[]): string {
  return lines.map(renderLine).join("\n");
}

/** Parse the editable document text back into ordered lines. "" -> [] (empty sheet). */
export function textToLines(text: string): NotebookLine[] {
  if (text === "") return [];
  return text.split("\n").map(parseLine);
}
