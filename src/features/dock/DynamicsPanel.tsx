import { useCallback, useMemo, useState } from "react";
import { DockPanel } from "./DockPanel";
import { useDock } from "./DockProvider";
import { Button } from "../../ui";
import {
  NAV_RAIL_WIDTH,
  PANEL_STACK_GAP_PX,
  PANEL_WIDTH_EDGE_MARGIN,
} from "./dockState";
import { PANEL_WIDTH as REP_PANEL_WIDTH } from "./RepPanel";
import { DEFAULT_POSITION as CLOCK_DEFAULT_POSITION } from "./ClockPanel";
import { DEFAULT_POSITION as REP_DEFAULT_POSITION } from "./RepPanel";
import { CalibrationWizard } from "./CalibrationWizard";
import {
  DYNAMIC_LABELS,
  bandFraction,
  type CalibrationPoint,
} from "./calibration";
import { useDynamics } from "./useDynamics";
import "./dock.css";

/**
 * The dynamics dock panel (Plan B, task B3): a live loudness readout mapped
 * onto the active per-piano calibration.
 *
 * THE LAW: loudness only. The panel shows dB figures and where they sit on a
 * calibrated pp→ff band. It never grades the playing, never says "wrong", and
 * never writes anything anywhere.
 *
 * The mic follows the panel: open the panel, the meter runs; close it or
 * minimize it to a pill, and the input stream is fully torn down.
 */

/** Narrow (260) because the panel is a vertical band plus one row of controls;
 * it still clears MIN_PANEL_WIDTH (200, dockState.ts:52) with room to spare. */
export const PANEL_WIDTH = 260;

/** Conservative height ceiling, same role as RepPanel's/PausedSetsTray's. */
export const ASSUMED_MAX_HEIGHT = 260;

/** The y used when the panel takes its own SECOND column beside the rep panel:
 * the same topbar-clearing 108 the rep panel uses, so `.shell-topbar` — the one
 * interactive band present on EVERY tab — is never covered, and the panel sits
 * above the score toolbar's row rather than on it. */
export const SECOND_COLUMN_Y = REP_DEFAULT_POSITION.y;

/** The y used when a second column does not fit: the clock's own live-measured
 * 504. Both panels default CLOSED, so this only ever matters once the user
 * opens both at the floor, where `resolveCollision` plus DockPanel's
 * become-visible viewport clamp settle the landing. */
export const FLOOR_FALLBACK_Y = CLOCK_DEFAULT_POSITION.y;

/** The conservative default: first column, clock's y. `dynamicsDefaultX` /
 * `dynamicsDefaultY` pick the second column when the whole panel fits there. */
export const DEFAULT_POSITION = {
  x: NAV_RAIL_WIDTH + 12,
  y: FLOOR_FALLBACK_Y,
};

/** Does the panel's own second column fit entirely on screen?
 *
 * The dock chain's first column is FULL at the 720x520 floor: rep(108) ->
 * tray(340) -> clock(504) already reaches it. So the dynamics panel takes a
 * SECOND column, beside the rep panel, whenever the whole panel fits there —
 * the exact boolean `clockDefaultX` (ClockPanel.tsx) already uses, with this
 * panel's own width. At the floor 608 + 260 + 24 = 892 > 720, so it does not
 * fit and the first column is used instead. */
function secondColumnFits(viewportWidth: number | undefined): boolean {
  if (viewportWidth === undefined) return false;
  const secondColumn =
    DEFAULT_POSITION.x + REP_PANEL_WIDTH + PANEL_STACK_GAP_PX;
  return secondColumn + PANEL_WIDTH + PANEL_WIDTH_EDGE_MARGIN <= viewportWidth;
}

export function dynamicsDefaultX(viewportWidth: number | undefined): number {
  return secondColumnFits(viewportWidth)
    ? DEFAULT_POSITION.x + REP_PANEL_WIDTH + PANEL_STACK_GAP_PX
    : DEFAULT_POSITION.x;
}

export function dynamicsDefaultY(viewportWidth: number | undefined): number {
  return secondColumnFits(viewportWidth) ? SECOND_COLUMN_Y : FLOOR_FALLBACK_Y;
}

