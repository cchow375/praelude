import { describe, expect, it } from "vitest";
import {
  findQuoteParagraphIndex,
  parseInline,
  shouldWindow,
  splitParagraphs,
  WINDOW_CHAR_THRESHOLD,
} from "./excerpt";

describe("splitParagraphs", () => {
  it("splits on blank lines and joins hard wraps within a paragraph", () => {
    const text = "One line\nwrapped here.\n\nSecond paragraph.";
    expect(splitParagraphs(text)).toEqual([
      "One line wrapped here.",
      "Second paragraph.",
    ]);
  });

  it("drops empty blocks", () => {
    expect(splitParagraphs("\n\n  \n\nreal\n\n")).toEqual(["real"]);
  });
});

describe("findQuoteParagraphIndex", () => {
  it("locates the paragraph containing the quote (whitespace-normalized)", () => {
    const paras = ["intro", "The mind leads   the hand.", "outro"];
    expect(findQuoteParagraphIndex(paras, "The mind leads the hand.")).toBe(1);
  });

  it("returns -1 when the quote is absent", () => {
    expect(findQuoteParagraphIndex(["a", "b"], "nowhere")).toBe(-1);
  });
});

describe("shouldWindow", () => {
  it("windows a heading-less whole-book body", () => {
    expect(shouldWindow({ heading: "", text: "short" })).toBe(true);
  });

  it("windows a long section even with a heading", () => {
    expect(
      shouldWindow({
        heading: "A heading",
        text: "x".repeat(WINDOW_CHAR_THRESHOLD + 1),
      }),
    ).toBe(true);
  });

  it("shows a short, headed section whole", () => {
    expect(shouldWindow({ heading: "A heading", text: "short" })).toBe(false);
  });
});

describe("parseInline", () => {
  it("tokenizes strong, em, and code", () => {
    expect(parseInline("a **b** c *d* e `f`")).toEqual([
      { type: "text", value: "a " },
      { type: "strong", value: "b" },
      { type: "text", value: " c " },
      { type: "em", value: "d" },
      { type: "text", value: " e " },
      { type: "code", value: "f" },
    ]);
  });

  it("treats underscores as emphasis", () => {
    expect(parseInline("_slow_")).toEqual([{ type: "em", value: "slow" }]);
  });

  it("returns plain text unchanged", () => {
    expect(parseInline("nothing special")).toEqual([
      { type: "text", value: "nothing special" },
    ]);
  });
});
