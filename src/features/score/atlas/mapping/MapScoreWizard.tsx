import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Button, Dialog } from "../../../../ui";
import {
  resolveMeasureRange,
  validateAgainstXml,
  type LineAnchor,
} from "./anchors";
import {
  buildMeasureStrip,
  measureRangeForSystem,
  placeMeasure,
  type MeasureLandmark,
} from "./strip";
import {
  suggestMeasure,
  type MeasurePrefillSource,
  type PrefillTextItem,
} from "./prefill";
import {
  defaultCalibrationApi,
  type CalibrationApi,
  type CalibrationView,
} from "./calibrationApi";
import type { EditionIdentity } from "../model";
import "./mapping.css";

export interface MapScoreWizardProps {
  pieceId: number;
  edition: EditionIdentity;
  pageCount: number;
  /** Render the real PDF page surface. Omitted in tests → a plain placeholder. */
  renderPage?: (pageNumber: number) => ReactNode;
  /** Anchors already saved for this edition, so the wizard resumes a partial map. */
  initialAnchors?: LineAnchor[];
  /**
   * Resolve the page's PDF text layer (normalized runs) for measure-number
   * prefill. Optional: a scanned edition or a test harness omits it, and the
   * wizard degrades silently to anchor/prediction prefill.
   */
  pageTextItems?: (pageNumber: number) => Promise<PrefillTextItem[] | null>;
  api?: CalibrationApi;
  /** MusicXML measure count, when known, to flag anchors beyond the score. */
  xmlMaxMeasure?: number | null;
  /**
   * Optional per-measure MusicXML landmarks (key/time/tempo/rehearsal/section)
   * for the strip. None exists on the frontend today (no Tauri command exposes
   * the backend's `ScoreMeasureFact`), so this is a forward-compatible seam: the
   * strip renders fine from anchors alone when it is omitted.
   */
  xmlLandmarks?: MeasureLandmark[];
  hasPickup?: boolean;
  onSaved?: (view: CalibrationView, anchors: LineAnchor[]) => void;
  onClose: () => void;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * "Map this score" wizard. The user steps page by page, clicks each system's
 * start (or types its vertical position), types the printed measure number, and
 * saves the resulting line anchors through `score_calibration_save`. Partial
 * maps are valid — any page can be skipped, and a map with a single anchor still
 * saves. The anchors it stores are what makes every drawn box resolve to
 * measures instantly, retiring the mapping-required dead end.
 */
export function MapScoreWizard({
  pieceId,
  edition,
  pageCount,
  renderPage,
  initialAnchors = [],
  pageTextItems,
  api = defaultCalibrationApi,
  xmlMaxMeasure = null,
  xmlLandmarks,
  hasPickup = false,
  onSaved,
  onClose,
}: MapScoreWizardProps) {
  const headingId = useId();
  const [page, setPage] = useState(1);
  const [anchors, setAnchors] = useState<LineAnchor[]>(initialAnchors);
  const [pendingY, setPendingY] = useState<number | null>(null);
  const [measureDraft, setMeasureDraft] = useState("");
  const [prefillSource, setPrefillSource] =
    useState<MeasurePrefillSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const prefillTokenRef = useRef(0);

  const totalPages = Math.max(1, pageCount);
  const pageAnchors = useMemo(
    () =>
      anchors
        .filter((anchor) => anchor.page === page)
        .sort((a, b) => a.yPct - b.yPct),
    [anchors, page],
  );

  // The parallel measure strip, rebuilt from the current anchors (+ XML total /
  // landmarks when the caller can supply them). This is the right-hand column.
  const strip = useMemo(
    () =>
      buildMeasureStrip(anchors, {
        xmlMaxMeasure,
        landmarks: xmlLandmarks,
      }),
    [anchors, xmlMaxMeasure, xmlLandmarks],
  );

  // The systems (anchored lines) shown on the current page, with reading-order
  // index so a page click and a strip click select the same thing.
  const pageSystems = useMemo(
    () => strip.systems.filter((system) => system.page === page),
    [strip.systems, page],
  );

  // Two-way selection: one selected system + the measure that anchored the pick.
  const [selection, setSelection] = useState<{
    systemIndex: number;
    measure: number;
  } | null>(null);
  const selectedRange = useMemo(
    () =>
      selection ? measureRangeForSystem(strip, selection.systemIndex) : null,
    [selection, strip],
  );

  // Scroll containers for the aligned two-way scroll. `syncingRef` guards against
  // the feedback loop of one scroll driving the other driving the first.
  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  const stripScrollRef = useRef<HTMLDivElement | null>(null);
  const stripRowRefs = useRef(new Map<number, HTMLLIElement>());
  const syncingRef = useRef(false);

  const scrollStripToMeasure = useCallback((measure: number) => {
    const container = stripScrollRef.current;
    const row = stripRowRefs.current.get(measure);
    if (!container || !row) return;
    syncingRef.current = true;
    container.scrollTop =
      row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2;
  }, []);

  const scrollPageToBand = useCallback((yTop: number, yBottom: number) => {
    const container = pageScrollRef.current;
    if (!container) return;
    const max = container.scrollHeight - container.clientHeight;
    if (max <= 0) return;
    const mid = ((yTop + yBottom) / 2) * container.scrollHeight;
    syncingRef.current = true;
    container.scrollTop = Math.max(
      0,
      Math.min(max, mid - container.clientHeight / 2),
    );
  }, []);

  // CLICK A MEASURE (strip) → select + reveal its system band on the PDF.
  const selectMeasure = useCallback(
    (measure: number) => {
      const placed = placeMeasure(strip, measure);
      if (!placed) return;
      setSelection({ systemIndex: placed.systemIndex, measure });
      if (placed.page !== page) setPage(placed.page);
      scrollStripToMeasure(measure);
      scrollPageToBand(placed.yTop, placed.yBottom);
    },
    [strip, page, scrollStripToMeasure, scrollPageToBand],
  );

  // CLICK A SYSTEM (PDF) → select + reveal its measure range in the strip.
  const selectSystem = useCallback(
    (systemIndex: number) => {
      const range = measureRangeForSystem(strip, systemIndex);
      if (!range) return;
      setSelection({ systemIndex, measure: range.mStart });
      scrollStripToMeasure(range.mStart);
    },
    [strip, scrollStripToMeasure],
  );

  // Mirror one scroll container's fraction onto the other, once, with the guard.
  const mirrorScroll = useCallback(
    (source: HTMLDivElement | null, target: HTMLDivElement | null) => {
      if (!source || !target) return;
      if (syncingRef.current) {
        syncingRef.current = false;
        return;
      }
      const sMax = source.scrollHeight - source.clientHeight;
      const tMax = target.scrollHeight - target.clientHeight;
      if (sMax <= 0 || tMax <= 0) return;
      syncingRef.current = true;
      target.scrollTop = (source.scrollTop / sMax) * tMax;
    },
    [],
  );

  // Anchors already saved for this edition are keyed so prediction (priority 3)
  // only counts systems the user marked during THIS run.
  const initialKeyset = useMemo(
    () =>
      new Set(initialAnchors.map((a) => `${a.page}:${a.yPct}:${a.measure}`)),
    [initialAnchors],
  );

  /**
   * Propose the measure at a clicked system start (anchors → text layer →
   * prediction) and pre-fill the still-editable measure field with a provenance
   * tag. Never saves; the user confirms with "Add line".
   */
  const applyPrefill = useCallback(
    (targetPage: number, yPct: number) => {
      const token = ++prefillTokenRef.current;
      const runAnchors = anchors.filter(
        (a) => !initialKeyset.has(`${a.page}:${a.yPct}:${a.measure}`),
      );
      const commit = (measure: number, source: MeasurePrefillSource) => {
        setMeasureDraft(String(measure));
        setPrefillSource(source);
      };
      // Synchronous sources (exact anchor match, then prediction) fill instantly.
      const immediate = suggestMeasure({
        anchors,
        runAnchors,
        page: targetPage,
        yPct,
        textItems: null,
        xmlMaxMeasure,
      });
      if (immediate?.source === "anchors") {
        commit(immediate.measure, "anchors");
        return;
      }
      // The text layer (async) is preferred over a prediction when it has a
      // plausible printed number; otherwise the immediate prediction stands.
      if (pageTextItems) {
        void pageTextItems(targetPage)
          .then((textItems) => {
            if (token !== prefillTokenRef.current) return;
            const withText = suggestMeasure({
              anchors,
              runAnchors,
              page: targetPage,
              yPct,
              textItems: textItems ?? null,
              xmlMaxMeasure,
            });
            if (withText) commit(withText.measure, withText.source);
          })
          .catch(() => undefined);
      }
      if (immediate) commit(immediate.measure, immediate.source);
    },
    [anchors, initialKeyset, pageTextItems, xmlMaxMeasure],
  );

  const placeFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const surface = event.currentTarget;
      const rect = surface.getBoundingClientRect();
      if (rect.height <= 0) return;
      // Normalize against the scrollable CONTENT height, not the viewport, so a
      // click lands on the right measure even when the page is scrolled.
      const contentHeight = surface.scrollHeight || rect.height;
      const yPct = clamp01(
        (event.clientY - rect.top + surface.scrollTop) / contentHeight,
      );
      setPendingY(yPct);
      setError(null);
      applyPrefill(page, yPct);
    },
    [applyPrefill, page],
  );

  const addAnchor = useCallback(() => {
    if (pendingY === null) {
      setError(
        "Click the start of a system on the page, or set its line position, first.",
      );
      return;
    }
    const measure = Number(measureDraft);
    if (!Number.isInteger(measure) || measure < 1) {
      setError(
        "Type the printed measure number at that system start (a whole number ≥ 1).",
      );
      return;
    }
    const xml = validateAgainstXml(
      { mStart: measure, mEnd: measure },
      xmlMaxMeasure ?? 0,
      hasPickup,
    );
    setAnchors((current) => [
      ...current,
      { page, yPct: clamp01(pendingY), measure },
    ]);
    setPendingY(null);
    setMeasureDraft("");
    setPrefillSource(null);
    setError(xml.ok ? null : (xml.warning ?? null));
  }, [hasPickup, measureDraft, page, pendingY, xmlMaxMeasure]);

  const removeAnchor = useCallback((target: LineAnchor) => {
    setAnchors((current) =>
      current.filter(
        (anchor) =>
          !(
            anchor.page === target.page &&
            anchor.yPct === target.yPct &&
            anchor.measure === target.measure
          ),
      ),
    );
  }, []);

  const save = useCallback(async () => {
    if (anchors.length === 0) {
      setError(
        "Add at least one line anchor before saving. Any number of pages may stay unmapped.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const view = await api.save({
        pieceId,
        edition,
        anchors,
        userVerified: true,
      });
      setSavedNotice(
        `Mapping saved · ${anchors.length} line anchor${anchors.length === 1 ? "" : "s"}. Drawn boxes now resolve to measures.`,
      );
      onSaved?.(view, anchors);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }, [anchors, api, edition, onSaved, pieceId]);

  const previewRange =
    pendingY !== null && Number(measureDraft) >= 1
      ? null
      : pageAnchors.length >= 2
        ? resolveMeasureRange(
            {
              page,
              xPct: 0,
              yPct: pageAnchors[0].yPct,
              wPct: 1,
              hPct:
                pageAnchors[pageAnchors.length - 1].yPct - pageAnchors[0].yPct,
            },
            anchors,
          )
        : null;

  return (
    <Dialog open onClose={onClose} label="Map this score">
      <section className="map-wizard" aria-labelledby={headingId}>
        <header className="map-wizard-head">
          <div>
            <span className="map-wizard-kicker">Map this score</span>
            <h2 id={headingId}>Mark where each system starts.</h2>
            <p>
              Click the first note of a system, then type its printed measure
              number. Repeat down the page and across pages. You can skip pages
              and stop any time — a partial map still works.
            </p>
          </div>
          <span className="map-wizard-progress" aria-live="polite">
            Page <strong>{page}</strong> of {totalPages} · {anchors.length}{" "}
            anchor
            {anchors.length === 1 ? "" : "s"}
          </span>
        </header>

        <div className="map-wizard-body">
          <div
            className="map-wizard-page"
            data-testid="map-wizard-page-surface"
            ref={pageScrollRef}
            onScroll={() =>
              mirrorScroll(pageScrollRef.current, stripScrollRef.current)
            }
            onPointerDown={placeFromPointer}
            role="presentation"
          >
            <div className="map-wizard-page-canvas">
              {renderPage ? (
                renderPage(page)
              ) : (
                <div className="map-wizard-page-placeholder" aria-hidden="true">
                  Page {page}
                </div>
              )}
              {selection &&
                pageSystems
                  .filter((system) => system.index === selection.systemIndex)
                  .map((system) => (
                    <div
                      key={`band-${system.index}`}
                      className="map-wizard-system-band"
                      style={{
                        top: `${system.yTop * 100}%`,
                        height: `${Math.max(0, system.yBottom - system.yTop) * 100}%`,
                      }}
                      aria-hidden="true"
                    />
                  ))}
              {pendingY !== null && (
                <div
                  className="map-wizard-pending-line"
                  style={{ top: `${pendingY * 100}%` }}
                  aria-hidden="true"
                />
              )}
              {pageSystems.map((system) => (
                <div
                  key={`${system.yTop}-${system.mStart}`}
                  className="map-wizard-anchor-line"
                  style={{ top: `${system.yTop * 100}%` }}
                >
                  <button
                    type="button"
                    className={
                      selection?.systemIndex === system.index
                        ? "map-wizard-system-tag map-wizard-system-tag-selected"
                        : "map-wizard-system-tag"
                    }
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => selectSystem(system.index)}
                    aria-label={`Highlight measures of the system starting at m.${system.mStart}`}
                  >
                    m.{system.mStart}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div
            className="map-wizard-strip"
            ref={stripScrollRef}
            onScroll={() =>
              mirrorScroll(stripScrollRef.current, pageScrollRef.current)
            }
            aria-label="Measure strip"
          >
            <div className="map-wizard-strip-head">Measures</div>
            {strip.warnings.length > 0 && (
              <ul
                className="map-wizard-strip-warnings"
                aria-label="Mapping warnings"
              >
                {strip.warnings.map((warning) => (
                  <li
                    key={`${warning.kind}-${warning.page}-${warning.measure}`}
                  >
                    {warning.message}
                  </li>
                ))}
              </ul>
            )}
            {strip.measures.length === 0 ? (
              <p className="map-wizard-strip-empty">
                Mark a system to build the strip.
              </p>
            ) : (
              <ul className="map-wizard-strip-list">
                {strip.measures.map((row) => {
                  const inSystem =
                    selectedRange != null &&
                    row.measure >= selectedRange.mStart &&
                    row.measure <= selectedRange.mEnd;
                  const isSelected = selection?.measure === row.measure;
                  return (
                    <li
                      key={row.measure}
                      ref={(element) => {
                        if (element)
                          stripRowRefs.current.set(row.measure, element);
                        else stripRowRefs.current.delete(row.measure);
                      }}
                      className={[
                        "map-wizard-strip-row",
                        row.anchored ? "is-anchored" : "is-interpolated",
                        inSystem ? "in-system" : "",
                        isSelected ? "is-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={
                        row.anchored
                          ? undefined
                          : { opacity: 0.45 + row.weight * 0.55 }
                      }
                    >
                      <button
                        type="button"
                        className="map-wizard-strip-button"
                        onClick={() => selectMeasure(row.measure)}
                        aria-label={`Measure ${row.measure}${row.anchored ? ", anchored" : ""}`}
                        aria-pressed={isSelected}
                      >
                        <span className="map-wizard-strip-num">
                          {row.anchored ? "●" : "·"} m.{row.measure}
                        </span>
                        {row.landmark && (
                          <span className="map-wizard-strip-landmark">
                            {row.landmark.label}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="map-wizard-controls">
          <div className="map-wizard-field-row">
            <label>
              <span>Line position (% from top)</span>
              <input
                aria-label="Line position percent from top"
                type="number"
                min="0"
                max="100"
                value={
                  pendingY === null ? "" : Math.round(pendingY * 1000) / 10
                }
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "") {
                    setPendingY(null);
                    setPrefillSource(null);
                    return;
                  }
                  const yPct = clamp01(Number(value) / 100);
                  setPendingY(yPct);
                  applyPrefill(page, yPct);
                }}
              />
            </label>
            <label>
              <span>
                Measure at this system
                {prefillSource && (
                  <em
                    className="map-wizard-prefill-tag"
                    data-source={prefillSource}
                  >
                    {prefillSource === "anchors"
                      ? "from anchors"
                      : prefillSource === "score"
                        ? "from score"
                        : "estimated"}
                  </em>
                )}
              </span>
              <input
                aria-label="Measure number at this system start"
                type="number"
                min="1"
                value={measureDraft}
                onChange={(event) => {
                  setMeasureDraft(event.target.value);
                  // Typing corrects a suggestion, so the provenance tag drops.
                  setPrefillSource(null);
                }}
              />
            </label>
            <Button variant="primary" onClick={addAnchor} disabled={saving}>
              Add line
            </Button>
          </div>

          {pageAnchors.length > 0 && (
            <ul
              className="map-wizard-anchor-list"
              aria-label={`Anchors on page ${page}`}
            >
              {pageAnchors.map((anchor) => (
                <li key={`${anchor.yPct}-${anchor.measure}`}>
                  <span>
                    m.{anchor.measure} · {Math.round(anchor.yPct * 100)}% down
                  </span>
                  <Button
                    variant="text"
                    onClick={() => removeAnchor(anchor)}
                    aria-label={`Remove anchor m.${anchor.measure}`}
                    disabled={saving}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {previewRange && previewRange.confidence > 0 && (
            <p className="map-wizard-preview">
              This page currently spans about m.{previewRange.mStart}–
              {previewRange.mEnd}.
            </p>
          )}

          {error && (
            <p className="map-wizard-error" role="alert">
              {error}
            </p>
          )}
          {savedNotice && (
            <p className="map-wizard-saved" role="status">
              {savedNotice}
            </p>
          )}
        </div>

        <footer className="map-wizard-actions">
          <div className="map-wizard-page-nav" aria-label="Page navigation">
            <Button
              variant="text"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1 || saving}
            >
              ‹ Previous page
            </Button>
            <Button
              variant="text"
              onClick={() =>
                setPage((value) => Math.min(totalPages, value + 1))
              }
              disabled={page >= totalPages || saving}
            >
              Skip / next page ›
            </Button>
          </div>
          <div className="map-wizard-commit">
            <Button variant="text" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={saving || anchors.length === 0}
            >
              {saving ? "Saving map…" : "Save mapping"}
            </Button>
          </div>
        </footer>
      </section>
    </Dialog>
  );
}
