import { useEffect, useRef } from "react";
import { DockPanel } from "./DockPanel";
import { useDock } from "./DockProvider";
import { RepHud, type RepHudProps } from "../rep/RepHud";

/** Top-left-ish default so the panel starts clear of the nav rail and the
 * header band; the user's drag/keyboard position takes over from here on
 * (persisted via DockProvider once localStorage is available). */
const DEFAULT_POSITION = { x: 24, y: 88 };

/** RepHud is denser than the framework's 320px default (three full-width
 * verdict buttons, a streak line, a metrics grid, a drawer of secondary
 * controls) — it needs real room, not the generic panel width. Still
 * clamped to the viewport by DockPanel/clampPanelWidth, so this holds at the
 * 720x520 dense-layout floor: 720 - 2*24 = 672px available, well above 440. */
const PANEL_WIDTH = 440;

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
