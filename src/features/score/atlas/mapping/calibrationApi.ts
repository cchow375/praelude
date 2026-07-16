/**
 * Frontend seam for the score-edition calibration IPC (freeze exception #2):
 * `score_calibration_save` / `score_calibration_get` over the v8
 * `score_edition_calibration` table. This is the wizard's DURABLE memory — the
 * standalone line anchors a drawn box interpolates against.
 *
 * The Rust side owns `method` ('user_confirmed') and `confidence`; the frontend
 * only supplies the piece, edition identity, the anchor points, and whether the
 * user verified them. Points cross the wire as a JSON string of
 * `{ page, y, measure }` (y is a normalized 0–1 fraction), validated server-side.
 */
import { invoke } from "@tauri-apps/api/core";
import type { EditionIdentity } from "../model";
import type { LineAnchor } from "./anchors";

/** One stored calibration point. Mirrors the Rust `CalibrationPoint`. */
export interface CalibrationPoint {
  page: number;
  /** Normalized 0–1 vertical fraction of the system start (top = 0). */
  y: number;
  measure: number;
}

/** The frontend-facing view of one stored calibration row. */
export interface CalibrationView {
  piece_id: number;
  edition_id: string;
  edition_fingerprint: string;
  method: string;
  confidence: number;
  points: CalibrationPoint[];
  user_verified: boolean;
  updated_ts: string;
}

export interface CalibrationSaveArgs {
  pieceId: number;
  edition: EditionIdentity;
  anchors: LineAnchor[];
  userVerified: boolean;
}

/** Injectable seam so the wizard + ScoreView can be tested without Tauri. */
export interface CalibrationApi {
  save(args: CalibrationSaveArgs): Promise<CalibrationView>;
  get(
    pieceId: number,
    edition: EditionIdentity,
  ): Promise<CalibrationView | null>;
}

/** Line anchors → wire points. `yPct`/`measure`/`page` are already 0–1 / ≥1. */
export function anchorsToPoints(anchors: LineAnchor[]): CalibrationPoint[] {
  return anchors.map((anchor) => ({
    page: anchor.page,
    y: anchor.yPct,
    measure: anchor.measure,
  }));
}

/** Stored points → line anchors the interpolation engine consumes. */
export function pointsToAnchors(points: CalibrationPoint[]): LineAnchor[] {
  return points.map((point) => ({
    page: point.page,
    yPct: point.y,
    measure: point.measure,
  }));
}

export const defaultCalibrationApi: CalibrationApi = {
  save: ({ pieceId, edition, anchors, userVerified }) =>
    invoke<CalibrationView>("score_calibration_save", {
      pieceId,
      editionId: edition.edition_id,
      editionFingerprint: edition.edition_fingerprint,
      pointsJson: JSON.stringify(anchorsToPoints(anchors)),
      userVerified,
    }),
  get: (pieceId, edition) =>
    invoke<CalibrationView | null>("score_calibration_get", {
      pieceId,
      editionId: edition.edition_id,
      editionFingerprint: edition.edition_fingerprint,
    }).then((view) => view ?? null),
};
