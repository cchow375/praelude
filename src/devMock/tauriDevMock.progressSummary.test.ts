import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

// `progress_summary` has zero coverage anywhere in src/: every test that
// touches it (HistoryPanel.test.tsx, LedgerWorkspace.test.tsx,
// LedgerCalendarWorkspace.test.tsx, textFit.contract.test.tsx) stubs
// `@tauri-apps/api/core` directly with `vi.mock`, so none of them ever
// reach this file's `PROGRESS[pieceIdOf(args)] ?? null` lookup. That
// leaves both the per-piece data-derivation and the "no progress on
// record for this piece" null-fallback branch unexercised.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

interface MockProgressSummary {
  piece_id: number;
  focused_seconds: number;
  streak: number;
  best_tempo_reached: number;
  per_region_mastery: unknown[];
  time_by_focus: unknown[];
}

describe("dev-mock progress_summary handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns the seeded progress record for a known piece id", async () => {
    const summary = await seamInvoke<MockProgressSummary>("progress_summary", {
      pieceId: 1,
    });
    expect(summary.piece_id).toBe(1);
    expect(summary.focused_seconds).toBe(8400);
    expect(summary.per_region_mastery.length).toBeGreaterThan(0);
  });

  it("returns null for a piece with no progress data on record", async () => {
    const summary = await seamInvoke<MockProgressSummary | null>(
      "progress_summary",
      { pieceId: 999_999 },
    );
    expect(summary).toBeNull();
  });
});
