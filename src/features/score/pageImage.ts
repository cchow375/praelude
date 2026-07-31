// The screen-resolution page-image fast path, as the viewer sees it.
//
// A scanned score page is one enormous image XObject stretched over the page
// box. Rendering it through PDF.js decodes every source pixel into a full-size
// bitmap before scaling down: measured on Christian's vault that is 2.8 s for the
// Prokofiev and 43 s for the Barber (24-bit JPEG + ICC), against ~0.2 s for
// asking Rust to decode that same image straight to the size the screen shows.
//
// `score_page_image` is that Rust path. It ANSWERS WITH NOTHING — an empty
// response, not an error — whenever the page is not a single-image scan it is
// certain about. That is the routine answer for a vector edition, and this
// module turns it into `null` so the caller falls back to PDF.js, which is
// already fast for exactly those pages (0.08–0.69 s measured).
//
// Everything here is pure or a thin IPC wrapper, so the decision logic (which
// bucket, when the cached resolution has run out, whether the returned image
// really covers the page box) is testable without a canvas or a Tauri host.

import { cappedDevicePixelRatio } from "./geometry";
import type { PdfPageSize } from "./types";

/**
 * The long-edge sizes Rust is willing to produce, mirroring
 * `page_image::TARGET_BUCKETS`. Quantizing means a window resized by a few
 * pixels re-uses the cached image instead of regenerating a near-identical one —
 * without this the disk cache would never hit and the fast path would be a fast
 * path only in principle.
 */
export const PAGE_IMAGE_BUCKETS = [1024, 1280, 1536, 2048, 2560, 3200] as const;

/**
 * Ceiling on any page image, mirroring `page_image::MAX_TARGET_LONG_EDGE`.
 * Zooming past this asks for more detail than a cached image can honestly carry,
 * so the viewer stops asking and renders that one page through PDF.js instead.
 */
export const MAX_PAGE_IMAGE_LONG_EDGE = 3200;

/**
 * How far the returned image's aspect ratio may differ from the PDF page box
 * before we refuse it.
 *
 * This is the guard that protects every mark drawn on top of the page. Region
 * overlays, target rectangles and the mapping calibration are all positioned in
 * page-relative percentages of the page box, so the image is painted stretched
 * to fill that box exactly — which is right if and only if the image really is
 * placed over the whole page.
 *
 * The Rust decoder does NOT check that: `single_image_of_page` validates that
 * the placement matrix is axis-aligned and non-degenerate, but never compares it
 * to the MediaBox, so it will happily serve a scan that overflows or is inset.
 * Two real editions in Christian's vault do exactly that — the Prokofiev Op.1
 * Jurgenson places a 3300x3900 scan at 792x936 pt on a 756x909 pt page (the
 * renderer CLIPS it) and the Schnabel Op.90 has pages inset by ~3%.
 *
 * Aspect ratio is the only signal available on this side of the IPC boundary, so
 * the threshold is set from measurement rather than taste. Over all 207
 * single-image pages in the vault:
 *
 * | tolerance | accepted | of which MISPLACED | correct pages lost |
 * |-----------|----------|--------------------|--------------------|
 * | 2.0%      | 181      | 19                 | 0                  |
 * | 1.0%      | 163      | 1                  | 0                  |
 * | 0.1%      | 160      | 0                  | 2                  |
 *
 * 0.1% is the loosest threshold with zero misplacements. The two pages it gives
 * up carry ~0.4% of stretch of their own, so refusing them is the conservative
 * answer anyway — a page that renders slowly is a far better failure than a page
 * whose marks sit on the wrong staff.
 *
 * KNOWN RESIDUAL: an image inset by *exactly proportional* margins would have a
 * matching aspect and slip through, as would a `/Rotate 180` page. Neither
 * exists in the vault today. Closing that hole properly means comparing the
 * placement rectangle to the page box, which only the Rust decoder can see.
 */
export const PAGE_IMAGE_ASPECT_TOLERANCE = 0.001;

