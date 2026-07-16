import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PDFDocumentLoadingTask, PDFPageProxy } from "pdfjs-dist";
import type { BlockHistory, Region } from "../pieces/types";
import type { RepOpenArgs } from "../rep/useRep";
import { BlockForm } from "../rep/BlockForm";
import {
  anchorForEdition,
  anchorKind,
  replaceEditionRects,
  validAnchorMap,
} from "./anchors";
import { PdfPage } from "./PdfPage";
import { RegionOverlay, type RegionOverlayItem } from "./RegionOverlay";
import { REGION_COLORS, RegionEditor } from "../pieces/RegionEditor";
import { useCrud } from "../rep/useCrud";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { TutorialPanel } from "../tutorials/TutorialPanel";
import { unknownMapping, validMeasureRange } from "./atlas/draft";
import type {
  MappingCandidate,
  PersistentPdfSelectionAnchor,
  TargetMappingState,
} from "./atlas/model";
import type { AtomicTargetSavePayload } from "./atlas/savePayload";
import { TargetDraftEditor, TargetDraftOverlay } from "./atlas/ui";
import { MapScoreWizard } from "./atlas/mapping/MapScoreWizard";
import { candidateFromAnchors } from "./atlas/mapping/candidate";
import type { LineAnchor } from "./atlas/mapping/anchors";
import {
  defaultCalibrationApi,
  pointsToAnchors,
  type CalibrationApi,
} from "./atlas/mapping/calibrationApi";
import {
  clampZoom,
  DEFAULT_PAGE_SIZE,
  fitPageScale,
  fitWidthScale,
  renderWindow,
} from "./geometry";
import type {
  PdfAdapter,
  PdfAnchorKind,
  PdfAnchorMap,
  PdfAnchorRect,
  PdfDocumentHandle,
  PdfEdition,
  PdfPageHandle,
  PdfPageSize,
  ScorePdfApi,
  ScoreFocusContext,
} from "./types";
import "./ScoreView.css";

const PDF_LOAD_TIMEOUT_MS = 30_000;
const PDF_RENDER_TIMEOUT_MESSAGE =
  "PDF rendering did not start in time. Try again or choose another edition.";

interface PdfJsRuntime {
  getDocument: (options: {
    data: Uint8Array;
    cMapUrl: string;
    cMapPacked: boolean;
    iccUrl: string;
    standardFontDataUrl: string;
    wasmUrl: string;
    useWorkerFetch: boolean;
    useWasm: boolean;
    isOffscreenCanvasSupported: boolean;
    isImageDecoderSupported: boolean;
  }) => PDFDocumentLoadingTask;
}

type PdfJsRuntimeLoader = () => Promise<PdfJsRuntime>;

const defaultApi: ScorePdfApi = {
  editions: (pieceId) =>
    invoke<PdfEdition[]>("score_pdf_editions", { pieceId }),
  select: (pieceId, editionId) =>
    invoke<void>("score_pdf_select", { pieceId, editionId }),
  bytes: (pieceId, editionId) =>
    invoke<ArrayBuffer>("score_pdf_bytes", { pieceId, editionId }),
  regions: (pieceId) => invoke<Region[]>("region_list", { pieceId }),
  blocks: (pieceId) =>
    invoke<BlockHistory[]>("rep_blocks_for_piece", { pieceId }),
  updateRegion: (regionId, pdfAnchor) =>
    invoke<Region>("region_update", {
      id: regionId,
      patch: { pdf_anchor: pdfAnchor },
    }),
  createTarget: (payload) =>
    invoke<Region>("score_atlas_target_save", { payload }),
};

function wrapPage(page: PDFPageProxy): PdfPageHandle {
  const base = page.getViewport({ scale: 1 });
  return {
    width: base.width,
    height: base.height,
    cleanup: () => page.cleanup(),
    render: (canvas, scale, devicePixelRatio) => {
      const cssViewport = page.getViewport({ scale });
      const renderViewport = page.getViewport({
        scale: scale * devicePixelRatio,
      });
      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      canvas.style.width = `${Math.max(1, cssViewport.width)}px`;
      canvas.style.height = `${Math.max(1, cssViewport.height)}px`;
      const task = page.render({ canvas, viewport: renderViewport });
      return { promise: task.promise, cancel: () => task.cancel() };
    },
  };
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(message)),
      timeoutMs,
    );
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
      if (
        !bytes ||
        typeof bytes.byteLength !== "number" ||
        bytes.byteLength === 0
      ) {
        throw new Error(
          "The selected PDF is empty or did not arrive as binary data.",
        );
      }

      const timeoutMs = options?.timeoutMs ?? PDF_LOAD_TIMEOUT_MS;
      const taskRef: { current: PDFDocumentLoadingTask | null } = {
        current: null,
      };
      let timedOut = false;
      try {
        const pdfDocument = await withTimeout(
          (async () => {
            // CodaKiller runs inside WKWebView. PDF.js's modern build targets only
            // the newest browser engines, and WebKit does not reliably start an ES
            // module Worker from Tauri's custom app protocol. Loading the matching
            // legacy worker module on the main thread registers WorkerMessageHandler;
            // PDF.js then uses its supported loopback worker instead of waiting on a
            // custom-protocol Worker handshake that may never answer.
            const { getDocument } = await loadRuntime();
            const pdfAssetRoot = new URL("./pdfjs/", document.baseURI);
            const task = getDocument({
              // Uint8Array accepts ArrayBuffers from a different JS realm too; an
              // `instanceof ArrayBuffer` check does not (WKWebView's IPC response is
              // created by Tauri's injected realm).
              data: new Uint8Array(bytes).slice(),
              // Most of Christian's editions are scanned CCITT/JBIG2/JPEG pages.
              // PDF.js otherwise resolves page metadata but silently paints white
              // when its external decoders are absent. These assets are vendored
              // under public/pdfjs and copied verbatim into every app build.
              cMapUrl: new URL("cmaps/", pdfAssetRoot).href,
              cMapPacked: true,
              iccUrl: new URL("iccs/", pdfAssetRoot).href,
              standardFontDataUrl: new URL("standard_fonts/", pdfAssetRoot)
                .href,
              wasmUrl: new URL("wasm/", pdfAssetRoot).href,
              useWorkerFetch: true,
              useWasm: true,
              // WKWebView exposes some newer canvas/image APIs before their worker
              // implementations are reliable enough for PDF.js. The DOM + bundled
              // decoder path is slower but deterministic for a local piano score.
              isOffscreenCanvasSupported: false,
              isImageDecoderSupported: false,
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
          })(),
          timeoutMs,
          PDF_RENDER_TIMEOUT_MESSAGE,
        );

        return {
          numPages: pdfDocument.numPages,
          getPage: async (pageNumber) =>
            wrapPage(await pdfDocument.getPage(pageNumber)),
          destroy: async () => {
            await taskRef.current?.destroy();
          },
        };
      } catch (error) {
        timedOut = true;
        // Cleanup is best-effort and deliberately not awaited. PDF.js destroy()
        // can wait on the same worker startup that triggered this deadline; the
        // visible retryable error must never be gated by an unbounded teardown.
        if (taskRef.current)
          void taskRef.current.destroy().catch(() => undefined);
        throw error;
      }
    },
  };
}

