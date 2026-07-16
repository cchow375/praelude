import type { UniversePiece } from "./types";

export interface UniverseGraphNode {
  piece: UniversePiece;
  x: number;
  y: number;
  radius: number;
  paletteIndex: number;
}

export interface UniverseGraphLayout {
  nodes: UniverseGraphNode[];
  width: number;
  height: number;
  columns: number;
  rows: number;
}

const CELL_WIDTH = 270;
const CELL_HEIGHT = 250;
const WORLD_PADDING = 112;
const MIN_WORLD_WIDTH = 1_060;
const MIN_WORLD_HEIGHT = 610;

/** Focused time is the only input allowed to buy system size. */
export function starRadius(seconds: number): number {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return Math.max(18, Math.min(50, 18 + Math.log2(1 + safe / 60) * 4.8));
}

/** Stable 32-bit mixing for integer database IDs; never rendered as copy. */
export function stableIdHash(id: number): number {
  let value = (Math.trunc(id) | 0) ^ 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

/**
 * A collision-free, input-order-independent layout. Systems are ordered by a
 * hash of their stable piece ID, then placed on a roomy staggered grid with a
 * small ID-derived offset. The grid grows with the dataset instead of packing
 * every piece into one fixed 1000px illustration.
 */
export function layoutUniversePieces(pieces: UniversePiece[]): UniverseGraphLayout {
  if (pieces.length === 0) {
    return { nodes: [], width: MIN_WORLD_WIDTH, height: MIN_WORLD_HEIGHT, columns: 1, rows: 1 };
  }

  const ordered = [...pieces].sort((left, right) => {
    const hashDelta = stableIdHash(left.piece_id) - stableIdHash(right.piece_id);
    return hashDelta || left.piece_id - right.piece_id;
  });
  const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length * 1.6)));
  const rows = Math.ceil(ordered.length / columns);
  const contentWidth = columns * CELL_WIDTH;
  const contentHeight = rows * CELL_HEIGHT;
  const width = Math.max(MIN_WORLD_WIDTH, contentWidth + WORLD_PADDING * 2);
  const height = Math.max(MIN_WORLD_HEIGHT, contentHeight + WORLD_PADDING * 2);
  const offsetX = (width - contentWidth) / 2;
  const offsetY = (height - contentHeight) / 2;

  const nodes = ordered.map((piece, index) => {
    const hash = stableIdHash(piece.piece_id);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const jitterX = ((hash & 0xff) / 255 - 0.5) * 38;
    const jitterY = (((hash >>> 8) & 0xff) / 255 - 0.5) * 24;
    return {
      piece,
      x: offsetX + column * CELL_WIDTH + CELL_WIDTH / 2 + jitterX,
      y: offsetY + row * CELL_HEIGHT + CELL_HEIGHT / 2 + jitterY + (column % 2) * 9,
      radius: starRadius(piece.focused_seconds),
      paletteIndex: hash % 8,
    };
  });

  return { nodes, width, height, columns, rows };
}
