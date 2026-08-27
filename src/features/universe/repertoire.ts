import type { RegionSignal, UniversePiece, UniverseSnapshot } from "./types";

/**
 * The Universe model layer: pure, deterministic derivations from a snapshot.
 *
 * This replaces the old d3-force galaxy. There is no physics, no animation and
 * no randomness — the same snapshot always produces the same groups in the same
 * order, so the map is a place you can learn rather than a scene that re-forms
 * every time you open it.
 *
 * Everything here is bounded by the snapshot contract: pieces and regions carry
 * counts (focused seconds, active days, coverage, mastery/recovery totals) and a
 * `last_practiced` stamp — never per-session rows, streaks or due dates. So
 * "needs a look" is derived only from elapsed time since the last recorded
 * practice and from open recovery debt. Nothing is invented.
 */

/** How long a piece may rest before the map marks it as needing a look. */
export const STALE_AFTER_DAYS = 14;

/** Label used for pieces whose composer the library does not record. */
export const UNATTRIBUTED = "Unattributed";

const MS_PER_DAY = 86_400_000;

/** What one region's practice record amounts to, as a single readable state. */
export type BlockState =
  "untouched" | "practiced" | "revisited" | "mastered" | "recovering";

/** Ordered weakest → strongest; drives the height of a region's mark. */
export const BLOCK_STATE_ORDER: readonly BlockState[] = [
  "untouched",
  "practiced",
  "revisited",
  "mastered",
  "recovering",
] as const;

export const BLOCK_STATE_LABEL: Record<BlockState, string> = {
  untouched: "Not practiced",
  practiced: "Practiced",
  revisited: "Revisited",
  mastered: "Mastery verified",
  recovering: "In recovery",
};

/**
 * A region's state. Open recovery debt outranks verified mastery: a region you
 * have to win back is the actionable fact, whatever it earned before.
 */
export function blockState(region: RegionSignal): BlockState {
  if ((region.open_recovery_debt ?? 0) > 0) return "recovering";
  if ((region.mastery_contracts_completed ?? 0) > 0) return "mastered";
  if (region.revisited) return "revisited";
  if (region.practiced) return "practiced";
  return "untouched";
}

/**
 * Whole days elapsed between `last` and `reference`, or null when either stamp
 * is missing/unparseable.
 *
 * Elapsed time, not calendar days: calendar arithmetic depends on the machine's
 * timezone, and this value decides what the map marks as stale. Elapsed days are
 * the same everywhere, which keeps the layout deterministic.
 */
export function daysSince(
  last: string | null | undefined,
  reference: string | null | undefined,
): number | null {
  if (!last || !reference) return null;
  const then = Date.parse(last);
  const now = Date.parse(reference);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - then) / MS_PER_DAY));
}

export type AttentionKind = "recovering" | "stale" | "never";

export interface Attention {
  kind: AttentionKind;
  /** Days since last practice; null when the piece was never practiced. */
  days: number | null;
  /** Regions carrying open recovery debt (0 unless kind is "recovering"). */
  regions: number;
  /** Short human reason, safe to render as-is. */
  label: string;
}

