import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installTauriDevMock,
  mockLastOpenedPassSeconds,
  uninstallTauriDevMock,
} from "./tauriDevMock";
import type { RepSnapshot } from "../features/rep/useRep";

// Task A10: `rep_open` previously fell through the mock's default `null`
// case, so `BlockForm`'s "Start set" flow (via `useRep().open`) could never
// be exercised in `dev:mock`. This proves the new case returns a coherent
// snapshot AND round-trips `context.pass_seconds` — Some(30) and an absent
// context both behave as the real backend does (persist vs. NULL).

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock rep_open handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns a coherent, freshly-opened snapshot", async () => {
    const snap = await seamInvoke<RepSnapshot>("rep_open", {
      args: {
        piece_id: 3,
        region_id: null,
        m_start: 10,
        m_end: 18,
        label: "left hand",
        start_bpm: 72,
        target_bpm: 120,
        planned_reps: null,
        required_clean_streak: 7,
        variants: [
          { name: "dotted", reps: 9, clean_streak: 2 },
          { name: "staccato", reps: 3 },
        ],
        focus: "tempo",
        use_metronome: true,
        tuning: {
          beat_unit: "dotted_quarter",
          subdivision: 3,
          beats_per_bar: 6,
        },
      },
      context: null,
    });
    expect(snap.piece_id).toBe(3);
    expect(snap.m_start).toBe(10);
    expect(snap.m_end).toBe(18);
    expect(snap.start_bpm).toBe(72);
    expect(snap.target_bpm).toBe(120);
    expect(snap.reps_done).toBe(0);
    expect(snap.set_state).toBe("active");
    expect(snap.required_clean_streak).toBe(7);
    expect(snap.effective_required_clean_streak).toBe(7);
    expect(snap.planned_reps).toBe(12);
    expect(snap.variants).toEqual([
      { name: "dotted", reps: 9, clean_streak: 2 },
      { name: "staccato", reps: 3 },
    ]);
    expect(snap.variant).toBe("dotted");
    expect(snap.variant_stage_index).toBe(0);
    expect(snap.variant_stage_cleans).toBe(0);
    expect(snap.variant_stage_required).toBe(2);
    expect(snap.next_variant_stage_name).toBe("staccato");
    expect(snap.variant_chain_complete).toBe(false);
    expect(snap.tuning).toEqual({
      beat_unit: "dotted_quarter",
      subdivision: 3,
      beats_per_bar: 6,
    });
  });

  it("uses legacy variant reps as the stage requirement when clean_streak is absent", async () => {
    const snap = await seamInvoke<RepSnapshot>("rep_open", {
      args: {
        piece_id: 1,
        region_id: null,
        m_start: 1,
        m_end: 8,
        label: null,
        start_bpm: 60,
        target_bpm: null,
        planned_reps: null,
        required_clean_streak: 1,
        variants: [{ name: "legacy lane", reps: 4 }],
        focus: "tempo",
        use_metronome: true,
      },
      context: null,
    });

    expect(snap.variants).toEqual([{ name: "legacy lane", reps: 4 }]);
    expect(snap.variant_stage_required).toBe(4);
    expect(snap.target_bpm).toBeNull();
  });

  it("uses the native quarter / 1 / 4 tuning defaults when the caller omits tuning", async () => {
    const snap = await seamInvoke<RepSnapshot>("rep_open", {
      args: {
        piece_id: 1,
        region_id: null,
        m_start: 1,
        m_end: 8,
        label: null,
        start_bpm: 60,
        target_bpm: null,
        planned_reps: null,
        focus: "tempo",
        use_metronome: true,
      },
      context: null,
    });
    expect(snap.tuning).toEqual({
      beat_unit: "quarter",
      subdivision: 1,
      beats_per_bar: 4,
    });
  });

  it("round-trips context.pass_seconds when present, and clears to null when absent", async () => {
    expect(mockLastOpenedPassSeconds()).toBeNull();

    await seamInvoke("rep_open", {
      args: {
        piece_id: 1,
        region_id: null,
        m_start: 1,
        m_end: 8,
        label: null,
        start_bpm: 60,
        target_bpm: null,
        planned_reps: null,
        focus: "tempo",
        use_metronome: true,
      },
      context: { pass_seconds: 30 },
    });
    expect(mockLastOpenedPassSeconds()).toBe(30);

    // A second open with no context clears it back to null, matching the
    // real backend storing NULL for an absent context.pass_seconds.
    await seamInvoke("rep_open", {
      args: {
        piece_id: 1,
        region_id: null,
        m_start: 1,
        m_end: 8,
        label: null,
        start_bpm: 60,
        target_bpm: null,
        planned_reps: null,
        focus: "tempo",
        use_metronome: true,
      },
      context: null,
    });
    expect(mockLastOpenedPassSeconds()).toBeNull();
  });

  it("clears pass-seconds state on install (fresh per test)", async () => {
    await seamInvoke("rep_open", {
      args: {
        piece_id: 1,
        region_id: null,
        m_start: 1,
        m_end: 8,
        label: null,
        start_bpm: 60,
        target_bpm: null,
        planned_reps: null,
        focus: "tempo",
        use_metronome: true,
      },
      context: { pass_seconds: 45 },
    });
    expect(mockLastOpenedPassSeconds()).toBe(45);

    uninstallTauriDevMock();
    installTauriDevMock();
    expect(mockLastOpenedPassSeconds()).toBeNull();
  });
});
