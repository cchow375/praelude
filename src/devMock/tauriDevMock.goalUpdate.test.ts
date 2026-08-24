import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

// `goal_update` has zero coverage anywhere in src/: DaySheet.tsx's own
// `commitGoal` (the only UI path that calls it) is never exercised by
// DaySheet.test.tsx / DaySheetWindow.test.tsx (neither references
// "commitGoal" or "goal_update" at all), and useCrud.test.ts — the other
// caller — stubs `@tauri-apps/api/core` directly with `vi.mock`, which
// never runs this file's `goalUpdate()` branch logic. That leaves the
// mock's own "unknown goal id" rejection, and its patch-merge onto an
// existing seeded/created goal, entirely unexercised.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

interface MockGoal {
  id: number;
  piece_id: number;
  text: string;
  kind: "big" | "sub";
  parent_goal_id: number | null;
  done: boolean;
  order: number;
  target_date: string | null;
  created_ts: string;
}

describe("dev-mock goal_update handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("rejects an id that matches no seeded or created goal", async () => {
    await expect(
      seamInvoke("goal_update", { id: 999_999, patch: { text: "nope" } }),
    ).rejects.toBe("goal_update: unknown goal");
  });

  it("patches text and target_date onto an existing seeded goal", async () => {
    // Goal id 2 is seeded under piece 1 in GOALS (see tauriDevMock.ts).
    const updated = await seamInvoke<MockGoal>("goal_update", {
      id: 2,
      patch: {
        text: "Clean development hands separately",
        target_date: "2026-09-01",
      },
    });
    expect(updated.id).toBe(2);
    expect(updated.text).toBe("Clean development hands separately");
    expect(updated.target_date).toBe("2026-09-01");

    // Documents an actual mock quirk: updating a *seeded* goal writes the
    // patched copy into the separate CREATED_GOALS map without removing the
    // original from the read-only GOALS seed, so goal_list now returns BOTH
    // a stale and an updated row sharing id 2 for this piece. The stale
    // (unmodified) seed entry sorts first because goalListFor() spreads
    // `[...seeded, ...created]`.
    const list = await seamInvoke<MockGoal[]>("goal_list", { pieceId: 1 });
    const matches = list.filter((goal) => goal.id === 2);
    expect(matches).toHaveLength(2);
    expect(matches[0].text).toBe(
      "Clean the development section hands together",
    );
    expect(matches[1].text).toBe("Clean development hands separately");
  });

  it("round-trips a patch onto a goal created at runtime via goal_create", async () => {
    const created = await seamInvoke<MockGoal>("goal_create", {
      args: {
        piece_id: 1,
        text: "New sub-goal",
        kind: "sub",
        parent_goal_id: null,
        target_date: null,
      },
    });
    const updated = await seamInvoke<MockGoal>("goal_update", {
      id: created.id,
      patch: { done: true },
    });
    expect(updated.done).toBe(true);
    expect(updated.text).toBe("New sub-goal"); // untouched fields survive the merge
  });
});
