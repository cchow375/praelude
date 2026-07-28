import { describe, expect, it } from "vitest";
import { paletteAt, SYSTEM_PALETTES, type SystemPalette } from "./palettes";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function expectValidPalette(
  palette: SystemPalette | undefined,
): asserts palette is SystemPalette {
  expect(palette).toBeDefined();
  expect(palette!.core).toMatch(HEX_COLOR);
  expect(palette!.body).toMatch(HEX_COLOR);
  expect(palette!.edge).toMatch(HEX_COLOR);
  expect(palette!.signal).toMatch(HEX_COLOR);
}

describe("SYSTEM_PALETTES", () => {
  it("contains 8 distinct, fully-specified palettes", () => {
    expect(SYSTEM_PALETTES).toHaveLength(8);
    for (const palette of SYSTEM_PALETTES) {
      expectValidPalette(palette);
    }
    const cores = SYSTEM_PALETTES.map((p) => p.core);
    expect(new Set(cores).size).toBe(cores.length);
  });
});

describe("paletteAt", () => {
  it("returns the palette at the given in-range index", () => {
    expect(paletteAt(0)).toBe(SYSTEM_PALETTES[0]);
    expect(paletteAt(7)).toBe(SYSTEM_PALETTES[7]);
    expect(paletteAt(3)).toBe(SYSTEM_PALETTES[3]);
  });

  it("wraps forward past the end of the palette list", () => {
    // length is 8: index 8 wraps to 0, 9 wraps to 1, 16 wraps to 0.
    expect(paletteAt(8)).toBe(SYSTEM_PALETTES[0]);
    expect(paletteAt(9)).toBe(SYSTEM_PALETTES[1]);
    expect(paletteAt(16)).toBe(SYSTEM_PALETTES[0]);
  });

  it("wraps negative indices into positive range instead of returning undefined", () => {
    // Naive `%` in JS would yield a negative index (e.g. -1 % 8 === -1) and
    // silently return `undefined` from array access; paletteAt normalizes this.
    expect(paletteAt(-1)).toBe(SYSTEM_PALETTES[7]);
    expect(paletteAt(-8)).toBe(SYSTEM_PALETTES[0]);
    expect(paletteAt(-9)).toBe(SYSTEM_PALETTES[7]);
  });

  it("is a pure function: repeated calls with the same index return the same reference", () => {
    const first = paletteAt(2);
    const second = paletteAt(2);
    expect(first).toBe(second);
  });

  it("is deterministic across the full non-negative domain used by hash % 8 callers", () => {
    for (let i = 0; i < 64; i++) {
      const palette = paletteAt(i);
      expectValidPalette(palette);
      expect(palette).toBe(SYSTEM_PALETTES[i % 8]);
    }
  });

  // --- Edge cases the implementation does NOT defend against ---
  // These document actual runtime behavior (verified against the real
  // implementation) that contradicts the `SystemPalette` return type: callers
  // that pass a non-finite or non-integer index silently get `undefined`
  // instead of a palette or a thrown error.

  it("returns undefined (not a palette, despite the declared return type) for NaN", () => {
    // NaN % n is NaN, so the wraparound math collapses to NaN and the array
    // index lookup fails silently.
    expect(paletteAt(NaN)).toBeUndefined();
  });

  it("returns undefined for +Infinity and -Infinity", () => {
    // Infinity % n is NaN in JS, so this degrades the same way as NaN.
    expect(paletteAt(Infinity)).toBeUndefined();
    expect(paletteAt(-Infinity)).toBeUndefined();
  });

  it("returns undefined for non-integer (fractional) indices instead of flooring", () => {
    // Array indexing only matches exact non-negative integer keys, so a
    // fractional result from the modulo math never resolves to an element.
    expect(paletteAt(2.5)).toBeUndefined();
    expect(paletteAt(-2.5)).toBeUndefined();
  });
});
