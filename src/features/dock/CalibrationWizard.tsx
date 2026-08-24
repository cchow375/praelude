import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../ui";
import {
  DYNAMIC_LABELS,
  LABEL_MAX_CHARS,
  medianDb,
  validateLabel,
  validateMonotonic,
  type CalibrationPoint,
} from "./calibration";

/**
 * The pp→ff calibration wizard (Plan B, task B2).
 *
 * A view INSIDE the dynamics dock panel, not a Settings page — Settings is
 * untouched by this feature. The user plays each dynamic in turn and presses
 * Capture; the wizard collects two seconds of `rms_db` off the already-running
 * `dynamics://level` stream and stores that window's MEDIAN, so one accidental
 * bang cannot decide a calibrated level.
 *
 * THE LAW: loudness only. The wizard reads dB figures and writes dB figures.
 * It never grades the playing and never judges whether a dynamic was "right".
 *
 * The level stream arrives as a `subscribe` prop rather than through a Tauri
 * seam, so this component is testable without a backend and has no opinion
 * about where levels come from.
 */

/** 2 seconds at the meter's 8 Hz tick. */
export const CAPTURE_EVENT_COUNT = 16;

export interface CalibrationWizardProps {
  /** Subscribe to the live rms_db stream; returns an unsubscribe function. */
  levelStream: (fn: (rmsDb: number) => void) => () => void;
  /** Called only with a validated label and a validated five-point curve. */
  onSave: (label: string, points: CalibrationPoint[]) => void | Promise<void>;
  onCancel: () => void;
}

export function CalibrationWizard({
  levelStream,
  onSave,
  onCancel,
}: CalibrationWizardProps) {
  const [points, setPoints] = useState<CalibrationPoint[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The in-flight capture window. A ref, not state: a 16-sample accumulation
  // must not re-render the panel sixteen times, and the subscription below is
  // installed once for the wizard's whole life.
  const windowRef = useRef<number[] | null>(null);

  useEffect(() => {
    const unsubscribe = levelStream((rmsDb) => {
      const collecting = windowRef.current;
      if (!collecting) return;
      collecting.push(rmsDb);
      if (collecting.length < CAPTURE_EVENT_COUNT) return;
      const measured = medianDb(collecting);
      windowRef.current = null;
      setCapturing(false);
      setPoints((previous) => {
        if (previous.length >= DYNAMIC_LABELS.length) return previous;
        return [
          ...previous,
          {
            dynamic_label: DYNAMIC_LABELS[previous.length],
            measured_db: measured,
          },
        ];
      });
    });
    return () => {
      windowRef.current = null;
      unsubscribe();
    };
  }, [levelStream]);

  const startCapture = useCallback(() => {
    setError(null);
    windowRef.current = [];
    setCapturing(true);
  }, []);

  const restart = useCallback(() => {
    windowRef.current = null;
    setCapturing(false);
    setPoints([]);
    setError(null);
  }, []);

  const done = points.length >= DYNAMIC_LABELS.length;
  const currentLabel = done
    ? DYNAMIC_LABELS[DYNAMIC_LABELS.length - 1]
    : DYNAMIC_LABELS[points.length];
  const stepNumber = Math.min(points.length + 1, DYNAMIC_LABELS.length);

  const save = useCallback(() => {
    const labelProblem = validateLabel(label);
    if (labelProblem) {
      setError(labelProblem);
      return;
    }
    const curveProblem = validateMonotonic(points);
    if (curveProblem) {
      setError(curveProblem);
      return;
    }
    setError(null);
    void onSave(label.trim(), points);
  }, [label, onSave, points]);

  return (
    <div className="dynamics-wizard">
      <p className="dynamics-wizard-step">
        Step <span data-testid="wizard-step">{stepNumber}</span> of{" "}
        {DYNAMIC_LABELS.length}
      </p>

      {done ? (
        <p className="dynamics-wizard-prompt">
          All five captured. Name this profile.
        </p>
      ) : (
        <p className="dynamics-wizard-prompt">
          Play {currentLabel}, then capture two seconds of it.
        </p>
      )}

      <ol className="dynamics-wizard-points">
        {DYNAMIC_LABELS.map((dynamic, index) => {
          const captured = points[index];
          return (
            <li
              key={dynamic}
              className={
                captured
                  ? "dynamics-wizard-point dynamics-wizard-point--done"
                  : "dynamics-wizard-point"
              }
            >
              <span className="dynamics-wizard-point-label">{dynamic}</span>
              <span className="dynamics-wizard-point-db">
                {captured ? `${captured.measured_db.toFixed(1)} dB` : "—"}
              </span>
            </li>
          );
        })}
      </ol>

      {!done && (
        <Button type="button" onClick={startCapture} disabled={capturing}>
          {capturing ? `Capturing ${currentLabel}…` : `Capture ${currentLabel}`}
        </Button>
      )}

      {done && (
        <div className="dynamics-wizard-name">
          <label htmlFor="dynamics-profile-name">Profile name</label>
          <input
            id="dynamics-profile-name"
            className="ck-input"
            type="text"
            maxLength={LABEL_MAX_CHARS}
            placeholder="Steinway, living room, lid half"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
      )}

      {error && (
        <p className="dynamics-wizard-error" role="alert">
          {error}
        </p>
      )}

      <div className="dynamics-wizard-controls">
        {done && (
          <Button type="button" variant="primary" onClick={save}>
            Save profile
          </Button>
        )}
        <Button type="button" variant="text" onClick={restart}>
          Start again
        </Button>
        <Button type="button" variant="text" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
