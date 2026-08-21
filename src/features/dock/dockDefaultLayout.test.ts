import { describe, expect, it } from "vitest";
import {
  DENSE_LAYOUT_FLOOR,
  DOCK_CHAIN_BASE_Y,
  NAV_RAIL_WIDTH,
} from "./dockState";
import {
  ASSUMED_MAX_HEIGHT as REP_ASSUMED_MAX_HEIGHT,
  DEFAULT_POSITION as REP_DEFAULT_POSITION,
  PANEL_WIDTH as REP_PANEL_WIDTH,
} from "./RepPanel";
import {
  ASSUMED_MAX_HEIGHT as PAUSED_ASSUMED_MAX_HEIGHT,
  DEFAULT_POSITION as PAUSED_DEFAULT_POSITION,
} from "./PausedSetsTray";
import {
  DEFAULT_POSITION as CLOCK_DEFAULT_POSITION,
  PANEL_WIDTH as CLOCK_PANEL_WIDTH,
  clockDefaultX,
} from "./ClockPanel";

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

  // Real-use fix wave (item 4), round 4. This USED to assert
  // `rep.y + rep.ASSUMED <= paused.y` — true only while the chain started at
  // rep's own default y. Round 4 decoupled them (`DOCK_CHAIN_BASE_Y`) so a
  // topbar-clearing rep default can never push the clock off the floor, and
  // the two constraints are provably mutually exclusive at this floor:
  // `clock.y = base + 300 + 24 + 140 + 24`, so keeping clock inside 520
  // needs `base <= 32`, while clearing `.shell-topbar` needs `rep.y >= ~100`.
  // Clearing the topbar wins (it is the one interactive band on EVERY tab);
  // the rep-vs-tray case is handled at RUNTIME instead, by the become-visible
  // path's `resolveCollision` + viewport clamp (dockOpenClamp.test.tsx), and
  // — as of round 4's stacking fix — by the fact that whichever panel the
  // user touches last genuinely paints on top (dockStacking.test.ts).
  it("stacks the chain (tray, then clock) strictly below the rep panel's assumed footprint's own start, with the documented 24px gaps", () => {
    expect(PAUSED_DEFAULT_POSITION.y).toBe(
      DOCK_CHAIN_BASE_Y + REP_ASSUMED_MAX_HEIGHT + 24,
    );
    expect(PAUSED_DEFAULT_POSITION.y).toBeGreaterThan(DOCK_CHAIN_BASE_Y);
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

  // Real-use fix wave (item 4), round 4 — CORRECTION of this test's own
  // previous comment, which claimed the OLD (pre-task) chain produced
  // `clock.y === 528` and therefore "already didn't fit" the 520px floor.
  // That was wrong. Measured at commit 2514aa6 (the pre-task baseline), the
  // old chain produced `clock.y === 504`, which DID fit inside the floor with
  // its Start/Reset controls reachable without inner scrolling. The 528/596
  // numbers were a consequence of rounds 2-3 moving rep's default y, i.e. the
  // test was encoding NEW behavior as pre-existing. Round 4 restores the
  // measured-good chain by pinning its origin to `DOCK_CHAIN_BASE_Y` instead
  // of rep's own y, so both chained defaults fit the floor again — assert
  // that, rather than documenting a regression as normal.
  it("keeps both chained defaults (tray and clock) inside the 520px floor", () => {
    expect(PAUSED_DEFAULT_POSITION.y).toBe(340);
    expect(PAUSED_DEFAULT_POSITION.y).toBeLessThan(VIEWPORT.height);
    // 504 is the pre-task, live-measured-good value this round restores.
    expect(CLOCK_DEFAULT_POSITION.y).toBe(504);
    expect(CLOCK_DEFAULT_POSITION.y).toBeLessThan(VIEWPORT.height);
  });

  // Real-use fix wave (item 4), round 4. `clock.y` alone is not enough: at
  // 1440x900 the rep panel's real box is live-measured at 108-583.5, i.e. it
  // reaches past the clock's 504, so with both panels in the same x column
  // `resolveCollision` pushes the clock to `rep.bottom + 8` = 591.5 on open —
  // which leaves 292.5px of budget for 338px of clock content and drops the
  // countdown's Start/Reset row below the fold (live-measured; the pre-task
  // baseline at 2514aa6 had both rows visible with no inner scroll). A second
  // column removes the horizontal intersection entirely, so there is nothing
  // to push. It is taken only when the whole panel fits there — at the
  // 720x520 floor it does not, and taking it anyway would leave the clock
  // hanging half off the right edge (`clampPosition`'s x clamp only keeps
  // `MIN_VISIBLE_ON_OPEN_PX` on screen).
  it("puts the clock in a second column beside the rep panel only when the whole panel fits there", () => {
    // No viewport (jsdom / SSR): the safe single column.
    expect(clockDefaultX(undefined)).toBe(CLOCK_DEFAULT_POSITION.x);

    // 720x520 dense-layout floor: no room, stay in the first column.
    expect(clockDefaultX(VIEWPORT.width)).toBe(CLOCK_DEFAULT_POSITION.x);

    // Realistic window: second column, clear of the rep panel's own box...
    const wide = clockDefaultX(1440);
    expect(wide).toBeGreaterThanOrEqual(
      REP_DEFAULT_POSITION.x + REP_PANEL_WIDTH,
    );
    // ...and entirely on screen (this is what the floor cannot satisfy).
    expect(wide + CLOCK_PANEL_WIDTH).toBeLessThanOrEqual(1440);
  });

  it("sanity: DENSE_LAYOUT_FLOOR matches this file's own VIEWPORT constant", () => {
    expect(DENSE_LAYOUT_FLOOR).toEqual(VIEWPORT);
  });
});
