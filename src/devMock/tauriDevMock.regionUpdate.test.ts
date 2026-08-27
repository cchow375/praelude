import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { Region } from "../features/pieces/types";
import type { PdfAnchorMap } from "../features/score/types";

// The micro-target rebuild creates a spot and writes its box in one flow, and
// the box write is `region_update`. That command had no dev-mock handler, so
// offline QA accepted the create and silently dropped the geometry — the dev
// mock showed a spot with no box, which is indistinguishable from the bug the
// rebuild exists to fix. These tests pin the handler so that cannot recur.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

function anchorMap(page: number): PdfAnchorMap {
  return {
    v: 1,
    editions: {
      "mock-edition": {
        fingerprint: "mock-fingerprint",
        rects: [{ page, x: 0.2, y: 0.3, w: 0.1, h: 0.05 }],
      },
    },
  };
}

async function seedRegion(): Promise<Region> {
  return seamInvoke<Region>("region_create", {
    args: {
      piece_id: 1,
      name: "Rolled chords accuracy",
      notes: null,
      m_start: 10,
      m_end: 17,
      kind: "hard_spot",
    },
    parent_region_id: null,
  });
}

describe("dev-mock region_update", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("persists a pdf_anchor so a freshly created spot keeps its box", async () => {
    const region = await seedRegion();
    expect(region.pdf_anchor).toBeNull();

    const updated = await seamInvoke<Region>("region_update", {
      id: region.id,
      patch: { pdf_anchor: anchorMap(2) },
    });
    expect(updated.pdf_anchor).toEqual(anchorMap(2));

    // And it survives a re-read — the point of the handler is persistence,
    // not an echo of the argument.
    const listed = await seamInvoke<Region[]>("region_list", { pieceId: 1 });
    expect(listed.find((item) => item.id === region.id)?.pdf_anchor).toEqual(
      anchorMap(2),
    );
  });

  it("replaces the anchor wholesale rather than merging", async () => {
    const region = await seedRegion();
    await seamInvoke<Region>("region_update", {
      id: region.id,
      patch: { pdf_anchor: anchorMap(2) },
    });
    const cleared = await seamInvoke<Region>("region_update", {
      id: region.id,
      patch: { pdf_anchor: null },
    });
    expect(cleared.pdf_anchor).toBeNull();
  });

  it("writes the colour every new section is given", async () => {
    const region = await seedRegion();
    const updated = await seamInvoke<Region>("region_update", {
      id: region.id,
      patch: { color: "#8899ff" },
    });
    expect(updated.color).toBe("#8899ff");
  });

  it("leaves fields the patch omits untouched", async () => {
    const region = await seedRegion();
    const updated = await seamInvoke<Region>("region_update", {
      id: region.id,
      patch: { color: "#8899ff" },
    });
    expect(updated.name).toBe("Rolled chords accuracy");
    expect(updated.m_start).toBe(10);
    expect(updated.m_end).toBe(17);
  });

  it("renames and re-ranges when asked", async () => {
    const region = await seedRegion();
    const updated = await seamInvoke<Region>("region_update", {
      id: region.id,
      patch: { name: "  Rolled chords  ", m_start: 11, m_end: 12 },
    });
    expect(updated.name).toBe("Rolled chords");
    expect(updated.m_start).toBe(11);
    expect(updated.m_end).toBe(12);
  });

  it("rejects an empty title the way the real store does", async () => {
    const region = await seedRegion();
    await expect(
      seamInvoke<Region>("region_update", {
        id: region.id,
        patch: { name: "   " },
      }),
    ).rejects.toBeTruthy();
  });

  it("rejects an unknown region", async () => {
    await expect(
      seamInvoke<Region>("region_update", {
        id: 999_999,
        patch: { color: "#000000" },
      }),
    ).rejects.toBeTruthy();
  });
});
