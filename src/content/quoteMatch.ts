/**
 * Whitespace-normalized quote matching, faithful to the Rust corpus reader
 * (`src-tauri/src/brain/corpus.rs` — `normalize_whitespace` /
 * `normalize_with_map`). A quote is a single paragraph, so any run of
 * intra-paragraph whitespace (spaces, tabs, a single hard-wrap newline)
 * collapses to one space, while a paragraph break (a blank line — two or more
 * newlines) becomes a `\n` sentinel that a needle can never cross. This is the
 * exact rule quotes.json was verbatim-verified against: a quote that straddled a
 * paragraph boundary is correctly rejected rather than stitched together.
 */

/** Collapse a single-paragraph needle: every whitespace run → one space, trimmed. */
export function normalizeQuote(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

/**
 * Collapse a source haystack: intra-paragraph whitespace → one space, a blank
 * line (2+ newlines) → a single `\n` sentinel. Leading whitespace is dropped.
 */
function isWs(code: number): boolean {
  // space, tab, LF, CR, vertical tab, form feed, and NBSP — the whitespace the
  // Rust reader's char::is_whitespace collapses. Good enough for corpus prose.
  return (
    code === 32 ||
    code === 9 ||
    code === 10 ||
    code === 13 ||
    code === 11 ||
    code === 12 ||
    code === 160
  );
}

export function normalizeSource(raw: string): string {
  const out: string[] = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    if (isWs(raw.charCodeAt(i))) {
      let newlines = 0;
      while (i < n && isWs(raw.charCodeAt(i))) {
        if (raw.charCodeAt(i) === 10) newlines += 1;
        i += 1;
      }
      if (out.length === 0) continue; // drop leading whitespace
      out.push(newlines >= 2 ? "\n" : " ");
    } else {
      out.push(raw[i]);
      i += 1;
    }
  }
  return out.join("");
}

/**
 * True when `quote` appears verbatim (whitespace-normalized, no paragraph
 * crossing) inside `source`. The honesty gate for quotes.json.
 */
export function sourceContainsQuote(source: string, quote: string): boolean {
  const needle = normalizeQuote(quote);
  if (needle === "") return false;
  return normalizeSource(source).includes(needle);
}