export const pdfJsAdapter = createPdfJsAdapter();

type ViewerPhase =
  "loading-editions" | "no-pdf" | "loading-document" | "ready" | "error";

export interface ScoreViewProps {
  pieceId: number;
  activeRange?: { m_start: number; m_end: number } | null;
  defaultTargetBpm?: number | null;
  defaultCleanStreak?: number;
  onOpenBlock?: (args: RepOpenArgs) => void;
  opening?: boolean;
  onRegionsChanged?: () => void;
  onContextChange?: (context: ScoreFocusContext) => void;
  api?: ScorePdfApi;
  calibrationApi?: CalibrationApi;
  adapter?: PdfAdapter;
  loadTimeoutMs?: number;
}

interface MappingDraft {
  regionId: number;
  rects: PdfAnchorRect[];
  tool: PdfAnchorKind;
}

interface ScoreNavigate {
  kind: "page" | "measure";
  value: number;
}

type ScoreScaleMode = "width" | "page" | "overview" | "manual";
type SectionTab = "practice" | "edit" | "marks" | "tutorial";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function samePages(a: Set<number>, b: Set<number>): boolean {
  return a.size === b.size && [...a].every((page) => b.has(page));
}

function overlaps(
  region: Region,
  range: { m_start: number; m_end: number } | null | undefined,
) {
  return Boolean(
    range && region.m_start <= range.m_end && range.m_start <= region.m_end,
  );
}

function editionHasStaleAnchor(region: Region, edition: PdfEdition): boolean {
  if (!validAnchorMap(region.pdf_anchor)) return false;
  const stored = region.pdf_anchor.editions[edition.id];
  return Boolean(stored && stored.fingerprint !== edition.fingerprint);
}

const TARGET_CANDIDATE_CONFIDENCE = 0.8;
const TARGET_CANDIDATE_THRESHOLD = 0.75;

function rectContains(
  container: PdfAnchorRect,
  selection: PdfAnchorRect,
): boolean {
  const epsilon = 0.000_001;
  return (
    container.page === selection.page &&
    selection.x + epsilon >= container.x &&
    selection.y + epsilon >= container.y &&
    selection.x + selection.w <= container.x + container.w + epsilon &&
    selection.y + selection.h <= container.y + container.h + epsilon
  );
}

/**
 * A Region range is offered only when one, and only one, current-fingerprint
 * mark fully contains the new selection. It remains advisory until the user
 * confirms or corrects it; this deliberately refuses interpolation.
 */
function mappingFromRegionAnchors(
  anchor: PersistentPdfSelectionAnchor,
  pieceId: number,
  edition: PdfEdition,
  regions: Region[],
): TargetMappingState {
  if (
    anchor.edition_id !== edition.id ||
    anchor.edition_fingerprint !== edition.fingerprint ||
    anchor.rects.length !== 1
  ) {
    return unknownMapping(
      "This selection does not belong to the current score edition fingerprint.",
    );
  }
  const selection = anchor.rects[0];
  const matches = regions.flatMap((region) => {
    if (!validMeasureRange({ m_start: region.m_start, m_end: region.m_end }))
      return [];
    const saved = anchorForEdition(
      region.pdf_anchor,
      edition.id,
      edition.fingerprint,
    );
    if (!saved) return [];
    const containingRect = saved.rects.find((rect) =>
      rectContains(rect, selection),
    );
    return containingRect
      ? [{ region, rectIndex: saved.rects.indexOf(containingRect) }]
      : [];
  });
  const uniqueMatches = [
    ...new Map(matches.map((match) => [match.region.id, match])).values(),
  ];
  if (uniqueMatches.length !== 1) {
    return unknownMapping(
      uniqueMatches.length > 1
        ? "More than one same-edition Region contains this mark, so its measures are ambiguous."
        : "No same-edition Region mark fully contains this selection. Measures remain unknown until calibrated.",
    );
  }
  const [{ region, rectIndex }] = uniqueMatches;
  const candidate: MappingCandidate = {
    edition_fingerprint: edition.fingerprint,
    // This identifies the canonical Region-range ledger, not a claimed XML match.
    xml_fingerprint: `canonical-region-range:${pieceId}:${region.id}:${region.m_start}-${region.m_end}`,
    candidate_range: { m_start: region.m_start, m_end: region.m_end },
    confidence: TARGET_CANDIDATE_CONFIDENCE,
    rationale: `The new mark is fully contained by the current-edition mark for “${region.name}” (mm. ${region.m_start}–${region.m_end}); review or correct before asserting it.`,
    calibration_point_ids: [
      `region-anchor:${region.id}:${rectIndex}:${edition.fingerprint}`,
    ],
    authoritative: false,
  };
  return unknownMapping(
    "A same-edition Region supplies a reviewable range candidate.",
    candidate,
  );
}

function newTargetDraftId(pieceId: number): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `score-target-${pieceId}-${Date.now()}`
  );
}

