import { memo, useRef, useState } from "react";
import { anchorKind, normalizeDrag } from "./anchors";
import type { PdfAnchorKind, PdfAnchorRect } from "./types";
import type {
  EditionIdentity,
  PersistentPdfSelectionAnchor,
} from "./atlas/model";
import {
  dragToPersistentSelection,
  normalizePageLocalDrag,
  type AnchorError,
  type DragError,
  type PageLocalPointer,
} from "./atlas/selection";

export interface RegionOverlayItem {
  regionId: number;
  label: string;
  color: string | null;
  rects: PdfAnchorRect[];
  selected: boolean;
  active: boolean;
  /** Task C3: a sub-section ("spot") rather than a full tricky section. Drawn
   * dashed and faint so it can never be mistaken for its parent. */
  isChild: boolean;
  /** Task C4: present on children only — opens this spot's practice composer
   * from a chip on the box itself. */
  onPractice?: () => void;
}

export interface RegionMappingDraft {
  regionId: number;
  label: string;
  color: string | null;
  draftRects: PdfAnchorRect[];
  tool: PdfAnchorKind;
  onAddRect: (rect: PdfAnchorRect) => void;
  onUpdateRect: (index: number, rect: PdfAnchorRect) => void;
}

/** Task C5: drag-to-create a tricky section (or a child section, inside a
 * selected parent's page area). Independent of `mapping` — active only when
 * `mapping` is not, so an existing region's annotation drag always wins. */
export interface RegionCreateDrag {
  onResolve: (rect: PdfAnchorRect) => void;
}

/** The atlas draft now shares the same page layer as persisted Regions. */
export interface ScoreTargetDraft {
  edition: EditionIdentity;
  selectedAnchor: PersistentPdfSelectionAnchor | null;
  instructionsId: string;
  disabled?: boolean;
  onSelection: (anchor: PersistentPdfSelectionAnchor) => void;
  onSelectionError: (code: DragError | AnchorError, message: string) => void;
}

export interface RegionOverlayProps {
  pageNumber: number;
  items: RegionOverlayItem[];
  mapping?: RegionMappingDraft | null;
  createDrag?: RegionCreateDrag | null;
  targetDraft?: ScoreTargetDraft | null;
  /** False while another score tool owns the page pointer path (for example
   * pencil or armed spot drawing). Mapping and target drafts also suppress the
   * chip intrinsically, so the unified overlay cannot route one gesture twice. */
  practiceChipsEnabled?: boolean;
  onSelect: (regionId: number) => void;
  /** Render-count seam used only by the memoization regression. */
  onRenderForTest?: () => void;
}

interface Point {
  x: number;
  y: number;
}

interface TargetDrag {
  pointerId: number;
  start: PageLocalPointer;
}

function rectStyle(rect: PdfAnchorRect): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}

interface EditDrag {
  pointerId: number;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  width: number;
  height: number;
  original: PdfAnchorRect;
}

function bounded(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function EditableDraft({
  rect,
  index,
  label,
  color,
  onUpdate,
}: {
  rect: PdfAnchorRect;
  index: number;
  label: string;
  color: string | null;
  onUpdate: (index: number, rect: PdfAnchorRect) => void;
}) {
  const drag = useRef<EditDrag | null>(null);

  const begin = (
    event: React.PointerEvent<HTMLElement>,
    mode: EditDrag["mode"],
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const overlay = event.currentTarget.closest<HTMLElement>(
      ".score-page-overlay",
    );
    const bounds = overlay?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
      height: bounds.height,
      original: rect,
    };
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = (event.clientX - active.startX) / active.width;
    const dy = (event.clientY - active.startY) / active.height;
    const next =
      active.mode === "move"
        ? {
            ...active.original,
            x: bounded(active.original.x + dx, 0, 1 - active.original.w),
            y: bounded(active.original.y + dy, 0, 1 - active.original.h),
          }
        : {
            ...active.original,
            w: bounded(active.original.w + dx, 0.005, 1 - active.original.x),
            h: bounded(active.original.h + dy, 0.005, 1 - active.original.y),
          };
    onUpdate(index, next);
  };

  const finish = (event: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === event.pointerId) {
      event.stopPropagation();
      drag.current = null;
    }
  };

  const keyEdit = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const step = 0.01;
    const horizontal =
      event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const vertical =
      event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    const next = event.shiftKey
      ? {
          ...rect,
          w: bounded(rect.w + horizontal, 0.005, 1 - rect.x),
          h: bounded(rect.h + vertical, 0.005, 1 - rect.y),
        }
      : {
          ...rect,
          x: bounded(rect.x + horizontal, 0, 1 - rect.w),
          y: bounded(rect.y + vertical, 0, 1 - rect.h),
        };
    onUpdate(index, next);
  };

  return (
    <div
      className={`score-region-draft is-editable is-${anchorKind(rect)}`}
      style={
        {
          ...rectStyle(rect),
          "--region-color": color ?? "var(--accent)",
        } as React.CSSProperties
      }
      role="button"
      tabIndex={0}
      aria-label={`${label}, editable ${anchorKind(rect)} on page ${rect.page}. Drag or use arrow keys to move; drag the corner or use Shift plus arrows to resize.`}
      onPointerDown={(event) => begin(event, "move")}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={keyEdit}
    >
      {anchorKind(rect) === "note" && (
        <span className="score-region-note-text">{label}</span>
      )}
      <i
        className="score-region-resize"
        aria-hidden="true"
        onPointerDown={(event) => begin(event, "resize")}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
    </div>
  );
}

