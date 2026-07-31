import { describe, expect, it } from "vitest";
import {
  dedupeHits,
  downloadBasename,
  isSupersededError,
  matchesDownloadName,
  SEARCH_SUPERSEDED,
  stripHighlightHtml,
  stripWikiTemplates,
  type WorkHit,
} from "./imslpText";

describe("stripHighlightHtml", () => {
  it("removes highlight spans, keeping plain text", () => {
    expect(
      stripHighlightHtml(
        'Complete <span class="searchmatch">Nocturnes</span> score',
      ),
    ).toBe("Complete Nocturnes score");
  });

  it("renders a <script> payload inert (tags stripped to text)", () => {
    const out = stripHighlightHtml("safe <script>alert(1)</script> text");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("</script>");
    expect(out).toBe("safe alert(1) text");
  });

  it("decodes a few named entities", () => {
    expect(stripHighlightHtml("Fr&eacute;d&eacute;ric &amp; Sons"));
    expect(stripHighlightHtml("a &amp; b")).toBe("a & b");
    expect(stripHighlightHtml("&lt;b&gt;")).toBe("<b>");
  });
});

describe("stripWikiTemplates", () => {
  it("keeps readable text and drops bare marker templates", () => {
    expect(stripWikiTemplates("{{FE}} (German)")).toBe("(German)");
  });

  it("collapses nested templates, keeping argument text", () => {
    const out = stripWikiTemplates(
      "{{P|Kistner|Fr. Kistner|Leipzig|{{HMB|1833|7}}|1832||995}}",
    );
    expect(out).not.toContain("{{");
    expect(out).not.toContain("}}");
    expect(out).not.toContain("|");
    expect(out).toContain("Kistner");
    expect(out).toContain("Leipzig");
  });

  it("leaves plain text untouched", () => {
    expect(stripWikiTemplates("Public Domain")).toBe("Public Domain");
  });
});

describe("downloadBasename", () => {
  it("returns the decoded last path segment of a URL", () => {
    expect(
      downloadBasename(
        "https://imslp.org/images/9/91/PMLP02312-Chopin_Nocturnes.pdf",
      ),
    ).toBe("PMLP02312-Chopin_Nocturnes.pdf");
  });

  it("percent-decodes", () => {
    expect(
      downloadBasename("https://imslp.org/images/a/b/My%20Score.pdf"),
    ).toBe("My Score.pdf");
  });
});

describe("matchesDownloadName", () => {
  const expected = "PMLP02312-Chopin_Nocturnes.pdf";

  it("matches the exact name", () => {
    expect(matchesDownloadName(expected, expected)).toBe(true);
  });

  it("matches browser dedup suffixes", () => {
    expect(
      matchesDownloadName("PMLP02312-Chopin_Nocturnes (1).pdf", expected),
    ).toBe(true);
    expect(
      matchesDownloadName("PMLP02312-Chopin_Nocturnes (12).pdf", expected),
    ).toBe(true);
  });

  it("rejects unrelated or partially-matching names", () => {
    expect(matchesDownloadName("something-else.pdf", expected)).toBe(false);
    expect(
      matchesDownloadName("PMLP02312-Chopin_Nocturnes.mid", expected),
    ).toBe(false);
    expect(
      matchesDownloadName("PMLP02312-Chopin_Nocturnes-1.pdf", expected),
    ).toBe(false);
    expect(matchesDownloadName("x.pdf", "")).toBe(false);
  });
});

describe("dedupeHits", () => {
  const hit = (title: string, snippet: string): WorkHit => ({
    title,
    // Exactly what live IMSLP sends: `list=search` carries no `pageid`, so this
    // is 0 on every real hit and cannot tell two rows apart.
    page_id: 0,
    snippet,
    size: 1,
    word_count: 1,
    is_redirect: false,
  });

  it("collapses repeated titles, keeping the first (best-ranked) row", () => {
    const deduped = dedupeHits([
      hit("Nocturnes, Op.9 (Chopin, Frédéric)", "first"),
      hit("Nocturnes, Op.9 (Chopin, Frédéric)", "duplicate"),
      hit("Nocturnes, Op.15 (Chopin, Frédéric)", "other"),
    ]);
    expect(deduped.map((h) => h.title)).toEqual([
      "Nocturnes, Op.9 (Chopin, Frédéric)",
      "Nocturnes, Op.15 (Chopin, Frédéric)",
    ]);
    expect(deduped[0].snippet).toBe("first");
  });

  it("guarantees the invariant the picker's React key depends on", () => {
    const titles = dedupeHits([
      hit("A", "x"),
      hit("B", "x"),
      hit("A", "x"),
      hit("B", "x"),
      hit("C", "x"),
    ]).map((h) => h.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toEqual(["A", "B", "C"]);
  });

  it("leaves an already-unique list untouched", () => {
    const hits = [hit("A", "x"), hit("B", "y")];
    expect(dedupeHits(hits)).toEqual(hits);
    expect(dedupeHits([])).toEqual([]);
  });
});

describe("isSupersededError", () => {
  // Byte-identical to `SEARCH_SUPERSEDED` in src-tauri/src/imslp.rs, which
  // asserts the same literal. If one side is edited, both tests must be.
  it("pins the exact string the Rust client sends", () => {
    expect(SEARCH_SUPERSEDED).toBe("IMSLP search superseded by a newer query.");
  });

  it("recognises the signal, however Tauri wraps it", () => {
    expect(isSupersededError(SEARCH_SUPERSEDED)).toBe(true);
    expect(isSupersededError(`Error: ${SEARCH_SUPERSEDED}`)).toBe(true);
  });

  it("does not swallow a real failure", () => {
    expect(
      isSupersededError("Could not reach IMSLP. Check your connection."),
    ).toBe(false);
    expect(isSupersededError("IMSLP returned an unexpected status (503).")).toBe(
      false,
    );
    expect(isSupersededError("")).toBe(false);
  });
});
