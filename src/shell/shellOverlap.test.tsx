import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionBar } from "../features/session/SessionBar";

/**
 * Defect D1 regression suite — "the session HUD floats over content and clips
 * its own text".
 *
 * The strip used to be `position: fixed` top-right (z-index 35) inside a second
 * fixed wrapper (z-index 80), so it floated over whatever the workspace put
 * beneath it. On the Score screen it landed on the "Piece" label and its
 * selector, occluding a primary control; and, owning no space of its own, its
 * helper sentence ran under the End-session button and off the panel edge.
 *
 * jsdom has no layout engine, so pixel overlap cannot be asserted here — it is
 * measured in a real browser (see .workflow/scratch/shell-qa). What IS asserted
 * is the two structural invariants that make overlap and clipping impossible:
 *
 *   1. NO OUT-OF-FLOW POSITIONING. Neither the strip nor its shell dock may be
 *      fixed/absolute or carry a z-index. An in-flow element in its own grid
 *      row reserves height and cannot be painted over interactive chrome.
 *   2. THE HELPER SENTENCE IS ITS OWN FULL-WIDTH LINE. It must be a sibling of
 *      the control row — never a child squeezed into a width-capped column
 *      beside the button — and nothing may stop it wrapping.
 */

const sessionCss = readFileSync(
  resolve("src/features/session/SessionBar.css"),
  "utf8",
);
const shellCss = readFileSync(resolve("src/shell/shell.css"), "utf8");
const shellTsx = readFileSync(resolve("src/shell/Shell.tsx"), "utf8");

/** Body of the first CSS rule whose selector list matches exactly. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(
    css,
  );
  expect(match, `stylesheet defines a \`${selector}\` rule`).not.toBeNull();
  return match![2];
}

afterEach(cleanup);

describe("D1 — the session strip reserves its own space (no overlay)", () => {
  it("declares no out-of-flow positioning or stacking on the strip itself", () => {
    const bar = ruleBody(sessionCss, ".session-bar");
    expect(bar).not.toMatch(/position\s*:\s*(fixed|absolute|sticky)/);
    expect(bar).not.toMatch(/z-index/);
    expect(bar).not.toMatch(/\btop\s*:/);
    expect(bar).not.toMatch(/\bright\s*:/);
  });

  it("keeps the whole session stylesheet free of fixed/absolute positioning", () => {
    // A nested rule re-introducing an overlay would defeat the header band just
    // as effectively as the old .session-bar rule did. Comments are stripped
    // first: the rule's own docblock quotes the defect it replaced.
    const declarations = sessionCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declarations).not.toMatch(/position\s*:\s*(fixed|absolute)/);
    expect(declarations).not.toMatch(/z-index\s*:/);
  });

  it("mounts the strip in a shell header band that is its own grid row", () => {
    // Header band and stage occupy DIFFERENT rows of the shell grid, so the
    // band's height is reserved and the two can never share pixels.
    const topbar = ruleBody(shellCss, ".shell-topbar");
    const stage = ruleBody(shellCss, ".shell-stage");
    expect(topbar).toMatch(/grid-row\s*:\s*1\b/);
    expect(stage).toMatch(/grid-row\s*:\s*2\b/);
    expect(topbar).toMatch(/grid-column\s*:\s*2\b/);
    expect(stage).toMatch(/grid-column\s*:\s*2\b/);

    expect(shellTsx).toMatch(/<header className="shell-topbar">/);
    // The shell must not re-wrap the strip in an inline-positioned overlay.
    expect(shellTsx).not.toMatch(/SESSION_DOCK_STYLE/);
    expect(shellTsx).not.toMatch(/position:\s*"fixed"[^}]*zIndex:\s*80/);
  });

  // `.shell-set-dock` (the in-flow strip this suite guarded) was removed in
  // Task A3: the active-set card moved into a floating Practice Dock panel
  // (src/features/dock/), which is a deliberately positioned, draggable
  // surface — the D1 "accidental overlay" failure mode this suite exists to
  // catch does not apply to a panel whose whole job is to float.
  it("no longer renders the set as an in-flow shell strip", () => {
    expect(shellCss).not.toMatch(/\.shell-set-dock\b/);
    expect(shellTsx).not.toMatch(/shell-set-dock/);
  });
});

describe("D1 — the blocked-reason sentence wraps rather than clipping", () => {
  const session = {
    id: 1,
    started_at: new Date().toISOString(),
    events: [],
  };
  const LONG =
    "Close the active set before ending the session — the tempo ladder for " +
    "Scherzo No. 2, mm. 65-96, still has an unfinished clean-streak proof at " +
    "84 that would otherwise be discarded without a receipt.";

  it("renders the sentence outside the control row, as a full-width sibling", () => {
    const { container } = render(
      <SessionBar session={session} onEnd={() => {}} blockedReason={LONG} />,
    );
    const help = container.querySelector(".session-blocked");
    expect(help, "the blocked reason renders").not.toBeNull();
    expect(help!.textContent).toBe(LONG);

    const row = container.querySelector(".session-bar-row")!;
    // It used to live INSIDE the row, in a 12rem column beside the button.
    expect(row.contains(help!)).toBe(false);
    expect(help!.parentElement).toBe(container.querySelector(".session-bar"));
    // And it must sit AFTER the row, so it can only ever be below the button.
    expect(row.compareDocumentPosition(help!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("keeps the End-session control a direct child of the row", () => {
    render(
      <SessionBar session={session} onEnd={() => {}} blockedReason={LONG} />,
    );
    const end = screen.getByRole("button", { name: "End session" });
    expect(end.parentElement?.className).toContain("session-bar-row");
    // The old width-capped wrapper is what forced the sentence to clip.
    expect(document.querySelector(".session-end-control")).toBeNull();
  });

  it("does not suppress wrapping or clip overflow on the sentence", () => {
    const help = ruleBody(sessionCss, ".session-blocked");
    expect(help).not.toMatch(/white-space\s*:\s*nowrap/);
    expect(help).not.toMatch(/text-overflow\s*:\s*ellipsis/);
    expect(help).not.toMatch(/overflow\s*:\s*hidden/);
    expect(help).not.toMatch(/max-width/);
    // Long unbroken tokens (a piece title, a path) still wrap instead of
    // pushing the strip wider than its container.
    expect(help).toMatch(/overflow-wrap\s*:\s*anywhere/);
  });

  it("still renders nothing extra when there is no blocked reason", () => {
    const { container } = render(
      <SessionBar session={session} onEnd={() => {}} />,
    );
    expect(container.querySelector(".session-blocked")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "End session" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
