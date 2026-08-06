import { describe, expect, it } from "vitest";
import { carryLine } from "./carryForward";
import type { BlockLine, ItemLine } from "./lines";

const FROM_DATE = "2026-08-04"; // dayLabel → "Aug 4"

describe("carryLine (spec A8)", () => {
  it("resets an unchecked item to checked:false and appends the provenance suffix", () => {
    const source: ItemLine = {
      type: "item",
      text: "measure 12 run",
      checked: false,
    };
    const carried = carryLine(source, FROM_DATE);
    expect(carried).toEqual({
      type: "item",
      text: "measure 12 run · from Aug 4",
      checked: false,
    });
  });

  it("resets an already-checked item to checked:false too", () => {
    const source: ItemLine = { type: "item", text: "scales", checked: true };
    const carried = carryLine(source, FROM_DATE) as ItemLine;
    expect(carried.checked).toBe(false);
  });

  it("preserves piece_id on a carried item", () => {
    const source: ItemLine = {
      type: "item",
      text: "left hand only",
      checked: false,
      piece_id: 7,
    };
    const carried = carryLine(source, FROM_DATE) as ItemLine;
    expect(carried.piece_id).toBe(7);
  });

  it("does not stack a second provenance suffix on an already-carried line", () => {
    const source: ItemLine = {
      type: "item",
      text: "measure 12 run · from Jul 1",
      checked: false,
    };
    const carried = carryLine(source, FROM_DATE) as ItemLine;
    expect(carried.text).toBe("measure 12 run · from Jul 1");
  });

  it("appends a BlockLine verbatim — no text field, provenance skipped", () => {
    const source: BlockLine = { type: "block", minutes: 20, piece_id: 3 };
    const carried = carryLine(source, FROM_DATE);
    expect(carried).toEqual({ type: "block", minutes: 20, piece_id: 3 });
    expect((carried as Record<string, unknown>).text).toBeUndefined();
  });

  it("carrying the same source line twice produces two independent, appendable copies — no dedup", () => {
    const source: ItemLine = {
      type: "item",
      text: "octave run",
      checked: false,
    };
    const first = carryLine(source, FROM_DATE);
    const second = carryLine(source, FROM_DATE);
    expect(first).toEqual(second); // same transform...
    expect(first).not.toBe(second); // ...but distinct objects, safely appended twice
  });

  it("never mutates the source line", () => {
    const source: ItemLine = {
      type: "item",
      text: "trill practice",
      checked: false,
    };
    const snapshot = { ...source };
    carryLine(source, FROM_DATE);
    expect(source).toEqual(snapshot);
  });
});
