import { describe, expect, it } from "vitest";
import {
  downloadBasename,
  matchesDownloadName,
  stripHighlightHtml,
  stripWikiTemplates,
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
