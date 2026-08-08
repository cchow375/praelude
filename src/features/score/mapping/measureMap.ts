// Measure mapping (Plan C, task C4): mirrored wire types for the Rust
// `measure_map` / `measure_scan` / `measure_reconcile` commands, the thin
// invoke wrappers, a pure LOCAL renumber/barline-drag reconciler for the
// review UI, and a module-scoped cache+pub/sub store (the `bannerStore`
// pattern) so the overlay and the (later) snap task share one cache of the
// applied map.
//
// Field names below are VERBATIM copies of `store::measure_map`,
// `score::measure_scan`, and `score::measure_reconcile` in the Rust store —
// see those modules' doc comments for the authoritative semantics. This file
// never invents a shape; it only echoes the wire contract.

import { invoke } from "@tauri-apps/api/core";

// ── Wire types (mirror `store::measure_map`) ────────────────────────────────

export type MapBarSource = "model" | "user" | "interpolated";

export interface MapBar {
  x_right: number;
  number: number;
  confidence?: number | null;
  source: MapBarSource;
}

export interface MapSystem {
  y_top: number;
  y_bottom: number;
  x_left: number;
  x_right: number;
  bars: MapBar[];
}

export interface MeasureMapPage {
  version: number;
  systems: MapSystem[];
}

export interface MeasureMapPageRow {
  page: number;
  map: MeasureMapPage;
}

// ── Wire types (mirror `score::measure_scan`) ───────────────────────────────

export interface PrintedNumber {
  number: number;
  x: number;
  y: number;
  confidence: number;
}

export interface ScanSystem {
  y_top: number;
  y_bottom: number;
  x_left: number;
  x_right: number;
  barline_xs: number[];
  printed_numbers: PrintedNumber[];
  staves: number;
}

export interface ScanPageOutput {
  systems: ScanSystem[];
}

/** The exact literal `score::measure_scan::ScanError::NeedsClientRaster`
 * serializes to — never wrapped in extra prose. Matched verbatim. */
export const NEEDS_CLIENT_RASTER = "needs_client_raster";

/** True when an `invoke` rejection is the typed client-raster signal, in
 * either its real-backend shape (a plain string rejection) or an
 * `Error`-wrapped shape (some test/mocking seams wrap rejections). */
export function isNeedsClientRaster(reason: unknown): boolean {
  if (reason === NEEDS_CLIENT_RASTER) return true;
  if (reason instanceof Error) return reason.message === NEEDS_CLIENT_RASTER;
  return false;
}

// ── Wire types (mirror `score::measure_reconcile`) ──────────────────────────

export type MapConflict =
  | { kind: "pickup_ambiguity"; page: number }
  | {
      kind: "continuity_break";
      page: number;
      system: number;
      expected: number;
      found: number;
    }
  | { kind: "total_mismatch"; mapped: number; xml: number }
  | {
      kind: "anchor_disagreement";
      page: number;
      anchor_measure: number;
      mapped_measure: number;
    }
  | {
      kind: "low_confidence_anchor";
      page: number;
      system: number;
      measure: number;
      confidence: number;
    }
  | {
      kind: "overlapping_systems";
      page: number;
      system_a: number;
      system_b: number;
    }
  | {
      kind: "unapplyable";
      page: number;
      /** Real 1-based system index for a defect scoped to one system, or `0`
       * — the Rust sentinel — for a page-/payload-level defect with no
       * single system to blame (a duplicate page, an oversized page). */
      system: number;
      reason: string;
    }
  | {
      /** Low-severity, informational (C6b): this system's bar count came
       * from the system-start bracket rule (both its own start AND the
       * very next system's start carried real printed anchors), not the
       * model's own `barline_xs` — its bars were resynthesized as
       * `expected` evenly spaced positions (`source: "interpolated"`,
       * `confidence: null`) instead of merely being flagged. Never
       * co-occurs with a `continuity_break` for the same pair. */
      kind: "derived_bar_count";
      page: number;
      system: number;
      expected: number;
      found: number;
    };

/** The conflict kinds that make a payload genuinely unapplyable — a structural
 * defect the Rust `measure_map_apply` would reject, or a numbering
 * contradiction no one has resolved yet. These, and ONLY these, disable Apply.
 *
 * Everything else (`derived_bar_count`, `low_confidence_anchor`,
 * `pickup_ambiguity`, `total_mismatch`) is INFORMATIONAL: worth showing the
 * human, never worth blocking on — the map is still structurally applyable
 * with them present, and (C6b) `derived_bar_count` in particular describes a
 * correction the reconciler already made. */
