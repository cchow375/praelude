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
  load: (bytes: ArrayBuffer) => Promise<PdfDocumentHandle>;
}

export interface ScorePdfApi {
  editions: (pieceId: number) => Promise<PdfEdition[]>;
  select: (pieceId: number, editionId: string) => Promise<void>;
  bytes: (pieceId: number, editionId: string) => Promise<ArrayBuffer>;
}
