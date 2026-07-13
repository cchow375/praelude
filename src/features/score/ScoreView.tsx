import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PDFDocumentLoadingTask, PDFPageProxy } from "pdfjs-dist";
import type { BlockHistory, Region } from "../pieces/types";
import type { RepOpenArgs } from "../rep/useRep";
import { BlockForm } from "../rep/BlockForm";
import { anchorForEdition, replaceEditionRects, validAnchorMap } from "./anchors";
import { PdfPage } from "./PdfPage";
import { RegionOverlay, type RegionOverlayItem } from "./RegionOverlay";
import {
  clampZoom,
  DEFAULT_PAGE_SIZE,
  fitWidthScale,
  renderWindow,
} from "./geometry";
import type {
  PdfAdapter,
  PdfAnchorMap,
  PdfAnchorRect,
  PdfDocumentHandle,
  PdfEdition,
  PdfPageHandle,
  PdfPageSize,
  ScorePdfApi,
} from "./types";
import "./ScoreView.css";

const PDF_LOAD_TIMEOUT_MS = 30_000;
const PDF_RENDER_TIMEOUT_MESSAGE = "PDF rendering did not start in time. Try again or choose another edition.";

interface PdfJsRuntime {
  getDocument: (options: { data: Uint8Array }) => PDFDocumentLoadingTask;
}

type PdfJsRuntimeLoader = () => Promise<PdfJsRuntime>;

const defaultApi: ScorePdfApi = {
  editions: (pieceId) => invoke<PdfEdition[]>("score_pdf_editions", { pieceId }),
  select: (pieceId, editionId) => invoke<void>("score_pdf_select", { pieceId, editionId }),
  bytes: (pieceId, editionId) => invoke<ArrayBuffer>("score_pdf_bytes", { pieceId, editionId }),
  regions: (pieceId) => invoke<Region[]>("region_list", { pieceId }),
  blocks: (pieceId) => invoke<BlockHistory[]>("rep_blocks_for_piece", { pieceId }),
  updateRegion: (regionId, pdfAnchor) => invoke<Region>("region_update", {
    id: regionId,
    patch: { pdf_anchor: pdfAnchor },
  }),
};

