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

import { useRef } from "react";
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
   * control for that bar. Suppressed while a drag is in progress (a click
   * that ends a drag never ALSO renumbers). */
  onBarClick?: (
    systemIndex: number,
    barIndex: number,
    currentNumber: number,
  ) => void;
  /** Present only in the review flow: horizontal barline drag, fired
   * continuously as the pointer moves with the bar's new normalized
   * `x_right`. The caller (via `dragBarline`) owns clamping to neighbors. */
  onBarDrag?: (
    systemIndex: number,
    barIndex: number,
    newXRight: number,
  ) => void;
  /** True once the map is applied: bar marks stop being interactive (no
   * click-to-renumber, no drag) and show a "re-scan to edit" hint instead. */
  readOnly?: boolean;
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
    // Informational (it never blocks Apply), but it still names exactly one
    // system whose bars were resynthesized — the human reviewing the page
    // needs to SEE which system that was.
    case "derived_bar_count":
      return conflict.page === pageNumber && conflict.system === systemNumber;
    case "overlapping_systems":
      return (
        conflict.page === pageNumber &&
        (conflict.system_a === systemNumber ||
          conflict.system_b === systemNumber)
      );
    case "unapplyable":
      // `system: 0` is the Rust sentinel for "no single system to blame" —
      // band every system on that page instead of none of them.
      return (
        conflict.page === pageNumber &&
        (conflict.system === 0 || conflict.system === systemNumber)
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

/** A drag in progress, kept in a ref so pointer moves never re-render. */
interface DragState {
  pointerId: number;
  systemIndex: number;
  barIndex: number;
  startClientX: number;
  startXRight: number;
  containerWidth: number;
  dragged: boolean;
}

const CLICK_VS_DRAG_THRESHOLD_PX = 3;

export function MeasureOverlay({
  page,
  pageNumber,
  conflicts,
  visible,
  stale,
  onRescan,
  onBarClick,
  onBarDrag,
  readOnly = false,
}: MeasureOverlayProps) {
  const dragRef = useRef<DragState | null>(null);
  // A completed drag (mouse/touch) still fires a native `click` right after
  // its `pointerup` — this remembers "the pointer sequence that just ended
  // crossed the drag threshold" so the `onClick` handler below can swallow
  // that one synthetic click instead of also renumbering. Cleared by the
  // very next click, so a genuine keyboard activation (which has no
  // preceding pointer events at all) is never affected.
  const justDraggedRef = useRef(false);
  const interactive = !readOnly && Boolean(onBarClick || onBarDrag);

  const beginDrag = (
    event: React.PointerEvent<HTMLElement>,
    systemIndex: number,
    barIndex: number,
    currentXRight: number,
  ) => {
    if (readOnly || event.button !== 0) return;
    if (!onBarClick && !onBarDrag) return;
    // Width is only needed to compute a drag delta; a click-only overlay (no
    // `onBarDrag`) still tracks pointer-down/up for click detection without
    // it, so a jsdom test (whose `getBoundingClientRect` is all-zero unless
    // stubbed) can exercise onBarClick without also stubbing the measurement.
    const container = event.currentTarget.closest<HTMLElement>(
      ".measure-map-overlay",
    );
    const width = container?.getBoundingClientRect().width;
    if (onBarDrag && !width) return;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Draw without capture.
    }
    dragRef.current = {
      pointerId: event.pointerId,
      systemIndex,
      barIndex,
      startClientX: event.clientX,
      startXRight: currentXRight,
      containerWidth: width ?? 0,
      dragged: false,
    };
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !onBarDrag) return;
    const dx = event.clientX - drag.startClientX;
    if (Math.abs(dx) > CLICK_VS_DRAG_THRESHOLD_PX) drag.dragged = true;
    if (!drag.dragged) return;
    const newXRight = drag.startXRight + dx / drag.containerWidth;
    onBarDrag(drag.systemIndex, drag.barIndex, newXRight);
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Nothing was captured; nothing to release.
    }
    // The native `click` that follows this `pointerup` (mouse/touch — not
    // keyboard) is where the actual renumber fires; a real drag suppresses
    // it there instead of firing here, so a real `<button>` still gets
    // ordinary keyboard (Enter/Space) activation for free.
    justDraggedRef.current = drag.dragged;
  };

  const handleClick = (
    systemIndex: number,
    barIndex: number,
    currentNumber: number,
  ) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    onBarClick?.(systemIndex, barIndex, currentNumber);
  };

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
          aria-hidden={!interactive}
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
                  const Tag = interactive ? "button" : "span";
                  return (
                    <Tag
                      key={barIndex}
                      type={interactive ? "button" : undefined}
                      className={`measure-map-number is-${bar.source} ${flagged ? "is-conflict" : ""} ${readOnly ? "is-read-only" : ""}`}
                      data-testid="measure-map-number"
                      title={
                        readOnly ? "Map applied — re-scan to edit" : undefined
                      }
                      style={{
                        left: `${bar.x_right * 100}%`,
                        top: `${system.y_bottom * 100}%`,
                        touchAction: interactive ? "none" : undefined,
                      }}
                      onPointerDown={
                        interactive
                          ? (event) =>
                              beginDrag(
                                event,
                                systemIndex,
                                barIndex,
                                bar.x_right,
                              )
                          : undefined
                      }
                      onPointerMove={interactive ? moveDrag : undefined}
                      onPointerUp={interactive ? endDrag : undefined}
                      onClick={
                        interactive
                          ? () => handleClick(systemIndex, barIndex, bar.number)
                          : undefined
                      }
                      onPointerCancel={
                        interactive
                          ? (event) => {
                              dragRef.current = null;
                              try {
                                event.currentTarget.releasePointerCapture?.(
                                  event.pointerId,
                                );
                              } catch {
                                // Nothing captured.
                              }
                            }
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
