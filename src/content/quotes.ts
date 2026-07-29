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

/** The shipped corpus. Frozen so a stray mutation can never disturb rotation. */
export const QUOTES: readonly Quote[] = Object.freeze(quotesData as Quote[]);

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
