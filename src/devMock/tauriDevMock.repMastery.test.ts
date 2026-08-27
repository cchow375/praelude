import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { RepSnapshot } from "../features/rep/useRep";

// B2 offline-QA gap. The mock used to hold `mastery_status` at
// "not_satisfied" no matter how many cleans landed, and verdict/read receipts
// could re-stamp stale timer or ledger fields. Between them, NOTHING that only
// exists on a finished, running set could be reached reliably in a browser:
// the completion banner included. That is the same blind spot B82 lived in,
// so the whole current-snapshot contract is pinned here.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

interface MockCheckOutcome {
  snap: RepSnapshot;
  block_done: boolean;
}

async function checkOutcome(
  verdict: string,
  id: string,
): Promise<MockCheckOutcome> {
  return seamInvoke<MockCheckOutcome>("rep_check", {
    verdict,
    note: null,
    commandId: id,
  });
}

/** rep_check returns a CheckOutcome; most tests need only its snapshot. */
async function check(verdict: string, id: string): Promise<RepSnapshot> {
  return (await checkOutcome(verdict, id)).snap;
}

async function clean(n: number): Promise<RepSnapshot> {
  return (await cleanOutcome(n)).snap;
}

async function cleanOutcome(n: number): Promise<MockCheckOutcome> {
  let outcome!: MockCheckOutcome;
  for (let i = 0; i < n; i += 1) {
    outcome = await checkOutcome("clean", `mock-clean-${i}`);
  }
  return outcome;
}

async function openVariantChain(requiredCleanStreak = 1): Promise<RepSnapshot> {
  return seamInvoke<RepSnapshot>("rep_open", {
    args: {
      piece_id: 1,
      region_id: null,
      m_start: 1,
      m_end: 8,
      label: null,
      start_bpm: 60,
      target_bpm: null,
      planned_reps: null,
      // Deliberately smaller than a stage requirement: the ordinary streak
      // must never declare a chained set mastered midway through stage one.
      required_clean_streak: requiredCleanStreak,
      variants: [
        { name: "dotted", reps: 9, clean_streak: 2 },
        // Legacy payload compatibility: absent clean_streak falls back to reps.
        { name: "staccato", reps: 2 },
      ],
      focus: "tempo",
      use_metronome: true,
    },
    context: null,
  });
}

