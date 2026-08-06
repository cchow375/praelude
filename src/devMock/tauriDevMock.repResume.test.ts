import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { MutationReceipt } from "../features/receipts/ReceiptCenter";
import type { RepSnapshot } from "../features/rep/useRep";
import type { PausedSetRow } from "../features/rep/pausedSets";

// Task A4b fix round 1 (folded minor a): the mock's paused row now carries a
// `set_id` deliberately distinct from `MOCK_REP_STATE.block_id`, so a
// `rep_resume` call whose `setId` doesn't match it must be rejected — this
// is what would catch a frontend regression that dropped `setId` off the
// paused-sets tray's Resume call.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock rep_resume setId handling", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("rejects a resume whose setId does not match the paused mock row", async () => {
    await seamInvoke("rep_pause", { commandId: "test-pause" });
    const paused = await seamInvoke<PausedSetRow[]>("sets_paused_list");
    expect(paused).toHaveLength(1);
    const realSetId = paused[0].set_id;

    const receipt = await seamInvoke<MutationReceipt<RepSnapshot>>(
      "rep_resume",
      { commandId: "test-resume-mismatch", setId: realSetId + 1 },
    );
    expect(receipt.status).toBe("rejected");
    expect(receipt.error_detail).toBe("only a paused practice set can resume");

    // The mock's paused-sets store agrees nothing actually resumed.
    const stillPaused = await seamInvoke<PausedSetRow[]>("sets_paused_list");
    expect(stillPaused).toHaveLength(1);
    expect(stillPaused[0].set_id).toBe(realSetId);
  });

  it("accepts a resume whose setId matches the paused mock row", async () => {
    await seamInvoke("rep_pause", { commandId: "test-pause" });
    const paused = await seamInvoke<PausedSetRow[]>("sets_paused_list");
    const realSetId = paused[0].set_id;

    const receipt = await seamInvoke<MutationReceipt<RepSnapshot>>(
      "rep_resume",
      { commandId: "test-resume-match", setId: realSetId },
    );
    expect(receipt.status).toBe("committed");

    const afterResume = await seamInvoke<PausedSetRow[]>("sets_paused_list");
    expect(afterResume).toHaveLength(0);
  });

  it("accepts a resume with no setId at all (the rep HUD's own Resume chip)", async () => {
    await seamInvoke("rep_pause", { commandId: "test-pause" });

    const receipt = await seamInvoke<MutationReceipt<RepSnapshot>>(
      "rep_resume",
      { commandId: "test-resume-no-target" },
    );
    expect(receipt.status).toBe("committed");
  });
});
