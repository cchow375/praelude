import { QUOTES, type Quote } from "../../content/quotes";

/**
 * Home-quote selection (D1, ledger 27).
 *
 * The rotation is still a seeded permutation with a persisted cursor, so every
 * quote in the curated corpus is shown exactly once per lap and nothing starves.
 * On top of that sits a CONTEXT WINDOW: instead of always taking the head of the
 * remaining order, we look at the next `CONTEXT_WINDOW` entries and take the one
 * whose `themes` best answer what Christian is actually doing right now. The
 * chosen entry is swapped into the cursor slot, so the permutation — and the
 * once-per-lap guarantee — survives untouched.
 *
 * With no signals at all every candidate scores 0, the earliest window entry
 * wins, and the behaviour collapses exactly onto the old shuffle.
 *
 * Everything here is pure except for the small `QuoteStore` reads/writes;
 * gathering the signals lives in `quoteSignals.ts`.
 */

const SEED_KEY = "ck.homeQuote.seed";
const ORDER_KEY = "ck.homeQuote.order";
const CURSOR_KEY = "ck.homeQuote.cursor";
const CYCLE_KEY = "ck.homeQuote.cycle";
const PICK_KEY = "ck.homeQuote.pick";

/** How many upcoming rotation entries the context weighting may choose from. */
export const CONTEXT_WINDOW = 24;

/**
 * A pick is held for at least this long even if the context changes, so a run
 * of verdicts cannot make the strip flap line-by-line.
 */
export const MIN_DWELL_MS = 10 * 60_000;

/**
 * …and no longer than this, so leaving the app open all day still turns the
 * page eventually even when nothing about the context moved.
 */
export const MAX_DWELL_MS = 3 * 60 * 60_000;

/** Minimal storage surface — real localStorage or an injected fake (tests). */
export interface QuoteStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// ---------------------------------------------------------------------------
// Signals → cues (pure)
// ---------------------------------------------------------------------------

/** The verdict vocabulary of the rep engine. */
export type RepVerdict = "clean" | "flawed" | "failed";

/**
 * Everything the Today surface knows that may steer a quote. `null` means "not
 * known" and is deliberately distinct from `false`: an unread day sheet must
 * never be mistaken for a blank one.
 */
export interface QuoteSignals {
  /** Local calendar date, `YYYY-MM-DD`. Null only in a store-less environment. */
  readonly date: string | null;
  /** Local hour, 0–23. */
  readonly hour: number | null;
  /** Does today's day sheet have any content yet? */
  readonly daySheetWritten: boolean | null;
  /** Did yesterday's day sheet have any content? */
  readonly yesterdaySheetWritten: boolean | null;
  /** Is a practice set open right now? */
  readonly setOpen: boolean | null;
  /** Effective verdicts of the open set's attempts, newest first. */
  readonly recentVerdicts: readonly RepVerdict[];
}

/** No evidence at all — the graceful-degradation baseline. */
export const NO_SIGNALS: QuoteSignals = Object.freeze({
  date: null,
  hour: null,
  daySheetWritten: null,
  yesterdaySheetWritten: null,
  setOpen: null,
  recentVerdicts: Object.freeze([]) as readonly RepVerdict[],
});

export type QuoteCueId =
  | "rough-run"
  | "clean-run"
  | "set-open"
  | "blank-page"
  | "written-page"
  | "blank-yesterday"
  | "late-hour"
  | "early-hour";

/** One inferred reason to steer the pick, and the honest line that admits it. */
export interface QuoteCue {
  readonly id: QuoteCueId;
  /** Corpus `themes` tags this cue favours. */
  readonly themes: readonly string[];
  /** Relative pull. Higher wins the connector line when several cues match. */
  readonly weight: number;
  /** A quiet lower-case fragment stating why this quote is on screen. */
  readonly connector: string;
}

/** How many trailing attempts the run cues look at. */
const RUN_WINDOW = 3;

function numberWord(n: number): string {
  return n === 2 ? "two" : n === 3 ? "three" : String(n);
}

