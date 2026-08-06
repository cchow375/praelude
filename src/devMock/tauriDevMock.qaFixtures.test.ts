import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import { todayLocal, addDays } from "../features/calendar/dates";
import type { DaySheet, GoalRefLine } from "../features/notebook/lines";
import type { Goal } from "../features/pieces/types";

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

  // Micro-fix (a) of the residuals fix wave: the "pin this goal to the
  // score" affordance (DaySheet.tsx's `renderGoal`) only renders when the
  // referenced goal's own text is non-empty (`pinText !== ""`) — an
  // interactive dev:mock session with an empty-text goal fixture left the
  // pin icon permanently absent, nothing to click to exercise it against.
  it("seeds today's goal reference pointing at a goal with real, non-empty text — the pin-to-score affordance is exercisable out of the box", async () => {
    const sheet = await seamInvoke<DaySheet | null>("day_sheet_get", {
      date: todayLocal(),
    });
    const goalRef = sheet!.body.find(
      (line): line is GoalRefLine => line.type === "goal_ref",
    );
    expect(goalRef).toBeDefined();

    const pieceLine = sheet!.body.find((line) => line.type === "piece");
    expect(pieceLine).toBeDefined();
    const pieceId = (pieceLine as { piece_id: number }).piece_id;

    const goals = await seamInvoke<Goal[]>("goal_list", { pieceId });
    const goal = goals.find((g) => g.id === goalRef!.goal_id);
    expect(goal).toBeDefined();
    expect(goal!.text.trim()).not.toBe("");
  });
});
