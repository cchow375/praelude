// The scan → reconcile → review → Apply flow (Plan C, task C4).
//
// Deliberately self-contained: the caller (ScoreView, which already owns the
// live PDF.js document) hands in `pageCount` and a `rasterizePage` callback
// for the one path that needs pixels — the `needs_client_raster` retry — so
// this component never opens a second copy of the PDF itself. Everything else
// is pure orchestration over the injectable `api` (defaults to the real
// `measureMap.ts` invoke wrappers; tests inject spies/fakes).
//
// Global constraint (binding): "Nothing is stored as mapping truth until
// Apply. Cancel discards everything." — this component never calls
// `measure_map_apply` except from the Apply button's own handler, and Cancel
// never calls it at all.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isNeedsClientRaster,
  measureMapApply,
  measureReconcile,
  measureScanPage,
  publishMeasureMap,
  renumberBar,
  type MapConflict,
  type MeasureMapPageRow,
  type ReconcilePageInput,
  type ReconcileResult,
} from "./measureMap";
import { MeasureOverlay } from "./MeasureOverlay";
import "./measureMapping.css";

type Stage = "intro" | "scanning" | "review" | "applying" | "applied" | "error";

export interface MeasureMapApi {
  scanPage: typeof measureScanPage;
  reconcile: typeof measureReconcile;
  apply: typeof measureMapApply;
}

const defaultApi: MeasureMapApi = {
  scanPage: measureScanPage,
  reconcile: measureReconcile,
  apply: measureMapApply,
};

export interface MeasureMapPanelProps {
  pieceId: number;
  editionId: string;
  editionFingerprint: string;
  pageCount: number;
  onClose: () => void;
  onApplied?: (pages: MeasureMapPageRow[]) => void;
  /** Render the given 1-based page to a JPEG (the `firstPageCache` idiom:
   * `canvas.toBlob(..., "image/jpeg", 0.85)`), as a plain byte array — used
   * ONLY on the `needs_client_raster` retry. */
  rasterizePage: (page: number) => Promise<number[]>;
  api?: MeasureMapApi;
}

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "Something went wrong.";
}