/**
 * Turn raw signals into the cues that apply right now, strongest first. An
 * empty result means "no honest reason to steer" — the caller then falls back
 * to the plain rotation and says nothing.
 */
export function deriveCues(signals: QuoteSignals): QuoteCue[] {
  const cues: QuoteCue[] = [];

  const recent = signals.recentVerdicts.slice(0, RUN_WINDOW);
  if (recent.length >= 2) {
    const rough = recent.filter((v) => v !== "clean").length;
    if (rough >= 2) {
      cues.push({
        id: "rough-run",
        themes: ["repetition-quality", "slow-work"],
        weight: 3,
        connector: `on your last ${numberWord(recent.length)} reps`,
      });
    } else if (rough === 0 && recent.length === RUN_WINDOW) {
      cues.push({
        id: "clean-run",
        themes: ["listening", "memory"],
        weight: 1.5,
        connector: `after ${numberWord(recent.length)} clean reps`,
      });
    }
  }

  if (signals.setOpen === true) {
    cues.push({
      id: "set-open",
      themes: ["focus", "repetition-quality"],
      weight: 2,
      connector: "while a set is open",
    });
  }

  if (signals.daySheetWritten === false) {
    // Deliberately just "planning": "practice-structure" is the corpus's
    // broadest tag and would let almost anything answer a blank page.
    cues.push({
      id: "blank-page",
      themes: ["planning"],
      weight: 2,
      connector: "before you write today's page",
    });
  } else if (signals.daySheetWritten === true) {
    // The plan exists, so the remaining variable is attention.
    cues.push({
      id: "written-page",
      themes: ["focus"],
      weight: 1,
      connector: "now that today's page is written",
    });
  }

  if (signals.yesterdaySheetWritten === false) {
    cues.push({
      id: "blank-yesterday",
      themes: ["consistency"],
      weight: 1.5,
      connector: "with yesterday's page blank",
    });
  }

  if (signals.hour != null && signals.hour >= 21) {
    cues.push({
      id: "late-hour",
      themes: ["discipline", "focus"],
      weight: 1,
      connector: "this late in the day",
    });
  } else if (signals.hour != null && signals.hour < 9) {
    cues.push({
      id: "early-hour",
      themes: ["planning", "slow-work"],
      weight: 1,
      connector: "first thing",
    });
  }

  return cues;
}

/**
 * A stable identity for "what the app currently knows". The pick is only
 * re-drawn when this changes (or a dwell bound expires), so the strip does not
 * churn while it is being read.
 */
export function contextKey(
  signals: QuoteSignals,
  cues: readonly QuoteCue[],
): string {
  return `${signals.date ?? "-"}|${cues.map((c) => c.id).join(",")}`;
}

// ---------------------------------------------------------------------------
// Scoring (pure)
// ---------------------------------------------------------------------------

export interface QuoteScore {
  /** Summed weight of every cue this quote answers. 0 = no connection. */
  readonly score: number;
  /** The heaviest cue it answered — the one worth naming. Null when none. */
  readonly cue: QuoteCue | null;
}

/** Extra pull per theme beyond the first a quote shares with one cue. */
const MULTI_THEME_BONUS = 0.25;

/** Score one quote against the active cues. Pure, total, order-independent. */
export function scoreQuote(
  quote: Quote,
  cues: readonly QuoteCue[],
): QuoteScore {
  let score = 0;
  let best: QuoteCue | null = null;
  for (const cue of cues) {
    const matched = cue.themes.filter((theme) =>
      quote.themes.includes(theme),
    ).length;
    if (matched === 0) continue;
    // A quote that answers a cue on two fronts (slow AND careful repetition,
    // say) is a better answer than one that only brushes it.
    score += cue.weight * (1 + MULTI_THEME_BONUS * (matched - 1));
    if (best == null || cue.weight > best.weight) best = cue;
  }
  return { score, cue: best };
}

