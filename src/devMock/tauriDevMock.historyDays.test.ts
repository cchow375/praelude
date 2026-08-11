import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import { todayLocal, addDays } from "../features/calendar/dates";
import type {
  HistoryDayDetail,
  HistoryDaySummary,
} from "../features/ledger/historyDays";
import type { DaySheet } from "../features/notebook/lines";

// Task B1/B2's `history_days` / `history_day_detail` / `day_sheets_range`
// date-range filtering (`withinRange`) and sort order have ZERO coverage
// through the real dev mock: DayTimeline.test.tsx, LedgerWorkspace.test.tsx
// and calendar/api.test.ts all stub `@tauri-apps/api/core` with `vi.mock`
// instead, so this file's own filter/sort logic never runs in any existing
// suite even though it backs the just-shipped day-timeline default view.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock history day-timeline handlers", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("history_days filters to the requested [from, to] range and sorts newest-first", async () => {
    const today = todayLocal();
    const from = addDays(today, -3);
    const days = await seamInvoke<HistoryDaySummary[]>("history_days", {
      from,
      to: today,
    });
    // Only TODAY and the -2-day fixture fall inside a 3-day-back window.
    expect(days.every((day) => day.date >= from && day.date <= today)).toBe(
      true,
    );
    expect(days.length).toBeGreaterThan(0);
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i - 1].date >= days[i].date).toBe(true);
    }
  });

  it("history_days excludes the dense 150-day-back fixture from a 120-day default window", async () => {
    const today = todayLocal();
    const from = addDays(today, -120);
    const days = await seamInvoke<HistoryDaySummary[]>("history_days", {
      from,
      to: today,
    });
    expect(days.every((day) => day.date >= from)).toBe(true);
  });

  it("history_days reaches the dense fixture once the window is widened past 150 days", async () => {
    const today = todayLocal();
    const from = addDays(today, -160);
    const days = await seamInvoke<HistoryDaySummary[]>("history_days", {
      from,
      to: today,
    });
    const dense = days.find((day) => (day.sets_touched ?? 0) === 50);
    expect(dense).toBeDefined();
  });

  it("history_day_detail returns sessions/sets for a known date and an empty shell for an unknown one", async () => {
    const today = todayLocal();
    const detail = await seamInvoke<HistoryDayDetail>("history_day_detail", {
      date: today,
    });
    expect(detail.date).toBe(today);
    expect(detail.sessions.length).toBeGreaterThan(0);
    expect(detail.sets.length).toBeGreaterThan(0);

    const unknown = await seamInvoke<HistoryDayDetail>("history_day_detail", {
      date: "1999-01-01",
    });
    expect(unknown).toEqual({ date: "1999-01-01", sessions: [], sets: [] });
  });

  it("day_sheets_range filters saved day sheets to the requested range, sorted oldest-first", async () => {
    const today = todayLocal();
    const yesterday = addDays(today, -1);
    const older = addDays(today, -10);
    await seamInvoke("day_sheet_save", {
      date: yesterday,
      bodyJson: JSON.stringify([{ type: "text", text: "y" }]),
    });
    await seamInvoke("day_sheet_save", {
      date: older,
      bodyJson: JSON.stringify([{ type: "text", text: "o" }]),
    });

    const inRange = await seamInvoke<DaySheet[]>("day_sheets_range", {
      from: yesterday,
      to: today,
    });
    expect(inRange.map((sheet) => sheet.date)).toEqual([yesterday]);

    const wideRange = await seamInvoke<DaySheet[]>("day_sheets_range", {
      from: older,
      to: today,
    });
    expect(wideRange.map((sheet) => sheet.date)).toEqual([older, yesterday]);
  });
});
