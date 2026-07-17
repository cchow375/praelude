import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { CheckOutcome } from "../features/rep/useRep";

// The dev-mock's Clean/Sloppy/Again buttons call `rep_check`. Before this
// handler existed the seam returned null, so the HUD's `outcome.snap` read
// threw and the receipt landed RED — a lie in the static harness. This proves
// `rep_check` now returns a committed CheckOutcome consistent with `rep_state`.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock rep_check handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns a committed CheckOutcome consistent with the rep_state mock", async () => {
    const outcome = await seamInvoke<CheckOutcome>("rep_check", {
      verdict: "clean",
      note: null,
      commandId: "mock-cmd-1",
    });

    // Same active block as rep_state (block 102 / Development), so the HUD's
    // returned-snapshot fallback reconciles instead of throwing.
    expect(outcome.snap.block_id).toBe(102);
    expect(outcome.snap.last?.verdict).toBe("clean");
    expect(outcome.block_done).toBe(false);

    // A green receipt requires a committed MutationReceipt whose value is the
    // advanced snapshot and a non-null last_attempt_id for de-dupe keying.
    expect(outcome.receipt?.status).toBe("committed");
    expect(outcome.receipt?.command_id).toBe("mock-cmd-1");
    expect(outcome.receipt?.value?.block_id).toBe(102);
    expect(outcome.snap.last_attempt_id).not.toBeNull();
  });

  it("advances the attempt ledger and honours the requested verdict on each call", async () => {
    const first = await seamInvoke<CheckOutcome>("rep_check", {
      verdict: "clean",
      note: null,
      commandId: "a",
    });
    const second = await seamInvoke<CheckOutcome>("rep_check", {
      verdict: "flawed",
      note: "rushed",
      commandId: "b",
    });

    expect(second.snap.last?.verdict).toBe("flawed");
    // Distinct attempt ids so the receipt de-dupe does not swallow the second.
    expect(second.snap.last_attempt_id).not.toBe(first.snap.last_attempt_id);
    const firstTries = first.snap.attempts_recorded ?? 0;
    const secondTries = second.snap.attempts_recorded ?? 0;
    expect(secondTries).toBeGreaterThan(firstTries);
  });

  it("serves attempt rows for a ledger drill-in via reps_for_block", async () => {
    const reps = await seamInvoke<Array<{ block_id: number }>>(
      "reps_for_block",
      { blockId: 102 },
    );
    expect(Array.isArray(reps)).toBe(true);
    expect(reps.length).toBeGreaterThan(0);
    expect(reps.every((rep) => rep.block_id === 102)).toBe(true);
  });
});
