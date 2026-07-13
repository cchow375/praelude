import { useState } from "react";
import { normalizeDrag } from "./anchors";
import type { PdfAnchorRect } from "./types";

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
  onAddRect: (rect: PdfAnchorRect) => void;
}

interface RegionOverlayProps {
  pageNumber: number;
  items: RegionOverlayItem[];
  mapping?: RegionMappingDraft | null;
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

export function RegionOverlay({ pageNumber, items, mapping, onSelect }: RegionOverlayProps) {
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [preview, setPreview] = useState<PdfAnchorRect | null>(null);

  const pointIn = (event: React.PointerEvent<HTMLDivElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!mapping || !dragStart) return;
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
    );
    setDragStart(null);
    setPreview(null);
    if (rect) mapping.onAddRect(rect);
  };

  return (
    <div
      className={`score-page-overlay ${mapping ? "is-mapping" : ""}`}
      data-testid={`page-overlay-${pageNumber}`}
      onPointerDown={(event) => {
        if (!mapping || event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const point = pointIn(event);
        setDragStart(point);
        setPreview(null);
      }}
      onPointerMove={(event) => {
        if (mapping && dragStart) {
          const bounds = event.currentTarget.getBoundingClientRect();
          const end = pointIn(event);
          setPreview(normalizeDrag(
            dragStart.x,
            dragStart.y,
            end.x,
            end.y,
            bounds.width,
            bounds.height,
            pageNumber,
          ));
        }
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        setDragStart(null);
        setPreview(null);
      }}
    >
      {items.flatMap((item) =>
        item.rects
          .filter((rect) => rect.page === pageNumber)
          .map((rect, index) => (
            <button
              type="button"
              key={`${item.regionId}-${index}`}
              className={`score-region-anchor ${item.selected ? "is-selected" : ""} ${item.active ? "is-active" : ""}`}
              style={{ ...rectStyle(rect), "--region-color": item.color ?? "var(--accent)" } as React.CSSProperties}
              aria-label={`${item.label}, measures mapped on page ${pageNumber}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onSelect(item.regionId)}
            />
          )),
      )}
      {mapping?.draftRects
        .filter((rect) => rect.page === pageNumber)
        .map((rect, index) => (
          <span
            key={`draft-${index}`}
            className="score-region-draft"
            style={{ ...rectStyle(rect), "--region-color": mapping.color ?? "var(--accent)" } as React.CSSProperties}
            aria-hidden="true"
          />
        ))}
      {preview && (
        <span className="score-region-draft is-live" style={rectStyle(preview)} aria-hidden="true" />
      )}
    </div>
  );
}