function wrapPage(page: PDFPageProxy): PdfPageHandle {
  const base = page.getViewport({ scale: 1 });
  return {
    width: base.width,
    height: base.height,
    cleanup: () => page.cleanup(),
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

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    operation.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        window.clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

export function createPdfJsAdapter(
  loadRuntime: PdfJsRuntimeLoader = async () => {
    await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  },
): PdfAdapter {
  return {
    async load(bytes, options) {
      if (!bytes || typeof bytes.byteLength !== "number" || bytes.byteLength === 0) {
        throw new Error("The selected PDF is empty or did not arrive as binary data.");
      }

      const timeoutMs = options?.timeoutMs ?? PDF_LOAD_TIMEOUT_MS;
      const taskRef: { current: PDFDocumentLoadingTask | null } = { current: null };
      let timedOut = false;
      try {
        const document = await withTimeout((async () => {
          // CodaKiller runs inside WKWebView. PDF.js's modern build targets only
          // the newest browser engines, and WebKit does not reliably start an ES
          // module Worker from Tauri's custom app protocol. Loading the matching
          // legacy worker module on the main thread registers WorkerMessageHandler;
          // PDF.js then uses its supported loopback worker instead of waiting on a
          // custom-protocol Worker handshake that may never answer.
          const { getDocument } = await loadRuntime();
          const task = getDocument({
            // Uint8Array accepts ArrayBuffers from a different JS realm too; an
            // `instanceof ArrayBuffer` check does not (WKWebView's IPC response is
            // created by Tauri's injected realm).
            data: new Uint8Array(bytes).slice(),
          });
          taskRef.current = task;
          // Dynamic imports cannot be cancelled. If the outer deadline elapsed
          // while WebKit was loading the chunks, destroy a task created later
          // instead of leaving a hidden parser alive after the UI shows an error.
          if (timedOut) {
            void task.destroy().catch(() => undefined);
            throw new Error(PDF_RENDER_TIMEOUT_MESSAGE);
          }
          return task.promise;
        })(), timeoutMs, PDF_RENDER_TIMEOUT_MESSAGE);

        return {
          numPages: document.numPages,
          getPage: async (pageNumber) => wrapPage(await document.getPage(pageNumber)),
          destroy: async () => { await taskRef.current?.destroy(); },
        };
      } catch (error) {
        timedOut = true;
        // Cleanup is best-effort and deliberately not awaited. PDF.js destroy()
        // can wait on the same worker startup that triggered this deadline; the
        // visible retryable error must never be gated by an unbounded teardown.
        if (taskRef.current) void taskRef.current.destroy().catch(() => undefined);
        throw error;
      }
    },
  };
}

export const pdfJsAdapter = createPdfJsAdapter();

type ViewerPhase = "loading-editions" | "no-pdf" | "loading-document" | "ready" | "error";

export interface ScoreViewProps {
  pieceId: number;
  activeRange?: { m_start: number; m_end: number } | null;
  defaultTargetBpm?: number | null;
  onOpenBlock?: (args: RepOpenArgs) => void;
  opening?: boolean;
  api?: ScorePdfApi;
  adapter?: PdfAdapter;
  loadTimeoutMs?: number;
}

interface MappingDraft {
  regionId: number;
  rects: PdfAnchorRect[];
}

interface ScoreNavigate {
  kind: "page" | "measure";
  value: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function samePages(a: Set<number>, b: Set<number>): boolean {
  return a.size === b.size && [...a].every((page) => b.has(page));
}

function overlaps(region: Region, range: { m_start: number; m_end: number } | null | undefined) {
  return Boolean(range && region.m_start <= range.m_end && range.m_start <= region.m_end);
}

function editionHasStaleAnchor(region: Region, edition: PdfEdition): boolean {
  if (!validAnchorMap(region.pdf_anchor)) return false;
  const stored = region.pdf_anchor.editions[edition.id];
  return Boolean(stored && stored.fingerprint !== edition.fingerprint);
}

export function ScoreView({
  pieceId,
  activeRange = null,
  defaultTargetBpm = null,
  onOpenBlock,
  opening = false,
  api = defaultApi,
  adapter = pdfJsAdapter,
  loadTimeoutMs = PDF_LOAD_TIMEOUT_MS,
}: ScoreViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageSizesRef = useRef(new Map<number, PdfPageSize>());
  const intersectionRatios = useRef(new Map<number, number>());
  const [phase, setPhase] = useState<ViewerPhase>("loading-editions");
  const [error, setError] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [editions, setEditions] = useState<PdfEdition[]>([]);
  const [editionId, setEditionId] = useState<string | null>(null);
  const [document, setDocument] = useState<PdfDocumentHandle | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [blocks, setBlocks] = useState<BlockHistory[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);
  const [mapping, setMapping] = useState<MappingDraft | null>(null);
  const [savingMap, setSavingMap] = useState(false);
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null);
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
    setGraphError(null);
    setRegions([]);
    setBlocks([]);
    setSelectedRegionId(null);
    setMapping(null);
    void Promise.all([api.regions(pieceId), api.blocks(pieceId)])
      .then(([nextRegions, nextBlocks]) => {
        if (!alive) return;
        setRegions(nextRegions ?? []);
        setBlocks(nextBlocks ?? []);
      })
      .catch((caught) => {
        if (alive) setGraphError(messageOf(caught));
      });
    return () => { alive = false; };
  }, [api, pieceId, reloadToken]);

  useEffect(() => {
    let alive = true;
    setPhase("loading-editions");
    setError(null);
    setEditions([]);
    setEditionId(null);
    setDocument(null);
    pageSizesRef.current.clear();
    setMaxPageWidth(DEFAULT_PAGE_SIZE.width);

    void api.editions(pieceId)
      .then((found) => {
        if (!alive) return;
        const next = found ?? [];
        setEditions(next);
        if (next.length === 0) {
          setPhase("no-pdf");
          return;
        }
        setEditionId((next.find((edition) => edition.selected) ?? next[0]).id);
      })
      .catch((caught) => {
        if (!alive) return;
        setError(messageOf(caught));
        setPhase("error");
      });
    return () => { alive = false; };
  }, [api, pieceId, reloadToken]);

  useEffect(() => {
    if (!editionId || !editions.some((edition) => edition.id === editionId)) return;
    let alive = true;
    let loaded: PdfDocumentHandle | null = null;
    setPhase("loading-document");
    setError(null);
    setDocument(null);
    setMapping(null);
    setVisiblePages(new Set([1]));
    setCurrentPage(1);
    setPageDraft("1");
    intersectionRatios.current.clear();
    pageSizesRef.current.clear();
    setMaxPageWidth(DEFAULT_PAGE_SIZE.width);

    void withTimeout(
      api.bytes(pieceId, editionId),
      loadTimeoutMs,
      "The PDF file took too long to read. Try again or choose another edition.",
    )
      .then((bytes) => adapter.load(bytes, { timeoutMs: loadTimeoutMs }))
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
  }, [adapter, api, editionId, editions, loadTimeoutMs, pieceId]);

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
    if (!document || phase !== "ready" || !root || typeof IntersectionObserver === "undefined") return;
    intersectionRatios.current.clear();
    const observer = new IntersectionObserver((entries) => {
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
      if (next.size > 0) setVisiblePages((previous) => samePages(previous, next) ? previous : next);
    }, { root, threshold: [0, 0.05, 0.25, 0.5, 0.75] });
    root.querySelectorAll<HTMLElement>("[data-page-number]").forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [document, phase]);

  const pageCount = document?.numPages ?? 0;
  const activePages = useMemo(() => renderWindow(visiblePages, pageCount), [pageCount, visiblePages]);
  const scale = fitWidth ? fitWidthScale(containerWidth, maxPageWidth, 40) : clampZoom(manualZoom);
  const edition = editions.find((item) => item.id === editionId) ?? null;
  const selectedRegion = regions.find((region) => region.id === selectedRegionId) ?? null;
  const selectedBlocks = selectedRegion
    ? blocks.filter((block) => block.region_id === selectedRegion.id)
    : [];

  const handlePageSize = useCallback((page: number, size: PdfPageSize) => {
    pageSizesRef.current.set(page, size);
    setMaxPageWidth((current) => Math.max(current, size.width));
  }, []);

  const jumpTo = useCallback((requested: number) => {
    if (!document) return;
    const page = Math.min(document.numPages, Math.max(1, Math.round(requested)));
    setCurrentPage(page);
    setPageDraft(String(page));
    setVisiblePages(new Set([page]));
    const root = scrollRef.current;
    const target = root?.querySelector<HTMLElement>(`[data-page-number="${page}"]`);
    if (page !== currentPage && root && target) {
      root.scrollTo?.({ top: target.offsetTop, behavior: "smooth" });
    }
  }, [currentPage, document]);

  const selectRegion = useCallback((regionId: number) => {
    setSelectedRegionId(regionId);
    setNavigationNotice(null);
    if (!edition) return;
    const region = regions.find((item) => item.id === regionId);
    const rect = region && anchorForEdition(region.pdf_anchor, edition.id, edition.fingerprint)?.rects[0];
    if (rect) jumpTo(rect.page);
  }, [edition, jumpTo, regions]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<ScoreNavigate>("score://navigate", (event) => {
      const target = event.payload;
      if (target.kind === "page") {
        jumpTo(target.value);
        return;
      }
      if (!edition) return;
      const candidates = regions
        .filter((region) => region.m_start <= target.value && target.value <= region.m_end)
        .sort((a, b) => (a.m_end - a.m_start) - (b.m_end - b.m_start));
      const mapped = candidates.find((region) =>
        Boolean(anchorForEdition(region.pdf_anchor, edition.id, edition.fingerprint)?.rects[0]),
      );
      if (mapped) {
        selectRegion(mapped.id);
      } else {
        setNavigationNotice(`Measure ${target.value} is not mapped in this edition yet.`);
      }
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [edition, jumpTo, regions, selectRegion]);

  const overlayItems: RegionOverlayItem[] = useMemo(() => {
    if (!edition) return [];
    return regions.map((region) => ({
      regionId: region.id,
      label: region.name,
      color: region.color,
      rects: anchorForEdition(region.pdf_anchor, edition.id, edition.fingerprint)?.rects ?? [],
      selected: region.id === selectedRegionId,
      active: overlaps(region, activeRange),
    }));
  }, [activeRange, edition, regions, selectedRegionId]);

  const beginMapping = (region: Region) => {
    if (!edition) return;
    const existing = anchorForEdition(region.pdf_anchor, edition.id, edition.fingerprint)?.rects ?? [];
    setSelectedRegionId(region.id);
    setMapping({ regionId: region.id, rects: [...existing] });
    setNavigationNotice("Drag a box around this Region on one or more score pages.");
  };

  const persistMapping = async (rects: PdfAnchorRect[]) => {
    if (!selectedRegion || !edition) return;
    setSavingMap(true);
    setGraphError(null);
    try {
      const nextMap = replaceEditionRects(
        selectedRegion.pdf_anchor,
        edition.id,
        edition.fingerprint,
        rects,
      );
      const payload: PdfAnchorMap | null = Object.keys(nextMap.editions).length ? nextMap : null;
      const updated = await api.updateRegion(selectedRegion.id, payload);
      setRegions((current) => current.map((region) => region.id === updated.id ? updated : region));
      setMapping(null);
      setNavigationNotice(rects.length ? "Region mapping saved." : "Region mapping cleared.");
    } catch (caught) {
      setGraphError(messageOf(caught));
    } finally {
      setSavingMap(false);
    }
  };

  const chooseEdition = async (nextId: string) => {
    if (nextId === editionId) return;
    setSelecting(true);
    setError(null);
    try {
      await api.select(pieceId, nextId);
      setEditions((current) => current.map((item) => ({ ...item, selected: item.id === nextId })));
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
            {editions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>

        <div className="score-page-controls" aria-label="Page navigation">
          <button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => jumpTo(currentPage - 1)}>‹</button>
          <form onSubmit={(event) => { event.preventDefault(); jumpTo(Number(pageDraft)); }}>
            <input aria-label="Page number" inputMode="numeric" value={pageDraft} onChange={(event) => setPageDraft(event.target.value)} />
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
        <div className="score-body">
          <div className="score-scroll" ref={scrollRef} data-testid="score-scroll">
            <div className="score-pages">
              {Array.from({ length: pageCount }, (_, index) => {
                const pageNumber = index + 1;
                const mappingRegion = mapping
                  ? regions.find((region) => region.id === mapping.regionId) ?? null
                  : null;
                return (
                  <PdfPage
                    key={pageNumber}
                    document={document}
                    pageNumber={pageNumber}
                    active={activePages.has(pageNumber)}
                    scale={scale}
                    onSize={handlePageSize}
                  >
                    <RegionOverlay
                      pageNumber={pageNumber}
                      items={overlayItems}
                      mapping={mapping && mappingRegion ? {
                        regionId: mapping.regionId,
                        label: mappingRegion.name,
                        color: mappingRegion.color,
                        draftRects: mapping.rects,
                        onAddRect: (rect) => setMapping((current) =>
                          current ? { ...current, rects: [...current.rects, rect] } : current,
                        ),
                      } : null}
                      onSelect={selectRegion}
                    />
                  </PdfPage>
                );
              })}
            </div>
          </div>

          <aside className="score-region-panel" aria-label="Score Regions">
            <div className="score-region-panel-head">
              <div>
                <span className="ck-label">Score map</span>
                <h3>Regions</h3>
              </div>
              <span>{regions.length}</span>
            </div>
            {graphError && <p className="ck-inline-error" role="alert">{graphError}</p>}
            {navigationNotice && <p className="score-map-notice" role="status">{navigationNotice}</p>}
            <div className="score-region-list">
              {regions.map((region) => {
                const mapped = edition && anchorForEdition(region.pdf_anchor, edition.id, edition.fingerprint);
                const stale = edition ? editionHasStaleAnchor(region, edition) : false;
                return (
                  <button
                    type="button"
                    key={region.id}
                    className={`score-region-row ${selectedRegionId === region.id ? "is-selected" : ""}`}
                    aria-label={`${region.name}, measures ${region.m_start} to ${region.m_end}`}
                    onClick={() => selectRegion(region.id)}
                  >
                    <span className="score-region-dot" style={{ background: region.color ?? "var(--accent)" }} />
                    <span><strong>{region.name}</strong><small>mm. {region.m_start}–{region.m_end}</small></span>
                    <em className={stale ? "is-stale" : mapped ? "is-mapped" : ""}>
                      {stale ? "remap" : mapped ? `${mapped.rects.length} box${mapped.rects.length === 1 ? "" : "es"}` : "unmapped"}
                    </em>
                  </button>
                );
              })}
            </div>

            {selectedRegion && edition && (
              <div className="score-region-inspector">
                <div>
                  <span className="ck-label">Selected</span>
                  <h4>{selectedRegion.name}</h4>
                  <p>Measures {selectedRegion.m_start}–{selectedRegion.m_end} · {selectedBlocks.length} block{selectedBlocks.length === 1 ? "" : "s"}</p>
                </div>
                {mapping?.regionId === selectedRegion.id ? (
                  <div className="score-map-actions">
                    <p>Drag rectangles on every system or page this Region occupies.</p>
                    <button type="button" aria-label="Undo last mapping box" disabled={mapping.rects.length === 0} onClick={() => setMapping((current) => current ? { ...current, rects: current.rects.slice(0, -1) } : current)}>Undo box</button>
                    <button type="button" aria-label="Save mapping" disabled={savingMap || mapping.rects.length === 0} onClick={() => void persistMapping(mapping.rects)}>Save mapping</button>
                    <button type="button" onClick={() => setMapping(null)}>Cancel</button>
                  </div>
                ) : (
                  <div className="score-map-actions">
                    <button type="button" aria-label={`Map ${selectedRegion.name}`} onClick={() => beginMapping(selectedRegion)}>Map on score</button>
                    {anchorForEdition(selectedRegion.pdf_anchor, edition.id, edition.fingerprint) && (
                      <button type="button" className="is-danger" onClick={() => void persistMapping([])}>Clear this edition</button>
                    )}
                  </div>
                )}
                {selectedBlocks.length > 0 && (
                  <ul className="score-region-blocks">
                    {selectedBlocks.slice(0, 4).map((block) => (
                      <li key={block.block_id}>mm. {block.m_start}–{block.m_end}<span>{block.reps_done} reps</span></li>
                    ))}
                  </ul>
                )}
                {onOpenBlock && (
                  <details className="score-practice-region">
                    <summary>Practice this Region</summary>
                    <BlockForm
                      key={selectedRegion.id}
                      pieceId={pieceId}
                      defaultMeasureStart={selectedRegion.m_start}
                      defaultMeasureEnd={selectedRegion.m_end}
                      defaultLabel={selectedRegion.name}
                      defaultTargetBpm={defaultTargetBpm}
                      onOpen={onOpenBlock}
                      opening={opening}
                    />
                  </details>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
