import { useEffect, useMemo, useRef } from "react";
import { DockPanel } from "./DockPanel";
import { useDock } from "./DockProvider";
import {
  DENSE_LAYOUT_FLOOR,
  MIN_PANEL_WIDTH,
  NAV_RAIL_WIDTH,
  PANEL_WIDTH_EDGE_MARGIN,
  clampPanelWidth,
  dockPanelMaxHeight,
  type Size,
} from "./dockState";
import { RepHud, type RepHudProps } from "../rep/RepHud";

/** Fix wave item 9: the previous `x: 24` sat INSIDE the 148px-wide nav rail
 * (shell.css), so an auto-opened rep panel covered it. `NAV_RAIL_WIDTH + s-3`
 * clears the rail with a small gap. Exported so the default-layout test
 * (dockDefaultLayout.test.ts) can check it against the other panels'
 * defaults without duplicating the numbers.
 *
 * Real-use fix wave (item 4), round 2 (round 1's `y: 340` was REJECTED on
 * review): `y` was `16` — `docs/qa/final-02-overlap-check.png` (a 720x520
 * capture, this fix's dense-layout floor) shows the exact defect: the rep
 * panel's title bar landing on the session header's "End my day" button.
 * `.shell-topbar` (session bar, incl. "End my day") is the one interactive
 * band present on EVERY tab — live-measured (dev:mock, 720px viewport,
 * `getBoundingClientRect`) at 0 - 99.5px. `y: 108` clears it (99.5 +
 * `--s-2` (8px) spacing token ~= 108).
 *
 * Round 1 picked `y: 340` to ALSO clear the Score tab's always-rendered
 * `.score-workspace-head` (123.5 - 330px at this floor) — but at y:340 the
 * rep panel's own real box (340 - 504, live-measured) fully overlaps the
 * Today tab's own interactive nav card (`nav[aria-label="Main menu"]`,
 * live-measured 373 - 681px, x 208-660) AND, once a second panel (e.g.
 * Clock) opens, the two panels' boxes fully overlap each other (rep
 * 340-504 vs Clock's fixed viewport-clamped landing at 360-520 — see
 * `dockOpenClamp.test.tsx`'s round-2 comment on `resolveCollision`: a
 * silently-overlapped panel is the DOCUMENTED, INTENTIONAL tradeoff over
 * squeezing below `MIN_VISIBLE_ON_OPEN_PX`). Both are real regressions
 * `y: 16` never had (rep 16-282 vs Today's nav card 373-681: no overlap;
 * vs Clock's 360-520 landing: 78px of clear gap).
 *
 * `y: 108` was chosen to fix the shell-topbar defect (the one CONCRETELY
 * evidenced, present-on-every-tab regression) while minimizing the same
 * two side effects:
 *   - Today's nav card (373-681, x208-660): rep's box (108-374, x160-600)
 *     grazes it by under 1px — negligible next to round 1's full overlap.
 *   - Clock's fixed 360-520 landing when opened alongside rep: rep's box
 *     (108-374) overlaps it by 14px (title bar only) — a small, PROVABLY
 *     UNAVOIDABLE side effect of clearing the topbar at this exact floor:
 *     rep's own real height saturates at 300px for any y <= 204 (see
 *     `dockPanelMaxHeight`), so its bottom edge is `y + 300`; Clock's
 *     landing is fixed at `520 - MIN_VISIBLE_ON_OPEN_PX(160) = 360`
 *     regardless of rep's position (confirmed identical — y:360 — across
 *     y:16/108/340 live tests). Zero overlap needs `y <= 60`; clearing the
 *     topbar needs `y >= ~100`. No y satisfies both at this floor.
 *   - `.score-workspace-head`/`.score-toolbar` on the Score tab (123.5-330,
 *     360.75-517.75) are NOT cleared by y:108 either — round 1's attempt to
 *     clear them was what caused the regressions above, and even a y that
 *     cleared `.score-workspace-head` alone still could not clear
 *     `.score-toolbar` too (its own bottom edge, 517.75, leaves no room in
 *     a 520px-tall viewport for a usable panel below it). This is a
 *     structural property of ScoreWorkspace's always-rendered head (piece
 *     picker + metronome, independent of this fix), not something a
 *     default-position offset can solve at this floor.
 * The panel is still freely draggable and, as of this fix wave, resettable
 * (SettingsPanel's "Reset panel layout") wherever it lands. See
 * dockDefaultLayout.test.ts for the assertions and the full pre/post
 * measurement table in task-4-report.md. */
