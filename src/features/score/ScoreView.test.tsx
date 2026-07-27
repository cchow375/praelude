import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
      }),
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
});
