import { describe, expect, it } from "vitest";
import { DENSE_LAYOUT_FLOOR, NAV_RAIL_WIDTH } from "./dockState";
import {
  ASSUMED_MAX_HEIGHT as REP_ASSUMED_MAX_HEIGHT,
  DEFAULT_POSITION as REP_DEFAULT_POSITION,
  PANEL_WIDTH as REP_PANEL_WIDTH,
} from "./RepPanel";
import {
  ASSUMED_MAX_HEIGHT as PAUSED_ASSUMED_MAX_HEIGHT,
  DEFAULT_POSITION as PAUSED_DEFAULT_POSITION,
} from "./PausedSetsTray";
import { DEFAULT_POSITION as CLOCK_DEFAULT_POSITION } from "./ClockPanel";

// Fix wave item 9 (live-QA REFUTED finding): at the 720x520 dense-layout
// floor the rep panel's OLD default (x:24, y:88, 440w) both covered the
// 148px nav rail and overran the paused-sets tray's OLD default (y:340).
// jsdom always reports zero layout (`getBoundingClientRect` is a stub), so
// there is no way to assert this by actually rendering + measuring — these
// are pure checks against the exported default-position constants
// themselves, using each panel's own documented conservative height ceiling
// (see RepPanel.tsx's `ASSUMED_MAX_HEIGHT` / PausedSetsTray.tsx's) as the
// non-overlap budget.
const VIEWPORT = { width: 720, height: 520 };

// Real-use fix wave (item 4), round 2: `.shell-topbar` (session bar,
// including "End my day") is live-measured (dev:mock, 720px viewport,
// getBoundingClientRect) at 0 - 99.5px, and is the one interactive band
// present on EVERY tab (unlike the Score tab's toolbar or the Today tab's
// nav card, which the panel's own real content can still land on top of —
// see RepPanel.tsx's DEFAULT_POSITION comment and task-4-report.md for the
// full measurement table and why those cannot ALSO be cleared at this
// floor without reintroducing round 1's regressions). This is the one
// clearance a default position can and must guarantee everywhere.
const SHELL_TOPBAR_BOTTOM = 99.546875;

describe("dock default positions at the 720x520 floor (fix wave item 9)", () => {
  it("keeps every panel's default position clear of the 148px nav rail", () => {
    expect(REP_DEFAULT_POSITION.x).toBeGreaterThanOrEqual(NAV_RAIL_WIDTH);
    expect(PAUSED_DEFAULT_POSITION.x).toBeGreaterThanOrEqual(NAV_RAIL_WIDTH);
    expect(CLOCK_DEFAULT_POSITION.x).toBeGreaterThanOrEqual(NAV_RAIL_WIDTH);
  });

  it("keeps the rep panel's assumed footprint clear of the paused-sets tray's default position", () => {
    // "Expanded-rep + tray-open don't intersect": the rep panel's assumed
    // bottom edge must sit above where the tray starts.
    expect(REP_DEFAULT_POSITION.y + REP_ASSUMED_MAX_HEIGHT).toBeLessThanOrEqual(
      PAUSED_DEFAULT_POSITION.y,
    );
  });

  it("keeps the paused-sets tray's assumed footprint clear of the clock panel's default position", () => {
    expect(
      PAUSED_DEFAULT_POSITION.y + PAUSED_ASSUMED_MAX_HEIGHT,
    ).toBeLessThanOrEqual(CLOCK_DEFAULT_POSITION.y);
  });

  it("fits the rep panel's requested width inside the 720px floor from its own x", () => {
    expect(REP_DEFAULT_POSITION.x + REP_PANEL_WIDTH).toBeLessThanOrEqual(
      VIEWPORT.width,
    );
  });

  // Real-use fix wave (item 4), round 2 (round 1's y:340 was REJECTED on
  // review — it cleared the topbar too, but at the cost of two regressions
  // round 1 never measured: fully overlapping the Today tab's own nav card,
  // and fully overlapping a second panel (e.g. Clock) opened alongside rep.
  // Neither existed at the OLD y:16. See RepPanel.tsx's DEFAULT_POSITION
  // comment and task-4-report.md for the live measurements proving both,
  // and proving no y clears the topbar (needs >= ~100) AND guarantees zero
  // Clock overlap (needs <= 60) at the same time). y:108 clears ONLY the
  // topbar band — the one interactive control present on every tab, and
  // the one concretely evidenced in docs/qa/final-02-overlap-check.png.
  it("clears the shell topbar band (present on every tab) at the 720x520 floor", () => {
    expect(REP_DEFAULT_POSITION.y).toBeGreaterThanOrEqual(SHELL_TOPBAR_BOTTOM);
    // Paused/Clock stack below rep, so they clear it trivially — asserted
    // explicitly anyway so a future change to the chain can't silently
    // regress it without a test noticing.
    expect(PAUSED_DEFAULT_POSITION.y).toBeGreaterThanOrEqual(
      SHELL_TOPBAR_BOTTOM,
    );
    expect(CLOCK_DEFAULT_POSITION.y).toBeGreaterThanOrEqual(
      SHELL_TOPBAR_BOTTOM,
    );
  });

  it("keeps the rep panel's own default on-screen at the 520px floor's visible top edge", () => {
    expect(REP_DEFAULT_POSITION.y).toBeGreaterThanOrEqual(0);
    expect(REP_DEFAULT_POSITION.y).toBeLessThan(VIEWPORT.height);
  });

  // Real-use fix wave (item 4), round 2 — Finding 3 from review: the
  // paused/clock chain-stack (each panel's y = the one above's y + its own
  // ASSUMED_MAX_HEIGHT + 24) means ANY rep y past a small threshold pushes
  // later panels' RAW default y past the 520px floor. This is NOT new: at
  // the OLD y:16, paused's default (340) fit inside the floor but clock's
  // (528) already didn't. At y:108, paused (432) still fits — barely — but
  // clock (past 520 by more than before) doesn't, same as before. This is
  // PRE-EXISTING, not a regression from this fix — proven by checking what
  // the chain produces from y:16 (`chain(16).clockY === 528 > 520`, hand
  // and live confirmed) alongside what it produces from y:108. It is also
  // harmless: PausedSetsTray/ClockPanel default CLOSED (a pill, per fix
  // wave item 7), and DockPanel's become-visible effect (dockOpenClamp.
  // test.tsx) re-clamps whichever one actually opens to a real, fully
  // on-screen box using its OWN measured size — confirmed live: Clock
  // always renders at top:360 when opened (viewport-clamped to
  // `520 - MIN_VISIBLE_ON_OPEN_PX(160)`) regardless of whether its raw
  // default was 528 (old) or 616 (new) — the two numbers are functionally
  // identical once opened. Documented explicitly here, rather than
  // asserting a false "fits within the floor" for clock, so the next
  // reader isn't misled into thinking this default is meant to render
  // on-screen unclamped.
  it("paused's default still fits the 520px floor; clock's does not — pre-existing, corrected by the become-visible clamp on open (dockOpenClamp.test.tsx)", () => {
    expect(PAUSED_DEFAULT_POSITION.y).toBeLessThan(VIEWPORT.height);
    expect(CLOCK_DEFAULT_POSITION.y).toBeGreaterThan(VIEWPORT.height);
  });

  it("sanity: DENSE_LAYOUT_FLOOR matches this file's own VIEWPORT constant", () => {
    expect(DENSE_LAYOUT_FLOOR).toEqual(VIEWPORT);
  });
});
