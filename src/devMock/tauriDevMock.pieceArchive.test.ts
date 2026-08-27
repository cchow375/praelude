import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { PieceMovement, PieceSummary } from "../features/pieces/types";

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock piece library archive contracts", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("persists reversible Archive while active lists exclude the piece", async () => {
    const all = await seamInvoke<PieceSummary[]>("piece_archive_set", {
      id: 2,
      archived: true,
    });
    expect(all.find((piece) => piece.id === 2)?.archived_at).not.toBeNull();

    const active = await seamInvoke<PieceSummary[]>("pieces_list");
    expect(active.some((piece) => piece.id === 2)).toBe(false);
    const includingArchived = await seamInvoke<PieceSummary[]>("pieces_list", {
      includeArchived: true,
    });
    expect(includingArchived.some((piece) => piece.id === 2)).toBe(true);

    await seamInvoke("piece_archive_set", { id: 2, archived: false });
    const restored = await seamInvoke<PieceSummary[]>("pieces_list");
    expect(restored.some((piece) => piece.id === 2)).toBe(true);
  });

  it("keeps Delete files distinct and rejects the wrong typed name", async () => {
    await expect(
      seamInvoke("piece_delete_files", {
        folderName: "white-peacock",
        typedName: "totally the wrong name",
      }),
    ).rejects.toContain("doesn't match");
    expect(
      (await seamInvoke<PieceSummary[]>("pieces_list")).some(
        (piece) => piece.id === 2,
      ),
    ).toBe(true);
  });

  it("persists a confirmed file removal across subsequent library reads", async () => {
    await seamInvoke("piece_delete_files", {
      folderName: "white-peacock",
      typedName: "The White Peacock",
    });
    const list = await seamInvoke<PieceSummary[]>("pieces_list", {
      includeArchived: true,
    });
    expect(list.some((piece) => piece.id === 2)).toBe(false);
  });

  it("round-trips movement CRUD through the same browser harness seam", async () => {
    const created = await seamInvoke<PieceMovement>("piece_movement_create", {
      input: { piece_id: 2, title: "II · Lento", start_page: 7 },
    });
    expect(created.start_page).toBe(7);

    const updated = await seamInvoke<PieceMovement>("piece_movement_update", {
      id: created.id,
      patch: { title: "II · Andante", start_page: 8 },
    });
    expect(updated).toMatchObject({ title: "II · Andante", start_page: 8 });
    expect(
      await seamInvoke<PieceMovement[]>("piece_movement_list", { pieceId: 2 }),
    ).toHaveLength(1);

    await seamInvoke("piece_movement_delete", { id: created.id });
    expect(
      await seamInvoke<PieceMovement[]>("piece_movement_list", { pieceId: 2 }),
    ).toEqual([]);
  });
});