export function ScoreView({
  pieceId,
  activeRange = null,
  defaultTargetBpm = null,
  defaultCleanStreak = 5,
  onOpenBlock,
  opening = false,
  onRegionsChanged,
  onContextChange,
  api = defaultApi,
  calibrationApi = defaultCalibrationApi,
  adapter = pdfJsAdapter,
  loadTimeoutMs = PDF_LOAD_TIMEOUT_MS,
}: ScoreViewProps) {
  const crud = useCrud();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageSizesRef = useRef(new Map<number, PdfPageSize>());
  const intersectionRatios = useRef(new Map<number, number>());
  const graphGeneration = useRef(0);
  const scoreMountedRef = useRef(false);
  const targetSaveGenerationRef = useRef(0);
  const targetSavePendingRef = useRef(false);
  const livePieceIdRef = useRef(pieceId);
  const liveEditionRef = useRef<PdfEdition | null>(null);
  const sectionsBeforeTargetRef = useRef(true);
  // True only while a target draft has force-hidden the sidebar, so a piece
  // switch mid-draft restores it without overriding a manual collapse.
  const sectionsStashedRef = useRef(false);
  const targetInstructionsId = useId();
  const [phase, setPhase] = useState<ViewerPhase>("loading-editions");
  const [error, setError] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [editions, setEditions] = useState<PdfEdition[]>([]);
  const [editionId, setEditionId] = useState<string | null>(null);
  const [document, setDocument] = useState<PdfDocumentHandle | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [blocks, setBlocks] = useState<BlockHistory[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);
  const [expandedRegionId, setExpandedRegionId] = useState<number | null>(null);
  const [sectionTab, setSectionTab] = useState<SectionTab>("practice");
  const [regionQuery, setRegionQuery] = useState("");
  const [mapping, setMapping] = useState<MappingDraft | null>(null);
  const [savingMap, setSavingMap] = useState(false);
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(
    () => new Set([1]),
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDraft, setPageDraft] = useState("1");
  const [manualZoom, setManualZoom] = useState(1);
  const [scaleMode, setScaleMode] = useState<ScoreScaleMode>("width");
  const [sectionsVisible, setSectionsVisible] = useState(true);
  const [containerWidth, setContainerWidth] = useState(900);
  const [containerHeight, setContainerHeight] = useState(700);
  const [maxPageWidth, setMaxPageWidth] = useState(DEFAULT_PAGE_SIZE.width);
  const [maxPageHeight, setMaxPageHeight] = useState(DEFAULT_PAGE_SIZE.height);
  const [reloadToken, setReloadToken] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [addingRegion, setAddingRegion] = useState(false);
  const [newRegionTitle, setNewRegionTitle] = useState("");
  const [newRegionNotes, setNewRegionNotes] = useState("");
  const [newRegionStart, setNewRegionStart] = useState("1");
  const [newRegionEnd, setNewRegionEnd] = useState("1");
  const [creatingRegion, setCreatingRegion] = useState(false);
  const [targetMode, setTargetMode] = useState(false);
  const [targetDraftId, setTargetDraftId] = useState<string | null>(null);
  const [targetAnchor, setTargetAnchor] =
    useState<PersistentPdfSelectionAnchor | null>(null);
  const [targetDrawError, setTargetDrawError] = useState<string | null>(null);
  const [targetSavePending, setTargetSavePending] = useState(false);
  // Line-anchor calibration for the visible edition; the wizard writes it and
  // drawn boxes interpolate against it. Empty = this edition is unmapped.
  const [calibrationAnchors, setCalibrationAnchors] = useState<LineAnchor[]>(
    [],
  );
  const [wizardOpen, setWizardOpen] = useState(false);
  // Auto-offer the wizard once per edition the first time a box lands on an
  // unmapped page; a manual open or dismissal counts as "offered".
  const autoOfferedRef = useRef(false);

  useEffect(() => {
    scoreMountedRef.current = true;
    return () => {
      scoreMountedRef.current = false;
      targetSaveGenerationRef.current += 1;
      targetSavePendingRef.current = false;
    };
  }, []);

  useEffect(() => {
    targetSaveGenerationRef.current += 1;
    targetSavePendingRef.current = false;
    setTargetMode(false);
    setTargetDraftId(null);
    setTargetAnchor(null);
    setTargetDrawError(null);
    setTargetSavePending(false);
    setCalibrationAnchors([]);
    setWizardOpen(false);
    autoOfferedRef.current = false;
    // A draft in progress force-hid the sidebar; entering the new piece with it
    // stuck hidden strands the tricky-sections panel, so restore what it stashed.
    if (sectionsStashedRef.current) {
      setSectionsVisible(sectionsBeforeTargetRef.current);
      sectionsStashedRef.current = false;
    }
  }, [pieceId]);

  const loadGraph = useCallback(async () => {
    const generation = ++graphGeneration.current;
    setGraphError(null);
    try {
      const [nextRegions, nextBlocks] = await Promise.all([
        api.regions(pieceId),
        api.blocks(pieceId),
      ]);
      if (generation !== graphGeneration.current) return;
      const safeRegions = nextRegions ?? [];
      setRegions(safeRegions);
      setBlocks(nextBlocks ?? []);
      setSelectedRegionId((current) =>
        current != null && safeRegions.some((region) => region.id === current)
          ? current
          : null,
      );
      setExpandedRegionId((current) =>
        current != null && safeRegions.some((region) => region.id === current)
          ? current
          : null,
      );
    } catch (caught) {
      if (generation === graphGeneration.current)
        setGraphError(messageOf(caught));
    }
  }, [api, pieceId]);

  useEffect(() => {
    setRegions([]);
    setBlocks([]);
    setSelectedRegionId(null);
    setExpandedRegionId(null);
    setMapping(null);
    void loadGraph();
  }, [loadGraph, reloadToken]);

  useEffect(() => {
    let alive = true;
    setPhase("loading-editions");
    setError(null);
    setEditions([]);
    setEditionId(null);
    setDocument(null);
    pageSizesRef.current.clear();
    setMaxPageWidth(DEFAULT_PAGE_SIZE.width);
    setMaxPageHeight(DEFAULT_PAGE_SIZE.height);

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
        setEditionId((next.find((edition) => edition.selected) ?? next[0]).id);
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
    if (!editionId || !editions.some((edition) => edition.id === editionId))
      return;
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
    setMaxPageHeight(DEFAULT_PAGE_SIZE.height);

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
    const update = () => {
      setContainerWidth(root.clientWidth || 900);
      setContainerHeight(root.clientHeight || 700);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, [phase]);

  useEffect(() => {
    const root = scrollRef.current;
    if (
      !document ||
      phase !== "ready" ||
      !root ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    intersectionRatios.current.clear();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (Number.isInteger(page)) {
            intersectionRatios.current.set(
              page,
              entry.isIntersecting ? entry.intersectionRatio : 0,
            );
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
        if (next.size > 0)
          setVisiblePages((previous) =>
            samePages(previous, next) ? previous : next,
          );
      },
      { root, threshold: [0, 0.05, 0.25, 0.5, 0.75] },
    );
    root
      .querySelectorAll<HTMLElement>("[data-page-number]")
      .forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [document, phase]);

  const pageCount = document?.numPages ?? 0;
  const activePages = useMemo(
    () => renderWindow(visiblePages, pageCount),
    [pageCount, visiblePages],
  );
  const scale =
    scaleMode === "width"
      ? fitWidthScale(containerWidth, maxPageWidth, 40)
      : scaleMode === "page"
        ? fitPageScale(
            containerWidth,
            containerHeight,
            maxPageWidth,
            maxPageHeight,
            40,
            40,
          )
        : scaleMode === "overview"
          ? clampZoom((containerWidth - 64) / (maxPageWidth * 2))
          : clampZoom(manualZoom);
  const edition = editions.find((item) => item.id === editionId) ?? null;
  const selectedRegion =
    regions.find((region) => region.id === selectedRegionId) ?? null;
  useLayoutEffect(() => {
    livePieceIdRef.current = pieceId;
    liveEditionRef.current = edition;
  }, [edition, pieceId]);

  // Load the visible edition's saved calibration so drawn boxes resolve to
  // measures. Empty on a fingerprint the wizard has not mapped yet.
  const editionKey = edition ? `${edition.id}::${edition.fingerprint}` : null;
  useEffect(() => {
    if (!edition) {
      setCalibrationAnchors([]);
      return;
    }
    let alive = true;
    autoOfferedRef.current = false;
    void calibrationApi
      .get(pieceId, {
        edition_id: edition.id,
        edition_fingerprint: edition.fingerprint,
      })
      .then((view) => {
        if (!alive) return;
        setCalibrationAnchors(view ? pointsToAnchors(view.points) : []);
      })
      .catch(() => {
        if (alive) setCalibrationAnchors([]);
      });
    return () => {
      alive = false;
    };
    // editionKey captures the identity we key on; pieceId + api complete it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibrationApi, editionKey, pieceId]);
  useEffect(() => {
    onContextChange?.({
      region: selectedRegion
        ? {
            id: selectedRegion.id,
            name: selectedRegion.name,
            notes: selectedRegion.notes,
            m_start: selectedRegion.m_start,
            m_end: selectedRegion.m_end,
          }
        : null,
      current_page: currentPage,
      edition_id: edition?.id ?? null,
      edition_label: edition?.label ?? null,
    });
  }, [
    currentPage,
    edition?.id,
    edition?.label,
    onContextChange,
    selectedRegion,
  ]);
  const displayedRegions = useMemo(() => {
    const query = regionQuery.trim().toLocaleLowerCase();
    return [...regions]
      .filter(
        (region) =>
          !query ||
          `${region.name} ${region.notes ?? ""} ${region.m_start} ${region.m_end}`
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort(
        (a, b) =>
          a.m_start - b.m_start ||
          a.m_end - b.m_end ||
          a.name.localeCompare(b.name),
      );
  }, [regionQuery, regions]);

  const resolveTargetMapping = useCallback(
    (anchor: PersistentPdfSelectionAnchor): TargetMappingState => {
      if (!edition) {
        return unknownMapping(
          "No current score edition is available for this selection.",
        );
      }
      const fromRegion = mappingFromRegionAnchors(
        anchor,
        pieceId,
        edition,
        regions,
      );
      // A containing same-edition Region wins (it is the tighter evidence).
      if (fromRegion.status !== "unknown" || fromRegion.candidate) {
        return fromRegion;
      }
      // Otherwise interpolate from the saved line-anchor calibration. This is
      // what turns a fresh box into an editable measure range instead of the
      // old mapping-required dead end.
      const rect = anchor.rects[0];
      if (rect && calibrationAnchors.length > 0) {
        const candidate = candidateFromAnchors(
          {
            page: rect.page,
            xPct: rect.x,
            yPct: rect.y,
            wPct: rect.w,
            hPct: rect.h,
          },
          calibrationAnchors,
          {
            edition_id: edition.id,
            edition_fingerprint: edition.fingerprint,
          },
        );
        if (candidate) {
          return unknownMapping(
            "Interpolated from this score's map; review or correct the measures.",
            candidate,
          );
        }
      }
      return fromRegion;
    },
    [calibrationAnchors, edition, pieceId, regions],
  );

  const cancelTargetDraft = useCallback(() => {
    if (targetSavePendingRef.current) return;
    setTargetMode(false);
    setTargetDraftId(null);
    setTargetAnchor(null);
    setTargetDrawError(null);
    setSectionsVisible(sectionsBeforeTargetRef.current);
    sectionsStashedRef.current = false;
    setNavigationNotice(null);
  }, []);

  const toggleTargetMode = useCallback(() => {
    if (targetMode) {
      cancelTargetDraft();
      return;
    }
    if (mapping) {
      setNavigationNotice(
        "Save or cancel the open score-mark edits before drawing a new target.",
      );
      return;
    }
    sectionsBeforeTargetRef.current = sectionsVisible;
    sectionsStashedRef.current = true;
    setSectionsVisible(false);
    setTargetDraftId(newTargetDraftId(pieceId));
    setTargetAnchor(null);
    setTargetDrawError(null);
    setNavigationNotice(
      "Draw one rectangle directly on the visible score page.",
    );
    setTargetMode(true);
  }, [cancelTargetDraft, mapping, pieceId, sectionsVisible, targetMode]);

  const acceptTargetSelection = useCallback(
    (anchor: PersistentPdfSelectionAnchor) => {
      if (targetSavePendingRef.current) return;
      setTargetAnchor(anchor);
      setTargetDrawError(null);
      // First box on a still-unmapped edition: auto-offer the wizard once so a
      // box drawn on a fresh score isn't a dead end.
      const page = anchor.rects[0]?.page;
      const pageMapped =
        page != null && calibrationAnchors.some((line) => line.page === page);
      if (
        !autoOfferedRef.current &&
        calibrationAnchors.length === 0 &&
        !pageMapped
      ) {
        autoOfferedRef.current = true;
        setWizardOpen(true);
      }
    },
    [calibrationAnchors],
  );

  const openWizard = useCallback(() => {
    autoOfferedRef.current = true;
    setWizardOpen(true);
  }, []);

  const saveTarget = useCallback(
    async (payload: AtomicTargetSavePayload) => {
      const liveEdition = liveEditionRef.current;
      if (
        payload.piece_id !== livePieceIdRef.current ||
        !payload.edition ||
        !payload.anchor ||
        !liveEdition ||
        payload.edition.edition_id !== liveEdition.id ||
        payload.edition.edition_fingerprint !== liveEdition.fingerprint ||
        payload.anchor.edition_id !== liveEdition.id ||
        payload.anchor.edition_fingerprint !== liveEdition.fingerprint
      ) {
        throw new Error(
          "This target belongs to a stale score edition fingerprint. Draw it again on the visible edition.",
        );
      }
      if (targetSavePendingRef.current) {
        throw new Error("This target save is already in progress.");
      }

      const generation = ++targetSaveGenerationRef.current;
      targetSavePendingRef.current = true;
      setTargetSavePending(true);
      const ownsResult = () =>
        scoreMountedRef.current &&
        generation === targetSaveGenerationRef.current &&
        livePieceIdRef.current === payload.piece_id &&
        liveEditionRef.current?.id === payload.edition?.edition_id &&
        liveEditionRef.current?.fingerprint ===
          payload.edition?.edition_fingerprint;
      try {
        const created = await api.createTarget(payload);
        if (
          !created ||
          !Number.isSafeInteger(created.id) ||
          created.id < 1 ||
          created.piece_id !== payload.piece_id ||
          !validMeasureRange({ m_start: created.m_start, m_end: created.m_end })
        ) {
          throw new Error("Target save returned an invalid Region receipt.");
        }
        if (!ownsResult()) return;
        await loadGraph();
        if (!ownsResult()) return;
        setRegions((current) => {
          const existingIndex = current.findIndex(
            (region) => region.id === created.id,
          );
          if (existingIndex < 0) return [...current, created];
          return current.map((region, index) =>
            index === existingIndex ? created : region,
          );
        });
        setSelectedRegionId(created.id);
        setExpandedRegionId(created.id);
        setSectionTab("practice");
        setSectionsVisible(true);
        sectionsStashedRef.current = false;
        setTargetMode(false);
        setTargetDraftId(null);
        setTargetAnchor(null);
        setTargetDrawError(null);
        setNavigationNotice(
          `Target saved as “${created.name}” and reopened for practice.`,
        );
        onRegionsChanged?.();
      } finally {
        if (generation === targetSaveGenerationRef.current) {
          targetSavePendingRef.current = false;
          if (scoreMountedRef.current) setTargetSavePending(false);
        }
      }
    },
    [api, loadGraph, onRegionsChanged],
  );

  const handlePageSize = useCallback((page: number, size: PdfPageSize) => {
    pageSizesRef.current.set(page, size);
    setMaxPageWidth((current) => Math.max(current, size.width));
    setMaxPageHeight((current) => Math.max(current, size.height));
  }, []);

  const jumpTo = useCallback(
    (requested: number) => {
      if (!document) return;
      const page = Math.min(
        document.numPages,
        Math.max(1, Math.round(requested)),
      );
      setCurrentPage(page);
      setPageDraft(String(page));
      setVisiblePages(new Set([page]));
      const root = scrollRef.current;
      const target = root?.querySelector<HTMLElement>(
        `[data-page-number="${page}"]`,
      );
      if (page !== currentPage && root && target) {
        root.scrollTo?.({ top: target.offsetTop, behavior: "smooth" });
      }
    },
    [currentPage, document],
  );

  const selectRegion = useCallback(
    (regionId: number) => {
      if (mapping && mapping.regionId !== regionId) {
        setNavigationNotice(
          "Save or cancel the open score-mark edits before switching sections.",
        );
        return;
      }
      setSelectedRegionId(regionId);
      setExpandedRegionId(regionId);
      setSectionTab("practice");
      setNavigationNotice(null);
      if (!edition) return;
      const region = regions.find((item) => item.id === regionId);
      const rect =
        region &&
        anchorForEdition(region.pdf_anchor, edition.id, edition.fingerprint)
          ?.rects[0];
      if (rect) jumpTo(rect.page);
    },
    [edition, jumpTo, mapping, regions],
  );

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
        .filter(
          (region) =>
            region.m_start <= target.value && target.value <= region.m_end,
        )
        .sort((a, b) => a.m_end - a.m_start - (b.m_end - b.m_start));
      const mapped = candidates.find((region) =>
        Boolean(
          anchorForEdition(region.pdf_anchor, edition.id, edition.fingerprint)
            ?.rects[0],
        ),
      );
      if (mapped) {
        selectRegion(mapped.id);
      } else {
        setNavigationNotice(
          `Measure ${target.value} is not mapped in this edition yet.`,
        );
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, [edition, jumpTo, regions, selectRegion]);

  const overlayItems: RegionOverlayItem[] = useMemo(() => {
    if (!edition) return [];
    return regions.map((region) => ({
      regionId: region.id,
      label: region.notes ?? region.name,
      color: region.color,
      rects:
        anchorForEdition(region.pdf_anchor, edition.id, edition.fingerprint)
          ?.rects ?? [],
      selected: region.id === selectedRegionId,
      active: overlaps(region, activeRange),
    }));
  }, [activeRange, edition, regions, selectedRegionId]);

  const beginMapping = (region: Region) => {
    if (targetMode) {
      setNavigationNotice(
        "Cancel the target draft before editing existing score marks.",
      );
      return;
    }
    if (!edition) return;
    const existing =
      anchorForEdition(region.pdf_anchor, edition.id, edition.fingerprint)
        ?.rects ?? [];
    setSelectedRegionId(region.id);
    setExpandedRegionId(region.id);
    setSectionTab("marks");
    setMapping({ regionId: region.id, rects: [...existing], tool: "box" });
    setNavigationNotice(
      "Choose Box, Highlight, or Note, then drag directly on the score.",
    );
  };

  const graphChanged = async () => {
    await loadGraph();
    onRegionsChanged?.();
  };

  const createRegion = async () => {
    if (targetMode) {
      setGraphError(
        "Cancel the open target draft before creating a section through the legacy form.",
      );
      return;
    }
    const mStart = Number(newRegionStart);
    const mEnd = Number(newRegionEnd);
    if (
      !newRegionTitle.trim() ||
      !Number.isInteger(mStart) ||
      !Number.isInteger(mEnd) ||
      mStart < 1 ||
      mEnd < mStart
    ) {
      setGraphError("Enter a section title and a valid measure range.");
      return;
    }
    setCreatingRegion(true);
    setGraphError(null);
    try {
      const created = await crud.regionCreate({
        piece_id: pieceId,
        name: newRegionTitle.trim(),
        notes: newRegionNotes.trim() || null,
        m_start: mStart,
        m_end: mEnd,
        kind: "hard_spot",
      });
      const colored = await crud.regionUpdate(created.id, {
        color: REGION_COLORS[regions.length % REGION_COLORS.length],
      });
      await graphChanged();
      setSelectedRegionId(colored.id);
      setExpandedRegionId(colored.id);
      setSectionTab("marks");
      setMapping({ regionId: colored.id, rects: [], tool: "box" });
      setNewRegionTitle("");
      setNewRegionNotes("");
      setNewRegionStart(String(mEnd + 1));
      setNewRegionEnd(String(mEnd + 1));
      setAddingRegion(false);
      setNavigationNotice(
        "New tricky section saved. Drag its first score annotation.",
      );
    } catch (caught) {
      setGraphError(messageOf(caught));
    } finally {
      setCreatingRegion(false);
    }
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
      const payload: PdfAnchorMap | null = Object.keys(nextMap.editions).length
        ? nextMap
        : null;
      const updated = await api.updateRegion(selectedRegion.id, payload);
      setRegions((current) =>
        current.map((region) => (region.id === updated.id ? updated : region)),
      );
      setMapping(null);
      setNavigationNotice(
        rects.length ? "Region mapping saved." : "Region mapping cleared.",
      );
    } catch (caught) {
      setGraphError(messageOf(caught));
    } finally {
      setSavingMap(false);
    }
  };

  const chooseEdition = async (nextId: string) => {
    if (nextId === editionId || targetSavePendingRef.current) return;
    setSelecting(true);
    setError(null);
    try {
      await api.select(pieceId, nextId);
      setEditions((current) =>
        current.map((item) => ({ ...item, selected: item.id === nextId })),
      );
      setEditionId(nextId);
    } catch (caught) {
      setError(messageOf(caught));
      setPhase("error");
    } finally {
      setSelecting(false);
    }
  };

  const renderRegionInspector = (region: Region) => {
    if (!edition) return null;
    const regionBlocks = blocks.filter(
      (block) => block.region_id === region.id,
    );
    const savedAnchor = anchorForEdition(
      region.pdf_anchor,
      edition.id,
      edition.fingerprint,
    );
    const mappingThisRegion = mapping?.regionId === region.id ? mapping : null;
    return (
      <div
        className="score-region-inspector"
        aria-label={`${region.name} controls`}
      >
        <div
          className="score-section-tabs"
          role="tablist"
          aria-label={`${region.name} actions`}
        >
          {(
            [
              ["practice", "Practice"],
              ["edit", "Edit"],
              ["marks", "Score marks"],
              ["tutorial", "Tutorial"],
            ] as [SectionTab, string][]
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={sectionTab === tab}
              className={sectionTab === tab ? "is-active" : ""}
              onClick={() => setSectionTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>

        {sectionTab === "edit" && (
          <RegionEditor
            region={region}
            regions={regions}
            blocks={regionBlocks}
            alwaysOpen
            onChanged={graphChanged}
          />
        )}

        {sectionTab === "marks" &&
          (mappingThisRegion ? (
            <div className="score-map-actions">
              <p>
                Drag on the score to add a mark. Drag an existing mark to move
                it; drag its corner to resize. Text notes use this section’s
                Practice notes.
              </p>
              <div
                className="score-annotation-tools"
                role="radiogroup"
                aria-label="Score annotation tool"
              >
                {(["box", "highlight", "note"] as PdfAnchorKind[]).map(
                  (tool) => (
                    <button
                      key={tool}
                      type="button"
                      role="radio"
                      aria-checked={mappingThisRegion.tool === tool}
                      className={mappingThisRegion.tool === tool ? "is-on" : ""}
                      onClick={() =>
                        setMapping((current) =>
                          current ? { ...current, tool } : current,
                        )
                      }
                    >
                      {tool === "box"
                        ? "Selection box"
                        : tool === "highlight"
                          ? "Highlight"
                          : "Text note"}
                    </button>
                  ),
                )}
              </div>
              {mappingThisRegion.rects.length > 0 && (
                <ol className="score-annotation-list">
                  {mappingThisRegion.rects.map((rect, index) => (
                    <li key={`${rect.page}-${index}`}>
                      <button
                        type="button"
                        className="score-annotation-jump"
                        onClick={() => jumpTo(rect.page)}
                      >
                        {anchorKind(rect) === "box"
                          ? "Selection box"
                          : anchorKind(rect) === "highlight"
                            ? "Highlight"
                            : "Text note"}{" "}
                        · page {rect.page}
                      </button>
                      <div className="score-annotation-row-actions">
                        <select
                          aria-label={`Annotation ${index + 1} type`}
                          value={anchorKind(rect)}
                          onChange={(event) =>
                            setMapping((current) => {
                              if (!current) return current;
                              const kind = event.target.value as PdfAnchorKind;
                              return {
                                ...current,
                                rects: current.rects.map((item, itemIndex) => {
                                  if (itemIndex !== index) return item;
                                  const { kind: _oldKind, ...geometry } = item;
                                  return kind === "box"
                                    ? geometry
                                    : { ...geometry, kind };
                                }),
                              };
                            })
                          }
                        >
                          <option value="box">Selection box</option>
                          <option value="highlight">Highlight</option>
                          <option value="note">Text note</option>
                        </select>
                        <ConfirmDelete
                          label={`Remove this ${anchorKind(rect)} from page ${rect.page}? This remains a draft until Save changes.`}
                          onConfirm={async () =>
                            setMapping((current) =>
                              current
                                ? {
                                    ...current,
                                    rects: current.rects.filter(
                                      (_, itemIndex) => itemIndex !== index,
                                    ),
                                  }
                                : current,
                            )
                          }
                        >
                          <button type="button">Remove</button>
                        </ConfirmDelete>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <button
                type="button"
                aria-label="Undo last score annotation"
                disabled={mappingThisRegion.rects.length === 0}
                onClick={() =>
                  setMapping((current) =>
                    current
                      ? { ...current, rects: current.rects.slice(0, -1) }
                      : current,
                  )
                }
              >
                Undo last
              </button>
              <button
                type="button"
                aria-label="Save score annotations"
                disabled={savingMap}
                onClick={() => void persistMapping(mappingThisRegion.rects)}
              >
                Save changes
              </button>
              <button type="button" onClick={() => setMapping(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="score-map-actions">
              {savedAnchor?.rects.length ? (
                <ol className="score-annotation-list score-saved-annotation-list">
                  {savedAnchor.rects.map((rect, index) => (
                    <li key={`${rect.page}-${index}`}>
                      <button
                        type="button"
                        className="score-annotation-jump"
                        onClick={() => jumpTo(rect.page)}
                      >
                        Go to{" "}
                        {anchorKind(rect) === "box" ? "box" : anchorKind(rect)}{" "}
                        {index + 1} · page {rect.page}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No score marks in this edition yet.</p>
              )}
              <button
                type="button"
                aria-label={`Edit score annotations for ${region.name}`}
                onClick={() => beginMapping(region)}
              >
                {savedAnchor ? "Edit score marks" : "Add to score"}
              </button>
              {savedAnchor && (
                <ConfirmDelete
                  label={`Delete every score box, highlight, and note for “${region.name}” in this edition? The Tricky Section and its practice history will stay.`}
                  onConfirm={() => persistMapping([])}
                >
                  <button type="button" className="is-danger">
                    Clear this edition
                  </button>
                </ConfirmDelete>
              )}
            </div>
          ))}

        {sectionTab === "practice" && onOpenBlock && (
          <section
            className="score-practice-region"
            aria-label="Start a practice set"
          >
            <div className="score-practice-region-head">
              <strong>Practice {region.name}</strong>
              <span>
                This block stays linked to this section. Change the section
                itself under Edit.
              </span>
            </div>
            {regionBlocks.length > 0 && (
              <ul className="score-region-blocks">
                {regionBlocks.slice(0, 4).map((block) => {
                  const attempts =
                    block.attempts_recorded ?? block.tries ?? block.reps_done;
                  const mastery = block.mastery_verified
                    ? block.mastery_status === "satisfied"
                      ? "mastery verified"
                      : "mastery not yet"
                    : "mastery unverified";
                  return (
                    <li key={block.block_id}>
                      mm. {block.m_start}–{block.m_end}
                      <span>
                        {attempts} attempts · {mastery}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <BlockForm
              key={`${region.id}:${region.name}:${region.m_start}:${region.m_end}`}
              pieceId={pieceId}
              regionId={region.id}
              defaultMeasureStart={region.m_start}
              defaultMeasureEnd={region.m_end}
              defaultLabel={region.name}
              defaultTargetBpm={defaultTargetBpm}
              defaultCleanStreak={defaultCleanStreak}
              onOpen={onOpenBlock}
              opening={opening}
            />
          </section>
        )}

        {sectionTab === "tutorial" && (
          <TutorialPanel pieceId={pieceId} regionId={region.id} />
        )}
      </div>
    );
  };

  if (phase === "loading-editions") {
    return (
      <div className="score-state" role="status">
        Finding score editions…
      </div>
    );
  }
  if (phase === "no-pdf") {
    return (
      <div className="score-state score-empty">
        <strong>No PDF score found.</strong>
        <span>
          Add a PDF to this piece’s score folder, then rescan the piece.
        </span>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="score-state score-error" role="alert">
        <strong>Score could not be opened.</strong>
        <span>{error}</span>
        <button
          type="button"
          onClick={() => setReloadToken((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <section className="score-view" aria-label="PDF score viewer">
      <header className="score-toolbar">
        <div className="score-edition-group">
          <label className="score-edition">
            <span>Edition</span>
            <select
              aria-label="Score edition"
              value={editionId ?? ""}
              disabled={
                selecting || targetSavePending || phase === "loading-document"
              }
              onChange={(event) => void chooseEdition(event.target.value)}
            >
              {editions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`score-draw-target ${targetMode ? "is-active" : ""}`}
            aria-pressed={targetMode}
            disabled={targetSavePending || phase !== "ready" || !edition}
            onClick={toggleTargetMode}
          >
            {targetMode ? "Cancel drawing" : "Draw target"}
          </button>
          <button
            type="button"
            className="score-map-score"
            disabled={phase !== "ready" || !edition}
            onClick={openWizard}
          >
            {calibrationAnchors.length > 0
              ? "Edit score map"
              : "Map this score"}
          </button>
          <span
            id={targetInstructionsId}
            className="score-atlas-draw-instructions"
          >
            Drag one rectangle directly on a rendered score page. Its normalized
            geometry stays independent of zoom.
          </span>
        </div>

        <div className="score-page-controls" aria-label="Page navigation">
          <button
            type="button"
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => jumpTo(currentPage - 1)}
          >
            ‹
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              jumpTo(Number(pageDraft));
            }}
          >
            <input
              aria-label="Page number"
              inputMode="numeric"
              value={pageDraft}
              onChange={(event) => setPageDraft(event.target.value)}
            />
            <span>of {pageCount || "—"}</span>
          </form>
          <button
            type="button"
            aria-label="Next page"
            disabled={currentPage >= pageCount}
            onClick={() => jumpTo(currentPage + 1)}
          >
            ›
          </button>
        </div>

        <div className="score-zoom" aria-label="Score zoom">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              setScaleMode("manual");
              setManualZoom(clampZoom(scale - 0.1));
            }}
          >
            −
          </button>
          <span aria-label="Zoom level">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              setScaleMode("manual");
              setManualZoom(clampZoom(scale + 0.1));
            }}
          >
            +
          </button>
          <input
            aria-label="Score zoom slider"
            type="range"
            min="25"
            max="200"
            step="5"
            value={Math.round(scale * 100)}
            onChange={(event) => {
              setScaleMode("manual");
              setManualZoom(Number(event.target.value) / 100);
            }}
          />
          <button
            type="button"
            className={scaleMode === "width" ? "is-active" : ""}
            onClick={() => setScaleMode("width")}
          >
            Fit width
          </button>
          <button
            type="button"
            className={scaleMode === "page" ? "is-active" : ""}
            onClick={() => setScaleMode("page")}
          >
            Fit page
          </button>
          <button
            type="button"
            className={scaleMode === "overview" ? "is-active" : ""}
            onClick={() => setScaleMode("overview")}
          >
            2-page view
          </button>
        </div>
      </header>

      {phase === "loading-document" || !document ? (
        <div className="score-state" role="status">
          Loading PDF…
        </div>
      ) : (
        <div
          className={`score-body ${sectionsVisible ? "" : "is-sections-hidden"}`}
        >
          <div
            className="score-scroll"
            ref={scrollRef}
            data-testid="score-scroll"
          >
            <div
              className={`score-pages ${scaleMode === "overview" ? "is-overview" : ""}`}
            >
              {Array.from({ length: pageCount }, (_, index) => {
                const pageNumber = index + 1;
                const mappingRegion = mapping
                  ? (regions.find((region) => region.id === mapping.regionId) ??
                    null)
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
                      mapping={
                        mapping && mappingRegion
                          ? {
                              regionId: mapping.regionId,
                              label: mappingRegion.notes ?? mappingRegion.name,
                              color: mappingRegion.color,
                              draftRects: mapping.rects,
                              tool: mapping.tool,
                              onAddRect: (rect) =>
                                setMapping((current) =>
                                  current
                                    ? {
                                        ...current,
                                        rects: [...current.rects, rect],
                                      }
                                    : current,
                                ),
                              onUpdateRect: (index, rect) =>
                                setMapping((current) =>
                                  current
                                    ? {
                                        ...current,
                                        rects: current.rects.map(
                                          (item, itemIndex) =>
                                            itemIndex === index ? rect : item,
                                        ),
                                      }
                                    : current,
                                ),
                            }
                          : null
                      }
                      onSelect={selectRegion}
                    />
                    {targetMode && targetDraftId && edition && (
                      <TargetDraftOverlay
                        pageNumber={pageNumber}
                        edition={{
                          edition_id: edition.id,
                          edition_fingerprint: edition.fingerprint,
                        }}
                        selectedAnchor={targetAnchor}
                        instructionsId={targetInstructionsId}
                        disabled={targetSavePending}
                        onSelection={acceptTargetSelection}
                        onSelectionError={(_code, message) =>
                          setTargetDrawError(message)
                        }
                      />
                    )}
                  </PdfPage>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            className="score-sidebar-toggle"
            aria-controls="score-region-panel"
            aria-expanded={sectionsVisible}
            aria-label={
              sectionsVisible
                ? "Collapse tricky sections"
                : "Expand tricky sections"
            }
            onClick={() => setSectionsVisible((visible) => !visible)}
          >
            <span aria-hidden="true">{sectionsVisible ? "›" : "‹"}</span>
          </button>

          <aside
            id="score-region-panel"
            className="score-region-panel"
            aria-label="Score Regions"
          >
            <div className="score-region-panel-head">
              <div>
                <span className="ck-label">Score map</span>
                <h3>Tricky sections</h3>
              </div>
              <span>{regions.length}</span>
            </div>
            {graphError && (
              <p className="ck-inline-error" role="alert">
                {graphError}
              </p>
            )}
            {navigationNotice && (
              <p className="score-map-notice" role="status">
                {navigationNotice}
              </p>
            )}
            <div className="score-region-tools">
              <input
                aria-label="Search tricky sections"
                type="search"
                value={regionQuery}
                placeholder="Search titles, notes, measures…"
                onChange={(event) => setRegionQuery(event.target.value)}
              />
              <button
                type="button"
                aria-expanded={addingRegion}
                onClick={() => setAddingRegion((value) => !value)}
              >
                {addingRegion ? "Cancel" : "+ Add"}
              </button>
            </div>
            {addingRegion && (
              <form
                className="score-add-region-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createRegion();
                }}
              >
                <label>
                  <span>Section title</span>
                  <input
                    autoFocus
                    aria-label="New score tricky section title"
                    maxLength={500}
                    value={newRegionTitle}
                    onChange={(event) => setNewRegionTitle(event.target.value)}
                  />
                </label>
                <label>
                  <span>Practice notes</span>
                  <textarea
                    aria-label="New score tricky section practice notes"
                    maxLength={10000}
                    value={newRegionNotes}
                    onChange={(event) => setNewRegionNotes(event.target.value)}
                  />
                </label>
                <div>
                  <label>
                    <span>From measure</span>
                    <input
                      aria-label="New score tricky section start measure"
                      type="number"
                      min="1"
                      value={newRegionStart}
                      onChange={(event) =>
                        setNewRegionStart(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>To measure</span>
                    <input
                      aria-label="New score tricky section end measure"
                      type="number"
                      min="1"
                      value={newRegionEnd}
                      onChange={(event) => setNewRegionEnd(event.target.value)}
                    />
                  </label>
                </div>
                <button type="submit" disabled={creatingRegion}>
                  {creatingRegion ? "Creating…" : "Create + mark score"}
                </button>
              </form>
            )}
            <p className="score-region-order-note">
              In score order · click a section to open its tools
            </p>
            <div className="score-region-list">
              {displayedRegions.map((region) => {
                const mapped =
                  edition &&
                  anchorForEdition(
                    region.pdf_anchor,
                    edition.id,
                    edition.fingerprint,
                  );
                const stale = edition
                  ? editionHasStaleAnchor(region, edition)
                  : false;
                const expanded = expandedRegionId === region.id;
                const noteSummary =
                  region.notes?.trim() &&
                  region.notes.trim() !== region.name.trim()
                    ? region.notes.trim()
                    : null;
                return (
                  <div
                    className={`score-region-item ${expanded ? "is-expanded" : ""}`}
                    key={region.id}
                  >
                    <button
                      type="button"
                      className={`score-region-row ${selectedRegionId === region.id ? "is-selected" : ""}`}
                      aria-expanded={expanded}
                      aria-label={`${region.name}, measures ${region.m_start} to ${region.m_end}`}
                      onClick={() => {
                        if (expanded) {
                          if (mapping?.regionId === region.id) {
                            setNavigationNotice(
                              "Save or cancel the open score-mark edits before closing this section.",
                            );
                            return;
                          }
                          setExpandedRegionId(null);
                          return;
                        }
                        selectRegion(region.id);
                      }}
                    >
                      <span
                        className="score-region-dot"
                        style={{ background: region.color ?? "var(--accent)" }}
                      />
                      <span>
                        <strong>{region.name}</strong>
                        <small>
                          mm. {region.m_start}–{region.m_end}
                          {noteSummary ? ` · ${noteSummary}` : ""}
                        </small>
                      </span>
                      <em
                        className={
                          stale ? "is-stale" : mapped ? "is-mapped" : ""
                        }
                      >
                        {stale
                          ? "remap"
                          : mapped
                            ? `${mapped.rects.length} mark${mapped.rects.length === 1 ? "" : "s"}`
                            : "unmapped"}
                      </em>
                      <span className="score-region-chevron" aria-hidden="true">
                        {expanded ? "⌄" : "›"}
                      </span>
                    </button>
                    {expanded && renderRegionInspector(region)}
                  </div>
                );
              })}
              {displayedRegions.length === 0 && (
                <p className="tutorial-empty">No sections match that search.</p>
              )}
            </div>
          </aside>

          {targetMode && targetDraftId && edition && (
            <aside
              className="score-atlas-draft-dock"
              aria-label="New target draft editor"
            >
              <TargetDraftEditor
                key={targetDraftId}
                draftId={targetDraftId}
                pieceId={pieceId}
                edition={{
                  edition_id: edition.id,
                  edition_fingerprint: edition.fingerprint,
                }}
                pageNumber={targetAnchor?.rects[0]?.page ?? currentPage}
                minimumCandidateConfidence={TARGET_CANDIDATE_THRESHOLD}
                resolveMapping={resolveTargetMapping}
                initialAnchor={targetAnchor}
                onSelectionChange={acceptTargetSelection}
                externalScoreSurface
                externalError={targetDrawError}
                onSave={saveTarget}
                onCancel={cancelTargetDraft}
                onRequestMapping={openWizard}
              />
            </aside>
          )}
        </div>
      )}

      {wizardOpen && edition && (
        <MapScoreWizard
          pieceId={pieceId}
          edition={{
            edition_id: edition.id,
            edition_fingerprint: edition.fingerprint,
          }}
          pageCount={pageCount}
          initialAnchors={calibrationAnchors}
          onSaved={(_view, anchors) => {
            setCalibrationAnchors(anchors);
            setWizardOpen(false);
            setNavigationNotice(
              "Score map saved. Drawn boxes now resolve to measures.",
            );
          }}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </section>
  );
}