export const DEFAULT_POSITION = { x: NAV_RAIL_WIDTH + 12, y: 108 };

/** RepHud is denser than the framework's 320px default (three full-width
 * verdict buttons, a streak line, a metrics grid, a drawer of secondary
 * controls) — it needs real room, not the generic panel width. Still
 * clamped to the viewport by DockPanel/clampPanelWidth, so this holds at the
 * 720x520 dense-layout floor: 720 - 2*24 = 672px available, well above 440. */
export const PANEL_WIDTH = 440;

/** Real-use fix wave (item 4), round 3 (round 2's fixed `x: NAV_RAIL_WIDTH +
 * 12` was found insufficient on further review): at a realistic ~1440x900
 * window, a LEFT-aligned rep panel — even at round 2's topbar-clearing
 * `y: 108` — still covers the Score tab's own head (title, Score/Plan tabs,
 * piece picker, metronome), because `.score-workspace-head` spans nearly
 * the FULL content width there, so no horizontal shift alone clears it.
 * `nav[aria-label="Main menu"]` (the Today tab's own nav card), by
 * contrast, is a CENTERED, narrower element (live-measured x 208-660 at
 * 720px, x 554-1034 at 1440px) — a right-aligned x clears it at wide
 * viewports, where there's real room to shift into.
 *
 * Below `WIDE_VIEWPORT_BREAKPOINT` there isn't enough width to escape
 * either blocker this way (round 2's report already proved no y clears the
 * 720x520 floor's score toolbar without regressing elsewhere) — so this
 * tier keeps round 2's y (`DEFAULT_POSITION.y`, 108) and only makes x lean
 * right by however much room a 440px-wide panel actually has, via the SAME
 * `clampPanelWidth` DockPanel's own render and drag-clamp already use (so
 * default, mount re-clamp, and drag can never disagree on what fits).
 *
 * A `viewport: undefined` falls back to `DEFAULT_POSITION` outright — pure,
 * no guessing, and exactly what a test with no real window should get. */
export const WIDE_VIEWPORT_BREAKPOINT = 820;

/** Live-measured (dev:mock, 900px-tall viewport, `getBoundingClientRect`)
 * `.score-workspace-head` (title/tabs/piece-picker/metronome — the "score
 * head" this tier is built to clear) bottom edge across the WIDE tier:
 * 277.95px at 820-1100px width, 217.8px at >=1120px. `WIDE_Y` clears the
 * TALLER (820-1100px) case with the same `--s-2`-ish margin
 * `DEFAULT_POSITION.y` uses for the topbar.
 *
 * Deliberately does NOT also try to clear `.score-toolbar` right below the
 * head (live-measured 330.8px at >=1250px up to 467.9px at the WIDE tier's
 * own narrow edge, 820px) — a `y` tall enough for THAT (~488) pushes a
 * squeezed-width panel's real content (live-measured ~507px tall at the
 * narrowed 358px width the nav-card escape produces at 1440px) past the
 * dock pill bar's top edge (857px at a 900px-tall viewport) — the ONE
 * clearance this fix is explicitly required to guarantee, since the pill
 * bar is real, always-present shell chrome (unlike the toolbar, which
 * scrolls out of view with the rest of the score page). `WIDE_Y: 288`
 * keeps the panel's real content comfortably above the pill bar
 * (live-confirmed bottom 795px vs pill-bar top 857px, 1440x900) at the cost
 * of a small residual overlap with `.score-toolbar` alone — see
 * task-4-report.md for the full enumeration and why this is the accepted
 * tradeoff, not an oversight. */
