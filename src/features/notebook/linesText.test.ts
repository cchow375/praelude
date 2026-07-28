import { describe, expect, it } from "vitest";
import { linesToText, parseLine, renderLine, textToLines } from "./linesText";
import type { NotebookLine } from "./lines";

// One canonical value of every one of the seven line shapes. Each MUST render to
// a single visible line and parse back to itself (spec items 9/12).
const SAMPLES: Record<string, NotebookLine> = {
  text: { type: "text", text: "Slow practice, hands separate." },
  piece: { type: "piece", piece_id: 1 },
  "item (checked, under a piece)": {
    type: "item",
    text: "octave run",
    checked: true,
    piece_id: 1,
  },
  "item (unchecked, no piece)": {
    type: "item",
    text: "warm up scales",
    checked: false,
  },
  "block (with piece)": { type: "block", minutes: 25, piece_id: 1 },
  "block (no piece)": { type: "block", minutes: 25 },
  lesson_notes: { type: "lesson_notes", text: "pedal timing in the coda" },
  lesson_prep: {
    type: "lesson_prep",
    bring: [1, 2],
    want: "metronome markings; fingering",
  },
  goal_ref: { type: "goal_ref", goal_id: 5 },
};

describe("notebook lines <-> text round-trip", () => {
  for (const [label, line] of Object.entries(SAMPLES)) {
    it(`round-trips ${label} through visible editable text`, () => {
      const rendered = renderLine(line);
      // Every line renders to exactly one physical line of text.
      expect(rendered.includes("\n")).toBe(false);
      expect(parseLine(rendered)).toEqual(line);
    });
  }

  it("renders an ordered body to a document and parses it back verbatim", () => {
    const body = Object.values(SAMPLES);
    const text = linesToText(body);
    expect(text.split("\n")).toHaveLength(body.length);
    expect(textToLines(text)).toEqual(body);
  });

  it("maps an empty sheet to empty text and back (empty sheet is [])", () => {
    expect(linesToText([])).toBe("");
    expect(textToLines("")).toEqual([]);
  });

  it("preserves blank lines as empty text lines", () => {
    const body: NotebookLine[] = [
      { type: "text", text: "line one" },
      { type: "text", text: "" },
      { type: "text", text: "line three" },
    ];
    expect(textToLines(linesToText(body))).toEqual(body);
  });

  it("treats a sigil-less prose line as text, not structure", () => {
    expect(parseLine("just a thought about phrasing")).toEqual({
      type: "text",
      text: "just a thought about phrasing",
    });
  });

  // Bite: the trailing piece tag must be stripped from item text, not left in
  // it. If the tag regex or ordering were wrong, `text` would be "octave run @p1"
  // (or piece_id undefined) and this fails.
  it("keeps the item piece tag out of the item text", () => {
    expect(parseLine("- [x] octave run @p1")).toEqual({
      type: "item",
      text: "octave run",
      checked: true,
      piece_id: 1,
    });
    // A trailing word that is not a @p<id> tag stays in the text.
    expect(parseLine("- [ ] email @p1 tomorrow")).toEqual({
      type: "item",
      text: "email @p1 tomorrow",
      checked: false,
    });
  });

  it("parses a lesson_prep line with an empty bring list", () => {
    expect(parseLine(">> bring:  | want: a fresh metronome")).toEqual({
      type: "lesson_prep",
      bring: [],
      want: "a fresh metronome",
    });
  });
});
