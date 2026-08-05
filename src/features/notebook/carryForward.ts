import { dayLabel } from "../calendar/dates";
import type { BlockLine, ItemLine } from "./lines";

// Carry-forward (spec A8): a pure transform from a past sheet's line to the
// copy that gets appended to TODAY's sheet. Never touches the past sheet, and
// never talks to the backend itself — the caller appends the result through
// today's own useDaySheet append/save path.

const PROVENANCE_MARKER = " · from ";

/**
 * Returns a COPY of `line`, ready to append to today's sheet.
 *
 * `ItemLine`: reset to `checked: false`; the text gets a
 * `" · from <Mon D>"` suffix (derived from `dayLabel`, e.g. "Aug 4") UNLESS it
 * already carries a provenance marker — a line carried a second time is left
 * as-is rather than stacking suffixes. Carrying the SAME source line twice
 * (two separate calls) still appends TWICE; there is no cross-call dedup —
 * that's an explicit, visible choice left to Christian each day.
 *
 * `BlockLine`: has no text field (lines.ts:25–29), so it is appended
 * verbatim (minutes/piece_id unchanged) and provenance is skipped for it.
 */
export function carryLine(
  line: ItemLine | BlockLine,
  fromDate: string,
): ItemLine | BlockLine {
  if (line.type === "block") {
    return { ...line };
  }
  const alreadyCarried = line.text.includes(PROVENANCE_MARKER);
  const text = alreadyCarried
    ? line.text
    : `${line.text}${PROVENANCE_MARKER}${dayLabel(fromDate).date}`;
  return { ...line, checked: false, text };
}
