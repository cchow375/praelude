import type {
  PdfAnchorMap,
  PdfAnchorKind,
  PdfAnchorRect,
  PdfEditionAnchors,
} from "./types";

const MIN_RECT_SPAN = 0.005;

function finiteUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validRect(value: unknown): value is PdfAnchorRect {
  if (!value || typeof value !== "object") return false;
  const rect = value as Partial<PdfAnchorRect>;
  return (
    typeof rect.page === "number" &&
    Number.isInteger(rect.page) &&
    rect.page >= 1 &&
    finiteUnit(rect.x) &&
    finiteUnit(rect.y) &&
    finiteUnit(rect.w) &&
    finiteUnit(rect.h) &&
    rect.w >= MIN_RECT_SPAN &&
    rect.h >= MIN_RECT_SPAN &&
    rect.x + rect.w <= 1.000001 &&
    rect.y + rect.h <= 1.000001
    && (rect.kind === undefined || ["box", "highlight", "note"].includes(rect.kind))
  );
}

export function anchorKind(rect: PdfAnchorRect): PdfAnchorKind {
  return rect.kind ?? "box";
}

export function validAnchorMap(value: unknown): value is PdfAnchorMap {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PdfAnchorMap>;
  if (candidate.v !== 1 || !candidate.editions || typeof candidate.editions !== "object") {
    return false;
  }
  return Object.values(candidate.editions).every((edition) => {
    if (!edition || typeof edition !== "object") return false;
    const item = edition as Partial<PdfEditionAnchors>;
    return (
      typeof item.fingerprint === "string" &&
      item.fingerprint.length > 0 &&
      Array.isArray(item.rects) &&
      item.rects.every(validRect)
    );
  });
}

export function anchorForEdition(
  value: unknown,
  editionId: string,
  fingerprint: string,
): PdfEditionAnchors | null {
  if (!validAnchorMap(value)) return null;
  const anchor = value.editions[editionId];
  return anchor?.fingerprint === fingerprint ? anchor : null;
}

export function replaceEditionRects(
  value: unknown,
  editionId: string,
  fingerprint: string,
  rects: PdfAnchorRect[],
): PdfAnchorMap {
  const editions = validAnchorMap(value) ? { ...value.editions } : {};
  if (rects.length === 0) {
    delete editions[editionId];
  } else {
    editions[editionId] = { fingerprint, rects: rects.filter(validRect) };
  }
  return { v: 1, editions };
}

export function normalizeDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  width: number,
  height: number,
  page: number,
  kind: PdfAnchorKind = "box",
): PdfAnchorRect | null {
  if (
    ![startX, startY, endX, endY, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(page) ||
    page < 1
  ) {
    return null;
  }
  const x1 = Math.min(width, Math.max(0, startX));
  const x2 = Math.min(width, Math.max(0, endX));
  const y1 = Math.min(height, Math.max(0, startY));
  const y2 = Math.min(height, Math.max(0, endY));
  const rect: PdfAnchorRect = {
    page,
    x: Math.min(x1, x2) / width,
    y: Math.min(y1, y2) / height,
    w: Math.abs(x2 - x1) / width,
    h: Math.abs(y2 - y1) / height,
    ...(kind === "box" ? {} : { kind }),
  };
  return validRect(rect) ? rect : null;
}
