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
    };

export interface ReconcileResult {
  pages: MeasureMapPageRow[];
  conflicts: MapConflict[];
  total_bars: number;
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
// reconciler's OWN propagation rule (`score::measure_reconcile`'s doc
// comment): every bar's number is `nearestPrecedingAnchor.number + (index -
// nearestPrecedingAnchor.index)`, forward-filled from whichever anchor
// precedes it in the flattened page/system/bar stream; bars before the very
// first anchor fill BACKWARD from it the same way. Here the only anchors are
// the bars the user has explicitly pinned (`source: "user"`) — a fresh user
// pin always wins over whatever a model/interpolated bar said, satisfying the
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
 * Pin `location`'s bar to `newNumber` as a user anchor, then forward/backward
 * fill every OTHER bar in the whole review (across all pages) from the
 * nearest user anchor in stream order. Every consecutive pair of user anchors
 * that disagrees (the bar-index gap between them does not equal their number
 * gap) becomes a visible `continuity_break` conflict — this is the ONLY
 * conflict kind a local edit re-derives; any other kind the last Rust
 * reconcile found (`total_mismatch`, `pickup_ambiguity`, …) is intentionally
 * dropped, since this pass has no XML/vision context to re-check them.
 */
export function renumberBar(
  pages: MeasureMapPageRow[],
  location: BarLocation,
  newNumber: number,
): LocalReconcileResult {
  const next = clonePages(pages);
  const flat = flattenBars(next);
  const target = flat.find((ref) => locationEquals(ref.loc, location));
  if (!target) return { pages: next, conflicts: [] };

  target.bar.number = Math.max(0, Math.trunc(newNumber));
  target.bar.source = "user";

  return { pages: next, conflicts: applyAnchors(flat) };
}

/** Re-run the SAME forward/backward-fill from whatever user anchors already
 * exist, without pinning a new one — used after a structural change (e.g. a
 * barline drag adds/removes nothing here, but callers that DO change bar
 * membership can use this to keep numbering consistent with existing pins). */
export function reconcileLocal(
  pages: MeasureMapPageRow[],
): LocalReconcileResult {
  const next = clonePages(pages);
  const flat = flattenBars(next);
  return { pages: next, conflicts: applyAnchors(flat) };
}

function applyAnchors(flat: FlatBarRef[]): MapConflict[] {
  const anchors = flat
    .map((ref, index) => ({ index, ref }))
    .filter(({ ref }) => ref.bar.source === "user");

  if (anchors.length === 0) return [];

  // Backward-fill everything before the first anchor.
  const first = anchors[0];
  for (let i = 0; i < first.index; i += 1) {
    flat[i].bar.number = Math.max(0, first.ref.bar.number - (first.index - i));
  }

  // Forward-fill from each anchor up to (not including) the next anchor, or
  // to the end of the stream after the last anchor.
  for (let a = 0; a < anchors.length; a += 1) {
    const anchor = anchors[a];
    const nextAnchor = anchors[a + 1];
    const end = nextAnchor ? nextAnchor.index : flat.length;
    for (let i = anchor.index; i < end; i += 1) {
      flat[i].bar.number = Math.max(
        0,
        anchor.ref.bar.number + (i - anchor.index),
      );
    }
  }

  // Conflicts: every consecutive anchor pair whose number gap does not match
  // its bar-index gap.
  const conflicts: MapConflict[] = [];
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
