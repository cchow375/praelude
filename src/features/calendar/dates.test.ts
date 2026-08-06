import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  dayLabel,
  formatLocalDate,
  parseLocalDate,
  startOfWeek,
  todayLocal,
  weekLabel,
} from "./dates";

afterEach(() => {
  vi.useRealTimers();
});

describe("parseLocalDate", () => {
  it("parses a YYYY-MM-DD string into a local Date anchored at noon", () => {
    const date = parseLocalDate("2026-07-15");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(6); // 0-indexed: July
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(12);
  });

  it("throws on an invalid/malformed date string", () => {
    expect(() => parseLocalDate("not-a-date")).toThrow(
      "Invalid local date: not-a-date",
    );
    expect(() => parseLocalDate("2026-7-15")).toThrow(); // not zero-padded
    expect(() => parseLocalDate("2026/07/15")).toThrow();
    expect(() => parseLocalDate("")).toThrow();
  });
});

describe("formatLocalDate", () => {
  it("formats a Date back into zero-padded YYYY-MM-DD", () => {
    expect(formatLocalDate(new Date(2026, 6, 15, 12))).toBe("2026-07-15");
  });

  it("pads single-digit months and days", () => {
    expect(formatLocalDate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});

describe("addDays", () => {
  it("adds days within the same month", () => {
    expect(addDays("2026-07-15", 3)).toBe("2026-07-18");
  });

  it("crosses a month boundary going forward", () => {
    expect(addDays("2026-07-30", 3)).toBe("2026-08-02");
  });

  it("crosses a year boundary going forward", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("subtracts days with a negative amount, crossing a month boundary", () => {
    expect(addDays("2026-07-01", -3)).toBe("2026-06-28");
  });

  it("subtracts days with a negative amount, crossing a year boundary", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("is a no-op with an amount of zero", () => {
    expect(addDays("2026-07-15", 0)).toBe("2026-07-15");
  });

  // Local-time-safety regression (spec A7): addDays must operate on Date PARTS
  // via a local Date, never Date.parse/ISO, or a US DST transition shifts the
  // result by a day in whichever TZ the test runs in.
  it("crosses the US spring-forward DST boundary without an off-by-one", () => {
    // 2026-03-08 is the day before US DST begins (2026-03-09).
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("crosses the US fall-back DST boundary without an off-by-one", () => {
    // 2026-11-01 is the day before US DST ends (2026-11-02).
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });
});

describe("startOfWeek", () => {
  it("rolls a Sunday back to the preceding Monday", () => {
    // 2026-07-19 is a Sunday.
    expect(startOfWeek("2026-07-19")).toBe("2026-07-13");
  });

  it("returns the same date when it is already Monday", () => {
    // 2026-07-13 is a Monday.
    expect(startOfWeek("2026-07-13")).toBe("2026-07-13");
  });

  it("rolls midweek days back to Monday", () => {
    // 2026-07-15 is a Wednesday.
    expect(startOfWeek("2026-07-15")).toBe("2026-07-13");
  });

  it("crosses a month boundary backward when the Monday falls in the prior month", () => {
    // 2026-08-01 is a Saturday; the preceding Monday is in July.
    expect(startOfWeek("2026-08-01")).toBe("2026-07-27");
  });

  it("crosses a year boundary backward when the Monday falls in the prior year", () => {
    // 2027-01-01 is a Friday; the preceding Monday is in December 2026.
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
  });
});

describe("todayLocal", () => {
  it("returns the current local date formatted as YYYY-MM-DD", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 9, 30));
    expect(todayLocal()).toBe("2026-07-15");
  });

  it("tracks a different fixed system date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 0, 1, 23, 59));
    expect(todayLocal()).toBe("2027-01-01");
  });
});

describe("dayLabel", () => {
  it("returns the short weekday and short month/day for a date", () => {
    // 2026-07-15 is a Wednesday.
    expect(dayLabel("2026-07-15")).toEqual({ weekday: "Wed", date: "Jul 15" });
  });

  it("reflects a different weekday for a different date", () => {
    // 2026-07-19 is a Sunday.
    expect(dayLabel("2026-07-19")).toEqual({ weekday: "Sun", date: "Jul 19" });
  });

  it("throws when given an invalid date string", () => {
    expect(() => dayLabel("bad-date")).toThrow();
  });
});

describe("weekLabel", () => {
  it("formats a start/end range with the year only on the end date", () => {
    expect(weekLabel("2026-07-13", "2026-07-19")).toBe("Jul 13 – Jul 19, 2026");
  });

  it("formats a range spanning a month boundary", () => {
    expect(weekLabel("2026-07-27", "2026-08-02")).toBe("Jul 27 – Aug 2, 2026");
  });

  it("formats a range spanning a year boundary", () => {
    expect(weekLabel("2026-12-28", "2027-01-03")).toBe("Dec 28 – Jan 3, 2027");
  });

  it("throws when either endpoint is an invalid date string", () => {
    expect(() => weekLabel("bad", "2026-07-19")).toThrow();
    expect(() => weekLabel("2026-07-13", "bad")).toThrow();
  });
});