export const BLOCKING_CONFLICT_KINDS: ReadonlySet<MapConflict["kind"]> =
  new Set<MapConflict["kind"]>([
    "unapplyable",
    "continuity_break",
    "overlapping_systems",
    "anchor_disagreement",
  ]);

/** True when this conflict must disable Apply — see `BLOCKING_CONFLICT_KINDS`. */
export function isBlockingConflict(conflict: MapConflict): boolean {
  return BLOCKING_CONFLICT_KINDS.has(conflict.kind);
}

export interface ReconcileResult {
  pages: MeasureMapPageRow[];
  conflicts: MapConflict[];
  total_bars: number;
  /** Whether this piece's numbering floor is 0 (a pickup measure) or 1 —
   * mirrors `score::measure_reconcile::ReconcileResult.has_pickup`. `false`
   * whenever the piece has no MusicXML. The LOCAL renumber/back-fill below
   * uses this as its floor instead of hardcoding 1. */
  has_pickup: boolean;
}

// ── Invoke wrappers ──────────────────────────────────────────────────────────

export function measureMapGet(
  pieceId: number,
  editionId: string,
  editionFingerprint: string,
): Promise<MeasureMapPageRow[]> {
  return invoke<MeasureMapPageRow[]>("measure_map_get", {
    pieceId,
    editionId,
    editionFingerprint,
  });
}

export function measureMapApply(
  pieceId: number,
  editionId: string,
  editionFingerprint: string,
  pages: MeasureMapPageRow[],
): Promise<number> {
  return invoke<number>("measure_map_apply", {
    pieceId,
    editionId,
    editionFingerprint,
    pages,
  });
}

export function measureMapClear(
  pieceId: number,
  editionFingerprint: string,
): Promise<number> {
  return invoke<number>("measure_map_clear", { pieceId, editionFingerprint });
}

/** `pageJpeg` is `null` for the normal server-render path; pass client-
 * rasterized JPEG bytes (a plain byte array — the `saveFirstPage` idiom) on
 * the retry after a `needs_client_raster` rejection. */
export function measureScanPage(
  pieceId: number,
  editionId: string,
  editionFingerprint: string,
  page: number,
  pageJpeg: number[] | null,
): Promise<ScanPageOutput> {
  return invoke<ScanPageOutput>("measure_scan_page", {
    pieceId,
    editionId,
    editionFingerprint,
    page,
    pageJpeg,
  });
}

export interface ReconcilePageInput {
  page: number;
  scan: ScanPageOutput;
}

export function measureReconcile(
  pieceId: number,
  editionId: string,
  editionFingerprint: string,
  pages: ReconcilePageInput[],
): Promise<ReconcileResult> {
  return invoke<ReconcileResult>("measure_reconcile", {
    pieceId,
    editionId,
    editionFingerprint,
    pagesJson: JSON.stringify(pages),
  });
}

// ── Local (in-browser) renumber / barline-drag reconciler ──────────────────
//
// The review UI's own edits (a click-to-renumber, a barline drag) must never
// round-trip through `measure_reconcile` — that command re-derives numbering
// from RAW vision scans (printed numbers + barline counts), which the review
// UI no longer has once it is editing the reconciled `MeasureMapPageRow[]`
// result. Instead this is a pure, deterministic mirror of the Rust
// reconciler's OWN bidirectional propagation rule (`score::measure_reconcile`
// fix round 1's contract, see task-C3-report.md): the span BEFORE the first
// anchor in the flattened page/system/bar stream back-fills FROM it, clamped
// at the numbering FLOOR (1 normally, 0 when `hasPickup` — the piece's own
// `ReconcileResult.has_pickup`, threaded in by the caller); every span AFTER
// an anchor (mid-span between two anchors, or the trailing span past the
// last one) forward-fills from its nearest preceding anchor. A back-fill that
// would go below the floor clamps there instead AND raises a
// `continuity_break` on the leading span. Here the only anchors are the bars
// the user has explicitly pinned (`source: "user"`) — a fresh user pin
// always wins over whatever a model/interpolated bar said, satisfying the
// carry-forward rule that a user pin is trusted over a model one.

export interface BarLocation {
  pageIndex: number;
  systemIndex: number;
  barIndex: number;
}

interface FlatBarRef {
  loc: BarLocation;
  bar: MapBar;
}

function flattenBars(pages: MeasureMapPageRow[]): FlatBarRef[] {
  const flat: FlatBarRef[] = [];
  pages.forEach((row, pageIndex) => {
    row.map.systems.forEach((system, systemIndex) => {
      system.bars.forEach((bar, barIndex) => {
        flat.push({ loc: { pageIndex, systemIndex, barIndex }, bar });
      });
    });
  });
  return flat;
}

