import { readFileSync } from "node:fs";
import { join } from "node:path";
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
 */

const SRC = join(__dirname, "..", "..");

function maxZIndexIn(relativePath: string): number {
  const css = readFileSync(join(SRC, relativePath), "utf8");
  const values = [...css.matchAll(/^\s*z-index:\s*(\d+)\s*;/gm)].map((m) =>
    Number(m[1]),
  );
  expect(values.length).toBeGreaterThan(0);
  return Math.max(...values);
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
    // The highest z-index any ordinary (non-overlay) page content uses. The
    // score view owns the ceiling here: `.score-toolbar` is 4 and
    // `.score-atlas-draft-dock` is 8.
    const pageContentMax = maxZIndexIn("features/score/ScoreView.css");
    expect(pageContentMax).toBeLessThan(DOCK_Z_BASE);

    // Fresh state: every panel still at its initial z (0) — i.e. exactly the
    // "no interaction has happened yet" case that used to render headless.
    const state = threePanels({ rep: 0, paused: 0, clock: 0 });
    for (const id of Object.keys(state)) {
      expect(dockPanelZIndex(state, id)).toBeGreaterThan(pageContentMax);
    }
  });

  it("renders every panel BELOW the global transient overlays", () => {
    // The heard pill must stay on top of everything the dock does (v6 S9
    // "visible hearing"), and so must the modal/dialog/receipt layers. The
    // lowest of them all is the 40 band, so that is the binding ceiling.
    const heardPill = zIndexOfRule("features/voice/HeardPill.css", ".heard-pill");
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
      heardPill,
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
    const hammered = threePanels({ rep: 9_000, paused: 12_345, clock: 999_999 });
    for (const id of Object.keys(hammered)) {
      const z = dockPanelZIndex(hammered, id);
      expect(z).toBeGreaterThanOrEqual(DOCK_Z_BASE);
      expect(z).toBeLessThanOrEqual(DOCK_Z_CEILING);
      expect(z).toBeLessThan(heardPill);
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
    const a = dockPanelZIndex(threePanels({ rep: 0, paused: 0, clock: 0 }), "rep");
    const b = dockPanelZIndex(
      { clock: defaultPanelState(), paused: defaultPanelState(), rep: defaultPanelState() },
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
