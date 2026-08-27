import { useEffect, useRef } from "react";
import { DockPanel } from "./DockPanel";
import { useDock } from "./DockProvider";
import {
  DENSE_LAYOUT_FLOOR,
  dockPanelMaxHeight,
  NAV_RAIL_WIDTH,
} from "./dockState";
import { RepHud, type RepHudProps } from "../rep/RepHud";
import { HeardPill, type HeardDelivery } from "../voice/HeardPill";

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
 *     rep's real, live-measured box is 108-374 (height ~266px). Note this is
 *     BELOW `dockPanelMaxHeight`'s 300px ceiling for any y <= 204 — 300 is
 *     the CEILING the CSS enforces, not what RepHud's real content reaches,
 *     so its bottom edge is `y + 266`, not `y + 300`. Clock's landing is
 *     fixed at `520 - MIN_VISIBLE_ON_OPEN_PX(160) = 360` regardless of rep's
 *     position (confirmed identical — y:360 — across y:16/108/340 live
 *     tests). Zero overlap needs `y <= 94` (360 - 266); clearing the topbar
 *     needs `y >= ~100`. No y satisfies both at this floor — but by a ~6px
 *     margin, not the 40px an earlier (300px-height) version of this
 *     comment claimed.
 *   - `.score-workspace-head`/`.score-toolbar` on the Score tab (123.5-330,
 *     360.75-517.75) are NOT cleared by y:108 either — round 1's attempt to
 *     clear them was what caused the regressions above, and even a y that
 *     cleared `.score-workspace-head` alone still could not clear
 *     `.score-toolbar` too (its own bottom edge, 517.75, leaves no room in
 *     a 520px-tall viewport for a usable panel below it). This is a
 *     structural property of ScoreWorkspace's always-rendered head (piece
 *     picker + metronome, independent of this fix), not something a
 *     default-position offset can solve at this floor.
 * Round 3 tried to escape the remaining overlaps with a viewport-aware
 * right-lean (`repDefaultLayout`, `WIDE_Y`, a linear model of the Today nav
 * card's right edge). It was REFUTED by live measurement at 1440x900: the
 * panel's ENTIRE title bar landed inside `.score-toolbar`'s band and
 * `elementFromPoint` returned toolbar buttons at all three of its controls —
 * the panel rendered visually headless and unreachable from mount — and it
 * covered three `button.score-region-row` controls, one of which misfired
 * onto a `.rep-verdict` button (a click there would have RECORDED PRACTICE
 * DATA). Reverted in round 4.
 *
 * Round 4's ruling: the root defect was never the coordinates, it was the
 * STACKING ORDER — dock panels rendered at their raw focus rank (0/1), i.e.
 * BEHIND page content, so NO position was safe. That is fixed in
 * dockState.ts (`DOCK_Z_BASE`/`dockPanelZIndex`, see the stacking contract
 * comment there and dockStacking.test.ts). With panels reliably painted on
 * top, a default that overlaps the score page is an ordinary draggable,
 * resettable HUD — so this stays at the simplest value that clears the shell
 * topbar, which is round 2's `y: 108` at the original left `x`.
 *
 * The tray/clock chain no longer derives from this `y` (see
 * `DOCK_CHAIN_BASE_Y` in dockState.ts) — rounds 2-3 had pushed the clock's
 * default off the 720x520 floor as a side effect of moving rep.
 *
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
export function RepPanel({
  heardDelivery = null,
  ...props
}: RepHudProps & { heardDelivery?: HeardDelivery | null }) {
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

  return (
    <DockPanel
      id="rep"
      title="Rep Counter"
      defaultPosition={DEFAULT_POSITION}
      width={PANEL_WIDTH}
    >
      {props.snap ? (
        <RepHud {...props} />
      ) : (
        <p className="dock-empty-state">No active set</p>
      )}
      <HeardPill delivery={heardDelivery} />
    </DockPanel>
  );
}