function locationEquals(a: BarLocation, b: BarLocation): boolean {
  return (
    a.pageIndex === b.pageIndex &&
    a.systemIndex === b.systemIndex &&
    a.barIndex === b.barIndex
  );
}

/** Deep-clone `pages` (Structured Clone is unavailable in some jsdom-under-
 * vitest configurations; JSON round-trip is exact for this JSON-shaped data
 * and matches the wire contract's own transport). */
function clonePages(pages: MeasureMapPageRow[]): MeasureMapPageRow[] {
  return JSON.parse(JSON.stringify(pages)) as MeasureMapPageRow[];
}

export interface LocalReconcileResult {
  pages: MeasureMapPageRow[];
  conflicts: MapConflict[];
}

/**
 * Merge a local pass's freshly-derived conflicts into the conflict list the
 * review is currently showing.
 *
 * `applyAnchors` below can only ever re-derive `continuity_break` — it has no
 * XML, no calibration anchors and no raw vision scan, so it can neither
 * confirm nor refute `unapplyable`, `overlapping_systems`,
 * `anchor_disagreement`, `total_mismatch`, `pickup_ambiguity`,
 * `low_confidence_anchor` or `derived_bar_count`. Replacing the whole list
 * with its output therefore SILENTLY DROPPED every one of those (live-QA
 * Critical, task C7): a renumber anywhere cleared a structural `unapplyable`
 * on an unrelated page and re-enabled Apply over malformed geometry.
 *
 * So: every non-continuity-break conflict survives verbatim, and only the
 * anchor-derived continuity breaks are replaced. A local edit can never clear
 * a structural conflict — only a fresh server reconcile (which recomputes the
 * whole list from raw scans) or an explicit page exclusion can.
 */
export function mergeLocalConflicts(
  current: MapConflict[],
  fresh: MapConflict[],
): MapConflict[] {
  return [
    ...current.filter((conflict) => conflict.kind !== "continuity_break"),
    ...fresh,
  ];
}

/**
 * Pin `location`'s bar to `newNumber` as a user anchor, then forward/backward
 * fill every OTHER bar in the whole review (across all pages) from the
 * nearest user anchor in stream order. Every consecutive pair of user anchors
 * that disagrees (the bar-index gap between them does not equal their number
 * gap) becomes a visible `continuity_break` conflict — this is the ONLY
 * conflict kind a local edit re-derives, so `currentConflicts` (the list the
 * review is showing right now) is MERGED through `mergeLocalConflicts` rather
 * than replaced: every other kind survives untouched.
 */
export function renumberBar(
  pages: MeasureMapPageRow[],
  location: BarLocation,
  newNumber: number,
  hasPickup = false,
  currentConflicts: MapConflict[] = [],
): LocalReconcileResult {
  const next = clonePages(pages);
  const flat = flattenBars(next);
  const target = flat.find((ref) => locationEquals(ref.loc, location));
  if (!target) return { pages: next, conflicts: [...currentConflicts] };

  target.bar.number = Math.max(0, Math.trunc(newNumber));
  target.bar.source = "user";

  return {
    pages: next,
    conflicts: mergeLocalConflicts(
      currentConflicts,
      applyAnchors(flat, hasPickup),
    ),
  };
}

/** Re-run the SAME forward/backward-fill from whatever user anchors already
 * exist, without pinning a new one — used after a structural change (e.g. a
 * barline drag adds/removes nothing here, but callers that DO change bar
 * membership can use this to keep numbering consistent with existing pins). */
export function reconcileLocal(
  pages: MeasureMapPageRow[],
  hasPickup = false,
  currentConflicts: MapConflict[] = [],
): LocalReconcileResult {
  const next = clonePages(pages);
  const flat = flattenBars(next);
  return {
    pages: next,
    conflicts: mergeLocalConflicts(
      currentConflicts,
      applyAnchors(flat, hasPickup),
    ),
  };
}

/** The numbering floor: 0 for a pickup measure, 1 otherwise — matches
 * `score::measure_reconcile::reconcile`'s own `floor` binding exactly. */
function numberingFloor(hasPickup: boolean): number {
  return hasPickup ? 0 : 1;
}

