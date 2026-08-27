import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOCK_Z_BASE,
  DOCK_Z_CEILING,
  defaultPanelState,
  dockPanelZIndex,
  nextZ,
  raiseZ,
  type DockState,
} from "./dockState";

/**
 * Real-use fix wave (item 4), round 4 — the stacking contract.
 *
 * Three rounds of tuning the rep panel's DEFAULT POSITION all failed the same
 * way: whatever coordinates were chosen, the panel could be painted over by
 * ordinary page content, because `DockPanel` rendered `panel.z` (a focus RANK
 * starting at 0/1) straight into `style.zIndex` while this app's page content
 * routinely uses z-index 1-8. At 1440x900 that put the rep panel's entire
 * title bar — drag handle, minimize, close — behind `.score-toolbar`
 * (z-index: 4), i.e. unreachable from mount with no interaction. Position is
 * not the defect; stacking order is.
 *
 * These tests pin the ordering contract so a future z-index anywhere in the
 * app can't silently break it again. The CSS values below are read from the
 * real stylesheets rather than copied, so a change to any of them fails HERE
 * instead of in live QA.
 *
 * Final-review fix wave: the guard used to read `ScoreView.css` alone, so
 * the identical mistake (a page-content z-index landing in the dock's
 * reserved 10-39 window) landing in ANY other stylesheet — `mapping.css`,
 * `shell.css`, a file that doesn't exist yet — passed silently. `pageContentMax`
 * below now scans every `.css` file under `src/` instead of a hardcoded
 * list, so a new stylesheet is covered automatically.
 */

const SRC = join(__dirname, "..", "..");

/** Recursively collect every `.css` file under `dir`. */
function listCssFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listCssFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      files.push(full);
    }
  }
  return files;
}

/** Strip `/* ... *\/` comments before scanning for declarations, so prose
 * that merely MENTIONS "z-index" (SessionBar.css's postmortem, App.css's
 * history note) is never mistaken for a live rule. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Every z-index VALUE declared in `absPath`, resolved to a number.
 *
 * Matches both multi-line rules and single-line rule bodies
 * (`.x { z-index: 20; }`) — the old regex anchored to line-start
 * (`/^\s*z-index:/`) only caught the former, so a single-line rule slipped
 * past silently. A `var(...)`-valued z-index is never silently dropped
 * either: if the custom property is defined in the same file it is
 * resolved to its number; otherwise this throws, naming the file, since an
 * unanalyzable z-index is exactly the kind of blind spot this guard exists
 * to close.
 */
function zIndexValuesIn(absPath: string): number[] {
  const css = stripCssComments(readFileSync(absPath, "utf8"));
  const customProps = new Map<string, string>();
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    customProps.set(m[1], m[2].trim());
  }
  const values: number[] = [];
  for (const m of css.matchAll(/z-index\s*:\s*([^;]+);/g)) {
    let raw = m[1].trim();
    const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(raw);
    if (varMatch) {
      const resolved = (customProps.get(varMatch[1]) ?? varMatch[2])?.trim();
      if (resolved === undefined || !/^\d+$/.test(resolved)) {
        throw new Error(
          `dockStacking.test.ts: unresolvable var()-valued z-index "${raw}" in ` +
            `${absPath} — resolve it explicitly (or teach zIndexValuesIn how) ` +
            `instead of letting it silently drop out of the stacking guard.`,
        );
      }
      raw = resolved;
    }
    if (!/^\d+$/.test(raw)) {
      throw new Error(
        `dockStacking.test.ts: unparseable z-index value "${raw}" in ${absPath}.`,
      );
    }
    values.push(Number(raw));
  }
  return values;
}

/** The highest z-index any CSS file under `src/` uses at or below the
 * dock's own ceiling (`DOCK_Z_CEILING`, 39) — i.e. every value that could
 * either collide with the dock's reserved 10-39 window or be mistaken for
 * "ordinary content" instead of the already-established >=40 overlay band
 * (scrims at 40, transient voice feedback at 50, ...). Excludes the dock's OWN
 * stylesheet(s), which legitimately live inside 10-39 by design.
 */
function pageContentMax(): number {
  const cssFiles = listCssFiles(SRC).filter((f) => {
    const rel = relative(SRC, f).split(sep).join("/");
    return !rel.startsWith("features/dock/");
  });
  const values = cssFiles.flatMap((f) => zIndexValuesIn(f));
  expect(values.length).toBeGreaterThan(0);
  const inOrBelowDockWindow = values.filter((v) => v <= DOCK_Z_CEILING);
  expect(inOrBelowDockWindow.length).toBeGreaterThan(0);
  return Math.max(...inOrBelowDockWindow);
}

