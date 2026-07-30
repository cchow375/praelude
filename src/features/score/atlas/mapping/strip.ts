/**
 * XML measure strip + parallel-placement logic (pure).
 *
 * The Map-this-score wizard shows the PDF page on the left and a compact measure
 * strip on the right. This module turns the line anchors the user has placed into
 * that strip and powers the two-way highlight:
 *
 *   - CLICK A MEASURE in the strip  → which page + system band do the anchors
 *     (and interpolation between them) put it on?      `placeMeasure`
 *   - CLICK A SYSTEM on the PDF      → which measures does that system cover?
 *                                                       `measureRangeForSystem`
 *
 * Honest scope (spec D5 / ledger #31): there is no per-piece MusicXML measure
 * index available to the frontend today (no Tauri command exposes one, and this
 * lane may not add one), so the strip is built from what IS known — the
 * calibration line anchors, plus the MusicXML measure total when the caller can
 * supply it, plus optional landmarks. It is a *parallel* view of the manual map,
 * not OMR.
 *
 * Geometry is normalized 0–1 (top = 0), matching the rest of the atlas stack.
 * "Reading order" = sort by (page, yPct): the natural top-to-bottom, page-by-page
 * order the systems are read in.
 */
import type { LineAnchor } from "./anchors";

/** Optional per-measure landmark, when a caller can supply MusicXML structure. */
export interface MeasureLandmark {
  measure: number;
  /** e.g. "3/4", "♩=92", "A" (rehearsal), "Trio" (section). Rendered verbatim. */
  label: string;
  kind: "time" | "tempo" | "rehearsal" | "section" | "key";
}

/**
 * One measure's raw MusicXML facts, as `score_xml_measure_facts` returns them.
 * Every descriptive field is optional and rendered verbatim when present.
 */
export interface XmlMeasureFact {
  number: number;
  key?: string | null;
  time?: string | null;
  tempo?: string | null;
  rehearsal?: string | null;
  section?: string | null;
}

function trimmedLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/**
 * Collapse each measure's MusicXML facts into at most one strip landmark. The
 * strip holds a single landmark per measure, so when a measure carries several
 * facts we surface the most navigationally useful one — a rehearsal mark, then a
 * section name, then a tempo, a time signature, and finally a key change. Labels
 * are kept verbatim (e.g. "A", "Trio", "♩=92", "3/4", "-2 fifths"); blank or
 * whitespace-only facts are ignored, and a measure with no facts adds no row.
 */
export function landmarksFromMeasureFacts(
  measures: XmlMeasureFact[],
): MeasureLandmark[] {
  const out: MeasureLandmark[] = [];
  for (const measure of measures) {
    if (!Number.isInteger(measure.number)) continue;
    const rehearsal = trimmedLabel(measure.rehearsal);
    const section = trimmedLabel(measure.section);
    const tempo = trimmedLabel(measure.tempo);
    const time = trimmedLabel(measure.time);
    const key = trimmedLabel(measure.key);
    const picked: Pick<MeasureLandmark, "kind" | "label"> | null = rehearsal
      ? { kind: "rehearsal", label: rehearsal }
      : section
        ? { kind: "section", label: section }
        : tempo
          ? { kind: "tempo", label: tempo }
          : time
            ? { kind: "time", label: time }
            : key
              ? { kind: "key", label: key }
              : null;
    if (picked) out.push({ measure: measure.number, ...picked });
  }
  return out;
}

/**
 * One anchored system in reading order, with the measure span it covers. `mEnd`
 * is inclusive; it is bounded by the next system's start only when that start is
 * monotonic (strictly greater). A non-monotonic or final system is left
 * "open" — coarse, never interpolated backward across a section boundary.
 */
export interface StripSystem {
  /** Reading-order index (0-based). */
  index: number;
  page: number;
  yTop: number;
  yBottom: number;
  mStart: number;
  /** Inclusive last measure this system is known to cover. */
  mEnd: number;
  /** Measures the system spans (mEnd - mStart + 1); the density signal. */
  bars: number;
  /** True when the next reading-order anchor bounds this system monotonically. */
  bounded: boolean;
}

