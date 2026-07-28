import { QUOTES, type Quote } from "../../content/quotes";

/**
 * Deterministic home-quote rotation (D1, ledger 27). One quote per app open, no
 * repeats until all 182 have shown. A shuffled order + cursor persist in
 * localStorage; the shuffle is seeded once from a stored random seed so the
 * sequence is reproducible across restarts. When a full cycle is exhausted the
 * order reshuffles from a derived seed (a fresh permutation, still deterministic
 * given the stored seed) so cycle two is not a carbon copy of cycle one.
 */

const SEED_KEY = "ck.homeQuote.seed";
const ORDER_KEY = "ck.homeQuote.order";
const CURSOR_KEY = "ck.homeQuote.cursor";

/** Minimal storage surface — real localStorage or an injected fake (tests). */
export interface QuoteStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

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
 * Advance the rotation by one open and return the quote to show. Reads and
 * writes the persisted seed/order/cursor. Pure of surprises: given the same
 * store state it always returns the same quote and leaves the store in the same
 * next state.
 *
 * `randomSeed` is only consulted the very first time (no stored seed yet); it
 * defaults to a real random draw and is injectable for tests.
 */
export function pickQuoteOnOpen(
  store: QuoteStore,
  quotes: readonly Quote[] = QUOTES,
  randomSeed: () => number = () => Math.floor(Math.random() * 0xffffffff),
): Quote {
  const n = quotes.length;
  if (n === 0) throw new Error("No quotes to rotate.");

  let seed = readInt(store, SEED_KEY);
  if (seed == null) {
    seed = randomSeed() >>> 0;
    store.setItem(SEED_KEY, String(seed));
  }

  let order = readOrder(store, n);
  let cursor = readInt(store, CURSOR_KEY) ?? 0;

  if (order == null || cursor < 0 || cursor >= n) {
    // First run, a corpus-size change, or an exhausted cycle: (re)build a
    // permutation. Each exhausted cycle derives a fresh seed from the stored one
    // so the next lap differs while staying reproducible.
    const cyclesDone = order == null ? 0 : Math.floor(cursor / n) || 1;
    const cycleSeed = (seed + cyclesDone * 0x9e3779b1) >>> 0;
    order = shuffledOrder(n, cycleSeed);
    cursor = 0;
    store.setItem(ORDER_KEY, JSON.stringify(order));
  }

  const quote = quotes[order[cursor]];
  store.setItem(CURSOR_KEY, String(cursor + 1));
  return quote;
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
