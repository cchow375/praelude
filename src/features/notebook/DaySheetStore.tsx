import { createContext, useContext, type ReactNode } from "react";
import { todayLocal } from "../calendar/dates";
import { DaySheetView } from "./DaySheet";
import { useDaySheet, type UseDaySheet } from "./useDaySheet";

// TODAY's sheet is a single shared store (spec C3/C5): the day-sheet editor in
// the Today's-Practice window and the Score "Plan" tab are two VIEWS over the
// same in-memory document, so an edit in one appears live in the other with no
// duplicate state and no round-trip. One `useDaySheet(today)` instance lives in
// this provider; every consumer reads and writes through it. Past-date sheets
// (the Calendar) deliberately stay independent — they use `<DaySheet date=…/>`
// with their own hook, because they are different documents.

const TodaySheetContext = createContext<UseDaySheet | null>(null);

/** Owns the one shared `useDaySheet(today)` instance for the whole app. */
export function TodaySheetProvider({ children }: { children: ReactNode }) {
  const sheet = useDaySheet(todayLocal());
  return (
    <TodaySheetContext.Provider value={sheet}>
      {children}
    </TodaySheetContext.Provider>
  );
}

/** The shared today sheet. Throws if used outside <TodaySheetProvider>. */
export function useTodaySheet(): UseDaySheet {
  const sheet = useContext(TodaySheetContext);
  if (!sheet) {
    throw new Error("useTodaySheet must be used within a TodaySheetProvider");
  }
  return sheet;
}

/** The full day-sheet editor bound to the shared today store (spec C5). */
export function TodayDaySheet({
  onOpenPiece,
}: {
  onOpenPiece?: (pieceId: number) => void;
}) {
  const sheet = useTodaySheet();
  return (
    <DaySheetView date={todayLocal()} sheet={sheet} onOpenPiece={onOpenPiece} />
  );
}
