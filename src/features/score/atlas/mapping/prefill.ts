/**
 * Measure-number prefill (pure logic).
 *
 * Christian's finding: "ensure the pdf mapping uses the measure numbers if they
 * are present." This module minimizes typing in the Map-this-score wizard by
 * proposing the measure at a clicked system start, in a strict priority:
 *
 *   1. EXISTING CALIBRATION ANCHORS — his six pieces are pre-mapped, so clicking
 *      a system the anchors already know pre-fills its exact measure; typing only
 *      corrects.
 *   2. PDF TEXT LAYER — a standalone printed integer in the left margin band near
 *      the clicked system start, validated monotonic against the previous anchor
 *      and (when known) within the XML total. Scanned editions have no text layer
 *      and degrade silently to 3.
 *   3. PREDICTION — after ≥2 anchors on the current run, next = last measure +
 *      median bars-per-system so far, clamped to the XML total when known.
 *
 * Every value is a SUGGESTION only: the caller shows it as an editable field with
 * a provenance tag, and the user still confirms it (the wizard's "Add line", the
 * editor's confirm step). Nothing here saves anything.
 */
import type { LineAnchor } from "./anchors";

export type MeasurePrefillSource = "anchors" | "score" | "estimated";

export interface MeasurePrefill {
  measure: number;
  source: MeasurePrefillSource;
}

/** One PDF text-layer run, normalized to 0–1 page coordinates (top-left origin). */
export interface PrefillTextItem {
  text: string;
  /** Left edge, normalized 0–1. */
  xPct: number;
  /** Vertical position from the top, normalized 0–1. */
  yPct: number;
}

/** Default vertical snap tolerance for anchor proximity (fraction of page height). */
const ANCHOR_TOLERANCE = 0.03;
/** Printed measure numbers sit in the left margin; only look this far in. */
const LEFT_MARGIN_BAND = 0.22;
/** Vertical window around a clicked system start to search for its number. */
const TEXT_V_BAND = 0.06;

function isStandaloneInteger(text: string): boolean {
  return /^\d{1,4}$/.test(text.trim());
}

/**
 * The measure of the nearest anchor at or above `yPct` on `page` — the "previous"
 * system, used to keep a text-layer number monotonic.
 */
function previousMeasure(
  anchors: LineAnchor[],
  page: number,
  yPct: number,
): number | null {
  const above = anchors
    .filter((anchor) => anchor.page === page && anchor.yPct <= yPct)
    .sort((a, b) => b.yPct - a.yPct);
  return above.length > 0 ? above[0].measure : null;
}

/**
 * Priority 1: the exact measure when a click lands on a system the calibration
 * anchors already know. Returns the measure of the closest same-page anchor
 * within `tolerance`, or null when none is close enough.
 */
export function measureFromAnchors(
  anchors: LineAnchor[],
  page: number,
  yPct: number,
  tolerance = ANCHOR_TOLERANCE,
): number | null {
  let best: { measure: number; distance: number } | null = null;
  for (const anchor of anchors) {
    if (anchor.page !== page) continue;
    const distance = Math.abs(anchor.yPct - yPct);
    if (distance > tolerance) continue;
    if (!best || distance < best.distance) {
      best = { measure: anchor.measure, distance };
    }
  }
  return best ? best.measure : null;
}

export interface TextLayerOptions {
  /** Measure of the system above this one; a valid number must exceed it. */
  prev?: number | null;
  /** MusicXML measure count, when known; a valid number must not exceed it. */
  xmlMaxMeasure?: number | null;
  /** Override the left-margin search band (fraction of page width). */
  leftBand?: number;
  /** Override the vertical search window (fraction of page height). */
  vBand?: number;
}

/**
 * Priority 2: a standalone printed integer in the left margin near the clicked
 * system start. Returns null when no plausible number is present (a scanned page
 * with no text layer, a number outside the margin band, or a value that would be
 * non-monotonic or beyond the score's last measure).
 */
