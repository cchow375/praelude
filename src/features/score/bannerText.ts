// The score goals banner's one shared rule: how long a banner may be, and how
// arbitrary text (a pinned day-sheet goal line) is cut down to fit.
//
// Pure on purpose — the Score banner and the day sheet's "pin to score" both
// import it, so neither can drift from the 140-character bound that Rust
// (`validate_banner_text`) and the `piece.banner_text` CHECK constraint enforce.

/** Mirrors `BANNER_MAX_CHARS` in src-tauri/src/lib.rs and the v14 CHECK. */
export const BANNER_MAX_CHARS = 140;

/**
 * Fit `text` inside the banner bound. Longer text is cut and ends in an
 * ellipsis, so the total is still exactly `BANNER_MAX_CHARS` characters and the
 * cut is visible rather than silent.
 *
 * Counts CODE POINTS, not UTF-16 units: Rust counts `chars()` and SQLite's
 * `length()` counts characters, so a `String.length` cut could hand the backend
 * a value it rejects.
 */
export function truncateBanner(text: string): string {
  const chars = Array.from(text.trim());
  if (chars.length <= BANNER_MAX_CHARS) return chars.join("");
  return `${chars.slice(0, BANNER_MAX_CHARS - 1).join("")}…`;
}
