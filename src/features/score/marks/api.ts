import { invoke } from "@tauri-apps/api/core";
import type { Stroke } from "./strokes";
import { strokePayload } from "./strokes";

/** One page's marks as the store returns them. */
export interface PageMarks {
  marks: Stroke[];
  /**
   * How many strokes this piece+edition holds under a DIFFERENT file
   * fingerprint — work drawn before the file behind the edition changed. Those
   * rows are kept, not deleted; they are simply not shown over page geometry
   * they may no longer fit. Non-zero means the UI owes the reader a notice.
   */
  staleMarks: number;
}

/** Edition identity a mark is bound to. Both halves are part of the key. */
export interface MarkEdition {
  id: string;
  fingerprint: string;
}

export interface ScoreMarksApi {
  page: (
    pieceId: number,
    edition: MarkEdition,
    page: number,
  ) => Promise<PageMarks>;
  add: (
    pieceId: number,
    edition: MarkEdition,
    stroke: Stroke,
  ) => Promise<Stroke>;
  undo: (
    pieceId: number,
    edition: MarkEdition,
    page: number,
  ) => Promise<number | null>;
  clearPage: (
    pieceId: number,
    edition: MarkEdition,
    page: number,
  ) => Promise<number>;
}

interface RawMark {
  id: number;
  page: number;
  width: number;
  points: Array<{ x: number; y: number }>;
}

function toStroke(raw: RawMark): Stroke {
  return {
    id: raw.id,
    page: raw.page,
    width: raw.width,
    points: raw.points.map((point) => ({ x: point.x, y: point.y })),
  };
}

export const defaultMarksApi: ScoreMarksApi = {
  page: async (pieceId, edition, page) => {
    const result = await invoke<{ marks: RawMark[]; stale_marks: number }>(
      "score_marks_page",
      {
        pieceId,
        editionId: edition.id,
        editionFingerprint: edition.fingerprint,
        page,
      },
    );
    return {
      marks: (result?.marks ?? []).map(toStroke),
      staleMarks: result?.stale_marks ?? 0,
    };
  },
  add: async (pieceId, edition, stroke) => {
    const payload = strokePayload(stroke);
    const saved = await invoke<RawMark>("score_mark_add", {
      pieceId,
      editionId: edition.id,
      editionFingerprint: edition.fingerprint,
      page: payload.page,
      width: payload.width,
      pointsJson: payload.points_json,
    });
    return toStroke(saved);
  },
  undo: (pieceId, edition, page) =>
    invoke<number | null>("score_mark_undo", {
      pieceId,
      editionId: edition.id,
      editionFingerprint: edition.fingerprint,
      page,
    }),
  clearPage: (pieceId, edition, page) =>
    invoke<number>("score_marks_clear_page", {
      pieceId,
      editionId: edition.id,
      editionFingerprint: edition.fingerprint,
      page,
    }),
};