function applyAnchors(flat: FlatBarRef[], hasPickup: boolean): MapConflict[] {
  const anchors = flat
    .map((ref, index) => ({ index, ref }))
    .filter(({ ref }) => ref.bar.source === "user");

  if (anchors.length === 0) return [];

  const floor = numberingFloor(hasPickup);
  const conflicts: MapConflict[] = [];

  // Back-fill everything before the first anchor, clamped at the floor. A
  // back-fill that would need to go below the floor clamps there instead and
  // raises a continuity_break on the leading span (mirrors Rust's
  // `back_fill_underflow_clamps_at_the_floor_and_raises_a_continuity_break`).
  const first = anchors[0];
  if (first.index > 0) {
    const wouldUnderflow = first.ref.bar.number - first.index < floor;
    for (let i = 0; i < first.index; i += 1) {
      flat[i].bar.number = Math.max(
        floor,
        first.ref.bar.number - (first.index - i),
      );
    }
    if (wouldUnderflow) {
      conflicts.push({
        kind: "continuity_break",
        page: flat[0].loc.pageIndex + 1,
        system: flat[0].loc.systemIndex + 1,
        expected: Math.max(0, first.ref.bar.number - floor),
        found: first.index,
      });
    }
  }

  // Forward-fill from each anchor up to (not including) the next anchor, or
  // to the end of the stream after the last anchor.
  for (let a = 0; a < anchors.length; a += 1) {
    const anchor = anchors[a];
    const nextAnchor = anchors[a + 1];
    const end = nextAnchor ? nextAnchor.index : flat.length;
    for (let i = anchor.index; i < end; i += 1) {
      flat[i].bar.number = anchor.ref.bar.number + (i - anchor.index);
    }
  }

  // Conflicts: every consecutive pair of REAL anchors whose number gap does
  // not match their bar-index gap (the leading-span underflow above is a
  // separate, independent check — it never participates in this loop).
  for (let a = 0; a < anchors.length - 1; a += 1) {
    const left = anchors[a];
    const right = anchors[a + 1];
    const expected = right.ref.bar.number - left.ref.bar.number;
    const found = right.index - left.index;
    if (expected !== found) {
      conflicts.push({
        kind: "continuity_break",
        page: left.ref.loc.pageIndex + 1,
        system: left.ref.loc.systemIndex + 1,
        expected: Math.max(0, expected),
        found,
      });
    }
  }
  return conflicts;
}

/**
 * Drag one barline's `x_right`, horizontal-only, clamped between its
 * neighbors within the system (the previous bar's `x_right`, or the system's
 * `x_left` if it is the first bar — up to the next bar's `x_right`, or the
 * system's `x_right` if it is the last bar). `source` is untouched: dragging
 * a barline never changes who asserted its number. Pure geometry — it never
 * changes bar count or numbering, so it has nothing for a reconcile pass to
 * resolve.
 */
export function dragBarline(
  pages: MeasureMapPageRow[],
  location: BarLocation,
  newXRight: number,
): MeasureMapPageRow[] {
  const next = clonePages(pages);
  const row = next[location.pageIndex];
  const system = row?.map.systems[location.systemIndex];
  const bar = system?.bars[location.barIndex];
  if (!row || !system || !bar) return next;

  const lowerNeighbor =
    location.barIndex > 0
      ? system.bars[location.barIndex - 1].x_right
      : system.x_left;
  const upperNeighbor =
    location.barIndex < system.bars.length - 1
      ? system.bars[location.barIndex + 1].x_right
      : system.x_right;

  const epsilon = 0.000_1;
  const min = lowerNeighbor + epsilon;
  const max = upperNeighbor - epsilon;
  bar.x_right = Math.min(max, Math.max(min, newXRight));
  return next;
}

// ── Snap selection (Task C5) ────────────────────────────────────────────────
//
// A drag rect on a MAPPED page snaps to the bar range it intersects, so a new
// tricky section can be created (or a child creation gesture resolved)
// without the user typing measure numbers. Geometry is normalized (0..1)
// within one page, the same convention `PdfAnchorRect`/`MapSystem` already
// use (`x_left`/`x_right`/`y_top`/`y_bottom`, bar `x_right` is that bar's
// right edge; its left edge is the previous bar's `x_right`, or the system's
// `x_left` for the first bar in a system).

