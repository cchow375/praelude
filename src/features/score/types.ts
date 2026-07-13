import type { BlockHistory, Region } from "../pieces/types";

export interface PdfEdition {
  id: string;
  label: string;
  size_bytes: number;
  modified_unix: number;
  fingerprint: string;
  selected: boolean;
}

export interface PdfPageSize {
  width: number;
  height: number;
}

export interface PdfAnchorRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfEditionAnchors {
  fingerprint: string;
  rects: PdfAnchorRect[];
}

export interface PdfAnchorMap {
  v: 1;
  editions: Record<string, PdfEditionAnchors>;
}

export interface PdfRenderTask {
  promise: Promise<void>;
  cancel: () => void;
}

export interface PdfPageHandle extends PdfPageSize {
  render: (
    canvas: HTMLCanvasElement,
    scale: number,
    devicePixelRatio: number,
  ) => PdfRenderTask;
  cleanup: () => void;
}

export interface PdfDocumentHandle {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageHandle>;
  destroy: () => Promise<void>;
}

/** Small seam around PDF.js so viewer state is testable without a real canvas. */
export interface PdfAdapter {
  load: (
    bytes: ArrayBuffer,
    options?: { timeoutMs?: number },
  ) => Promise<PdfDocumentHandle>;
}

export interface ScorePdfApi {
  editions: (pieceId: number) => Promise<PdfEdition[]>;
  select: (pieceId: number, editionId: string) => Promise<void>;
  bytes: (pieceId: number, editionId: string) => Promise<ArrayBuffer>;
  regions: (pieceId: number) => Promise<Region[]>;
  blocks: (pieceId: number) => Promise<BlockHistory[]>;
  updateRegion: (regionId: number, pdfAnchor: PdfAnchorMap | null) => Promise<Region>;
}
