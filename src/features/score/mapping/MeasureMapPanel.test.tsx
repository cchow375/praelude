import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MeasureMapPanel, type MeasureMapApi } from "./MeasureMapPanel";
import {
  getMeasureMapEntry,
  resetMeasureMapStoreForTests,
  type MeasureMapPageRow,
  type ReconcileResult,
  type ScanPageOutput,
} from "./measureMap";

/** Click a bar-number mark the way a real pointer would (down/up with no
 * movement) — `MeasureOverlay` disambiguates click vs. drag via pointer
 * events, not a native `onClick`. Stubs the overlay's measured width first,
 * since jsdom's real `getBoundingClientRect` is all-zero. */
function clickBar(bar: HTMLElement) {
  const overlay = bar.closest(".measure-map-overlay");
  if (overlay) {
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 100,
      width: 1000,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);
  }
  fireEvent.pointerDown(bar, { pointerId: 1, clientX: 100, clientY: 50 });
  fireEvent.pointerUp(bar, { pointerId: 1, clientX: 100, clientY: 50 });
}

afterEach(() => {
  cleanup();
  resetMeasureMapStoreForTests();
});

function cleanScan(): ScanPageOutput {
  return {
    systems: [
      {
        y_top: 0.1,
        y_bottom: 0.2,
        x_left: 0.05,
        x_right: 0.95,
        barline_xs: [0.3, 0.6, 0.95],
        printed_numbers: [{ number: 1, x: 0.05, y: 0.09, confidence: 0.95 }],
        staves: 2,
      },
    ],
  };
}

function reconciledPages(): MeasureMapPageRow[] {
  return [
    {
      page: 1,
      map: {
        version: 1,
        systems: [
          {
            y_top: 0.1,
            y_bottom: 0.2,
            x_left: 0.05,
            x_right: 0.95,
            bars: [
              { x_right: 0.3, number: 1, source: "model", confidence: 0.95 },
              { x_right: 0.6, number: 2, source: "model" },
              { x_right: 0.95, number: 3, source: "model" },
            ],
          },
        ],
      },
    },
  ];
}

function noConflictResult(): ReconcileResult {
  return {
    pages: reconciledPages(),
    conflicts: [],
    total_bars: 3,
    has_pickup: false,
  };
}

function conflictResult(): ReconcileResult {
  const pages = reconciledPages();
  return {
    pages,
    conflicts: [
      { kind: "continuity_break", page: 1, system: 1, expected: 2, found: 1 },
    ],
    total_bars: 3,
    has_pickup: false,
  };
}

function unapplyableResult(): ReconcileResult {
  const pages = reconciledPages();
  return {
    pages,
    conflicts: [
      {
        kind: "unapplyable",
        page: 1,
        system: 0,
        reason: "duplicate page",
      },
    ],
    total_bars: 3,
    has_pickup: false,
  };
}

function makeApi(overrides: Partial<MeasureMapApi> = {}): MeasureMapApi {
  return {
    scanPage: vi.fn().mockResolvedValue(cleanScan()),
    reconcile: vi.fn().mockResolvedValue(noConflictResult()),
    apply: vi.fn().mockResolvedValue(1),
    ...overrides,
  } as unknown as MeasureMapApi;
}

const rasterizePage = vi.fn().mockResolvedValue([1, 2, 3]);

beforeEach(() => {
  rasterizePage.mockClear();
});

