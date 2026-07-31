import { describe, expect, it } from "vitest";
import {
  chooseFromWindow,
  clampToWords,
  connectorFor,
  contextKey,
  CONTEXT_WINDOW,
  CUE_THEMES,
  deriveCues,
  MAX_DWELL_MS,
  MIN_DWELL_MS,
  NO_SIGNALS,
  pickContextQuote,
  pickQuoteOnOpen,
  resolveHomeQuote,
  scoreQuote,
  type QuoteCueId,
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
// D2: what the no-signal path actually is, measured against the real thing
//
// The claim used to be "degrades to exactly the old shuffle", and the test that
// backed it compared pickContextQuote(NO_SIGNALS) with pickQuoteOnOpen — which
// IS pickContextQuote(NO_SIGNALS). It could not have failed. Below is the
// pre-checkpoint algorithm copied verbatim from git (da366dc^:quoteRotation.ts)
// as a reference implementation, so the comparison is against something that
// can actually disagree — and, at the one input where the two must disagree,
// does.
// ---------------------------------------------------------------------------

/** mulberry32, verbatim from the pre-checkpoint file. */
function legacyMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, verbatim from the pre-checkpoint file. */
function legacyShuffledOrder(n: number, seed: number): number[] {
  const rng = legacyMulberry32(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** `pickQuoteOnOpen` exactly as it was before the context window existed. */
function legacyPickQuoteOnOpen(
  store: QuoteStore,
  quotes: readonly Quote[],
  randomSeed: () => number,
): Quote {
  const n = quotes.length;
  if (n === 0) throw new Error("No quotes to rotate.");
  let seed = (() => {
    const raw = store.getItem("ck.homeQuote.seed");
    const value = raw == null ? null : Number.parseInt(raw, 10);
    return value != null && Number.isFinite(value) ? value : null;
  })();
  if (seed == null) {
    seed = randomSeed() >>> 0;
    store.setItem("ck.homeQuote.seed", String(seed));
  }
  let order: number[] | null = (() => {
    const raw = store.getItem("ck.homeQuote.order");
    if (raw == null) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.length === n &&
        parsed.every((v) => Number.isInteger(v)) &&
        new Set(parsed as number[]).size === n
      ) {
        return parsed as number[];
      }
    } catch {
      /* fall through */
    }
    return null;
  })();
  const rawCursor = store.getItem("ck.homeQuote.cursor");
  let cursor =
    rawCursor == null ? 0 : (Number.parseInt(rawCursor, 10) ?? 0) || 0;
  if (order == null || cursor < 0 || cursor >= n) {
    const rawCycle = store.getItem("ck.homeQuote.cycle");
    const cyclesDone =
      order == null ? 0 : (rawCycle == null ? 0 : Number(rawCycle)) + 1;
    store.setItem("ck.homeQuote.cycle", String(cyclesDone));
    order = legacyShuffledOrder(n, (seed + cyclesDone * 0x9e3779b1) >>> 0);
    cursor = 0;
    store.setItem("ck.homeQuote.order", JSON.stringify(order));
  }
  const quote = quotes[order[cursor]];
  store.setItem("ck.homeQuote.cursor", String(cursor + 1));
  return quote;
}

describe("the no-signal fallback, against the real old algorithm", () => {
  it("reproduces the legacy sequence over four full laps of a 40-quote corpus", () => {
    // 40 quotes × 4 laps: three lap boundaries, the only place the two can
    // disagree at all, and with seed 1 the legacy run never repeats across one —
    // so the sequences must match pick for pick. (Seed 8080, which the old
    // self-comparing test used, DOES repeat at a boundary; the divergence test
    // below is what that seed was hiding.)
    const quotes = corpus(40);
    const mine = fakeStore();
    const legacyStore = fakeStore();
    const mineIds: string[] = [];
    const legacyIds: string[] = [];
    for (let i = 0; i < 160; i += 1) {
      mineIds.push(pickQuoteOnOpen(mine, quotes, () => 1).id);
      legacyIds.push(legacyPickQuoteOnOpen(legacyStore, quotes, () => 1).id);
    }
    expect(legacyIds).toHaveLength(160);
    // The reference run is a real, independent sequence, not a constant.
    expect(new Set(legacyIds).size).toBe(40);
    expect(legacyIds.every((id, i) => i === 0 || id !== legacyIds[i - 1])).toBe(
      true,
    );
    // The reference implementation really is a different code path: it never
    // writes the pick key that the new one persists for the dwell logic.
    expect(legacyStore.map.has("ck.homeQuote.pick")).toBe(false);
    expect(mine.map.has("ck.homeQuote.pick")).toBe(true);
    expect(mineIds).toEqual(legacyIds);
    // …and the rotation bookkeeping lands in the same place.
    for (const key of [
      "ck.homeQuote.seed",
      "ck.homeQuote.cursor",
      "ck.homeQuote.cycle",
    ]) {
      expect(mine.map.get(key)).toBe(legacyStore.map.get(key));
    }
  });

  it("diverges from the legacy sequence in exactly one way: no back-to-back repeat", () => {
    // n=12, seed=2 is an input where the legacy lap boundary lands the SAME
    // quote twice in a row. Everything before the boundary agrees; at it, the
    // new path steps past the repeat.
    const quotes = corpus(12);
    const mine = fakeStore();
    const legacyStore = fakeStore();
    const mineIds: string[] = [];
    const legacyIds: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      mineIds.push(pickQuoteOnOpen(mine, quotes, () => 2).id);
      legacyIds.push(legacyPickQuoteOnOpen(legacyStore, quotes, () => 2).id);
    }
    // The legacy run really does repeat at the boundary (pick 12 == pick 11).
    expect(legacyIds[12]).toBe(legacyIds[11]);
    // Every pick up to the boundary is identical…
    expect(mineIds.slice(0, 12)).toEqual(legacyIds.slice(0, 12));
    // …and the divergence is a transposition, not a drop: the repeat is
    // deferred by one slot, so the new lap still shows every quote.
    expect(mineIds[12]).not.toBe(mineIds[11]);
    expect(mineIds[12]).toBe(legacyIds[13]);
    expect(mineIds[13]).toBe(legacyIds[12]);
  });

  it("never shows the same quote twice in a row, over ten laps and many seeds", () => {
    const quotes = corpus(12);
    for (const seed of [1, 2, 3, 7, 42, 4242]) {
      const store = fakeStore();
      let previous: string | null = null;
      for (let i = 0; i < 120; i += 1) {
        const id = pickQuoteOnOpen(store, quotes, () => seed).id;
        expect(id).not.toBe(previous);
        previous = id;
      }
    }
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
  });

  it("says nothing at all about a page that IS written", () => {
    // The old "now that today's page is written" named a fact but justified no
    // quote: a written page is not a reason to read anything in particular.
    expect(
      deriveCues(signals({ daySheetWritten: true })).map((c) => c.id),
    ).toEqual([]);
  });

  it("fires the lesson-prep, blank-yesterday, and hour cues", () => {
    expect(deriveCues(signals({ lessonPrep: true }))[0]).toEqual(
      expect.objectContaining({
        id: "lesson-prep",
        connector: "with lesson prep on today's page",
      }),
    );
    expect(deriveCues(signals({ lessonPrep: false }))).toEqual([]);
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
        lessonPrep: true,
        daySheetWritten: false,
        yesterdaySheetWritten: false,
        hour: 22,
      }),
    );
    expect(cues.map((c) => c.id)).toEqual([
      "rough-run",
      "lesson-prep",
      "blank-yesterday",
      "blank-page",
      "late-hour",
    ]);
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i - 1].weight).toBeGreaterThan(cues[i].weight);
    }
  });

  it("sorts by weight even when the heaviest cue is derived last", () => {
    // A clean run (1.5) is derived first but must not outrank lesson prep (2.5).
    const cues = deriveCues(
      signals({
        recentVerdicts: ["clean", "clean", "clean"],
        lessonPrep: true,
      }),
    );
    expect(cues.map((c) => c.id)).toEqual(["lesson-prep", "clean-run"]);
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
      signals({ recentVerdicts: ["flawed", "flawed"], hour: 22 }),
    );
    // Nothing answers both a rough run (3) and the late hour (1.25)…
    const rough = scoreQuote(corpus(1, ["slow-work"])[0], cues);
    expect(rough.score).toBe(3);
    expect(rough.cue?.id).toBe("rough-run");
    // …so a quote tagged both is scored for both and named for the heavier.
    const both = scoreQuote(corpus(1, ["slow-work", "rest"])[0], cues);
    expect(both.score).toBe(4.25);
    expect(both.cue?.id).toBe("rough-run");
    // "rest" alone only answers the lighter cue.
    const one = scoreQuote(corpus(1, ["rest"])[0], cues);
    expect(one.score).toBe(1.25);
    expect(one.cue?.id).toBe("late-hour");
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

describe("connectorFor", () => {
  it("names the heaviest cue the quote actually answers", () => {
    const quote = corpus(1, ["session-plan"])[0];
    expect(connectorFor(quote, signals({ daySheetWritten: false }))?.id).toBe(
      "blank-page",
    );
  });

  it("says nothing when the quote answers none of the current cues", () => {
    const quote = corpus(1, ["memory"])[0];
    expect(connectorFor(quote, signals({ daySheetWritten: false }))).toBeNull();
  });

  it("says nothing when there is no quote and nothing when there are no cues", () => {
    expect(connectorFor(null, signals({ daySheetWritten: false }))).toBeNull();
    expect(connectorFor(corpus(1, ["session-plan"])[0], NO_SIGNALS)).toBeNull();
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
    const quotes = corpusWithOneTagged(40, 11, ["session-plan"]);
    const blank = signals({ date: "2026-07-30", daySheetWritten: false });

    const plain = pickContextQuote(fakeStore(), NO_SIGNALS, 0, quotes, () => 3);
    const steered = pickContextQuote(fakeStore(), blank, 0, quotes, () => 3);

    expect(steered.quote.id).toBe("q11");
    expect(steered.cue?.id).toBe("blank-page");
    expect(plain.quote.id).not.toBe("q11");
    expect(plain.cue).toBeNull();
  });

  it("never repeats the same quote on two consecutive picks", () => {
    // A corpus where every entry answers the cue, so scoring alone would happily
    // return the same winner forever; only the cursor + last-id guard prevent it.
    const quotes = corpus(12, ["session-plan", "consistency"]);
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
    const quotes = corpusWithOneTagged(30, 9, ["session-plan"]);
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
  const quotes = corpus(40, ["session-plan"]);
  const blank = signals({ date: "2026-07-30", daySheetWritten: false });

  it("holds the same quote across a remount instead of burning a new one", () => {
    const store = fakeStore();
    const first = resolveHomeQuote(store, blank, 1_000, quotes, () => 11);
    const again = resolveHomeQuote(store, blank, 61_000, quotes, () => 11);
    expect(again.quote.id).toBe(first.quote.id);
    expect(store.map.get("ck.homeQuote.cursor")).toBe("1");
  });

  it("draws a new quote once the context has genuinely moved on", () => {
    // Answers both the blank-page and the late-hour cue, so the second pick can
    // prove it re-steered rather than merely re-drawn.
    const versatile = corpus(40, ["session-plan", "rest"]);
    const store = fakeStore();
    const first = resolveHomeQuote(store, blank, 0, versatile, () => 11);
    expect(first.cue?.id).toBe("blank-page");
    const late = signals({ date: "2026-07-30", hour: 23 });
    const next = resolveHomeQuote(
      store,
      late,
      MIN_DWELL_MS + 1,
      versatile,
      () => 11,
    );
    expect(next.quote.id).not.toBe(first.quote.id);
    expect(next.cue?.id).toBe("late-hour");
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
    // reason is no longer true, and "session-plan" answers nothing else.
    const held = resolveHomeQuote(
      store,
      signals({ date: "2026-07-30", daySheetWritten: true }),
      60_000,
      quotes,
      () => 11,
    );
    expect(held.quote.id).toBe(first.quote.id);
    expect(held.cue).toBeNull();
    // And the returned cue tracks the CURRENT facts rather than the pick's:
    // switch the reason and the same held quote is explained the new way.
    const versatile = corpus(40, ["session-plan", "rest"]);
    const store2 = fakeStore();
    const drawn = resolveHomeQuote(store2, blank, 0, versatile, () => 11);
    expect(drawn.cue?.id).toBe("blank-page");
    const relabelled = resolveHomeQuote(
      store2,
      signals({ date: "2026-07-30", hour: 23 }),
      60_000,
      versatile,
      () => 11,
    );
    expect(relabelled.quote.id).toBe(drawn.quote.id);
    expect(relabelled.cue?.id).toBe("late-hour");
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

// ---------------------------------------------------------------------------
// Does a quote actually land a point? The cue tags have to carry the claim.
// ---------------------------------------------------------------------------

describe("the cue vocabulary against the shipped corpus", () => {
  const cueIds = Object.keys(CUE_THEMES) as QuoteCueId[];
  const tagged = (theme: string) =>
    QUOTES.filter((q) => q.themes.includes(theme));

  it("points every cue at tags the corpus actually carries", () => {
    for (const id of cueIds) {
      for (const theme of CUE_THEMES[id]) {
        // A typo'd tag would silently disable a cue forever.
        expect(tagged(theme).length, `${id} → ${theme}`).toBeGreaterThan(6);
      }
    }
  });

  it("keeps every cue narrow enough for its connector to mean something", () => {
    // The pre-fix "this late in the day" reached `discipline` + `focus` = 57% of
    // the corpus. A line that can be said over half the corpus is not a reason.
    for (const id of cueIds) {
      const reach = QUOTES.filter((q) =>
        CUE_THEMES[id].some((theme) => q.themes.includes(theme)),
      ).length;
      expect(reach / QUOTES.length, `${id} reaches ${reach}/134`).toBeLessThan(
        0.25,
      );
    }
  });

  it("keeps a reason available on a blank page, which is where the app opens", () => {
    // The strip must not go silent on the most common first screen of the day.
    // 24 of 134 are in reach of any one pick, so the two cues that fire on a
    // fresh blank page need enough answers between them for that to be a
    // near-certainty rather than a coin flip.
    const answers = QUOTES.filter(
      (q) =>
        q.themes.includes("session-plan") || q.themes.includes("consistency"),
    ).length;
    expect(answers).toBeGreaterThanOrEqual(35);
  });

  it("never prints a connector the chosen quote does not answer", () => {
    // Across every state the app can be in and 200 different rotation seeds:
    // if a reason is shown, the quote carries one of that cue's tags.
    const states: QuoteSignals[] = [
      signals({ date: "2026-08-03", hour: 8, daySheetWritten: false }),
      signals({
        date: "2026-08-03",
        hour: 15,
        daySheetWritten: true,
        recentVerdicts: ["flawed", "failed", "flawed"],
      }),
      signals({
        date: "2026-08-03",
        hour: 11,
        daySheetWritten: false,
        yesterdaySheetWritten: false,
      }),
      signals({ date: "2026-08-03", hour: 22, lessonPrep: true }),
      signals({
        date: "2026-08-03",
        hour: 16,
        recentVerdicts: ["clean", "clean", "clean"],
      }),
      signals({ date: "2026-08-03", hour: 23, daySheetWritten: true }),
    ];
    for (const state of states) {
      for (let seed = 0; seed < 200; seed += 1) {
        const { quote, cue } = pickContextQuote(
          fakeStore(),
          state,
          0,
          QUOTES,
          () => seed * 2654435761,
        );
        if (cue == null) continue;
        expect(
          CUE_THEMES[cue.id].some((theme) => quote.themes.includes(theme)),
          `${cue.id} claimed over ${quote.id} [${quote.themes.join(",")}]`,
        ).toBe(true);
      }
    }
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
