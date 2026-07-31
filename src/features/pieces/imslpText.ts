// ---------------------------------------------------------------------------
// Pure, security-sensitive text helpers for the IMSLP add-a-score flow. Kept
// separate from React so they are trivially unit-testable and reused by both
// the panel and the import step.
// ---------------------------------------------------------------------------

/** One IMSLP search hit (mirrors Rust `imslp::WorkHit`). */
export interface WorkHit {
  /** Unique per wiki page — this is the hit's IDENTITY (React key, selection). */
  title: string;
  /**
   * ALWAYS 0 for IMSLP search hits: `list=search` returns no `pageid`. Never use
   * this to tell two results apart — key on `title`. See `imslp.rs`.
   */
  page_id: number;
  /** HTML snippet with highlight `<span>`s — ALWAYS render via stripHighlightHtml. */
  snippet: string;
  size: number;
  word_count: number;
  is_redirect: boolean;
}

/** One downloadable edition of a work (mirrors Rust `imslp::Edition`). */
export interface Edition {
  file_name: string;
  description: string;
  editor: string;
  /** Raw wikitext — render via stripWikiTemplates. */
  publisher: string;
  copyright: string;
  image_type: string;
}

/** Resolved direct-file facts (mirrors Rust `imslp::FileInfo`). */
export interface FileInfo {
  url: string;
  size: number;
  mime: string;
}

/**
 * Render an IMSLP search snippet as PLAIN TEXT. IMSLP returns HTML with
 * `<span class="searchmatch">` highlight markup; we STRIP every tag and decode
 * a few named entities so it can be placed as a text node.
 *
 * SECURITY: API-sourced HTML is never trusted. This output is only ever used as
 * React text content — the flow must never call `dangerouslySetInnerHTML` with
 * it — so any `<script>`/markup a compromised or unexpected response carried is
 * inert.
 */
export function stripHighlightHtml(snippet: string): string {
  const withoutTags = snippet.replace(/<[^>]*>/g, "");
  return decodeBasicEntities(withoutTags).replace(/\s+/g, " ").trim();
}

/**
 * Strip MediaWiki `{{template}}` noise from a wikitext field (publisher/editor)
 * for display, keeping the readable parameter text. Handles nested templates by
 * collapsing innermost-first, dropping each template's name (its first
 * `|`-segment) while keeping the remaining argument text.
 */
export function stripWikiTemplates(value: string): string {
  let out = value;
  let previous = "";
  const innermost = /\{\{([^{}]*)\}\}/;
  // Bounded: each pass removes at least one innermost template.
  while (innermost.test(out) && out !== previous) {
    previous = out;
    out = out.replace(innermost, (_match, body: string) => {
      const args = String(body)
        .split("|")
        .slice(1) // drop the template name
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      return ` ${args.join(" ")} `;
    });
  }
  return out.replace(/[{}|]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The expected downloaded file name for a resolved file URL: the last path
 * segment, percent-decoded (e.g. `PMLP02312-Chopin_Nocturnes….pdf`).
 */
export function downloadBasename(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL; fall back to the raw string.
  }
  const last = path.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Whether a Downloads-folder file name matches the expected download, allowing
 * for browser de-duplication suffixes: `name.pdf`, `name (1).pdf`, `name (2).pdf`.
 */
export function matchesDownloadName(
  candidate: string,
  expected: string,
): boolean {
  if (!expected) return false;
  if (candidate === expected) return true;
  const dot = expected.lastIndexOf(".");
  const stem = dot > 0 ? expected.slice(0, dot) : expected;
  const ext = dot > 0 ? expected.slice(dot) : "";
  const dedup = new RegExp(
    `^${escapeRegExp(stem)} \\(\\d+\\)${escapeRegExp(ext)}$`,
  );
  return dedup.test(candidate);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
