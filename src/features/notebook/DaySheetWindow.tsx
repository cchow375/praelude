import { useEffect, useRef, type KeyboardEvent } from "react";
import { dayLabel } from "../calendar/dates";
import { CloseIcon } from "../today/menuIcons";
import { DaySheet } from "./DaySheet";
import "./DaySheetWindow.css";

export interface DaySheetWindowProps {
  /** The calendar date whose sheet is shown (its own standalone store). */
  date: string;
  /** Dismisses the window (Esc or the ×). */
  onClose: () => void;
  /** A piece heading on the sheet opens the piece elsewhere, if wired. */
  onOpenPiece?: (pieceId: number) => void;
}

/**
 * A past (or any) day's sheet, opened as a window over the Calendar (spec C1/C3,
 * ledger 3/11). It renders the STANDALONE `<DaySheet date=…/>` — its own store —
 * because a past day is a different document from today's shared sheet; editing
 * it here saves that date's page without touching today. Esc or the × closes it.
 */
export function DaySheetWindow({
  date,
  onClose,
  onOpenPiece,
}: DaySheetWindowProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const label = dayLabel(date);

  useEffect(() => {
    const raf = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // Let a nested surface (a picker popover) claim Escape first.
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="day-sheet-overlay">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Day sheet — ${label.weekday} ${label.date}`}
        tabIndex={-1}
        className="day-sheet-window"
        data-testid="day-sheet-window"
        onKeyDown={onKeyDown}
      >
        <header className="day-sheet-window-head">
          <div>
            <p className="today-date">
              {label.weekday} · {label.date}
            </p>
            <h1>Day sheet</h1>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="day-sheet-window-close"
            aria-label="Close day sheet"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="day-sheet-window-body">
          <DaySheet date={date} onOpenPiece={onOpenPiece} />
        </div>
      </div>
    </div>
  );
}
