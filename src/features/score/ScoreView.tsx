import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PDFDocumentLoadingTask, PDFPageProxy } from "pdfjs-dist";
import type { BlockHistory, Region } from "../pieces/types";
import type { RepOpenArgs, SetFocusContextInput } from "../rep/useRep";
import { BlockForm } from "../rep/BlockForm";
import {
  anchorForEdition,
  anchorKind,
  replaceEditionRects,
  validAnchorMap,
} from "./anchors";
import { PdfPage } from "./PdfPage";
import {
  createPageImageSource,
  exceedsPageImageCeiling,
  neededLongEdge,
  pageImageBucket,
} from "./pageImage";
import { RegionOverlay, type RegionOverlayItem } from "./RegionOverlay";
import { PencilOverlay } from "./marks/PencilOverlay";
import { defaultMarksApi, type ScoreMarksApi } from "./marks/api";
import type { Stroke } from "./marks/strokes";
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
  landmarksFromMeasureFacts,
  type MeasureLandmark,
  type XmlMeasureFact,
} from "./atlas/mapping/strip";
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
} from "./geometry";
import {
  fitContextBucket,
  firstPageCacheKey,
  isCacheableScaleMode,
  sharedFirstPageBitmaps,
  sniffImageMime,
} from "./firstPageCache";
import {
  createRangeTransport,
  probeScoreSource,
  scoreEditionUrl,
  SCORE_RANGE_CHUNK_SIZE,
  type PdfRangeTransport,
  type PdfRangeTransportCtor,
} from "./pdfSource";
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
import { MeasureMapPanel } from "./mapping/MeasureMapPanel";
import { MeasureOverlay } from "./mapping/MeasureOverlay";
import {
  barRangeForRect,
  getMeasureMapEntry,
  measureMapGet,
  publishMeasureMap,
  readShowMeasuresPreference,
  subscribeMeasureMap,
  writeShowMeasuresPreference,
  type MeasureMapCacheEntry,
} from "./mapping/measureMap";
import "./mapping/measureMapping.css";
import "./ScoreView.css";

const PDF_LOAD_TIMEOUT_MS = 30_000;
/** How long the `ckscore://` probe may take before we give up and use IPC. */
const SCORE_PROBE_TIMEOUT_MS = 2_000;
const PDF_RENDER_TIMEOUT_MESSAGE =
  "PDF rendering did not start in time. Try again or choose another edition.";

/** Decoder + asset wiring every load shares; see the comments in `load` below. */
interface PdfJsDocumentOptions {
  cMapUrl: string;
  cMapPacked: boolean;
  iccUrl: string;
  standardFontDataUrl: string;
  wasmUrl: string;
  useWorkerFetch: boolean;
  useWasm: boolean;
  isOffscreenCanvasSupported: boolean;
  isImageDecoderSupported: boolean;
}

interface PdfJsRuntime {
  getDocument: (
    options: PdfJsDocumentOptions & Record<string, unknown>,
  ) => PDFDocumentLoadingTask;
  /**
   * Absent from the minimal fakes the viewer tests inject, so `loadUrl`
   * checks for it and lets the caller fall back to the byte path.
   */
  PDFDataRangeTransport?: PdfRangeTransportCtor;
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
  pageImage: (pieceId, editionId, page, targetLongEdge) =>
    invoke<ArrayBuffer>("score_page_image", {
      pieceId,
      editionId,
      page,
      targetLongEdge,
    }),
  warmPageImage: (pieceId, editionId, page, targetLongEdge) =>
    invoke<void>("score_page_image_warm", {
      pieceId,
      editionId,
      page,
      targetLongEdge,
    }),
  loadFirstPage: (pieceId, fingerprint, page, bucket) =>
    invoke<ArrayBuffer>("score_page_cache_load", {
      pieceId,
      editionFingerprint: fingerprint,
      page,
      bucket,
    }),
  saveFirstPage: (pieceId, fingerprint, page, bucket, bytes) =>
    invoke<void>("score_page_cache_save", {
      pieceId,
      editionFingerprint: fingerprint,
      page,
      bucket,
      // A plain number[] deserializes to Vec<u8> unambiguously; this runs
      // fire-and-forget after the page is already on screen, so JSON bloat on
      // a ~100 KB snapshot is off the interactive path.
      bytes: Array.from(new Uint8Array(bytes)),
    }),
};

function wrapPage(page: PDFPageProxy): PdfPageHandle {
  const base = page.getViewport({ scale: 1 });
  return {
    width: base.width,
    height: base.height,
    cleanup: () => page.cleanup(),
    // Normalized text-layer runs for measure-number prefill. At scale 1 with no
    // rotation the viewport transform is [1,0,0,-1,0,height], so an item's user-
    // space (x,y) maps to (x, height - y) in top-left origin; normalize by the
    // page box. Best-effort: a scanned page returns an empty layer and callers
    // degrade to prediction.
    textItems: async () => {
      try {
        const content = await page.getTextContent();
        const width = base.width || 1;
        const height = base.height || 1;
        return content.items.flatMap((item) => {
          if (!("str" in item) || !("transform" in item)) return [];
          const text = item.str.trim();
          if (!text) return [];
          const x = item.transform[4];
          const y = item.transform[5];
          return [
            {
              text,
              xPct: x / width,
              yPct: 1 - y / height,
            },
          ];
        });
      } catch {
        return [];
      }
    },
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
  // One shared import promise: `prefetch()` and every load await the same
  // ~1.7 MB of chunks. Without this the first open pays the import serially,
  // after both IPC round-trips have already finished.
  let runtime: Promise<PdfJsRuntime> | null = null;
  const runtimeOnce = () => (runtime ??= loadRuntime());

  /** Everything except the data source; shared by `load` and `loadUrl`. */
  const decoderOptions = (): PdfJsDocumentOptions => {
    const pdfAssetRoot = new URL("./pdfjs/", document.baseURI);
    return {
      // Most of Christian's editions are scanned CCITT/JBIG2/JPEG pages.
      // PDF.js otherwise resolves page metadata but silently paints white
      // when its external decoders are absent. These assets are vendored
      // under public/pdfjs and copied verbatim into every app build.
      cMapUrl: new URL("cmaps/", pdfAssetRoot).href,
      cMapPacked: true,
      iccUrl: new URL("iccs/", pdfAssetRoot).href,
      standardFontDataUrl: new URL("standard_fonts/", pdfAssetRoot).href,
      wasmUrl: new URL("wasm/", pdfAssetRoot).href,
      useWorkerFetch: true,
      useWasm: true,
      // WKWebView exposes some newer canvas/image APIs before their worker
      // implementations are reliable enough for PDF.js. The DOM + bundled
      // decoder path is slower but deterministic for a local piano score.
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
    };
  };

  /**
   * Drive one loading task to a document handle under a deadline, destroying
   * the task on every failure path — including one created after the deadline
   * already elapsed, because dynamic imports cannot be cancelled.
   */
  const openDocument = async (
    start: (runtime: PdfJsRuntime) => PDFDocumentLoadingTask,
    timeoutMs: number,
    abort?: () => void,
  ): Promise<PdfDocumentHandle> => {
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
          const task = start(await runtimeOnce());
          taskRef.current = task;
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
          abort?.();
          await taskRef.current?.destroy();
        },
      };
    } catch (error) {
      timedOut = true;
      abort?.();
      // Cleanup is best-effort and deliberately not awaited. PDF.js destroy()
      // can wait on the same worker startup that triggered this deadline; the
      // visible retryable error must never be gated by an unbounded teardown.
      if (taskRef.current)
        void taskRef.current.destroy().catch(() => undefined);
      throw error;
    }
  };

  const loadBytes = (bytes: ArrayBuffer, timeoutMs: number) => {
    if (
      !bytes ||
      typeof bytes.byteLength !== "number" ||
      bytes.byteLength === 0
    ) {
      throw new Error(
        "The selected PDF is empty or did not arrive as binary data.",
      );
    }
    return openDocument(
      ({ getDocument }) =>
        getDocument({
          // Uint8Array accepts ArrayBuffers from a different JS realm too; an
          // `instanceof ArrayBuffer` check does not (WKWebView's IPC response is
          // created by Tauri's injected realm).
          data: new Uint8Array(bytes).slice(),
          ...decoderOptions(),
        }),
      timeoutMs,
    );
  };

  return {
    prefetch() {
      void runtimeOnce().catch(() => undefined);
    },

    async load(bytes, options) {
      return loadBytes(bytes, options?.timeoutMs ?? PDF_LOAD_TIMEOUT_MS);
    },

    async loadUrl(url, options) {
      const timeoutMs = options?.timeoutMs ?? PDF_LOAD_TIMEOUT_MS;
      // One probe request proves the `ckscore://` scheme is reachable AND
      // primes the opening chunk. Anything wrong with the protocol surfaces
      // here as a rejection the caller can fall back from, rather than as a
      // range request stalled inside PDF.js with no error channel.
      //
      // Its own short deadline, deliberately far below the document deadline:
      // the handler reads a local file, so a healthy answer takes single-digit
      // milliseconds. If a webview instead swallows the scheme silently, this
      // bounds the wasted time before the byte fallback to a couple of seconds
      // rather than the full 30-second load budget.
      const source = await withTimeout(
        probeScoreSource(url),
        Math.min(timeoutMs, SCORE_PROBE_TIMEOUT_MS),
        "The score protocol did not answer in time.",
      );
      if (source.kind === "whole") {
        return loadBytes(source.bytes, timeoutMs);
      }

      // A failed range mid-parse has nowhere to go inside PDF.js, so race the
      // document promise against it and let the viewer show a retryable error.
      let rejectOnRangeError: (error: unknown) => void = () => undefined;
      const rangeFailure = new Promise<never>((_, reject) => {
        rejectOnRangeError = reject;
      });
      let transport: PdfRangeTransport | null = null;
      const document = openDocument(
        (pdfjs) => {
          if (!pdfjs.PDFDataRangeTransport) {
            throw new Error("This PDF.js build cannot range-load a score.");
          }
          transport = createRangeTransport(
            pdfjs.PDFDataRangeTransport,
            source,
            {
              onError: rejectOnRangeError,
            },
          );
          return pdfjs.getDocument({
            range: transport,
            rangeChunkSize: SCORE_RANGE_CHUNK_SIZE,
            // The flag that makes this worth doing: without it PDF.js walks the
            // whole file anyway and range loading buys nothing.
            disableAutoFetch: true,
            disableStream: false,
            ...decoderOptions(),
          });
        },
        timeoutMs,
        () => transport?.abort(),
      );
      return Promise.race([document, rangeFailure]).catch((error) => {
        void document.then((handle) => handle.destroy()).catch(() => undefined);
        throw error;
      });
    },
  };
}

