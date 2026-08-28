import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { ScoreView } from "../ScoreView";
import type {
  PdfAdapter,
  PdfDocumentHandle,
  PdfEdition,
  PdfRenderTask,
  ScorePdfApi,
} from "../types";
import type { MarkEdition, PageMarks, ScoreMarksApi } from "./api";
import type { Stroke } from "./strokes";

const EDITIONS: PdfEdition[] = [
  {
    id: "henle",
    label: "Henle",
    size_bytes: 100,
    modified_unix: 1,
    fingerprint: "fp-henle",
    selected: true,
  },
  {
    id: "schnabel",
    label: "Schnabel",
    size_bytes: 120,
    modified_unix: 2,
    fingerprint: "fp-schnabel",
    selected: false,
  },
];

class FakeIntersectionObserver {
  observe = () => {};
  unobserve = () => {};
  disconnect = () => {};
  takeRecords = () => [];
  root = null;
  rootMargin = "0px";
  thresholds = [0];
  constructor(_callback: IntersectionObserverCallback) {}
}

function makeApi(): ScorePdfApi {
  return {
    editions: vi.fn().mockResolvedValue(EDITIONS),
    select: vi.fn().mockResolvedValue(undefined),
    bytes: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    regions: vi.fn().mockResolvedValue([]),
    blocks: vi.fn().mockResolvedValue([]),
    updateRegion: vi.fn(),
    createTarget: vi.fn(),
    loadFirstPage: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    saveFirstPage: vi.fn().mockResolvedValue(undefined),
  };
}

function makePdf(pageCount = 3) {
  const getPage = vi.fn(async () => ({
    width: 612,
    height: 792,
    cleanup: vi.fn(),
    render: (canvas: HTMLCanvasElement): PdfRenderTask => {
      canvas.width = 1224;
      canvas.height = 1584;
      return { promise: Promise.resolve(), cancel: vi.fn() };
    },
  }));
  const document: PdfDocumentHandle = {
    numPages: pageCount,
    getPage,
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  const adapter: PdfAdapter = { load: vi.fn().mockResolvedValue(document) };
  return { adapter, document };
}

/**
 * An in-memory stand-in for the Rust store, keyed exactly the way it is keyed —
 * piece + edition id + fingerprint + page — so the isolation the real table
 * enforces is the isolation these tests exercise.
 */
function makeMarksStore() {
  const rows = new Map<string, Stroke[]>();
  let nextId = 1;
  const key = (piece: number, edition: MarkEdition, page: number) =>
    `${piece}|${edition.id}|${edition.fingerprint}|${page}`;
  const api: ScoreMarksApi = {
    page: vi.fn(async (piece, edition, page): Promise<PageMarks> => ({
      marks: [...(rows.get(key(piece, edition, page)) ?? [])],
      staleMarks: 0,
    })),
    add: vi.fn(async (piece, edition, stroke) => {
      const saved = { ...stroke, id: nextId++ };
      const at = key(piece, edition, stroke.page);
      rows.set(at, [...(rows.get(at) ?? []), saved]);
      return saved;
    }),
    undo: vi.fn(async (piece, edition, page) => {
      const at = key(piece, edition, page);
      const list = rows.get(at) ?? [];
      const last = list[list.length - 1];
      if (!last) return null;
      rows.set(at, list.slice(0, -1));
      return last.id;
    }),
    clearPage: vi.fn(async (piece, edition, page) => {
      const at = key(piece, edition, page);
      const removed = (rows.get(at) ?? []).length;
      rows.set(at, []);
      return removed;
    }),
  };
  return { api, rows, key };
}

const PAGE_BOX = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 600,
  bottom: 800,
  width: 600,
  height: 800,
  toJSON: () => ({}),
};