/**
 * Choose within the next `window` entries of the remaining order and return the
 * winner's offset from the cursor. Ties keep the earlier entry, so a zero-cue
 * run reproduces the plain shuffle exactly. `lastId` is skipped so the same
 * quote never lands twice in a row across a lap boundary.
 */
export function chooseFromWindow(
  quotes: readonly Quote[],
  order: readonly number[],
  cursor: number,
  cues: readonly QuoteCue[],
  lastId: string | null,
  window = CONTEXT_WINDOW,
): { offset: number; cue: QuoteCue | null } {
  const end = Math.min(order.length, cursor + Math.max(1, window));
  let bestOffset = -1;
  let bestScore = -1;
  let bestCue: QuoteCue | null = null;
  for (let i = cursor; i < end; i += 1) {
    const candidate = quotes[order[i]];
    if (candidate == null || candidate.id === lastId) continue;
    const { score, cue } = scoreQuote(candidate, cues);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = i - cursor;
      bestCue = cue;
    }
  }
  // Only reachable when the window holds nothing but the just-shown quote.
  if (bestOffset < 0) return { offset: 0, cue: null };
  return { offset: bestOffset, cue: bestScore > 0 ? bestCue : null };
}

// ---------------------------------------------------------------------------
// Rotation state (the only impure part — a key/value store)
// ---------------------------------------------------------------------------

/** mulberry32 — a tiny, fast, fully deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle of [0..n) using a seeded PRNG. Returns index order. */
function shuffledOrder(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function readInt(store: QuoteStore, key: string): number | null {
  const raw = store.getItem(key);
  if (raw == null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

function readOrder(store: QuoteStore, expectedLength: number): number[] | null {
  const raw = store.getItem(ORDER_KEY);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === expectedLength &&
      parsed.every((v) => Number.isInteger(v)) &&
      new Set(parsed as number[]).size === expectedLength
    ) {
      return parsed as number[];
    }
  } catch {
    /* fall through — a corrupt order is rebuilt deterministically */
  }
  return null;
}

/**
 * The persisted lap state: a permutation of quote indices and how far into it
 * we are. Rebuilt (from a fresh, still-reproducible seed) on first run, on a
 * corpus-size change, and at the end of every lap.
 */
function loadRotation(
  store: QuoteStore,
  n: number,
  randomSeed: () => number,
): { order: number[]; cursor: number } {
  let seed = readInt(store, SEED_KEY);
  if (seed == null) {
    seed = randomSeed() >>> 0;
    store.setItem(SEED_KEY, String(seed));
  }

  let order = readOrder(store, n);
  let cursor = readInt(store, CURSOR_KEY) ?? 0;

  if (order == null || cursor < 0 || cursor >= n) {
    // A persisted monotonic cycle counter feeds the reshuffle seed so EVERY lap
    // gets a distinct order (cursor alone can't count laps — it resets to 0 each
    // cycle) while staying reproducible.
    const cyclesDone = order == null ? 0 : (readInt(store, CYCLE_KEY) ?? 0) + 1;
    store.setItem(CYCLE_KEY, String(cyclesDone));
    const cycleSeed = (seed + cyclesDone * 0x9e3779b1) >>> 0;
    order = shuffledOrder(n, cycleSeed);
    cursor = 0;
    store.setItem(ORDER_KEY, JSON.stringify(order));
  }

  return { order, cursor };
}

/** A quote plus the honest reason it surfaced (null when it was just the rotation). */
export interface QuotePick {
  readonly quote: Quote;
  readonly cue: QuoteCue | null;
}

/** What we persist about the current pick so a remount does not re-draw it. */
interface StoredPick {
  readonly id: string;
  readonly key: string;
  readonly at: number;
}

function readStoredPick(store: QuoteStore): StoredPick | null {
  const raw = store.getItem(PICK_KEY);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPick>;
    if (
      typeof parsed?.id === "string" &&
      typeof parsed.key === "string" &&
      typeof parsed.at === "number" &&
      Number.isFinite(parsed.at)
    ) {
      return { id: parsed.id, key: parsed.key, at: parsed.at };
    }
  } catch {
    /* fall through — a corrupt pick simply means "draw a new one" */
  }
  return null;
}

