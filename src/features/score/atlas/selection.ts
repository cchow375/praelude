import { replaceEditionRects } from "../anchors";
import type { PdfAnchorKind, PdfAnchorMap, PdfAnchorRect } from "../types";
import type {
  EditionIdentity,
  PersistentPdfSelectionAnchor,
} from "./model";
import type { DomainResult } from "./result";
import { failure, success } from "./result";

export const DEFAULT_MIN_NORMALIZED_SPAN = 0.005;
export const DEFAULT_MIN_NORMALIZED_AREA = 0.000_025;

export interface PageLocalPointer {
  page: number;
  x: number;
  y: number;
  page_width: number;
  page_height: number;
}

export interface DragNormalizationOptions {
  kind?: PdfAnchorKind;
  min_normalized_span?: number;
  min_normalized_area?: number;
}

export type DragError =
  | "invalid_page"
  | "invalid_geometry"
  | "cross_page_drag"
  | "selection_too_small";

export type AnchorError =
  | "invalid_edition"
  | "empty_selection"
  | "invalid_rectangle";

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function stableUnit(value: number): number {
  return Number(clampUnit(value).toFixed(6));
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validRect(rect: PdfAnchorRect): boolean {
  return (
    Number.isInteger(rect.page) &&
    rect.page >= 1 &&
    [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.w >= DEFAULT_MIN_NORMALIZED_SPAN &&
    rect.h >= DEFAULT_MIN_NORMALIZED_SPAN &&
    rect.w * rect.h >= DEFAULT_MIN_NORMALIZED_AREA &&
    rect.x + rect.w <= 1.000_001 &&
    rect.y + rect.h <= 1.000_001 &&
    (rect.kind === undefined || ["box", "highlight", "note"].includes(rect.kind))
  );
}

/** Compatibility adapter for the existing immutable `region.pdf_anchor` v1 envelope. */
export function selectionAnchorToPdfAnchorMap(
  anchor: PersistentPdfSelectionAnchor,
  existing: unknown = null,
): PdfAnchorMap {
  return replaceEditionRects(
    existing,
    anchor.edition_id,
    anchor.edition_fingerprint,
    anchor.rects,
  );
}

/**
 * Converts a drag expressed in the rendered page's local pixels into one
 * normalized rectangle. Cross-page drags are rejected explicitly instead of
 * inventing intermediate page coverage.
 */
export function normalizePageLocalDrag(
  start: PageLocalPointer,
  end: PageLocalPointer,
  options: DragNormalizationOptions = {},
): DomainResult<PdfAnchorRect, DragError> {
  if (
    !Number.isInteger(start.page) ||
    !Number.isInteger(end.page) ||
    start.page < 1 ||
    end.page < 1
  ) {
    return failure("invalid_page", "A score selection needs a positive PDF page number.");
  }
  if (start.page !== end.page) {
    return failure(
      "cross_page_drag",
      "A single score drag cannot cross PDF pages; create one rectangle per page.",
    );
  }
  if (
    ![start.x, start.y, end.x, end.y].every(Number.isFinite) ||
    !finitePositive(start.page_width) ||
    !finitePositive(start.page_height) ||
    !finitePositive(end.page_width) ||
    !finitePositive(end.page_height)
  ) {
    return failure("invalid_geometry", "The rendered page geometry is not finite and positive.");
  }

  // Each point is normalized with the viewport geometry that produced it.
  // This remains correct if a caller replays the same physical selection at a
  // different zoom, and does not persist any render-scale pixels.
  const startX = clampUnit(start.x / start.page_width);
  const startY = clampUnit(start.y / start.page_height);
  const endX = clampUnit(end.x / end.page_width);
  const endY = clampUnit(end.y / end.page_height);
  const x = stableUnit(Math.min(startX, endX));
  const y = stableUnit(Math.min(startY, endY));
  const right = stableUnit(Math.max(startX, endX));
  const bottom = stableUnit(Math.max(startY, endY));
  const width = stableUnit(right - x);
  const height = stableUnit(bottom - y);
  const minSpan = options.min_normalized_span ?? DEFAULT_MIN_NORMALIZED_SPAN;
  const minArea = options.min_normalized_area ?? DEFAULT_MIN_NORMALIZED_AREA;

  if (
    !Number.isFinite(minSpan) ||
    !Number.isFinite(minArea) ||
    minSpan < 0 ||
    minArea < 0 ||
    width < minSpan ||
    height < minSpan ||
    width * height < minArea
  ) {
    return failure(
      "selection_too_small",
      "Drag a visible score area rather than a click-sized point.",
    );
  }

  return success({
    page: start.page,
    x,
    y,
    w: width,
    h: height,
    ...(options.kind && options.kind !== "box" ? { kind: options.kind } : {}),
  });
}

export function createPersistentSelectionAnchor(
  edition: EditionIdentity,
  rects: PdfAnchorRect[],
): DomainResult<PersistentPdfSelectionAnchor, AnchorError> {
  const editionId = edition.edition_id.trim();
  const fingerprint = edition.edition_fingerprint.trim();
  if (!editionId || !fingerprint) {
    return failure(
      "invalid_edition",
      "A persistent score selection must name its edition and content fingerprint.",
    );
  }
  if (rects.length === 0) {
    return failure("empty_selection", "A persistent score selection needs at least one rectangle.");
  }
  if (!rects.every(validRect)) {
    return failure("invalid_rectangle", "A score rectangle falls outside normalized page bounds.");
  }
  return success({
    schema_version: 1,
    edition_id: editionId,
    edition_fingerprint: fingerprint,
    rects: rects.map((rect) => ({ ...rect })),
  });
}

export function dragToPersistentSelection(
  start: PageLocalPointer,
  end: PageLocalPointer,
  edition: EditionIdentity,
  options: DragNormalizationOptions = {},
): DomainResult<PersistentPdfSelectionAnchor, DragError | AnchorError> {
  const rect = normalizePageLocalDrag(start, end, options);
  if (!rect.ok) return rect;
  return createPersistentSelectionAnchor(edition, [rect.value]);
}
