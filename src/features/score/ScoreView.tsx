import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFPageProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PdfPage } from "./PdfPage";
import {
  clampZoom,
  DEFAULT_PAGE_SIZE,
  fitWidthScale,
  renderWindow,
} from "./geometry";
import type {
  PdfAdapter,
  PdfDocumentHandle,
  PdfEdition,
  PdfPageHandle,
  PdfPageSize,
  ScorePdfApi,
} from "./types";
import "./ScoreView.css";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const defaultApi: ScorePdfApi = {
  editions: (pieceId) => invoke<PdfEdition[]>("score_pdf_editions", { pieceId }),
  select: (pieceId, editionId) => invoke<void>("score_pdf_select", { pieceId, editionId }),
  bytes: (pieceId, editionId) => invoke<ArrayBuffer>("score_pdf_bytes", { pieceId, editionId }),
};

function wrapPage(page: PDFPageProxy): PdfPageHandle {
  const base = page.getViewport({ scale: 1 });
  return {
    width: base.width,
    height: base.height,
    cleanup: () => {
      page.cleanup();
    },
    render: (canvas, scale, devicePixelRatio) => {
      const cssViewport = page.getViewport({ scale });
      const renderViewport = page.getViewport({ scale: scale * devicePixelRatio });
      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      canvas.style.width = `${Math.max(1, cssViewport.width)}px`;
      canvas.style.height = `${Math.max(1, cssViewport.height)}px`;
      const task = page.render({ canvas, viewport: renderViewport });
      return { promise: task.promise, cancel: () => task.cancel() };
    },
  };
}

export const pdfJsAdapter: PdfAdapter = {
  async load(bytes) {
    // PDF.js transfers its data to the worker; copy so callers keep ownership.
    const task: PDFDocumentLoadingTask = getDocument({ data: new Uint8Array(bytes.slice(0)) });
    const document = await task.promise;
    return {
      numPages: document.numPages,
      getPage: async (pageNumber) => wrapPage(await document.getPage(pageNumber)),
      destroy: async () => {
        await task.destroy();
      },
    };
  },
};

type ViewerPhase = "loading-editions" | "no-pdf" | "loading-document" | "ready" | "error";

