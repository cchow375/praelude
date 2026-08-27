import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { createPdfJsAdapter, pdfJsAdapter, ScoreView } from "./ScoreView";
import type {
  PdfAdapter,
  PdfDocumentHandle,
  PdfEdition,
  PdfRenderTask,
  ScorePdfApi,
} from "./types";
import type { AtomicTargetSavePayload } from "./atlas/savePayload";
import { fitContextBucket, sharedFirstPageBitmaps } from "./firstPageCache";
import {
  publishMeasureMap,
  resetMeasureMapStoreForTests,
  type MeasureMapPageRow,
} from "./mapping/measureMap";

const EDITIONS: PdfEdition[] = [
  {
    id: "urtext",
    label: "Urtext",
    size_bytes: 100,
    modified_unix: 1,
    fingerprint: "a",
    selected: true,
  },
  {
    id: "fingered",
    label: "Fingered",
    size_bytes: 120,
    modified_unix: 2,
    fingerprint: "b",
    selected: false,
  },
];

class FakeIntersectionObserver {
  static latest: FakeIntersectionObserver | null = null;
  private readonly callback: IntersectionObserverCallback;
  private readonly observed = new Set<Element>();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.latest = this;
  }

  observe = (target: Element) => this.observed.add(target);
  unobserve = (target: Element) => this.observed.delete(target);
  disconnect = () => this.observed.clear();
  takeRecords = () => [];
  root = null;
  rootMargin = "0px";
  thresholds = [0];

  trigger(ratios: Record<number, number>) {
    const entries = [...this.observed].flatMap((target) => {
      const page = Number((target as HTMLElement).dataset.pageNumber);
      if (!(page in ratios)) return [];
      const ratio = ratios[page];
      return [
        {
          target,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        } as IntersectionObserverEntry,
      ];
    });
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

function makeApi(overrides: Partial<ScorePdfApi> = {}): ScorePdfApi {
  return {
    editions: vi.fn().mockResolvedValue(EDITIONS),
    select: vi.fn().mockResolvedValue(undefined),
    bytes: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    regions: vi.fn().mockResolvedValue([]),
    blocks: vi.fn().mockResolvedValue([]),
    updateRegion: vi.fn(),
    createTarget: vi
      .fn()
      .mockImplementation(async (payload) => synthesizeSavedRegion(payload)),
    loadFirstPage: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    saveFirstPage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** A backend-shaped Region receipt echoing an atomic target save payload. */
function synthesizeSavedRegion(payload: AtomicTargetSavePayload) {
  const range = payload.asserted_measure_range!;
  const edition = payload.edition!;
  return {
    id: 9001,
    piece_id: payload.piece_id,
    name: payload.title ?? `Target · mm. ${range.m_start}–${range.m_end}`,
    notes: payload.note ?? null,
    m_start: range.m_start,
    m_end: range.m_end,
    kind: "hard_spot",
    order: 99,
    color: null,
    pdf_anchor: {
      v: 1,
      editions: {
        [edition.edition_id]: {
          fingerprint: edition.edition_fingerprint,
          rects: payload.anchor!.rects,
        },
      },
    },
  };
}

/** A Region whose current-edition mark contains any drawn selection, so the
 * draft editor offers a reviewable measure candidate. */
function mappedRegion() {
  return {
    id: 4,
    piece_id: 7,
    name: "Development",
    notes: "Even groups",
    m_start: 40,
    m_end: 56,
    kind: "hard_spot",
    order: 0,
    color: "#8b7cf6",
    pdf_anchor: {
      v: 1,
      editions: {
        urtext: {
          fingerprint: "a",
          rects: [{ page: 1, x: 0, y: 0, w: 1, h: 1 }],
        },
      },
    },
  };
}

/** Enter target mode, drag one rectangle on page 1, and confirm the candidate
 * measure range so the draft is ready to save. */
async function drawAndConfirmTarget() {
  fireEvent.click(screen.getByRole("button", { name: "Draw target" }));
  const overlay = await screen.findByTestId("atlas-target-overlay-1");
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 800,
    width: 1000,
    height: 800,
    toJSON: () => ({}),
  });
  fireEvent.pointerDown(overlay, {
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: 200,
  });
  fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 500, clientY: 400 });
  fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 500, clientY: 400 });
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm corrected range" }),
  );
}

function makePdf(pageCount = 5) {
  const cancels = new Map<number, ReturnType<typeof vi.fn>>();
  const getPage = vi.fn(async (pageNumber: number) => {
    const cancel = vi.fn();
    cancels.set(pageNumber, cancel);
    return {
      width: 600,
      height: 800,
      cleanup: vi.fn(),
      render: (canvas: HTMLCanvasElement): PdfRenderTask => {
        canvas.width = 1200;
        canvas.height = 1600;
        return { promise: Promise.resolve(), cancel };
      },
    };
  });

  const document: PdfDocumentHandle = {
    numPages: pageCount,
    getPage,
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  const adapter: PdfAdapter = { load: vi.fn().mockResolvedValue(document) };
  return { adapter, document, getPage, cancels };
}

// A fake whose page dimensions match DEFAULT_PAGE_SIZE (612×792), so the initial
// fit scale never shifts when the true page size is discovered — that keeps the
// getPage (rasterize) count deterministic for the zoom-debounce assertions.
function makeSizedPdf(pageWidth = 612, pageHeight = 792, pageCount = 1) {
  const getPage = vi.fn(async () => ({
    width: pageWidth,
    height: pageHeight,
    cleanup: vi.fn(),
    render: (canvas: HTMLCanvasElement): PdfRenderTask => {
      canvas.width = Math.round(pageWidth * 2);
      canvas.height = Math.round(pageHeight * 2);
      return { promise: Promise.resolve(), cancel: vi.fn() };
    },
  }));
  const document: PdfDocumentHandle = {
    numPages: pageCount,
    getPage,
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  const adapter: PdfAdapter = { load: vi.fn().mockResolvedValue(document) };
  return { adapter, document, getPage };
}

function makeMinimalPdf(): ArrayBuffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = source.length;
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";
  source += offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source).buffer as ArrayBuffer;
}

