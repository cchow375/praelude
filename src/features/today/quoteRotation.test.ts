import { describe, expect, it } from "vitest";
import {
  clampToWords,
  pickQuoteOnOpen,
  type QuoteStore,
} from "./quoteRotation";
import { QUOTES, type Quote } from "../../content/quotes";

/** An in-memory QuoteStore standing in for localStorage. */
function fakeStore(): QuoteStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

/** Small deterministic corpus for tight assertions. */
function corpus(n: number): Quote[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    text: `text ${i}`,
    source_id: "roskell-complete-pianist",
    author: `Author ${i}`,
    book: "Book",
    heading: "",
    themes: [],
  }));
}

describe("home quote rotation", () => {
  it("shows every quote once before any repeat (no-repeat until exhausted)", () => {
    const store = fakeStore();
    const quotes = corpus(182);
    const seen: string[] = [];
    for (let i = 0; i < quotes.length; i += 1) {
      seen.push(pickQuoteOnOpen(store, quotes, () => 12345).id);
    }
    expect(new Set(seen).size).toBe(182); // all unique
    expect(new Set(seen)).toEqual(new Set(quotes.map((q) => q.id))); // all shown
  });

  it("starts a fresh full permutation after exhaustion (no repeat within cycle 2)", () => {
    const store = fakeStore();
    const quotes = corpus(20);
    for (let i = 0; i < 20; i += 1) pickQuoteOnOpen(store, quotes, () => 999);
    const cycle2: string[] = [];
    for (let i = 0; i < 20; i += 1)
      cycle2.push(pickQuoteOnOpen(store, quotes, () => 999).id);
    expect(new Set(cycle2).size).toBe(20);
  });

  it("is deterministic: the same stored seed reproduces the same sequence", () => {
    const quotes = corpus(30);
    const runA: string[] = [];
    const runB: string[] = [];
    const a = fakeStore();
    const b = fakeStore();
    for (let i = 0; i < 30; i += 1) {
      runA.push(pickQuoteOnOpen(a, quotes, () => 424242).id);
      runB.push(pickQuoteOnOpen(b, quotes, () => 424242).id);
    }
    expect(runA).toEqual(runB);
  });

  it("persists seed/order/cursor and advances the cursor by exactly one per open", () => {
    const store = fakeStore();
    const quotes = corpus(10);
    pickQuoteOnOpen(store, quotes, () => 7);
    expect(store.map.get("ck.homeQuote.seed")).toBe("7");
    expect(store.map.get("ck.homeQuote.cursor")).toBe("1");
    pickQuoteOnOpen(store, quotes, () => 7);
    expect(store.map.get("ck.homeQuote.cursor")).toBe("2");
    // The persisted order is a genuine permutation of [0..10).
    const order = JSON.parse(store.map.get("ck.homeQuote.order")!) as number[];
    expect(new Set(order)).toEqual(new Set([...Array(10).keys()]));
  });

  it("rebuilds a valid rotation from a corrupt persisted order", () => {
    const store = fakeStore();
    store.setItem("ck.homeQuote.seed", "5");
    store.setItem("ck.homeQuote.order", "not json");
    store.setItem("ck.homeQuote.cursor", "3");
    const quotes = corpus(12);
    const q = pickQuoteOnOpen(store, quotes, () => 5);
    expect(quotes.map((x) => x.id)).toContain(q.id);
    const order = JSON.parse(store.map.get("ck.homeQuote.order")!) as number[];
    expect(new Set(order)).toEqual(new Set([...Array(12).keys()]));
  });

  it("rotates over the real shipped corpus without error", () => {
    const store = fakeStore();
    const q = pickQuoteOnOpen(store, QUOTES, () => 1);
    expect(QUOTES.map((x) => x.id)).toContain(q.id);
  });
});

describe("clampToWords", () => {
  it("returns short text untouched", () => {
    expect(clampToWords("Slow practice is fast learning.")).toBe(
      "Slow practice is fast learning.",
    );
  });

  it("never truncates mid-word and appends an ellipsis", () => {
    const long = "practice ".repeat(40).trim();
    const out = clampToWords(long, 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    // Every retained token is a whole word (no partial "practi").
    const body = out.slice(0, -1).trim();
    for (const word of body.split(" ")) expect(word).toBe("practice");
  });

  it("trims trailing punctuation before the ellipsis", () => {
    expect(clampToWords("alpha, beta gamma delta", 8)).toBe("alpha…");
  });
});
