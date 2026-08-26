import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { CheckOutcome } from "../features/rep/useRep";

// B80 rule: the dev mock answers EVERY command the frontend calls. `rep_undo`
// and the whole `metro_practice_*` family had no handler at all — they fell
// through to `default: return null`, so A7's undo button read `outcome.snap`
// off null (red receipt) and the 15s practice-set metronome plumbing was
// silently unexercisable in the browser harness. These pin the handlers, and
// pin that each metro command actually MOVES the mock's metronome state rather
// than returning a polite nothing.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

interface MockMetroState {
  running: boolean;
  bpm: number;
  beats_per_bar: number;
  subdivision: number;
}

async function check(verdict: string, commandId: string) {
  return seamInvoke<CheckOutcome>("rep_check", {
    verdict,
    note: null,
    commandId,
  });
}

describe("dev-mock rep_undo handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns a committed CheckOutcome that walks the attempt ledger back", async () => {
    const first = await check("clean", "u-1");
    const second = await check("clean", "u-2");
    expect(second.snap.current_clean_streak).toBe(
      (first.snap.current_clean_streak ?? 0) + 1,
    );

    const undone = await seamInvoke<CheckOutcome>("rep_undo");

    expect(undone.snap.block_id).toBe(102);
    expect(undone.snap.attempts_recorded).toBe(first.snap.attempts_recorded);
    // The undone attempt's streak contribution is given back, not guessed.
    expect(undone.snap.current_clean_streak).toBe(
      first.snap.current_clean_streak,
    );
    // The HUD keys receipt de-dupe on last_attempt_id: it must fall back to the
    // attempt that is now latest, not stay on the one that was just voided.
    expect(undone.snap.last_attempt_id).toBe(first.snap.last_attempt_id);
    expect(undone.snap.voided_attempts).toBe(1);
    expect(undone.receipt?.status).toBe("committed");
    expect(undone.block_done).toBe(false);
  });

  it("restores a broken streak when the undone attempt was not clean", async () => {
    const clean = await check("clean", "u-3");
    await check("failed", "u-4");
    const undone = await seamInvoke<CheckOutcome>("rep_undo");
    expect(undone.snap.current_clean_streak).toBe(
      clean.snap.current_clean_streak,
    );
    expect(undone.snap.last?.verdict).toBe("clean");
  });

  it("rejects with the backend's plain-string convention when there is nothing to undo", async () => {
    await expect(seamInvoke("rep_undo")).rejects.toMatch(/nothing to undo/i);
  });

  it("starts each install from a fresh ledger", async () => {
    const before = await check("clean", "u-5");
    uninstallTauriDevMock();
    installTauriDevMock();
    const after = await check("clean", "u-6");
    expect(after.snap.attempts_recorded).toBe(before.snap.attempts_recorded);
  });
});

describe("dev-mock metro_practice_* handlers", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  const metroState = () => seamInvoke<MockMetroState>("metro_state");

  it("starts the click at the set's opening tempo", async () => {
    expect((await metroState()).running).toBe(false);
    const started = await seamInvoke<MockMetroState>("metro_practice_start", {
      setId: 102,
      bpm: 61,
    });
    expect(started.running).toBe(true);
    expect(started.bpm).toBe(61);
    const state = await metroState();
    expect(state.running).toBe(true);
    expect(state.bpm).toBe(61);
  });

  it("retunes a running click without stopping it", async () => {
    await seamInvoke("metro_practice_start", { setId: 102, bpm: 61 });
    await seamInvoke("metro_practice_retune", { setId: 102, bpm: 65 });
    const state = await metroState();
    expect(state.bpm).toBe(65);
    expect(state.running).toBe(true);
  });

  it("carries the set's own tuning when it is supplied, and leaves it alone when it is not", async () => {
    const seededBeatsPerBar = (await metroState()).beats_per_bar;
    await seamInvoke("metro_practice_start", {
      setId: 102,
      bpm: 61,
      beatsPerBar: 3,
      subdivision: 2,
    });
    let state = await metroState();
    expect(state.beats_per_bar).toBe(3);
    expect(state.subdivision).toBe(2);
    // An omitted field is not a reset — the engine's `do_ensure_running`
    // touches bpm only, and the mock must not pretend otherwise.
    await seamInvoke("metro_practice_retune", { setId: 102, bpm: 66 });
    state = await metroState();
    expect(state.beats_per_bar).toBe(3);
    expect(state.subdivision).toBe(2);
    expect(seededBeatsPerBar).toBe(4);
  });

  it("pauses and resumes the click with the set", async () => {
    await seamInvoke("metro_practice_start", { setId: 102, bpm: 61 });
    await seamInvoke("metro_practice_pause", { setId: 102 });
    expect((await metroState()).running).toBe(false);
    await seamInvoke("metro_practice_resume", { setId: 102, bpm: 63 });
    const state = await metroState();
    expect(state.running).toBe(true);
    expect(state.bpm).toBe(63);
  });

  it("follows a restart onto the new set at the new tempo", async () => {
    await seamInvoke("metro_practice_start", { setId: 102, bpm: 61 });
    const restarted = await seamInvoke<MockMetroState>(
      "metro_practice_restart",
      { oldSetId: 102, newSetId: 103, bpm: 58 },
    );
    expect(restarted.running).toBe(true);
    expect(restarted.bpm).toBe(58);
  });

  it("stops the click when the set closes", async () => {
    await seamInvoke("metro_practice_start", { setId: 102, bpm: 61 });
    await seamInvoke("metro_practice_close", { setId: 102 });
    expect((await metroState()).running).toBe(false);
  });

  it("starts each install from a stopped click at the seeded tempo", async () => {
    await seamInvoke("metro_practice_start", { setId: 102, bpm: 61 });
    uninstallTauriDevMock();
    installTauriDevMock();
    const state = await metroState();
    expect(state.running).toBe(false);
    expect(state.bpm).toBe(92);
    expect(state.beats_per_bar).toBe(4);
    expect(state.subdivision).toBe(1);
  });
});

describe("dev-mock settings snapshot round-trip", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("remembers a settings_update, so a later settings_snapshot is not a lie", async () => {
    await seamInvoke("settings_update", { patch: { theme: "light" } });
    const snapshot = await seamInvoke<{ theme: string; wake_word: string }>(
      "settings_snapshot",
    );
    expect(snapshot.theme).toBe("light");
    expect(snapshot.wake_word).toBe("coda");
  });

  it("still forgets it across installs", async () => {
    await seamInvoke("settings_update", { patch: { theme: "light" } });
    uninstallTauriDevMock();
    installTauriDevMock();
    const snapshot = await seamInvoke<{ theme: string }>("settings_snapshot");
    expect(snapshot.theme).toBe("dark");
  });
});
