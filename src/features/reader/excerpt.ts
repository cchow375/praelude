import { normalizeQuote } from "../../content/quoteMatch";

/**
 * The excerpt reader's pure text machinery (D2, ledger 28). Kept free of React
 * so paragraph splitting, quote location, windowing decisions, and minimal
 * inline-markdown tokenizing are all directly unit-testable.
 */

/** The `book_excerpt` response shape (mirrors src-tauri corpus `BookExcerpt`). */
export interface BookExcerpt {
  readonly source_id: string;
  readonly title: string;
  readonly author: string;
  /** "" when the source book has no markdown headings (whole-book body). */
  readonly heading: string;
  /** Raw markdown of the section (or the whole book when heading === ""). */
  readonly text: string;
}

/**
 * A book with no headings returns its WHOLE body (heading === ""), and any
 * single section can still be long. Past this many characters we window the
 * display around the quote rather than render everything. Below it, and with a
 * real heading, the section is short enough to show whole.
 */
export const WINDOW_CHAR_THRESHOLD = 3200;

/** Split section text into display paragraphs on blank lines; hard wraps join. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n+/)
    .map((block) => block.replace(/\s*\n\s*/g, " ").trim())
    .filter((block) => block.length > 0);
}

/**
 * Index of the paragraph containing the quote (whitespace-normalized, matching
 * the corpus reader). -1 when not found — the caller then shows the head of the
 * excerpt rather than nothing.
 */
export function findQuoteParagraphIndex(
  paragraphs: readonly string[],
  quoteText: string,
): number {
  const needle = normalizeQuote(quoteText);
  if (needle === "") return -1;
  return paragraphs.findIndex((p) => normalizeQuote(p).includes(needle));
}

/**
 * True when the excerpt should be windowed around the quote instead of shown
 * whole: a heading-less whole-book body, or any long section.
 */
export function shouldWindow(excerpt: {
  heading: string;
  text: string;
}): boolean {
  return (
    excerpt.heading.trim() === "" || excerpt.text.length > WINDOW_CHAR_THRESHOLD
  );
}

export type InlineToken =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "strong"; readonly value: string }
  | { readonly type: "em"; readonly value: string }
  | { readonly type: "code"; readonly value: string };

/**
 * Tokenize one paragraph's minimal inline markdown: `**strong**`, `*em*` /
 * `_em_`, and `` `code` ``. Everything else is literal text. Deliberately
 * small — no links, lists, or block constructs (the corpus prose does not need
 * them and no markdown library is a dependency).
 */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      tokens.push({ type: "text", value: text.slice(last, match.index) });
    }
    if (match[2] !== undefined)
      tokens.push({ type: "strong", value: match[2] });
    else if (match[3] !== undefined)
      tokens.push({ type: "em", value: match[3] });
    else if (match[4] !== undefined)
      tokens.push({ type: "em", value: match[4] });
    else if (match[5] !== undefined)
      tokens.push({ type: "code", value: match[5] });
    last = pattern.lastIndex;
  }
  if (last < text.length) {
    tokens.push({ type: "text", value: text.slice(last) });
  }
  return tokens.length > 0 ? tokens : [{ type: "text", value: text }];
}
