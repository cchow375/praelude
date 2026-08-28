import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("src/features/score/ScoreView.css"), "utf8");
const source = readFileSync(
  resolve("src/features/score/ScoreView.tsx"),
  "utf8",
);

function ruleBody(styles: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...styles.matchAll(
      new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "gm"),
    ),
  ];
  expect(matches.length, `stylesheet defines ${selector}`).toBeGreaterThan(0);
  return matches[0][2];
}

describe("ScoreView bounded visual layout", () => {
  it("owns independent score and section scroll panes", () => {
    const body = ruleBody(css, ".score-body");
    const score = ruleBody(css, ".score-scroll");
    const rail = ruleBody(css, ".score-region-panel");

    expect(body).toMatch(/grid-template-rows\s*:\s*minmax\(0,\s*1fr\)/);
    expect(body).toMatch(/overflow\s*:\s*hidden/);
    expect(score).toMatch(/overflow\s*:\s*auto/);
    expect(rail).toMatch(/overflow-y\s*:\s*auto/);
    expect(rail).toMatch(/overflow-x\s*:\s*hidden/);
  });

  it("uses the inspector rail as the sole scroll owner and keeps Start reachable", () => {
    expect(ruleBody(css, ".score-practice-region .block-form")).toMatch(
      /max-height:\s*none/,
    );
    expect(ruleBody(css, ".score-practice-region .block-form-body")).toMatch(
      /overflow:\s*visible/,
    );
    const head = ruleBody(css, ".score-practice-region .block-form-head");
    expect(head).toMatch(/position:\s*sticky/);
    expect(head).toMatch(/top:\s*var\(--score-region-sticky-head-height\)/);
    expect(ruleBody(css, ".score-region-panel")).toMatch(
      /--score-region-sticky-head-height:\s*66px/,
    );
    expect(ruleBody(css, ".score-region-panel-head")).toMatch(
      /min-height:\s*var\(--score-region-sticky-head-height\)/,
    );
  });

  it("uses no-wrap compact grids inside the 320px inspector rail", () => {
    const pair = ruleBody(css, ".score-practice-region .ck-core-pair");
    const focus = ruleBody(css, ".score-practice-region .ck-focus-grid");
    const target = ruleBody(css, ".score-practice-region .ck-target-line");

    expect(pair).toMatch(/display:\s*grid/);
    expect(pair).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(focus).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
    expect(target).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+4\.5rem/,
    );
    expect(
      ruleBody(css, ".score-practice-region .ck-core-pair > .ck-field"),
    ).toMatch(/min-width:\s*0/);
  });

  it("uses a compact two-row toolbar at the 720×520 acceptance boundary", () => {
    expect(css).toMatch(
      /@media \(max-width: 720px\), \(max-height: 560px\) \{[\s\S]*?\.score-toolbar \{[\s\S]*?min-height:\s*0;[\s\S]*?padding:\s*3px/,
    );
    expect(css).toMatch(
      /@media \(max-width: 1200px\) \{[\s\S]*?\.score-page-controls \{[\s\S]*?grid-row:\s*2/,
    );
    expect(source).toContain(
      '<details className="score-tools-menu" ref={scoreToolsRef}>',
    );
    expect(source).toContain(
      '<summary role="button" aria-label="Score tools">',
    );
  });
});