describe("dev-mock rep mastery", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  /** The fixture opens mid-set, so the number of cleans still owed is derived
   * rather than hardcoded — a fixture tweak must not silently make these
   * tests assert nothing. */
  async function cleansOwed(): Promise<number> {
    const state = await seamInvoke<RepSnapshot>("rep_state");
    const required =
      state.effective_required_clean_streak ??
      state.required_clean_streak ??
      5;
    return Math.max(1, required - (state.current_clean_streak ?? 0));
  }

  it("stays unsatisfied one clean short of the requirement", async () => {
    const owed = await cleansOwed();
    const snap = owed > 1 ? await clean(owed - 1) : await seamInvoke<RepSnapshot>("rep_state");
    expect(snap.mastery_status).toBe("not_satisfied");
  });

  it("reaches satisfied once the streak meets the requirement", async () => {
    const outcome = await cleanOutcome(await cleansOwed());
    const snap = outcome.snap;
    expect(snap.current_clean_streak).toBeGreaterThanOrEqual(
      snap.effective_required_clean_streak ?? snap.required_clean_streak ?? 5,
    );
    expect(
      snap.mastery_status,
      "a set that can never finish cannot be QA'd offline",
    ).toBe("satisfied");
    expect(
      outcome.block_done,
      "the mock CheckOutcome must agree with the snapshot the real backend returns",
    ).toBe(true);
  });

  it("rep_state returns the committed mastery snapshot instead of the seed", async () => {
    const completed = await clean(await cleansOwed());
    const reread = await seamInvoke<RepSnapshot>("rep_state");
    expect(reread.mastery_status).toBe("satisfied");
    expect(reread.current_clean_streak).toBe(completed.current_clean_streak);
    expect(reread.last_attempt_id).toBe(completed.last_attempt_id);
    expect(reread.timer_state).toBe("active");
  });

  it("pause, resume, and checkpoint receipts preserve dynamic mastery", async () => {
    const completed = await clean(await cleansOwed());
    const paused = await seamInvoke<{ value: RepSnapshot }>("rep_pause", {
      commandId: "mock-pause-completed",
    });
    expect(paused.value.mastery_status).toBe("satisfied");
    expect(paused.value.current_clean_streak).toBe(
      completed.current_clean_streak,
    );
    expect(paused.value.timer_state).toBe("paused");

    const resumed = await seamInvoke<{ value: RepSnapshot }>("rep_resume", {
      commandId: "mock-resume-completed",
    });
    expect(resumed.value.mastery_status).toBe("satisfied");
    expect(resumed.value.current_clean_streak).toBe(
      completed.current_clean_streak,
    );
    expect(resumed.value.timer_state).toBe("active");

    const checkpoint = await seamInvoke<{ value: RepSnapshot }>(
      "rep_checkpoint",
      { commandId: "mock-checkpoint-completed" },
    );
    expect(checkpoint.value.mastery_status).toBe("satisfied");
    expect(checkpoint.value.current_clean_streak).toBe(
      completed.current_clean_streak,
    );
    expect(checkpoint.value.active_seconds).toBeGreaterThan(
      completed.active_seconds ?? 0,
    );
  });

  it("drops back to unsatisfied when the streak breaks", async () => {
    await clean(await cleansOwed());
    const snap = await check("flawed", "mock-sloppy");
    expect(snap.current_clean_streak).toBe(0);
    expect(snap.mastery_status).toBe("not_satisfied");
  });

  it("undo updates both its outcome and the next state read", async () => {
    const completed = await clean(await cleansOwed());
    const undone = await seamInvoke<MockCheckOutcome>("rep_undo");
    expect(undone.block_done).toBe(false);
    expect(undone.snap.mastery_status).toBe("not_satisfied");
    expect(undone.snap.current_clean_streak).toBe(
      (completed.current_clean_streak ?? 1) - 1,
    );
    const reread = await seamInvoke<RepSnapshot>("rep_state");
    expect(reread.mastery_status).toBe("not_satisfied");
    expect(reread.current_clean_streak).toBe(
      undone.snap.current_clean_streak,
    );
  });

  it("does not re-pause a running set on every verdict", async () => {
    const snap = await clean(1);
    expect(
      snap.timer_state,
      "a verdict must preserve the current live timer state",
    ).toBe("active");
    expect(snap.set_state).toBe("active");
  });

  it("keeps a genuinely paused set paused across a verdict", async () => {
    await seamInvoke("rep_pause", { commandId: "mock-pause" });
    const snap = await clean(1);
    expect(snap.timer_state).toBe("paused");
    expect(snap.set_state).toBe("paused");
    const reread = await seamInvoke<RepSnapshot>("rep_state");
    expect(reread.timer_state).toBe("paused");
    expect(reread.current_clean_streak).toBe(snap.current_clean_streak);
  });

  it("lets the variant chain, not the ordinary streak, govern advancement and mastery", async () => {
    const opened = await openVariantChain();
    expect(opened.variant).toBe("dotted");
    expect(opened.variant_stage_required).toBe(2);

    const midway = await checkOutcome("clean", "chain-clean-1");
    expect(midway.snap.current_clean_streak).toBe(1);
    expect(midway.snap.required_clean_streak).toBe(1);
    expect(midway.snap.variant_stage_cleans).toBe(1);
    expect(midway.snap.mastery_status).toBe("not_satisfied");
    expect(midway.block_done).toBe(false);

    const advanced = await checkOutcome("clean", "chain-clean-2");
    expect(advanced.snap.variant).toBe("staccato");
    expect(advanced.snap.variant_stage_index).toBe(1);
    expect(advanced.snap.variant_stage_cleans).toBe(0);
    expect(advanced.snap.variant_stage_required).toBe(2);
    expect(advanced.snap.mastery_status).toBe("not_satisfied");
  });

  it("resets a stage on Flawed, leaves it alone on Failed/Again, and masters only after the final stage", async () => {
    await openVariantChain();
    await check("clean", "chain-stage-1-a");
    await check("clean", "chain-stage-1-b");
    const oneAtStageTwo = await check("clean", "chain-stage-2-a");
    expect(oneAtStageTwo.variant_stage_cleans).toBe(1);

    const afterAgain = await check("failed", "chain-again");
    expect(afterAgain.variant_stage_index).toBe(1);
    expect(afterAgain.variant_stage_cleans).toBe(1);

    const afterFlawed = await check("flawed", "chain-flawed");
    expect(afterFlawed.variant_stage_index).toBe(1);
    expect(afterFlawed.variant_stage_cleans).toBe(0);

    const anotherAgain = await check("failed", "chain-again-after-reset");
    expect(anotherAgain.variant_stage_cleans).toBe(0);
    expect(anotherAgain.mastery_status).toBe("not_satisfied");

    await check("clean", "chain-final-a");
    const finished = await checkOutcome("clean", "chain-final-b");
    expect(finished.snap.variant_chain_complete).toBe(true);
    expect(finished.snap.mastery_status).toBe("satisfied");
    expect(finished.block_done).toBe(true);
  });

  it("never lets chain completion manufacture missing ordinary or recovery proof", async () => {
    await openVariantChain(5);
    const completedChain = await cleanOutcome(4);
    expect(completedChain.snap.variant_chain_complete).toBe(true);
    expect(completedChain.snap.current_clean_streak).toBe(4);
    expect(completedChain.snap.mastery_status).toBe("not_satisfied");
    expect(completedChain.block_done).toBe(false);

    const proofComplete = await checkOutcome("clean", "chain-proof-final");
    expect(proofComplete.snap.variant_chain_complete).toBe(true);
    expect(proofComplete.snap.current_clean_streak).toBe(5);
    expect(proofComplete.snap.mastery_status).toBe("satisfied");
    expect(proofComplete.block_done).toBe(true);
  });
});
