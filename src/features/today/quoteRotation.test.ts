import { describe, expect, it } from "vitest";
import {
  chooseFromWindow,
  clampToWords,
  contextKey,
  CONTEXT_WINDOW,
  deriveCues,
  MAX_DWELL_MS,
  MIN_DWELL_MS,
  NO_SIGNALS,
  pickContextQuote,
  pickQuoteOnOpen,
  resolveHomeQuote,
  scoreQuote,
  type QuoteSignals,
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
function corpus(n: number, themes: readonly string[] = []): Quote[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    text: `text ${i}`,
    source_id: "roskell-complete-pianist",
    author: `Author ${i}`,
    book: "Book",
    heading: "",
    themes,
  }));
}

/** A corpus where exactly one entry, far down the window, carries `themes`. */
function corpusWithOneTagged(
  n: number,
  taggedIndex: number,
  themes: readonly string[],
): Quote[] {
  return corpus(n).map((q, i) => (i === taggedIndex ? { ...q, themes } : q));
}

function signals(overrides: Partial<QuoteSignals> = {}): QuoteSignals {
  return { ...NO_SIGNALS, ...overrides };
}

describe("home quote rotation", () => {
  it("shows every quote once before any repeat (no-repeat until exhausted)", () => {
    const store = fakeStore();
    const quotes = corpus(134);
    const seen: string[] = [];
    for (let i = 0; i < quotes.length; i += 1) {
      seen.push(pickQuoteOnOpen(store, quotes, () => 12345).id);
    }
    expect(new Set(seen).size).toBe(134); // all unique
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

  it("gives every cycle a fresh permutation, not just the second (2v3, 3v4)", () => {
    const store = fakeStore();
    const quotes = corpus(50);
    const cycle = (): string[] => {
      const ids: string[] = [];
      for (let i = 0; i < 50; i += 1)
        ids.push(pickQuoteOnOpen(store, quotes, () => 424242).id);
      return ids;
    };
    const c1 = cycle();
    const c2 = cycle();
    const c3 = cycle();
    const c4 = cycle();
    // Each lap is a full permutation…
    for (const c of [c2, c3, c4]) expect(new Set(c).size).toBe(50);
    // …and consecutive laps differ (the pre-fix bug froze the order from lap 2 on).
    expect(c2).not.toEqual(c1);
    expect(c3).not.toEqual(c2);
    expect(c4).not.toEqual(c3);
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

// ---------------------------------------------------------------------------
// Signals → cues
// ---------------------------------------------------------------------------

describe("deriveCues", () => {
  it("yields nothing at all when nothing is known", () => {
    expect(deriveCues(NO_SIGNALS)).toEqual([]);
  });

  it("reads a rough run off the last three verdicts and names it honestly", () => {
    const cues = deriveCues(
      signals({ recentVerdicts: ["flawed", "clean", "failed"] }),
    );
    const rough = cues.find((c) => c.id === "rough-run");
    expect(rough).toBeTruthy();
    expect(rough!.themes).toEqual(["repetition-quality", "slow-work"]);
    expect(rough!.connector).toBe("on your last three reps");
  });

  it("says 'two' when only two attempts exist — never claims a third", () => {
    const cues = deriveCues(signals({ recentVerdicts: ["failed", "flawed"] }));
    expect(cues.find((c) => c.id === "rough-run")?.connector).toBe(
      "on your last two reps",
    );
  });

  it("does not call one bad rep in three a rough run", () => {
    const cues = deriveCues(
      signals({ recentVerdicts: ["flawed", "clean", "clean"] }),
    );
    expect(cues.map((c) => c.id)).not.toContain("rough-run");
    expect(cues.map((c) => c.id)).not.toContain("clean-run");
  });

  it("needs a full three clean attempts before claiming a clean run", () => {
    expect(
      deriveCues(signals({ recentVerdicts: ["clean", "clean"] })).map(
        (c) => c.id,
      ),
    ).not.toContain("clean-run");
    const cues = deriveCues(
      signals({ recentVerdicts: ["clean", "clean", "clean"] }),
    );
    expect(cues.find((c) => c.id === "clean-run")?.connector).toBe(
      "after three clean reps",
    );
  });

  it("distinguishes an unread day sheet from a blank one", () => {
    expect(
      deriveCues(signals({ daySheetWritten: null })).map((c) => c.id),
    ).toEqual([]);
    expect(
      deriveCues(signals({ daySheetWritten: false })).map((c) => c.id),
    ).toEqual(["blank-page"]);
    expect(
      deriveCues(signals({ daySheetWritten: true })).map((c) => c.id),
    ).toEqual(["written-page"]);
  });

  it("fires the open-set, blank-yesterday, and hour cues", () => {
    expect(deriveCues(signals({ setOpen: true }))[0].id).toBe("set-open");
    expect(deriveCues(signals({ setOpen: false }))).toEqual([]);
    expect(deriveCues(signals({ yesterdaySheetWritten: false }))[0]).toEqual(
      expect.objectContaining({
        id: "blank-yesterday",
        connector: "with yesterday's page blank",
      }),
    );
    expect(deriveCues(signals({ yesterdaySheetWritten: true }))).toEqual([]);
    expect(deriveCues(signals({ hour: 22 }))[0].id).toBe("late-hour");
    expect(deriveCues(signals({ hour: 7 }))[0].id).toBe("early-hour");
    expect(deriveCues(signals({ hour: 14 }))).toEqual([]);
  });

  it("orders cues strongest-first so the connector names the real driver", () => {
    const cues = deriveCues(
      signals({
        recentVerdicts: ["flawed", "failed", "flawed"],
        setOpen: true,
        daySheetWritten: true,
        hour: 22,
      }),
    );
    expect(cues.map((c) => c.id)).toEqual([
      "rough-run",
      "set-open",
      "written-page",
      "late-hour",
    ]);
    expect(cues[0].weight).toBeGreaterThan(cues[1].weight);
  });
});

describe("contextKey", () => {
  it("changes only when the date or the set of active cues changes", () => {
    const base = signals({ date: "2026-07-30", daySheetWritten: false });
    const key = (s: QuoteSignals) => contextKey(s, deriveCues(s));
    // Same cues, different underlying detail → same key (no churn).
    expect(key(base)).toBe(key({ ...base, recentVerdicts: [] }));
    // A genuinely new fact → new key.
    expect(key(base)).not.toBe(key({ ...base, daySheetWritten: true }));
    expect(key(base)).not.toBe(key({ ...base, date: "2026-07-31" }));
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe("scoreQuote", () => {
  it("scores zero and names no reason when nothing matches", () => {
    const cues = deriveCues(signals({ daySheetWritten: false }));
    expect(scoreQuote(corpus(1, ["memory"])[0], cues)).toEqual({
      score: 0,
      cue: null,
    });
  });

  it("sums every matching cue and names the heaviest one", () => {
    const cues = deriveCues(
      signals({ recentVerdicts: ["flawed", "flawed"], setOpen: true }),
    );
    // "repetition-quality" is in both the rough-run (3) and set-open (2) cues.
    const both = scoreQuote(corpus(1, ["repetition-quality"])[0], cues);
    expect(both.score).toBe(5);
    expect(both.cue?.id).toBe("rough-run");
    // "focus" only answers the lighter cue.
    const one = scoreQuote(corpus(1, ["focus"])[0], cues);
    expect(one.score).toBe(2);
    expect(one.cue?.id).toBe("set-open");
  });

  it("prefers a quote that answers one cue on both of its themes", () => {
    const cues = deriveCues(signals({ recentVerdicts: ["flawed", "flawed"] }));
    const half = scoreQuote(corpus(1, ["slow-work"])[0], cues);
    const whole = scoreQuote(
      corpus(1, ["slow-work", "repetition-quality"])[0],
      cues,
    );
    expect(half.score).toBe(3);
    expect(whole.score).toBeGreaterThan(half.score);
    expect(whole.cue?.id).toBe("rough-run");
  });
});

describe("chooseFromWindow", () => {
  it("takes the head of the order when there is nothing to go on", () => {
    const quotes = corpus(30);
    const order = [...Array(30).keys()].reverse();
    expect(chooseFromWindow(quotes, order, 0, [], null)).toEqual({
      offset: 0,
      cue: null,
    });
  });

  it("reaches into the window for a themed match, and reports why", () => {
    const quotes = corpusWithOneTagged(30, 7, ["slow-work"]);
    const order = [...Array(30).keys()];
    const cues = deriveCues(signals({ recentVerdicts: ["flawed", "failed"] }));
    const chosen = chooseFromWindow(quotes, order, 0, cues, null);
    expect(chosen.offset).toBe(7);
    expect(chosen.cue?.id).toBe("rough-run");
  });

  it("never reaches past the window, so the rotation still paces the corpus", () => {
    const beyond = CONTEXT_WINDOW + 5;
    const quotes = corpusWithOneTagged(beyond + 1, beyond, ["slow-work"]);
    const order = [...Array(beyond + 1).keys()];
    const cues = deriveCues(signals({ recentVerdicts: ["flawed", "failed"] }));
    expect(chooseFromWindow(quotes, order, 0, cues, null).offset).toBe(0);
  });

  it("skips the previously shown quote", () => {
    const quotes = corpus(5);
    const order = [...Array(5).keys()];
    expect(chooseFromWindow(quotes, order, 0, [], "q0").offset).toBe(1);
  });

  it("reports no reason when the winner only won on position", () => {
    const quotes = corpus(5, ["memory"]);
    const order = [...Array(5).keys()];
    const cues = deriveCues(signals({ daySheetWritten: false }));
    expect(chooseFromWindow(quotes, order, 0, cues, null).cue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Context-aware picking end to end
// ---------------------------------------------------------------------------

describe("pickContextQuote", () => {
  it("a theme match beats the plain rotation order", () => {
    const quotes = corpusWithOneTagged(40, 11, ["planning"]);
    const blank = signals({ date: "2026-07-30", daySheetWritten: false });

    const plain = pickContextQuote(fakeStore(), NO_SIGNALS, 0, quotes, () => 3);
    const steered = pickContextQuote(fakeStore(), blank, 0, quotes, () => 3);

    expect(steered.quote.id).toBe("q11");
    expect(steered.cue?.id).toBe("blank-page");
    expect(plain.quote.id).not.toBe("q11");
    expect(plain.cue).toBeNull();
  });

  it("degrades to exactly the old shuffle when no signal exists", () => {
    const quotes = corpus(40);
    const a = fakeStore();
    const b = fakeStore();
    const withNoSignals: string[] = [];
    const legacy: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      withNoSignals.push(
        pickContextQuote(a, NO_SIGNALS, 0, quotes, () => 8080).quote.id,
      );
      legacy.push(pickQuoteOnOpen(b, quotes, () => 8080).id);
    }
    expect(withNoSignals).toEqual(legacy);
  });

  it("never repeats the same quote on two consecutive picks", () => {
    // A corpus where every entry answers the cue, so scoring alone would happily
    // return the same winner forever; only the cursor + last-id guard prevent it.
    const quotes = corpus(12, ["planning", "practice-structure"]);
    const store = fakeStore();
    const blank = signals({ date: "2026-07-30", daySheetWritten: false });
    let previous: string | null = null;
    for (let i = 0; i < 60; i += 1) {
      const { quote } = pickContextQuote(store, blank, i, quotes, () => 4242);
      expect(quote.id).not.toBe(previous);
      previous = quote.id;
    }
  });

  it("still covers the whole corpus under a permanently biased context", () => {
    // Only 3 of 40 answer the cue. Untagged entries must not starve.
    const quotes = corpus(40).map((q, i) =>
      i % 13 === 0 ? { ...q, themes: ["slow-work"] } : q,
    );
    const store = fakeStore();
    const rough = signals({
      date: "2026-07-30",
      recentVerdicts: ["flawed", "failed", "flawed"],
    });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      seen.add(pickContextQuote(store, rough, i, quotes, () => 77).quote.id);
    }
    expect(seen.size).toBe(40);
  });

  it("keeps the persisted order a permutation after steering", () => {
    const quotes = corpusWithOneTagged(30, 9, ["planning"]);
    const store = fakeStore();
    pickContextQuote(
      store,
      signals({ daySheetWritten: false }),
      0,
      quotes,
      () => 5,
    );
    const order = JSON.parse(store.map.get("ck.homeQuote.order")!) as number[];
    expect(new Set(order)).toEqual(new Set([...Array(30).keys()]));
    expect(store.map.get("ck.homeQuote.cursor")).toBe("1");
  });

  it("steers the real shipped corpus toward slow, careful work after a rough run", () => {
    const store = fakeStore();
    const { quote, cue } = pickContextQuote(
      store,
      signals({
        date: "2026-07-30",
        recentVerdicts: ["flawed", "failed", "flawed"],
      }),
      0,
      QUOTES,
      () => 20260730,
    );
    expect(cue?.id).toBe("rough-run");
    expect(quote.themes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^(repetition-quality|slow-work)$/),
      ]),
    );
  });
});

describe("resolveHomeQuote", () => {
  const quotes = corpus(40, ["planning"]);
  const blank = signals({ date: "2026-07-30", daySheetWritten: false });

  it("holds the same quote across a remount instead of burning a new one", () => {
    const store = fakeStore();
    const first = resolveHomeQuote(store, blank, 1_000, quotes, () => 11);
    const again = resolveHomeQuote(store, blank, 61_000, quotes, () => 11);
    expect(again.quote.id).toBe(first.quote.id);
    expect(store.map.get("ck.homeQuote.cursor")).toBe("1");
  });

  it("draws a new quote once the context has genuinely moved on", () => {
    // Answers both the blank-page and the written-page cue, so the second pick
    // can prove it re-steered rather than merely re-drawn.
    const versatile = corpus(40, ["planning", "focus"]);
    const store = fakeStore();
    const first = resolveHomeQuote(store, blank, 0, versatile, () => 11);
    expect(first.cue?.id).toBe("blank-page");
    const written = signals({ date: "2026-07-30", daySheetWritten: true });
    const next = resolveHomeQuote(
      store,
      written,
      MIN_DWELL_MS + 1,
      versatile,
      () => 11,
    );
    expect(next.quote.id).not.toBe(first.quote.id);
    expect(next.cue?.id).toBe("written-page");
  });

  it("damps churn: a context flip inside the dwell window holds the quote", () => {
    const store = fakeStore();
    const first = resolveHomeQuote(store, blank, 0, quotes, () => 11);
    const written = signals({ date: "2026-07-30", daySheetWritten: true });
    const held = resolveHomeQuote(store, written, 60_000, quotes, () => 11);
    expect(held.quote.id).toBe(first.quote.id);
  });

  it("re-derives the connector from current facts, never a stale one", () => {
    const store = fakeStore();
    const first = resolveHomeQuote(store, blank, 0, quotes, () => 11);
    expect(first.cue?.id).toBe("blank-page");
    // Same held quote a minute later, but the page is written now: the old
    // reason is no longer true, and "planning" answers nothing else.
    const held = resolveHomeQuote(
      store,
      signals({ date: "2026-07-30", daySheetWritten: true }),
      60_000,
      quotes,
      () => 11,
    );
    expect(held.quote.id).toBe(first.quote.id);
    expect(held.cue).toBeNull();
  });

  it("turns the page after the maximum dwell even with a frozen context", () => {
    const store = fakeStore();
    const first = resolveHomeQuote(store, blank, 0, quotes, () => 11);
    const later = resolveHomeQuote(
      store,
      blank,
      MAX_DWELL_MS + 1,
      quotes,
      () => 11,
    );
    expect(later.quote.id).not.toBe(first.quote.id);
  });

  it("draws fresh when the stored pick is corrupt or names an unknown quote", () => {
    const store = fakeStore();
    store.setItem("ck.homeQuote.pick", "{{{");
    expect(
      resolveHomeQuote(store, blank, 0, quotes, () => 11).quote,
    ).toBeTruthy();
    store.setItem(
      "ck.homeQuote.pick",
      JSON.stringify({ id: "gone", key: "x", at: 0 }),
    );
    expect(
      resolveHomeQuote(store, blank, 10, quotes, () => 11).quote.id,
    ).not.toBe("gone");
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
