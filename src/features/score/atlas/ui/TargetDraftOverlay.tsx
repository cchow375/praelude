import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { PdfAnchorRect } from "../../types";
import type {
  EditionIdentity,
  PersistentPdfSelectionAnchor,
} from "../model";
import {
  dragToPersistentSelection,
  normalizePageLocalDrag,
  type AnchorError,
  type DragError,
  type PageLocalPointer,
} from "../selection";

export interface PageGeometrySnapshot {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export type PageGeometryResolver = (
  event: PointerEvent<HTMLDivElement>,
  element: HTMLDivElement,
) => PageGeometrySnapshot;

export interface TargetDraftOverlayProps {
  pageNumber: number;
  edition: EditionIdentity;
  selectedAnchor: PersistentPdfSelectionAnchor | null;
  instructionsId: string;
  geometryForEvent?: PageGeometryResolver;
  disabled?: boolean;
  onSelection: (anchor: PersistentPdfSelectionAnchor) => void;
  onSelectionError: (code: DragError | AnchorError, message: string) => void;
}

interface ActiveDrag {
  pointerId: number;
  start: PageLocalPointer;
}

function defaultGeometry(
  pageNumber: number,
  element: HTMLDivElement,
): PageGeometrySnapshot {
  const bounds = element.getBoundingClientRect();
  return {
    page: pageNumber,
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
}

function localPointer(
  event: PointerEvent<HTMLDivElement>,
  geometry: PageGeometrySnapshot,
): PageLocalPointer {
  return {
    page: geometry.page,
    x: event.clientX - geometry.left,
    y: event.clientY - geometry.top,
    page_width: geometry.width,
    page_height: geometry.height,
  };
}

function rectStyle(rect: PdfAnchorRect): CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}

/** Pointer-only score layer; TargetDraftEditor supplies the equivalent keyboard path. */
export function TargetDraftOverlay({
  pageNumber,
  edition,
  selectedAnchor,
  instructionsId,
  geometryForEvent,
  disabled = false,
  onSelection,
  onSelectionError,
}: TargetDraftOverlayProps) {
  const drag = useRef<ActiveDrag | null>(null);
  const [preview, setPreview] = useState<PdfAnchorRect | null>(null);

  const geometry = (
    event: PointerEvent<HTMLDivElement>,
  ): PageGeometrySnapshot => (
    geometryForEvent?.(event, event.currentTarget) ??
    defaultGeometry(pageNumber, event.currentTarget)
  );

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const end = localPointer(event, geometry(event));
    const result = dragToPersistentSelection(active.start, end, edition);
    drag.current = null;
    setPreview(null);
    if (result.ok) onSelection(result.value);
    else onSelectionError(result.code, result.message);
  };

  const visibleSelection =
    selectedAnchor?.edition_id === edition.edition_id &&
    selectedAnchor.edition_fingerprint === edition.edition_fingerprint
    ? selectedAnchor.rects.find((rect) => rect.page === pageNumber) ?? null
    : null;

  return (
    <div
      className="atlas-target-overlay"
      data-testid={`atlas-target-overlay-${pageNumber}`}
      role="region"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={`Draw a practice target on PDF page ${pageNumber}`}
      aria-describedby={instructionsId}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          start: localPointer(event, geometry(event)),
        };
        setPreview(null);
      }}
      onPointerMove={(event) => {
        if (disabled) return;
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const result = normalizePageLocalDrag(
          active.start,
          localPointer(event, geometry(event)),
        );
        setPreview(result.ok ? result.value : null);
      }}
      onPointerUp={(event) => {
        if (!disabled) finish(event);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }}
    >
      {visibleSelection && (
        <span
          className="atlas-target-mark is-committed"
          style={rectStyle(visibleSelection)}
          data-testid="atlas-target-selection"
          aria-hidden="true"
        />
      )}
      {preview && (
        <span
          className="atlas-target-mark is-preview"
          style={rectStyle(preview)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
