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
 * movement, then the native `click` the browser fires right after). Stubs
 * the overlay's measured width first, since jsdom's real
 * `getBoundingClientRect` is all-zero. */
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
  fireEvent.click(bar);
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

/** The live-QA repro shape: page 1 is clean and editable, page 3 carries a
 * structural `unapplyable` defect (the devMock's CLIENT_RASTER_PAGE fixture —
 * unsorted barline_xs). Two pages so a renumber on page 1 is genuinely
 * "unrelated" to page 3's conflict. */
function twoPageResultWithPage3Unapplyable(): ReconcileResult {
  const page1 = reconciledPages()[0];
  const page3: MeasureMapPageRow = {
    page: 3,
    map: {
      version: 1,
      systems: [
        {
          y_top: 0.5,
          y_bottom: 0.6,
          x_left: 0.05,
          x_right: 0.95,
          bars: [
            { x_right: 0.7, number: 4, source: "model" },
            { x_right: 0.3, number: 5, source: "model" },
            { x_right: 0.9, number: 6, source: "model" },
            { x_right: 0.8999, number: 7, source: "model" },
          ],
        },
      ],
    },
  };
  return {
    pages: [page1, page3],
    conflicts: [
      {
        kind: "unapplyable",
        page: 3,
        system: 1,
        reason: "bar x_right must strictly increase within a system",
      },
    ],
    total_bars: 7,
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
      reconcile: vi.fn().mockResolvedValue({
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

  // ── Conflict semantics across local edits (live-QA Critical, C7) ────────

  it("a local renumber on page 1 never clears page 3's unapplyable conflict, and Apply stays disabled", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("2");
    const apply = vi.fn().mockResolvedValue(1);
    const api = makeApi({
      apply,
      reconcile: vi.fn().mockResolvedValue(twoPageResultWithPage3Unapplyable()),
    });
    render(
      <MeasureMapPanel
        pieceId={1}
        editionId="score/score.pdf"
        editionFingerprint="fp-1"
        pageCount={3}
        onClose={vi.fn()}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-conflict-list");
    expect(screen.getByText(/bar x_right must strictly increase/)).toBeTruthy();
    expect(screen.getByTestId("measure-map-apply")).toHaveProperty(
      "disabled",
      true,
    );

    // Review page 1 (the clean page) and renumber one of its bars.
    const numbers = screen.getAllByTestId("measure-map-number");
    clickBar(numbers[1]);

    // The unrelated structural conflict SURVIVES the local pass — before this
    // fix, `setConflicts(result.conflicts)` replaced the whole list with
    // applyAnchors' continuity-break-only output and re-enabled Apply over
    // malformed geometry.
    await waitFor(() =>
      expect(screen.getAllByTestId("measure-map-number")[1].textContent).toBe(
        "2",
      ),
    );
    expect(screen.getByText(/bar x_right must strictly increase/)).toBeTruthy();
    expect(screen.getByTestId("measure-map-apply")).toHaveProperty(
      "disabled",
      true,
    );
    expect(apply).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("an informational-only conflict set leaves Apply enabled, styled quietly", async () => {
    const api = makeApi({
      reconcile: vi.fn().mockResolvedValue({
        pages: reconciledPages(),
        conflicts: [
          {
            kind: "derived_bar_count",
            page: 1,
            system: 1,
            expected: 9,
            found: 3,
          },
        ],
        total_bars: 3,
        has_pickup: false,
      } satisfies ReconcileResult),
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
    // It renders — quietly — but never blocks.
    const row = screen.getByTestId("measure-map-conflict-informational");
    expect(row.className).toContain("is-informational");
    expect(screen.queryByTestId("measure-map-conflict-blocking")).toBeNull();
    expect(screen.getByTestId("measure-map-apply")).toHaveProperty(
      "disabled",
      false,
    );
  });

  // ── F1: interpolated-bar legend ─────────────────────────────────────────

  it("shows the interpolated-bar legend, and marks those bars, only when interpolated bars exist", async () => {
    const pages = reconciledPages();
    pages[0].map.systems[0].bars[2].source = "interpolated";
    const api = makeApi({
      reconcile: vi.fn().mockResolvedValue({
        pages,
        conflicts: [],
        total_bars: 3,
        has_pickup: false,
      } satisfies ReconcileResult),
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
    await screen.findByTestId("measure-map-interpolated-legend");
    expect(screen.getByText(/Dashed numbers were interpolated/)).toBeTruthy();
    const marks = screen.getAllByTestId("measure-map-number");
    expect(marks[2].className).toContain("is-interpolated");
    expect(marks[0].className).not.toContain("is-interpolated");
  });

  it("omits the interpolated legend when every bar was read directly", async () => {
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
    expect(screen.queryByTestId("measure-map-interpolated-legend")).toBeNull();
  });

  // ── F3: partial Apply (skip a blocking page) ────────────────────────────

  it("skipping a blocking page omits it from the Apply payload and re-enables Apply", async () => {
    const apply = vi.fn().mockResolvedValue(1);
    const onApplied = vi.fn();
    const result = twoPageResultWithPage3Unapplyable();
    const api = makeApi({
      apply,
      reconcile: vi.fn().mockResolvedValue(result),
    });
    render(
      <MeasureMapPanel
        pieceId={4}
        editionId="score/score.pdf"
        editionFingerprint="fp-4"
        pageCount={3}
        onClose={vi.fn()}
        onApplied={onApplied}
        rasterizePage={rasterizePage}
        api={api}
      />,
    );
    fireEvent.click(screen.getByText("Start scan"));
    await screen.findByTestId("measure-map-conflict-list");
    // Page 1 is clean: no skip affordance offered there.
    expect(screen.queryByTestId("measure-map-skip-page")).toBeNull();

    fireEvent.click(screen.getByText("›")); // navigate to page 3
    await screen.findByTestId("measure-map-skip-page");
    fireEvent.click(screen.getByTestId("measure-map-skip-page"));

    await waitFor(() =>
      expect(screen.getByTestId("measure-map-apply")).toHaveProperty(
        "disabled",
        false,
      ),
    );
    expect(
      screen.getByTestId("measure-map-apply-summary").textContent,
    ).toContain("Applying 1 of 2 pages — 1 skipped stay unmapped.");
    // The blocking row is still listed (it was never resolved, only excluded).
    expect(screen.getByText(/bar x_right must strictly increase/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("measure-map-apply"));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const sent = apply.mock.calls[0][3] as MeasureMapPageRow[];
    expect(sent.map((row) => row.page)).toEqual([1]);
    expect(onApplied).toHaveBeenCalledWith(sent);
    expect(getMeasureMapEntry(4, "score/score.pdf")?.pages).toEqual(sent);
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
