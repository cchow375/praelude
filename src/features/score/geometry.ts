import type { PdfPageSize } from "./types";

export const DEFAULT_PAGE_SIZE: PdfPageSize = { width: 612, height: 792 };
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 3;
export const MAX_DPR = 2;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function fitWidthScale(
  availableWidth: number,
  pageWidth: number,
  horizontalPadding = 32,
): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 1;
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) return 1;
  return clampZoom((availableWidth - horizontalPadding) / pageWidth);
}

export function cappedDevicePixelRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(MAX_DPR, value);
}

/** Visible pages plus one neighbor in each direction, clamped to the document. */
export function renderWindow(
  visiblePages: Iterable<number>,
  pageCount: number,
  overscan = 1,
): Set<number> {
  const active = new Set<number>();
  if (pageCount < 1) return active;
  for (const page of visiblePages) {
    if (!Number.isInteger(page)) continue;
    for (let candidate = page - overscan; candidate <= page + overscan; candidate += 1) {
      if (candidate >= 1 && candidate <= pageCount) active.add(candidate);
    }
  }
  return active;
}

export function displaySize(size: PdfPageSize, scale: number): PdfPageSize {
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}