/** One measure row in the strip. */
export interface StripMeasure {
  measure: number;
  /** The measure sits exactly on a placed line anchor. */
  anchored: boolean;
  /** Reading-order index of the system that contains it, or null if unplaced. */
  systemIndex: number | null;
  page: number | null;
  yTop: number | null;
  yBottom: number | null;
  /**
   * Placement weight 0–1 (opacity/weight, never hue): 1 for an anchored measure,
   * lower for an interpolated interior measure of a sparsely-anchored (many-bar)
   * system. This is the density-aware confidence signal.
   */
  weight: number;
  landmark?: MeasureLandmark;
}

export type StripWarningKind = "non_monotonic" | "duplicate" | "beyond_xml";

/** A quiet disagreement row: an anchor that can't be trusted at face value. */
export interface StripWarning {
  kind: StripWarningKind;
  /** The offending anchor's measure. */
  measure: number;
  page: number;
  message: string;
}

export interface MeasureStrip {
  systems: StripSystem[];
  measures: StripMeasure[];
  warnings: StripWarning[];
  minMeasure: number;
  maxMeasure: number;
}

export interface BuildStripOptions {
  /** MusicXML measure total, when the caller knows it; extends the strip to it. */
  xmlMaxMeasure?: number | null;
  /** Optional landmarks keyed by measure (verbatim labels), when available. */
  landmarks?: MeasureLandmark[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

/** Anchors in reading order (page, then top-to-bottom). Stable, non-mutating. */
export function readingOrder(anchors: LineAnchor[]): LineAnchor[] {
  return [...anchors].sort((a, b) => a.page - b.page || a.yPct - b.yPct);
}

/**
 * Interior placement weight for a system covering `bars` measures. Fewer bars per
 * system means denser anchoring and higher confidence; an open (unbounded) system
 * with a huge or unknown span decays toward zero. Anchored measures bypass this.
 */
function densityWeight(bars: number): number {
  if (!Number.isFinite(bars) || bars <= 1) return 0.6;
  return round3(clamp01(1.5 / bars));
}

/**
 * Build the measure strip from placed line anchors. The systems are the anchors
 * in reading order; each system's span runs to the next anchor's start when that
 * is monotonic, and stays open across a section boundary (a non-monotonic anchor)
 * so interpolation never runs backward. Non-monotonic, duplicate, and
 * beyond-the-score anchors surface as quiet warnings instead of silent
 * misplacement.
 */
export function buildMeasureStrip(
  anchors: LineAnchor[],
  options: BuildStripOptions = {},
): MeasureStrip {
  const ordered = readingOrder(anchors);
  const hasXml =
    typeof options.xmlMaxMeasure === "number" &&
    Number.isFinite(options.xmlMaxMeasure) &&
    (options.xmlMaxMeasure as number) > 0;
  const xmlMax = hasXml ? (options.xmlMaxMeasure as number) : null;

  const warnings: StripWarning[] = [];
  const systems: StripSystem[] = [];

  // Highest measure seen so far in reading order; a system whose start does not
  // exceed it violates monotonicity (a section boundary / repeat / mis-entry).
  let runningMax = -Infinity;

  ordered.forEach((anchor, i) => {
    const next = ordered[i + 1];
    const bounded = next != null && next.measure > anchor.measure;
    // A bounded system ends the measure before the next system starts.
    let mEnd = bounded ? next.measure - 1 : anchor.measure;
    if (!bounded && xmlMax != null && i === ordered.length - 1) {
      // The final system runs to the end of the score when the total is known.
      mEnd = Math.max(anchor.measure, xmlMax);
    }
    const bars = mEnd - anchor.measure + 1;

    systems.push({
      index: i,
      page: anchor.page,
      yTop: clamp01(anchor.yPct),
      yBottom: clamp01(
        next != null && next.page === anchor.page ? next.yPct : 1,
      ),
      mStart: anchor.measure,
      mEnd,
      bars,
      bounded,
    });

    if (anchor.measure <= runningMax) {
      warnings.push({
        kind: anchor.measure === runningMax ? "duplicate" : "non_monotonic",
        measure: anchor.measure,
        page: anchor.page,
        message:
          anchor.measure === runningMax
            ? `m.${anchor.measure} on p.${anchor.page} repeats the previous system's measure — check the anchor.`
            : `m.${anchor.measure} on p.${anchor.page} goes backward from m.${runningMax} above it — this system won't interpolate across the break.`,
      });
    } else {
      runningMax = anchor.measure;
    }

    if (xmlMax != null && anchor.measure > xmlMax) {
      warnings.push({
        kind: "beyond_xml",
        measure: anchor.measure,
        page: anchor.page,
        message: `m.${anchor.measure} is beyond the score's last measure (${xmlMax}) — re-check this anchor.`,
      });
    }
  });

  const landmarkByMeasure = new Map<number, MeasureLandmark>();
  for (const landmark of options.landmarks ?? []) {
    landmarkByMeasure.set(landmark.measure, landmark);
  }

  const anchoredMeasures = new Set(ordered.map((a) => a.measure));

  let minMeasure = ordered.length > 0 ? ordered[0].measure : 1;
  let maxMeasure = ordered.reduce(
    (max, a) => Math.max(max, a.measure),
    minMeasure,
  );
  if (xmlMax != null) {
    minMeasure = Math.min(minMeasure, 1);
    maxMeasure = Math.max(maxMeasure, xmlMax);
  }

  const measures: StripMeasure[] = [];
  // Nothing to enumerate when there are no anchors and no XML total to fill in.
  const hasSpan = ordered.length > 0 || xmlMax != null;
  for (let m = minMeasure; hasSpan && m <= maxMeasure; m += 1) {
    const system = systemForMeasure(systems, m);
    const anchored = anchoredMeasures.has(m);
    measures.push({
      measure: m,
      anchored,
      systemIndex: system ? system.index : null,
      page: system ? system.page : null,
      yTop: system ? system.yTop : null,
      yBottom: system ? system.yBottom : null,
      weight: anchored ? 1 : system ? densityWeight(system.bars) : 0,
      landmark: landmarkByMeasure.get(m),
    });
  }

  return { systems, measures, warnings, minMeasure, maxMeasure };
}

/**
 * The system (in reading order) that contains measure `m`: the last system whose
 * start is ≤ m and whose inclusive end is ≥ m. Returns null when m falls outside
 * every known system (e.g. below the first anchor, or past an open final system
 * when no XML total bounds it).
 */
export function systemForMeasure(
  systems: StripSystem[],
  m: number,
): StripSystem | null {
  let found: StripSystem | null = null;
  for (const system of systems) {
    if (m >= system.mStart && m <= system.mEnd) found = system;
  }
  return found;
}

/**
 * CLICK-A-MEASURE → page + system band placement. Returns the band to highlight
 * (and scroll to) on the PDF for measure `m`, with the same weight signal as the
 * strip row. Null when the measure can't be placed from the current anchors.
 */
export function placeMeasure(
  strip: MeasureStrip,
  m: number,
): {
  systemIndex: number;
  page: number;
  yTop: number;
  yBottom: number;
  anchored: boolean;
  weight: number;
} | null {
  const system = systemForMeasure(strip.systems, m);
  if (!system) return null;
  const anchored = system.mStart === m;
  return {
    systemIndex: system.index,
    page: system.page,
    yTop: system.yTop,
    yBottom: system.yBottom,
    anchored,
    weight: anchored ? 1 : densityWeight(system.bars),
  };
}

/**
 * CLICK-A-SYSTEM → measure range. The inclusive [mStart, mEnd] a given system
 * covers, for highlighting the corresponding strip rows. Null for an unknown
 * index.
 */
export function measureRangeForSystem(
  strip: MeasureStrip,
  systemIndex: number,
): { mStart: number; mEnd: number } | null {
  const system = strip.systems.find((s) => s.index === systemIndex);
  if (!system) return null;
  return { mStart: system.mStart, mEnd: system.mEnd };
}

/**
 * Reading-order index of the system that should be selected when strip measure
 * `m` is clicked — the two-way selection's measure→system direction. Null when
 * unplaceable.
 */
export function selectSystemForMeasure(
  strip: MeasureStrip,
  m: number,
): number | null {
  const system = systemForMeasure(strip.systems, m);
  return system ? system.index : null;
}
