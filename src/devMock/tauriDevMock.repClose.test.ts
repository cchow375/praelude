import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { CheckOutcome, RepSnapshot } from "../features/rep/useRep";
import type { PausedSetRow } from "../features/rep/pausedSets";

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

function openArgs(requiredCleanStreak = 3) {
  return {
    args: {
      piece_id: 1,
      region_id: null,
      m_start: 20,
      m_end: 24,
      label: "transition",
      start_bpm: 60,
      target_bpm: null,
      planned_reps: null,
      required_clean_streak: requiredCleanStreak,
      variants: [],
      focus: "notes",
      use_metronome: false,
    },
    context: null,
  };
}

describe("dev-mock rep_close lifecycle", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns a completed set once without resurrecting it on rep_state", async () => {
    await seamInvoke<RepSnapshot>("rep_open", openArgs(1));
    const outcome = await seamInvoke<CheckOutcome>("rep_check", {
      verdict: "clean",
      note: null,
      commandId: "complete-before-close",
    });
    expect(outcome.snap.mastery_status).toBe("satisfied");

    const closed = await seamInvoke<RepSnapshot | null>("rep_close");
    expect(closed).toMatchObject({
      set_state: "mastered",
      status: "done",
      timer_state: "stopped",
    });
    await expect(
      seamInvoke<RepSnapshot | null>("rep_state"),
    ).resolves.toBeNull();
    await expect(
      seamInvoke<RepSnapshot | null>("rep_close"),
    ).resolves.toBeNull();
  });

  it("removes the tracked paused set from the paused tray when it closes", async () => {
    await seamInvoke("rep_pause", { commandId: "pause-before-close" });
    await expect(
      seamInvoke<PausedSetRow[]>("sets_paused_list"),
    ).resolves.toHaveLength(1);

    const closed = await seamInvoke<RepSnapshot | null>("rep_close");
    expect(closed).toMatchObject({
      set_state: "closed_unresolved",
      status: "abandoned",
      timer_state: "stopped",
    });
    await expect(
      seamInvoke<PausedSetRow[]>("sets_paused_list"),
    ).resolves.toEqual([]);
  });

  it("rep_open restores an active readable set after close", async () => {
    await seamInvoke("rep_close");
    await expect(
      seamInvoke<RepSnapshot | null>("rep_state"),
    ).resolves.toBeNull();

    const reopened = await seamInvoke<RepSnapshot>("rep_open", openArgs());
    expect(reopened).toMatchObject({
      m_start: 20,
      m_end: 24,
      set_state: "active",
      timer_state: "active",
    });
    await expect(seamInvoke<RepSnapshot>("rep_state")).resolves.toEqual(
      reopened,
    );
  });

  it("opening beside a paused set preserves that unrelated tray row", async () => {
    await seamInvoke("rep_pause", { commandId: "pause-before-open" });
    const paused = await seamInvoke<PausedSetRow[]>("sets_paused_list");
    expect(paused).toHaveLength(1);

    await seamInvoke<RepSnapshot>("rep_open", openArgs());
    await expect(
      seamInvoke<PausedSetRow[]>("sets_paused_list"),
    ).resolves.toEqual(paused);

    // Closing the newly active set must not close the older paused one.
    await seamInvoke("rep_close");
    await expect(
      seamInvoke<PausedSetRow[]>("sets_paused_list"),
    ).resolves.toEqual(paused);
  });
});
