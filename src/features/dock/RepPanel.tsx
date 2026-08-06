import { useEffect, useRef } from "react";
import { DockPanel } from "./DockPanel";
import { useDock } from "./DockProvider";
import {
  DENSE_LAYOUT_FLOOR,
  dockPanelMaxHeight,
  NAV_RAIL_WIDTH,
} from "./dockState";
import { RepHud, type RepHudProps } from "../rep/RepHud";

/** Fix wave item 9: the previous `x: 24` sat INSIDE the 148px-wide nav rail
 * (shell.css), so an auto-opened rep panel covered it. `NAV_RAIL_WIDTH + s-3`
 * clears the rail with a small gap; `y: 16` keeps it near the top, clear of
 * the header band. Exported so the default-layout test (dockDefaultLayout.
 * test.ts) can check it against the other panels' defaults without
 * duplicating the numbers. */
export const DEFAULT_POSITION = { x: NAV_RAIL_WIDTH + 12, y: 16 };

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
    </DockPanel>
  );
}
