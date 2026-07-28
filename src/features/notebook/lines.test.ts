import { describe, expect, it } from "vitest";
import {
  MAX_LINES,
  MAX_TEXT_FIELD,
  assertPiecePlanText,
  canonicalizeBody,
  canonicalizeLine,
  parseBodyJson,
} from "./lines";

describe("notebook line canonicalization + validation", () => {
  it("defaults a missing `checked` to false and keeps it on items", () => {
    expect(canonicalizeLine({ type: "item", text: "run" })).toEqual({
      type: "item",
      text: "run",
      checked: false,
    });
    expect(
      canonicalizeLine({ type: "item", text: "run", checked: true }),
    ).toEqual({ type: "item", text: "run", checked: true });
  });

  it("drops null/absent optional piece_id (canonical re-serialization)", () => {
    // A null optional is skipped, not stored as null.
    expect(
      canonicalizeLine({
        type: "item",
        text: "run",
        checked: false,
        piece_id: null,
      }),
    ).toEqual({ type: "item", text: "run", checked: false });
    expect(canonicalizeLine({ type: "block", minutes: 25 })).toEqual({
      type: "block",
      minutes: 25,
    });
    expect(
      canonicalizeLine({ type: "block", minutes: 25, piece_id: 2 }),
    ).toEqual({ type: "block", minutes: 25, piece_id: 2 });
  });

  it("rejects an unknown line type with a plain message", () => {
    expect(() => canonicalizeLine({ type: "sticker", text: "x" })).toThrow(
      /unknown notebook line type: sticker/,
    );
  });

  it("rejects an unknown field on a known line type", () => {
    expect(() =>
      canonicalizeLine({ type: "text", text: "x", color: "red" }),
    ).toThrow(/unknown field 'color' on text line/);
  });

  it("enforces piece_id / goal_id >= 1", () => {
    expect(() => canonicalizeLine({ type: "piece", piece_id: 0 })).toThrow(
      /piece_id must be an integer >= 1/,
    );
    expect(() => canonicalizeLine({ type: "goal_ref", goal_id: 0 })).toThrow(
      /goal_id must be an integer >= 1/,
    );
  });

  it("enforces block minutes in 1..=1440", () => {
    expect(() => canonicalizeLine({ type: "block", minutes: 0 })).toThrow(
      /minutes must be an integer in 1..=1440/,
    );
    expect(() => canonicalizeLine({ type: "block", minutes: 1441 })).toThrow(
      /minutes must be an integer in 1..=1440/,
    );
    expect(canonicalizeLine({ type: "block", minutes: 1440 })).toEqual({
      type: "block",
      minutes: 1440,
    });
  });

  it("bounds text fields and the lesson_prep bring list", () => {
    const tooLong = "a".repeat(MAX_TEXT_FIELD + 1);
    expect(() => canonicalizeLine({ type: "text", text: tooLong })).toThrow(
      /text exceeds 8000 characters/,
    );
    const tooManyPieces = Array.from({ length: 201 }, (_, i) => i + 1);
    expect(() =>
      canonicalizeLine({ type: "lesson_prep", bring: tooManyPieces, want: "" }),
    ).toThrow(/bring exceeds 200 pieces/);
  });

  it("canonicalizes lesson_prep to numeric bring ids + a want string", () => {
    expect(
      canonicalizeLine({
        type: "lesson_prep",
        bring: [3, 1],
        want: "markings",
      }),
    ).toEqual({ type: "lesson_prep", bring: [3, 1], want: "markings" });
  });

  it("rejects a body that is not an array and one that is too long", () => {
    expect(() => canonicalizeBody({})).toThrow(/must be an array/);
    const overLong = Array.from({ length: MAX_LINES + 1 }, () => ({
      type: "text",
      text: "x",
    }));
    expect(() => canonicalizeBody(overLong)).toThrow(/exceeds 2000 lines/);
  });

  it("parseBodyJson rejects malformed JSON with a plain message", () => {
    expect(() => parseBodyJson("{not json")).toThrow(/not valid JSON/);
    expect(parseBodyJson("[]")).toEqual([]);
    expect(parseBodyJson('[{"type":"text","text":"hi"}]')).toEqual([
      { type: "text", text: "hi" },
    ]);
  });

  it("bounds piece-plan text at 40000 chars", () => {
    expect(assertPiecePlanText("ok")).toBe("ok");
    expect(() => assertPiecePlanText("x".repeat(40001))).toThrow(
      /exceeds 40000 characters/,
    );
  });
});
