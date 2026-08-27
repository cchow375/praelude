import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WarmupRoutine } from "../features/warmups/types";
import type { RepReplayMeta } from "../features/rep/replay/types";
import type {
  CheckOutcome,
  RepSnapshot,
} from "../features/rep/useRep";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  return (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (name: string, input?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__.invoke(cmd, args);
}

describe("dev-mock warmups and kept review takes", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("round-trips, updates, and deletes a configured warmup routine", async () => {
    const saved = await seamInvoke<WarmupRoutine>("warmup_routine_save", {
      input: {
        name: "Octave day",
        items: [{ catalog_id: "octave-jumps", bpm: 52, clean_streak: 4 }],
      },
    });
    expect(await seamInvoke<WarmupRoutine[]>("warmup_routines_list")).toEqual([
      saved,
    ]);
    const updated = await seamInvoke<WarmupRoutine>("warmup_routine_save", {
      input: {
        id: saved.id,
        name: "Octaves before Chopin",
        items: [{ catalog_id: "broken-octaves", bpm: 64, clean_streak: 3 }],
      },
    });
    expect(updated.name).toBe("Octaves before Chopin");
    await seamInvoke("warmup_routine_delete", { id: saved.id });
    expect(await seamInvoke("warmup_routines_list")).toEqual([]);
  });

  it("matches native warmup validation at every persisted boundary", async () => {
    const boundaryItems = Array.from({ length: 40 }, (_, index) => ({
      catalog_id: `boundary-${index}`,
      bpm: index === 0 ? 20 : 300,
      clean_streak: index === 0 ? 1 : 20,
    }));
    const saved = await seamInvoke<WarmupRoutine>("warmup_routine_save", {
      input: {
        name: "N".repeat(120),
        items: boundaryItems,
      },
    });
    expect(saved.items).toHaveLength(40);
    expect(saved.items[0]).toMatchObject({ bpm: 20, clean_streak: 1 });
    expect(saved.items[39]).toMatchObject({ bpm: 300, clean_streak: 20 });

    const validItem = {
      catalog_id: "octave-jumps",
      bpm: 52,
      clean_streak: 4,
    };
    const invalidInputs = [
      { name: " ", items: [validItem] },
      { name: "N".repeat(121), items: [validItem] },
      { name: "Too empty", items: [] },
      {
        name: "Too long",
        items: Array.from({ length: 41 }, () => validItem),
      },
      {
        name: "Uppercase id",
        items: [{ ...validItem, catalog_id: "Octave-Jumps" }],
      },
      {
        name: "Long id",
        items: [{ ...validItem, catalog_id: "a".repeat(101) }],
      },
      { name: "Low bpm", items: [{ ...validItem, bpm: 19 }] },
      { name: "High bpm", items: [{ ...validItem, bpm: 301 }] },
      { name: "Fractional bpm", items: [{ ...validItem, bpm: 52.5 }] },
      { name: "Low streak", items: [{ ...validItem, clean_streak: 0 }] },
      { name: "High streak", items: [{ ...validItem, clean_streak: 21 }] },
      {
        name: "Fractional streak",
        items: [{ ...validItem, clean_streak: 2.5 }],
      },
    ];
    for (const input of invalidInputs) {
      await expect(
        seamInvoke("warmup_routine_save", { input: { ...input, id: saved.id } }),
      ).rejects.toBeTruthy();
    }

    expect(await seamInvoke<WarmupRoutine[]>("warmup_routines_list")).toEqual([
      saved,
    ]);
  });

  it("uses a hidden Warm-ups piece while the normal rep engine remains authoritative", async () => {
    expect(await seamInvoke("warmup_system_piece")).toEqual({
      piece_id: 9_999,
      title: "Warm-ups",
    });
    const snap = await seamInvoke<{ piece_id: number; piece_title: string }>(
      "rep_open",
      {
        args: {
          piece_id: 9_999,
          m_start: 3,
          m_end: 3,
          label: "Octave jumps — silent landing",
          start_bpm: 52,
          target_bpm: null,
          required_clean_streak: 4,
          variants: [],
          focus: "other",
          use_metronome: true,
        },
        context: { method: "warmup" },
      },
    );
    expect(snap).toMatchObject({ piece_id: 9_999, piece_title: "Warm-ups" });
  });

  it("stores bytes only for an explicit replay save and deletes them together", async () => {
    const opened = await seamInvoke<RepSnapshot>("rep_open", {
      args: {
        piece_id: 1,
        m_start: 1,
        m_end: 2,
        required_clean_streak: 3,
        variants: [],
        focus: "other",
        use_metronome: false,
      },
      context: { method: "listen_back_test" },
    });
    const checked = await seamInvoke<CheckOutcome>("rep_check", {
      verdict: "clean",
      note: null,
    });
    expect(
      await seamInvoke("rep_replay_list", {
        repBlockId: opened.block_id,
      }),
    ).toEqual([]);
    const saved = await seamInvoke<RepReplayMeta>("rep_replay_save", {
      input: {
        rep_block_id: opened.block_id,
        attempt_id: checked.snap.last_attempt_id,
        mime_type: "audio/webm",
        duration_ms: 900,
        bytes_base64: "BAUG",
      },
    });
    expect(saved).toMatchObject({
      rep_block_id: opened.block_id,
      attempt_id: checked.snap.last_attempt_id,
      byte_len: 3,
    });
    expect(await seamInvoke("rep_replay_read", { id: saved.id })).toBe(
      "BAUG",
    );
    await seamInvoke("rep_replay_delete", { id: saved.id });
    expect(
      await seamInvoke("rep_replay_list", {
        repBlockId: opened.block_id,
      }),
    ).toEqual([]);
    await expect(
      seamInvoke("rep_replay_read", { id: saved.id }),
    ).rejects.toContain("no kept take");
  });

  it("mirrors exact, overlapping voice-capture leases and the unmount race", async () => {
    expect(
      await seamInvoke<number>("voice_capture_suspend", {
        requestId: "review-a",
      }),
    ).toBe(1);
    // Lost reply retry: same request, same lease.
    expect(
      await seamInvoke<number>("voice_capture_suspend", {
        requestId: "review-a",
      }),
    ).toBe(1);
    expect(
      await seamInvoke<number>("voice_capture_suspend", {
        requestId: "review-b",
      }),
    ).toBe(2);
    expect(
      await seamInvoke<boolean>("voice_capture_resume", {
        requestId: "review-a",
      }),
    ).toBe(false);
    expect(
      await seamInvoke<boolean>("voice_capture_resume", {
        requestId: "review-b",
      }),
    ).toBe(true);
    expect(
      await seamInvoke<boolean>("voice_capture_resume", {
        requestId: "unmounted-before-suspend",
      }),
    ).toBe(false);
    expect(
      await seamInvoke<number>("voice_capture_suspend", {
        requestId: "unmounted-before-suspend",
      }),
    ).toBe(0);
  });
});
