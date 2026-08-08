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

  // UPDATED for C6b: page 1's single system and page 2's single system are
  // immediately adjacent in the bar stream, and BOTH anchors ("1" and "10")
  // sit at their own system's first bar — exactly the system-start bracket
  // case (see `score::measure_reconcile`'s "System-start bracketing" doc
  // comment, mirrored in this file's `mockReconcile`). Page 1's model bar
  // count (4) disagrees with what the anchors imply (10-1=9), so it's now
  // resolved via `derived_bar_count` + even interpolation instead of a plain
  // `continuity_break` — this test used to pin the OLD (pre-C6b) behavior.
  it("page 1 scans clean, page 2's printed number implies a bar count page 1's model undercounted", async () => {
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
    expect(reconciled.conflicts[0]).toMatchObject({
      kind: "derived_bar_count",
      page: 1,
      system: 1,
      expected: 9,
      found: 4,
    });
    expect(
      reconciled.conflicts.some((c) => c.kind === "continuity_break"),
    ).toBe(false);
    // Page 1's 4 model-reported bars were resynthesized as 9 evenly spaced
    // interpolated bars, numbered 1..9 (the anchor gap 10-1=9).
    const page1Bars = reconciled.pages[0].map.systems[0].bars;
    expect(page1Bars.map((b) => b.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(page1Bars.every((b) => b.source === "interpolated")).toBe(true);
    expect(page1Bars.every((b) => b.confidence === undefined)).toBe(true);
    // Page 2's own system is untouched (still `source: model`, starting
    // at its own printed "10").
    const page2Bars = reconciled.pages[1].map.systems[0].bars;
    expect(page2Bars[0]).toMatchObject({ number: 10, source: "model" });
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

  // ── Fix round 1: needs_client_raster exercisability + more conflict kinds ──

  it("page 3 needs client raster on the first call (no bytes), then accepts bytes", async () => {
    await expect(
      seamInvoke("measure_scan_page", {
        pieceId: 1,
        editionId: "score/score.pdf",
        editionFingerprint: "mock-fp-1",
        page: 3,
        pageJpeg: null,
      }),
    ).rejects.toBe("needs_client_raster");

    // The retry, WITH bytes, succeeds.
    const scan = await seamInvoke<ScanPageOutput>("measure_scan_page", {
      pieceId: 1,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-1",
      page: 3,
      pageJpeg: [1, 2, 3],
    });
    expect(scan.systems[0].barline_xs).toBeDefined();

    // A subsequent call for the SAME (piece, page) no longer needs raster —
    // "once", not every time.
    const again = await seamInvoke<ScanPageOutput>("measure_scan_page", {
      pieceId: 1,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-1",
      page: 3,
      pageJpeg: null,
    });
    expect(again.systems[0].barline_xs).toBeDefined();
  });

  it("page 3's client-raster content has unsorted barline_xs, flagged unapplyable", async () => {
    const page3 = await seamInvoke<ScanPageOutput>("measure_scan_page", {
      pieceId: 2,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-2",
      page: 3,
      pageJpeg: [1, 2, 3],
    });
    const reconciled = await seamInvoke<ReconcileResult>("measure_reconcile", {
      pieceId: 2,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-2",
      pagesJson: JSON.stringify([{ page: 3, scan: page3 }]),
    });
    expect(reconciled.conflicts).toContainEqual(
      expect.objectContaining({ kind: "unapplyable", page: 3 }),
    );
  });

  it("the client-raster gate is scoped per piece — a different piece still needs it", async () => {
    await expect(
      seamInvoke("measure_scan_page", {
        pieceId: 42,
        editionId: "score/score.pdf",
        editionFingerprint: "mock-fp-42",
        page: 3,
        pageJpeg: null,
      }),
    ).rejects.toBe("needs_client_raster");
  });

  it("piece 6 (the pickup fixture) has zero printed numbers on every page and reports has_pickup + pickup_ambiguity", async () => {
    const page1 = await seamInvoke<ScanPageOutput>("measure_scan_page", {
      pieceId: 6,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-6",
      page: 1,
      pageJpeg: null,
    });
    expect(page1.systems[0].printed_numbers).toEqual([]);

    const reconciled = await seamInvoke<ReconcileResult>("measure_reconcile", {
      pieceId: 6,
      editionId: "score/score.pdf",
      editionFingerprint: "mock-fp-6",
      pagesJson: JSON.stringify([{ page: 1, scan: page1 }]),
    });
    expect(reconciled.has_pickup).toBe(true);
    expect(reconciled.conflicts).toContainEqual(
      expect.objectContaining({ kind: "pickup_ambiguity" }),
    );
    // Zero anchors anywhere -> the synthetic start is UNCONDITIONALLY 1,
    // even with has_pickup true (the pickup floor only governs back-fill
    // underflow clamping once a REAL printed-number anchor exists — see
    // `score::measure_reconcile::reconcile`'s own zero-anchor branch).
    expect(reconciled.pages[0].map.systems[0].bars[0].number).toBe(1);
  });

  it("a non-pickup piece reports has_pickup: false", async () => {
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
    expect(reconciled.has_pickup).toBe(false);
  });
});
