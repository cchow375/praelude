import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { StreakSummary } from "../features/streak/api";

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock streak_summary handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns a deterministic, internally consistent summary", async () => {
    const a = await seamInvoke<StreakSummary>("streak_summary");
    const b = await seamInvoke<StreakSummary>("streak_summary");
    expect(a).toEqual(b);
    expect(a.best_days).toBeGreaterThanOrEqual(a.current_days);
    expect(a.threshold_minutes).toBe(10);
    expect(a.today_focused_seconds).toBeGreaterThanOrEqual(
      a.current_days > 0 ? a.threshold_minutes * 60 : 0,
    );
  });
});