interface ScoreViewProps {
  pieceId: number;
  api?: ScorePdfApi;
  adapter?: PdfAdapter;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function samePages(a: Set<number>, b: Set<number>): boolean {
  return a.size === b.size && [...a].every((page) => b.has(page));
}

export function ScoreView({ pieceId, api = defaultApi, adapter = pdfJsAdapter }: ScoreViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageSizesRef = useRef(new Map<number, PdfPageSize>());
  const intersectionRatios = useRef(new Map<number, number>());
  const [phase, setPhase] = useState<ViewerPhase>("loading-editions");
  const [error, setError] = useState<string | null>(null);
  const [editions, setEditions] = useState<PdfEdition[]>([]);
  const [editionId, setEditionId] = useState<string | null>(null);
  const [document, setDocument] = useState<PdfDocumentHandle | null>(null);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set([1]));
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDraft, setPageDraft] = useState("1");
  const [manualZoom, setManualZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [containerWidth, setContainerWidth] = useState(900);
  const [maxPageWidth, setMaxPageWidth] = useState(DEFAULT_PAGE_SIZE.width);
  const [reloadToken, setReloadToken] = useState(0);
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    let alive = true;
    setPhase("loading-editions");
    setError(null);
    setEditions([]);
    setEditionId(null);
    setDocument(null);
    pageSizesRef.current.clear();
    setMaxPageWidth(DEFAULT_PAGE_SIZE.width);

    void api
      .editions(pieceId)
      .then((found) => {
        if (!alive) return;
        const next = found ?? [];
        setEditions(next);
        if (next.length === 0) {
          setPhase("no-pdf");
          return;
        }
        const selected = next.find((edition) => edition.selected) ?? next[0];
        setEditionId(selected.id);
      })
      .catch((caught) => {
        if (!alive) return;
        setError(messageOf(caught));
        setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, [api, pieceId, reloadToken]);

  useEffect(() => {
    if (!editionId || !editions.some((edition) => edition.id === editionId)) return;
    let alive = true;
    let loaded: PdfDocumentHandle | null = null;
    setPhase("loading-document");
    setError(null);
    setDocument(null);
    setVisiblePages(new Set([1]));
    setCurrentPage(1);
    setPageDraft("1");
    intersectionRatios.current.clear();
    pageSizesRef.current.clear();
    setMaxPageWidth(DEFAULT_PAGE_SIZE.width);

    void api
      .bytes(pieceId, editionId)
      .then((bytes) => adapter.load(bytes))
      .then((nextDocument) => {
        loaded = nextDocument;
        if (!alive) return nextDocument.destroy();
        setDocument(nextDocument);
        setPhase("ready");
      })
      .catch((caught) => {
        if (!alive) return;
        setError(messageOf(caught));
        setPhase("error");
      });

    return () => {
      alive = false;
      if (loaded) void loaded.destroy();
    };
  }, [adapter, api, editionId, editions, pieceId, reloadToken]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const update = () => setContainerWidth(root.clientWidth || 900);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, [phase]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!document || phase !== "ready" || !root || typeof IntersectionObserver === "undefined") {
      return;
    }
    intersectionRatios.current.clear();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (Number.isInteger(page)) {
            intersectionRatios.current.set(page, entry.isIntersecting ? entry.intersectionRatio : 0);
          }
        }
        const ranked = [...intersectionRatios.current.entries()]
          .filter(([, ratio]) => ratio > 0)
          .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        const next = new Set(ranked.map(([page]) => page));
        if (ranked[0]) {
          setCurrentPage(ranked[0][0]);
          setPageDraft(String(ranked[0][0]));
        }
        if (next.size > 0) {
          setVisiblePages((previous) => (samePages(previous, next) ? previous : next));
        }
      },
      { root, threshold: [0, 0.05, 0.25, 0.5, 0.75] },
    );
    root.querySelectorAll<HTMLElement>("[data-page-number]").forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [document, phase]);

  const pageCount = document?.numPages ?? 0;
  const activePages = useMemo(
    () => renderWindow(visiblePages, pageCount),
    [pageCount, visiblePages],
  );
  const scale = fitWidth
    ? fitWidthScale(containerWidth, maxPageWidth, 40)
    : clampZoom(manualZoom);

  const handlePageSize = useCallback((page: number, size: PdfPageSize) => {
    pageSizesRef.current.set(page, size);
    setMaxPageWidth((current) => Math.max(current, size.width));
  }, []);

  const jumpTo = useCallback(
    (requested: number) => {
      if (!document) return;
      const page = Math.min(document.numPages, Math.max(1, Math.round(requested)));
      setCurrentPage(page);
      setPageDraft(String(page));
      setVisiblePages(new Set([page]));
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-page-number="${page}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [document],
  );

  const chooseEdition = async (nextId: string) => {
    if (nextId === editionId) return;
    setSelecting(true);
    setError(null);
    try {
      await api.select(pieceId, nextId);
      setEditions((current) =>
        current.map((edition) => ({ ...edition, selected: edition.id === nextId })),
      );
      setEditionId(nextId);
    } catch (caught) {
      setError(messageOf(caught));
      setPhase("error");
    } finally {
      setSelecting(false);
    }
  };

  if (phase === "loading-editions") {
    return <div className="score-state" role="status">Finding score editions…</div>;
  }
  if (phase === "no-pdf") {
    return (
      <div className="score-state score-empty">
        <strong>No PDF score found.</strong>
        <span>Add a PDF to this piece’s score folder, then rescan the piece.</span>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="score-state score-error" role="alert">
        <strong>Score could not be opened.</strong>
        <span>{error}</span>
        <button type="button" onClick={() => setReloadToken((value) => value + 1)}>Try again</button>
      </div>
    );
  }

  return (
    <section className="score-view" aria-label="PDF score viewer">
      <header className="score-toolbar">
        <label className="score-edition">
          <span>Edition</span>
          <select
            aria-label="Score edition"
            value={editionId ?? ""}
            disabled={selecting || phase === "loading-document"}
            onChange={(event) => void chooseEdition(event.target.value)}
          >
            {editions.map((edition) => (
              <option key={edition.id} value={edition.id}>{edition.label}</option>
            ))}
          </select>
        </label>

        <div className="score-page-controls" aria-label="Page navigation">
          <button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => jumpTo(currentPage - 1)}>‹</button>
          <form onSubmit={(event) => { event.preventDefault(); jumpTo(Number(pageDraft)); }}>
            <input
              aria-label="Page number"
              inputMode="numeric"
              value={pageDraft}
              onChange={(event) => setPageDraft(event.target.value)}
            />
            <span>of {pageCount || "—"}</span>
          </form>
          <button type="button" aria-label="Next page" disabled={currentPage >= pageCount} onClick={() => jumpTo(currentPage + 1)}>›</button>
        </div>

        <div className="score-zoom" aria-label="Score zoom">
          <button type="button" aria-label="Zoom out" onClick={() => { setFitWidth(false); setManualZoom(clampZoom(scale - 0.1)); }}>−</button>
          <span aria-label="Zoom level">{Math.round(scale * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => { setFitWidth(false); setManualZoom(clampZoom(scale + 0.1)); }}>+</button>
          <button type="button" className={fitWidth ? "is-active" : ""} onClick={() => setFitWidth(true)}>Fit width</button>
        </div>
      </header>

      {phase === "loading-document" || !document ? (
        <div className="score-state" role="status">Loading PDF…</div>
      ) : (
        <div className="score-scroll" ref={scrollRef} data-testid="score-scroll">
          <div className="score-pages">
            {Array.from({ length: pageCount }, (_, index) => {
              const pageNumber = index + 1;
              return (
                <PdfPage
                  key={pageNumber}
                  document={document}
                  pageNumber={pageNumber}
                  active={activePages.has(pageNumber)}
                  scale={scale}
                  onSize={handlePageSize}
                />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
