import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StreakSummary } from "../features/streak/api";
import type { UniverseSnapshot } from "../features/universe/types";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock Universe browser QA states", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    installTauriDevMock();
  });

  afterEach(() => {
    uninstallTauriDevMock();
    window.history.replaceState(null, "", "/");
  });

  it("serves the default momentum + recovery fixture", async () => {
    window.history.replaceState(null, "", "/?qaUniverse=momentum");
    const snapshot = await seamInvoke<UniverseSnapshot>("universe_snapshot");
    expect(snapshot.totals.focused_seconds).toBeGreaterThan(0);
    expect(snapshot.pieces.some((piece) => (piece.open_recovery_debt ?? 0) > 0)).toBe(
      true,
    );
  });

  it("serves a mapped shelf with no awarded practice evidence", async () => {
    window.history.replaceState(null, "", "/?qaUniverse=shelf");
    const snapshot = await seamInvoke<UniverseSnapshot>("universe_snapshot");
    expect(snapshot.pieces).toHaveLength(1);
    expect(snapshot.pieces[0].regions_total).toBeGreaterThan(0);
    expect(snapshot.totals.focused_seconds).toBe(0);
    expect(snapshot.pieces[0].region_signals.every((region) => !region.practiced)).toBe(
      true,
    );
    expect(await seamInvoke<StreakSummary>("streak_summary")).toMatchObject({
      current_days: 0,
      best_days: 0,
      today_focused_seconds: 0,
    });
  });

  it("serves a truly empty practice record", async () => {
    window.history.replaceState(null, "", "/?qaUniverse=empty");
    const snapshot = await seamInvoke<UniverseSnapshot>("universe_snapshot");
    expect(snapshot.pieces).toEqual([]);
    expect(snapshot.totals).toMatchObject({
      focused_seconds: 0,
      active_days_28: 0,
      regions_practiced: 0,
      mastered_targets: 0,
    });
    expect(await seamInvoke<StreakSummary>("streak_summary")).toMatchObject({
      current_days: 0,
      best_days: 0,
      today_focused_seconds: 0,
    });
  });
});