/** Device pixels on the long edge needed to show `size` crisply at `scale`. */
export function neededLongEdge(
  size: PdfPageSize,
  scale: number,
  devicePixelRatio: number,
): number {
  const dpr = cappedDevicePixelRatio(devicePixelRatio);
  const longEdge = Math.max(size.width, size.height);
  if (!Number.isFinite(longEdge) || !Number.isFinite(scale)) return 0;
  return Math.max(0, Math.ceil(longEdge * Math.max(0, scale) * dpr));
}

/** Smallest bucket covering `needed`; saturates at the ceiling. Mirrors Rust. */
export function pageImageBucket(needed: number): number {
  if (!Number.isFinite(needed) || needed <= 0) return 2048;
  for (const bucket of PAGE_IMAGE_BUCKETS) {
    if (bucket >= needed) return bucket;
  }
  return MAX_PAGE_IMAGE_LONG_EDGE;
}

/**
 * True once the reader has zoomed past what a cached page image can honestly
 * supply. At `devicePixelRatio` 2 on a US-Letter page this crosses at roughly
 * 200% zoom, above which that one page is rendered live by PDF.js — so zooming
 * in to read an ornament never shows a soft image.
 */
export function exceedsPageImageCeiling(needed: number): boolean {
  return needed > MAX_PAGE_IMAGE_LONG_EDGE;
}

/** Does this decoded image really cover the whole page box? See the tolerance. */
export function coversPageBox(
  image: { width: number; height: number },
  page: PdfPageSize,
): boolean {
  if (
    !(image.width > 0) ||
    !(image.height > 0) ||
    !(page.width > 0) ||
    !(page.height > 0)
  ) {
    return false;
  }
  const ratio = image.width / image.height / (page.width / page.height);
  return Math.abs(ratio - 1) <= PAGE_IMAGE_ASPECT_TOLERANCE;
}

/** What `PdfPage` needs from the fast path, so tests can supply it directly. */
export interface PageImageSource {
  /** Resolves to the JPEG bytes, or `null` for "not servable — use PDF.js". */
  load: (page: number, targetLongEdge: number) => Promise<Blob | null>;
  /** Fire-and-forget cache warm. Must never block or throw into the caller. */
  warm: (page: number, targetLongEdge: number) => void;
}

/** The IPC surface the source is built on; matches `ScorePdfApi`'s optionals. */
export interface PageImageApi {
  pageImage?: (
    pieceId: number,
    editionId: string,
    page: number,
    targetLongEdge: number,
  ) => Promise<ArrayBuffer>;
  warmPageImage?: (
    pieceId: number,
    editionId: string,
    page: number,
    targetLongEdge: number,
  ) => Promise<void>;
}

/**
 * Bind the fast path to one piece/edition.
 *
 * Returns `null` when the host cannot serve page images at all (an old adapter,
 * a test double, the browser dev mock) so the caller keeps its PDF.js-only
 * behaviour with no branching at the call site.
 */
export function createPageImageSource(
  api: PageImageApi,
  pieceId: number,
  editionId: string | null,
): PageImageSource | null {
  const fetchImage = api.pageImage;
  if (!fetchImage || !editionId) return null;
  const warmImage = api.warmPageImage;
  return {
    load: async (page, targetLongEdge) => {
      let bytes: ArrayBuffer;
      try {
        bytes = await fetchImage(pieceId, editionId, page, targetLongEdge);
      } catch {
        // A failure here is never fatal: the full renderer is still there.
        return null;
      }
      // Empty is the refusal. Tauri hands back an ArrayBuffer for
      // `ipc::Response`; be tolerant of a byte array from a mock or a test.
      const view =
        bytes instanceof ArrayBuffer
          ? new Uint8Array(bytes)
          : new Uint8Array(bytes as ArrayBufferLike);
      if (view.byteLength === 0) return null;
      return new Blob([view], { type: "image/jpeg" });
    },
    warm: (page, targetLongEdge) => {
      if (!warmImage) return;
      void warmImage(pieceId, editionId, page, targetLongEdge).catch(
        () => undefined,
      );
    },
  };
}
