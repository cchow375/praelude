import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { PieceSummary } from "../features/pieces/types";

// `piece_archive` has ZERO coverage anywhere in src/. The real backend
// (src-tauri/src/lib.rs's `piece_archive`) requires `typed_name` to exactly
// match the piece's folder name or title and REJECTS otherwise (a
// type-to-confirm destructive-action guard) — see pieces::archive's
// mismatch error. The mock accepts ANY typed_name (never rejects) and does
// not persist the removal into the shared PIECES list: it returns a
// filtered snapshot for that one call only, so a follow-up pieces_list still
// shows the "archived" piece. Both are real, verified fidelity gaps between
// the mock and the native contract; this pins CURRENT mock behavior so a
// future fix to either is a deliberate, visible diff here, not a silent
// mock-only behavior change.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock piece_archive handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns the piece list with the archived id filtered out", async () => {
    const remaining = await seamInvoke<PieceSummary[]>("piece_archive", {
      id: 2,
      folderName: "white-peacock",
      typedName: "The White Peacock",
    });
    expect(remaining.some((piece) => piece.id === 2)).toBe(false);
    expect(remaining.some((piece) => piece.id === 1)).toBe(true);
  });

  // KNOWN GAP vs. native: the real command rejects when typedName doesn't
  // match the piece's folder name/title. The mock does not validate this at
  // all — it archives regardless of what (or whether) typedName is passed.
  it("gap: does NOT reject a mismatched typedName the way the real command does", async () => {
    const remaining = await seamInvoke<PieceSummary[]>("piece_archive", {
      id: 2,
      folderName: "white-peacock",
      typedName: "totally the wrong name",
    });
    expect(remaining.some((piece) => piece.id === 2)).toBe(false);
  });

  // KNOWN GAP vs. native: the real command persists the archive (moves the
  // vault folder + updates the DB row), so a subsequent list call would not
  // show the piece again. The mock's PIECES array is never mutated, so a
  // fresh pieces_list still returns the "archived" piece.
  it("gap: does NOT persist — a follow-up pieces_list still includes the archived piece", async () => {
    await seamInvoke<PieceSummary[]>("piece_archive", {
      id: 2,
      folderName: "white-peacock",
      typedName: "The White Peacock",
    });
    const list = await seamInvoke<PieceSummary[]>("pieces_list");
    expect(list.some((piece) => piece.id === 2)).toBe(true);
  });
});