function ScoreOverlayImpl({
  pageNumber,
  items,
  mapping,
  createDrag,
  targetDraft,
  practiceChipsEnabled = true,
  onSelect,
  onRenderForTest,
}: RegionOverlayProps) {
  onRenderForTest?.();
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [preview, setPreview] = useState<PdfAnchorRect | null>(null);
  const targetDrag = useRef<TargetDrag | null>(null);
  // `mapping` (editing an existing region's annotations) always wins over
  // `createDrag` (starting a brand-new section) when both are somehow set.
  const activeDrag = mapping
    ? { tool: mapping.tool }
    : createDrag
      ? { tool: "box" as const }
      : null;

  const targetPointer = (
    event: React.PointerEvent<HTMLDivElement>,
  ): PageLocalPointer => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      page: pageNumber,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      page_width: bounds.width,
      page_height: bounds.height,
    };
  };

  const pointIn = (event: React.PointerEvent<HTMLDivElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activeDrag || !dragStart) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const end = pointIn(event);
    const rect = normalizeDrag(
      dragStart.x,
      dragStart.y,
      end.x,
      end.y,
      bounds.width,
      bounds.height,
      pageNumber,
      activeDrag.tool,
    );
    setDragStart(null);
    setPreview(null);
    if (!rect) return;
    if (mapping) mapping.onAddRect(rect);
    else createDrag?.onResolve(rect);
  };

  const finishTarget = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = targetDrag.current;
    if (
      !targetDraft ||
      targetDraft.disabled ||
      !active ||
      active.pointerId !== event.pointerId
    ) {
      return;
    }
    const result = dragToPersistentSelection(
      active.start,
      targetPointer(event),
      targetDraft.edition,
    );
    targetDrag.current = null;
    setPreview(null);
    if (result.ok) targetDraft.onSelection(result.value);
    else targetDraft.onSelectionError(result.code, result.message);
  };

  const selectedTargetAnchor = targetDraft?.selectedAnchor ?? null;
  const visibleTargetSelection =
    targetDraft &&
    selectedTargetAnchor &&
    selectedTargetAnchor.edition_id === targetDraft.edition.edition_id &&
    selectedTargetAnchor.edition_fingerprint ===
      targetDraft.edition.edition_fingerprint
      ? (selectedTargetAnchor.rects.find(
          (rect) => rect.page === pageNumber,
        ) ?? null)
      : null;

  return (
    <div
      className={`score-page-overlay ${mapping ? "is-mapping" : ""} ${createDrag ? "is-create-dragging" : ""} ${targetDraft ? "is-targeting atlas-target-overlay" : ""}`}
      data-testid={
        targetDraft
          ? `atlas-target-overlay-${pageNumber}`
          : `page-overlay-${pageNumber}`
      }
      role={targetDraft ? "region" : undefined}
      tabIndex={targetDraft ? (targetDraft.disabled ? -1 : 0) : undefined}
      aria-disabled={targetDraft?.disabled || undefined}
      aria-label={
        targetDraft
          ? `Draw a practice target on PDF page ${pageNumber}`
          : undefined
      }
      aria-describedby={targetDraft?.instructionsId}
      onPointerDown={(event) => {
        if (targetDraft) {
          if (targetDraft.disabled || event.button !== 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          targetDrag.current = {
            pointerId: event.pointerId,
            start: targetPointer(event),
          };
          setPreview(null);
          return;
        }
        if (!activeDrag || event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const point = pointIn(event);
        setDragStart(point);
        setPreview(null);
      }}
      onPointerMove={(event) => {
        if (targetDraft) {
          const active = targetDrag.current;
          if (
            targetDraft.disabled ||
            !active ||
            active.pointerId !== event.pointerId
          ) {
            return;
          }
          const result = normalizePageLocalDrag(
            active.start,
            targetPointer(event),
          );
          setPreview(result.ok ? result.value : null);
          return;
        }
        if (activeDrag && dragStart) {
          const bounds = event.currentTarget.getBoundingClientRect();
          const end = pointIn(event);
          setPreview(
            normalizeDrag(
              dragStart.x,
              dragStart.y,
              end.x,
              end.y,
              bounds.width,
              bounds.height,
              pageNumber,
              activeDrag.tool,
            ),
          );
        }
      }}
      onPointerUp={(event) => {
        if (targetDraft) finishTarget(event);
        else finish(event);
      }}
      onPointerCancel={() => {
        targetDrag.current = null;
        setDragStart(null);
        setPreview(null);
      }}
    >
      {items.flatMap((item) => {
        if (mapping?.regionId === item.regionId) return [];
        const pageRects = item.rects.filter((rect) => rect.page === pageNumber);
        const nodes = pageRects.map((rect, index) => (
          <button
            type="button"
            key={`${item.regionId}-${index}`}
            className={`score-region-anchor is-${anchorKind(rect)} ${item.selected ? "is-selected" : ""} ${item.active ? "is-active" : ""} ${item.isChild ? "is-child" : ""}`}
            style={
              {
                ...rectStyle(rect),
                "--region-color": item.color ?? "var(--accent)",
              } as React.CSSProperties
            }
            aria-label={`${item.label}, ${anchorKind(rect)} on page ${pageNumber}`}
            onPointerDown={(event) => {
              // Task B1: a click on any OTHER box must still just
              // select it, not start a drag-to-create underneath it —
              // but a drag that starts INSIDE the already-selected
              // parent is exactly the create gesture the hint chip
              // teaches, so it must reach the overlay's own
              // onPointerDown (which arms `createDrag`/`mapping`)
              // instead of being swallowed here.
              if (!item.selected) event.stopPropagation();
            }}
            onClick={() => onSelect(item.regionId)}
          >
            {anchorKind(rect) === "note" && <span>{item.label}</span>}
          </button>
        ));
        // Task C4: a SIBLING of the anchor, never a child of it — a button
        // inside a button is invalid HTML and browsers un-nest it, which
        // would leave the chip somewhere other than where it was drawn.
        const first = pageRects[0];
        if (
          practiceChipsEnabled &&
          !mapping &&
          !targetDraft &&
          item.selected &&
          item.isChild &&
          item.onPractice &&
          first
        ) {
          nodes.push(
            <button
              type="button"
              key={`${item.regionId}-practice`}
              className="score-region-practice-chip"
              style={{
                left: `${(first.x + first.w) * 100}%`,
                top: `${first.y * 100}%`,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                item.onPractice?.();
              }}
            >
              Practice this
            </button>,
          );
        }
        return nodes;
      })}
      {mapping?.draftRects
        .map((rect, index) => ({ rect, index }))
        .filter(({ rect }) => rect.page === pageNumber)
        .map(({ rect, index }) => (
          <EditableDraft
            key={`draft-${index}`}
            rect={rect}
            index={index}
            label={mapping.label}
            color={mapping.color}
            onUpdate={mapping.onUpdateRect}
          />
        ))}
      {visibleTargetSelection && (
        <span
          className="score-region-draft is-target-selection"
          style={rectStyle(visibleTargetSelection)}
          data-testid="atlas-target-selection"
          aria-hidden="true"
        />
      )}
      {preview && (
        <span
          className={`score-region-draft is-live ${targetDraft ? "is-target-preview" : ""} is-${anchorKind(preview)}`}
          style={rectStyle(preview)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** One memoized page overlay for persisted parents/spots and every draft mode. */
export const ScoreOverlay = memo(ScoreOverlayImpl);
ScoreOverlay.displayName = "ScoreOverlay";

/** Compatibility export for focused overlay tests and downstream modules. */
export const RegionOverlay = ScoreOverlay;