export const WIDE_Y = 288;

/** Round 3, part 2: `WIDE_Y` alone still lands the panel's full x-range on
 * top of the Today tab's own nav card at a realistic width — live-measured
 * (dev:mock, 900px-tall viewport) `nav[aria-label="Main menu"]`'s right
 * edge is a near-PERFECT linear function of viewport width once its column
 * hits its `max-width: 30rem` (480px) cap (verified exactly at 7 widths:
 * 820/900/1000/1100/1200/1300/1440 -> right edges 724/764/814/864/914/964/
 * 1034 — every single one matches `0.5 * width + 314` to sub-pixel
 * precision). Below `WIDE_VIEWPORT_BREAKPOINT` the column isn't at its cap
 * yet (measured 720px -> 452px column, narrower than 480), so this formula
 * is only valid at/above that breakpoint — exactly where it's used below. */
export const TODAY_NAV_CARD_RIGHT_SLOPE = 0.5;
export const TODAY_NAV_CARD_RIGHT_INTERCEPT = 314;

/** Pure function of the viewport (+ requested panel width) — no DOM access,
 * so it stays unit-testable (dockDefaultLayout.test.ts) exactly like
 * `clampPanelWidth`/`dockPanelMaxHeight` it's built from. `RepPanel` below
 * calls this with the real `window.innerWidth/innerHeight` at mount time;
 * every other caller (tests, the tray/clock chain) can pass an explicit
 * viewport or omit it for the `DEFAULT_POSITION` fallback.
 *
 * Returns `width` alongside `x`/`y` (round 3): at a realistic wide window
 * (e.g. 1440x900), simply right-aligning the FULL `requestedWidth` still
 * doesn't clear the Today nav card (its right edge, ~1034px at 1440, is
 * still well inside a 440-wide panel's right-aligned x-range) — the panel
 * only clears it by fitting entirely to nav card's right, which needs a
 * NARROWER box (~358px at 1440, still `>= MIN_PANEL_WIDTH`). This mirrors
 * `defaultPosition` itself: chosen once at mount from the real viewport,
 * not reactive to a later resize — a user dragging the panel afterward is
 * unaffected (drag only ever changes x/y, never width, in this framework).
 * If there genuinely isn't room to squeeze past the nav card without
 * dropping below `MIN_PANEL_WIDTH` (viewports narrower than
 * `WIDE_VIEWPORT_BREAKPOINT` roughly up to ~1124px), this falls back to a
 * plain right-align at the requested width — grazing the nav card there is
 * the same, already-documented, structural tradeoff as round 2's floor. */
export function repDefaultLayout(
  viewport: Size | undefined,
  requestedWidth: number = PANEL_WIDTH,
): { x: number; y: number; width: number } {
  if (!viewport) {
    return { ...DEFAULT_POSITION, width: requestedWidth };
  }

  if (viewport.width < WIDE_VIEWPORT_BREAKPOINT) {
    // Unchanged from round 2 (x: NAV_RAIL_WIDTH + 12, y: DEFAULT_POSITION.y)
    // — deliberately NOT applying a right-lean here too: it wouldn't help
    // (the Today nav card already spans this whole x-range regardless of
    // where in it the panel sits at this width) and would only add an
    // unnecessary behavior change on top of round 2's already-verified
    // "no worse than before" floor. `width` is left as `requestedWidth`
    // unclamped — DockPanel's own render already reclamps it against the
    // live viewport width on every render (`clampPanelWidth` again,
    // internally), so there is nothing this function needs to pre-clamp
    // for a value that gets reclamped downstream anyway.
    return { x: DEFAULT_POSITION.x, y: DEFAULT_POSITION.y, width: requestedWidth };
  }

  const navCardRight =
    TODAY_NAV_CARD_RIGHT_SLOPE * viewport.width + TODAY_NAV_CARD_RIGHT_INTERCEPT;
  const minX = navCardRight + PANEL_WIDTH_EDGE_MARGIN;
  const maxRight = viewport.width - PANEL_WIDTH_EDGE_MARGIN;
  const squeezeAvailable = maxRight - minX;

  if (squeezeAvailable >= MIN_PANEL_WIDTH) {
    const width = Math.min(requestedWidth, squeezeAvailable);
    return { x: minX, y: WIDE_Y, width };
  }

  // Not enough room right of the nav card at this width without breaking
  // MIN_PANEL_WIDTH — fall back to a plain right-align at the requested
  // width. Still clears the topbar and (via WIDE_Y) the score-tab head.
  const width = clampPanelWidth(requestedWidth, viewport.width);
  const x = Math.max(
    NAV_RAIL_WIDTH + 12,
    viewport.width - width - PANEL_WIDTH_EDGE_MARGIN,
  );
  return { x, y: WIDE_Y, width };
}