/** How far a peak tick may sit above the needle before it is just noise. */
function formatDb(db: number | null | undefined): string {
  if (db === null || db === undefined || !Number.isFinite(db)) return "—";
  return `${db.toFixed(1)} dB`;
}

export function DynamicsPanel() {
  const dock = useDock("dynamics");
  // The mic's life is exactly the panel's visible life: a pilled (minimized)
  // panel is NOT open, so the input stream is torn down while it is pilled.
  const live = dock.isOpen && !dock.isMinimized;
  const {
    level,
    meter,
    profile,
    error,
    subscribeLevel,
    saveProfile,
  } = useDynamics(live);

  const [calibrating, setCalibrating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Computed ONCE, like ClockPanel's: `ensurePanel` only ever registers a new
  // panel's position once, so recomputing per render would be discarded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const viewportWidth = useMemo(
    () => (typeof window === "undefined" ? undefined : window.innerWidth),
    [],
  );

  const onSave = useCallback(
    async (label: string, points: CalibrationPoint[]) => {
      try {
        await saveProfile(label, points);
        setSaveError(null);
        setCalibrating(false);
      } catch (e) {
        setSaveError(typeof e === "string" ? e : String(e));
      }
    },
    [saveProfile],
  );

  const needleFraction = profile && level ? bandFraction(level.rms_db, profile) : 0;
  const peakFraction = profile && level ? bandFraction(level.peak_db, profile) : 0;

  return (
    <DockPanel
      id="dynamics"
      title="Dynamics"
      width={PANEL_WIDTH}
      defaultPosition={{
        x: dynamicsDefaultX(viewportWidth),
        y: dynamicsDefaultY(viewportWidth),
      }}
    >
      {calibrating ? (
        <CalibrationWizard
          levelStream={subscribeLevel}
          onSave={onSave}
          onCancel={() => {
            setSaveError(null);
            setCalibrating(false);
          }}
        />
      ) : (
        <div className="dynamics-panel">
          <p className="dynamics-panel-profile" data-testid="dynamics-profile">
            {profile ? profile.label : "Not calibrated"}
          </p>

          {profile ? (
            <div
              className="dynamics-panel-band"
              data-testid="dynamics-band"
              role="img"
              aria-label={`Loudness ${formatDb(level?.rms_db)} on the ${profile.label} band`}
            >
              {DYNAMIC_LABELS.map((dynamic, index) => {
                const fraction = index / (DYNAMIC_LABELS.length - 1);
                return (
                  <div
                    key={dynamic}
                    className="dynamics-panel-tick"
                    data-testid={`dynamics-tick-${dynamic}`}
                    data-fraction={fraction.toFixed(4)}
                    style={{ bottom: `${fraction * 100}%` }}
                  >
                    <span className="dynamics-panel-tick-label">{dynamic}</span>
                  </div>
                );
              })}
              <div
                className="dynamics-panel-peak"
                data-testid="dynamics-peak"
                data-fraction={peakFraction.toFixed(4)}
                style={{ bottom: `${peakFraction * 100}%` }}
              />
              <div
                className="dynamics-needle"
                data-testid="dynamics-needle"
                data-fraction={needleFraction.toFixed(4)}
                style={{ bottom: `${needleFraction * 100}%` }}
              />
            </div>
          ) : (
            <p className="dynamics-panel-uncalibrated">
              No calibration for this piano yet, so there is no band to place
              this level on. The raw level is honest; a band would be a guess.
            </p>
          )}

          <p className="dynamics-panel-readout" data-testid="dynamics-readout">
            {formatDb(level?.rms_db)}
          </p>
          <p className="dynamics-panel-peak-readout">
            peak {formatDb(level?.peak_db)}
          </p>

          {!meter.has_input_device && (
            <p className="dynamics-panel-error" role="alert">
              No microphone is available, so there is nothing to measure.
            </p>
          )}
          {(error || saveError) && (
            <p className="dynamics-panel-error" role="alert">
              {saveError ?? error}
            </p>
          )}

          <div className="dynamics-panel-controls">
            <Button
              type="button"
              variant={profile ? "text" : "primary"}
              onClick={() => setCalibrating(true)}
            >
              {profile ? "Recalibrate" : "Calibrate"}
            </Button>
          </div>
        </div>
      )}
    </DockPanel>
  );
}
