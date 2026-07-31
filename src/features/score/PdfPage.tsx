import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  cappedDevicePixelRatio,
  DEFAULT_PAGE_SIZE,
  displaySize,
} from "./geometry";
import {
  coversPageBox,
  exceedsPageImageCeiling,
  neededLongEdge,
  pageImageBucket,
  type PageImageSource,
} from "./pageImage";
import type { PdfDocumentHandle, PdfPageSize, PdfRenderTask } from "./types";

interface PdfPageProps {
  document: PdfDocumentHandle;
  pageNumber: number;
  active: boolean;
  scale: number;
  /**
   * A mounted-but-not-shown neighbor: its canvas still renders (so paging to it
   * is instant), but it is lifted out of layout and hidden. The paged viewer
   * keeps only the current page in flow and buffers ±1 like this.
   */
  buffered?: boolean;
  onSize?: (pageNumber: number, size: PdfPageSize) => void;
  /**
   * Fired right after a crisp bitmap has been blitted onto the visible canvas,
   * with that canvas. The piece-switch cache uses it to snapshot the fitted
   * first page. Held in a ref internally so a fresh callback identity each
   * render never re-runs the raster effect.
   */
  onRasterized?: (pageNumber: number, canvas: HTMLCanvasElement) => void;
  /**
   * The screen-resolution page-image fast path, when the host offers one. It is
   * tried FIRST and PDF.js is the fallback, because on a 24-bit colour scan the
   * two differ by two orders of magnitude (0.2 s against 43 s measured on the
   * Barber). Absent, or refusing, and this component behaves exactly as before.
   */
  pageImage?: PageImageSource | null;
  children?: ReactNode;
}

/** A decoded page image plus how to let go of it again. */
interface DecodedPageImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  release: () => void;
}

/**
 * Decode JPEG bytes to something drawable, preferring `createImageBitmap` (off
 * the main thread, and `close()`able the instant it has been blitted). The
 * `<img>` fallback covers runtimes without it; a decode failure is `null`, which
 * the caller treats exactly like a refusal.
 */
async function decodePageImage(blob: Blob): Promise<DecodedPageImage | null> {
  const create = (
    window as Window & {
      createImageBitmap?: (input: Blob) => Promise<ImageBitmap>;
    }
  ).createImageBitmap;
  if (typeof create === "function") {
    try {
      const bitmap = await create.call(window, blob);
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        release: () => bitmap.close?.(),
      };
    } catch {
      return null;
    }
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("page image failed to decode"));
      element.src = url;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

// Zoom is a two-phase pipeline. Phase one is the live `scale`: the page box is
// laid out at that size immediately and the existing bitmap is stretched by the
// browser to fill it, so a zoom press/pinch grows the page within one frame —
// no PDF.js work on the input path. Phase two rasterizes a crisp bitmap at the
// *settled* scale after this quiet window and blits it in, so holding a zoom or
// pinching never triggers a re-render storm. Tuned so a single click resharpens
// almost immediately while a burst of wheel/pinch events coalesces into one.
const CRISP_RENDER_DELAY_MS = 140;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancelled(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "RenderingCancelledException" ||
      /cancel/i.test(error.message))
  );
}