/**
 * Advance the rotation by one and return the context-weighted quote. Reads and
 * writes the persisted seed/order/cursor/pick. Given the same store state and
 * the same signals it always returns the same quote and leaves the store in the
 * same next state.
 *
 * `randomSeed` is only consulted the very first time (no stored seed yet).
 */
export function pickContextQuote(
  store: QuoteStore,
  signals: QuoteSignals = NO_SIGNALS,
  now = Date.now(),
  quotes: readonly Quote[] = QUOTES,
  randomSeed: () => number = () => Math.floor(Math.random() * 0xffffffff),
): QuotePick {
  const n = quotes.length;
  if (n === 0) throw new Error("No quotes to rotate.");

  const { order, cursor } = loadRotation(store, n, randomSeed);
  const cues = deriveCues(signals);
  const previous = readStoredPick(store);
  const { offset, cue } = chooseFromWindow(
    quotes,
    order,
    cursor,
    cues,
    previous?.id ?? null,
  );

  // Promote the winner into the cursor slot. Swapping (rather than splicing)
  // keeps `order` a permutation, which is what guarantees full coverage.
  const target = cursor + offset;
  if (target !== cursor) {
    [order[cursor], order[target]] = [order[target], order[cursor]];
    store.setItem(ORDER_KEY, JSON.stringify(order));
  }

  const quote = quotes[order[cursor]];
  store.setItem(CURSOR_KEY, String(cursor + 1));
  store.setItem(
    PICK_KEY,
    JSON.stringify({
      id: quote.id,
      key: contextKey(signals, cues),
      at: now,
    } satisfies StoredPick),
  );
  return { quote, cue };
}

/**
 * The Today surface's entry point. Reuses the stored pick while it is still
 * current — the menu unmounts and remounts on every navigation, and a quote
 * that changed each time you glanced at the menu would be pure noise. A new
 * quote is drawn when the context genuinely moved on (after a short dwell) or
 * when the old one has simply been up too long.
 */
export function resolveHomeQuote(
  store: QuoteStore,
  signals: QuoteSignals = NO_SIGNALS,
  now = Date.now(),
  quotes: readonly Quote[] = QUOTES,
  randomSeed?: () => number,
): QuotePick {
  const cues = deriveCues(signals);
  const previous = readStoredPick(store);
  if (previous != null) {
    const held = quotes.find((q) => q.id === previous.id);
    const age = now - previous.at;
    const sameContext = previous.key === contextKey(signals, cues);
    const fresh = age >= 0 && age < MAX_DWELL_MS;
    if (held != null && fresh && (sameContext || age < MIN_DWELL_MS)) {
      // Re-derive the connector from the CURRENT cues so the line can never
      // outlive the fact it describes.
      const { score, cue } = scoreQuote(held, cues);
      return { quote: held, cue: score > 0 ? cue : null };
    }
  }
  return pickContextQuote(store, signals, now, quotes, randomSeed);
}

/**
 * Advance the rotation with no context at all. Retained as the explicit
 * degraded path (and as the thing the context-aware selector must reduce to).
 */
export function pickQuoteOnOpen(
  store: QuoteStore,
  quotes: readonly Quote[] = QUOTES,
  randomSeed: () => number = () => Math.floor(Math.random() * 0xffffffff),
): Quote {
  return pickContextQuote(store, NO_SIGNALS, 0, quotes, randomSeed).quote;
}

/**
 * Clamp a quote to a character budget on a word boundary — never mid-word — and
 * append an ellipsis when trimmed. CSS `text-overflow: ellipsis` is the visual
 * safety net for the actual line width; this keeps the DOM text itself tidy and
 * word-whole for the (rare, long) quote and for the hover title. Quotes are ≤40
 * words, so the default budget shows almost all of them in full.
 */
export function clampToWords(text: string, maxChars = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const head = (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).replace(
    /[\s,;:.!?—-]+$/u,
    "",
  );
  return `${head}…`;
}
