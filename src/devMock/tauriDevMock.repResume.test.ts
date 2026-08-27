import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { MutationReceipt } from "../features/receipts/ReceiptCenter";
import type { RepSnapshot } from "../features/rep/useRep";
import type { PausedSetRow } from "../features/rep/pausedSets";

// A targeted `rep_resume` must name a real paused row. This catches a frontend
// regression that substitutes some other set id while keeping the mock
// faithful to native: the paused row uses the actual current block id.

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

  it("pauses and target-resumes a newly opened custom set by its real block id", async () => {
    const opened = await seamInvoke<RepSnapshot>("rep_open", {
      args: {
        piece_id: 7,
        m_start: 44,
        m_end: 46,
        label: "Rolled Chords · Spot 1",
        start_bpm: 60,
        target_bpm: 96,
        required_clean_streak: 3,
        variants: [],
        focus: "tempo",
        use_metronome: true,
      },
      context: null,
    });
    await seamInvoke("rep_pause", { commandId: "custom-pause" });
    const paused = await seamInvoke<PausedSetRow[]>("sets_paused_list");
    expect(paused.some((row) => row.set_id === opened.block_id)).toBe(true);

    const receipt = await seamInvoke<MutationReceipt<RepSnapshot>>(
      "rep_resume",
      { commandId: "custom-resume", setId: opened.block_id },
    );
    expect(receipt.status).toBe("committed");
    expect(receipt.value?.block_id).toBe(opened.block_id);
    expect(receipt.value?.timer_state).toBe("active");
  });
});
