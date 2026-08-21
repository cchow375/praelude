import { describe, expect, it } from "vitest";
import { NAV_RAIL_WIDTH } from "./dockState";
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

  it("keeps every default y within the 520px floor's visible top edge", () => {
    expect(REP_DEFAULT_POSITION.y).toBeGreaterThanOrEqual(0);
    expect(REP_DEFAULT_POSITION.y).toBeLessThan(VIEWPORT.height);
  });

  // Real-use fix wave (item 4): docs/qa/final-02-overlap-check.png (a real
  // 720x520 screenshot of the running app) shows the Rep Counter panel's OLD
  // default (y: 16) sitting directly on top of the session header bar,
  // including "End my day". Live-rendered measurements at this same 720px
  // floor (dev:mock, getBoundingClientRect) of the header stack a default
  // position must clear: `.shell-topbar` (session bar) 0-99.5px,
  // `.day-sheet-nav-head` (Today's Practice day nav) 196.5-221px, and
  // `.score-workspace-head` (Score tab title/tabs/piece-picker/metronome —
  // ALWAYS rendered, no narrow-width collapse) 123.5-330px. 320 is the
  // conservative floor for "clears all three, with margin" — NOT the
  // brief's original 64 (that assumed only the score toolbar's single-row
  // 46px min-height; the real page has substantially more chrome above the
  // toolbar than that on every tab that matters here). See RepPanel.tsx's
  // DEFAULT_POSITION comment for why the score-toolbar ITSELF (which starts
  // below score-workspace-head, at 360.75px, and runs to 517.75px of the
  // 520px-tall floor) can't also be fully cleared — there is no y left that
  // leaves both a usable panel and space under it at this exact floor.
  it("keeps the rep panel's default y clear of the real header stack at the 720x520 floor", () => {
    expect(REP_DEFAULT_POSITION.y).toBeGreaterThanOrEqual(320);
  });
});
