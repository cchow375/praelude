import { describe, expect, it, vi } from "vitest";
import type { CommandInvoker } from "../../services/command";
import type { MutationReceipt } from "../receipts/ReceiptCenter";
import { createRetentionApi } from "./api";
import type { RetentionCheckView, RetentionResult } from "./types";

const check: RetentionCheckView = {
  id: 8,
  region_id: 12,
  source_set_id: 3,
  due_date: "2026-07-15",
  original_due_date: "2026-07-15",
  condition: { bpm: 96 },
  state: "due",
  result: null,
  completed_ts: null,
  created_ts: "2026-07-14T10:00:00Z",
  updated_ts: "2026-07-14T10:00:00Z",
};

const receipt: MutationReceipt<RetentionCheckView> = {
  receipt_id: "receipt-8",
  command_id: "command-8",
  status: "committed",
  summary: "Retention check updated.",
  value: check,
  entity_refs: [{ entity_type: "retention_check", entity_id: 8 }],
  event_ids: [80],
  replayed: false,
  committed_ts: "2026-07-15T10:00:00Z",
};

describe("retention native API", () => {
  it("maps typed calls to the exact native command argument shapes", async () => {
    const invoker = vi.fn<CommandInvoker>()
      .mockResolvedValueOnce([check])
      .mockResolvedValue(receipt);
    const api = createRetentionApi(invoker);
    const result: RetentionResult = {
      decision: "confirm_retained",
      note: "Held without rebuilding.",
      checked_as_of: "2026-07-15",
    };

    await api.due("2026-07-15");
    await api.snooze("command-s", 8, "2026-07-16");
    await api.confirm("command-c", 8, result);
    await api.lower("command-l", 8, { ...result, decision: "lower_working_condition" });
    await api.reopen("command-r", 8, { ...result, decision: "reopen_target" });

    expect(invoker.mock.calls).toEqual([
      ["retention_due", { asOfDate: "2026-07-15" }],
      ["retention_snooze", { commandId: "command-s", checkId: 8, dueDate: "2026-07-16" }],
      ["retention_confirm", { commandId: "command-c", checkId: 8, result }],
      ["retention_lower", {
        commandId: "command-l",
        checkId: 8,
        result: { ...result, decision: "lower_working_condition" },
      }],
      ["retention_reopen", {
        commandId: "command-r",
        checkId: 8,
        result: { ...result, decision: "reopen_target" },
      }],
    ]);
  });
});
