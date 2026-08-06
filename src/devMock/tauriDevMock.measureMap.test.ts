import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type {
  MeasureMapPageRow,
  ReconcileResult,
  ScanPageOutput,
} from "../features/score/mapping/measureMap";

// Task C4: proves the whole scan -> reconcile -> apply -> get -> clear flow
// works entirely against the dev mock's own in-memory state, with no real
// Tauri backend — the "offline-QA-able" requirement.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock measure mapping handlers", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("page 1 scans clean, page 2 scans with a printed number that breaks continuity", async () => {
    const page1 = await seamInvoke<ScanPageOutput>("measure_scan_page", {
      pieceId: 1,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-1",
      page: 1,
      pageJpeg: null,
    });
    expect(page1.systems[0].printed_numbers[0]).toMatchObject({ number: 1 });

    const page2 = await seamInvoke<ScanPageOutput>("measure_scan_page", {
      pieceId: 1,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-1",
      page: 2,
      pageJpeg: null,
    });
    expect(page2.systems[0].printed_numbers[0]).toMatchObject({ number: 10 });

    const reconciled = await seamInvoke<ReconcileResult>("measure_reconcile", {
      pieceId: 1,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-1",
      pagesJson: JSON.stringify([
        { page: 1, scan: page1 },
        { page: 2, scan: page2 },
      ]),
    });
    expect(reconciled.conflicts).toHaveLength(1);
    expect(reconciled.conflicts[0]).toMatchObject({ kind: "continuity_break" });
    // Page 1 is clean and numbers 1..4.
    expect(
      reconciled.pages[0].map.systems[0].bars.map((b) => b.number),
    ).toEqual([1, 2, 3, 4]);
  });

  it("reconciling page 1 alone (a partial scan) produces zero conflicts", async () => {
    const page1 = await seamInvoke<ScanPageOutput>("measure_scan_page", {
      pieceId: 1,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-1",
      page: 1,
      pageJpeg: null,
    });
    const reconciled = await seamInvoke<ReconcileResult>("measure_reconcile", {
      pieceId: 1,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-1",
      pagesJson: JSON.stringify([{ page: 1, scan: page1 }]),
    });
    expect(reconciled.conflicts).toEqual([]);
    expect(reconciled.total_bars).toBe(4);
  });

  it("measure_map_get returns nothing for an unmapped piece, then round-trips apply/get/clear", async () => {
    const before = await seamInvoke<MeasureMapPageRow[]>("measure_map_get", {
      pieceId: 5,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-5",
    });
    expect(before).toEqual([]);

    const pages: MeasureMapPageRow[] = [
      {
        page: 1,
        map: {
          version: 1,
          systems: [
            {
              y_top: 0.1,
              y_bottom: 0.2,
              x_left: 0.05,
              x_right: 0.9,
              bars: [{ x_right: 0.3, number: 1, source: "model" }],
            },
          ],
        },
      },
    ];
    const written = await seamInvoke<number>("measure_map_apply", {
      pieceId: 5,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-5",
      pages,
    });
    expect(written).toBe(1);

    const after = await seamInvoke<MeasureMapPageRow[]>("measure_map_get", {
      pieceId: 5,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-5",
    });
    expect(after).toEqual(pages);

    const removed = await seamInvoke<number>("measure_map_clear", {
      pieceId: 5,
      editionFingerprint: "mock-fp-5",
    });
    expect(removed).toBe(1);

    const afterClear = await seamInvoke<MeasureMapPageRow[]>(
      "measure_map_get",
      {
        pieceId: 5,
        editionId: "score/score.pdf",
        editionFingerprint: "mock-fp-5",
      },
    );
    expect(afterClear).toEqual([]);
  });

  it("keeps applied maps isolated per edition fingerprint", async () => {
    const pages: MeasureMapPageRow[] = [
      {
        page: 1,
        map: {
          version: 1,
          systems: [
            {
              y_top: 0.1,
              y_bottom: 0.2,
              x_left: 0.05,
              x_right: 0.9,
              bars: [{ x_right: 0.3, number: 1, source: "model" }],
            },
          ],
        },
      },
    ];
    await seamInvoke("measure_map_apply", {
      pieceId: 9,
      editionId: "score/score.pdf",
      editionFingerprint: "fp-old",
      pages,
    });
    const underNewFingerprint = await seamInvoke<MeasureMapPageRow[]>(
      "measure_map_get",
      {
        pieceId: 9,
        editionId: "score/score.pdf",
        editionFingerprint: "fp-new",
      },
    );
    expect(underNewFingerprint).toEqual([]);
  });

  it("a fresh install clears any previously applied mock map", async () => {
    await seamInvoke("measure_map_apply", {
      pieceId: 3,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-3",
      pages: [],
    });
    uninstallTauriDevMock();
    installTauriDevMock();
    const rows = await seamInvoke<MeasureMapPageRow[]>("measure_map_get", {
      pieceId: 3,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-3",
    });
    expect(rows).toEqual([]);
  });
});
