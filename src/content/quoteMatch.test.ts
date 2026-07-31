import { describe, expect, it } from "vitest";
import {
  normalizeQuote,
  normalizeSource,
  sourceContainsQuote,
} from "./quoteMatch";

/**
 * Corpus-independent unit coverage for quoteMatch.ts. quotes.honesty.test.ts
 * exercises normalizeQuote/normalizeSource against the real vault corpus, but
 * that suite is `describe.skipIf(!corpusPresent)` and the corpus dir lives
 * under the user's home folder — absent in CI and on any other machine, so
 * that suite silently skips there. sourceContainsQuote is not imported by any
 * test at all. These fixtures are hand-written so the three exports have
 * guaranteed coverage regardless of the vault's presence.
 */

describe("normalizeQuote", () => {
  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeQuote("The mind    leads\tthe   hand.")).toBe(
      "The mind leads the hand.",
    );
  });

  it("collapses newlines (hard wraps) within a quote to a single space", () => {
    expect(normalizeQuote("The mind leads\nthe hand.")).toBe(
      "The mind leads the hand.",
    );
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeQuote("   The mind leads the hand.   ")).toBe(
      "The mind leads the hand.",
    );
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeQuote("   \n\t  ")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeQuote("")).toBe("");
  });
});

describe("normalizeSource", () => {
  it("collapses intra-paragraph whitespace runs to a single space", () => {
    expect(normalizeSource("The mind    leads\tthe   hand.")).toBe(
      "The mind leads the hand.",
    );
  });

  it("collapses a single hard-wrap newline within a paragraph to a space", () => {
    expect(normalizeSource("One line\nwrapped here.")).toBe(
      "One line wrapped here.",
    );
  });

  it("collapses a blank-line paragraph break (2+ newlines) to the \\n sentinel", () => {
    expect(normalizeSource("First paragraph.\n\nSecond paragraph.")).toBe(
      "First paragraph.\nSecond paragraph.",
    );
  });

  it("collapses a paragraph break with 3+ newlines (and surrounding spaces) to a single \\n sentinel", () => {
    expect(normalizeSource("First.\n \n \nSecond.")).toBe("First.\nSecond.");
  });

  it("treats NBSP (U+00A0) as whitespace, like the Rust reader's char::is_whitespace", () => {
    // "The mind" — an NBSP joining two words within a paragraph.
    expect(normalizeSource("The mind leads the hand.")).toBe(
      "The mind leads the hand.",
    );
  });

  it("drops leading whitespace entirely rather than emitting a leading space", () => {
    expect(normalizeSource("   \n  The mind leads the hand.")).toBe(
      "The mind leads the hand.",
    );
  });

  it("drops leading whitespace even when it contains a paragraph break", () => {
    expect(normalizeSource("\n\n\nThe mind leads the hand.")).toBe(
      "The mind leads the hand.",
    );
  });

  it("returns empty string for an all-whitespace source", () => {
    expect(normalizeSource("   \n\n\t  ")).toBe("");
  });

  it("handles multiple paragraphs with mixed whitespace consistently", () => {
    const raw =
      "  Intro   line.\n\nSecond   paragraph\nwraps here.\n\n\nThird para.";
    expect(normalizeSource(raw)).toBe(
      "Intro line.\nSecond paragraph wraps here.\nThird para.",
    );
  });
});

describe("sourceContainsQuote", () => {
  it("finds a verbatim quote inside a normalized source", () => {
    const source = "Some intro text.\n\nThe mind leads the hand.\n\nOutro.";
    expect(sourceContainsQuote(source, "The mind leads the hand.")).toBe(true);
  });

  it("matches even when source and quote have differing internal whitespace", () => {
    const source = "Header.\n\nThe   mind\nleads   the hand.\n\nFooter.";
    expect(sourceContainsQuote(source, "The mind leads the hand.")).toBe(true);
  });

  it("rejects a quote that straddles a paragraph boundary", () => {
    // "leads" ends paragraph one, "the hand." starts paragraph two — the
    // normalized source has a literal \n sentinel between them, which the
    // needle (a single space-joined string) can never match across.
    const source = "The mind leads\n\nthe hand.";
    expect(sourceContainsQuote(source, "The mind leads the hand.")).toBe(false);
  });

  it("rejects a quote that is not present in the source at all", () => {
    const source = "Completely unrelated prose about something else.";
    expect(sourceContainsQuote(source, "The mind leads the hand.")).toBe(false);
  });

  it("returns false for an empty quote regardless of source content", () => {
    expect(sourceContainsQuote("Any source text at all.", "")).toBe(false);
    expect(sourceContainsQuote("Any source text at all.", "   \n  ")).toBe(
      false,
    );
  });

  it("is case-sensitive (no case-folding in the honesty gate)", () => {
    const source = "The mind leads the hand.";
    expect(sourceContainsQuote(source, "the mind leads the hand.")).toBe(false);
  });

  it("finds a quote that is a strict substring of a larger normalized line", () => {
    const source = "Preamble: The mind leads the hand, always has.";
    expect(sourceContainsQuote(source, "The mind leads the hand")).toBe(true);
  });
});