export interface DragPageRect {
  /** 1-indexed page number, matching `MeasureMapPageRow.page`. */
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Resolve a drag selection (one rect per page it touches — almost always
 * one page) to the measure-number range it intersects, system-aware: a rect
 * intersects a system when their y-bands overlap, then intersects a bar
 * within that system when their x-spans overlap (edges touching count).
 * Multi-system drags take the min..max bar number across every system the
 * rect touches. Returns `null` when ANY touched page has no applied map (or
 * no page was touched at all), so the caller falls back to typed measures —
 * this function never returns a partial result.
 */
export function barRangeForRect(
  pages: MeasureMapPageRow[],
  pageRects: DragPageRect[],
): { m_start: number; m_end: number } | null {
  if (pageRects.length === 0) return null;
  let min: number | null = null;
  let max: number | null = null;
  for (const rect of pageRects) {
    const row = pages.find((candidate) => candidate.page === rect.page);
    if (!row) return null;
    for (const system of row.map.systems) {
      const yOverlaps = rect.y1 >= system.y_top && rect.y0 <= system.y_bottom;
      if (!yOverlaps) continue;
      let left = system.x_left;
      for (const bar of system.bars) {
        const right = bar.x_right;
        const xOverlaps = rect.x1 >= left && rect.x0 <= right;
        if (xOverlaps) {
          if (min === null || bar.number < min) min = bar.number;
          if (max === null || bar.number > max) max = bar.number;
        }
        left = right;
      }
    }
  }
  if (min === null || max === null) return null;
  return { m_start: min, m_end: max };
}

// ── Module-scoped cache + pub/sub (the `bannerStore` pattern) ──────────────
//
// Unlike `bannerStore` (which deliberately retains NOTHING), this store DOES
// retain a snapshot: the overlay needs to render the applied map on mount,
// before any write happens in this session, and the (later) snap task shares
// the identical cache rather than re-fetching. Keyed by piece+edition id (not
// fingerprint) so a fingerprint change is detectable as staleness — see
// `getMeasureMapEntry`'s doc comment — instead of silently becoming a cache
// miss the moment the file changes.

export interface MeasureMapCacheEntry {
  fingerprint: string;
  pages: MeasureMapPageRow[];
}

type MeasureMapListener = (entry: MeasureMapCacheEntry | null) => void;

const cache = new Map<string, MeasureMapCacheEntry>();
const listeners = new Map<string, Set<MeasureMapListener>>();

function storeKey(pieceId: number, editionId: string): string {
  return `${pieceId}::${editionId}`;
}

/** The last known applied map for this piece+edition, regardless of whether
 * it matches the CURRENT edition fingerprint — callers compare
 * `entry.fingerprint` against the live edition fingerprint themselves to
 * decide staleness (Flaws B48: always surfaced, never mode-gated). */
export function getMeasureMapEntry(
  pieceId: number,
  editionId: string,
): MeasureMapCacheEntry | null {
  return cache.get(storeKey(pieceId, editionId)) ?? null;
}

/** Listen for cache changes to one piece+edition. Returns the unsubscribe
 * function. Does NOT replay on subscribe — mirrors `bannerStore`; callers
 * read the current entry via `getMeasureMapEntry` at mount time themselves. */
export function subscribeMeasureMap(
  pieceId: number,
  editionId: string,
  listener: MeasureMapListener,
): () => void {
  const key = storeKey(pieceId, editionId);
  let forKey = listeners.get(key);
  if (!forKey) {
    forKey = new Set();
    listeners.set(key, forKey);
  }
  forKey.add(listener);
  return () => {
    const current = listeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(key);
  };
}

/** Publish a freshly-applied (or freshly-fetched) map into the cache and
 * notify every subscriber synchronously. Call this after `measure_map_apply`
 * SUCCEEDS, with the exact fingerprint it was applied under. */
export function publishMeasureMap(
  pieceId: number,
  editionId: string,
  fingerprint: string,
  pages: MeasureMapPageRow[],
): void {
  const key = storeKey(pieceId, editionId);
  const entry: MeasureMapCacheEntry = { fingerprint, pages };
  cache.set(key, entry);
  const forKey = listeners.get(key);
  if (!forKey) return;
  for (const listener of [...forKey]) listener(entry);
}

/** Drop the cached map (e.g. after `measure_map_clear`). */
export function clearMeasureMapEntry(pieceId: number, editionId: string): void {
  const key = storeKey(pieceId, editionId);
  cache.delete(key);
  const forKey = listeners.get(key);
  if (!forKey) return;
  for (const listener of [...forKey]) listener(null);
}

/** Test-only: reset every cached entry so suites never bleed piece/edition
 * state into one another. */
export function resetMeasureMapStoreForTests(): void {
  cache.clear();
  listeners.clear();
}

// ── Local UI preference ─────────────────────────────────────────────────────

export const SHOW_MEASURES_STORAGE_KEY = "ck.score.showMeasures";

export function readShowMeasuresPreference(): boolean {
  try {
    return window.localStorage.getItem(SHOW_MEASURES_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShowMeasuresPreference(visible: boolean): void {
  try {
    if (visible) {
      window.localStorage.setItem(SHOW_MEASURES_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(SHOW_MEASURES_STORAGE_KEY);
    }
  } catch {
    // Best-effort memory only.
  }
}
