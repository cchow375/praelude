import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import { todayLocal, addDays } from "../features/calendar/dates";
import type { DaySheet } from "../features/notebook/lines";

// Fix wave item 12: `DAY_SHEETS` starts genuinely empty by default (every
// other suite in this repo relies on that), so the QA fixtures are opt-in via
// `installTauriDevMock({ seedQaFixtures: true })` — exercised only by the
// real interactive `dev:mock` entry point (main.tsx), never by a test's own
// `installTauriDevMock()` call. These tests pin BOTH halves of that contract.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

afterEach(() => uninstallTauriDevMock());

describe("dev-mock QA fixtures — default install (fix wave item 12)", () => {
  it("stays genuinely empty when seedQaFixtures is not requested (test-suite default)", async () => {
    installTauriDevMock();
    const today = await seamInvoke<DaySheet | null>("day_sheet_get", {
      date: todayLocal(),
    });
    expect(today).toBeNull();
  });
});

describe("dev-mock QA fixtures — seedQaFixtures: true (interactive dev:mock)", () => {
  beforeEach(() => installTauriDevMock({ seedQaFixtures: true }));

  it("seeds yesterday with 2 unchecked items and a 25-min block", async () => {
    const yesterday = addDays(todayLocal(), -1);
    const sheet = await seamInvoke<DaySheet | null>("day_sheet_get", {
      date: yesterday,
    });
    expect(sheet).not.toBeNull();
    const unchecked = sheet!.body.filter(
      (line) => line.type === "item" && !line.checked,
    );
    expect(unchecked).toHaveLength(2);
    const blocks = sheet!.body.filter((line) => line.type === "block");
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { minutes: number }).minutes).toBe(25);
  });

  it("seeds today with a timed (minute-labeled) line and a goal reference", async () => {
    const sheet = await seamInvoke<DaySheet | null>("day_sheet_get", {
      date: todayLocal(),
    });
    expect(sheet).not.toBeNull();
    const blocks = sheet!.body.filter((line) => line.type === "block");
    expect(blocks).toHaveLength(1);
    const goalRefs = sheet!.body.filter((line) => line.type === "goal_ref");
    expect(goalRefs).toHaveLength(1);
  });
});
