import { describe, expect, it } from "vitest";
import { DENSE_LAYOUT_FLOOR, MIN_PANEL_WIDTH, NAV_RAIL_WIDTH } from "./dockState";
import {
  ASSUMED_MAX_HEIGHT as REP_ASSUMED_MAX_HEIGHT,
  DEFAULT_POSITION as REP_DEFAULT_POSITION,
  PANEL_WIDTH as REP_PANEL_WIDTH,
  TODAY_NAV_CARD_RIGHT_INTERCEPT,
  TODAY_NAV_CARD_RIGHT_SLOPE,
  WIDE_VIEWPORT_BREAKPOINT,
  WIDE_Y,
  repDefaultLayout,
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

// Real-use fix wave (item 4), round 3: round 2's FIXED default (x:160,
// y:108) still landed the rep panel's box on top of the Score tab's own
// head (title/tabs/piece-picker/metronome — always rendered, spans nearly
// the full content width) at a realistic ~1440x900 window, because y:108
// only ever cleared the shell topbar, not that. `repDefaultLayout` makes
// the default a pure function of the viewport (+ requested width) instead
// of a single constant, so it can lean right and drop lower once there is
// real room to do so — see RepPanel.tsx's doc comments for the full
// measurement-backed reasoning (`WIDE_VIEWPORT_BREAKPOINT`, `WIDE_Y`,
// `TODAY_NAV_CARD_RIGHT_SLOPE`/`_INTERCEPT`). These are the pure-function
// unit tests (no DOM); the live, rendered verification (both viewport
// sizes, every named element) lives in task-4-report.md.
describe("repDefaultLayout (real-use fix wave item 4, round 3 — viewport-aware default)", () => {
  it("falls back to DEFAULT_POSITION (+ the requested width, unclamped) when the viewport is unknown", () => {
    expect(repDefaultLayout(undefined, REP_PANEL_WIDTH)).toEqual({
      x: REP_DEFAULT_POSITION.x,
      y: REP_DEFAULT_POSITION.y,
      width: REP_PANEL_WIDTH,
    });
  });

  it("narrow viewport (below WIDE_VIEWPORT_BREAKPOINT, e.g. the 720x520 floor): identical to round 2 — DEFAULT_POSITION untouched", () => {
    expect(
      repDefaultLayout(VIEWPORT, REP_PANEL_WIDTH),
    ).toEqual({
      x: REP_DEFAULT_POSITION.x,
      y: REP_DEFAULT_POSITION.y,
      width: REP_PANEL_WIDTH,
    });
    // Exercise the exact boundary too — one px below the breakpoint must
    // still be the narrow behavior.
    const justNarrow = {
      width: WIDE_VIEWPORT_BREAKPOINT - 1,
      height: 900,
    };
    expect(repDefaultLayout(justNarrow, REP_PANEL_WIDTH).y).toBe(
      REP_DEFAULT_POSITION.y,
    );
  });

  it("wide viewport (a realistic ~1440x900 window): squeezes right of the Today nav card's estimated right edge, and drops to WIDE_Y", () => {
    const wide = { width: 1440, height: 900 };
    const result = repDefaultLayout(wide, REP_PANEL_WIDTH);

    expect(result.y).toBe(WIDE_Y);

    // The panel's own left edge must clear the nav card's estimated right
    // edge (with the standard edge-margin gap) — this is the whole point
    // of the squeeze, asserted directly against the same formula
    // RepPanel.tsx uses (not a hardcoded pixel, so this can't silently
    // drift out of sync with the implementation).
    const navCardRightEstimate =
      TODAY_NAV_CARD_RIGHT_SLOPE * wide.width + TODAY_NAV_CARD_RIGHT_INTERCEPT;
    expect(result.x).toBeGreaterThanOrEqual(navCardRightEstimate);

    // Squeezed narrower than the requested width, but never below the
    // framework's own MIN_PANEL_WIDTH floor.
    expect(result.width).toBeLessThan(REP_PANEL_WIDTH);
    expect(result.width).toBeGreaterThanOrEqual(MIN_PANEL_WIDTH);

    // Still fits inside the viewport with the standard edge margin on the
    // right — the squeeze must not just move the overflow problem instead
    // of solving it.
    expect(result.x + result.width).toBeLessThanOrEqual(wide.width);
  });

  it("wide-but-narrow-for-squeezing viewport (e.g. 900px wide): not enough room right of the nav card for MIN_PANEL_WIDTH — falls back to a plain right-align, still at WIDE_Y", () => {
    const narrowWide = { width: 900, height: 900 };
    const result = repDefaultLayout(narrowWide, REP_PANEL_WIDTH);

    expect(result.y).toBe(WIDE_Y);
    // Falls back to the FULL requested width (no squeeze attempted) —
    // still right-leaning and still inside the viewport.
    expect(result.width).toBe(REP_PANEL_WIDTH);
    expect(result.x + result.width).toBeLessThanOrEqual(narrowWide.width);
    expect(result.x).toBeGreaterThanOrEqual(NAV_RAIL_WIDTH);
  });

  it("the wide tier's y clears score-workspace-head's live-measured worst case (277.95px at 820-1100px width) with margin", () => {
    // Documented in RepPanel.tsx's WIDE_Y comment — asserted here so a
    // future change to WIDE_Y can't silently regress below the measured
    // number without a test failing.
    expect(WIDE_Y).toBeGreaterThan(277.953125);
  });
});