describe("MeasureMapPanel", () => {
  it("shows the intro with the page count before scanning", () => {
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={3}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={makeApi()}
      />,
    );
    expect(screen.getByText(/3 pages/)).toBeTruthy();
  });

  it("reports per-page progress while scanning", async () => {
    let resolvePage2: (value: ScanPageOutput) => void = () => undefined;
    const scanPage = vi
      .fn()
      .mockResolvedValueOnce(cleanScan())
      .mockImplementationOnce(
        () =>
          new Promise<ScanPageOutput>((resolve) => (resolvePage2 = resolve)),
      );
    const api = makeApi({ scanPage });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={2}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await waitFor(() =>
      expect(screen.getByTestId("measure-map-progress-text").textContent).toBe(
        "Page 2 of 2",
      ),
    );
    resolvePage2(cleanScan());
    await waitFor(() =>
      expect(screen.getByTestId("measure-map-panel")).toBeTruthy(),
    );
  });

  it("cancel between pages keeps completed pages and reconciles the partial scan", async () => {
    let resolvePage2: (value: ScanPageOutput) => void = () => undefined;
    const scanPage = vi
      .fn()
      .mockResolvedValueOnce(cleanScan())
      .mockImplementationOnce(
        () =>
          new Promise<ScanPageOutput>((resolve) => (resolvePage2 = resolve)),
      );
    const reconcile = vi.fn().mockResolvedValue(noConflictResult());
    const api = makeApi({ scanPage, reconcile });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={5}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await waitFor(() => expect(scanPage).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText("Cancel"));
    resolvePage2(cleanScan());
    await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    // Only the 2 completed pages reached reconcile — the loop never asked for
    // pages 3, 4, 5.
    expect(reconcile.mock.calls[0][3]).toHaveLength(2);
    expect(scanPage).toHaveBeenCalledTimes(2);
  });

  it("retries with a client-rasterized JPEG on needs_client_raster", async () => {
    const scanPage = vi
      .fn()
      .mockRejectedValueOnce("needs_client_raster")
      .mockResolvedValueOnce(cleanScan());
    const api = makeApi({ scanPage });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={1}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await waitFor(() => expect(scanPage).toHaveBeenCalledTimes(2));
    expect(rasterizePage).toHaveBeenCalledWith(1);
    // The retry call carries the rasterized bytes as its 5th argument.
    expect(scanPage.mock.calls[1][4]).toEqual([1, 2, 3]);
  });

  it("renders the conflict list and disables Apply while conflicts remain", async () => {
    const api = makeApi({
      reconcile: vi.fn().mockResolvedValue(conflictResult()),
    });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={1}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-conflict-list");
    expect(
      screen.getByText(/expected a gap of 2 bars but found 1/),
    ).toBeTruthy();
    expect(screen.getByTestId("measure-map-apply")).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("a user renumber re-reconciles locally and clears the conflict, enabling Apply", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("2");
    const api = makeApi({
      reconcile: vi.fn().mockResolvedValue(conflictResult()),
    });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={1}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-conflict-list");
    expect(screen.getByTestId("measure-map-apply")).toHaveProperty(
      "disabled",
      true,
    );

    const numbers = screen.getAllByTestId("measure-map-number");
    clickBar(numbers[1]); // the second bar — renumber to 2 (matches its position)

    await waitFor(() =>
      expect(screen.getByTestId("measure-map-no-conflicts")).toBeTruthy(),
    );
    expect(screen.getByTestId("measure-map-apply")).toHaveProperty(
      "disabled",
      false,
    );
    promptSpy.mockRestore();
  });

  it("Apply sends exactly the reviewed payload, and only on click", async () => {
    const apply = vi.fn().mockResolvedValue(1);
    const onApplied = vi.fn();
    const api = makeApi({ apply });
    render(
      <MeasureMapPanel
        pieceId={7}
        editionId="score/score.pdf"
        editionFingerprint="fp-7"
        pageCount={1}
        onClose={vi.fn()}
        onApplied={onApplied}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-no-conflicts");
    expect(apply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("measure-map-apply"));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledWith(
      7,
      "score/score.pdf",
      "fp-7",
      reconciledPages(),
    );
    expect(onApplied).toHaveBeenCalledWith(reconciledPages());
    expect(getMeasureMapEntry(7, "score/score.pdf")).toEqual({
      fingerprint: "fp-7",
      pages: reconciledPages(),
    });
  });

  it("Cancel discards the review and never calls apply", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const apply = vi.fn().mockResolvedValue(1);
    const onClose = vi.fn();
    const api = makeApi({ apply });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={1}
        onClose={onClose}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-no-conflicts");
    fireEvent.click(screen.getByText("Cancel"));
    expect(apply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("keeps the review state and surfaces the error when Apply is rejected", async () => {
    const apply = vi.fn().mockRejectedValue("piece 7 has no valid edition");
    const api = makeApi({ apply });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={1}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-no-conflicts");
    fireEvent.click(screen.getByTestId("measure-map-apply"));
    await waitFor(() =>
      expect(
        screen.getByText(/Apply failed: piece 7 has no valid edition/),
      ).toBeTruthy(),
    );
    // Still in review — the conflict list / bar numbers are still there, and
    // Apply is still available to retry.
    expect(screen.getByTestId("measure-map-no-conflicts")).toBeTruthy();
    expect(screen.getByTestId("measure-map-apply")).toBeTruthy();
  });

  it("warns before navigating away from an unsaved review", async () => {
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={1}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={makeApi()}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-no-conflicts");
    const event = new Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("reports dirty/clean to the caller across scan, review, apply and discard", async () => {
    const onDirtyChange = vi.fn();
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={1}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        onDirtyChange={onDirtyChange}
        api={makeApi()}
      />,
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByText("Start scan"));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    await screen.findByTestId("measure-map-no-conflicts");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByTestId("measure-map-apply"));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("paints the reviewed page's raster behind the overlay, and re-fetches on page nav", async () => {
    const rasterize = vi.fn().mockResolvedValue([9, 9, 9]);
    const pages = [reconciledPages()[0], { ...reconciledPages()[0], page: 2 }];
    const api = makeApi({
      reconcile: vi
        .fn()
        .mockResolvedValue({
          pages,
          conflicts: [],
          total_bars: 6,
          has_pickup: false,
        }),
    });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={2}
        onClose={vi.fn()}
        rasterizePage={rasterize}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-page-image");
    expect(rasterize).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByText("›"));
    await waitFor(() => expect(rasterize).toHaveBeenCalledWith(2));
  });

  it("renders and amber-bands a page-level unapplyable conflict", async () => {
    const api = makeApi({
      reconcile: vi.fn().mockResolvedValue(unapplyableResult()),
    });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={1}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-conflict-list");
    expect(screen.getByText(/duplicate page/)).toBeTruthy();
    expect(screen.getByTestId("measure-map-apply")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByTestId("measure-map-conflict-1-1")).toBeTruthy();
  });

  it("threads has_pickup from the reconcile result into the local renumber floor", async () => {
    // A single-anchor pin whose back-fill would underflow floor 1 but NOT
    // floor 0 — proves has_pickup actually changes renumber behavior.
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("0");
    const pickupPages: MeasureMapPageRow[] = [
      {
        page: 1,
        map: {
          version: 1,
          systems: [
            {
              y_top: 0.1,
              y_bottom: 0.2,
              x_left: 0.05,
              x_right: 0.95,
              bars: [
                { x_right: 0.3, number: 1, source: "model" },
                { x_right: 0.6, number: 2, source: "model" },
              ],
            },
          ],
        },
      },
    ];
    const api = makeApi({
      reconcile: vi.fn().mockResolvedValue({
        pages: pickupPages,
        conflicts: [],
        total_bars: 2,
        has_pickup: true,
      }),
    });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={1}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-no-conflicts");
    const numbers = screen.getAllByTestId("measure-map-number");
    clickBar(numbers[0]); // pins bar 0 to "0" — legal only at the pickup floor
    await waitFor(() =>
      expect(screen.getAllByTestId("measure-map-number")[0].textContent).toBe(
        "0",
      ),
    );
    expect(screen.getByTestId("measure-map-no-conflicts")).toBeTruthy();
    promptSpy.mockRestore();
  });

  it("bar marks are read-only after Apply, with a re-scan-to-edit hint", async () => {
    const api = makeApi();
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={1}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-no-conflicts");
    fireEvent.click(screen.getByTestId("measure-map-apply"));
    await waitFor(() => expect(screen.getByText("Applied.")).toBeTruthy());
    const bar = screen.getAllByTestId("measure-map-number")[0];
    expect(bar.tagName).toBe("SPAN");
    expect(bar.getAttribute("title")).toBe("Map applied — re-scan to edit");
  });

  it("wires the barline-drag gesture end to end: dragging changes the applied x_right", async () => {
    const apply = vi.fn().mockResolvedValue(1);
    const api = makeApi({ apply });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={1}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-no-conflicts");

    const overlay = screen.getByTestId("measure-map-overlay-1");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 100,
      width: 1000,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);
    const bar = screen.getAllByTestId("measure-map-number")[0]; // x_right 0.3
    fireEvent.pointerDown(bar, { pointerId: 5, clientX: 300, clientY: 50 });
    // +100px over a 1000px-wide overlay = +0.1 normalized -> 0.4.
    fireEvent.pointerMove(bar, { pointerId: 5, clientX: 400, clientY: 50 });
    fireEvent.pointerUp(bar, { pointerId: 5, clientX: 400, clientY: 50 });

    fireEvent.click(screen.getByTestId("measure-map-apply"));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const appliedPages = apply.mock.calls[0][3] as MeasureMapPageRow[];
    expect(appliedPages[0].map.systems[0].bars[0].x_right).toBeCloseTo(0.4, 5);
    expect(appliedPages[0].map.systems[0].bars[0].source).toBe("model");
  });
});