export function MeasureMapPanel({
  pieceId,
  editionId,
  editionFingerprint,
  pageCount,
  onClose,
  onApplied,
  rasterizePage,
  api = defaultApi,
}: MeasureMapPanelProps) {
  const [stage, setStage] = useState<Stage>("intro");
  const [scanProgress, setScanProgress] = useState<{
    page: number;
    total: number;
  } | null>(null);
  const [workingPages, setWorkingPages] = useState<MeasureMapPageRow[]>([]);
  const [conflicts, setConflicts] = useState<MapConflict[]>([]);
  const [reviewPage, setReviewPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const cancelRef = useRef(false);

  // Warn on navigating away from an unsaved review — never mid-scan silence,
  // never after a clean Apply (the existing app-wide confirm idiom: an
  // explicit `beforeunload` guard while there is unapplied work in memory).
  useEffect(() => {
    if (!dirty || (stage !== "review" && stage !== "scanning"))
      return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, stage]);

  const startScan = useCallback(async () => {
    setStage("scanning");
    setError(null);
    cancelRef.current = false;
    setDirty(true);
    const results: ReconcilePageInput[] = [];
    for (let page = 1; page <= pageCount; page += 1) {
      if (cancelRef.current) break;
      setScanProgress({ page, total: pageCount });
      try {
        let scan;
        try {
          scan = await api.scanPage(
            pieceId,
            editionId,
            editionFingerprint,
            page,
            null,
          );
        } catch (reason) {
          if (!isNeedsClientRaster(reason)) throw reason;
          const jpeg = await rasterizePage(page);
          scan = await api.scanPage(
            pieceId,
            editionId,
            editionFingerprint,
            page,
            jpeg,
          );
        }
        results.push({ page, scan });
      } catch (reason) {
        setError(messageOf(reason));
        setStage("error");
        return;
      }
    }
    if (results.length === 0) {
      setError("No pages were scanned before the scan was cancelled.");
      setStage("error");
      return;
    }
    try {
      const reconciled: ReconcileResult = await api.reconcile(
        pieceId,
        editionId,
        editionFingerprint,
        results,
      );
      setWorkingPages(reconciled.pages);
      setConflicts(reconciled.conflicts);
      setReviewPage(reconciled.pages[0]?.page ?? 1);
      setStage("review");
    } catch (reason) {
      setError(messageOf(reason));
      setStage("error");
    }
  }, [api, editionFingerprint, editionId, pageCount, pieceId, rasterizePage]);

  const cancelScan = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const discardReview = useCallback(() => {
    if (
      dirty &&
      !window.confirm("Discard this review? Nothing will be applied.")
    ) {
      return;
    }
    setStage("intro");
    setWorkingPages([]);
    setConflicts([]);
    setDirty(false);
    setError(null);
    setApplyError(null);
    onClose();
  }, [dirty, onClose]);

  const handleBarClick = useCallback(
    (
      pageIndex: number,
      systemIndex: number,
      barIndex: number,
      currentNumber: number,
    ) => {
      const input = window.prompt(
        "New measure number for this bar:",
        String(currentNumber),
      );
      if (input == null) return;
      const parsed = Number(input);
      if (!Number.isFinite(parsed) || parsed < 0) return;
      const result = renumberBar(
        workingPages,
        { pageIndex, systemIndex, barIndex },
        Math.trunc(parsed),
      );
      setWorkingPages(result.pages);
      setConflicts(result.conflicts);
      setDirty(true);
    },
    [workingPages],
  );

  const applyReview = useCallback(async () => {
    if (conflicts.length > 0) return;
    setStage("applying");
    setApplyError(null);
    try {
      await api.apply(pieceId, editionId, editionFingerprint, workingPages);
      publishMeasureMap(pieceId, editionId, editionFingerprint, workingPages);
      setDirty(false);
      setStage("applied");
      onApplied?.(workingPages);
    } catch (reason) {
      // Apply rejected (e.g. a reconciled result whose conflicts were all
      // resolved but the whole-payload validation still fails elsewhere) —
      // surface it and keep the review state exactly as it was so nothing is
      // lost; the user can adjust and retry.
      setApplyError(messageOf(reason));
      setStage("review");
    }
  }, [
    api,
    conflicts.length,
    editionFingerprint,
    editionId,
    onApplied,
    pieceId,
    workingPages,
  ]);

  const currentRow =
    workingPages.find((row) => row.page === reviewPage) ?? null;
  const currentPageIndex = workingPages.findIndex(
    (row) => row.page === reviewPage,
  );

  return (
    <div
      className="measure-map-panel"
      data-testid="measure-map-panel"
      role="dialog"
    >
      <header className="measure-map-panel-head">
        <h2>Map measures</h2>
        <button type="button" onClick={discardReview} aria-label="Close">
          ×
        </button>
      </header>

      {stage === "intro" && (
        <div className="measure-map-intro">
          <p>
            This sends {pageCount} page{pageCount === 1 ? "" : "s"} of this
            score to a vision model (Claude, falling back to Gemini) to read the
            printed system and bar geometry — the same one-shot, confirm-gated
            posture as the Brain. Nothing is written to this piece until you
            review and Apply.
          </p>
          <button type="button" onClick={() => void startScan()}>
            Start scan
          </button>
        </div>
      )}

      {stage === "scanning" && (
        <div className="measure-map-progress">
          <p role="status" data-testid="measure-map-progress-text">
            {scanProgress
              ? `Page ${scanProgress.page} of ${scanProgress.total}`
              : "Starting…"}
          </p>
          <button type="button" onClick={cancelScan}>
            Cancel
          </button>
        </div>
      )}

      {stage === "error" && (
        <div className="measure-map-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={discardReview}>
            Close
          </button>
        </div>
      )}

      {(stage === "review" || stage === "applying" || stage === "applied") && (
        <div className="measure-map-review">
          {applyError && (
            <p className="measure-map-apply-error" role="alert">
              Apply failed: {applyError}
            </p>
          )}
          {stage === "applied" && (
            <p role="status" className="measure-map-applied">
              Applied.
            </p>
          )}
          <div className="measure-map-conflicts" aria-label="Conflicts">
            {conflicts.length === 0 ? (
              <p data-testid="measure-map-no-conflicts">No conflicts.</p>
            ) : (
              <ul data-testid="measure-map-conflict-list">
                {conflicts.map((conflict, index) => (
                  <li key={index}>{describeConflict(conflict)}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="measure-map-page-nav">
            <button
              type="button"
              disabled={currentPageIndex <= 0}
              onClick={() =>
                setReviewPage(
                  workingPages[currentPageIndex - 1]?.page ?? reviewPage,
                )
              }
            >
              ‹
            </button>
            <span>Page {reviewPage}</span>
            <button
              type="button"
              disabled={
                currentPageIndex < 0 ||
                currentPageIndex >= workingPages.length - 1
              }
              onClick={() =>
                setReviewPage(
                  workingPages[currentPageIndex + 1]?.page ?? reviewPage,
                )
              }
            >
              ›
            </button>
          </div>

          <div className="measure-map-page-preview">
            <MeasureOverlay
              page={currentRow?.map ?? null}
              pageNumber={reviewPage}
              conflicts={conflicts}
              visible
              stale={false}
              onBarClick={(systemIndex, barIndex, currentNumber) =>
                handleBarClick(
                  Math.max(0, currentPageIndex),
                  systemIndex,
                  barIndex,
                  currentNumber,
                )
              }
            />
          </div>

          <div className="measure-map-actions">
            <button
              type="button"
              onClick={discardReview}
              disabled={stage === "applying"}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void applyReview()}
              disabled={
                conflicts.length > 0 ||
                stage === "applying" ||
                stage === "applied"
              }
              data-testid="measure-map-apply"
            >
              {stage === "applying" ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function describeConflict(conflict: MapConflict): string {
  switch (conflict.kind) {
    case "pickup_ambiguity":
      return `Page ${conflict.page}: the first bar's number is ambiguous (this piece has a pickup measure).`;
    case "continuity_break":
      return `Page ${conflict.page}, system ${conflict.system}: expected a gap of ${conflict.expected} bars but found ${conflict.found}.`;
    case "total_mismatch":
      return `The mapped total (${conflict.mapped}) does not match the score's MusicXML total (${conflict.xml}).`;
    case "anchor_disagreement":
      return `Page ${conflict.page}: a saved calibration point says measure ${conflict.anchor_measure}, but this maps to ${conflict.mapped_measure}.`;
    case "low_confidence_anchor":
      return `Page ${conflict.page}, system ${conflict.system}: printed number ${conflict.measure} was read with low confidence (${Math.round(conflict.confidence * 100)}%).`;
    case "overlapping_systems":
      return `Page ${conflict.page}: systems ${conflict.system_a} and ${conflict.system_b} overlap.`;
    default:
      return "Unrecognized conflict.";
  }
}
