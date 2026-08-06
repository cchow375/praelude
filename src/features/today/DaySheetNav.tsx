import { useState } from "react";
import { addDays, dayLabel, todayLocal } from "../calendar/dates";
import { carryLine } from "../notebook/carryForward";
import { TodayDaySheet, useTodaySheet } from "../notebook/DaySheetStore";
import type { BlockLine, ItemLine } from "../notebook/lines";
import { ReadOnlyDaySheet } from "../notebook/ReadOnlyDaySheet";
import "./DaySheetNav.css";

export interface DaySheetNavProps {
  /** A piece heading on the sheet opens its Score Plan tab, when wired. */
  onOpenPiece?: (pieceId: number) => void;
}

/**
 * Date navigation over the day sheet (spec A7). Today's page is the live,
 * editable, autosaved sheet (the shared `TodaySheetProvider` store, spec C5);
 * any other date is a read-only browse — its OWN `useDaySheet(date,
 * { readOnly: true })` instance that mounts no autosave and can never write
 * `day_sheet_save`. There is no future navigation: the right arrow disables
 * exactly at today. Both the browsed sheet and the live sheet are keyed on
 * `viewDate` so switching dates always remounts rather than leaving a stale
 * hook instance behind.
 */
export function DaySheetNav({ onOpenPiece }: DaySheetNavProps) {
  const [viewDate, setViewDate] = useState(todayLocal());
  const isToday = viewDate === todayLocal();
  const label = dayLabel(viewDate);

  // Carry-forward (spec A8): a carry is an ordinary edit to TODAY's sheet, so
  // it goes through the same shared `useTodaySheet()` store the live editor
  // renders from — an open editor sees the appended line immediately, and the
  // append is persisted through the identical debounced save/flush path (only
  // today's date is ever written; the browsed past sheet is untouched).
  const todaySheet = useTodaySheet();
  const carryToToday = (line: ItemLine | BlockLine) => {
    const carried = carryLine(line, viewDate);
    todaySheet.setBody((prev) => [...prev, carried]);
    todaySheet.flush();
  };

  const goToPrevDay = () => setViewDate((current) => addDays(current, -1));
  const goToNextDay = () => {
    if (isToday) return;
    setViewDate((current) => addDays(current, 1));
  };
  const goToToday = () => setViewDate(todayLocal());

  return (
    <div className="day-sheet-nav">
      <header className="day-sheet-nav-head">
        <button
          type="button"
          className="day-sheet-nav-arrow"
          aria-label="Previous day"
          onClick={goToPrevDay}
        >
          ‹
        </button>
        <span className="day-sheet-nav-label" data-testid="day-sheet-nav-label">
          {label.weekday} · {label.date}
        </span>
        <button
          type="button"
          className="day-sheet-nav-arrow"
          aria-label="Next day"
          disabled={isToday}
          onClick={goToNextDay}
        >
          ›
        </button>
        {!isToday && (
          <button
            type="button"
            className="day-sheet-nav-today"
            onClick={goToToday}
          >
            Today
          </button>
        )}
      </header>

      {isToday ? (
        <TodayDaySheet onOpenPiece={onOpenPiece} />
      ) : (
        <ReadOnlyDaySheet
          key={viewDate}
          date={viewDate}
          onOpenPiece={onOpenPiece}
          onCarry={carryToToday}
        />
      )}
    </div>
  );
}