/** Rank for the attention band: unfinished business, then cold, then untouched. */
const ATTENTION_RANK: Record<AttentionKind, number> = {
  recovering: 0,
  stale: 1,
  never: 2,
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Why (if at all) a piece needs a look, measured against the snapshot's own
 * `generated_at` rather than the wall clock, so the same snapshot always reads
 * the same way.
 */
export function pieceAttention(
  piece: UniversePiece,
  reference: string | null | undefined,
): Attention | null {
  if (piece.archived_at != null) return null;
  const debt = piece.open_recovery_debt ?? 0;
  if (debt > 0) {
    return {
      kind: "recovering",
      days: daysSince(piece.last_practiced, reference),
      regions: debt,
      label: `${plural(debt, "region", "regions")} in recovery`,
    };
  }
  if (!piece.last_practiced) {
    return { kind: "never", days: null, regions: 0, label: "Never practiced" };
  }
  const days = daysSince(piece.last_practiced, reference);
  if (days != null && days >= STALE_AFTER_DAYS) {
    return {
      kind: "stale",
      days,
      regions: 0,
      label: `Rested ${plural(days, "day", "days")}`,
    };
  }
  return null;
}

export interface AttentionEntry {
  piece: UniversePiece;
  attention: Attention;
}

/**
 * The pieces that want work, most-pressing first. Deterministic: recovery debt,
 * then the coldest, then the never-started, each tie-broken by title and id.
 */
export function attentionList(
  pieces: readonly UniversePiece[],
  reference: string | null | undefined,
): AttentionEntry[] {
  const entries: AttentionEntry[] = [];
  for (const piece of pieces) {
    const attention = pieceAttention(piece, reference);
    if (attention) entries.push({ piece, attention });
  }
  return entries.sort((left, right) => {
    const rank =
      ATTENTION_RANK[left.attention.kind] -
      ATTENTION_RANK[right.attention.kind];
    if (rank !== 0) return rank;
    if (left.attention.kind === "recovering") {
      const debt = right.attention.regions - left.attention.regions;
      if (debt !== 0) return debt;
    }
    if (left.attention.kind === "stale") {
      const cold = (right.attention.days ?? 0) - (left.attention.days ?? 0);
      if (cold !== 0) return cold;
    }
    return comparePieces(left.piece, right.piece);
  });
}

/** Case-insensitive, locale-independent string order (locale rules vary by host). */
function compareText(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function comparePieces(left: UniversePiece, right: UniversePiece): number {
  return compareText(left.title, right.title) || left.piece_id - right.piece_id;
}

export interface ComposerGroup {
  /** Display name; `UNATTRIBUTED` when the piece records no composer. */
  composer: string;
  /** Stable slug for DOM ids — derived from the name, never from array order. */
  key: string;
  pieces: UniversePiece[];
}

function slug(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const trimmed = cleaned.replace(/^-+|-+$/g, "");
  return trimmed || "x";
}

/**
 * A composer files under the last word of the recorded name — the way a
 * musician's shelf is ordered. "Frédéric Chopin" sits under C, not F.
 *
 * It is a heuristic, not a name parser: the library stores one free-text
 * composer field, so a compound surname ("Vaughan Williams") files under its
 * final word. The full name is always what is displayed, and the full name is
 * the tie-break, so the order stays total and stable either way.
 */
export function composerSortKey(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] ?? name).toLowerCase();
}

/**
 * The repertoire index: pieces gathered under their composer, composers by
 * surname with `UNATTRIBUTED` last, pieces alphabetical inside each.
 *
 * This is the spatial contract of the whole screen. It depends only on names and
 * ids, so a piece keeps its place from one visit to the next; practising it
 * changes its marks, never its position.
 */
export function groupByComposer(
  pieces: readonly UniversePiece[],
): ComposerGroup[] {
  const buckets = new Map<string, ComposerGroup>();
  for (const piece of pieces) {
    const name = piece.composer?.trim() ? piece.composer.trim() : UNATTRIBUTED;
    let group = buckets.get(name);
    if (!group) {
      group = { composer: name, key: slug(name), pieces: [] };
      buckets.set(name, group);
    }
    group.pieces.push(piece);
  }

  const groups = [...buckets.values()];
  for (const group of groups) group.pieces.sort(comparePieces);
  return groups.sort((left, right) => {
    const leftLast = left.composer === UNATTRIBUTED ? 1 : 0;
    const rightLast = right.composer === UNATTRIBUTED ? 1 : 0;
    return (
      leftLast - rightLast ||
      compareText(
        composerSortKey(left.composer),
        composerSortKey(right.composer),
      ) ||
      compareText(left.composer, right.composer)
    );
  });
}

/** What the detail panel is currently describing. */
export type Selection =
  | { kind: "piece"; pieceId: number }
  | { kind: "block"; pieceId: number; regionId: number };

export function findPiece(
  snapshot: UniverseSnapshot | null | undefined,
  pieceId: number,
): UniversePiece | null {
  return snapshot?.pieces.find((piece) => piece.piece_id === pieceId) ?? null;
}

export function findRegion(
  piece: UniversePiece | null | undefined,
  regionId: number,
): RegionSignal | null {
  return (
    piece?.region_signals.find((region) => region.region_id === regionId) ??
    null
  );
}

/** True when the selection still resolves against this snapshot. */
export function selectionExists(
  snapshot: UniverseSnapshot | null | undefined,
  selection: Selection | null,
): boolean {
  if (!selection) return false;
  const piece = findPiece(snapshot, selection.pieceId);
  if (!piece) return false;
  if (selection.kind === "piece") return true;
  return findRegion(piece, selection.regionId) != null;
}
