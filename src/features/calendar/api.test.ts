import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { calendarApi } from "./api";
import type {
  DailyWorkCreateArgs,
  DailyWorkPatch,
  RecoveryDecision,
} from "./types";

describe("calendarApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
  });

  it("list() maps to daily_work_list with the exact request shape", async () => {
    await calendarApi.list({
      from: "2026-07-01",
      to: "2026-07-31",
      pieceId: 3,
    });
    expect(invokeMock).toHaveBeenCalledWith("daily_work_list", {
      from: "2026-07-01",
      to: "2026-07-31",
      pieceId: 3,
    });
  });

  it("list() passes pieceId: null through unchanged (no piece filter)", async () => {
    await calendarApi.list({
      from: "2026-07-01",
      to: "2026-07-31",
      pieceId: null,
    });
    expect(invokeMock).toHaveBeenCalledWith("daily_work_list", {
      from: "2026-07-01",
      to: "2026-07-31",
      pieceId: null,
    });
  });

  it("create() wraps the create args in an { args } envelope", async () => {
    const args: DailyWorkCreateArgs = {
      goal_id: 1,
      region_id: null,
      block_id: null,
      title: "Warm-up",
      minutes: 10,
      date: "2026-07-16",
      source: "manual",
    };
    await calendarApi.create(args);
    // TODO: confirm the backend `daily_work_create` command actually expects an
    // { args: DailyWorkCreateArgs } envelope (not a flat spread like list()) —
    // this asymmetry with list()/update() is exactly the kind of thing a typo
    // or "consistency" refactor could silently break.
    expect(invokeMock).toHaveBeenCalledWith("daily_work_create", { args });
  });

  it("update() maps positional (id, expectedUpdatedTs, patch) into the named argument shape", async () => {
    const patch: DailyWorkPatch = { status: "done" };
    await calendarApi.update(7, "2026-07-15T10:00:00Z", patch);
    expect(invokeMock).toHaveBeenCalledWith("daily_work_update", {
      id: 7,
      expectedUpdatedTs: "2026-07-15T10:00:00Z",
      patch,
    });
  });

  it("delete() maps (id, expectedUpdatedTs) into the named argument shape", async () => {
    await calendarApi.delete(7, "2026-07-15T10:00:00Z");
    expect(invokeMock).toHaveBeenCalledWith("daily_work_delete", {
      id: 7,
      expectedUpdatedTs: "2026-07-15T10:00:00Z",
    });
  });

  it("recoveryPreview() calls recovery_preview with no arguments", async () => {
    await calendarApi.recoveryPreview();
    expect(invokeMock).toHaveBeenCalledWith("recovery_preview");
  });

  it("recoveryApply() maps decisions to recovery_apply, including an empty list", async () => {
    const decisions: RecoveryDecision[] = [
      {
        id: 1,
        expected_updated_ts: "2026-07-15T10:00:00Z",
        action: "move",
        date: "2026-07-17",
      },
    ];
    await calendarApi.recoveryApply(decisions);
    expect(invokeMock).toHaveBeenCalledWith("recovery_apply", { decisions });

    invokeMock.mockClear();
    await calendarApi.recoveryApply([]);
    // TODO: confirm an empty decisions array is a legitimate no-op call to the
    // backend rather than something the caller should short-circuit before invoking.
    expect(invokeMock).toHaveBeenCalledWith("recovery_apply", {
      decisions: [],
    });
  });

  it("setCapacity() maps minutes to calendar_capacity_set", async () => {
    await calendarApi.setCapacity(45);
    expect(invokeMock).toHaveBeenCalledWith("calendar_capacity_set", {
      minutes: 45,
    });
  });

  it.each([0, -1, 100000])(
    "setCapacity() passes boundary minute values (%i) through without client-side validation",
    async (minutes) => {
      await calendarApi.setCapacity(minutes);
      // TODO: decide whether zero/negative/huge capacity values should be rejected
      // client-side, or whether relying entirely on backend validation is intended.
      expect(invokeMock).toHaveBeenCalledWith("calendar_capacity_set", {
        minutes,
      });
    },
  );

  it("listPieces() calls pieces_list with no arguments", async () => {
    await calendarApi.listPieces();
    expect(invokeMock).toHaveBeenCalledWith("pieces_list");
  });

  it("listGoals() maps pieceId to goal_list", async () => {
    await calendarApi.listGoals(9);
    expect(invokeMock).toHaveBeenCalledWith("goal_list", { pieceId: 9 });
  });

  it("propagates a rejected invoke() call without swallowing the error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend unavailable"));
    await expect(calendarApi.recoveryPreview()).rejects.toThrow(
      "backend unavailable",
    );
  });

  it("resolves with whatever malformed/unexpected payload invoke() returns, unvalidated", async () => {
    invokeMock.mockResolvedValueOnce({ not: "a DailyWork[]" });
    const result = await calendarApi.list({
      from: "2026-07-01",
      to: "2026-07-31",
      pieceId: null,
    });
    // TODO: calendarApi performs no runtime shape validation on the IPC response —
    // decide whether callers (e.g. the calendar workspace) are expected to trust
    // the backend completely, or whether a malformed response here should be
    // caught before it reaches rendering code.
    expect(result).toEqual({ not: "a DailyWork[]" });
  });
});
