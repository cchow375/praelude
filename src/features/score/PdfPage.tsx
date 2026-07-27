import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  cappedDevicePixelRatio,
  DEFAULT_PAGE_SIZE,
  displaySize,
} from "./geometry";
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
  children?: ReactNode;
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
  children,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

    void document
      .getPage(pageNumber)
      .then((page) => {
        if (disposed) {
          page.cleanup();
          return;
        }
        const nextSize = { width: page.width, height: page.height };
        setSize(nextSize);
        onSize?.(pageNumber, nextSize);
        pageCleanup = page.cleanup;

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
  }, [shouldRender, document, onSize, pageNumber, renderScale]);

  // The box is always laid out at the live scale — this is what makes a zoom
  // press or pinch resize the page within the frame, independent of when the
  // crisp bitmap catches up.
  const displayed = displaySize(size, scale);

  return (
    <section
      className={`pdf-page is-${status} ${buffered ? "is-buffered" : ""}`}
      data-page-number={pageNumber}
      data-buffered={buffered ? "true" : undefined}
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
