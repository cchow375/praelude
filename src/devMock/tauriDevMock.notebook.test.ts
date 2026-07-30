import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { DaySheet, PiecePlan } from "../features/notebook/lines";

// Exercises the dev-mock's stateful notebook handlers directly through the
// window.__TAURI_INTERNALS__ seam (the same real invoke path the hooks use),
// proving date/piece-keyed persistence, canonical re-serialization, and that
// validation failures reject the promise with a plain string.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock notebook handlers", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns null for a date with no saved sheet (blank each morning)", async () => {
    expect(
      await seamInvoke("day_sheet_get", { date: "2026-07-27" }),
    ).toBeNull();
  });

  it("saves then reloads a sheet, keyed by date", async () => {
    const body = JSON.stringify([
      { type: "text", text: "scales, then Chopin" },
    ]);
    const saved = await seamInvoke<DaySheet>("day_sheet_save", {
      date: "2026-07-27",
      bodyJson: body,
    });
    expect(saved.date).toBe("2026-07-27");
    expect(saved.body).toEqual([{ type: "text", text: "scales, then Chopin" }]);
    expect(typeof saved.updated_at).toBe("string");

    const reloaded = await seamInvoke<DaySheet>("day_sheet_get", {
      date: "2026-07-27",
    });
    expect(reloaded.body).toEqual(saved.body);
    // A different date is still blank — dates do not bleed into each other.
    expect(
      await seamInvoke("day_sheet_get", { date: "2026-07-28" }),
    ).toBeNull();
  });

  it("stores the CANONICAL body (checked defaulted, null optional dropped)", async () => {
    const saved = await seamInvoke<DaySheet>("day_sheet_save", {
      date: "2026-07-27",
      bodyJson: JSON.stringify([
        { type: "item", text: "octave run" },
        { type: "block", minutes: 25, piece_id: null },
      ]),
    });
    expect(saved.body).toEqual([
      { type: "item", text: "octave run", checked: false },
      { type: "block", minutes: 25 },
    ]);
  });

  it("rejects an unknown line type with a plain string", async () => {
    await expect(
      seamInvoke("day_sheet_save", {
        date: "2026-07-27",
        bodyJson: JSON.stringify([{ type: "doodle", text: "x" }]),
      }),
    ).rejects.toBe("unknown notebook line type: doodle");
  });

  it("round-trips a piece plan, keyed by piece id", async () => {
    const saved = await seamInvoke<PiecePlan>("piece_plan_save", {
      pieceId: 1,
      bodyText: "Phase 1: hands separate to 96 BPM",
    });
    expect(saved).toMatchObject({
      piece_id: 1,
      body_text: "Phase 1: hands separate to 96 BPM",
    });
    const reloaded = await seamInvoke<PiecePlan>("piece_plan_get", {
      pieceId: 1,
    });
    expect(reloaded.body_text).toBe("Phase 1: hands separate to 96 BPM");
    expect(await seamInvoke("piece_plan_get", { pieceId: 2 })).toBeNull();
  });

  it("rejects an over-length piece plan with a plain string", async () => {
    await expect(
      seamInvoke("piece_plan_save", {
        pieceId: 1,
        bodyText: "x".repeat(40001),
      }),
    ).rejects.toBe("piece plan exceeds 40000 characters");
  });

  // Regression: a goal promoted from the day sheet must re-resolve its text after
  // the sheet remounts (goalCache is empty then, so the text comes only from
  // goal_list). If goal_create did not feed goal_list the goal_ref would render
  // an empty "Goal" placeholder — the QA-reported mock bug.
  it("goal_create feeds goal_list so a promoted goal keeps its text", async () => {
    const created = await seamInvoke<{ id: number }>("goal_create", {
      args: { piece_id: 2, text: "clean the coda", kind: "big" },
    });
    const list = await seamInvoke<Array<{ id: number; text: string }>>(
      "goal_list",
      { pieceId: 2 },
    );
    const resolved = list.find((goal) => goal.id === created.id);
    expect(resolved).toBeTruthy();
    expect(resolved?.text).toBe("clean the coda");
  });
});