function zIndexOfRule(relativePath: string, selector: string): number {
  const css = readFileSync(join(SRC, relativePath), "utf8");
  const rule = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*?z-index:\\s*(\\d+)`,
    "m",
  );
  const match = rule.exec(css);
  expect(match, `no z-index found for ${selector} in ${relativePath}`).not.toBe(
    null,
  );
  return Number(match![1]);
}

function threePanels(zs: { rep: number; paused: number; clock: number }) {
  const state: DockState = {
    rep: defaultPanelState({ z: zs.rep }),
    paused: defaultPanelState({ z: zs.paused }),
    clock: defaultPanelState({ z: zs.clock }),
  };
  return state;
}

describe("dock stacking contract", () => {
  it("renders every panel above ordinary page content from mount, with no interaction", () => {
    // The highest z-index any ordinary (non-overlay) page content uses,
    // scanned across every stylesheet in the app (except the dock's own).
    // Currently the score view owns the ceiling: `.score-toolbar` is 4 and
    // `.score-atlas-draft-dock` is 8.
    const contentMax = pageContentMax();
    expect(contentMax).toBeLessThan(DOCK_Z_BASE);

    // Fresh state: every panel still at its initial z (0) — i.e. exactly the
    // "no interaction has happened yet" case that used to render headless.
    const state = threePanels({ rep: 0, paused: 0, clock: 0 });
    for (const id of Object.keys(state)) {
      expect(dockPanelZIndex(state, id)).toBeGreaterThan(contentMax);
    }
  });

  it("renders every panel BELOW the global transient overlays", () => {
    // The persistent heard feed now lives inside the Rep Counter itself.
    // Transient voice feedback and modal/dialog/receipt layers remain above
    // every dock panel. The lowest of them is the 40 band, the binding ceiling.
    const voiceToast = zIndexOfRule(
      "features/voice/VoiceToast.css",
      ".voice-feedback",
    );
    const pickerScrim = zIndexOfRule(
      "features/notebook/DaySheet.css",
      ".ck-ns-picker-scrim",
    );
    const dialogBackdrop = zIndexOfRule("ui/ui.css", ".ck-dialog-backdrop");
    const popover = zIndexOfRule("components/Popover.css", ".popover-panel");
    const receipts = zIndexOfRule(
      "features/receipts/ReceiptCenter.css",
      ".receipt-center",
    );
    const lowestOverlay = Math.min(
      voiceToast,
      pickerScrim,
      dialogBackdrop,
      popover,
      receipts,
    );
    expect(DOCK_Z_CEILING).toBeLessThan(lowestOverlay);
    expect(DOCK_Z_BASE).toBeLessThan(DOCK_Z_CEILING);

    // ...and no reachable rank can escape the window, however many focus
    // bumps have happened (raw `panel.z` is unbounded by design).
    const hammered = threePanels({
      rep: 9_000,
      paused: 12_345,
      clock: 999_999,
    });
    for (const id of Object.keys(hammered)) {
      const z = dockPanelZIndex(hammered, id);
      expect(z).toBeGreaterThanOrEqual(DOCK_Z_BASE);
      expect(z).toBeLessThanOrEqual(DOCK_Z_CEILING);
      expect(z).toBeLessThan(lowestOverlay);
    }
  });

  it("still lets siblings reorder: focusing a panel raises it above the others", () => {
    let state = threePanels({ rep: 0, paused: 0, clock: 0 });

    state = raiseZ(state, "clock");
    expect(dockPanelZIndex(state, "clock")).toBeGreaterThan(
      dockPanelZIndex(state, "rep"),
    );
    expect(dockPanelZIndex(state, "clock")).toBeGreaterThan(
      dockPanelZIndex(state, "paused"),
    );

    state = raiseZ(state, "rep");
    expect(dockPanelZIndex(state, "rep")).toBeGreaterThan(
      dockPanelZIndex(state, "clock"),
    );

    state = raiseZ(state, "paused");
    expect(dockPanelZIndex(state, "paused")).toBeGreaterThan(
      dockPanelZIndex(state, "rep"),
    );
    // Repeated focus churn never walks the rendered index out of the window.
    for (let i = 0; i < 200; i += 1) {
      state = raiseZ(state, i % 2 === 0 ? "rep" : "clock");
    }
    expect(nextZ(state)).toBeGreaterThan(DOCK_Z_CEILING);
    for (const id of Object.keys(state)) {
      expect(dockPanelZIndex(state, id)).toBeLessThanOrEqual(DOCK_Z_CEILING);
    }
    expect(dockPanelZIndex(state, "clock")).toBeGreaterThan(
      dockPanelZIndex(state, "rep"),
    );
  });

  it("breaks ties by id so an untouched dock has a stable, deterministic order", () => {
    const a = dockPanelZIndex(
      threePanels({ rep: 0, paused: 0, clock: 0 }),
      "rep",
    );
    const b = dockPanelZIndex(
      {
        clock: defaultPanelState(),
        paused: defaultPanelState(),
        rep: defaultPanelState(),
      },
      "rep",
    );
    expect(a).toBe(b);
  });

  it("DockPanel renders the contract's index, never the raw focus rank", () => {
    const source = readFileSync(join(__dirname, "DockPanel.tsx"), "utf8");
    expect(source).toContain("dockPanelZIndex(ctx.state, id)");
    expect(source).not.toMatch(/zIndex:\s*panel\.z/);
  });
});
