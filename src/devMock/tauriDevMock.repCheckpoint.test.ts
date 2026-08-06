import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { MutationReceipt } from "../features/receipts/ReceiptCenter";
import type { RepSnapshot } from "../features/rep/useRep";

// Fix wave item 8: useRep.ts's 15s `rep_checkpoint` heartbeat had NO mock
// handler at all — the switch's `default: return null` resolved every call
// with `null` instead of a receipt, which (pre-fix) reached `receipt.status`
// on `null` and threw, surfacing as a repeating error toast in `dev:mock`.
// This pins the actual handler now committing a proper receipt.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock rep_checkpoint handling", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("commits a receipt carrying the current snapshot, not null", async () => {
    const receipt = await seamInvoke<MutationReceipt<RepSnapshot>>(
      "rep_checkpoint",
      { commandId: "test-checkpoint-1" },
    );
    expect(receipt).not.toBeNull();
    expect(receipt.status).toBe("committed");
    expect(receipt.value).not.toBeNull();
    expect(receipt.command_id).toBe("test-checkpoint-1");
  });

  it("accumulates checkpointed active_seconds across repeated calls", async () => {
    const first = await seamInvoke<MutationReceipt<RepSnapshot>>(
      "rep_checkpoint",
      { commandId: "test-checkpoint-a" },
    );
    const second = await seamInvoke<MutationReceipt<RepSnapshot>>(
      "rep_checkpoint",
      { commandId: "test-checkpoint-b" },
    );
    expect(second.value?.active_seconds).toBeGreaterThan(
      first.value?.active_seconds ?? 0,
    );
  });
});
