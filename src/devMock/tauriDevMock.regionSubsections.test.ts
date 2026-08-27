import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { Region } from "../features/pieces/types";

// Task C5: proves region_create (parent-linkage validation, one-level
// nesting, same-piece) and region_delete (cascade/promote) work entirely
// against the dev mock's own in-memory state — the "offline-QA-able"
// requirement for changed commands.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

function createArgs(over: Partial<Record<string, unknown>> = {}) {
  return {
    args: {
      piece_id: 1,
      name: "Sticky run",
      notes: null,
      m_start: 10,
      m_end: 14,
      kind: "hard_spot",
    },
    parent_region_id: null,
    ...over,
  };
}

function microTargetArgs(over: Partial<Record<string, unknown>> = {}) {
  return {
    args: {
      piece_id: 1,
      parent_region_id: 11,
      name: "Spot 1",
      m_start: 2,
      m_end: 3,
      color: "#4ab5f2",
      pdf_anchor: {
        v: 1,
        editions: {
          "score/score.pdf": {
            fingerprint: "mock-fp-1",
            rects: [{ page: 1, x: 0.2, y: 0.2, w: 0.1, h: 0.1 }],
          },
        },
      },
      ...over,
    },
  };
}

describe("dev-mock region create/delete (Task C5)", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("creates a child region linked to its parent, visible via region_list", async () => {
    const created = await seamInvoke<Region>(
      "region_create",
      createArgs({ parent_region_id: 11 }), // piece 1's seeded "Opening theme"
    );
    expect(created.parent_region_id).toBe(11);

    const list = await seamInvoke<Region[]>("region_list", { pieceId: 1 });
    const found = list.find((region) => region.id === created.id);
    expect(found?.parent_region_id).toBe(11);
  });

  it("creates one complete anchored micro-target through the atomic command", async () => {
    const created = await seamInvoke<Region>(
      "score_micro_target_create",
      microTargetArgs(),
    );
    expect(created).toMatchObject({
      parent_region_id: 11,
      name: "Spot 1",
      m_start: 2,
      m_end: 3,
      color: "#4ab5f2",
    });
    expect(created.pdf_anchor).toMatchObject({ v: 1 });

    const list = await seamInvoke<Region[]>("region_list", { pieceId: 1 });
    expect(list.filter((region) => region.id === created.id)).toEqual([created]);
  });

  it("leaves the region list unchanged when atomic validation rejects", async () => {
    const before = await seamInvoke<Region[]>("region_list", { pieceId: 1 });
    await expect(
      seamInvoke(
        "score_micro_target_create",
        microTargetArgs({ m_start: 2, m_end: 99 }),
      ),
    ).rejects.toMatch(/inside its parent/);
    const after = await seamInvoke<Region[]>("region_list", { pieceId: 1 });
    expect(after).toEqual(before);
  });

  it("rejects a parent from a different piece", async () => {
    await expect(
      seamInvoke("region_create", createArgs({ parent_region_id: 21 })), // piece 2's region
    ).rejects.toMatch(/same piece/);
  });

  it("rejects nesting beyond one level", async () => {
    const child = await seamInvoke<Region>(
      "region_create",
      createArgs({ parent_region_id: 11 }),
    );
    await expect(
      seamInvoke(
        "region_create",
        createArgs({ name: "Too deep", parent_region_id: child.id }),
      ),
    ).rejects.toMatch(/only one level of nesting/);
  });

  it("cascade delete removes the parent and its children", async () => {
    const child = await seamInvoke<Region>(
      "region_create",
      createArgs({ parent_region_id: 11 }),
    );
    await seamInvoke("region_delete", { id: 11, mode: "cascade" });
    const list = await seamInvoke<Region[]>("region_list", { pieceId: 1 });
    expect(list.some((region) => region.id === 11)).toBe(false);
    expect(list.some((region) => region.id === child.id)).toBe(false);
  });

  it("promote delete keeps the child, top-level", async () => {
    const child = await seamInvoke<Region>(
      "region_create",
      createArgs({ parent_region_id: 11 }),
    );
    await seamInvoke("region_delete", { id: 11, mode: "promote" });
    const list = await seamInvoke<Region[]>("region_list", { pieceId: 1 });
    expect(list.some((region) => region.id === 11)).toBe(false);
    const survivor = list.find((region) => region.id === child.id);
    expect(survivor).toBeTruthy();
    expect(survivor?.parent_region_id).toBeNull();
  });
});
