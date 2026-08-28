import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shellCss = readFileSync(resolve("src/shell/shell.css"), "utf8");
const shellSource = readFileSync(resolve("src/shell/Shell.tsx"), "utf8");
const workspaceCss = readFileSync(
  resolve("src/features/score/ScoreWorkspace.css"),
  "utf8",
);

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...css.matchAll(
      new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "gm"),
    ),
  ];
  expect(matches.length, `stylesheet defines ${selector}`).toBeGreaterThan(0);
  return matches.at(-1)![2];
}

describe("Score workspace scroll ownership", () => {
  it("bounds Score to the shell stage instead of scrolling the whole workspace", () => {
    expect(shellSource).toContain(
      'className={`shell-stage${view === "score" ? " is-score" : ""}`}',
    );
    expect(shellSource).toContain('className="score-shell-cache"');

    const scoreStage = ruleBody(shellCss, ".shell-stage.is-score");
    const cache = ruleBody(
      shellCss,
      ".shell-stage.is-score > .score-shell-cache",
    );
    expect(scoreStage).toMatch(/overflow\s*:\s*hidden/);
    expect(scoreStage).toMatch(/padding\s*:\s*0/);
    expect(cache).toMatch(/height\s*:\s*100%/);
    expect(cache).toMatch(/overflow\s*:\s*hidden/);
  });

  it("keeps the workspace and its active pane height-contained", () => {
    const workspace = ruleBody(workspaceCss, ".score-workspace");
    const body = ruleBody(workspaceCss, ".score-workspace-body");
    const pane = ruleBody(workspaceCss, ".score-workspace-pane");
    expect(workspace).toMatch(/height\s*:\s*100%/);
    expect(workspace).toMatch(/overflow\s*:\s*hidden/);
    expect(body).toMatch(/min-height\s*:\s*0/);
    expect(body).toMatch(/overflow\s*:\s*hidden/);
    expect(pane).toMatch(/min-height\s*:\s*0/);
    expect(pane).toMatch(/overflow\s*:\s*hidden/);
  });
});
