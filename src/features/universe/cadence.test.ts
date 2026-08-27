import { describe, expect, it } from "vitest";
import type { HistoryDaySummary } from "../ledger/historyDays";
import { buildCadenceWindow, cadenceBand } from "./cadence";

function row(date: string, focused_seconds: number): HistoryDaySummary {
  return {
    date,
    focused_seconds,
    session_count: 1,
    attempts: 0,
    cleans: 0,
    sets_touched: 0,
    mastered_sets: 0,
    pieces: [],
  };
}

describe("buildCadenceWindow", () => {
  it("fills every missing date in an inclusive 28-day trace window", () => {
    const cadence = buildCadenceWindow("2026-06-15", "2026-07-12", [
      row("2026-06-15", 60),
      row("2026-06-16", 12),
      row("2026-07-01", 1_800),
      row("2026-07-12", 3_600),
    ]);

    expect(cadence?.days).toHaveLength(28);
    expect(cadence?.days[0]).toMatchObject({
      date: "2026-06-15",
      completedMinutes: 1,
      band: "light",
    });
    expect(cadence?.days[1]).toMatchObject({
      date: "2026-06-16",
      focusedSeconds: 12,
      completedMinutes: 0,
      band: "light",
    });
    expect(cadence?.days[2]).toMatchObject({
      date: "2026-06-17",
      focusedSeconds: 0,
      band: "none",
    });
    expect(cadence?.days.at(-1)).toMatchObject({
      date: "2026-07-12",
      completedMinutes: 60,
      band: "peak",
    });
    expect(cadence).toMatchObject({ focusedSeconds: 5_472, activeDays: 4 });
  });

  it("uses the final 28 bounded dates when an older trace names 29", () => {
    const cadence = buildCadenceWindow("2026-06-19", "2026-07-17", [
      row("2026-06-19", 9_999),
      row("2026-06-20", 120),
    ]);
    expect(cadence?.days).toHaveLength(28);
    expect(cadence?.days[0].date).toBe("2026-06-20");
    expect(cadence?.focusedSeconds).toBe(120);
  });

  it("does not double-count duplicate, outside, malformed, or unsafe rows", () => {
    const cadence = buildCadenceWindow("2026-06-15", "2026-07-12", [
      row("2026-07-10", 60),
      row("2026-07-10", 120),
      row("2026-07-13", 3_600),
      row("not-a-date", 3_600),
      row("2026-07-11", Number.MAX_VALUE),
    ]);
    expect(cadence?.focusedSeconds).toBe(120);
    expect(cadence?.activeDays).toBe(1);
  });

  it("rejects invalid trace bounds instead of guessing dates", () => {
    expect(buildCadenceWindow("bad", "2026-07-12", [])).toBeNull();
    expect(buildCadenceWindow("2026-07-13", "2026-07-12", [])).toBeNull();
    expect(buildCadenceWindow("2026-02-30", "2026-03-20", [])).toBeNull();
  });
});

describe("cadenceBand", () => {
  it("publishes fixed, transparent completed-minute bands", () => {
    expect([0, 1, 14, 15, 29, 30, 59, 60].map(cadenceBand)).toEqual([
      "none",
      "light",
      "light",
      "medium",
      "medium",
      "strong",
      "strong",
      "peak",
    ]);
  });
});
