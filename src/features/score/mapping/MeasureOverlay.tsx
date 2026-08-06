// The on-page measure-map overlay (Plan C, task C4): tiny grey numbers at
// each bar's x_right / the system's y_bottom baseline, amber-highlighted for
// any bar whose page/system is named by a conflict, plus the always-visible
// (never mode-gated — Flaws B48) stale notice when the map's fingerprint no
// longer matches the edition it is rendered over.
//
// Percentage-based absolute positioning — the SAME convention `RegionOverlay`
// already uses for its rects in this codebase — rather than an SVG viewBox:
// the host is always sized exactly to the rendered page box (`PdfPage`'s own
// `.score-page-overlay` container), so a plain `%` position needs no pixel
// measurement of its own and stays correct through every zoom/resize without
// a ResizeObserver.

import type { MapConflict, MeasureMapPage } from "./measureMap";

export interface MeasureOverlayProps {
  /** This page's reconciled/applied map, or `null` when this page has none. */
  page: MeasureMapPage | null;
  pageNumber: number;
  /** Conflicts from the current review (or none, once applied cleanly). */
  conflicts: MapConflict[];
  /** The toggle state — collapses to nothing (not just hidden) when off. */
  visible: boolean;
  /** True when the rendered `page` was fetched under a DIFFERENT edition
   * fingerprint than the one currently on screen. Always shown regardless of
   * `visible` — a stale map is a correctness notice, not a display toggle. */
  stale: boolean;
  onRescan?: () => void;
  /** Present only in the review flow: clicking a number opens the renumber
   * control for that bar. */
  onBarClick?: (
    systemIndex: number,
    barIndex: number,
    currentNumber: number,
  ) => void;
}

/** True when this conflict names the given page (1-based) and, if it also
 * names a system, that system too — used to band the affected span amber. */
function conflictHitsSystem(
  conflict: MapConflict,
  pageNumber: number,
  systemNumber: number,
): boolean {
  switch (conflict.kind) {
    case "continuity_break":
    case "low_confidence_anchor":
      return conflict.page === pageNumber && conflict.system === systemNumber;
    case "overlapping_systems":
      return (
        conflict.page === pageNumber &&
        (conflict.system_a === systemNumber ||
          conflict.system_b === systemNumber)
      );
    case "pickup_ambiguity":
    case "anchor_disagreement":
      return conflict.page === pageNumber;
    case "total_mismatch":
      return false;
    default:
      return false;
  }
}

export function MeasureOverlay({
  page,
  pageNumber,
  conflicts,
  visible,
  stale,
  onRescan,
  onBarClick,
}: MeasureOverlayProps) {
  return (
    <>
      {stale && (
        <div
          className="measure-map-stale"
          role="status"
          data-testid="measure-map-stale"
        >
          <span>
            Measure map is stale — the score changed since it was scanned.
          </span>
          {onRescan && (
            <button type="button" onClick={onRescan}>
              Re-scan
            </button>
          )}
        </div>
      )}
      {visible && page && (
        <div
          className="measure-map-overlay"
          data-testid={`measure-map-overlay-${pageNumber}`}
          aria-hidden={!onBarClick}
        >
          {page.systems.map((system, systemIndex) => {
            const systemNumber = systemIndex + 1;
            const flagged = conflicts.some((conflict) =>
              conflictHitsSystem(conflict, pageNumber, systemNumber),
            );
            return (
              <div key={systemIndex} className="measure-map-system">
                {flagged && (
                  <span
                    className="measure-map-conflict-band"
                    data-testid={`measure-map-conflict-${pageNumber}-${systemNumber}`}
                    style={{
                      left: `${system.x_left * 100}%`,
                      top: `${system.y_top * 100}%`,
                      width: `${(system.x_right - system.x_left) * 100}%`,
                      height: `${(system.y_bottom - system.y_top) * 100}%`,
                    }}
                  />
                )}
                {system.bars.map((bar, barIndex) => {
                  const Tag = onBarClick ? "button" : "span";
                  return (
                    <Tag
                      key={barIndex}
                      type={onBarClick ? "button" : undefined}
                      className={`measure-map-number is-${bar.source} ${flagged ? "is-conflict" : ""}`}
                      data-testid="measure-map-number"
                      style={{
                        left: `${bar.x_right * 100}%`,
                        top: `${system.y_bottom * 100}%`,
                      }}
                      onClick={
                        onBarClick
                          ? () => onBarClick(systemIndex, barIndex, bar.number)
                          : undefined
                      }
                    >
                      {bar.number}
                    </Tag>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
