/**
 * Line-anchor measure mapping (pure logic).
 *
 * A `LineAnchor` marks the vertical position of one system's start on a page and
 * the printed measure number at that start. Given a set of anchors on a page, a
 * drawn box resolves to an approximate measure range by:
 *   1. finding which system(s) the box vertically overlaps, and
 *   2. interpolating the measure across each system horizontally by x — a
 *      system that starts at anchor[i].measure reaches anchor[i+1].measure at its
 *      right edge (the downbeat of the following system).
 *
 * Convention alignment with the existing atlas stack:
 *  - Geometry is expressed as NORMALIZED 0–1 fractions, not 0–100 percentages.
 *    The whole stack does this (`PdfAnchorRect.{x,y,w,h}: f64` in
 *    `store/score_atlas.rs`, `finiteUnit` in `atlas/selection.ts`,
 *    `NormalizedPdfPosition` in `atlas/calibration.ts`), and the plan's own
 *    Task 4.1 examples use y=0.20 / y=0.34. The fields keep the plan's `*Pct`
 *    names for readability but carry 0–1 fractions.
 *  - The result uses `{ mStart, mEnd }` (camelCase), exactly as the plan spells
 *    Task 4.1's `resolveMeasureRange` signature and as the wizard (Task 4.2)
 *    consumes it. This intentionally differs from the persisted
 *    `MeasureRange { m_start, m_end }` (snake_case) in `atlas/model.ts` /
 *    `score_atlas.rs`; the wizard maps this camelCase result onto the snake_case
 *    save payload at the persistence boundary.
 *
 * This module is a lighter, standalone sibling of `atlas/calibration.ts`
 * (`estimateMeasureAtPosition`): calibration needs per-system MusicXML identity,
 * correction provenance, and refuses extrapolation, whereas this wizard-facing
 * helper turns quick line anchors into an editable candidate range with a
 * confidence signal. It never asserts an authoritative mapping on its own.
 */

/** One system's start: its vertical position (0–1) and starting measure number. */
export interface LineAnchor {
  page: number;
  /** Vertical position of the system start, normalized 0–1 (top = 0). */
  yPct: number;
  measure: number;
}

/** A drawn selection box in normalized 0–1 page coordinates. */
export interface MappingBox {
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

/** Resolved, still-editable candidate range with a 0–1 confidence signal. */
export interface ResolvedMeasureRange {
  mStart: number;
  mEnd: number;
  /** 0 when no anchors support the box; higher when it sits between two adjacent anchors. */
  confidence: number;
}

export interface MeasureRangeInput {
  mStart: number;
  mEnd: number;
}

export interface XmlValidation {
  ok: boolean;
  warning?: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

/** Index of the system whose vertical band contains `y` (clamped to the first system above it). */
function lineIndexForY(sorted: LineAnchor[], y: number): number {
  let index = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (y >= sorted[i].yPct) index = i;
    else break;
  }
  return index;
}

/** A system is "bounded" (interpolatable) when a following anchor caps its measure span. */
function isBounded(sorted: LineAnchor[], index: number): boolean {
  return index + 1 < sorted.length;
}

/**
 * Measure at horizontal position `x` (0–1) on system `index`. A bounded system
 * interpolates linearly toward the next system's starting measure; the final
 * (unbounded) system can only report its own start — coarse, not extrapolated.
 */
function measureAtX(sorted: LineAnchor[], index: number, x: number): number {
  const start = sorted[index].measure;
  const next = sorted[index + 1];
  if (!next) return start;
  return start + clamp01(x) * (next.measure - start);
}

/**
 * Resolves a drawn box to an approximate measure range using page line anchors.
 * Always returns `mStart <= mEnd`. Confidence is 0 when the box's page has no
 * anchors, low on a single-anchor (coarse) page, and highest when the box sits
 * between two adjacent known anchors on one system.
 */
export function resolveMeasureRange(
  box: MappingBox,
  anchors: LineAnchor[],
): ResolvedMeasureRange {
  const pageAnchors = anchors.filter((anchor) => anchor.page === box.page);
  if (pageAnchors.length === 0) {
    // No measure information for this page; numbers are meaningless, signal via confidence 0.
    return { mStart: 0, mEnd: 0, confidence: 0 };
  }

  const sorted = [...pageAnchors].sort((left, right) => left.yPct - right.yPct);

  const yTop = box.yPct;
  const yBottom = box.yPct + Math.max(0, box.hPct);
  const topLine = lineIndexForY(sorted, yTop);
  const bottomLine = lineIndexForY(sorted, yBottom);

  const xLeft = box.xPct;
  const xRight = box.xPct + Math.max(0, box.wPct);

  const rawStart = measureAtX(sorted, topLine, xLeft);
  const rawEnd = measureAtX(sorted, bottomLine, xRight);

  // Round outward (like calibration.ts) and guarantee ordering regardless of anchor direction.
  const lo = Math.min(rawStart, rawEnd);
  const hi = Math.max(rawStart, rawEnd);
  const mStart = Math.max(1, Math.floor(lo));
  const mEnd = Math.max(mStart, Math.ceil(hi));

  // Confidence: anchor density on the page + whether both endpoints interpolate
  // between two adjacent anchors, with a small penalty for crossing a system break.
  const density = Math.min(1, sorted.length / 2);
  const boundedFraction =
    ((isBounded(sorted, topLine) ? 1 : 0) +
      (isBounded(sorted, bottomLine) ? 1 : 0)) /
    2;
  let confidence = 0.3 * density + 0.6 * boundedFraction;
  if (topLine !== bottomLine) confidence *= 0.85;

  return { mStart, mEnd, confidence: round3(clamp01(confidence)) };
}

/**
 * Optional cross-check of a resolved range against a MusicXML measure count.
 * XML is optional: a non-positive/non-finite `xmlMaxMeasure` is treated as "no
 * XML available" and skips the beyond-score check. A pickup (anacrusis) measure
 * can shift printed numbering by ±1, so it is surfaced as a soft warning.
 */
export function validateAgainstXml(
  range: MeasureRangeInput,
  xmlMaxMeasure: number,
  hasPickup: boolean,
): XmlValidation {
  const hasXml = Number.isFinite(xmlMaxMeasure) && xmlMaxMeasure > 0;

  if (hasXml && range.mEnd > xmlMaxMeasure) {
    return {
      ok: false,
      warning: `Measure ${range.mEnd} is beyond the score's last measure (${xmlMaxMeasure}); re-check the anchors or the drawn box.`,
    };
  }

  if (hasPickup) {
    return {
      ok: true,
      warning: `This score has a pickup (anacrusis) measure, so printed numbers can differ by ±1 from the internal count; verify m.${range.mStart}–${range.mEnd}.`,
    };
  }

  return { ok: true };
}