export const pdfJsAdapter = createPdfJsAdapter();

type ViewerPhase =
  "loading-editions" | "no-pdf" | "loading-document" | "ready" | "error";

export interface ScoreViewProps {
  pieceId: number;
  /** False while Shell keeps this workspace mounted only to preserve state. */
  isActive?: boolean;
  activeRange?: { m_start: number; m_end: number } | null;
  defaultTargetBpm?: number | null;
  defaultCleanStreak?: number;
  onOpenBlock?: (args: RepOpenArgs, context?: SetFocusContextInput) => void;
  opening?: boolean;
  onRegionsChanged?: () => void;
  onContextChange?: (context: ScoreFocusContext) => void;
  api?: ScorePdfApi;
  calibrationApi?: CalibrationApi;
  marksApi?: ScoreMarksApi;
  adapter?: PdfAdapter;
  loadTimeoutMs?: number;
  /** Reports whenever the measure-mapping panel has unsaved review work in
   * memory (a scan in progress, or a reconciled-but-not-yet-Applied review).
   * `ScoreView` remounts fresh per piece (`key={pieceId}` in
   * `ScoreWorkspace`), which silently DISCARDS that work on an in-app piece
   * switch — `beforeunload` never fires for an SPA state change. The parent
   * uses this to guard the switch with a confirm before it happens. */
  onMeasureMapDirtyChange?: (dirty: boolean) => void;
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
const SECTION_TABS: readonly [SectionTab, string][] = [
  ["practice", "Practice"],
  ["edit", "Edit"],
  ["marks", "Score marks"],
  ["tutorial", "Tutorial"],
];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
// Raster width (px) for the wizard's page pane. The bitmap is baked a little
// wider than the pane and CSS-scaled down, so the engraving stays crisp there.
const WIZARD_PAGE_RASTER_WIDTH = 760;

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
  isActive = true,
  activeRange = null,
  defaultTargetBpm = null,
  defaultCleanStreak = 5,
  onOpenBlock,
  opening = false,
  onRegionsChanged,
  onContextChange,
  api = defaultApi,
  calibrationApi = defaultCalibrationApi,
  marksApi = defaultMarksApi,
  adapter = pdfJsAdapter,
  loadTimeoutMs = PDF_LOAD_TIMEOUT_MS,
  onMeasureMapDirtyChange,
}: ScoreViewProps) {
  const crud = useCrud();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageSizesRef = useRef(new Map<number, PdfPageSize>());
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
  const sectionTabRefs = useRef<
    Partial<Record<SectionTab, HTMLButtonElement | null>>
  >({});
  const [regionQuery, setRegionQuery] = useState("");
  const [mapping, setMapping] = useState<MappingDraft | null>(null);
  const [savingMap, setSavingMap] = useState(false);
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDraft, setPageDraft] = useState("1");
  const [manualZoom, setManualZoom] = useState(1);
  // Default to one whole page in view: a true PDF-viewer feel, not a 25-page
  // strip. Fit-width/manual zoom still overflow into a within-page scroll.
  const [scaleMode, setScaleMode] = useState<ScoreScaleMode>("page");
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
  // Task C5: set from the currently-selected region when a drag-to-create
  // gesture resolves while a parent is selected — makes the new section a
  // one-level sub-section. Cleared after create (or when the add form is
  // cancelled) so a later top-level creation never inherits it by accident.
  const [newRegionParentId, setNewRegionParentId] = useState<number | null>(
    null,
  );
  const [creatingRegion, setCreatingRegion] = useState(false);
  // Task B1: whether this piece's user has already been taught the
  // select-then-drag-inside gesture that creates a sub-section — persisted
  // per piece through the generic settings key/value pair (no schema
  // change: `Store::get_setting`/`set_setting`, `store/mod.rs:137,190`).
  // Assume seen until told otherwise so the hint never flashes on before the
  // read resolves.
  const [subsectionHintSeen, setSubsectionHintSeen] = useState(true);
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
  // ── Pencil marks ──────────────────────────────────────────────────────────
  // Freehand graphite on the page. `pencilMode` is mutually exclusive with the
  // target-rectangle mode (they both want the pointer), Escape always leaves it,
  // and every stroke is normalized page geometry, so nothing here depends on
  // zoom, fit mode, or which render path painted the page.
  const [pencilMode, setPencilMode] = useState(false);
  const [marksByPage, setMarksByPage] = useState<Record<number, Stroke[]>>({});
  const [staleMarks, setStaleMarks] = useState(0);
  const [pencilBusy, setPencilBusy] = useState(false);
  const [confirmClearPage, setConfirmClearPage] = useState<number | null>(null);
  const [pencilError, setPencilError] = useState<string | null>(null);
  // Pages already fetched for the current piece+edition, so the mount effect
  // never re-fetches a page it has (and never loops on its own setState).
  const loadedMarkPagesRef = useRef(new Set<number>());
  // Which page undo/clear act on: the page most recently drawn on, so a stroke
  // on the right-hand page of the 2-page view is what undo takes back. Reset to
  // the anchor page on every page turn.
  const [markPage, setMarkPage] = useState(1);
  // ── Measure mapping (Plan C, task C4) ─────────────────────────────────────
  const [mapPanelOpen, setMapPanelOpen] = useState(false);
  const [measuresVisible, setMeasuresVisible] = useState(() =>
    readShowMeasuresPreference(),
  );
  const [measureMapEntry, setMeasureMapEntry] =
    useState<MeasureMapCacheEntry | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  // MusicXML measure facts for the wizard's strip, fetched on wizard open. Null
  // whenever the piece has no MusicXML (or the fetch fails): the wizard then works
  // exactly as before, from line anchors alone.
  const [xmlFacts, setXmlFacts] = useState<{
    maxMeasure: number | null;
    hasPickup: boolean;
    landmarks: MeasureLandmark[];
  } | null>(null);
  // The floating draft dock renders only once a box is drawn; it is collapsible
  // to a slim bar and can be re-cornered so it never blocks the score or nav.
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [dockCorner, setDockCorner] = useState<"top-right" | "bottom-right">(
    "top-right",
  );
  // Auto-offer the wizard once per edition the first time a box lands on an
  // unmapped page; a manual open or dismissal counts as "offered".
  const autoOfferedRef = useRef(false);

  // ── Fitted first-page bitmap cache (the piece-switch accelerator) ──────────
  // A small in-memory LRU of decoded first-page snapshots (blobs), backed by an
  // on-disk cache through the score_page_cache_* commands. On switch we paint a
  // cached snapshot instantly, CSS-fit, while the real PDF re-parses/decodes and
  // its true first page swaps in on the first real raster. Display-only: it never
  // gates interaction (regions already require a live `document`) and a miss is
  // never an error — the switch simply falls back to today's behavior.
  const bitmapCacheRef = useRef(sharedFirstPageBitmaps);
  const [firstPagePreview, setFirstPagePreview] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  // The switch that painted the current preview still wants it shown: cleared on
  // the first real paint (or on error) so a late disk read can't repaint over a
  // page the reader is already interacting with.
  const previewWantedRef = useRef(false);
  // The last fit key we persisted, so a re-raster at the same fit (e.g. a resize
  // settle) never re-encodes or re-saves the identical snapshot.
  const lastSavedKeyRef = useRef<string | null>(null);
  // Current fit context mirrored into refs so the document-load effect can read
  // it without taking these as deps — which would reload the whole PDF on every
  // viewport resize.
  const scaleModeRef = useRef(scaleMode);
  const containerWidthRef = useRef(containerWidth);
  const containerHeightRef = useRef(containerHeight);

  // Point the preview at a blob (or clear it), revoking any prior object URL.
  // jsdom lacks createObjectURL, so guard: without it we simply never show a
  // preview and the switch behaves exactly as it does today.
  const setPreviewFromBlob = useCallback((blob: Blob | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (!blob || typeof URL.createObjectURL !== "function") {
      setFirstPagePreview(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    setFirstPagePreview(url);
  }, []);

  useEffect(
    () => () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    },
    [],
  );

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
    setDockCollapsed(false);
    setDockCorner("top-right");
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

    // The ~1.7 MB PDF.js runtime does not depend on WHICH edition wins, so
    // start importing it now, next to the edition lookup, instead of paying
    // for it serially once the edition id finally arrives.
    adapter.prefetch?.();

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
  }, [adapter, api, pieceId, reloadToken]);

  useEffect(() => {
    if (!editionId || !editions.some((edition) => edition.id === editionId))
      return;
    let alive = true;
    let loaded: PdfDocumentHandle | null = null;
    setPhase("loading-document");
    setError(null);
    setDocument(null);
    setMapping(null);
    setCurrentPage(1);
    setPageDraft("1");
    pageSizesRef.current.clear();
    setMaxPageWidth(DEFAULT_PAGE_SIZE.width);
    setMaxPageHeight(DEFAULT_PAGE_SIZE.height);

    // Paint a cached fitted first page immediately, if we have one, so the
    // switch feels instant while the real document parses/decodes below. Only
    // true fit modes are cacheable, and the fingerprint+bucket key is fully
    // known here (editions have resolved) before the expensive parse begins.
    lastSavedKeyRef.current = null;
    previewWantedRef.current = true;
    setPreviewFromBlob(null);
    const previewMode = scaleModeRef.current;
    const previewFingerprint =
      editions.find((item) => item.id === editionId)?.fingerprint ?? null;
    if (isCacheableScaleMode(previewMode) && previewFingerprint) {
      const bucket = fitContextBucket(
        previewMode,
        containerWidthRef.current,
        containerHeightRef.current,
      );
      const key = firstPageCacheKey(pieceId, previewFingerprint, 1, bucket);
      const cached = bitmapCacheRef.current.get(key);
      if (cached) {
        setPreviewFromBlob(cached);
      } else {
        void api
          .loadFirstPage(pieceId, previewFingerprint, 1, bucket)
          .then((buffer) => {
            if (!alive || !previewWantedRef.current) return;
            if (!buffer || buffer.byteLength === 0) return;
            const blob = new Blob([buffer], {
              type: sniffImageMime(new Uint8Array(buffer)),
            });
            bitmapCacheRef.current.set(key, blob);
            if (alive && previewWantedRef.current) setPreviewFromBlob(blob);
          })
          .catch(() => undefined);
      }
    }

    // Range-load straight off the native protocol when the adapter can: PDF.js
    // then pulls the xref plus the objects page 1 needs instead of taking a
    // whole image scan across IPC. The byte path stays as the fallback — the
    // `ckscore://` scheme does not exist in the browser dev mock, and a webview
    // that refuses it must still open the score.
    const openDocument = async (): Promise<PdfDocumentHandle> => {
      if (adapter.loadUrl) {
        try {
          return await adapter.loadUrl(scoreEditionUrl(pieceId, editionId), {
            timeoutMs: loadTimeoutMs,
          });
        } catch (caught) {
          if (!alive) throw caught;
          console.warn(
            "score: range load failed, falling back to IPC bytes",
            caught,
          );
        }
      }
      const bytes = await withTimeout(
        api.bytes(pieceId, editionId),
        loadTimeoutMs,
        "The PDF file took too long to read. Try again or choose another edition.",
      );
      return adapter.load(bytes, { timeoutMs: loadTimeoutMs });
    };

    void openDocument()
      .then((nextDocument) => {
        loaded = nextDocument;
        if (!alive) return nextDocument.destroy();
        setDocument(nextDocument);
        setPhase("ready");
      })
      .catch((caught) => {
        if (!alive) return;
        // A failed load must surface the error, not a stale cached bitmap.
        previewWantedRef.current = false;
        setPreviewFromBlob(null);
        setError(messageOf(caught));
        setPhase("error");
      });

    return () => {
      alive = false;
      // Stop a late disk read from this switch repainting the next piece.
      previewWantedRef.current = false;
      if (loaded) void loaded.destroy();
    };
  }, [
    adapter,
    api,
    editionId,
    editions,
    loadTimeoutMs,
    pieceId,
    setPreviewFromBlob,
  ]);

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

  const pageCount = document?.numPages ?? 0;
  // A true pager: one page is in view (two side-by-side in 2-page view). Only
  // those plus one buffered neighbor each side ever mount a canvas — on a
  // 25-page score at most three canvases exist, and the rest are unmounted.
  const visiblePageList = useMemo(() => {
    if (pageCount < 1) return [] as number[];
    const anchor = Math.min(Math.max(1, currentPage), pageCount);
    if (scaleMode === "overview" && anchor + 1 <= pageCount) {
      return [anchor, anchor + 1];
    }
    return [anchor];
  }, [currentPage, pageCount, scaleMode]);
  const mountedPages = useMemo(() => {
    const mounted = new Set<number>(visiblePageList);
    for (const page of visiblePageList) {
      if (page - 1 >= 1) mounted.add(page - 1);
      if (page + 1 <= pageCount) mounted.add(page + 1);
    }
    return [...mounted].sort((a, b) => a - b);
  }, [pageCount, visiblePageList]);
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
  // The live scale, mirrored into a ref so the native wheel/pinch listeners can
  // zoom relative to the current level without re-subscribing on every tick.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  scaleModeRef.current = scaleMode;
  containerWidthRef.current = containerWidth;
  containerHeightRef.current = containerHeight;
  const edition = editions.find((item) => item.id === editionId) ?? null;
  // The screen-resolution fast path, bound to the edition currently open. Null
  // whenever the host cannot serve page images (the browser dev mock, the test
  // adapters), in which case every page renders through PDF.js exactly as before.
  const pageImageSource = useMemo(
    () => createPageImageSource(api, pieceId, editionId),
    [api, editionId, pieceId],
  );
  // Warm the pages just OUTSIDE the mounted window, on idle.
  //
  // The ±1 neighbours are already mounted and fetch their own image (deferred
  // to idle inside PdfPage), so warming those would only duplicate the decode.
  // What is not covered is the page after next, which is where a reader turning
  // pages steadily is about to be — generating it in Rust without shipping any
  // bytes across IPC makes that turn a cache hit. Never awaited, never on the
  // path of the page being looked at, and each page/bucket pair is asked for
  // once so a zoom that walks through buckets cannot start a decode storm.
  const warmedRef = useRef(new Set<string>());
  // Switching edition invalidates every "already warmed" note: the keys are
  // page+bucket, and the same page of a different edition is a different image.
  useEffect(() => {
    warmedRef.current = new Set<string>();
  }, [pageImageSource]);
  useEffect(() => {
    if (!pageImageSource || pageCount < 1) return;
    const size = pageSizesRef.current.get(currentPage) ?? {
      width: maxPageWidth,
      height: maxPageHeight,
    };
    const needed = neededLongEdge(size, scale, window.devicePixelRatio || 1);
    if (exceedsPageImageCeiling(needed)) return;
    const bucket = pageImageBucket(needed);
    const mounted = new Set(mountedPages);
    const wanted = [currentPage + 2, currentPage - 2].filter(
      (page) =>
        page >= 1 &&
        page <= pageCount &&
        !mounted.has(page) &&
        !warmedRef.current.has(`${page}:${bucket}`),
    );
    if (wanted.length === 0) return;
    let cancelled = false;
    const fire = () => {
      if (cancelled) return;
      for (const page of wanted) {
        warmedRef.current.add(`${page}:${bucket}`);
        pageImageSource.warm(page, bucket);
      }
    };
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (win.requestIdleCallback && win.cancelIdleCallback) {
      const handle = win.requestIdleCallback(fire);
      return () => {
        cancelled = true;
        win.cancelIdleCallback?.(handle);
      };
    }
    const timer = window.setTimeout(fire, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    currentPage,
    maxPageHeight,
    maxPageWidth,
    mountedPages,
    pageCount,
    pageImageSource,
    scale,
  ]);

  const selectedRegion =
    regions.find((region) => region.id === selectedRegionId) ?? null;
  // Task B1: read the per-piece sub-section hint seen-flag. Keyed on
  // pieceId so the hint reappears (and can be re-dismissed) for every piece
  // independently — it never leaks across pieces.
  const subsectionHintKey =
    pieceId != null ? `score.subsection_hint_seen.${pieceId}` : null;
  useEffect(() => {
    if (!subsectionHintKey) return;
    let cancelled = false;
    void invoke<string | null>("get_setting", { key: subsectionHintKey })
      .then((value) => {
        if (!cancelled) setSubsectionHintSeen(value === "true");
      })
      .catch(() => {
        if (!cancelled) setSubsectionHintSeen(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subsectionHintKey]);
  useLayoutEffect(() => {
    livePieceIdRef.current = pieceId;
    liveEditionRef.current = edition;
  }, [edition, pieceId]);

  // Snapshot the fitted first page into the piece-switch cache. Only true fit
  // modes are captured (a zoomed page is not "the fitted first page"), and a
  // repeat raster at the same fit is skipped so a resize settle never re-encodes.
  const captureFirstPage = (canvas: HTMLCanvasElement) => {
    const mode = scaleModeRef.current;
    if (!isCacheableScaleMode(mode) || !edition) return;
    if (typeof canvas.toBlob !== "function") return;
    const fingerprint = edition.fingerprint;
    const bucket = fitContextBucket(
      mode,
      containerWidthRef.current,
      containerHeightRef.current,
    );
    const key = firstPageCacheKey(pieceId, fingerprint, 1, bucket);
    if (lastSavedKeyRef.current === key) return;
    const persist = (blob: Blob | null) => {
      if (!blob) return;
      lastSavedKeyRef.current = key;
      bitmapCacheRef.current.set(key, blob);
      void blob
        .arrayBuffer()
        .then((buffer) =>
          api.saveFirstPage(pieceId, fingerprint, 1, bucket, buffer),
        )
        .catch(() => undefined);
    };
    try {
      canvas.toBlob(
        (blob) => {
          // WebP first (smaller); WKWebView may decline and hand back null, in
          // which case JPEG is the guaranteed-encodable fallback.
          if (blob) persist(blob);
          else canvas.toBlob(persist, "image/jpeg", 0.8);
        },
        "image/webp",
        0.8,
      );
    } catch {
      // toBlob unsupported (e.g. a context-less jsdom canvas): best-effort only.
    }
  };

  // A page has painted a crisp bitmap. When it is the first page, the real
  // document is now live, so retire the instant-switch preview and snapshot the
  // fresh fitted bitmap for next time.
  const handleRasterized = (pageNumber: number, canvas: HTMLCanvasElement) => {
    if (pageNumber !== 1) return;
    previewWantedRef.current = false;
    setPreviewFromBlob(null);
    captureFirstPage(canvas);
  };

  // Trackpad pinch and Cmd/Ctrl+wheel zoom the score like an image. WKWebView
  // (Chromium-synthesized paths and mice) delivers pinch/zoom as a wheel event
  // with ctrlKey set; a plain wheel stays a scroll. WebKit's own trackpad pinch
  // arrives as gesturestart/change/end instead, so both surfaces are handled and
  // each is mutually exclusive per engine. Every zoom input only moves the live
  // scale — the crisp re-raster is debounced inside PdfPage — so a pinch tracks
  // the fingers within the frame with no PDF.js work on the gesture path.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || phase !== "ready") return;
    const zoomBy = (factor: number) => {
      setScaleMode("manual");
      setManualZoom(clampZoom(scaleRef.current * factor));
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      // Multiplicative so each notch/pinch delta is a constant proportion of the
      // current zoom; the small factor keeps a mouse notch near a 10% step while
      // fine pinch deltas stay smooth.
      zoomBy(Math.exp(-event.deltaY * 0.0015));
    };
    let gestureBase = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureBase = scaleRef.current;
      setScaleMode("manual");
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gestureScale = (event as unknown as { scale?: number }).scale ?? 1;
      setManualZoom(clampZoom(gestureBase * gestureScale));
    };
    const onGestureEnd = (event: Event) => event.preventDefault();
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("gesturestart", onGestureStart as EventListener);
    root.addEventListener("gesturechange", onGestureChange as EventListener);
    root.addEventListener("gestureend", onGestureEnd as EventListener);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("gesturestart", onGestureStart as EventListener);
      root.removeEventListener(
        "gesturechange",
        onGestureChange as EventListener,
      );
      root.removeEventListener("gestureend", onGestureEnd as EventListener);
    };
  }, [phase]);

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

  // Applied measure map: read the shared cache immediately (no flash of
  // "unmapped" on a piece switch back to an already-applied edition), then
  // subscribe for live updates (Apply publishes into the SAME cache — see
  // `mapping/measureMap.ts`). A cache miss triggers exactly one background
  // `measure_map_get` hydration per edition; an empty answer just means
  // "never mapped" and is not treated as an error.
  useEffect(() => {
    if (!edition) {
      setMeasureMapEntry(null);
      return;
    }
    const editionId = edition.id;
    const fingerprint = edition.fingerprint;
    setMeasureMapEntry(getMeasureMapEntry(pieceId, editionId));
    const unsubscribe = subscribeMeasureMap(
      pieceId,
      editionId,
      setMeasureMapEntry,
    );
    if (!getMeasureMapEntry(pieceId, editionId)) {
      void measureMapGet(pieceId, editionId, fingerprint)
        .then((rows) => {
          if (rows.length > 0) {
            publishMeasureMap(pieceId, editionId, fingerprint, rows);
          }
        })
        .catch(() => undefined);
    }
    return unsubscribe;
    // editionKey captures the identity we key on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editionKey, pieceId]);

  // ── Pencil marks: load, draw, undo, clear ─────────────────────────────────

  // Marks belong to one piece+edition+fingerprint. A switch of any of the three
  // drops everything cached: the Henle's marks must never be shown over the
  // Schnabel, whose pages are engraved differently.
  useEffect(() => {
    loadedMarkPagesRef.current = new Set();
    setMarksByPage({});
    setStaleMarks(0);
    setPencilError(null);
    setConfirmClearPage(null);
  }, [editionKey, pieceId]);

  // Fetch every mounted page's marks once. Buffered neighbors are included so a
  // page turn shows its marks in the same frame it shows the engraving.
  const mountedPagesKey = mountedPages.join(",");
  useEffect(() => {
    if (!edition) return;
    const wanted = mountedPages.filter(
      (page) => !loadedMarkPagesRef.current.has(page),
    );
    if (wanted.length === 0) return;
    for (const page of wanted) loadedMarkPagesRef.current.add(page);
    let alive = true;
    const identity = { id: edition.id, fingerprint: edition.fingerprint };
    void Promise.all(
      wanted.map(async (page) => ({
        page,
        result: await marksApi.page(pieceId, identity, page),
      })),
    )
      .then((loaded) => {
        if (!alive) return;
        setMarksByPage((current) => {
          const next = { ...current };
          for (const { page, result } of loaded) next[page] = result.marks;
          return next;
        });
        setStaleMarks(loaded[0]?.result.staleMarks ?? 0);
      })
      .catch(() => {
        // A read failure must not pin those pages as "loaded" forever.
        if (!alive) return;
        for (const page of wanted) loadedMarkPagesRef.current.delete(page);
      });
    return () => {
      alive = false;
    };
    // mountedPagesKey stands in for the page list; editionKey for the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editionKey, marksApi, mountedPagesKey, pieceId]);

  const markEdition = edition
    ? { id: edition.id, fingerprint: edition.fingerprint }
    : null;

  // A finished stroke lands on screen immediately and is persisted behind it.
  // If the write fails the optimistic stroke is rolled back, because a mark the
  // reader can see but the app has not stored is a lie about their work.
  const handleStroke = useCallback(
    (stroke: Stroke) => {
      const identity = liveEditionRef.current;
      if (!identity) return;
      const page = stroke.page;
      setMarkPage(page);
      setPencilError(null);
      setMarksByPage((current) => ({
        ...current,
        [page]: [...(current[page] ?? []), stroke],
      }));
      void marksApi
        .add(
          pieceId,
          { id: identity.id, fingerprint: identity.fingerprint },
          stroke,
        )
        .then((saved) => {
          if (!scoreMountedRef.current) return;
          setMarksByPage((current) => {
            const list = current[page] ?? [];
            const index = list.indexOf(stroke);
            if (index < 0) return current;
            const next = list.slice();
            next[index] = saved;
            return { ...current, [page]: next };
          });
        })
        .catch((caught) => {
          if (!scoreMountedRef.current) return;
          setMarksByPage((current) => ({
            ...current,
            [page]: (current[page] ?? []).filter((item) => item !== stroke),
          }));
          setPencilError(
            caught instanceof Error
              ? `That mark could not be saved: ${caught.message}`
              : "That mark could not be saved.",
          );
        });
    },
    [marksApi, pieceId],
  );

  const undoMark = useCallback(() => {
    const identity = liveEditionRef.current;
    if (!identity || pencilBusy) return;
    const page = markPage;
    if ((marksByPage[page] ?? []).length === 0) return;
    setPencilBusy(true);
    setPencilError(null);
    void marksApi
      .undo(
        pieceId,
        { id: identity.id, fingerprint: identity.fingerprint },
        page,
      )
      .then((removedId) => {
        if (!scoreMountedRef.current) return;
        setMarksByPage((current) => {
          const list = current[page] ?? [];
          if (list.length === 0) return current;
          // Drop by id when the store named one, else the last stroke.
          const index =
            removedId == null
              ? list.length - 1
              : list.findIndex((item) => item.id === removedId);
          if (index < 0) return current;
          return {
            ...current,
            [page]: list.filter((_, position) => position !== index),
          };
        });
      })
      .catch((caught) => {
        if (!scoreMountedRef.current) return;
        setPencilError(
          caught instanceof Error
            ? `Undo failed: ${caught.message}`
            : "Undo failed.",
        );
      })
      .finally(() => {
        if (scoreMountedRef.current) setPencilBusy(false);
      });
  }, [markPage, marksApi, marksByPage, pencilBusy, pieceId]);

  const clearMarkPage = useCallback(
    (page: number) => {
      const identity = liveEditionRef.current;
      if (!identity || pencilBusy) return;
      setPencilBusy(true);
      setPencilError(null);
      setConfirmClearPage(null);
      void marksApi
        .clearPage(
          pieceId,
          { id: identity.id, fingerprint: identity.fingerprint },
          page,
        )
        .then(() => {
          if (!scoreMountedRef.current) return;
          setMarksByPage((current) => ({ ...current, [page]: [] }));
        })
        .catch((caught) => {
          if (!scoreMountedRef.current) return;
          setPencilError(
            caught instanceof Error
              ? `Clearing page ${page} failed: ${caught.message}`
              : `Clearing page ${page} failed.`,
          );
        })
        .finally(() => {
          if (scoreMountedRef.current) setPencilBusy(false);
        });
    },
    [marksApi, pencilBusy, pieceId],
  );

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
  // Task C5: child sub-sections (parent_region_id set) only render in this
  // list while their parent is currently selected — keeps the list from
  // ballooning with detail nobody asked to see yet.
  const childCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const region of regions) {
      if (region.parent_region_id == null) continue;
      counts.set(
        region.parent_region_id,
        (counts.get(region.parent_region_id) ?? 0) + 1,
      );
    }
    return counts;
  }, [regions]);
  const displayedRegions = useMemo(() => {
    const query = regionQuery.trim().toLocaleLowerCase();
    return [...regions]
      .filter(
        (region) =>
          region.parent_region_id == null ||
          region.parent_region_id === selectedRegionId ||
          // Selecting the child moves the selection off its parent; without
          // this the child would vanish the instant it was clicked and its
          // own inspector (and practice set) could never be opened.
          region.id === selectedRegionId,
      )
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
  }, [regionQuery, regions, selectedRegionId]);

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
    setDockCollapsed(false);
    setDockCorner("top-right");
    setSectionsVisible(sectionsBeforeTargetRef.current);
    sectionsStashedRef.current = false;
    setNavigationNotice(null);
  }, []);

  const togglePencilMode = useCallback(() => {
    setConfirmClearPage(null);
    setPencilError(null);
    setPencilMode((on) => {
      if (on) return false;
      // Entering the pencil leaves the rectangle tool, exactly as entering the
      // rectangle tool leaves the pencil.
      if (targetMode) cancelTargetDraft();
      return true;
    });
  }, [cancelTargetDraft, targetMode]);

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
    // The two drawing modes both own the pointer; entering one leaves the other.
    setPencilMode(false);
    setConfirmClearPage(null);
    sectionsBeforeTargetRef.current = sectionsVisible;
    sectionsStashedRef.current = true;
    setSectionsVisible(false);
    setDockCollapsed(false);
    setDockCorner("top-right");
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

  // Resolve a page's PDF text layer for measure-number prefill in the wizard.
  // Best-effort: a scanned edition (no text layer) or any failure returns null,
  // and the wizard degrades silently to anchor/prediction prefill.
  const pageTextItems = useCallback(
    async (pageNumber: number) => {
      if (!document) return null;
      try {
        const handle = await document.getPage(pageNumber);
        const items = (await handle.textItems?.()) ?? null;
        handle.cleanup();
        return items;
      } catch {
        return null;
      }
    },
    [document],
  );

  // The `needs_client_raster` retry path for measure scanning: render the
  // CURRENT PDF.js page to a canvas and encode it as a JPEG (the
  // `firstPageCache` idiom — `canvas.toBlob(..., "image/jpeg", 0.85)`), off
  // the ALREADY-open document so the panel never opens a second copy of the
  // PDF just to rasterize one vector page.
  const rasterizePageForScan = useCallback(
    async (pageNumber: number): Promise<number[]> => {
      if (!document) throw new Error("No score document is open.");
      const handle = await document.getPage(pageNumber);
      try {
        const canvas = window.document.createElement("canvas");
        const { promise } = handle.render(canvas, 2, 1);
        await promise;
        if (typeof canvas.toBlob !== "function") {
          throw new Error("This browser cannot rasterize a page for scanning.");
        }
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/jpeg", 0.85);
        });
        if (!blob) throw new Error("Rasterizing this page failed.");
        const buffer = await blob.arrayBuffer();
        return Array.from(new Uint8Array(buffer));
      } finally {
        handle.cleanup();
      }
    },
    [document],
  );

  // Fetch MusicXML measure facts when the wizard opens, so the strip can show the
  // score's true measure count and per-measure landmarks. A piece with no
  // MusicXML rejects (or returns nothing) → the wizard falls back to anchors only.
  useEffect(() => {
    if (!wizardOpen) return;
    let cancelled = false;
    setXmlFacts(null);
    void (async () => {
      try {
        const facts = await invoke<{
          measures?: XmlMeasureFact[];
          max_measure?: number;
          has_pickup?: boolean;
        }>("score_xml_measure_facts", { pieceId });
        if (cancelled) return;
        if (!facts) {
          setXmlFacts(null);
          return;
        }
        setXmlFacts({
          maxMeasure:
            typeof facts.max_measure === "number" ? facts.max_measure : null,
          hasPickup: Boolean(facts.has_pickup),
          landmarks: landmarksFromMeasureFacts(facts.measures ?? []),
        });
      } catch {
        if (!cancelled) setXmlFacts(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wizardOpen, pieceId]);

  // Render the real engraving inside the wizard's page pane. Rasterized a touch
  // wider than the pane and CSS-fit to it (see mapping.css), so the score reads
  // crisply at a usable size while the click-to-anchor geometry stays 0–1.
  const renderWizardPage = useCallback(
    (pageNumber: number) =>
      document ? (
        <PdfPage
          document={document}
          pageNumber={pageNumber}
          active
          scale={clampZoom(
            WIZARD_PAGE_RASTER_WIDTH / Math.max(1, maxPageWidth),
          )}
        />
      ) : null,
    [document, maxPageWidth],
  );

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
      // Undo/clear follow the reader to the new page until they draw again.
      setMarkPage(page);
      setConfirmClearPage(null);
      // Paging swaps which page is mounted, so reset any within-page scroll
      // (a zoomed page can overflow) back to the top of the new page.
      scrollRef.current?.scrollTo?.({ top: 0, left: 0 });
    },
    [document],
  );

  // Keyboard paging: PageDown/PageUp and Left/Right arrows flip pages, like a
  // PDF reader. Up/Down are left to the browser so a zoomed page still scrolls.
  // Ignored while typing, nudging a drawn box, or inside the draft/wizard.
  useEffect(() => {
    if (!isActive || phase !== "ready" || !document) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (wizardOpen) return;
      const forward = event.key === "PageDown" || event.key === "ArrowRight";
      const backward = event.key === "PageUp" || event.key === "ArrowLeft";
      if (!forward && !backward) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const active = window.document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          active.isContentEditable ||
          active.closest(
            ".score-region-draft, .score-atlas-draft-dock, .map-wizard",
          )
        )
          return;
      }
      event.preventDefault();
      jumpTo(currentPage + (forward ? 1 : -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentPage, document, isActive, jumpTo, phase, wizardOpen]);

  // The mapping wizard takes the whole score over; the pencil must not be armed
  // underneath it.
  useEffect(() => {
    if (wizardOpen) setPencilMode(false);
  }, [wizardOpen]);

  // Escape ALWAYS leaves pencil mode — the escape hatch a modal drawing tool
  // owes the user — and Cmd/Ctrl+Z undoes the last mark while it is on. Both are
  // ignored while typing, so neither can fire from a text field.
  useEffect(() => {
    if (!isActive || !pencilMode) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const active = window.document.activeElement as HTMLElement | null;
      const typing =
        active != null &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable);
      if (typing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setPencilMode(false);
        setConfirmClearPage(null);
        return;
      }
      if (
        (event.key === "z" || event.key === "Z") &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey
      ) {
        event.preventDefault();
        undoMark();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, pencilMode, undoMark]);

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
    if (!isActive) return;
    // Alive-guard: cleanup can run before listen() resolves; without this the
    // subscription would be orphaned (same pattern as useRep's listener).
    let alive = true;
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
        if (alive) {
          unlisten = fn;
        } else {
          fn();
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [edition, isActive, jumpTo, regions, selectRegion]);

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
        parent_region_id: newRegionParentId,
      });
      const colored = await crud.regionUpdate(created.id, {
        color: REGION_COLORS[regions.length % REGION_COLORS.length],
      });
      await graphChanged();
      // Task B1: a child sub-section was just created — the user has now
      // learned the gesture the hint was teaching, so retire it for this
      // piece, permanently, before `newRegionParentId` is cleared below.
      if (subsectionHintKey && newRegionParentId != null) {
        setSubsectionHintSeen(true);
        void invoke("set_setting", {
          key: subsectionHintKey,
          value: "true",
        }).catch(() => {});
      }
      setSelectedRegionId(colored.id);
      setExpandedRegionId(colored.id);
      setSectionTab("marks");
      setMapping({ regionId: colored.id, rects: [], tool: "box" });
      setNewRegionTitle("");
      setNewRegionNotes("");
      setNewRegionStart(String(mEnd + 1));
      setNewRegionEnd(String(mEnd + 1));
      setNewRegionParentId(null);
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

  // A cached map applies to the fingerprint it was fetched/applied under —
  // NEVER mode-gated (Flaws B48): a mismatch always shows the notice, and the
  // (now possibly wrong) numbers are withheld rather than shown against the
  // wrong page geometry. Declared here so the drag-to-create handler below
  // reuses this one staleness check instead of re-deriving it.
  const measureMapStale = Boolean(
    measureMapEntry &&
    edition &&
    measureMapEntry.fingerprint !== edition.fingerprint,
  );
  const measureMapByPage =
    measureMapEntry && !measureMapStale
      ? new Map(measureMapEntry.pages.map((row) => [row.page, row.map]))
      : null;

  // Task C5: a drag on a MAPPED page snaps to the bar range it intersects
  // (system-aware; multi-system drags take the min..max across systems) and
  // pre-fills the create form — still fully editable, typing is the
  // unmapped fallback and stays intact. Dragging while a region is selected
  // (and not already in "marks" annotation mode) creates a CHILD of that
  // selected region instead of a new top-level section.
  const handleCreateDragResolve = (rect: PdfAnchorRect) => {
    if (targetMode) return;
    const hasMapForEdition = Boolean(measureMapEntry && edition);
    const pages =
      hasMapForEdition && !measureMapStale
        ? (measureMapEntry?.pages ?? null)
        : null;
    const snap = pages
      ? barRangeForRect(pages, [
          {
            page: rect.page,
            x0: rect.x,
            y0: rect.y,
            x1: rect.x + rect.w,
            y1: rect.y + rect.h,
          },
        ])
      : null;
    if (snap) {
      setNewRegionStart(String(snap.m_start));
      setNewRegionEnd(String(snap.m_end));
    }
    setNewRegionParentId(selectedRegionId);
    setAddingRegion(true);
    setNavigationNotice(
      snap
        ? `Snapped to measures ${snap.m_start}–${snap.m_end}. Add a title to create the section.`
        : measureMapStale
          ? // A map exists but was scanned against another edition fingerprint —
            // say so rather than claiming the page was never mapped.
            "The measure map is stale for this edition — re-scan to snap selections. Enter the measure range to create the section."
          : "This page isn't mapped yet — enter the measure range to create the section.",
    );
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
          {SECTION_TABS.map(([tab, label], index) => (
            <button
              key={tab}
              ref={(node) => {
                sectionTabRefs.current[tab] = node;
              }}
              type="button"
              role="tab"
              id={`score-region-${region.id}-tab-${tab}`}
              aria-controls={`score-region-${region.id}-panel-${tab}`}
              aria-selected={sectionTab === tab}
              tabIndex={sectionTab === tab ? 0 : -1}
              className={sectionTab === tab ? "is-active" : ""}
              onClick={() => setSectionTab(tab)}
              onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
                let next: number | null = null;
                if (event.key === "ArrowRight" || event.key === "ArrowDown")
                  next = (index + 1) % SECTION_TABS.length;
                else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
                  next =
                    (index - 1 + SECTION_TABS.length) % SECTION_TABS.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = SECTION_TABS.length - 1;
                if (next == null) return;
                event.preventDefault();
                const nextTab = SECTION_TABS[next][0];
                setSectionTab(nextTab);
                requestAnimationFrame(() =>
                  sectionTabRefs.current[nextTab]?.focus(),
                );
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`score-region-${region.id}-panel-${sectionTab}`}
          aria-labelledby={`score-region-${region.id}-tab-${sectionTab}`}
        >
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
                        className={
                          mappingThisRegion.tool === tool ? "is-on" : ""
                        }
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
                                const kind = event.target
                                  .value as PdfAnchorKind;
                                return {
                                  ...current,
                                  rects: current.rects.map(
                                    (item, itemIndex) => {
                                      if (itemIndex !== index) return item;
                                      const { kind: _oldKind, ...geometry } =
                                        item;
                                      return kind === "box"
                                        ? geometry
                                        : { ...geometry, kind };
                                    },
                                  ),
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
                          {anchorKind(rect) === "box"
                            ? "box"
                            : anchorKind(rect)}{" "}
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
              {regionBlocks.length > 0 && (
                <ul className="score-region-blocks">
                  {regionBlocks.slice(0, 2).map((block) => {
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
                // Task C5: a one-gesture start on a sub-section defaults to
                // three consecutive cleans (BlockForm always sends an explicit
                // required_clean_streak, so session_plan_start's child default
                // never gets a chance on this path). Still fully editable, and
                // a top-level region keeps the persisted practice default
                // exactly as before.
                defaultCleanStreak={
                  region.parent_region_id != null ? 3 : defaultCleanStreak
                }
                onOpen={onOpenBlock}
                opening={opening}
                blockedReason={
                  activeRange
                    ? activeRange.m_start === region.m_start &&
                      activeRange.m_end === region.m_end
                      ? "This section is already active in the practice set above."
                      : "Close the active practice set before starting another."
                    : null
                }
              />
            </section>
          )}

          {sectionTab === "tutorial" && (
            <TutorialPanel pieceId={pieceId} regionId={region.id} />
          )}
        </div>
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
    <section
      className={`score-view ${pencilMode ? "is-pencil" : ""}`}
      data-pencil={pencilMode ? "on" : "off"}
      aria-label="PDF score viewer"
    >
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
            className={`score-pencil-toggle ${pencilMode ? "is-active" : ""}`}
            aria-pressed={pencilMode}
            disabled={phase !== "ready" || !edition || targetSavePending}
            onClick={togglePencilMode}
          >
            {pencilMode ? "Put pencil down" : "Pencil"}
          </button>
          <button
            type="button"
            className="score-map-score"
            disabled={phase !== "ready" || !edition}
            title={
              phase !== "ready"
                ? "The score is still loading"
                : !edition
                  ? "Pick an edition first"
                  : undefined
            }
            onClick={openWizard}
          >
            {calibrationAnchors.length > 0
              ? "Edit score map"
              : "Map this score"}
          </button>
          <button
            type="button"
            className="score-map-measures"
            disabled={phase !== "ready" || !edition || pageCount < 1}
            title={
              phase !== "ready"
                ? "The score is still loading"
                : !edition
                  ? "Pick an edition first"
                  : pageCount < 1
                    ? "This edition has no pages yet"
                    : undefined
            }
            onClick={() => setMapPanelOpen(true)}
          >
            Map measures
          </button>
          <button
            type="button"
            className={`score-measure-toggle ${measuresVisible ? "is-active" : ""}`}
            aria-pressed={measuresVisible}
            onClick={() =>
              setMeasuresVisible((current) => {
                const next = !current;
                writeShowMeasuresPreference(next);
                return next;
              })
            }
          >
            {measuresVisible ? "Hide measures" : "Show measures"}
          </button>
          <span
            id={targetInstructionsId}
            className="score-atlas-draw-instructions"
          >
            Drag one rectangle directly on a rendered score page. Its normalized
            geometry stays independent of zoom.
          </span>
          {targetMode && !targetAnchor && (
            <span className="score-atlas-draw-hint" role="status">
              Drag a rectangle on the score to start your target.
            </span>
          )}
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

      {measureMapStale && (
        <div
          className="measure-map-stale"
          role="status"
          data-testid="measure-map-stale"
        >
          <span>
            Measure map is stale — the score changed since it was scanned.
          </span>
          <button type="button" onClick={() => setMapPanelOpen(true)}>
            Re-scan
          </button>
        </div>
      )}

      {(pencilMode || pencilError) && (
        <div className="score-pencil-bar" aria-label="Pencil controls">
          {pencilMode && (
            <span
              className="score-pencil-controls"
              role="group"
              aria-label="Pencil"
            >
              <span className="score-pencil-hint" role="status">
                Pencil on — draw on the page. Escape puts it down.
              </span>
              <button
                type="button"
                className="score-pencil-undo"
                disabled={
                  pencilBusy || (marksByPage[markPage] ?? []).length === 0
                }
                onClick={undoMark}
              >
                Undo mark
              </button>
              {confirmClearPage === markPage ? (
                <span
                  className="score-pencil-confirm"
                  role="alertdialog"
                  aria-label="Confirm clearing this page"
                >
                  <span>
                    {(marksByPage[markPage] ?? []).length === 1
                      ? `Erase the one mark on page ${markPage}?`
                      : `Erase all ${(marksByPage[markPage] ?? []).length} marks on page ${markPage}?`}
                  </span>
                  <button
                    type="button"
                    className="score-pencil-confirm-yes"
                    disabled={pencilBusy}
                    onClick={() => clearMarkPage(markPage)}
                  >
                    Erase page {markPage}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearPage(null)}
                  >
                    Keep them
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="score-pencil-clear"
                  disabled={
                    pencilBusy || (marksByPage[markPage] ?? []).length === 0
                  }
                  onClick={() => setConfirmClearPage(markPage)}
                >
                  Clear page {markPage}
                </button>
              )}
            </span>
          )}
          {pencilError && (
            <span className="score-pencil-error" role="alert">
              {pencilError}
            </span>
          )}
          {pencilMode && staleMarks > 0 && (
            <span className="score-pencil-stale" role="status">
              {staleMarks} earlier {staleMarks === 1 ? "mark is" : "marks are"}{" "}
              kept from a previous version of this file and are not shown — its
              pages may no longer line up.
            </span>
          )}
        </div>
      )}

      <div className="score-viewport">
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
                {mountedPages.map((pageNumber) => {
                  const mappingRegion = mapping
                    ? (regions.find(
                        (region) => region.id === mapping.regionId,
                      ) ?? null)
                    : null;
                  const buffered = !visiblePageList.includes(pageNumber);
                  return (
                    <PdfPage
                      key={pageNumber}
                      document={document}
                      pageNumber={pageNumber}
                      active
                      buffered={buffered}
                      scale={scale}
                      pageImage={pageImageSource}
                      onSize={handlePageSize}
                      onRasterized={handleRasterized}
                    >
                      <RegionOverlay
                        pageNumber={pageNumber}
                        items={overlayItems}
                        mapping={
                          mapping && mappingRegion
                            ? {
                                regionId: mapping.regionId,
                                label:
                                  mappingRegion.notes ?? mappingRegion.name,
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
                        createDrag={
                          !mapping && !targetMode && edition
                            ? { onResolve: handleCreateDragResolve }
                            : null
                        }
                        onSelect={selectRegion}
                      />
                      {measuresVisible && (
                        <MeasureOverlay
                          page={measureMapByPage?.get(pageNumber) ?? null}
                          pageNumber={pageNumber}
                          conflicts={[]}
                          visible={measuresVisible}
                          stale={false}
                        />
                      )}
                      {markEdition && (
                        <PencilOverlay
                          pageNumber={pageNumber}
                          strokes={marksByPage[pageNumber] ?? []}
                          // Armed only in pencil mode, never while the target
                          // tool or the wizard owns the pointer, and never on a
                          // buffered off-screen neighbor.
                          active={
                            pencilMode &&
                            !targetMode &&
                            !wizardOpen &&
                            !buffered
                          }
                          onStroke={handleStroke}
                        />
                      )}
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
              {selectedRegion &&
                selectedRegion.parent_region_id == null &&
                !subsectionHintSeen && (
                  <p className="score-subsection-hint" role="status">
                    Drag inside <strong>{selectedRegion.name}</strong> on the
                    score to isolate a spot — a 2-beat or 5-note micro-target
                    inside this section.
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
                  onClick={() =>
                    setAddingRegion((value) => {
                      if (value) {
                        setNewRegionParentId(null);
                      } else if (
                        selectedRegion &&
                        selectedRegion.parent_region_id == null
                      ) {
                        // §4b / spec 5.8: with a section selected, the
                        // obvious button must build INSIDE it. Opening the
                        // form used to leave the parent unset, so "+ Add"
                        // silently made another top-level section — the
                        // exact reason sub-sections were never created in
                        // real use.
                        setNewRegionParentId(selectedRegion.id);
                      }
                      return !value;
                    })
                  }
                >
                  {addingRegion ? "Cancel" : "+ Add"}
                </button>
              </div>
              {addingRegion &&
                selectedRegion &&
                selectedRegion.parent_region_id == null && (
                  <label className="score-subsection-choice">
                    <input
                      type="checkbox"
                      checked={newRegionParentId === selectedRegion.id}
                      onChange={(event) =>
                        setNewRegionParentId(
                          event.target.checked ? selectedRegion.id : null,
                        )
                      }
                    />
                    <span>Sub-section of {selectedRegion.name}</span>
                  </label>
                )}
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
                      onChange={(event) =>
                        setNewRegionTitle(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Practice notes</span>
                    <textarea
                      aria-label="New score tricky section practice notes"
                      maxLength={10000}
                      value={newRegionNotes}
                      onChange={(event) =>
                        setNewRegionNotes(event.target.value)
                      }
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
                        onChange={(event) =>
                          setNewRegionEnd(event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <button type="submit" disabled={creatingRegion}>
                    {creatingRegion ? "Creating…" : "Create + mark score"}
                  </button>
                </form>
              )}
              <p className="score-region-order-note">
                In score order · click a section to open its tools, then drag
                inside it on the score to add a sub-section
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
                          style={{
                            background: region.color ?? "var(--accent)",
                          }}
                        />
                        <span>
                          <strong>{region.name}</strong>
                          <small>
                            mm. {region.m_start}–{region.m_end}
                            {noteSummary ? ` · ${noteSummary}` : ""}
                          </small>
                        </span>
                        {(childCounts.get(region.id) ?? 0) > 0 && (
                          <span className="score-region-subsection-badge">
                            {childCounts.get(region.id)} sub-section
                            {childCounts.get(region.id) === 1 ? "" : "s"}
                          </span>
                        )}
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
                        <span
                          className="score-region-chevron"
                          aria-hidden="true"
                        >
                          {expanded ? "⌄" : "›"}
                        </span>
                      </button>
                      {expanded && renderRegionInspector(region)}
                    </div>
                  );
                })}
                {displayedRegions.length === 0 && (
                  <p className="tutorial-empty">
                    {regions.length === 0
                      ? "No tricky sections yet — drag on the score to mark your first one."
                      : regionQuery.trim()
                        ? "No sections match that search."
                        : "Nothing to show here yet."}
                  </p>
                )}
              </div>
            </aside>

            {targetMode && targetDraftId && edition && targetAnchor && (
              <aside
                className={`score-atlas-draft-dock is-${dockCorner} ${
                  dockCollapsed ? "is-collapsed" : ""
                }`}
                aria-label="New target draft editor"
              >
                <div className="score-atlas-dock-bar">
                  <span className="score-atlas-dock-title">Target draft</span>
                  <div className="score-atlas-dock-controls">
                    <button
                      type="button"
                      className="score-atlas-dock-btn"
                      aria-label={
                        dockCorner === "top-right"
                          ? "Move draft to bottom-right corner"
                          : "Move draft to top-right corner"
                      }
                      title="Move corner"
                      onClick={() =>
                        setDockCorner((corner) =>
                          corner === "top-right" ? "bottom-right" : "top-right",
                        )
                      }
                    >
                      <span aria-hidden="true">
                        {dockCorner === "top-right" ? "⤓" : "⤒"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="score-atlas-dock-btn"
                      aria-expanded={!dockCollapsed}
                      aria-label={
                        dockCollapsed
                          ? "Expand target draft"
                          : "Collapse target draft"
                      }
                      title={dockCollapsed ? "Expand" : "Collapse"}
                      onClick={() => setDockCollapsed((value) => !value)}
                    >
                      <span aria-hidden="true">
                        {dockCollapsed ? "▸" : "▾"}
                      </span>
                    </button>
                  </div>
                </div>
                {!dockCollapsed && (
                  <div className="score-atlas-dock-body">
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
                  </div>
                )}
              </aside>
            )}
          </div>
        )}

        {firstPagePreview && (
          <img
            className="score-first-page-preview"
            src={firstPagePreview}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        )}
      </div>

      {wizardOpen && edition && (
        <MapScoreWizard
          pieceId={pieceId}
          edition={{
            edition_id: edition.id,
            edition_fingerprint: edition.fingerprint,
          }}
          pageCount={pageCount}
          renderPage={renderWizardPage}
          initialAnchors={calibrationAnchors}
          pageTextItems={pageTextItems}
          xmlMaxMeasure={xmlFacts?.maxMeasure ?? null}
          xmlLandmarks={xmlFacts?.landmarks}
          hasPickup={xmlFacts?.hasPickup ?? false}
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

      {mapPanelOpen && edition && document && (
        <div className="measure-map-panel-backdrop" role="presentation">
          <MeasureMapPanel
            pieceId={pieceId}
            editionId={edition.id}
            editionFingerprint={edition.fingerprint}
            pageCount={pageCount}
            onClose={() => setMapPanelOpen(false)}
            onApplied={() => setMapPanelOpen(false)}
            rasterizePage={rasterizePageForScan}
            onDirtyChange={onMeasureMapDirtyChange}
          />
        </div>
      )}
    </section>
  );
}