/** Draw one diagonal stroke on the page-`page` pencil layer. */
async function drawOn(page: number) {
  const layer = await screen.findByTestId(`pencil-layer-${page}`);
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue(PAGE_BOX);
  fireEvent.pointerDown(layer, {
    pointerId: 3,
    button: 0,
    clientX: 150,
    clientY: 200,
  });
  fireEvent.pointerMove(layer, { pointerId: 3, clientX: 300, clientY: 400 });
  fireEvent.pointerUp(layer, { pointerId: 3, clientX: 450, clientY: 600 });
  return layer;
}

function scoreTool(name: string | RegExp): HTMLElement {
  const exposed = screen.queryByRole("button", { name });
  if (exposed) return exposed;
  fireEvent.click(screen.getByRole("button", { name: "Score tools" }));
  return screen.getByRole("button", { name });
}

const pencilButton = () => scoreTool(/^(Pencil|Put pencil down)$/);

async function openScore(marksApi: ScoreMarksApi, pieceId = 7) {
  const view = render(
    <ScoreView
      pieceId={pieceId}
      api={makeApi()}
      marksApi={marksApi}
      adapter={makePdf().adapter}
    />,
  );
  await screen.findByLabelText("Score page 1");
  return view;
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
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

describe("the score pencil", () => {
  it("persists a drawn stroke and brings it back on reopen", async () => {
    const store = makeMarksStore();
    const view = await openScore(store.api);

    fireEvent.click(pencilButton());
    await drawOn(1);

    await waitFor(() => expect(store.api.add).toHaveBeenCalledTimes(1));
    const [, edition, stroke] = store.api.add.mock.calls[0];
    expect(edition).toEqual({ id: "henle", fingerprint: "fp-henle" });
    expect(stroke.page).toBe(1);
    // Normalized against the 600×800 page box, never screen pixels.
    expect(stroke.points[0]).toEqual({ x: 0.25, y: 0.25 });
    expect(stroke.points[stroke.points.length - 1]).toEqual({
      x: 0.75,
      y: 0.75,
    });
    await screen.findByTestId("pencil-stroke");

    // Reopen the piece from scratch: the mark comes back off the store.
    view.unmount();
    await openScore(store.api);
    expect(await screen.findByTestId("pencil-stroke")).toBeTruthy();
  });

  it("rolls the mark back off the page when the save fails", async () => {
    const store = makeMarksStore();
    store.api.add = vi.fn().mockRejectedValue(new Error("disk is full"));
    await openScore(store.api);

    fireEvent.click(pencilButton());
    await drawOn(1);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "disk is full",
    );
    await waitFor(() =>
      expect(screen.queryByTestId("pencil-stroke-pending")).toBeNull(),
    );
    expect(screen.queryByTestId("pencil-stroke")).toBeNull();
  });

  it("never shows one edition's marks on another", async () => {
    const store = makeMarksStore();
    await openScore(store.api);

    fireEvent.click(pencilButton());
    await drawOn(1);
    await screen.findByTestId("pencil-stroke");

    // Switch to the other edition of the same piece: different page geometry,
    // so the Henle's mark must not appear over the Schnabel's engraving.
    fireEvent.change(screen.getByLabelText("Score edition"), {
      target: { value: "schnabel" },
    });
    await waitFor(() =>
      expect(store.api.page).toHaveBeenCalledWith(
        7,
        { id: "schnabel", fingerprint: "fp-schnabel" },
        1,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("pencil-stroke")).toBeNull(),
    );

    // And the Henle still has it.
    expect(store.rows.get(store.key(7, EDITIONS[0], 1))?.length).toBe(1);
  });

  it("undoes marks one at a time, newest first", async () => {
    const store = makeMarksStore();
    await openScore(store.api);
    fireEvent.click(pencilButton());

    await drawOn(1);
    await waitFor(() => expect(store.api.add).toHaveBeenCalledTimes(1));
    await drawOn(1);
    await waitFor(() => expect(store.api.add).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getAllByTestId("pencil-stroke")).toHaveLength(2),
    );

    const undo = screen.getByRole("button", { name: "Undo mark" });
    fireEvent.click(undo);
    await waitFor(() =>
      expect(screen.getAllByTestId("pencil-stroke")).toHaveLength(1),
    );
    fireEvent.click(undo);
    await waitFor(() =>
      expect(screen.queryByTestId("pencil-stroke")).toBeNull(),
    );
    // Nothing left to take back: the control says so instead of erroring.
    expect(
      (screen.getByRole("button", { name: "Undo mark" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("requires a confirmation before clearing a page", async () => {
    const store = makeMarksStore();
    await openScore(store.api);
    fireEvent.click(pencilButton());
    await drawOn(1);
    await waitFor(() => expect(store.api.add).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Clear page 1" }));
    // The destructive act has not happened yet — it is only being offered.
    expect(store.api.clearPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep them" }));
    expect(store.api.clearPage).not.toHaveBeenCalled();
    expect(screen.getByTestId("pencil-stroke")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear page 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Erase page 1" }));
    await waitFor(() => expect(store.api.clearPage).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByTestId("pencil-stroke")).toBeNull(),
    );
  });

  it("is off until asked for, and Escape always puts it down", async () => {
    const store = makeMarksStore();
    await openScore(store.api);

    // A blank page allocates no idle drawing canvas before the pencil is picked
    // up. Besides leaving no mark, this keeps continuous-reader memory bounded.
    expect(screen.queryByTestId("pencil-layer-1")).toBeNull();
    expect(store.api.add).not.toHaveBeenCalled();

    fireEvent.click(pencilButton());
    expect(pencilButton().getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByTestId("pencil-layer-1")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(pencilButton().getAttribute("aria-pressed")).toBe("false"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("pencil-layer-1")).toBeNull(),
    );
    expect(store.api.add).not.toHaveBeenCalled();
  });

  it("does not undo from a keystroke typed into a text field", async () => {
    const store = makeMarksStore();
    await openScore(store.api);
    fireEvent.click(pencilButton());
    await drawOn(1);
    await waitFor(() => expect(store.api.add).toHaveBeenCalledTimes(1));

    const field = screen.getByLabelText("Page number");
    field.focus();
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(store.api.undo).not.toHaveBeenCalled();
    // Escape did not leave the mode either: the field owns the keyboard.
    expect(pencilButton()).toBeTruthy();
    expect(screen.getByTestId("pencil-stroke")).toBeTruthy();
  });

  it("hands the pointer to the rectangle tool rather than sharing it", async () => {
    const store = makeMarksStore();
    await openScore(store.api);

    fireEvent.click(pencilButton());
    fireEvent.click(scoreTool("Draw target"));

    // Pencil mode is off and its live canvas is gone, so a target drag can
    // never also leave graphite.
    expect(pencilButton().getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("pencil-layer-1")).toBeNull();
    expect(store.api.add).not.toHaveBeenCalled();
  });

  it("arms only the visible page, never a buffered neighbour", async () => {
    const store = makeMarksStore();
    await openScore(store.api);
    fireEvent.click(pencilButton());

    expect(screen.getByTestId("pencil-layer-1").dataset.active).toBe("true");
    const neighbour = screen.queryByTestId("pencil-layer-2");
    if (neighbour) expect(neighbour.dataset.active).toBe("false");
  });

  it("keeps each page's marks on its own page across a page turn", async () => {
    const store = makeMarksStore();
    await openScore(store.api);
    fireEvent.click(pencilButton());
    await drawOn(1);
    await waitFor(() => expect(store.api.add).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByTestId("pencil-layer-2");
    // Page 2 is blank, and undo/clear now speak about page 2.
    expect(
      (
        screen.getByRole("button", {
          name: "Clear page 2",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    // Page 1's mark is still exactly where it was drawn — same normalized
    // geometry, re-read from the store rather than re-derived from the screen.
    expect(await screen.findByTestId("pencil-stroke")).toBeTruthy();
    expect(store.rows.get(store.key(7, EDITIONS[0], 1))?.[0].points[0]).toEqual(
      {
        x: 0.25,
        y: 0.25,
      },
    );
  });
});
