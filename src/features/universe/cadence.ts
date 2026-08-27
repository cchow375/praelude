import type { HistoryDaySummary } from "../ledger/historyDays";

export type CadenceBand = "none" | "light" | "medium" | "strong" | "peak";

export interface CadenceDay {
  date: string;
  focusedSeconds: number;
  completedMinutes: number;
  band: CadenceBand;
}

export interface CadenceWindow {
  days: CadenceDay[];
  focusedSeconds: number;
  activeDays: number;
}

const DAY_MS = 86_400_000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateKey(value: string): number | null {
  const match = DATE_KEY.exec(value);
  if (!match) return null;
  const stamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return formatDateKey(stamp) === value ? stamp : null;
}

function formatDateKey(stamp: number): string {
  return new Date(stamp).toISOString().slice(0, 10);
}

function focusedSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  const completed = Math.floor(value);
  return Number.isSafeInteger(completed) ? completed : 0;
}

export function cadenceBand(completedMinutes: number): CadenceBand {
  if (completedMinutes <= 0) return "none";
  if (completedMinutes < 15) return "light";
  if (completedMinutes < 30) return "medium";
  if (completedMinutes < 60) return "strong";
  return "peak";
}

/**
 * Build the final 28 dates inside the snapshot's own inclusive trace window.
 * `history_days` omits quiet dates, so every missing date is filled with an
 * explicit zero; duplicate or malformed rows can never double-count work.
 */
export function buildCadenceWindow(
  traceStart: string,
  traceEnd: string,
  rows: readonly HistoryDaySummary[],
): CadenceWindow | null {
  const start = parseDateKey(traceStart);
  const end = parseDateKey(traceEnd);
  if (start == null || end == null || start > end) return null;

  const finalStart = Math.max(start, end - 27 * DAY_MS);
  const rowSeconds = new Map<string, number>();
  for (const row of rows) {
    const stamp = parseDateKey(row.date);
    if (stamp == null || stamp < finalStart || stamp > end) continue;
    const seconds = focusedSeconds(row.focused_seconds);
    rowSeconds.set(row.date, Math.max(rowSeconds.get(row.date) ?? 0, seconds));
  }

  const days: CadenceDay[] = [];
  for (let stamp = finalStart; stamp <= end; stamp += DAY_MS) {
    const date = formatDateKey(stamp);
    const seconds = rowSeconds.get(date) ?? 0;
    const completedMinutes = Math.floor(seconds / 60);
    days.push({
      date,
      focusedSeconds: seconds,
      completedMinutes,
      band: seconds > 0 ? cadenceBand(Math.max(1, completedMinutes)) : "none",
    });
  }

  return {
    days,
    focusedSeconds: days.reduce((sum, day) => sum + day.focusedSeconds, 0),
    activeDays: days.filter((day) => day.focusedSeconds > 0).length,
  };
}
