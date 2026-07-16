import { describe, expect, it } from "vitest";
import { parseSpokenCountInteger, parseSpokenInteger } from "./spokenNumber";

describe("parseSpokenInteger", () => {
  it.each([
    ["4", 4],
    ["four", 4],
    ["twenty-one", 21],
    ["ninety six", 96],
    ["one hundred and twenty", 120],
    ["three hundred", 300],
    ["one twenty", 120],
    ["one oh five", 105],
    ["nine six", 96],
  ])("parses %s as %i", (raw, expected) => {
    expect(parseSpokenInteger(raw)).toBe(expected);
  });

  it.each([
    "",
    "for",
    "too",
    "to",
    "four reps",
    "twenty twenty",
    "one 20",
    "hundred",
    "zero one",
    "one hundred and and one",
    "five sixteen to five thirty",
  ])("rejects the unsafe or malformed phrase %s", (raw) => {
    expect(parseSpokenInteger(raw)).toBeNull();
  });
});

describe("parseSpokenCountInteger", () => {
  it("accepts explicit count cardinals and literals", () => {
    expect(parseSpokenCountInteger("twelve")).toBe(12);
    expect(parseSpokenCountInteger("12")).toBe(12);
    expect(parseSpokenCountInteger("ninety six")).toBe(96);
  });

  it("rejects ambiguous digit-by-digit count words", () => {
    expect(parseSpokenCountInteger("one two")).toBeNull();
    expect(parseSpokenCountInteger("nine six")).toBeNull();
    expect(parseSpokenCountInteger("one oh oh")).toBeNull();
  });
});