/** One persistent page placeholder whose canvas exists only near the viewport. */
export function PdfPage({
  document,
  pageNumber,
  active,
  scale,
  buffered = false,
  onSize,
  onRasterized,
  pageImage = null,
  children,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep the latest onRasterized without listing it in the raster effect's
  // deps: the parent passes a fresh closure each render and re-running the
  // decode on identity churn would defeat the whole cache.
  const onRasterizedRef = useRef(onRasterized);
  onRasterizedRef.current = onRasterized;
  const taskRef = useRef<PdfRenderTask | null>(null);
  const [size, setSize] = useState<PdfPageSize>(DEFAULT_PAGE_SIZE);
  const [status, setStatus] = useState<
    "idle" | "rendering" | "ready" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  // The scale the current bitmap was rasterized at. It trails the live `scale`
  // during a zoom gesture and only catches up once input settles — that trailing
  // is exactly what keeps PDF.js off the interactive path. The visible box is
  // always laid out at the live `scale`, so the bitmap is CSS-scaled to fit in
  // the meantime (a touch soft, never blank).
  const [renderScale, setRenderScale] = useState(scale);
  // True once a bitmap has been painted at least once, so a re-rasterize for a
  // new scale keeps the old sharp image on screen instead of flashing the
  // "Rendering…" placeholder over a page the reader is already looking at.
  const hasPaintedRef = useRef(false);
  // Which pipeline painted what is currently on screen. Reported as a data
  // attribute so a refusal is observable rather than merely invisible.
  const [source, setSource] = useState<"pdf" | "image">("pdf");

  // A page that MOUNTS as a buffered neighbor waits for idle before decoding:
  // rendering current ±1 simultaneously made heavy scanned editions (multi-MB
  // image pages) jank the whole tab on open and on every page turn. The
  // visible page always decodes immediately, and once a neighbor has warmed
  // its canvas it keeps it (visible⇄buffered transitions never re-defer).
  const [deferred, setDeferred] = useState(buffered);
  useEffect(() => {
    if (!buffered) {
      setDeferred(false);
      return;
    }
    if (!deferred) return;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (win.requestIdleCallback && win.cancelIdleCallback) {
      const handle = win.requestIdleCallback(() => setDeferred(false));
      return () => win.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(() => setDeferred(false), 400);
    return () => window.clearTimeout(timer);
  }, [buffered, deferred]);

  const shouldRender = active && !deferred;

  // Coalesce live-scale changes into a single crisp rasterize once zooming (or a
  // fit-mode container resize) settles. Equal scales short-circuit so this never
  // schedules redundant work; the leading render on mount uses the initial
  // renderScale === scale and skips the debounce entirely.
  useEffect(() => {
    if (!shouldRender || scale === renderScale) return;
    const timer = window.setTimeout(
      () => setRenderScale(scale),
      CRISP_RENDER_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [scale, renderScale, shouldRender]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!shouldRender) {
      taskRef.current?.cancel();
      taskRef.current = null;
      if (canvas) {
        // Releasing both backing dimensions immediately returns the bitmap memory.
        canvas.width = 0;
        canvas.height = 0;
      }
      hasPaintedRef.current = false;
      setStatus("idle");
      setError(null);
      return;
    }

    let disposed = false;
    let pageCleanup: (() => void) | null = null;
    // Keep the sharp bitmap that is already on screen while the next one bakes;
    // only a first-ever paint shows the placeholder.
    if (!hasPaintedRef.current) {
      setStatus("rendering");
      setError(null);
    }

    /**
     * Try the screen-resolution image before touching the renderer.
     *
     * The page box is still measured from the real PDF page (above), so the
     * layout — and therefore every overlay percentage drawn on top of it — is
     * bit-for-bit what it was before this path existed. The image is blitted
     * into the same canvas at its own pixel size and the existing
     * `width:100%;height:100%` CSS stretches it to fill that box, which is what
     * PDF.js does with the page's single image XObject anyway.
     *
     * Returns false for every reason to fall back: no host support, zoomed past
     * what a cached image can carry, Rust declined the page, the bytes would not
     * decode, or the decoded image does not actually cover the page box.
     */
    const paintPageImage = async (nextSize: PdfPageSize): Promise<boolean> => {
      if (!pageImage) return false;
      const needed = neededLongEdge(
        nextSize,
        renderScale,
        window.devicePixelRatio || 1,
      );
      // Deep zoom: past the ceiling this page goes through PDF.js so the reader
      // never sees a soft staff when they zoom in to read an ornament.
      if (exceedsPageImageCeiling(needed)) return false;
      const blob = await pageImage.load(pageNumber, pageImageBucket(needed));
      if (disposed || !blob) return false;
      const decoded = await decodePageImage(blob);
      if (!decoded) return false;
      try {
        if (disposed) return false;
        if (!coversPageBox(decoded, nextSize)) return false;
        const target = canvasRef.current;
        if (!target) return false;
        target.width = decoded.width;
        target.height = decoded.height;
        try {
          const ctx = target.getContext("2d");
          if (ctx && decoded.width > 0 && decoded.height > 0) {
            ctx.drawImage(decoded.source, 0, 0);
          }
        } catch {
          // A context-less canvas (jsdom) still carries the right dimensions.
        }
        hasPaintedRef.current = true;
        onRasterizedRef.current?.(pageNumber, target);
        return true;
      } finally {
        decoded.release();
      }
    };

    void document
      .getPage(pageNumber)
      .then(async (page) => {
        if (disposed) {
          page.cleanup();
          return;
        }
        const nextSize = { width: page.width, height: page.height };
        setSize(nextSize);
        onSize?.(pageNumber, nextSize);
        pageCleanup = page.cleanup;

        if (await paintPageImage(nextSize)) {
          if (disposed) return;
          setSource("image");
          // Nothing in PDF.js decoded this page, and nothing needs to stay
          // resident for it: release the page object now rather than holding it
          // alongside the bitmap we just painted.
          pageCleanup?.();
          pageCleanup = null;
          return;
        }
        if (disposed) return;
        setSource("pdf");

        // Rasterize off-screen, then blit onto the visible canvas in a single
        // synchronous step on completion. Rendering straight to the on-screen
        // canvas would clear it the instant a zoom settled and leave the page
        // blank for the tens of ms PDF.js needs to repaint — the exact flash
        // that made zoom feel like it lagged behind the click.
        const offscreen = window.document.createElement("canvas");
        const task = page.render(
          offscreen,
          renderScale,
          cappedDevicePixelRatio(window.devicePixelRatio || 1),
        );
        taskRef.current = task;
        return task.promise.then(() => {
          if (disposed) return;
          const target = canvasRef.current;
          if (!target) return;
          target.width = offscreen.width;
          target.height = offscreen.height;
          try {
            const ctx = target.getContext("2d");
            if (ctx && offscreen.width > 0 && offscreen.height > 0) {
              ctx.drawImage(offscreen, 0, 0);
            }
          } catch {
            // A context-less canvas (jsdom) still carries the correct backing
            // dimensions above; there is simply nothing to paint into.
          }
          hasPaintedRef.current = true;
          onRasterizedRef.current?.(pageNumber, target);
        });
      })
      .then(() => {
        if (!disposed) setStatus("ready");
      })
      .catch((caught) => {
        if (disposed || isCancelled(caught)) return;
        setStatus("error");
        setError(messageOf(caught));
      });

    return () => {
      disposed = true;
      taskRef.current?.cancel();
      taskRef.current = null;
      pageCleanup?.();
    };
  }, [shouldRender, document, onSize, pageNumber, pageImage, renderScale]);

  // The box is always laid out at the live scale — this is what makes a zoom
  // press or pinch resize the page within the frame, independent of when the
  // crisp bitmap catches up.
  const displayed = displaySize(size, scale);

  return (
    <section
      className={`pdf-page is-${status} ${buffered ? "is-buffered" : ""}`}
      data-page-number={pageNumber}
      data-buffered={buffered ? "true" : undefined}
      data-source={source}
      aria-hidden={buffered ? "true" : undefined}
      aria-label={`Score page ${pageNumber}`}
      style={{ width: displayed.width, height: displayed.height }}
    >
      <canvas
        ref={canvasRef}
        aria-label={`Rendered score page ${pageNumber}`}
      />
      {status === "rendering" && (
        <span className="pdf-page-loading">Rendering page {pageNumber}…</span>
      )}
      {status === "error" && (
        <span className="pdf-page-error">
          Page {pageNumber}: {error}
        </span>
      )}
      <span className="pdf-page-number" aria-hidden="true">
        {pageNumber}
      </span>
      {children}
    </section>
  );
}
