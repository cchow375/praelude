/**
 * Pencil-stroke geometry, in normalized page coordinates.
 *
 * Every stored point is a fraction of the page box (0–1, top-left origin), never
 * a screen pixel. That is the whole anchoring property: the page box is laid out
 * by `PdfPage` at the live zoom and both render paths (the Rust page-image fast
 * path and the PDF.js canvas) fill exactly the same box, so a fraction of that
 * box is a fixed spot on the engraving under any zoom, pan, resize, fit mode, or
 * render path. Nothing in this module is allowed to know about pixels except at
 * the two explicit conversion seams below.
 */

/** One point of a stroke, as a fraction of the page box. */
export interface StrokePoint {
  x: number;
  y: number;
}

/** One freehand stroke. `id` is null while it has not been persisted yet. */
export interface Stroke {
  id: number | null;
  page: number;
  /** Line width as a fraction of the page's short edge. */
  width: number;
  points: StrokePoint[];
}

/** The pixel box a page currently occupies on screen. */
export interface PageBox {
  width: number;
  height: number;
}

/**
 * Default pencil width as a fraction of the page's short edge. On a US-letter
 * page at fit-page this lands around 1.5 device-independent pixels — a real
 * propelling-pencil line, thin enough to circle a single notehead.
 */
export const PENCIL_WIDTH = 0.0022;

/** Matches the Rust `MIN_STROKE_WIDTH`/`MAX_STROKE_WIDTH` guards. */
export const MIN_PENCIL_WIDTH = 0.0002;
export const MAX_PENCIL_WIDTH = 0.05;

/** Matches the Rust `MAX_STROKE_POINTS` guard. */
export const MAX_STROKE_POINTS = 5000;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Convert one client-space pointer position into normalized page coordinates,
 * against the page box measured at pointer-down. Clamped to the page, so a
 * stroke dragged off the edge stops at the paper rather than storing geometry
 * the backend would reject.
 */
export function toPagePoint(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
): StrokePoint | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  return {
    x: clamp01((clientX - box.left) / box.width),
    y: clamp01((clientY - box.top) / box.height),
  };
}

/** Normalized point → pixel position inside a page box of `box` pixels. */
export function toPixels(point: StrokePoint, box: PageBox): [number, number] {
  return [point.x * box.width, point.y * box.height];
}

/**
 * Stroke width in pixels for a given page box. Scaled off the SHORT edge so the
 * line thickens with the page under zoom (like real graphite) and stays
 * identical whether the page is portrait or landscape.
 */
export function strokePixelWidth(width: number, box: PageBox): number {
  return Math.max(0.5, width * Math.min(box.width, box.height));
}

/**
 * Should this raw sample be kept? Points closer than this to the previous one
 * carry no shape and only cost storage — a stationary finger emits them at
 * 120 Hz. Distance is in normalized units, so the filter is zoom-independent:
 * the same physical gesture yields the same stroke at any zoom.
 */
const MIN_SAMPLE_DISTANCE = 0.0012;

export function isNewSample(previous: StrokePoint, next: StrokePoint): boolean {
  return (
    Math.hypot(next.x - previous.x, next.y - previous.y) >= MIN_SAMPLE_DISTANCE
  );
}

/** Perpendicular distance from `point` to the segment `start`–`end`. */
function segmentDistance(
  point: StrokePoint,
  start: StrokePoint,
  end: StrokePoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0)
    return Math.hypot(point.x - start.x, point.y - start.y);
  let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/**
 * Ramer–Douglas–Peucker simplification, iterative so a long stroke can never
 * blow the stack. Tolerance is in normalized units and deliberately well below
 * a staff-line gap, so the shape a pianist drew is preserved exactly while the
 * redundant samples between them go.
 */
export function simplify(
  points: StrokePoint[],
  tolerance = 0.0006,
): StrokePoint[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    let worst = 0;
    let worstIndex = -1;
    for (let index = first + 1; index < last; index += 1) {
      const distance = segmentDistance(
        points[index],
        points[first],
        points[last],
      );
      if (distance > worst) {
        worst = distance;
        worstIndex = index;
      }
    }
    if (worstIndex >= 0 && worst > tolerance) {
      keep[worstIndex] = true;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/**
 * Turn raw samples into a storable stroke: simplified, capped, and never
 * shorter than the two points the backend requires (a tap becomes a dot by
 * repeating its point, which the round cap renders as a graphite dot).
 */
export function finishStroke(
  points: StrokePoint[],
  page: number,
  width = PENCIL_WIDTH,
): Stroke | null {
  if (points.length === 0) return null;
  let simplified = simplify(points);
  if (simplified.length === 1) simplified = [simplified[0], simplified[0]];
  if (simplified.length > MAX_STROKE_POINTS) {
    // Keep the endpoints and drop evenly from the middle rather than truncating,
    // so an absurdly long stroke degrades in resolution, not in extent.
    const step = simplified.length / MAX_STROKE_POINTS;
    const thinned: StrokePoint[] = [];
    for (let index = 0; index < MAX_STROKE_POINTS; index += 1) {
      thinned.push(
        simplified[Math.min(simplified.length - 1, Math.floor(index * step))],
      );
    }
    thinned[thinned.length - 1] = simplified[simplified.length - 1];
    simplified = thinned;
  }
  return { id: null, page, width, points: simplified };
}

/**
 * An SVG path for a stroke, in the pixel space of `box`. Interior points are
 * joined with quadratic curves through segment midpoints — the standard
 * centripetal-free smoothing every drawing app uses — which turns polyline
 * sampling into the soft, continuous line graphite actually leaves.
 */
export function strokePath(points: StrokePoint[], box: PageBox): string {
  if (points.length === 0) return "";
  const [firstX, firstY] = toPixels(points[0], box);
  if (points.length === 1) {
    // A dot: a zero-length line, which a round linecap paints as a round dot.
    return `M ${firstX} ${firstY} L ${firstX} ${firstY}`;
  }
  let path = `M ${firstX} ${firstY}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const [cx, cy] = toPixels(points[index], box);
    const [nx, ny] = toPixels(points[index + 1], box);
    path += ` Q ${cx} ${cy} ${(cx + nx) / 2} ${(cy + ny) / 2}`;
  }
  const [lastX, lastY] = toPixels(points[points.length - 1], box);
  path += ` L ${lastX} ${lastY}`;
  return path;
}

/** Everything the backend needs to persist one stroke. */
export function strokePayload(stroke: Stroke): {
  page: number;
  width: number;
  points_json: string;
} {
  return {
    page: stroke.page,
    width: stroke.width,
    points_json: JSON.stringify(
      stroke.points.map((point) => ({ x: point.x, y: point.y })),
    ),
  };
}