beforeEach(() => {
  sharedFirstPageBitmaps.clear();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  FakeIntersectionObserver.latest = null;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ScoreView", () => {
  it("orders sections by measure and expands controls directly beneath only the chosen row", async () => {
    const regions = [
      {
        id: 3,
        piece_id: 7,
        name: "Coda",
        notes: null,
        m_start: 724,
        m_end: 732,
        kind: "hard_spot",
        order: 0,
        color: null,
        pdf_anchor: null,
      },
      {
        id: 1,
        piece_id: 7,
        name: "Opening",
        notes: null,
        m_start: 1,
        m_end: 8,
        kind: "hard_spot",
        order: 9,
        color: null,
        pdf_anchor: null,
      },
      {
        id: 2,
        piece_id: 7,
        name: "Middle",
        notes: null,
        m_start: 334,
        m_end: 365,
        kind: "hard_spot",
        order: 2,
        color: null,
        pdf_anchor: null,
      },
    ];
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ regions: vi.fn().mockResolvedValue(regions) })}
        adapter={makePdf(1).adapter}
      />,
    );
    await screen.findByLabelText("Score page 1");
    const rows = screen
      .getAllByRole("button")
      .filter((button) => button.classList.contains("score-region-row"));
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Opening, measures 1 to 8",
      "Middle, measures 334 to 365",
      "Coda, measures 724 to 732",
    ]);

    fireEvent.click(rows[1]);
    expect(
      rows[1].closest(".score-region-item")?.querySelector('[role="tablist"]'),
    ).toBeTruthy();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    fireEvent.click(rows[2]);
    expect(
      rows[2].closest(".score-region-item")?.querySelector('[role="tablist"]'),
    ).toBeTruthy();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
  });

  it("Task C5: hides a sub-section until its parent is selected and shows a sub-sections badge", async () => {
    const regions = [
      {
        id: 1,
        piece_id: 7,
        name: "Exposition",
        notes: null,
        m_start: 1,
        m_end: 100,
        kind: "hard_spot",
        order: 0,
        color: null,
        pdf_anchor: null,
        parent_region_id: null,
      },
      {
        id: 2,
        piece_id: 7,
        name: "Sticky run",
        notes: null,
        m_start: 10,
        m_end: 14,
        kind: "hard_spot",
        order: 1,
        color: null,
        pdf_anchor: null,
        parent_region_id: 1,
      },
      {
        id: 3,
        piece_id: 7,
        name: "Coda",
        notes: null,
        m_start: 200,
        m_end: 210,
        kind: "hard_spot",
        order: 2,
        color: null,
        pdf_anchor: null,
        parent_region_id: null,
      },
    ];
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ regions: vi.fn().mockResolvedValue(regions) })}
        adapter={makePdf(1).adapter}
      />,
    );
    await screen.findByLabelText("Score page 1");

    const rowLabels = () =>
      screen
        .getAllByRole("button")
        .filter((button) => button.classList.contains("score-region-row"))
        .map((row) => row.getAttribute("aria-label"));

    // The child ("Sticky run") is not shown until its parent is selected.
    expect(rowLabels()).toEqual([
      "Exposition, measures 1 to 100",
      "Coda, measures 200 to 210",
    ]);
    expect(screen.getByText("1 sub-section")).toBeTruthy();

    const parentRow = screen.getByRole("button", {
      name: "Exposition, measures 1 to 100",
    });
    fireEvent.click(parentRow);

    expect(rowLabels()).toEqual([
      "Exposition, measures 1 to 100",
      "Sticky run, measures 10 to 14",
      "Coda, measures 200 to 210",
    ]);

    // Selecting a different (non-parent) section hides the child again.
    fireEvent.click(
      screen.getByRole("button", { name: "Coda, measures 200 to 210" }),
    );
    expect(rowLabels()).toEqual([
      "Exposition, measures 1 to 100",
      "Coda, measures 200 to 210",
    ]);
  });

  describe("Task B1: sub-sections are findable", () => {
    function tricketBitRegion() {
      return {
        id: 1,
        piece_id: 7,
        name: "Tricky bit",
        notes: null,
        m_start: 1,
        m_end: 20,
        kind: "hard_spot",
        order: 0,
        color: null,
        pdf_anchor: null,
        parent_region_id: null,
      };
    }

    it("tells you how to make a sub-section as soon as a section is selected", async () => {
      render(
        <ScoreView
          pieceId={7}
          api={makeApi({
            regions: vi.fn().mockResolvedValue([tricketBitRegion()]),
          })}
          adapter={makePdf(1).adapter}
        />,
      );
      await screen.findByLabelText("Score page 1");
      fireEvent.click(
        await screen.findByRole("button", { name: /tricky bit/i }),
      );
      // Task C1 rewrote this hint around the BUTTON — the secret gesture is
      // now the parenthetical, not the instruction.
      expect(
        await screen.findByText(/No title, no measure numbers/i),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "⊕ Isolate a spot" }),
      ).toBeTruthy();
    });

    it("defaults '+ Add' to a sub-section of the selected section, and lets you opt out", async () => {
      render(
        <ScoreView
          pieceId={7}
          api={makeApi({
            regions: vi.fn().mockResolvedValue([tricketBitRegion()]),
          })}
          adapter={makePdf(1).adapter}
        />,
      );
      await screen.findByLabelText("Score page 1");
      fireEvent.click(
        await screen.findByRole("button", { name: /tricky bit/i }),
      );
      fireEvent.click(screen.getByRole("button", { name: "+ Add" }));

      const asChild = screen.getByRole("checkbox", {
        name: /sub-section of/i,
      });
      expect((asChild as HTMLInputElement).checked).toBe(true);

      fireEvent.click(asChild);
      expect((asChild as HTMLInputElement).checked).toBe(false);
    });

    it("teaches the gesture when a piece has no sections at all", async () => {
      render(
        <ScoreView
          pieceId={7}
          api={makeApi({ regions: vi.fn().mockResolvedValue([]) })}
          adapter={makePdf(1).adapter}
        />,
      );
      await screen.findByLabelText("Score page 1");
      expect(
        await screen.findByText(
          /no tricky sections yet.*drag on the score to mark your first one/i,
        ),
      ).toBeTruthy();
    });

    it("distinguishes 'no sections yet' from 'nothing matched your search'", async () => {
      render(
        <ScoreView
          pieceId={7}
          api={makeApi({
            regions: vi.fn().mockResolvedValue([tricketBitRegion()]),
          })}
          adapter={makePdf(1).adapter}
        />,
      );
      await screen.findByLabelText("Score page 1");
      fireEvent.change(
        screen.getByRole("searchbox", { name: /search tricky sections/i }),
        { target: { value: "zzzz" } },
      );
      expect(
        await screen.findByText(/no sections match that search/i),
      ).toBeTruthy();
    });
  });

  it("lifts the visible edition, page, and selected section for Practice Brain grounding", async () => {
    const region = {
      id: 4,
      piece_id: 7,
      name: "Coda leap",
      notes: "Release",
      m_start: 720,
      m_end: 732,
      kind: "hard_spot",
      order: 0,
      color: null,
      pdf_anchor: null,
    };
    const onContextChange = vi.fn();
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ regions: vi.fn().mockResolvedValue([region]) })}
        adapter={makePdf(1).adapter}
        onContextChange={onContextChange}
      />,
    );
    await screen.findByLabelText("Score page 1");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Coda leap, measures 720 to 732",
      }),
    );
    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith({
        region: {
          id: 4,
          name: "Coda leap",
          notes: "Release",
          m_start: 720,
          m_end: 732,
        },
        current_page: 1,
        edition_id: "urtext",
        edition_label: "Urtext",
      }),
    );
  });

  it("offers whole-page, two-page, slider, and section visibility controls", async () => {
    render(
      <ScoreView pieceId={7} api={makeApi()} adapter={makePdf(2).adapter} />,
    );
    await screen.findByLabelText("Score page 2");
    fireEvent.click(screen.getByRole("button", { name: "Fit page" }));
    expect(
      screen.getByRole("button", { name: "Fit page" }).className,
    ).toContain("is-active");
    fireEvent.click(screen.getByRole("button", { name: "2-page view" }));
    expect(document.querySelector(".score-pages")?.className).toContain(
      "is-overview",
    );
    fireEvent.change(screen.getByLabelText("Score zoom slider"), {
      target: { value: "55" },
    });
    expect(screen.getByLabelText("Zoom level").textContent).toBe("55%");
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse tricky sections" }),
    );
    expect(document.querySelector(".score-body")?.className).toContain(
      "is-sections-hidden",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Expand tricky sections" }),
    );
    expect(document.querySelector(".score-body")?.className).not.toContain(
      "is-sections-hidden",
    );
  });

  it("maps a selected Region with normalized edition-specific rectangles", async () => {
    const api = makeApi({
      regions: vi.fn().mockResolvedValue([
        {
          id: 4,
          piece_id: 7,
          name: "Development",
          notes: "Even groups",
          m_start: 40,
          m_end: 56,
          kind: "section",
          order: 0,
          color: "#8b7cf6",
          pdf_anchor: null,
        },
      ]),
      updateRegion: vi.fn().mockImplementation(async (_id, pdfAnchor) => ({
        id: 4,
        piece_id: 7,
        name: "Development",
        notes: "Even groups",
        m_start: 40,
        m_end: 56,
        kind: "section",
        order: 0,
        color: "#8b7cf6",
        pdf_anchor: pdfAnchor,
      })),
    });
    render(<ScoreView pieceId={7} api={api} adapter={makePdf(2).adapter} />);
    await screen.findByLabelText("Score page 2");

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Development, measures 40 to 56",
      }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Score marks" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit score annotations for Development",
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Highlight" }));
    const overlay = screen.getByTestId("page-overlay-1");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(overlay, {
      pointerId: 1,
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerMove(overlay, {
      pointerId: 1,
      clientX: 500,
      clientY: 400,
    });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 500, clientY: 400 });
    fireEvent.change(screen.getByLabelText("Annotation 1 type"), {
      target: { value: "note" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save score annotations" }),
    );

    await waitFor(() =>
      expect(api.updateRegion).toHaveBeenCalledWith(4, {
        v: 1,
        editions: {
          urtext: {
            fingerprint: "a",
            rects: [
              { page: 1, x: 0.1, y: 0.25, w: 0.4, h: 0.25, kind: "note" },
            ],
          },
        },
      }),
    );
  });

  it("keeps score-mark Save and Cancel visible when a section switch is rejected", async () => {
    const regions = [
      {
        id: 4,
        piece_id: 7,
        name: "Development",
        notes: null,
        m_start: 40,
        m_end: 56,
        kind: "section",
        order: 0,
        color: null,
        pdf_anchor: null,
      },
      {
        id: 5,
        piece_id: 7,
        name: "Coda",
        notes: null,
        m_start: 80,
        m_end: 92,
        kind: "section",
        order: 1,
        color: null,
        pdf_anchor: null,
      },
    ];
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ regions: vi.fn().mockResolvedValue(regions) })}
        adapter={makePdf(1).adapter}
      />,
    );
    await screen.findByLabelText("Score page 1");
    fireEvent.click(
      screen.getByRole("button", { name: "Development, measures 40 to 56" }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Score marks" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit score annotations for Development",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Coda, measures 80 to 92" }),
    );
    expect(
      screen.getByText(/Save or cancel the open score-mark edits/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Save score annotations" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("edits the same canonical tricky-section title, notes, and measures from the score", async () => {
    const original = {
      id: 4,
      piece_id: 7,
      name: "Development",
      notes: "Even groups",
      m_start: 40,
      m_end: 56,
      kind: "hard_spot",
      order: 0,
      color: "#8b7cf6",
      pdf_anchor: null,
    };
    const updated = {
      ...original,
      name: "LH leap",
      notes: "Look before landing",
      m_start: 42,
      m_end: 58,
    };
    const regions = vi
      .fn()
      .mockResolvedValueOnce([original])
      .mockResolvedValue([updated]);
    const api = makeApi({ regions });
    const onRegionsChanged = vi.fn();
    const onOpenBlock = vi.fn();
    invokeMock.mockImplementation((command: string) => {
      if (command === "region_update") return Promise.resolve(updated);
      return Promise.resolve(undefined);
    });

    render(
      <ScoreView
        pieceId={7}
        api={api}
        adapter={makePdf(1).adapter}
        onRegionsChanged={onRegionsChanged}
        onOpenBlock={onOpenBlock}
      />,
    );
    await screen.findByLabelText("Score page 1");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Development, measures 40 to 56",
      }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));

    fireEvent.change(screen.getByLabelText("Tricky section title"), {
      target: { value: "LH leap" },
    });
    fireEvent.change(screen.getByLabelText("Tricky section practice notes"), {
      target: { value: "Look before landing" },
    });
    fireEvent.change(screen.getByLabelText("Tricky section start measure"), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByLabelText("Tricky section end measure"), {
      target: { value: "58" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save section" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("region_update", {
        id: 4,
        patch: {
          name: "LH leap",
          notes: "Look before landing",
          m_start: 42,
          m_end: 58,
        },
      }),
    );
    await waitFor(() => expect(onRegionsChanged).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("button", { name: "LH leap, measures 42 to 58" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Practice" }));
    expect(
      (screen.getByLabelText("From measure") as HTMLInputElement).value,
    ).toBe("42");
    expect(
      (screen.getByLabelText("To measure") as HTMLInputElement).value,
    ).toBe("58");
    expect(screen.queryByText("Block label (optional)")).toBeNull();
    // The section-lock explainer line was cut in the declutter pass — a
    // region-bound form simply shows no label field at all.
    expect(document.querySelector(".block-region-lock")).toBeNull();
  });

  it("opens practice reps from the selected score section with its canonical Region id", async () => {
    const region = {
      id: 4,
      piece_id: 7,
      name: "Development",
      notes: "Even groups",
      m_start: 40,
      m_end: 56,
      kind: "hard_spot",
      order: 0,
      color: "#8b7cf6",
      pdf_anchor: null,
    };
    const onOpenBlock = vi.fn();
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ regions: vi.fn().mockResolvedValue([region]) })}
        adapter={makePdf(1).adapter}
        onOpenBlock={onOpenBlock}
      />,
    );
    await screen.findByLabelText("Score page 1");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Development, measures 40 to 56",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));

    expect(onOpenBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        piece_id: 7,
        region_id: 4,
        m_start: 40,
        m_end: 56,
        label: "Development",
        // A top-level section keeps the threaded practice default (5 when the
        // prop is absent) — unchanged by the sub-section rule below.
        required_clean_streak: 5,
      }),
    );
  });

  it("Task C5: a top-level section's set keeps the threaded clean-streak default", async () => {
    const region = {
      id: 4,
      piece_id: 7,
      name: "Development",
      notes: null,
      m_start: 40,
      m_end: 56,
      kind: "hard_spot",
      order: 0,
      color: null,
      pdf_anchor: null,
      parent_region_id: null,
    };
    const onOpenBlock = vi.fn();
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ regions: vi.fn().mockResolvedValue([region]) })}
        adapter={makePdf(1).adapter}
        onOpenBlock={onOpenBlock}
        defaultCleanStreak={7}
      />,
    );
    await screen.findByLabelText("Score page 1");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Development, measures 40 to 56",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));

    expect(onOpenBlock).toHaveBeenCalledWith(
      expect.objectContaining({ region_id: 4, required_clean_streak: 7 }),
    );
  });

  it("Task C5: a sub-section's set defaults to three consecutive cleans, still editable", async () => {
    const regions = [
      {
        id: 1,
        piece_id: 7,
        name: "Exposition",
        notes: null,
        m_start: 1,
        m_end: 100,
        kind: "hard_spot",
        order: 0,
        color: null,
        pdf_anchor: null,
        parent_region_id: null,
      },
      {
        id: 2,
        piece_id: 7,
        name: "Sticky run",
        notes: null,
        m_start: 10,
        m_end: 14,
        kind: "hard_spot",
        order: 1,
        color: null,
        pdf_anchor: null,
        parent_region_id: 1,
      },
    ];
    const onOpenBlock = vi.fn();
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ regions: vi.fn().mockResolvedValue(regions) })}
        adapter={makePdf(1).adapter}
        onOpenBlock={onOpenBlock}
        defaultCleanStreak={7}
      />,
    );
    await screen.findByLabelText("Score page 1");

    // Natural flow: select the parent so its child appears, then open the child.
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Exposition, measures 1 to 100",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Sticky run, measures 10 to 14" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));

    expect(onOpenBlock).toHaveBeenCalledWith(
      expect.objectContaining({ region_id: 2, required_clean_streak: 3 }),
    );

    // The pianist can still see and override it in the UI (Clean streak
    // target is always visible — Task A3 un-buried it).
    onOpenBlock.mockClear();
    const streak = screen.getByLabelText(
      "Clean streak target",
    ) as HTMLSelectElement;
    expect(streak.value).toBe("3");
    fireEvent.change(streak, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpenBlock).toHaveBeenCalledWith(
      expect.objectContaining({ region_id: 2, required_clean_streak: 10 }),
    );
  });

  it("uses arrow-key navigation and tabpanel relationships in Region tools", async () => {
    const region = {
      id: 4,
      piece_id: 7,
      name: "Development",
      notes: "Even groups",
      m_start: 40,
      m_end: 56,
      kind: "hard_spot",
      order: 0,
      color: "#8b7cf6",
      pdf_anchor: null,
    };
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ regions: vi.fn().mockResolvedValue([region]) })}
        adapter={makePdf(1).adapter}
        onOpenBlock={vi.fn()}
      />,
    );
    await screen.findByLabelText("Score page 1");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Development, measures 40 to 56",
      }),
    );

    const practice = screen.getByRole("tab", { name: "Practice" });
    const edit = screen.getByRole("tab", { name: "Edit" });
    practice.focus();
    fireEvent.keyDown(practice, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(edit));
    expect(edit.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "score-region-4-tab-edit",
    );
  });

  it("ignores a stale graph response after switching pieces", async () => {
    const oldRegion = {
      id: 4,
      piece_id: 7,
      name: "Old piece section",
      notes: null,
      m_start: 1,
      m_end: 8,
      kind: "section",
      order: 0,
      color: null,
      pdf_anchor: null,
    };
    const newRegion = {
      id: 8,
      piece_id: 8,
      name: "New piece section",
      notes: null,
      m_start: 9,
      m_end: 16,
      kind: "section",
      order: 0,
      color: null,
      pdf_anchor: null,
    };
    let resolveOld!: (value: (typeof oldRegion)[]) => void;
    const oldRequest = new Promise<(typeof oldRegion)[]>((resolve) => {
      resolveOld = resolve;
    });
    const regions = vi.fn((pieceId: number) =>
      pieceId === 7 ? oldRequest : Promise.resolve([newRegion]),
    );
    const api = makeApi({ regions });
    const pdf = makePdf(1);
    const view = render(
      <ScoreView pieceId={7} api={api} adapter={pdf.adapter} />,
    );
    await waitFor(() => expect(regions).toHaveBeenCalledWith(7));

    view.rerender(<ScoreView pieceId={8} api={api} adapter={pdf.adapter} />);
    expect(
      await screen.findByRole("button", {
        name: "New piece section, measures 9 to 16",
      }),
    ).toBeTruthy();
    await act(async () => {
      resolveOld([oldRegion]);
      await Promise.resolve();
    });

    expect(
      screen.queryByRole("button", {
        name: "Old piece section, measures 1 to 8",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "New piece section, measures 9 to 16",
      }),
    ).toBeTruthy();
  });

  describe("piece-switch first-page cache", () => {
    // jsdom has no object-URL machinery; the preview path guards on it, so stub
    // it locally and always restore so no other test starts painting previews.
    function withObjectUrls<T>(body: () => Promise<T>): Promise<T> {
      const origCreate = (URL as unknown as { createObjectURL?: unknown })
        .createObjectURL;
      const origRevoke = (URL as unknown as { revokeObjectURL?: unknown })
        .revokeObjectURL;
      const createObjectURL = vi.fn(() => "blob:preview-url");
      const revokeObjectURL = vi.fn();
      (URL as unknown as { createObjectURL: unknown }).createObjectURL =
        createObjectURL;
      (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL =
        revokeObjectURL;
      const restore = () => {
        (URL as unknown as { createObjectURL: unknown }).createObjectURL =
          origCreate;
        (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL =
          origRevoke;
      };
      return body().finally(restore);
    }

    const pngBytes = () =>
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]).buffer;
    const preview = () =>
      document.querySelector<HTMLImageElement>(".score-first-page-preview");
    // 900×700 is the jsdom fallback viewport (clientWidth/Height are 0), Fit-page
    // is the default mode: this is the exact bucket the switch will request.
    const expectedBucket = fitContextBucket("page", 900, 700);

    it("paints a cached first-page bitmap instantly on switch, then swaps in the real page without flicker", async () =>
      withObjectUrls(async () => {
        let resolveBytes!: (value: ArrayBuffer) => void;
        const bytesForEight = new Promise<ArrayBuffer>((resolve) => {
          resolveBytes = resolve;
        });
        const bytes = vi.fn((pieceId: number) =>
          pieceId === 8 ? bytesForEight : Promise.resolve(new ArrayBuffer(8)),
        );
        // A hit only for the target piece; the source piece stays a clean miss.
        const loadFirstPage = vi.fn((pieceId: number) =>
          Promise.resolve(pieceId === 8 ? pngBytes() : new ArrayBuffer(0)),
        );
        const api = makeApi({ bytes, loadFirstPage });
        const pdf = makePdf(1);

        const view = render(
          <ScoreView pieceId={7} api={api} adapter={pdf.adapter} />,
        );
        await screen.findByLabelText("Score page 1");
        expect(preview()).toBeNull();

        // Switch to piece 8; its document bytes stay pending so we can observe
        // the instant cached paint while the real PDF is still "decoding".
        view.rerender(
          <ScoreView pieceId={8} api={api} adapter={pdf.adapter} />,
        );

        const shown = await waitFor(() => {
          const el = preview();
          expect(el).not.toBeNull();
          return el as HTMLImageElement;
        });
        expect(shown.getAttribute("src")).toBe("blob:preview-url");
        // The cache is display-only: aria-hidden keeps it out of the a11y tree,
        // and the real interaction guard is the doc-load gate below (no page, so
        // no RegionOverlay, mounts until the live document arrives).
        expect(shown.getAttribute("aria-hidden")).toBe("true");
        // The real page is not mounted yet — only the cached snapshot is showing.
        expect(screen.queryByLabelText("Score page 1")).toBeNull();
        expect(loadFirstPage).toHaveBeenCalledWith(8, "a", 1, expectedBucket);

        // The real document arrives; the true first page rasterizes and the
        // preview is retired in the same pass — no blank frame between them.
        await act(async () => {
          resolveBytes(new ArrayBuffer(8));
          await Promise.resolve();
          await Promise.resolve();
        });
        await screen.findByLabelText("Score page 1");
        await waitFor(() => expect(preview()).toBeNull());
      }));

    it("shows no preview and behaves exactly as today when the cache misses", async () =>
      withObjectUrls(async () => {
        let resolveBytes!: (value: ArrayBuffer) => void;
        const bytesForEight = new Promise<ArrayBuffer>((resolve) => {
          resolveBytes = resolve;
        });
        const bytes = vi.fn((pieceId: number) =>
          pieceId === 8 ? bytesForEight : Promise.resolve(new ArrayBuffer(8)),
        );
        // Every load is a miss (empty buffer) — the on-disk-empty / stale case.
        const loadFirstPage = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
        const createObjectURL = URL.createObjectURL as ReturnType<typeof vi.fn>;
        const api = makeApi({ bytes, loadFirstPage });
        const pdf = makePdf(1);

        const view = render(
          <ScoreView pieceId={7} api={api} adapter={pdf.adapter} />,
        );
        await screen.findByLabelText("Score page 1");

        view.rerender(
          <ScoreView pieceId={8} api={api} adapter={pdf.adapter} />,
        );
        // Wait until the switch is genuinely mid-load (bytes still pending).
        await screen.findByText("Loading PDF…");
        await waitFor(() =>
          expect(loadFirstPage).toHaveBeenCalledWith(8, "a", 1, expectedBucket),
        );
        // A miss never paints and never mints an object URL.
        expect(preview()).toBeNull();
        expect(createObjectURL).not.toHaveBeenCalled();

        await act(async () => {
          resolveBytes(new ArrayBuffer(8));
          await Promise.resolve();
          await Promise.resolve();
        });
        await screen.findByLabelText("Score page 1");
        expect(preview()).toBeNull();
      }));

    it("serves a switch-back across a REMOUNT from the shared memory cache — no second disk read", async () =>
      withObjectUrls(async () => {
        // Production switches piece via key={selectedId}, which unmounts and
        // remounts ScoreView. A per-instance cache can never serve that path;
        // this test bites if the LRU ever moves back inside the component.
        const loadFirstPage = vi.fn(() => Promise.resolve(new ArrayBuffer(4)));
        const api = makeApi({ loadFirstPage });
        const pdf = makePdf(1);

        // Mount #1: the disk hit paints a preview and seeds the SHARED cache.
        const first = render(
          <ScoreView
            key="mount-1"
            pieceId={8}
            api={api}
            adapter={pdf.adapter}
          />,
        );
        await waitFor(() =>
          expect(loadFirstPage).toHaveBeenCalledWith(8, "a", 1, expectedBucket),
        );
        await screen.findByLabelText("Score page 1");
        first.unmount();

        // Mount #2: a FRESH instance (the real production remount). The shared
        // memory tier must serve it; the disk tier must not be consulted again.
        render(
          <ScoreView
            key="mount-2"
            pieceId={8}
            api={api}
            adapter={pdf.adapter}
          />,
        );
        await waitFor(() => expect(preview()).not.toBeNull());
        expect(loadFirstPage).toHaveBeenCalledTimes(1);
      }));

    it("keys the cached snapshot by the current fit bucket so a stale-bucket entry is a miss, not a wrong-sized paint", async () =>
      withObjectUrls(async () => {
        const loadFirstPage = vi.fn(
          (
            _pieceId: number,
            _fingerprint: string,
            _page: number,
            bucket: string,
          ) =>
            // The persisted snapshot lives under a *different* (stale) bucket;
            // the request for the current bucket therefore misses.
            Promise.resolve(
              bucket === "page-99x99" ? pngBytes() : new ArrayBuffer(0),
            ),
        );
        const createObjectURL = URL.createObjectURL as ReturnType<typeof vi.fn>;
        const api = makeApi({ loadFirstPage });
        const pdf = makePdf(1);

        render(<ScoreView pieceId={8} api={api} adapter={pdf.adapter} />);
        await screen.findByLabelText("Score page 1");

        expect(loadFirstPage).toHaveBeenCalledWith(8, "a", 1, expectedBucket);
        expect(expectedBucket).not.toBe("page-99x99");
        // The stale-bucket entry was never painted.
        expect(preview()).toBeNull();
        expect(createObjectURL).not.toHaveBeenCalled();
      }));
  });

  it("shows an honest no-PDF state", async () => {
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ editions: vi.fn().mockResolvedValue([]) })}
        adapter={makePdf().adapter}
      />,
    );
    expect(await screen.findByText("No PDF score found.")).toBeTruthy();
  });

  it("shows load failures and retries the edition request", async () => {
    const editions = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend unavailable"))
      .mockResolvedValueOnce([]);
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ editions })}
        adapter={makePdf().adapter}
      />,
    );
    expect(await screen.findByText("backend unavailable")).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("No PDF score found.")).toBeTruthy();
    expect(editions).toHaveBeenCalledTimes(2);
  });

  it("turns a stalled PDF read into a retryable error instead of spinning forever", async () => {
    const stalled = new Promise<ArrayBuffer>(() => undefined);
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ bytes: vi.fn().mockReturnValue(stalled) })}
        adapter={makePdf().adapter}
        loadTimeoutMs={20}
      />,
    );

    expect(
      await screen.findByText(
        "The PDF file took too long to read. Try again or choose another edition.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("retries a failed PDF exactly once after refreshing its editions", async () => {
    const bytes = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValueOnce(new ArrayBuffer(8));
    const api = makeApi({ bytes });
    const pdf = makePdf();
    render(<ScoreView pieceId={7} api={api} adapter={pdf.adapter} />);

    expect(await screen.findByText("temporary read failure")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText("Score page 1");

    expect(api.editions).toHaveBeenCalledTimes(2);
    expect(bytes).toHaveBeenCalledTimes(2);
    expect(pdf.adapter.load).toHaveBeenCalledTimes(1);
  });

  it("warms the PDF.js runtime alongside the edition lookup, not after it", async () => {
    const pdf = makePdf(1);
    let releaseEditions: (value: PdfEdition[]) => void = () => undefined;
    const editions = vi.fn(
      () => new Promise<PdfEdition[]>((resolve) => (releaseEditions = resolve)),
    );
    const prefetch = vi.fn();
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ editions })}
        adapter={{ ...pdf.adapter, prefetch }}
      />,
    );

    // The ~1.7 MB runtime import does not depend on which edition wins, so it
    // must already be in flight while the edition scan is still outstanding.
    await waitFor(() => expect(prefetch).toHaveBeenCalledTimes(1));
    expect(pdf.adapter.load).not.toHaveBeenCalled();
    releaseEditions(EDITIONS);
    await screen.findByLabelText("Score page 1");
  });

  it("range-loads the selected edition off the score protocol instead of over IPC", async () => {
    const pdf = makePdf(1);
    const loadUrl = vi.fn().mockResolvedValue(pdf.document);
    const api = makeApi();
    render(
      <ScoreView pieceId={7} api={api} adapter={{ ...pdf.adapter, loadUrl }} />,
    );

    await screen.findByLabelText("Score page 1");
    expect(loadUrl).toHaveBeenCalledWith(
      "ckscore://localhost/7/urtext",
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(api.bytes).not.toHaveBeenCalled();
    expect(pdf.adapter.load).not.toHaveBeenCalled();
  });

  it("falls back to the IPC byte path when the score protocol is unavailable", async () => {
    const pdf = makePdf(1);
    const loadUrl = vi
      .fn()
      .mockRejectedValue(new Error("ckscore is not registered here"));
    const api = makeApi();
    render(
      <ScoreView pieceId={7} api={api} adapter={{ ...pdf.adapter, loadUrl }} />,
    );

    // A browser dev session (or a webview that refuses the scheme) must still
    // open the score rather than show an error.
    await screen.findByLabelText("Score page 1");
    expect(loadUrl).toHaveBeenCalledTimes(1);
    expect(api.bytes).toHaveBeenCalledWith(7, "urtext");
    expect(pdf.adapter.load).toHaveBeenCalledTimes(1);
  });

  it("parses a real PDF through the WebKit-compatible legacy loopback worker", async () => {
    const document = await pdfJsAdapter.load(makeMinimalPdf(), {
      timeoutMs: 5_000,
    });
    expect(document.numPages).toBe(1);
    const page = await document.getPage(1);
    expect(page.width).toBe(612);
    expect(page.height).toBe(792);
    page.cleanup();
    await document.destroy();
  });

  it("configures every bundled decoder path for scanned score pages", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getDocument = vi.fn(
      (_options: unknown) =>
        ({
          promise: Promise.resolve({ numPages: 1, getPage: vi.fn() }),
          destroy,
        }) as unknown as PDFDocumentLoadingTask,
    );
    const adapter = createPdfJsAdapter(async () => ({ getDocument }));

    const document = await adapter.load(makeMinimalPdf(), { timeoutMs: 1_000 });
    const options = getDocument.mock.calls[0][0] as Record<string, unknown>;
    expect(options.cMapUrl).toMatch(/\/pdfjs\/cmaps\/$/);
    expect(options.iccUrl).toMatch(/\/pdfjs\/iccs\/$/);
    expect(options.standardFontDataUrl).toMatch(/\/pdfjs\/standard_fonts\/$/);
    expect(options.wasmUrl).toMatch(/\/pdfjs\/wasm\/$/);
    expect(options).toMatchObject({
      cMapPacked: true,
      useWorkerFetch: true,
      useWasm: true,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
    });
    await document.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("range-loads from the score protocol with disableAutoFetch on", async () => {
    // Without `disableAutoFetch` PDF.js walks the whole file anyway, so the
    // range protocol would cost a round trip and buy nothing.
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array(65536), {
          status: 206,
          headers: { "Content-Range": "bytes 0-65535/1000000" },
        }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const getDocument = vi.fn(
        (_options: unknown) =>
          ({
            promise: Promise.resolve({ numPages: 3, getPage: vi.fn() }),
            destroy: vi.fn().mockResolvedValue(undefined),
          }) as unknown as PDFDocumentLoadingTask,
      );
      class FakeTransport {
        length: number;
        constructor(length: number) {
          this.length = length;
        }
        onDataRange() {}
        abort() {}
      }
      const adapter = createPdfJsAdapter(async () => ({
        getDocument,
        PDFDataRangeTransport: FakeTransport as never,
      }));

      const document = await adapter.loadUrl!("ckscore://localhost/7/a.pdf", {
        timeoutMs: 1_000,
      });
      expect(document.numPages).toBe(3);
      expect(fetchImpl.mock.calls[0][1]).toMatchObject({
        headers: { Range: "bytes=0-65535" },
      });
      const options = getDocument.mock.calls[0][0] as Record<string, unknown>;
      expect(options).toMatchObject({
        disableAutoFetch: true,
        disableStream: false,
        rangeChunkSize: 65536,
        isImageDecoderSupported: false,
      });
      expect(options.range).toBeInstanceOf(FakeTransport);
      expect((options.range as FakeTransport).length).toBe(1000000);
      expect(options.data).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("takes the plain byte path when the protocol returns the whole small edition", async () => {
    const whole = new Uint8Array(makeMinimalPdf());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(whole, { status: 200 })),
    );
    try {
      const document = await pdfJsAdapter.loadUrl!(
        "ckscore://localhost/7/a.pdf",
        { timeoutMs: 5_000 },
      );
      expect(document.numPages).toBe(1);
      await document.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects loadUrl when the protocol is unreachable, so the viewer can fall back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    try {
      await expect(
        pdfJsAdapter.loadUrl!("ckscore://localhost/7/a.pdf", {
          timeoutMs: 1_000,
        }),
      ).rejects.toThrow("answered 404");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives up on a silent score protocol quickly instead of burning the load budget", async () => {
    // A webview that swallows the custom scheme must cost a short probe, not
    // the full 30 s document deadline, before the byte path takes over.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    try {
      const started = Date.now();
      await expect(
        pdfJsAdapter.loadUrl!("ckscore://localhost/7/a.pdf", {
          timeoutMs: 50,
        }),
      ).rejects.toThrow("The score protocol did not answer in time.");
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shares one runtime import between prefetch and load", async () => {
    const loadRuntime = vi.fn(async () => ({
      getDocument: vi.fn(
        () =>
          ({
            promise: Promise.resolve({ numPages: 1, getPage: vi.fn() }),
            destroy: vi.fn().mockResolvedValue(undefined),
          }) as unknown as PDFDocumentLoadingTask,
      ),
    }));
    const adapter = createPdfJsAdapter(loadRuntime);
    adapter.prefetch!();
    adapter.prefetch!();
    await adapter.load(makeMinimalPdf(), { timeoutMs: 1_000 });
    expect(loadRuntime).toHaveBeenCalledTimes(1);
  });

  it("rejects on deadline even when PDF.js startup and cleanup both never settle", async () => {
    const destroy = vi.fn(() => new Promise<void>(() => undefined));
    const task = {
      promise: new Promise<never>(() => undefined),
      destroy,
    };
    const adapter = createPdfJsAdapter(async () => ({
      getDocument: vi.fn(() => task as unknown as PDFDocumentLoadingTask),
    }));

    await expect(
      adapter.load(makeMinimalPdf(), { timeoutMs: 20 }),
    ).rejects.toThrow("PDF rendering did not start in time");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("mounts only the current page plus a buffered neighbor and evicts the rest when paging", async () => {
    const pdf = makePdf(5);
    render(<ScoreView pieceId={7} api={makeApi()} adapter={pdf.adapter} />);

    await screen.findByLabelText("Score page 1");
    // Default paged view: current page + one buffered neighbor mount canvases;
    // never the whole 5-page strip. The visible page decodes first — the
    // neighbor warms up only after idle (heavy-scan jank fix).
    expect(pdf.getPage.mock.calls[0][0]).toBe(1);
    await waitFor(() =>
      expect(new Set(pdf.getPage.mock.calls.map((call) => call[0]))).toEqual(
        new Set([1, 2]),
      ),
    );
    expect(screen.getAllByLabelText(/^Score page \d+$/)).toHaveLength(2);
    const firstCanvas = screen.getByLabelText(
      "Rendered score page 1",
    ) as HTMLCanvasElement;
    expect(firstCanvas.width).toBe(1200);

    fireEvent.change(screen.getByLabelText("Page number"), {
      target: { value: "4" },
    });
    fireEvent.submit(screen.getByLabelText("Page number").closest("form")!);

    await screen.findByLabelText("Score page 4");
    await waitFor(() => {
      expect(new Set(pdf.getPage.mock.calls.map((call) => call[0]))).toEqual(
        new Set([1, 2, 3, 4, 5]),
      );
    });
    // Page 1 unmounted entirely — gone from the DOM (its canvas node, and the
    // bitmap it held, released with the node).
    expect(screen.queryByLabelText("Score page 1")).toBeNull();
    expect(screen.queryByLabelText("Rendered score page 1")).toBeNull();
    expect(screen.getByLabelText("Page number").getAttribute("value")).toBe(
      "4",
    );
    // At most three pages ever mounted (current 4 ± 1) — proven virtualization.
    expect(screen.getAllByLabelText(/^Score page \d+$/)).toHaveLength(3);
  });

  it("does not capture global paging keys while cached behind another workspace", async () => {
    render(
      <ScoreView
        pieceId={7}
        isActive={false}
        api={makeApi()}
        adapter={makePdf(5).adapter}
      />,
    );
    await screen.findByLabelText("Score page 1");

    const key = new KeyboardEvent("keydown", {
      key: "PageDown",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(key);

    expect(key.defaultPrevented).toBe(false);
    expect(
      (screen.getByLabelText("Page number") as HTMLInputElement).value,
    ).toBe("1");
  });

  it("persists edition selection before loading the new PDF", async () => {
    const api = makeApi();
    const pdf = makePdf(2);
    render(<ScoreView pieceId={12} api={api} adapter={pdf.adapter} />);
    await screen.findByLabelText("Score page 2");

    fireEvent.change(screen.getByLabelText("Score edition"), {
      target: { value: "fingered" },
    });
    await waitFor(() =>
      expect(api.select).toHaveBeenCalledWith(12, "fingered"),
    );
    await waitFor(() =>
      expect(api.bytes).toHaveBeenLastCalledWith(12, "fingered"),
    );
  });

  it("supports zoom controls and direct page jumps", async () => {
    const pdf = makePdf(4);
    render(<ScoreView pieceId={7} api={makeApi()} adapter={pdf.adapter} />);
    await screen.findByLabelText("Score page 1");

    const before = screen.getByLabelText("Zoom level").textContent;
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByLabelText("Zoom level").textContent).not.toBe(before);

    fireEvent.change(screen.getByLabelText("Page number"), {
      target: { value: "4" },
    });
    fireEvent.submit(screen.getByLabelText("Page number").closest("form")!);
    await screen.findByLabelText("Score page 4");
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled();
    expect(screen.getByLabelText("Page number").getAttribute("value")).toBe(
      "4",
    );
  });

  it("resizes the page within the frame on zoom but debounces the crisp re-render", async () => {
    const pdf = makeSizedPdf();
    render(<ScoreView pieceId={7} api={makeApi()} adapter={pdf.adapter} />);
    const page = await screen.findByLabelText("Score page 1");
    await waitFor(() => expect(pdf.getPage).toHaveBeenCalledTimes(1));

    const widthBefore = Number.parseFloat(page.style.width);
    const rasterBefore = pdf.getPage.mock.calls.length;

    fireEvent.click(screen.getByLabelText("Zoom in"));

    // Instant: the page box grows the same tick the button is pressed…
    expect(Number.parseFloat(page.style.width)).toBeGreaterThan(widthBefore);
    // …but PDF.js is NOT invoked on the input path — no synchronous re-raster.
    expect(pdf.getPage.mock.calls.length).toBe(rasterBefore);
    // The sharp bitmap is rasterized exactly once, after the zoom settles.
    await waitFor(() =>
      expect(pdf.getPage.mock.calls.length).toBeGreaterThan(rasterBefore),
    );
  });

  it("does not re-rasterize page canvases while drawing a selection", async () => {
    const region = {
      id: 4,
      piece_id: 7,
      name: "Development",
      notes: "Even groups",
      m_start: 40,
      m_end: 56,
      kind: "section",
      order: 0,
      color: "#8b7cf6",
      pdf_anchor: null,
    };
    const pdf = makeSizedPdf();
    render(
      <ScoreView
        pieceId={7}
        api={makeApi({ regions: vi.fn().mockResolvedValue([region]) })}
        adapter={pdf.adapter}
      />,
    );
    await screen.findByLabelText("Score page 1");
    await waitFor(() => expect(pdf.getPage).toHaveBeenCalledTimes(1));

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Development, measures 40 to 56",
      }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Score marks" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit score annotations for Development",
      }),
    );

    // Freeze the rasterize count once mapping mode is armed; the drag below must
    // not move it — a drag-select is overlay-only and never touches the bitmap.
    const overlay = screen.getByTestId("page-overlay-1");
    const rasterBefore = pdf.getPage.mock.calls.length;
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(overlay, {
      pointerId: 1,
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerMove(overlay, {
      pointerId: 1,
      clientX: 500,
      clientY: 400,
    });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 500, clientY: 400 });

    // The draft rect now lives in ScoreView state and re-rendered the overlay,
    // but the page bitmap was never re-decoded.
    expect(pdf.getPage.mock.calls.length).toBe(rasterBefore);
  });

  it("sends one validated, idempotent Score Atlas payload from a drawn, confirmed target", async () => {
    const createTarget = vi
      .fn()
      .mockImplementation(async (payload) => synthesizeSavedRegion(payload));
    const api = makeApi({
      regions: vi.fn().mockResolvedValue([mappedRegion()]),
      createTarget,
    });
    render(<ScoreView pieceId={7} api={api} adapter={makePdf(1).adapter} />);
    await screen.findByLabelText("Score page 1");

    await drawAndConfirmTarget();
    fireEvent.change(screen.getByLabelText("Target title"), {
      target: { value: "Coda leap" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));

    await waitFor(() => expect(createTarget).toHaveBeenCalledTimes(1));
    const payload = createTarget.mock.calls[0][0] as AtomicTargetSavePayload;
    expect(payload).toMatchObject({
      piece_id: 7,
      title: "Coda leap",
      asserted_measure_range: { m_start: 40, m_end: 56 },
      edition: { edition_id: "urtext", edition_fingerprint: "a" },
    });
    expect(typeof payload.command_id).toBe("string");
    expect(payload.command_id).toBeTruthy();
    expect(payload.anchor).toMatchObject({
      schema_version: 1,
      edition_id: "urtext",
      edition_fingerprint: "a",
    });
    expect(payload.anchor!.rects[0]).toMatchObject({
      page: 1,
      x: 0.1,
      y: 0.25,
      w: 0.4,
      h: 0.25,
    });
    expect(payload.mapping_evidence!.status).toBe("calibrated_user_confirmed");
  });

  it("rounds a successful save into a selected, selectable Region", async () => {
    const onRegionsChanged = vi.fn();
    const api = makeApi({
      regions: vi.fn().mockResolvedValue([mappedRegion()]),
    });
    render(
      <ScoreView
        pieceId={7}
        api={api}
        adapter={makePdf(1).adapter}
        onRegionsChanged={onRegionsChanged}
      />,
    );
    await screen.findByLabelText("Score page 1");

    await drawAndConfirmTarget();
    fireEvent.change(screen.getByLabelText("Target title"), {
      target: { value: "Coda leap" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));

    expect(await screen.findByText(/Target saved as .Coda leap./)).toBeTruthy();
    const savedRow = await screen.findByRole("button", {
      name: "Coda leap, measures 40 to 56",
    });
    expect(savedRow.className).toContain("is-selected");
    await waitFor(() => expect(onRegionsChanged).toHaveBeenCalledTimes(1));
    // The drawing draft closed once the target became a real Region.
    expect(screen.queryByRole("button", { name: "Cancel drawing" })).toBeNull();
  });

  it("surfaces a save failure and preserves the open draft", async () => {
    const createTarget = vi
      .fn()
      .mockRejectedValue(new Error("Native target save failed."));
    const api = makeApi({
      regions: vi.fn().mockResolvedValue([mappedRegion()]),
      createTarget,
    });
    render(<ScoreView pieceId={7} api={api} adapter={makePdf(1).adapter} />);
    await screen.findByLabelText("Score page 1");

    await drawAndConfirmTarget();
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));

    expect(await screen.findByText("Native target save failed.")).toBeTruthy();
    // The draft stays open so the drawn target is not lost.
    expect(screen.getByRole("button", { name: "Save target" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel drawing" })).toBeTruthy();
  });

  it("restores the tricky-sections sidebar after switching pieces mid-draft", async () => {
    const pdf = makePdf(1);
    const api = makeApi();
    const view = render(
      <ScoreView pieceId={7} api={api} adapter={pdf.adapter} />,
    );
    await screen.findByLabelText("Score page 1");

    fireEvent.click(screen.getByRole("button", { name: "Draw target" }));
    expect(document.querySelector(".score-body")?.className).toContain(
      "is-sections-hidden",
    );

    view.rerender(<ScoreView pieceId={8} api={api} adapter={pdf.adapter} />);
    await screen.findByLabelText("Score page 1");
    expect(document.querySelector(".score-body")?.className).not.toContain(
      "is-sections-hidden",
    );
  });

  // --- Map-this-score calibration integration ---

  function calibrationView(
    points: { page: number; y: number; measure: number }[],
  ) {
    return {
      piece_id: 7,
      edition_id: "urtext",
      edition_fingerprint: "a",
      method: "user_confirmed",
      confidence: 0.75,
      points,
      user_verified: true,
      updated_ts: "2026-07-16T00:00:00Z",
    };
  }

  function mockOverlayRect(overlay: HTMLElement) {
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    });
  }

  it("resolves a drawn box to measures from saved calibration (no mapping-required dead end)", async () => {
    const calib = {
      get: vi.fn().mockResolvedValue(
        calibrationView([
          { page: 1, y: 0.2, measure: 45 },
          { page: 1, y: 0.34, measure: 52 },
        ]),
      ),
      save: vi.fn(),
    };
    render(
      <ScoreView
        pieceId={7}
        api={makeApi()}
        calibrationApi={calib}
        adapter={makePdf(1).adapter}
      />,
    );
    await screen.findByLabelText("Score page 1");
    await waitFor(() => expect(calib.get).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Draw target" }));
    const overlay = await screen.findByTestId("atlas-target-overlay-1");
    mockOverlayRect(overlay);
    // A box fully inside the first (bounded) system → a confident candidate.
    fireEvent.pointerDown(overlay, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 176,
    });
    fireEvent.pointerMove(overlay, {
      pointerId: 1,
      clientX: 500,
      clientY: 240,
    });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 500, clientY: 240 });

    const start = await screen.findByLabelText("Candidate start measure");
    expect(Number((start as HTMLInputElement).value)).toBeGreaterThanOrEqual(
      45,
    );
    expect(Number((start as HTMLInputElement).value)).toBeLessThanOrEqual(52);
    expect(
      screen.queryByRole("button", { name: "Map this score →" }),
    ).toBeNull();
  });

  it("auto-offers the wizard the first time a box is drawn on an unmapped edition", async () => {
    const calib = { get: vi.fn().mockResolvedValue(null), save: vi.fn() };
    render(
      <ScoreView
        pieceId={7}
        api={makeApi()}
        calibrationApi={calib}
        adapter={makePdf(1).adapter}
      />,
    );
    await screen.findByLabelText("Score page 1");
    await waitFor(() => expect(calib.get).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Draw target" }));
    const overlay = await screen.findByTestId("atlas-target-overlay-1");
    mockOverlayRect(overlay);
    fireEvent.pointerDown(overlay, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerMove(overlay, {
      pointerId: 1,
      clientX: 500,
      clientY: 400,
    });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 500, clientY: 400 });

    expect(
      await screen.findByRole("heading", {
        name: "Mark where each system starts.",
      }),
    ).toBeTruthy();
  });

  it("exposes a Map-this-score entry point in the toolbar", async () => {
    const calib = { get: vi.fn().mockResolvedValue(null), save: vi.fn() };
    render(
      <ScoreView
        pieceId={7}
        api={makeApi()}
        calibrationApi={calib}
        adapter={makePdf(1).adapter}
      />,
    );
    await screen.findByLabelText("Score page 1");
    expect(screen.getByRole("button", { name: "Map this score" })).toBeTruthy();
  });

  it("renders the real score page inside the wizard pane (renderPage wired)", async () => {
    const calib = { get: vi.fn().mockResolvedValue(null), save: vi.fn() };
    render(
      <ScoreView
        pieceId={7}
        api={makeApi()}
        calibrationApi={calib}
        adapter={makePdf(2).adapter}
      />,
    );
    await screen.findByLabelText("Score page 1");
    fireEvent.click(screen.getByRole("button", { name: "Map this score" }));

    const pane = await screen.findByTestId("map-wizard-page-surface");
    // The real engraving (a PdfPage canvas), not the "Page 1" placeholder.
    expect(within(pane).getByLabelText("Rendered score page 1")).toBeTruthy();
    expect(within(pane).queryByText("Page 1")).toBeNull();
  });

  it("maps MusicXML measure facts into the wizard strip", async () => {
    const calib = { get: vi.fn().mockResolvedValue(null), save: vi.fn() };
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "score_xml_measure_facts"
        ? Promise.resolve({
            measures: [
              { number: 1, time: "3/4" },
              { number: 9, rehearsal: "A" },
            ],
            max_measure: 12,
            has_pickup: false,
          })
        : Promise.resolve(undefined),
    );
    render(
      <ScoreView
        pieceId={7}
        api={makeApi()}
        calibrationApi={calib}
        adapter={makePdf(1).adapter}
      />,
    );
    await screen.findByLabelText("Score page 1");
    fireEvent.click(screen.getByRole("button", { name: "Map this score" }));

    // With the XML total known the strip enumerates measures even before any
    // anchor is placed, and the mapped landmarks label their rows.
    expect(
      await screen.findByRole("button", { name: "Measure 12" }),
    ).toBeTruthy();
    expect(await screen.findByText("A")).toBeTruthy();
    expect(screen.getByText("3/4")).toBeTruthy();
  });

  it("works from anchors alone when the piece has no MusicXML", async () => {
    const calib = { get: vi.fn().mockResolvedValue(null), save: vi.fn() };
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "score_xml_measure_facts"
        ? Promise.reject("This piece has no MusicXML file.")
        : Promise.resolve(undefined),
    );
    render(
      <ScoreView
        pieceId={7}
        api={makeApi()}
        calibrationApi={calib}
        adapter={makePdf(1).adapter}
      />,
    );
    await screen.findByLabelText("Score page 1");
    fireEvent.click(screen.getByRole("button", { name: "Map this score" }));

    // The wizard still opens and shows the page; with no anchors and no XML total
    // the strip is empty, exactly as before this wiring existed.
    expect(
      await screen.findByRole("heading", {
        name: "Mark where each system starts.",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Mark a system to build the strip.")).toBeTruthy();
  });
});

// The screen-resolution page-image fast path, wired end to end through the
// viewer. The measured problem it exists for: page 1 of the Barber Pas de Deux
// (a 24-bit colour scan with an ICC profile) takes 43 s through PDF.js and
// ~0.08 s through Rust. The viewer therefore asks Rust first and keeps PDF.js as
// the fallback for everything Rust declines.
describe("ScoreView — page-image fast path", () => {
  function pageImageApi(
    answer: (page: number) => ArrayBuffer = () =>
      new Uint8Array([0xff, 0xd8, 0xff]).buffer,
  ) {
    const pageImage = vi.fn(
      async (_piece: number, _edition: string, page: number) => answer(page),
    );
    const warmPageImage = vi.fn().mockResolvedValue(undefined);
    return { pageImage, warmPageImage };
  }

  it("shows the Rust page image for the visible page instead of rasterizing it", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 1536,
      height: 2048,
      close: vi.fn(),
    }));
    const { pageImage, warmPageImage } = pageImageApi();
    const api = makeApi({ pageImage, warmPageImage });
    const pdf = makePdf(6);

    render(<ScoreView pieceId={7} api={api} adapter={pdf.adapter} />);
    await screen.findByLabelText("Score page 1");
    await waitFor(() =>
      expect(
        screen.getByLabelText("Score page 1").getAttribute("data-source"),
      ).toBe("image"),
    );
    // Bound to the piece and the edition actually open.
    expect(pageImage).toHaveBeenCalledWith(7, "urtext", 1, expect.any(Number));
  });

  it("falls back to the real renderer, with a real page, when Rust refuses", async () => {
    const { pageImage, warmPageImage } = pageImageApi(() => new ArrayBuffer(0));
    const api = makeApi({ pageImage, warmPageImage });
    const pdf = makePdf(6);

    render(<ScoreView pieceId={7} api={api} adapter={pdf.adapter} />);
    const page = await screen.findByLabelText("Score page 1");
    await waitFor(() => expect(pageImage).toHaveBeenCalled());
    await waitFor(() => expect(page.getAttribute("data-source")).toBe("pdf"));
    const canvas = screen.getByLabelText(
      "Rendered score page 1",
    ) as HTMLCanvasElement;
    expect(canvas.width).toBe(1200);
    expect(page.className).toContain("is-ready");
  });

  it("warms the page after next in the background, and never the visible one", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 1536,
      height: 2048,
      close: vi.fn(),
    }));
    const { pageImage, warmPageImage } = pageImageApi();
    const api = makeApi({ pageImage, warmPageImage });
    const pdf = makePdf(6);

    render(<ScoreView pieceId={7} api={api} adapter={pdf.adapter} />);
    await screen.findByLabelText("Score page 1");
    await waitFor(() => expect(warmPageImage).toHaveBeenCalled());
    const warmed = warmPageImage.mock.calls.map((call) => call[2]);
    // Page 3 is the first page NOT already mounted (the viewer mounts 1 ±1),
    // so warming is genuinely extra reach rather than duplicated work.
    expect(warmed).toContain(3);
    expect(warmed).not.toContain(1);
    expect(warmed).not.toContain(2);
  });

  it("works unchanged against a host with no page-image commands", async () => {
    const api = makeApi();
    const pdf = makePdf(3);
    render(<ScoreView pieceId={7} api={api} adapter={pdf.adapter} />);
    const page = await screen.findByLabelText("Score page 1");
    await waitFor(() => expect(page.getAttribute("data-source")).toBe("pdf"));
  });
});