export function measureFromTextLayer(
  items: PrefillTextItem[],
  yPct: number,
  options: TextLayerOptions = {},
): number | null {
  const leftBand = options.leftBand ?? LEFT_MARGIN_BAND;
  const vBand = options.vBand ?? TEXT_V_BAND;
  const hasXml =
    typeof options.xmlMaxMeasure === "number" &&
    Number.isFinite(options.xmlMaxMeasure) &&
    options.xmlMaxMeasure > 0;

  let best: { value: number; distance: number } | null = null;
  for (const item of items) {
    if (!isStandaloneInteger(item.text)) continue;
    if (item.xPct > leftBand) continue;
    // A measure number sits at, or slightly above, the system start.
    if (item.yPct > yPct + vBand * 0.5) continue;
    if (item.yPct < yPct - vBand) continue;
    const value = Number(item.text.trim());
    if (!Number.isInteger(value) || value < 1) continue;
    if (options.prev != null && value <= options.prev) continue;
    if (hasXml && value > (options.xmlMaxMeasure as number)) continue;
    const distance = Math.abs(item.yPct - yPct);
    if (!best || distance < best.distance) best = { value, distance };
  }
  return best ? best.value : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface PredictionOptions {
  xmlMaxMeasure?: number | null;
}

/**
 * Priority 3: predict the next system's measure from the run so far. Needs ≥2
 * anchors; returns last measure + median bars-per-system (rounded, ≥ last + 1),
 * clamped to the XML total when known. Null when it cannot predict.
 */
export function predictNextMeasure(
  runAnchors: LineAnchor[],
  options: PredictionOptions = {},
): number | null {
  if (runAnchors.length < 2) return null;
  const ordered = [...runAnchors].sort(
    (a, b) => a.page - b.page || a.yPct - b.yPct,
  );
  const diffs: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const delta = ordered[i].measure - ordered[i - 1].measure;
    if (delta > 0) diffs.push(delta);
  }
  if (diffs.length === 0) return null;
  const step = Math.max(1, Math.round(median(diffs)));
  const last = ordered[ordered.length - 1].measure;
  let next = last + step;
  const hasXml =
    typeof options.xmlMaxMeasure === "number" &&
    Number.isFinite(options.xmlMaxMeasure) &&
    options.xmlMaxMeasure > 0;
  if (hasXml) next = Math.min(next, options.xmlMaxMeasure as number);
  return next;
}

export interface SuggestMeasureInput {
  /** All known calibration anchors for the edition (priority 1). */
  anchors: LineAnchor[];
  /** Anchors added during this wizard run (priority 3 prediction). */
  runAnchors: LineAnchor[];
  page: number;
  yPct: number;
  /** Resolved PDF text layer for the page, or null on a scanned edition. */
  textItems?: PrefillTextItem[] | null;
  xmlMaxMeasure?: number | null;
}

/**
 * Resolve a single measure suggestion for a clicked system, applying the strict
 * anchors → text-layer → prediction priority. Returns null when no source can
 * suggest a plausible measure (the user then just types it).
 */
export function suggestMeasure(
  input: SuggestMeasureInput,
): MeasurePrefill | null {
  const fromAnchors = measureFromAnchors(input.anchors, input.page, input.yPct);
  if (fromAnchors != null) return { measure: fromAnchors, source: "anchors" };

  if (input.textItems && input.textItems.length > 0) {
    const fromText = measureFromTextLayer(input.textItems, input.yPct, {
      prev: previousMeasure(input.anchors, input.page, input.yPct),
      xmlMaxMeasure: input.xmlMaxMeasure ?? null,
    });
    if (fromText != null) return { measure: fromText, source: "score" };
  }

  const predicted = predictNextMeasure(input.runAnchors, {
    xmlMaxMeasure: input.xmlMaxMeasure ?? null,
  });
  if (predicted != null) return { measure: predicted, source: "estimated" };

  return null;
}
