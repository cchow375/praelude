import type { PdfAnchorRect } from "./types";

// ---------------------------------------------------------------------------
// Micro-targets ("spots"): the pure half of the zero-friction sub-section.
//
// Christian's requirement is that isolating half a measure inside a tricky
// section costs NO typing and NO naming — "it shouldnt require me to type
// anything at all for that selection box because it should generally know
// where it is". The two things a create form used to demand are a name and a
// measure range, so both have to be derivable. This module derives them.
//
// The measure derivation deliberately does NOT need the measure map. The map
// is the ideal source and ScoreView still prefers it when a page is mapped,
// but the live database has zero map rows (Flaws B75), so a design that only
// works with a map is a design that never works for him. His own note settles
// the accuracy question: "it should be able to basically just estimate where
// it is but it shouldnt even really matter what measure numbers it records
// because it is just for me to select and see what ive practiced." The number
// is a label for his eyes, not an index anything is looked up by — so a
// proportional estimate inside the parent's own known range is honest and
// sufficient. What must be exact is the BOX, and the box is stored verbatim.
//
// Pure and DOM-free on purpose: jsdom applies no CSS and has no layout engine,
// so geometry that is only exercised through a rendered component is geometry
// nobody has actually tested. Everything here is provable from numbers alone.
// ---------------------------------------------------------------------------

export interface MeasureRange {
  m_start: number;
  m_end: number;
}

/** Reading order across a parent's annotation rects: page, then row, then
 * column. `y` before `x` because a section's rects run down the page in
 * systems; two rects on the same system share a `y` closely enough that the
 * `x` comparison decides them. */
function readingOrder(a: PdfAnchorRect, b: PdfAnchorRect): number {
  return a.page - b.page || a.y - b.y || a.x - b.x;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Where a point sits along the parent, as a 0–1 fraction of the parent's
 * reading-order extent. Each rect is treated as an equal slice of the parent —
 * not weighted by width — because a section's rects are systems, and a system
 * holds roughly a system's worth of music regardless of how wide the crop is.
 */
function fractionAlong(
  sorted: PdfAnchorRect[],
  index: number,
  x: number,
): number {
  const rect = sorted[index];
  const within = rect.w > 0 ? clamp((x - rect.x) / rect.w, 0, 1) : 0;
  return (index + within) / sorted.length;
}

/** The parent rect the point falls inside, else the nearest one by centre
 * distance on the same page, else the nearest overall. A drag that strays a
 * few pixels past a system's crop is still obviously "in" that system, and
 * refusing to estimate for it would put the typing back. */
function hostRectIndex(sorted: PdfAnchorRect[], rect: PdfAnchorRect): number {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const inside = sorted.findIndex(
    (mark) =>
      mark.page === rect.page &&
      cx >= mark.x &&
      cx <= mark.x + mark.w &&
      cy >= mark.y &&
      cy <= mark.y + mark.h,
  );
  if (inside !== -1) return inside;
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  sorted.forEach((mark, index) => {
    const dx = cx - (mark.x + mark.w / 2);
    const dy = cy - (mark.y + mark.h / 2);
    // A different page is always worse than any distance on the same page.
    const score =
      Math.hypot(dx, dy) + (mark.page === rect.page ? 0 : 1000);
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

/**
 * Estimate the measure range of a spot dragged inside `parent`.
 *
 * Always returns a range inside the parent's own range — a spot is part of its
 * parent by construction, so a number outside it would be a visible lie. With
 * no usable parent geometry the parent's whole range is returned unchanged:
 * still true, just not narrowed.
 */
export function estimateSpotMeasures(
  parent: MeasureRange,
  parentRects: PdfAnchorRect[],
  rect: PdfAnchorRect,
): MeasureRange {
  const low = Math.min(parent.m_start, parent.m_end);
  const high = Math.max(parent.m_start, parent.m_end);
  const span = high - low + 1;
  const usable = parentRects.filter((mark) => mark.w > 0 && mark.h > 0);
  if (usable.length === 0 || span <= 1) {
    return { m_start: low, m_end: high };
  }
  const sorted = [...usable].sort(readingOrder);
  const index = hostRectIndex(sorted, rect);
  if (index === -1) return { m_start: low, m_end: high };
  const startFraction = fractionAlong(sorted, index, rect.x);
  const endFraction = fractionAlong(sorted, index, rect.x + rect.w);
  const m_start = clamp(low + Math.floor(startFraction * span), low, high);
  const m_end = clamp(
    low + Math.floor(endFraction * span),
    m_start,
    high,
  );
  return { m_start, m_end };
}

const SPOT_NAME = /^spot\s+(\d+)$/i;

/**
 * The next auto-name for a spot under one parent: "Spot 1", "Spot 2", …
 *
 * He never types this and is never asked for it — "i shouldnt have to name it
 * at all because it is already part of the named selection box" — so the name
 * exists only to give the row and the box something to say. Numbering is
 * max-plus-one rather than count-plus-one so deleting "Spot 2" does not make
 * the next spot a second "Spot 3"'s twin; a number he has already seen on the
 * score is never silently reused for different music.
 */
export function nextSpotName(siblingNames: string[]): string {
  let highest = 0;
  for (const name of siblingNames) {
    const match = SPOT_NAME.exec(name.trim());
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > highest) highest = value;
  }
  return `Spot ${highest + 1}`;
}
