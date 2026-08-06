import type { DaySheet } from "../notebook/lines";
import type { HistoryDaySummary } from "../ledger/historyDays";
import { planTotals } from "../notebook/planTotals";

// ---------------------------------------------------------------------------
// Task B3: the Calendar's planned-vs-done day cells merge two independent read
// models — a date's day sheet (the plan) and its history day summary (the
// practice truth) — into one row per visible date. Pure function, no I/O: the
// caller fetches both lists once per visible week and hands them here.
// ---------------------------------------------------------------------------

/** One date's planned-vs-done row for the Calendar week strip. */
export interface PlannedVsDoneDay {
  /** Σ BlockLine.minutes on that date's day sheet (reuses `planTotals`). */
  plannedMinutes: number;
  /** Count of timed (BlockLine) entries on that date's day sheet. */
  plannedItems: number;
  /** `round(focused_seconds / 60)` from that date's history day summary. */
  doneMinutes: number;
  /** Attempts recorded that date, straight off the history day summary. */
  attempts: number;
}

/**
 * Merge a week's day sheets and history day summaries into one row per date
 * in `weekDates`. A date with neither a sheet nor practice evidence still
 * gets an entry — all zeros — so the caller decides how to render "neither"
 * rather than this function silently dropping the date.
 */
export function mergePlannedVsDone(
  sheets: DaySheet[],
  days: HistoryDaySummary[],
  weekDates: string[],
): Record<string, PlannedVsDoneDay> {
  const sheetsByDate = new Map(sheets.map((sheet) => [sheet.date, sheet]));
  const daysByDate = new Map(days.map((day) => [day.date, day]));
  const result: Record<string, PlannedVsDoneDay> = {};
  for (const date of weekDates) {
    const sheet = sheetsByDate.get(date);
    const day = daysByDate.get(date);
    const totals = sheet ? planTotals(sheet.body) : null;
    result[date] = {
      plannedMinutes: totals?.minutes ?? 0,
      plannedItems: totals?.timedLines ?? 0,
      doneMinutes: day ? Math.round(day.focused_seconds / 60) : 0,
      attempts: day?.attempts ?? 0,
    };
  }
  return result;
}
