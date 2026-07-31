import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { QUOTES, SOURCE_FILE_BY_ID } from "./quotes";
import { normalizeQuote, normalizeSource } from "./quoteMatch";

/**
 * D1 honesty gate (ledger 27). Every shipped quote MUST appear verbatim
 * (whitespace-normalized, matching the Rust corpus reader) inside its source
 * markdown. This is the promise that quotes.json is real, not paraphrased.
 *
 * The corpus lives in Christian's Obsidian vault, outside the repo. On a machine
 * without it the gate SKIPS loudly rather than failing — the check stays
 * portable — but on any machine that has the vault it runs and must pass
 * CURATED_SIZE/CURATED_SIZE.
 */

/**
 * The curated corpus size. The original 182-entry harvest was culled to the
 * entries that state a principle a pianist can act on or argue with when read
 * alone on the menu; 48 bland/context-dependent fragments were dropped and 13
 * were shortened to a contiguous substring of their own verbatim text. Pinned
 * as a literal so an accidental mass deletion still fails this gate.
 */
const CURATED_SIZE = 134;
const KNOWLEDGE_DIR = join(
  homedir(),
  "Desktop",
  "christian's universe",
  "Piano Practice",
  "Knowledge and Resources",
);

const corpusPresent = existsSync(KNOWLEDGE_DIR);

if (!corpusPresent) {
  // eslint-disable-next-line no-console
  console.warn(
    `\n[quotes honesty gate] SKIPPED — corpus dir not found:\n  ${KNOWLEDGE_DIR}\n` +
      "  The verbatim check is portable and only runs where the vault is present.\n",
  );
}

// Normalize each ~MB source once (not per quote) — the collapse is the costly step.
const normalizedCache = new Map<string, string>();
function normalizedSourceText(sourceId: string): string {
  const cached = normalizedCache.get(sourceId);
  if (cached !== undefined) return cached;
  const fileName = SOURCE_FILE_BY_ID[sourceId];
  if (!fileName) throw new Error(`No source file mapped for id "${sourceId}"`);
  const raw = readFileSync(join(KNOWLEDGE_DIR, fileName), "utf8");
  const normalized = normalizeSource(raw);
  normalizedCache.set(sourceId, normalized);
  return normalized;
}

describe("quotes.json corpus shape", () => {
  it("ships exactly the curated set of well-formed, uniquely-identified quotes", () => {
    expect(QUOTES).toHaveLength(CURATED_SIZE);
    const ids = new Set(QUOTES.map((q) => q.id));
    expect(ids.size).toBe(QUOTES.length);
    for (const q of QUOTES) {
      expect(typeof q.text).toBe("string");
      expect(q.text.trim().length).toBeGreaterThan(0);
      expect(SOURCE_FILE_BY_ID[q.source_id]).toBeTruthy();
      expect(q.author.trim().length).toBeGreaterThan(0);
      expect(q.book.trim().length).toBeGreaterThan(0);
      // ≤40 words is the single-line contract the home slot relies on.
      expect(q.text.trim().split(/\s+/).length).toBeLessThanOrEqual(40);
    }
  });
});

describe.skipIf(!corpusPresent)(
  "quotes.json honesty gate (real corpus)",
  () => {
    it("every quote appears verbatim in its source markdown (all of them)", () => {
      const failures: string[] = [];
      for (const q of QUOTES) {
        const needle = normalizeQuote(q.text);
        if (
          needle === "" ||
          !normalizedSourceText(q.source_id).includes(needle)
        ) {
          failures.push(`${q.id} (${q.source_id}): ${q.text}`);
        }
      }
      const verified = QUOTES.length - failures.length;
      // eslint-disable-next-line no-console
      console.log(
        `[quotes honesty gate] VERBATIM ${verified}/${QUOTES.length} quotes confirmed against the real corpus.`,
      );
      expect(failures, `Non-verbatim quotes:\n${failures.join("\n")}`).toEqual(
        [],
      );
      expect(verified).toBe(CURATED_SIZE);
    }, 20000);
  },
);
