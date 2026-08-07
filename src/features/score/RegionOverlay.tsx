import { useRef, useState } from "react";
import { anchorKind, normalizeDrag } from "./anchors";
import type { PdfAnchorKind, PdfAnchorRect } from "./types";

export interface RegionOverlayItem {
  regionId: number;
  label: string;
  color: string | null;
  rects: PdfAnchorRect[];
  selected: boolean;
  active: boolean;
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

interface RegionOverlayProps {
  pageNumber: number;
  items: RegionOverlayItem[];
  mapping?: RegionMappingDraft | null;
  createDrag?: RegionCreateDrag | null;
  onSelect: (regionId: number) => void;
}

interface Point {
  x: number;
  y: number;
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

export function RegionOverlay({
  pageNumber,
  items,
  mapping,
  createDrag,
  onSelect,
}: RegionOverlayProps) {
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [preview, setPreview] = useState<PdfAnchorRect | null>(null);
  // `mapping` (editing an existing region's annotations) always wins over
  // `createDrag` (starting a brand-new section) when both are somehow set.
  const activeDrag = mapping
    ? { tool: mapping.tool }
    : createDrag
      ? { tool: "box" as const }
      : null;

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

  return (
    <div
      className={`score-page-overlay ${mapping ? "is-mapping" : ""} ${createDrag ? "is-create-dragging" : ""}`}
      data-testid={`page-overlay-${pageNumber}`}
      onPointerDown={(event) => {
        if (!activeDrag || event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const point = pointIn(event);
        setDragStart(point);
        setPreview(null);
      }}
      onPointerMove={(event) => {
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
      onPointerUp={finish}
      onPointerCancel={() => {
        setDragStart(null);
        setPreview(null);
      }}
    >
      {items.flatMap((item) =>
        mapping?.regionId === item.regionId
          ? []
          : item.rects
              .filter((rect) => rect.page === pageNumber)
              .map((rect, index) => (
                <button
                  type="button"
                  key={`${item.regionId}-${index}`}
                  className={`score-region-anchor is-${anchorKind(rect)} ${item.selected ? "is-selected" : ""} ${item.active ? "is-active" : ""}`}
                  style={
                    {
                      ...rectStyle(rect),
                      "--region-color": item.color ?? "var(--accent)",
                    } as React.CSSProperties
                  }
                  aria-label={`${item.label}, ${anchorKind(rect)} on page ${pageNumber}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onSelect(item.regionId)}
                >
                  {anchorKind(rect) === "note" && <span>{item.label}</span>}
                </button>
              )),
      )}
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
      {preview && (
        <span
          className={`score-region-draft is-live is-${anchorKind(preview)}`}
          style={rectStyle(preview)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
