/**
 * Calibration math and validation for the pp→ff dynamics wizard (Plan B, B2).
 *
 * THE LAW: loudness only. Everything here operates on dB numbers. There is no
 * pitch, no onset, no note, no grade and no verdict anywhere in this file.
 *
 * `validateMonotonic` mirrors the Rust `validate_points`
 * (`src-tauri/src/store/dynamics_profiles.rs`) message for message, so the
 * wizard can reject a bad capture BEFORE the round-trip and the user reads the
 * same sentence whichever side caught it.
 */

export const DYNAMIC_LABELS = ["pp", "p", "mf", "f", "ff"] as const;
export type DynamicLabel = (typeof DYNAMIC_LABELS)[number];

export interface CalibrationPoint {
  dynamic_label: DynamicLabel;
  measured_db: number;
}

export interface DynamicsProfile {
  id: number;
  device_id: string;
  label: string;
  active: boolean;
  created_at: string;
  points: CalibrationPoint[];
}

/** Free-text profile label bounds, mirroring the Rust side. */
export const LABEL_MAX_CHARS = 120;

/** Median of a capture window. Even-length windows average the two middles.
 *
 * Median, never mean: one accidental bang inside a two-second capture must not
 * drag the calibrated level for that dynamic. */
export function medianDb(samples: number[]): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Format a dB figure the way both sides of the seam do: one decimal place. */
function db(value: number): string {
  return value.toFixed(1);
}

/**
 * Reject anything that is not five points, correctly labelled, in order, and
 * STRICTLY increasing. Returns `null` when the curve is good, otherwise the
 * exact message the backend would have produced.
 */
export function validateMonotonic(points: CalibrationPoint[]): string | null {
  if (points.length !== DYNAMIC_LABELS.length) {
    return `Calibration needs all five steps (${DYNAMIC_LABELS.join(
      ", ",
    )}), but got ${points.length}. Start again from pp.`;
  }

  for (let index = 0; index < points.length; index += 1) {
    const want = DYNAMIC_LABELS[index];
    const point = points[index];
    if (point.dynamic_label !== want) {
      return `Calibration step ${index + 1} must be labelled "${want}", but got "${
        point.dynamic_label
      }". The five steps are ${DYNAMIC_LABELS.join(", ")} in that order.`;
    }
    if (!Number.isFinite(point.measured_db)) {
      return `Calibration step ${want} has no usable level reading. Recapture ${want}.`;
    }
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (current.measured_db <= previous.measured_db) {
      return `Calibration must get louder at every step, but ${
        current.dynamic_label
      } (${db(current.measured_db)} dB) is not louder than ${
        previous.dynamic_label
      } (${db(previous.measured_db)} dB). Recapture ${
        current.dynamic_label
      }, or start again from pp.`;
    }
  }

  return null;
}

/** The label rule, mirrored from Rust. Returns `null` when the label is fine. */
export function validateLabel(label: string): string | null {
  const trimmed = label.trim();
  if (trimmed.length < 1) {
    return "A profile needs a name — which piano, which room, which lid position.";
  }
  if ([...trimmed].length > LABEL_MAX_CHARS) {
    return `A profile name may be at most ${LABEL_MAX_CHARS} characters; that one is ${
      [...trimmed].length
    }.`;
  }
  return null;
}

/** The one active profile out of a list, or `null` when nothing is calibrated. */
export function activeProfile(
  profiles: DynamicsProfile[],
): DynamicsProfile | null {
  return profiles.find((p) => p.active) ?? null;
}

/**
 * Where `db` sits on the calibrated band: 0 at the pp tick (bottom), 1 at the
 * ff tick (top), piecewise-linear between the five measured points.
 *
 * The clamp to 0..1 is a DISPLAY concern and nothing else. Core Audio float
 * input is not hard-clipped at ±1.0 — readings above 0 dBFS are real and were
 * measured on the target machine — and playing louder than the calibrated `ff`
 * is entirely normal. Neither is an error; both simply pin the needle to the
 * top of the band.
 */
export function bandFraction(db: number, profile: DynamicsProfile): number {
  const points = profile.points;
  if (points.length < 2) return 0;
  if (!Number.isFinite(db)) return 0;
  const step = 1 / (points.length - 1);
  if (db <= points[0].measured_db) return 0;
  const last = points[points.length - 1];
  if (db >= last.measured_db) return 1;
  for (let i = 1; i < points.length; i += 1) {
    const low = points[i - 1].measured_db;
    const high = points[i].measured_db;
    if (db <= high) {
      const t = high === low ? 0 : (db - low) / (high - low);
      return (i - 1 + t) * step;
    }
  }
  return 1;
}
