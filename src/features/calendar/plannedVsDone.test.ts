import { describe, expect, it } from "vitest";
import { mergePlannedVsDone } from "./plannedVsDone";
import type { DaySheet } from "../notebook/lines";
import type { HistoryDaySummary } from "../ledger/historyDays";

const WEEK = [
  "2026-07-13",
  "2026-07-14",
  "2026-07-15",
  "2026-07-16",
  "2026-07-17",
  "2026-07-18",
  "2026-07-19",
];

function sheet(date: string, minutes: number[]): DaySheet {
  return {
    date,
    body: minutes.map((m) => ({ type: "block", minutes: m, piece_id: 1 })),
    updated_at: "2026-07-13T00:00:00Z",
  };
}

function daySummary(
  date: string,
  focusedSeconds: number,
  attempts: number,
): HistoryDaySummary {
  return {
    date,
    focused_seconds: focusedSeconds,
    session_count: 1,
    attempts,
    cleans: attempts,
    sets_touched: 1,
    mastered_sets: 0,
    pieces: [],
  };
}

describe("mergePlannedVsDone", () => {
  it("produces exact planned/done numbers for a day with both a sheet and practice", () => {
    const sheets = [sheet("2026-07-15", [30, 15])];
    const days = [daySummary("2026-07-15", 38 * 60, 12)];

    const merged = mergePlannedVsDone(sheets, days, WEEK);

    expect(merged["2026-07-15"]).toEqual({
      plannedMinutes: 45,
      plannedItems: 2,
      doneMinutes: 38,
      attempts: 12,
    });
  });

  it("rounds doneMinutes from focused_seconds (not truncates)", () => {
    const days = [daySummary("2026-07-16", 90, 1)]; // 1.5 min
    const merged = mergePlannedVsDone([], days, WEEK);
    expect(merged["2026-07-16"].doneMinutes).toBe(2);
  });

  it("handles a date with a sheet but no practice evidence", () => {
    const sheets = [sheet("2026-07-17", [20])];
    const merged = mergePlannedVsDone(sheets, [], WEEK);
    expect(merged["2026-07-17"]).toEqual({
      plannedMinutes: 20,
      plannedItems: 1,
      doneMinutes: 0,
      attempts: 0,
    });
  });

  it("handles a date with practice but no sheet", () => {
    const days = [daySummary("2026-07-18", 25 * 60, 7)];
    const merged = mergePlannedVsDone([], days, WEEK);
    expect(merged["2026-07-18"]).toEqual({
      plannedMinutes: 0,
      plannedItems: 0,
      doneMinutes: 25,
      attempts: 7,
    });
  });

  it("returns an all-zero row for a date with neither", () => {
    const merged = mergePlannedVsDone([], [], WEEK);
    expect(merged["2026-07-19"]).toEqual({
      plannedMinutes: 0,
      plannedItems: 0,
      doneMinutes: 0,
      attempts: 0,
    });
  });

  it("ignores sheets/days outside the requested week dates", () => {
    const sheets = [sheet("2026-08-01", [999])];
    const days = [daySummary("2026-08-01", 999 * 60, 999)];
    const merged = mergePlannedVsDone(sheets, days, WEEK);
    expect(Object.keys(merged).sort()).toEqual([...WEEK].sort());
    expect(merged["2026-08-01"]).toBeUndefined();
  });

  it("ignores unchecked item lines and checked items — only block minutes count", () => {
    const withItems: DaySheet = {
      date: "2026-07-14",
      body: [
        { type: "block", minutes: 10, piece_id: 1 },
        { type: "item", text: "warm up", checked: false },
        { type: "item", text: "done already", checked: true },
      ],
      updated_at: "2026-07-13T00:00:00Z",
    };
    const merged = mergePlannedVsDone([withItems], [], WEEK);
    expect(merged["2026-07-14"].plannedMinutes).toBe(10);
    expect(merged["2026-07-14"].plannedItems).toBe(1);
  });
});
