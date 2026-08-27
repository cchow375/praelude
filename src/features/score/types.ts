import type { BlockHistory, PieceMovement, Region } from "../pieces/types";
import type { AtomicTargetSavePayload } from "./atlas/savePayload";

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

export type PdfAnchorKind = "box" | "highlight" | "note";

export interface PdfAnchorRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional for backward compatibility; old saved rectangles are boxes. */
  kind?: PdfAnchorKind;
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

/** One PDF text-layer run, normalized to 0–1 page coordinates (top-left origin). */
export interface PdfTextItem {
  text: string;
  xPct: number;
  yPct: number;
}

export interface PdfPageHandle extends PdfPageSize {
  render: (
    canvas: HTMLCanvasElement,
    scale: number,
    devicePixelRatio: number,
  ) => PdfRenderTask;
  cleanup: () => void;
  /**
   * Normalized text-layer runs for measure-number prefill. Optional: a scanned
   * edition has no text layer, and test adapters may omit it entirely.
   */
  textItems?: () => Promise<PdfTextItem[]>;
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
  /**
   * Range-load an edition straight from the native `ckscore://` protocol, so
   * PDF.js pulls the xref plus only the objects page 1 needs instead of taking
   * a whole image scan across IPC. Optional: the dev mock and every test
   * adapter implement only `load`, and callers must fall back to it when this
   * rejects (the custom scheme does not exist in a plain browser).
   */
  loadUrl?: (
    url: string,
    options?: { timeoutMs?: number },
  ) => Promise<PdfDocumentHandle>;
  /**
   * Start loading the PDF.js runtime chunks without needing a document yet.
   * The legacy build is ~1.7 MB across two chunks and costs ~200 ms to import;
   * warming it in parallel with the edition lookup keeps that off the serial
   * open path. Fire-and-forget — failures are the loader's problem later.
   */
  prefetch?: () => void;
}

export interface ScorePdfApi {
  editions: (pieceId: number) => Promise<PdfEdition[]>;
  select: (pieceId: number, editionId: string) => Promise<void>;
  bytes: (pieceId: number, editionId: string) => Promise<ArrayBuffer>;
  regions: (pieceId: number) => Promise<Region[]>;
  blocks: (pieceId: number) => Promise<BlockHistory[]>;
  /** Optional for test/legacy adapters; production always supplies schema-v17 movements. */
  movements?: (pieceId: number) => Promise<PieceMovement[]>;
  updateRegion: (
    regionId: number,
    pdfAnchor: PdfAnchorMap | null,
  ) => Promise<Region>;
  /** One atomic Score Atlas target write; native persistence may land separately. */
  createTarget: (payload: AtomicTargetSavePayload) => Promise<Region>;
  /**
   * Load a persisted fitted first-page snapshot. Resolves to an empty buffer on
   * a miss (never rejects for absence); a display-only accelerator, so any
   * failure degrades to "no cached bitmap" rather than blocking the switch.
   */
  loadFirstPage: (
    pieceId: number,
    fingerprint: string,
    page: number,
    bucket: string,
  ) => Promise<ArrayBuffer>;
  /**
   * A screen-resolution JPEG of one page, decoded in Rust straight from the
   * page's single image XObject. Resolves to an EMPTY buffer — never rejects —
   * when the page is not a single-image scan the fast path can serve, which is
   * the routine answer for a vector edition; the caller then renders it with
   * PDF.js as before. Optional: test adapters and the browser dev mock omit it
   * and get the PDF.js-only behaviour.
   */
  pageImage?: (
    pieceId: number,
    editionId: string,
    page: number,
    targetLongEdge: number,
  ) => Promise<ArrayBuffer>;
  /**
   * Generate and cache a page image without shipping it across IPC — the
   * background warm for pages the reader is about to turn to. Fire-and-forget.
   */
  warmPageImage?: (
    pieceId: number,
    editionId: string,
    page: number,
    targetLongEdge: number,
  ) => Promise<void>;
  /** Persist a fitted first-page snapshot (compressed WebP/JPEG bytes). */
  saveFirstPage: (
    pieceId: number,
    fingerprint: string,
    page: number,
    bucket: string,
    bytes: ArrayBuffer,
  ) => Promise<void>;
}

/** Visible score state lifted to the shell for the persistent Practice Brain. */
export interface ScoreFocusContext {
  region: {
    id: number;
    name: string;
    notes: string | null;
    m_start: number;
    m_end: number;
  } | null;
  current_page: number;
  edition_id: string | null;
  edition_label: string | null;
}
