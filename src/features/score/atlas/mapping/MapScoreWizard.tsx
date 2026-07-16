import {
  useCallback,
  useId,
  useMemo,
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
  api?: CalibrationApi;
  /** MusicXML measure count, when known, to flag anchors beyond the score. */
  xmlMaxMeasure?: number | null;
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
  api = defaultCalibrationApi,
  xmlMaxMeasure = null,
  hasPickup = false,
  onSaved,
  onClose,
}: MapScoreWizardProps) {
  const headingId = useId();
  const [page, setPage] = useState(1);
  const [anchors, setAnchors] = useState<LineAnchor[]>(initialAnchors);
  const [pendingY, setPendingY] = useState<number | null>(null);
  const [measureDraft, setMeasureDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const totalPages = Math.max(1, pageCount);
  const pageAnchors = useMemo(
    () =>
      anchors
        .filter((anchor) => anchor.page === page)
        .sort((a, b) => a.yPct - b.yPct),
    [anchors, page],
  );

  const placeFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.height <= 0) return;
      setPendingY(clamp01((event.clientY - rect.top) / rect.height));
      setError(null);
    },
    [],
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
            onPointerDown={placeFromPointer}
            role="presentation"
          >
            {renderPage ? (
              renderPage(page)
            ) : (
              <div className="map-wizard-page-placeholder" aria-hidden="true">
                Page {page}
              </div>
            )}
            {pendingY !== null && (
              <div
                className="map-wizard-pending-line"
                style={{ top: `${pendingY * 100}%` }}
                aria-hidden="true"
              />
            )}
            {pageAnchors.map((anchor) => (
              <div
                key={`${anchor.yPct}-${anchor.measure}`}
                className="map-wizard-anchor-line"
                style={{ top: `${anchor.yPct * 100}%` }}
                aria-hidden="true"
              >
                <span>m.{anchor.measure}</span>
              </div>
            ))}
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
                    setPendingY(
                      value === "" ? null : clamp01(Number(value) / 100),
                    );
                  }}
                />
              </label>
              <label>
                <span>Measure at this system</span>
                <input
                  aria-label="Measure number at this system start"
                  type="number"
                  min="1"
                  value={measureDraft}
                  onChange={(event) => setMeasureDraft(event.target.value)}
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
