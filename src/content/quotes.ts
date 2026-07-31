import quotesData from "./quotes.json";

/**
 * One curated, verbatim quote from the four-book practice corpus (D1, ledger
 * 27). `text` is checked at test time to appear verbatim (whitespace-normalized)
 * inside its source markdown — see quotes.honesty.test.ts. `source_id` matches a
 * built-in book id in src-tauri/src/brain/corpus.rs; `heading` is a human
 * locator (breadcrumb) for the reader's attribution, not a machine key.
 */
export interface Quote {
  readonly id: string;
  readonly text: string;
  readonly source_id: string;
  readonly author: string;
  readonly book: string;
  readonly heading: string;
  readonly themes: readonly string[];
}

/**
 * The shipped corpus. Frozen so a stray mutation can never disturb rotation.
 *
 * CURATED, not harvested: an entry earns its place only if it states a
 * principle a serious pianist can act on or argue with when it is read ALONE on
 * the menu. Bland connective tissue, anecdote, definitions, and fragments whose
 * antecedent is off-page were dropped. Some entries were shortened — always to
 * a contiguous substring of their own text, never reworded — so the verbatim
 * gate in quotes.honesty.test.ts still holds. Adding an invented quote, or
 * loosening that gate, breaks the whole point of this file.
 */
export const QUOTES: readonly Quote[] = Object.freeze(quotesData as Quote[]);

/**
 * `themes` carries two kinds of tag and it is worth knowing which is which.
 *
 * TOPICAL tags (`discipline`, `practice-structure`, `focus`, `planning`,
 * `memory`, `listening`) describe what a quote is about. They are broad —
 * `discipline` sits on 51 of 134 entries — and nothing selects on them.
 *
 * CUE tags are the ones home-quote selection reads (`CUE_THEMES` in
 * features/today/quoteRotation.ts), and they are narrow ON PURPOSE, because
 * each one has to justify a line of text asserting to Christian that this quote
 * answers what he is doing right now:
 *   session-plan  — deciding what a session is for, before it starts
 *   consistency   — showing up day after day (not "sticking to a fingering")
 *   repetition-quality / slow-work — what repetition does to you; slowing down
 *   next-step     — what to do once a passage is going right
 *   rest          — fatigue, breaks, sleep, how long attention lasts
 *   performance   — playing it for someone else
 * Widening a cue tag to catch more quotes silently widens what the app is
 * willing to claim. Add a quote to one only if it would still read as an answer
 * when that connector sits directly above it.
 */

/**
 * source_id → source markdown file name, mirroring the four built-in books in
 * `src-tauri/src/brain/corpus.rs` (`builtin_books`). The honesty gate reads each
 * quote's source file from the knowledge dir by this map; the native
 * `book_excerpt` command resolves the same mapping through the books manifest.
 */
export const SOURCE_FILE_BY_ID: Readonly<Record<string, string>> =
  Object.freeze({
    "roskell-complete-pianist": "the-complete-pianist.md",
    "gebrian-learn-faster": "learn-faster-perform-better.md",
    "breth-effective-practicing":
      "the-piano-students-guide-to-effective-practicing.md",
    "gieseking-leimer-technique": "gieseking-leimer-piano-technique.md",
  });