// ── Measure mapping (Plan C, task C4) ───────────────────────────────────────

describe("ScoreView measure mapping", () => {
  afterEach(() => {
    resetMeasureMapStoreForTests();
  });

  function sampleMap(): MeasureMapPageRow[] {
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
                { x_right: 0.3, number: 1, source: "model" },
                { x_right: 0.6, number: 2, source: "model" },
              ],
            },
          ],
        },
      },
    ];
  }

  it("shows the Map measures button once an edition is ready, and opens the panel", async () => {
    const pdf = makePdf(3);
    render(<ScoreView pieceId={7} api={makeApi()} adapter={pdf.adapter} />);
    await screen.findByLabelText("Score page 1");

    const button = screen.getByText("Map measures");
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(await screen.findByTestId("measure-map-panel")).toBeTruthy();
    expect(screen.getByText(/3 pages/)).toBeTruthy();
  });

  it("disables Map measures while the document is still loading (no ready edition yet)", async () => {
    // An adapter whose `load` never resolves freezes the view at
    // "loading-document" — editions have resolved (so the toolbar renders)
    // but `phase !== 'ready'` yet.
    const adapter = {
      load: vi.fn(() => new Promise<never>(() => undefined)),
    };
    render(<ScoreView pieceId={7} api={makeApi()} adapter={adapter} />);
    const button = await screen.findByText("Map measures");
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("title")).toMatch(/still loading/i);
    const mapScore = screen.getByText("Map this score");
    expect(mapScore).toHaveProperty("disabled", true);
    expect(mapScore.getAttribute("title")).toMatch(/still loading/i);
  });

  it("the Show measures toggle persists and reveals cached bar numbers", async () => {
    publishMeasureMap(7, "urtext", "a", sampleMap());
    const pdf = makePdf(3);
    render(<ScoreView pieceId={7} api={makeApi()} adapter={pdf.adapter} />);
    await screen.findByLabelText("Score page 1");

    const toggle = screen.getByText("Show measures");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(await screen.findAllByTestId("measure-map-number")).toHaveLength(2);
    expect(screen.getByText("Hide measures").getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByText("Hide measures"));
    expect(screen.queryAllByTestId("measure-map-number")).toHaveLength(0);
  });

  it("always shows the stale notice when the cached map's fingerprint no longer matches the edition", async () => {
    publishMeasureMap(7, "urtext", "stale-fingerprint", sampleMap());
    const pdf = makePdf(3);
    render(<ScoreView pieceId={7} api={makeApi()} adapter={pdf.adapter} />);
    await screen.findByLabelText("Score page 1");

    expect(await screen.findByTestId("measure-map-stale")).toBeTruthy();
  });

  /** Drag a create-selection across page 1's overlay. */
  async function dragOnPageOne() {
    const overlay = await screen.findByTestId("page-overlay-1");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(overlay, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(overlay, {
      pointerId: 1,
      clientX: 500,
      clientY: 400,
    });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 500, clientY: 400 });
  }

  it("Task C5: a drag with no map at all says the page isn't mapped yet", async () => {
    render(
      <ScoreView pieceId={7} api={makeApi()} adapter={makePdf(3).adapter} />,
    );
    await screen.findByLabelText("Score page 1");
    await dragOnPageOne();

    expect(await screen.findByText(/isn't mapped yet/)).toBeTruthy();
    expect(screen.queryByText(/stale for this edition/)).toBeNull();
  });

  it("Task C5: a drag on a page whose map is stale says so instead of 'not mapped yet'", async () => {
    publishMeasureMap(7, "urtext", "stale-fingerprint", sampleMap());
    render(
      <ScoreView pieceId={7} api={makeApi()} adapter={makePdf(3).adapter} />,
    );
    await screen.findByLabelText("Score page 1");
    await dragOnPageOne();

    expect(await screen.findByText(/stale for this edition/)).toBeTruthy();
    expect(screen.queryByText(/isn't mapped yet/)).toBeNull();
  });

  // -------------------------------------------------------------------
  // Task C — micro-targets v2: the button, zero-friction creation, gating,
  // one-click practice, undo. Christian's verdict on v7.1.0 was that the
  // sub-section box was "terrible" and required typing a name, typing two
  // measure numbers, and then drawing the same box a second time. Every
  // assertion below is one of those steps not happening.
  // -------------------------------------------------------------------
  describe("Task C: micro-targets v2", () => {
    /** A top-level section whose current-edition mark covers the whole page,
     * so any drag on page 1 lands inside it. */
    function spotParent(overrides: Record<string, unknown> = {}) {
      return {
        id: 4,
        piece_id: 7,
        name: "Rolled Chords",
        notes: null,
        m_start: 40,
        m_end: 56,
        kind: "hard_spot",
        order: 0,
        color: "#8b7cf6",
        parent_region_id: null,
        pdf_anchor: {
          v: 1,
          editions: {
            urtext: {
              fingerprint: "a",
              rects: [{ page: 1, x: 0, y: 0, w: 1, h: 1 }],
            },
          },
        },
        ...overrides,
      };
    }

    function spotChild(overrides: Record<string, unknown> = {}) {
      return {
        id: 55,
        piece_id: 7,
        name: "Spot 1",
        notes: null,
        m_start: 44,
        m_end: 46,
        kind: "hard_spot",
        order: 1,
        color: "#4ab5f2",
        parent_region_id: 4,
        pdf_anchor: {
          v: 1,
          editions: {
            urtext: {
              fingerprint: "a",
              rects: [{ page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.1 }],
            },
          },
        },
        ...overrides,
      };
    }

    /** `region_create` has to hand back a real Region receipt — the anchor
     * write chains off `created.id`, which is the whole fix. */
    function mockCreateReturning(id = 99) {
      invokeMock.mockImplementation((command: string) =>
        command === "region_create"
          ? Promise.resolve({ ...spotChild({ id, pdf_anchor: null }) })
          : Promise.resolve(undefined),
      );
    }

    async function selectParent() {
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Rolled Chords, measures 40 to 56",
        }),
      );
    }

    it("C1: shows ⊕ Isolate a spot on a selected top-level section; it arms, and Escape disarms", async () => {
      render(
        <ScoreView
          pieceId={7}
          api={makeApi({
            regions: vi.fn().mockResolvedValue([spotParent()]),
          })}
          adapter={makePdf(1).adapter}
        />,
      );
      await screen.findByLabelText("Score page 1");
      // Not offered until a section is actually selected.
      expect(
        screen.queryByRole("button", { name: "⊕ Isolate a spot" }),
      ).toBeNull();

      await selectParent();
      const arm = await screen.findByRole("button", {
        name: "⊕ Isolate a spot",
      });
      expect(arm.getAttribute("aria-pressed")).toBe("false");

      fireEvent.click(arm);
      const armed = screen.getByRole("button", {
        name: "Cancel — drag inside Rolled Chords",
      });
      expect(armed.getAttribute("aria-pressed")).toBe("true");
      expect(
        screen.getByText(
          /Drag a small box inside Rolled Chords on the score\. Esc to cancel\./i,
        ),
      ).toBeTruthy();
      expect(
        window.document.querySelector(".score-view")?.className,
      ).toContain("is-spot-armed");

      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "⊕ Isolate a spot" }).getAttribute(
            "aria-pressed",
          ),
        ).toBe("false"),
      );
      expect(
        window.document.querySelector(".score-view")?.className,
      ).not.toContain("is-spot-armed");
    });

    it("C2: a drag inside the selected parent creates the child outright — no form, no typing, no naming", async () => {
      mockCreateReturning(99);
      const api = makeApi({
        regions: vi.fn().mockResolvedValue([spotParent()]),
      });
      render(
        <ScoreView pieceId={7} api={api} adapter={makePdf(1).adapter} />,
      );
      await screen.findByLabelText("Score page 1");
      await selectParent();
      await dragOnPageOne();

      await waitFor(() =>
        expect(
          invokeMock.mock.calls.some(([cmd]) => cmd === "region_create"),
        ).toBe(true),
      );
      const create = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "region_create",
      )!;
      expect(create[1]).toMatchObject({
        parent_region_id: 4,
        args: {
          piece_id: 7,
          name: "Spot 1",
          notes: null,
          kind: "hard_spot",
          // Interpolated from where the drag landed inside the parent's own
          // 40–56, with no measure map anywhere — B75's reality.
          m_start: 41,
          m_end: 48,
        },
      });

      // The form is the thing being replaced: it must never appear.
      expect(
        screen.queryByLabelText("New score tricky section title"),
      ).toBeNull();
      expect(screen.queryByRole("tab", { name: "Score marks" })?.getAttribute(
        "aria-selected",
      )).not.toBe("true");
    });

    it("C2: writes the dragged rect as the new child's anchor in the SAME flow (the bug that made v7.1.0 useless)", async () => {
      mockCreateReturning(99);
      const api = makeApi({
        regions: vi.fn().mockResolvedValue([spotParent()]),
      });
      render(
        <ScoreView pieceId={7} api={api} adapter={makePdf(1).adapter} />,
      );
      await screen.findByLabelText("Score page 1");
      await selectParent();
      await dragOnPageOne();

      await waitFor(() => expect(api.updateRegion).toHaveBeenCalled());
      expect(api.updateRegion).toHaveBeenCalledWith(99, {
        v: 1,
        editions: {
          urtext: {
            fingerprint: "a",
            rects: [{ page: 1, x: 0.1, y: 0.125, w: 0.4, h: 0.375 }],
          },
        },
      });
    });

    it("C2: the button arms creation for a drag that lands outside the parent's own box", async () => {
      mockCreateReturning(99);
      const api = makeApi({
        // A parent with a mark that covers only the top strip: the drag below
        // ends up outside it, so only the ARMED state can make this a spot.
        regions: vi.fn().mockResolvedValue([
          spotParent({
            pdf_anchor: {
              v: 1,
              editions: {
                urtext: {
                  fingerprint: "a",
                  rects: [{ page: 1, x: 0, y: 0, w: 1, h: 0.05 }],
                },
              },
            },
          }),
        ]),
      });
      render(
        <ScoreView pieceId={7} api={api} adapter={makePdf(1).adapter} />,
      );
      await screen.findByLabelText("Score page 1");
      await selectParent();

      // Unarmed, the same drag opens the ordinary top-level add form.
      await dragOnPageOne();
      expect(
        await screen.findByLabelText("New score tricky section title"),
      ).toBeTruthy();
      expect(
        invokeMock.mock.calls.some(([cmd]) => cmd === "region_create"),
      ).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "⊕ Isolate a spot" }));
      await dragOnPageOne();
      await waitFor(() =>
        expect(
          invokeMock.mock.calls.some(([cmd]) => cmd === "region_create"),
        ).toBe(true),
      );
      // And the arm is spent, not sticky.
      await waitFor(() =>
        expect(
          window.document.querySelector(".score-view")?.className,
        ).not.toContain("is-spot-armed"),
      );
    });

    it("C3: a spot is drawn on the score only while its parent is selected", async () => {
      render(
        <ScoreView
          pieceId={7}
          api={makeApi({
            regions: vi.fn().mockResolvedValue([spotParent(), spotChild()]),
          })}
          adapter={makePdf(1).adapter}
        />,
      );
      await screen.findByLabelText("Score page 1");
      expect(
        screen.queryByRole("button", { name: "Spot 1, box on page 1" }),
      ).toBeNull();

      await selectParent();
      const box = await screen.findByRole("button", {
        name: "Spot 1, box on page 1",
      });
      // Calm styling: a spot must never read as a full tricky section.
      expect(box.className).toContain("is-child");
    });

    it("C3: Hide spots removes them from the score and persists per piece", async () => {
      render(
        <ScoreView
          pieceId={7}
          api={makeApi({
            regions: vi.fn().mockResolvedValue([spotParent(), spotChild()]),
          })}
          adapter={makePdf(1).adapter}
        />,
      );
      await screen.findByLabelText("Score page 1");
      await selectParent();
      await screen.findByRole("button", { name: "Spot 1, box on page 1" });

      fireEvent.click(screen.getByRole("button", { name: "Hide spots (1)" }));
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Spot 1, box on page 1" }),
        ).toBeNull(),
      );
      expect(invokeMock).toHaveBeenCalledWith("set_setting", {
        key: "score.piece.7.spots_hidden",
        value: "4",
      });
      expect(
        screen.getByRole("button", { name: "Show spots (1)" }),
      ).toBeTruthy();
    });

    it("C4: Practice this appears only on a selected spot and reaches the practice panel", async () => {
      render(
        <ScoreView
          pieceId={7}
          api={makeApi({
            regions: vi.fn().mockResolvedValue([spotParent(), spotChild()]),
          })}
          adapter={makePdf(1).adapter}
          onOpenBlock={vi.fn()}
        />,
      );
      await screen.findByLabelText("Score page 1");
      await selectParent();
      // The parent is selected, not the child: no chip yet.
      expect(
        screen.queryByRole("button", { name: "Practice this" }),
      ).toBeNull();

      fireEvent.click(
        screen.getByRole("button", { name: "Spot 1, measures 44 to 46" }),
      );
      const chip = await screen.findByRole("button", {
        name: "Practice this",
      });
      // A sibling of the anchor button, never nested inside it (invalid HTML).
      expect(chip.closest(".score-region-anchor")).toBeNull();

      fireEvent.click(chip);
      await waitFor(() =>
        expect(
          (screen.getByLabelText("From measure") as HTMLInputElement).value,
        ).toBe("44"),
      );
      expect(
        (screen.getByLabelText("To measure") as HTMLInputElement).value,
      ).toBe("46");
    });

    it("C2: an accidental spot can be undone immediately", async () => {
      mockCreateReturning(99);
      render(
        <ScoreView
          pieceId={7}
          api={makeApi({
            regions: vi.fn().mockResolvedValue([spotParent()]),
          })}
          adapter={makePdf(1).adapter}
        />,
      );
      await screen.findByLabelText("Score page 1");
      await selectParent();
      await dragOnPageOne();

      fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("region_delete", {
          id: 99,
          mode: "cascade",
        }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Undo" })).toBeNull(),
      );
    });
  });
});
