import { useCallback, useEffect, useRef, useState } from "react";
import {
  finishStroke,
  isNewSample,
  PENCIL_WIDTH,
  strokePath,
  strokePixelWidth,
  toPagePoint,
  type PageBox,
  type Stroke,
  type StrokePoint,
} from "./strokes";

export interface PencilOverlayProps {
  pageNumber: number;
  /** Strokes already committed for this page, in draw order. */
  strokes: Stroke[];
  /** Pencil mode is on AND this page may be drawn on. */
  active: boolean;
  /** Called once per completed stroke, with normalized page geometry. */
  onStroke: (stroke: Stroke) => void;
}

/** The measured pixel box of the page, or null before the first measurement. */
function useMeasuredBox(element: HTMLDivElement | null): PageBox | null {
  const [box, setBox] = useState<PageBox | null>(null);
  useEffect(() => {
    if (!element) {
      setBox(null);
      return;
    }
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setBox((current) =>
        current &&
        Math.abs(current.width - bounds.width) < 0.5 &&
        Math.abs(current.height - bounds.height) < 0.5
          ? current
          : { width: bounds.width, height: bounds.height },
      );
    };
    measure();
    // Zoom, fit-mode changes and window resizes all reach this overlay as a box
    // resize, which is the ONLY thing the rendered geometry depends on — the
    // stored points never change. jsdom has no ResizeObserver; the single
    // measurement above is enough there.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return box;
}

/** Live-stroke state, kept entirely in refs so pointer moves never re-render. */
interface LiveStroke {
  pointerId: number;
  bounds: { left: number; top: number; width: number; height: number };
  points: StrokePoint[];
}

/**
 * The freehand pencil layer for one score page.
 *
 * Two layers, on purpose. Committed strokes are SVG paths in the page's pixel
 * space: they re-render only when a stroke is added or the page box changes, and
 * they stay crisp at any zoom because the vector is re-laid-out, not scaled. The
 * stroke being drawn right now goes onto a canvas that is painted imperatively
 * from the pointer handler — no React state, no re-render, no page re-raster per
 * event — and is thrown away the moment the finished stroke joins the SVG.
 */
export function PencilOverlay({
  pageNumber,
  strokes,
  active,
  onStroke,
}: PencilOverlayProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<LiveStroke | null>(null);
  const box = useMeasuredBox(host);
  // Read inside pointer handlers without making them depend on identity churn.
  const onStrokeRef = useRef(onStroke);
  onStrokeRef.current = onStroke;

  // Size the live canvas to the page box in device pixels, so the in-progress
  // line is as sharp as the committed one.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(box.width * ratio));
    const height = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }, [box]);

  const paintLive = useCallback(() => {
    const canvas = canvasRef.current;
    const live = liveRef.current;
    if (!canvas || !live) return;
    const context = canvas.getContext?.("2d");
    if (!context) return;
    const pixels: PageBox = { width: canvas.width, height: canvas.height };
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = strokePixelWidth(PENCIL_WIDTH, pixels);
    context.lineCap = "round";
    context.lineJoin = "round";
    // Graphite comes from the design tokens, never from a literal here: the
    // canvas inherits `color: var(--pencil)` from the stylesheet, which is the
    // same value the committed SVG strokes paint with.
    const inherited = window
      .getComputedStyle?.(canvas)
      .getPropertyValue("color")
      .trim();
    if (inherited) context.strokeStyle = inherited;
    const path = new Path2D(strokePath(live.points, pixels));
    context.stroke(path);
  }, []);

  const clearLive = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext?.("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!active || event.button !== 0 || liveRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = toPagePoint(event.clientX, event.clientY, bounds);
    if (!point) return;
    event.preventDefault();
    // Capture keeps the stroke coming to this layer when the pencil crosses the
    // page edge. It is an optimisation, not a precondition: a refusal (some
    // pointer types, and synthetic events) must not silently swallow the stroke.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Draw without capture.
    }
    liveRef.current = { pointerId: event.pointerId, bounds, points: [point] };
    paintLive();
  };

  const extend = (event: React.PointerEvent<HTMLDivElement>) => {
    const live = liveRef.current;
    if (!live || live.pointerId !== event.pointerId) return;
    event.preventDefault();
    // Coalesced events recover the samples the browser batched into one frame:
    // without them a fast arc across the page arrives as a handful of points and
    // draws as a polygon. This is the difference between "no dropped points" and
    // a stroke that visibly corners.
    const native = event.nativeEvent as PointerEvent & {
      getCoalescedEvents?: () => PointerEvent[];
    };
    const samples =
      typeof native.getCoalescedEvents === "function"
        ? (native.getCoalescedEvents() ?? [native])
        : [native];
    let added = false;
    for (const sample of samples.length > 0 ? samples : [native]) {
      const point = toPagePoint(sample.clientX, sample.clientY, live.bounds);
      if (!point) continue;
      const previous = live.points[live.points.length - 1];
      if (previous && !isNewSample(previous, point)) continue;
      live.points.push(point);
      added = true;
    }
    if (added) paintLive();
  };

  const end = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const live = liveRef.current;
    if (!live || live.pointerId !== event.pointerId) return;
    liveRef.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Nothing was captured; nothing to release.
    }
    clearLive();
    if (!commit) return;
    // The release position is part of the stroke: a flick that ends between two
    // move events would otherwise stop short of where the pencil was lifted.
    const last = toPagePoint(event.clientX, event.clientY, live.bounds);
    if (last) live.points.push(last);
    const stroke = finishStroke(live.points, pageNumber);
    if (stroke) onStrokeRef.current(stroke);
  };

  const pageStrokes = strokes.filter((stroke) => stroke.page === pageNumber);

  return (
    <div
      ref={setHost}
      className={`score-pencil-layer ${active ? "is-drawing" : ""}`}
      data-testid={`pencil-layer-${pageNumber}`}
      data-active={active ? "true" : "false"}
      onPointerDown={begin}
      onPointerMove={extend}
      onPointerUp={(event) => end(event, true)}
      onPointerCancel={(event) => end(event, false)}
    >
      {box && pageStrokes.length > 0 && (
        <svg
          className="score-pencil-ink"
          width={box.width}
          height={box.height}
          viewBox={`0 0 ${box.width} ${box.height}`}
          aria-hidden="true"
          focusable="false"
        >
          {pageStrokes.map((stroke, index) => (
            <path
              key={stroke.id ?? `pending-${index}`}
              data-testid={
                stroke.id === null ? "pencil-stroke-pending" : "pencil-stroke"
              }
              d={strokePath(stroke.points, box)}
              fill="none"
              strokeWidth={strokePixelWidth(stroke.width, box)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      )}
      <canvas
        ref={canvasRef}
        className="score-pencil-live"
        aria-hidden="true"
      />
    </div>
  );
}
