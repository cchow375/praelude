import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "local-worker.js" }));

import { ScoreView } from "./ScoreView";
import type {
  PdfAdapter,
  PdfDocumentHandle,
  PdfEdition,
  PdfRenderTask,
  ScorePdfApi,
} from "./types";

const EDITIONS: PdfEdition[] = [
  { id: "urtext", label: "Urtext", size_bytes: 100, modified_unix: 1, fingerprint: "a", selected: true },
  { id: "fingered", label: "Fingered", size_bytes: 120, modified_unix: 2, fingerprint: "b", selected: false },
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
      return [{
        target,
        isIntersecting: ratio > 0,
        intersectionRatio: ratio,
      } as IntersectionObserverEntry];
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
    ...overrides,
  };
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

beforeEach(() => {
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
  it("maps a selected Region with normalized edition-specific rectangles", async () => {
    const api = makeApi({
      regions: vi.fn().mockResolvedValue([{
        id: 4, piece_id: 7, name: "Development", m_start: 40, m_end: 56,
        kind: "section", order: 0, color: "#8b7cf6", pdf_anchor: null,
      }]),
      updateRegion: vi.fn().mockImplementation(async (_id, pdfAnchor) => ({
        id: 4, piece_id: 7, name: "Development", m_start: 40, m_end: 56,
        kind: "section", order: 0, color: "#8b7cf6", pdf_anchor: pdfAnchor,
      })),
    });
    render(<ScoreView pieceId={7} api={api} adapter={makePdf(2).adapter} />);
    await screen.findByLabelText("Score page 2");

    fireEvent.click(await screen.findByRole("button", { name: "Development, measures 40 to 56" }));
    fireEvent.click(screen.getByRole("button", { name: "Map Development" }));
    const overlay = screen.getByTestId("page-overlay-1");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800,
      width: 1000, height: 800, toJSON: () => ({}),
    });
    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 500, clientY: 400 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 500, clientY: 400 });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));

    await waitFor(() => expect(api.updateRegion).toHaveBeenCalledWith(4, {
      v: 1,
      editions: {
        urtext: {
          fingerprint: "a",
          rects: [{ page: 1, x: 0.1, y: 0.25, w: 0.4, h: 0.25 }],
        },
      },
    }));
  });

  it("shows an honest no-PDF state", async () => {
    render(<ScoreView pieceId={7} api={makeApi({ editions: vi.fn().mockResolvedValue([]) })} adapter={makePdf().adapter} />);
    expect(await screen.findByText("No PDF score found.")).toBeTruthy();
  });

  it("shows load failures and retries the edition request", async () => {
    const editions = vi.fn()
      .mockRejectedValueOnce(new Error("backend unavailable"))
      .mockResolvedValueOnce([]);
    render(<ScoreView pieceId={7} api={makeApi({ editions })} adapter={makePdf().adapter} />);
    expect(await screen.findByText("backend unavailable")).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("No PDF score found.")).toBeTruthy();
    expect(editions).toHaveBeenCalledTimes(2);
  });

  it("renders only the visible page plus one neighbor and evicts old canvases", async () => {
    const pdf = makePdf(5);
    render(<ScoreView pieceId={7} api={makeApi()} adapter={pdf.adapter} />);

    await screen.findByLabelText("Score page 5");
    await waitFor(() => expect(pdf.getPage.mock.calls.map((call) => call[0])).toEqual([1, 2]));
    const firstCanvas = screen.getByLabelText("Rendered score page 1") as HTMLCanvasElement;
    expect(firstCanvas.width).toBe(1200);

    FakeIntersectionObserver.latest?.trigger({ 1: 0, 4: 1 });
    await waitFor(() => {
      expect(new Set(pdf.getPage.mock.calls.map((call) => call[0]))).toEqual(new Set([1, 2, 3, 4, 5]));
    });
    expect(firstCanvas.width).toBe(0);
    expect(firstCanvas.height).toBe(0);
    expect(pdf.cancels.get(1)).toHaveBeenCalled();
    expect(screen.getByLabelText("Page number").getAttribute("value")).toBe("4");
  });

  it("persists edition selection before loading the new PDF", async () => {
    const api = makeApi();
    const pdf = makePdf(2);
    render(<ScoreView pieceId={12} api={api} adapter={pdf.adapter} />);
    await screen.findByLabelText("Score page 2");

    fireEvent.change(screen.getByLabelText("Score edition"), { target: { value: "fingered" } });
    await waitFor(() => expect(api.select).toHaveBeenCalledWith(12, "fingered"));
    await waitFor(() => expect(api.bytes).toHaveBeenLastCalledWith(12, "fingered"));
  });

  it("supports zoom controls and direct page jumps", async () => {
    const pdf = makePdf(4);
    render(<ScoreView pieceId={7} api={makeApi()} adapter={pdf.adapter} />);
    await screen.findByLabelText("Score page 4");

    const before = screen.getByLabelText("Zoom level").textContent;
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByLabelText("Zoom level").textContent).not.toBe(before);

    fireEvent.change(screen.getByLabelText("Page number"), { target: { value: "4" } });
    fireEvent.submit(screen.getByLabelText("Page number").closest("form")!);
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled();
    expect(screen.getByLabelText("Page number").getAttribute("value")).toBe("4");
  });
});
