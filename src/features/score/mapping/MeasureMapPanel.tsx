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
  dragBarline,
  isBlockingConflict,
  isNeedsClientRaster,
  measureMapApply,
  measureReconcile,
  measureScanPage,
  publishMeasureMap,
  renumberBar,
  type BarLocation,
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
   * on the `needs_client_raster` retry AND (display-only) to paint the page
   * under review behind the overlay, so the human has something real to
   * judge barlines against instead of an empty box. */
  rasterizePage: (page: number) => Promise<number[]>;
  /** Reports whenever this panel has unsaved review work in memory (a scan
   * in progress, or a reconciled-but-not-yet-Applied review) — the caller
   * uses this to guard in-app piece switching (which unmounts this panel
   * without warning, unlike the tab-level `beforeunload` guard below). */
  onDirtyChange?: (dirty: boolean) => void;
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
  onDirtyChange,
  api = defaultApi,
}: MeasureMapPanelProps) {
  const [stage, setStage] = useState<Stage>("intro");
  const [scanProgress, setScanProgress] = useState<{
    page: number;
    total: number;
  } | null>(null);
  const [workingPages, setWorkingPages] = useState<MeasureMapPageRow[]>([]);
  const [conflicts, setConflicts] = useState<MapConflict[]>([]);
  const [hasPickup, setHasPickup] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  /** Pages the human chose to leave unmapped rather than fix (F3, partial
   * Apply). The store treats a re-apply as the new whole truth for this
   * fingerprint, so omitting a page from the payload simply leaves it
   * unmapped — see `store::measure_map`'s own module doc. */
  const [skippedPages, setSkippedPages] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );
  const cancelRef = useRef(false);
  const pageImagesRef = useRef<Record<number, string>>({});
  const requestedImagesRef = useRef(new Set<number>());
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  const hasUnsavedWork = dirty && (stage === "review" || stage === "scanning");

  // Warn on navigating away from an unsaved review — never mid-scan silence,
  // never after a clean Apply (the existing app-wide confirm idiom: an
  // explicit `beforeunload` guard while there is unapplied work in memory).
  useEffect(() => {
    if (!hasUnsavedWork) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedWork]);

  // Report the same "unsaved work" signal to the caller so IN-APP piece
  // switching (which unmounts this panel directly, never touching
  // `beforeunload`) can guard itself too.
  useEffect(() => {
    onDirtyChange?.(hasUnsavedWork);
  }, [hasUnsavedWork, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Display-only page rasters behind the overlay, one per page actually
  // visited in review — fetched lazily (not all `pageCount` up front) via
  // the SAME `rasterizePage` callback the client-raster retry uses. Revoked
  // on unmount; never gates interaction (a missing image just leaves the
  // overlay over blank space, exactly like before this fix round).
  useEffect(() => {
    if (stage !== "review" && stage !== "applying" && stage !== "applied") {
      return;
    }
    if (
      requestedImagesRef.current.has(reviewPage) ||
      pageImagesRef.current[reviewPage]
    ) {
      return;
    }
    requestedImagesRef.current.add(reviewPage);
    let cancelled = false;
    void rasterizePage(reviewPage)
      .then((bytes) => {
        if (cancelled || typeof URL.createObjectURL !== "function") return;
        const blob = new Blob([new Uint8Array(bytes)], {
          type: "image/jpeg",
        });
        const url = URL.createObjectURL(blob);
        pageImagesRef.current = { ...pageImagesRef.current, [reviewPage]: url };
        setPageImages(pageImagesRef.current);
      })
      .catch(() => {
        // Display-only: a failed raster just leaves that page's preview
        // blank. Allow a later retry (e.g. a page nav back to it).
        requestedImagesRef.current.delete(reviewPage);
      });
    return () => {
      cancelled = true;
    };
  }, [rasterizePage, reviewPage, stage]);

  useEffect(
    () => () => {
      for (const url of Object.values(pageImagesRef.current)) {
        if (typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(url);
        }
      }
    },
    [],
  );

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
      setSkippedPages(new Set<number>());
      setHasPickup(reconciled.has_pickup);
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

  // B83: `window.confirm` is banned in this codebase — wry/WKWebView has
  // historically returned falsy from it silently, which here would have
  // meant the ×, Cancel, AND Escape paths all silently no-op once the panel
  // is dirty, trapping the user in a dialog they cannot close. Replaced with
  // the same inline-confirm idiom as SessionBar.tsx's "End my day" flow
  // (see SessionBar.tsx around its `confirmingEndDay` state): a two-step
  // in-page confirmation, no native dialog.
  const actuallyDiscard = useCallback(() => {
    setStage("intro");
    setWorkingPages([]);
    setConflicts([]);
    setSkippedPages(new Set<number>());
    setDirty(false);
    setError(null);
    setApplyError(null);
    setConfirmingDiscard(false);
    onClose();
  }, [onClose]);

  const discardReview = useCallback(() => {
    if (dirty) {
      setConfirmingDiscard(true);
      return;
    }
    actuallyDiscard();
  }, [actuallyDiscard, dirty]);

  const confirmDiscard = useCallback(() => {
    actuallyDiscard();
  }, [actuallyDiscard]);

  const cancelDiscardConfirm = useCallback(() => {
    setConfirmingDiscard(false);
  }, []);

  // B83 follow-up to B77: keep the close handler in a ref so the trap effect
  // below can stay mounted for the panel's whole lifetime. `discardReview`'s
  // identity changes on every `dirty` transition (ordinary bar clicks and
  // edits) — if the effect depended on it directly, each transition would
  // tear it down and its cleanup would fire `openerRef.current?.focus()`,
  // yanking focus out of the dialog and back to the opener behind the scrim
  // mid-edit, then immediately re-focus the dialog root. The ref keeps the
  // effect's dependency array empty so it only mounts/unmounts once, and the
  // "restore focus to the opener" cleanup only ever runs on real unmount.
  const discardReviewRef = useRef(discardReview);
  useEffect(() => {
    discardReviewRef.current = discardReview;
  }, [discardReview]);

  // B77: trap focus inside this dialog. Without this, Tab from inside the
  // panel reaches the dock controls behind the scrim — including the rep
  // verdict buttons, where Enter records a real practice rep.
  useEffect(() => {
    openerRef.current = document.activeElement;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        discardReviewRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === root)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

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
      // `conflicts` is threaded IN so the local pass merges rather than
      // replaces: a renumber re-derives continuity breaks only, and must
      // never clear a structural conflict it cannot see (live-QA Critical).
      const result = renumberBar(
        workingPages,
        { pageIndex, systemIndex, barIndex },
        Math.trunc(parsed),
        hasPickup,
        conflicts,
      );
      setWorkingPages(result.pages);
      setConflicts(result.conflicts);
      setDirty(true);
    },
    [conflicts, hasPickup, workingPages],
  );

  const handleBarDrag = useCallback(
    (
      pageIndex: number,
      systemIndex: number,
      barIndex: number,
      newXRight: number,
    ) => {
      const location: BarLocation = { pageIndex, systemIndex, barIndex };
      setWorkingPages((current) => dragBarline(current, location, newXRight));
      setDirty(true);
    },
    [],
  );

  const toggleSkipPage = useCallback((page: number) => {
    setSkippedPages((current) => {
      const next = new Set(current);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
    setDirty(true);
  }, []);

  // Apply gates on BLOCKING conflicts only, and only on pages that are
  // actually being applied: an informational row (derived_bar_count,
  // low_confidence_anchor, pickup_ambiguity, total_mismatch) is worth showing
  // but never worth blocking on, and a skipped page's defects leave with it.
  const pagesToApply = workingPages.filter(
    (row) => !skippedPages.has(row.page),
  );
  const blockingConflicts = conflicts.filter(isBlockingConflict);
  const activeBlockingConflicts = blockingConflicts.filter(
    (conflict) => !("page" in conflict) || !skippedPages.has(conflict.page),
  );
  const applyBlocked =
    activeBlockingConflicts.length > 0 || pagesToApply.length === 0;

  const applyReview = useCallback(async () => {
    if (applyBlocked) return;
    setStage("applying");
    setApplyError(null);
    try {
      await api.apply(pieceId, editionId, editionFingerprint, pagesToApply);
      publishMeasureMap(pieceId, editionId, editionFingerprint, pagesToApply);
      setDirty(false);
      setStage("applied");
      onApplied?.(pagesToApply);
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
    applyBlocked,
    editionFingerprint,
    editionId,
    onApplied,
    pagesToApply,
    pieceId,
  ]);

  const currentRow =
    workingPages.find((row) => row.page === reviewPage) ?? null;
  const currentPageIndex = workingPages.findIndex(
    (row) => row.page === reviewPage,
  );
  const currentPageIsBlocked = blockingConflicts.some(
    (conflict) => "page" in conflict && conflict.page === reviewPage,
  );
  const currentPageSkipped = skippedPages.has(reviewPage);
  const hasInterpolatedBars = workingPages.some((row) =>
    row.map.systems.some((system) =>
      system.bars.some((bar) => bar.source === "interpolated"),
    ),
  );

  return (
    <div
      ref={dialogRef}
      className="measure-map-panel"
      data-testid="measure-map-panel"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <header className="measure-map-panel-head">
        <h2>Map measures</h2>
        {confirmingDiscard ? (
          <span
            className="measure-map-discard-confirm"
            data-testid="measure-map-discard-confirm"
          >
            <span className="measure-map-discard-confirm-ask">
              Discard this review? Nothing will be applied.
            </span>
            <button
              type="button"
              className="measure-map-discard-confirm-action"
              data-testid="measure-map-discard-confirm-yes"
              onClick={confirmDiscard}
            >
              Discard
            </button>
            <button
              type="button"
              className="measure-map-discard-confirm-action"
              aria-label="Keep this review"
              data-testid="measure-map-discard-confirm-no"
              onClick={cancelDiscardConfirm}
            >
              Keep working
            </button>
          </span>
        ) : (
          <button type="button" onClick={discardReview} aria-label="Close">
            ×
          </button>
        )}
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
                {conflicts.map((conflict, index) => {
                  const blocking = isBlockingConflict(conflict);
                  return (
                    <li
                      key={index}
                      className={blocking ? "is-blocking" : "is-informational"}
                      data-testid={
                        blocking
                          ? "measure-map-conflict-blocking"
                          : "measure-map-conflict-informational"
                      }
                    >
                      {describeConflict(conflict)}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {hasInterpolatedBars && (
            <p
              className="measure-map-legend"
              data-testid="measure-map-interpolated-legend"
            >
              Dashed numbers were interpolated from surrounding printed numbers,
              not read directly.
            </p>
          )}

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
            {(currentPageIsBlocked || currentPageSkipped) &&
              stage === "review" && (
                <button
                  type="button"
                  className="measure-map-skip-page"
                  data-testid="measure-map-skip-page"
                  onClick={() => toggleSkipPage(reviewPage)}
                >
                  {currentPageSkipped ? "Include this page" : "Skip this page"}
                </button>
              )}
          </div>
          {currentPageSkipped && (
            <p
              className="measure-map-legend"
              data-testid="measure-map-page-skipped"
            >
              Page {reviewPage} is skipped — it will stay unmapped.
            </p>
          )}

          <div className="measure-map-page-preview">
            {pageImages[reviewPage] && (
              <img
                className="measure-map-page-image"
                src={pageImages[reviewPage]}
                alt=""
                aria-hidden="true"
                draggable={false}
                data-testid="measure-map-page-image"
              />
            )}
            <MeasureOverlay
              page={currentRow?.map ?? null}
              pageNumber={reviewPage}
              conflicts={conflicts}
              visible
              stale={false}
              readOnly={stage === "applied"}
              onBarClick={
                stage === "applied"
                  ? undefined
                  : (systemIndex, barIndex, currentNumber) =>
                      handleBarClick(
                        Math.max(0, currentPageIndex),
                        systemIndex,
                        barIndex,
                        currentNumber,
                      )
              }
              onBarDrag={
                stage === "applied"
                  ? undefined
                  : (systemIndex, barIndex, newXRight) =>
                      handleBarDrag(
                        Math.max(0, currentPageIndex),
                        systemIndex,
                        barIndex,
                        newXRight,
                      )
              }
            />
          </div>

          {skippedPages.size > 0 && (
            <p
              className="measure-map-apply-summary"
              data-testid="measure-map-apply-summary"
            >
              Applying {pagesToApply.length} of {workingPages.length} pages —{" "}
              {skippedPages.size} skipped stay unmapped.
            </p>
          )}

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
                applyBlocked || stage === "applying" || stage === "applied"
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
    case "unapplyable":
      return conflict.system === 0
        ? `Page ${conflict.page}: ${conflict.reason} (this page cannot be applied as-is).`
        : `Page ${conflict.page}, system ${conflict.system}: ${conflict.reason} (cannot be applied as-is).`;
    case "derived_bar_count":
      return `Page ${conflict.page}, system ${conflict.system}: bar count corrected from ${conflict.found} to ${conflict.expected} using the printed numbers before and after it.`;
    default:
      return "Unrecognized conflict.";
  }
}
