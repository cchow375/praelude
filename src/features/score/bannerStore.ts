// The score goals banner's cross-surface store (A11, fix round 1).
//
// Two surfaces write the same banner: the Score strip itself and the day
// sheet's "pin to score". The Shell keeps a visited workspace MOUNTED but
// hidden, so a ScoreBanner that has already loaded piece X is still alive while
// Christian pins a new goal for X from Today — and its mount-time `piece_get`
// will never run again. Without this store the strip shows yesterday's sentence
// until the piece is reselected or the app restarts.
//
// Same spirit as `DaySheetStore`: one shared thing that both views read and
// write, rather than each view re-fetching. It is deliberately a module-level
// publish/subscribe with NO retained snapshot: a mounting ScoreBanner already
// reads the truth from `piece_get`, so a cached copy would only add a second
// source of truth (and would leak between tests). What is missing is purely the
// notification, so that is all this provides.

/** Called with the piece's new banner text (`null` = the banner was cleared). */
export type BannerListener = (text: string | null) => void;

const listeners = new Map<number, Set<BannerListener>>();

/**
 * Listen for banner changes to one piece. Returns the unsubscribe function.
 *
 * Only changes published AFTER subscribing are delivered — subscribing never
 * replays, so a freshly mounted banner shows what the backend gave it.
 */
export function subscribeBanner(
  pieceId: number,
  listener: BannerListener,
): () => void {
  let forPiece = listeners.get(pieceId);
  if (!forPiece) {
    forPiece = new Set();
    listeners.set(pieceId, forPiece);
  }
  forPiece.add(listener);
  return () => {
    const current = listeners.get(pieceId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(pieceId);
  };
}

/**
 * Announce that this piece's banner is now `text`. Call it after a write to
 * `piece_banner_set` has SUCCEEDED, from whichever surface made the write, with
 * the text the backend actually stored.
 *
 * Synchronous: every mounted banner for the piece re-renders in the same commit
 * as the caller's own state updates, so nothing has to refetch or remount.
 */
export function publishBanner(pieceId: number, text: string | null): void {
  const forPiece = listeners.get(pieceId);
  if (!forPiece) return;
  // Copy first: a listener may unsubscribe (unmount) while we are notifying.
  for (const listener of [...forPiece]) listener(text);
}