/** Residuals fix wave (defect 2, "rep panel overlaps tray"): this used to be
 * a documented GUESS at RepHud's real rendered height (260px) — live QA
 * showed the real expanded drawer (verdict buttons + streak line + metrics
 * grid + drawer) is ~450-500px, well past that guess, which is what let an
 * auto-opened rep panel run into the paused-sets tray's default position.
 * It is no longer a guess: `.dock-panel`'s CSS `max-height` (dock.css)
 * ENFORCES this ceiling — content past it scrolls internally
 * (`.dock-panel-body { overflow-y: auto }`) instead of growing outward — so
 * this constant and the real rendered height can never disagree. */
export const ASSUMED_MAX_HEIGHT = dockPanelMaxHeight(
  DENSE_LAYOUT_FLOOR.height,
  DEFAULT_POSITION.y,
);

/**
 * Task A3: the rep HUD's shell-level dock host. RepHud's own render/logic is
 * untouched (verdict buttons, streak, rung-celebration hold, IPC calls) — this
 * only relocates WHERE it mounts, from the in-flow shell strip / Today's-
 * Practice window strip into a persistent floating dock panel that survives
 * every workspace tab.
 *
 * Auto-opens on the inactive -> active transition of the rep engine's own
 * `set_state` (never on every render), so a panel the user minimized mid-set
 * stays minimized. Shows a subdued empty state when no set is active.
 */
export function RepPanel(props: RepHudProps) {
  const dock = useDock("rep");
  const wasActive = useRef(false);

  useEffect(() => {
    const isActive = props.snap?.set_state === "active";
    if (isActive && !wasActive.current) {
      dock.open();
    }
    wasActive.current = isActive;
    // Fire only on a genuine set_state transition — including `dock` (whose
    // identity is unstable across renders) would defeat the "not on every
    // render" requirement even though the wasActive guard makes it harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.snap?.set_state]);

  // Computed once per mount (empty deps) — DockPanel's own `ensurePanel`
  // effect only ever registers a NEW panel's position once too (its `[id]`
  // dependency), so recomputing this on every render would just be a
  // discarded value; freezing it here makes that explicit instead of
  // relying on the callee's own guard. `window` always exists in this
  // Tauri/browser app; the `typeof` guard only matters for
  // `repDefaultLayout`'s own unit tests, which pass `undefined` on purpose
  // to exercise the fallback. `width` (not just x/y) comes from the same
  // computation at a wide viewport (see `repDefaultLayout`'s doc comment) —
  // a later window resize doesn't reactively re-narrow it, same as
  // `defaultPosition` itself; both are "how this panel starts", not a
  // live-tracked value.
  const { x, y, width } = useMemo(
    () =>
      repDefaultLayout(
        typeof window === "undefined"
          ? undefined
          : { width: window.innerWidth, height: window.innerHeight },
        PANEL_WIDTH,
      ),
    [],
  );

  return (
    <DockPanel id="rep" title="Rep Counter" defaultPosition={{ x, y }} width={width}>
      {props.snap ? (
        <RepHud {...props} />
      ) : (
        <p className="dock-empty-state">No active set</p>
      )}
    </DockPanel>
  );
}
