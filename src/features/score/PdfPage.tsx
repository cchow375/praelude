import { useEffect, useRef, useState, type ReactNode } from "react";
import { cappedDevicePixelRatio, DEFAULT_PAGE_SIZE, displaySize } from "./geometry";
import type { PdfDocumentHandle, PdfPageSize, PdfRenderTask } from "./types";

interface PdfPageProps {
  document: PdfDocumentHandle;
  pageNumber: number;
  active: boolean;
  scale: number;
  onSize?: (pageNumber: number, size: PdfPageSize) => void;
  children?: ReactNode;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancelled(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "RenderingCancelledException" || /cancel/i.test(error.message))
  );
}

/** One persistent page placeholder whose canvas exists only near the viewport. */
export function PdfPage({ document, pageNumber, active, scale, onSize, children }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<PdfRenderTask | null>(null);
  const [size, setSize] = useState<PdfPageSize>(DEFAULT_PAGE_SIZE);
  const [status, setStatus] = useState<"idle" | "rendering" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active) {
      taskRef.current?.cancel();
      taskRef.current = null;
      if (canvas) {
        // Releasing both backing dimensions immediately returns the bitmap memory.
        canvas.width = 0;
        canvas.height = 0;
      }
      setStatus("idle");
      setError(null);
      return;
    }

    let disposed = false;
    let pageCleanup: (() => void) | null = null;
    setStatus("rendering");
    setError(null);

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

        const target = canvasRef.current;
        if (!target) throw new Error("page canvas is unavailable");
        const task = page.render(
          target,
          scale,
          cappedDevicePixelRatio(window.devicePixelRatio || 1),
        );
        taskRef.current = task;
        return task.promise;
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
      const target = canvasRef.current;
      if (target) {
        target.width = 0;
        target.height = 0;
      }
    };
  }, [active, document, onSize, pageNumber, scale]);

  const displayed = displaySize(size, scale);

  return (
    <section
      className={`pdf-page is-${status}`}
      data-page-number={pageNumber}
      aria-label={`Score page ${pageNumber}`}
      style={{ width: displayed.width, height: displayed.height }}
    >
      <canvas ref={canvasRef} aria-label={`Rendered score page ${pageNumber}`} />
      {status === "rendering" && <span className="pdf-page-loading">Rendering page {pageNumber}…</span>}
      {status === "error" && <span className="pdf-page-error">Page {pageNumber}: {error}</span>}
      <span className="pdf-page-number" aria-hidden="true">{pageNumber}</span>
      {children}
    </section>
  );
}
