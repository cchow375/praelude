import type { PieceMovement, Region } from "../pieces/types";
import { anchorForEdition, validAnchorMap } from "./anchors";

export interface MovementRange {
  movement: PieceMovement;
  start: number;
  end: number;
}

/** Derive inclusive ranges from movement starts and the current PDF length. */
export function movementRanges(
  movements: PieceMovement[],
  pageCount: number,
): MovementRange[] {
  const ordered = [...movements]
    .filter(
      (movement) =>
        Number.isInteger(movement.start_page) && movement.start_page >= 1,
    )
    .sort(
      (a, b) =>
        a.start_page - b.start_page ||
        a.display_order - b.display_order ||
        a.id - b.id,
    );
  return ordered.map((movement, index) => ({
    movement,
    start: movement.start_page,
    end: Math.max(
      movement.start_page,
      Math.min(pageCount, ordered[index + 1]?.start_page - 1 || pageCount),
    ),
  }));
}

export function movementForPage(
  ranges: MovementRange[],
  page: number,
): MovementRange | null {
  return (
    ranges.find((range) => range.start <= page && page <= range.end) ?? null
  );
}

/** A Region's first current-edition anchor page. Unmapped Regions return null
 * and stay available in Whole score rather than being guessed into a movement. */
export function regionAnchorPage(
  region: Region,
  editionId: string,
  editionFingerprint: string,
): number | null {
  const pages =
    anchorForEdition(
      region.pdf_anchor,
      editionId,
      editionFingerprint,
    )?.rects.map((rect) => rect.page) ?? [];
  return pages.length ? Math.min(...pages) : null;
}

/** Details has no active edition. Use the earliest saved anchor page across
 * editions for calm grouping, or null when the Region has never been marked. */
export function regionAnyAnchorPage(region: Region): number | null {
  if (!validAnchorMap(region.pdf_anchor)) return null;
  const pages = Object.values(region.pdf_anchor.editions).flatMap((edition) =>
    edition.rects.map((rect) => rect.page),
  );
  return pages.length ? Math.min(...pages) : null;
}

export function movementForStoredStarts(
  movements: PieceMovement[],
  page: number,
): PieceMovement | null {
  return (
    [...movements]
      .filter((movement) => movement.start_page <= page)
      .sort(
        (a, b) =>
          b.start_page - a.start_page ||
          a.display_order - b.display_order ||
          a.id - b.id,
      )[0] ?? null
  );
}
