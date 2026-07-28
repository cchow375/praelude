import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { universeSnapshot } from "./api";
import type { UniverseSnapshot } from "./types";

const SNAPSHOT: UniverseSnapshot = {
  generated_at: "2026-07-17T10:00:00Z",
  definitions: [
    {
      signal: "quality_brightness",
      label: "Quality",
      definition: "Brightness derived from clean rep ratio.",
    },
  ],
  traces: {
    source: "practice_events",
    practice_event_kinds: ["rep", "session"],
    idle_threshold_seconds: 120,
    active_window_start: "2026-06-19",
    active_window_end: "2026-07-17",
    quality_formula: "clean_rep_events / rated_rep_events",
  },
  totals: {
    focused_seconds: 3600,
    active_days_28: 12,
    regions_practiced: 8,
    regions_revisited: 3,
    mastered_targets: 2,
    recovered_targets: 1,
    practice_sessions: 20,
  },
  pieces: [
    {
      piece_id: 1,
      title: "Clair de Lune",
      composer: "Debussy",
      focused_seconds: 1800,
      active_days_28: 6,
      regions_total: 4,
      regions_practiced: 3,
      regions_revisited: 1,
      mastered_targets: 1,
      recovered_targets: 0,
      open_recovery_debt: 0,
      practice_sessions: 10,
      earned_maturity: 0.5,
      quality_brightness: 0.7,
      last_practiced: "2026-07-16T09:00:00Z",
      region_signals: [
        {
          region_id: 11,
          name: "Opening arpeggio",
          kind: "phrase",
          focused_seconds: 600,
          active_days_28: 4,
          practiced: true,
          revisited: true,
          quality_brightness: 0.8,
          last_practiced: "2026-07-16T09:00:00Z",
          practice_events: 5,
          rated_rep_events: 4,
          clean_rep_events: 3,
          distinct_practice_dates: 4,
        },
      ],
    },
  ],
};

describe("universeSnapshot", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("calls universe_snapshot with no arguments", async () => {
    invokeMock.mockResolvedValueOnce(SNAPSHOT);
    await universeSnapshot();
    expect(invokeMock).toHaveBeenCalledWith("universe_snapshot");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("resolves with the UniverseSnapshot payload returned by invoke", async () => {
    invokeMock.mockResolvedValueOnce(SNAPSHOT);
    const result = await universeSnapshot();
    expect(result).toEqual(SNAPSHOT);
  });

  it("resolves with an empty-but-valid snapshot (no pieces practiced yet)", async () => {
    const empty: UniverseSnapshot = {
      generated_at: "2026-07-17T10:00:00Z",
      definitions: [],
      traces: {
        source: "practice_events",
        practice_event_kinds: [],
        idle_threshold_seconds: 120,
        active_window_start: "2026-07-17",
        active_window_end: "2026-07-17",
        quality_formula: "clean_rep_events / rated_rep_events",
      },
      totals: {
        focused_seconds: 0,
        active_days_28: 0,
        regions_practiced: 0,
        regions_revisited: 0,
      },
      pieces: [],
    };
    invokeMock.mockResolvedValueOnce(empty);
    const result = await universeSnapshot();
    expect(result.pieces).toEqual([]);
    expect(result.totals.focused_seconds).toBe(0);
  });

  it("propagates a rejected invoke() call without swallowing the error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(universeSnapshot()).rejects.toThrow("database unavailable");
  });

  it("resolves with whatever malformed/unexpected payload invoke() returns, unvalidated", async () => {
    invokeMock.mockResolvedValueOnce({ not: "a UniverseSnapshot" });
    const result = await universeSnapshot();
    // universeSnapshot() performs no runtime shape validation on the IPC
    // response — decide whether UniverseWorkspace (the sole consumer) is
    // expected to trust the backend completely, or whether a malformed
    // response here should be caught before it reaches rendering code.
    expect(result).toEqual({ not: "a UniverseSnapshot" });
  });

  it("throws synchronously rather than returning a rejected promise when invoke() itself throws synchronously", () => {
    invokeMock.mockImplementationOnce(() => {
      throw new Error("tauri internals not initialized");
    });
    // universeSnapshot is not declared `async`, so it does not wrap the
    // invoke() call in a try/catch or a Promise chain — a synchronous throw
    // from invoke() (e.g. missing __TAURI_INTERNALS__ in a non-Tauri
    // context) propagates synchronously out of universeSnapshot() itself,
    // not as a rejected promise. Callers using `await` inside an async
    // function are unaffected, but a bare (non-awaited, non-try/catch) call
    // site would crash instead of rejecting.
    expect(() => universeSnapshot()).toThrow("tauri internals not initialized");
  });

  it("issues one invoke() call per invocation with no caching or de-duplication across concurrent calls", async () => {
    invokeMock.mockResolvedValue(SNAPSHOT);
    await Promise.all([
      universeSnapshot(),
      universeSnapshot(),
      universeSnapshot(),
    ]);
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });
});
