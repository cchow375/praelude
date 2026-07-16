import { describe, expect, it } from "vitest";
import {
  defaultSnoozeDate,
  isIsoDate,
  isValidSnoozeDate,
  nextIsoDate,
} from "./date";

describe("retention date boundaries", () => {
  it.each([
    ["2026-07-15", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-02-31", false],
    ["07/15/2026", false],
    ["", false],
  ])("validates %s without consulting ambient time", (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });

  it("advances dates across month and year boundaries", () => {
    expect(nextIsoDate("2026-07-31")).toBe("2026-08-01");
    expect(nextIsoDate("2026-12-31")).toBe("2027-01-01");
    expect(nextIsoDate("invalid")).toBe("");
  });

  it("requires snooze to move beyond the old due date and queue date", () => {
    expect(isValidSnoozeDate("2026-07-16", "2026-07-15", "2026-07-15")).toBe(true);
    expect(isValidSnoozeDate("2026-07-15", "2026-07-15", "2026-07-15")).toBe(false);
    expect(isValidSnoozeDate("2026-07-19", "2026-07-15", "2026-07-20")).toBe(false);
    expect(isValidSnoozeDate("2026-07-21", "2026-07-15", "2026-07-20")).toBe(true);
  });

  it("proposes tomorrow after the later of due and queue dates", () => {
    expect(defaultSnoozeDate("2026-07-10", "2026-07-15")).toBe("2026-07-16");
    expect(defaultSnoozeDate("2026-07-20", "2026-07-15")).toBe("2026-07-21");
  });
});
