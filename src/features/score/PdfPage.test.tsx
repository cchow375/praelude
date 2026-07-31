import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PdfPage } from "./PdfPage";
import { DEFAULT_PAGE_SIZE } from "./geometry";
import type { PdfDocumentHandle, PdfPageHandle, PdfRenderTask } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A controllable, externally resolvable/rejectable promise, mirroring the
 * async seams (getPage / task.promise) PdfPage races against. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A page whose render() resolves immediately and stamps the canvas, like a
 * real PDF.js page would once drawing finishes. */
function makeReadyPage(
  overrides: Partial<{ width: number; height: number }> = {},
) {
  const cancel = vi.fn();
  const cleanupPage = vi.fn();
  const render = vi.fn((canvas: HTMLCanvasElement): PdfRenderTask => {
    canvas.width = 1000;
    canvas.height = 1400;
    return { promise: Promise.resolve(), cancel };
  });
  const page: PdfPageHandle = {
    width: overrides.width ?? 600,
    height: overrides.height ?? 800,
    render,
    cleanup: cleanupPage,
  };
  return { page, render, cleanup: cleanupPage, cancel };
}

function makeDocument(
  getPage: (pageNumber: number) => Promise<PdfPageHandle>,
  numPages = 10,
): PdfDocumentHandle {
  return {
    numPages,
    getPage: vi.fn(getPage),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

describe("PdfPage", () => {
  it("does not fetch the page at all while inactive", () => {
    const getPage = vi.fn();
    const document = makeDocument(getPage);
    render(
      <PdfPage document={document} pageNumber={3} active={false} scale={1} />,
    );
    expect(getPage).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Score page 3")).toBeTruthy();
  });

  it("shows the rendering placeholder while the page is loading, then removes it once ready", async () => {
    const { page, render: renderPage } = makeReadyPage();
    const { promise, resolve } = deferred<PdfPageHandle>();
    const document = makeDocument(() => promise);
    render(<PdfPage document={document} pageNumber={1} active scale={1} />);

    expect(screen.getByText("Rendering page 1…")).toBeTruthy();
    expect(
      document.getPage as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith(1);

    await act(async () => {
      resolve(page);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("Rendering page 1…")).toBeNull();
    expect(renderPage).toHaveBeenCalledTimes(1);
    const canvas = screen.getByLabelText(
      "Rendered score page 1",
    ) as HTMLCanvasElement;
    expect(canvas.width).toBe(1000);
    expect(screen.getByLabelText("Score page 1").className).toContain(
      "is-ready",
    );
  });

  it("reports the resolved page size through onSize as soon as metadata is available, before rendering finishes", async () => {
    const cancel = vi.fn();
    const renderPromise = deferred<void>();
    const page: PdfPageHandle = {
      width: 640,
      height: 900,
      cleanup: vi.fn(),
      render: () => ({ promise: renderPromise.promise, cancel }),
    };
    const document = makeDocument(() => Promise.resolve(page));
    const onSize = vi.fn();
    render(
      <PdfPage
        document={document}
        pageNumber={5}
        active
        scale={1}
        onSize={onSize}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSize).toHaveBeenCalledWith(5, { width: 640, height: 900 });
    // Rendering is still pending — onSize fired before the render task settled.
    expect(screen.getByText("Rendering page 5…")).toBeTruthy();
  });

  it("computes the initial displayed box from the default page size before any page resolves", () => {
    const document = makeDocument(() => new Promise(() => undefined));
    render(<PdfPage document={document} pageNumber={1} active scale={0.5} />);
    const section = screen.getByLabelText("Score page 1");
    expect(section.style.width).toBe(
      `${Math.round(DEFAULT_PAGE_SIZE.width * 0.5)}px`,
    );
    expect(section.style.height).toBe(
      `${Math.round(DEFAULT_PAGE_SIZE.height * 0.5)}px`,
    );
  });

  it("recomputes the displayed box from the resolved page size and scale", async () => {
    const { page } = makeReadyPage({ width: 600, height: 800 });
    const document = makeDocument(() => Promise.resolve(page));
    render(<PdfPage document={document} pageNumber={1} active scale={0.5} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const section = screen.getByLabelText("Score page 1");
    expect(section.style.width).toBe("300px");
    expect(section.style.height).toBe("400px");
  });

  it("passes a capped device pixel ratio through to the page's render call", async () => {
    vi.stubGlobal("devicePixelRatio", 4);
    const { page, render: renderPage } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    render(<PdfPage document={document} pageNumber={1} active scale={1} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderPage).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      1,
      2, // MAX_DPR from geometry.ts caps 4 -> 2
    );
  });

  it("cancels the render task and releases the canvas bitmap when the page becomes inactive", async () => {
    const { page, cancel } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    const view = render(
      <PdfPage document={document} pageNumber={1} active scale={1} />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const canvas = screen.getByLabelText(
      "Rendered score page 1",
    ) as HTMLCanvasElement;
    expect(canvas.width).toBe(1000);

    view.rerender(
      <PdfPage document={document} pageNumber={1} active={false} scale={1} />,
    );

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(screen.getByLabelText("Score page 1").className).toContain(
      "is-idle",
    );
    expect(screen.queryByText(/Rendering page/)).toBeNull();
  });

  it("surfaces a getPage rejection as a retryable page error", async () => {
    const document = makeDocument(() =>
      Promise.reject(new Error("network down")),
    );
    render(<PdfPage document={document} pageNumber={2} active scale={1} />);

    expect(await screen.findByText("Page 2: network down")).toBeTruthy();
    expect(screen.getByLabelText("Score page 2").className).toContain(
      "is-error",
    );
  });

  it("surfaces a non-cancellation rendering-task failure", async () => {
    const cancel = vi.fn();
    const page: PdfPageHandle = {
      width: 600,
      height: 800,
      cleanup: vi.fn(),
      render: () => ({ promise: Promise.reject(new Error("boom")), cancel }),
    };
    const document = makeDocument(() => Promise.resolve(page));
    render(<PdfPage document={document} pageNumber={4} active scale={1} />);

    expect(await screen.findByText("Page 4: boom")).toBeTruthy();
  });

  it("silently ignores a RenderingCancelledException instead of flipping to the error state", async () => {
    const cancelledError = new Error("stopped");
    cancelledError.name = "RenderingCancelledException";
    const cancel = vi.fn();
    const page: PdfPageHandle = {
      width: 600,
      height: 800,
      cleanup: vi.fn(),
      render: () => ({ promise: Promise.reject(cancelledError), cancel }),
    };
    const document = makeDocument(() => Promise.resolve(page));
    render(<PdfPage document={document} pageNumber={1} active scale={1} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(/Page 1:/)).toBeNull();
    expect(screen.getByLabelText("Score page 1").className).not.toContain(
      "is-error",
    );
  });

  it("silently ignores any error whose message merely mentions cancellation", async () => {
    const page: PdfPageHandle = {
      width: 600,
      height: 800,
      cleanup: vi.fn(),
      render: () => ({
        promise: Promise.reject(new Error("operation canceled by user")),
        cancel: vi.fn(),
      }),
    };
    const document = makeDocument(() => Promise.resolve(page));
    render(<PdfPage document={document} pageNumber={1} active scale={1} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(/Page 1:/)).toBeNull();
    expect(screen.getByLabelText("Score page 1").className).not.toContain(
      "is-error",
    );
  });

  it("cleans up a page that resolves after the component unmounted mid-fetch, without updating state", async () => {
    const { promise, resolve } = deferred<PdfPageHandle>();
    const document = makeDocument(() => promise);
    const view = render(
      <PdfPage document={document} pageNumber={2} active scale={1} />,
    );
    view.unmount();

    const cleanupPage = vi.fn();
    const renderPage = vi.fn();
    await act(async () => {
      resolve({
        width: 600,
        height: 800,
        cleanup: cleanupPage,
        render: renderPage,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cleanupPage).toHaveBeenCalledTimes(1);
    // Disposed before the page arrived — never even attempted to render it.
    expect(renderPage).not.toHaveBeenCalled();
  });

  it("cancels the previous render task and starts a fresh one when the page number changes while active", async () => {
    const first = makeReadyPage({ width: 600, height: 800 });
    const second = makeReadyPage({ width: 620, height: 840 });
    const getPage = vi.fn((pageNumber: number) =>
      Promise.resolve(pageNumber === 1 ? first.page : second.page),
    );
    const document = makeDocument(getPage);
    const view = render(
      <PdfPage document={document} pageNumber={1} active scale={1} />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    view.rerender(
      <PdfPage document={document} pageNumber={2} active scale={1} />,
    );

    expect(first.cancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getPage).toHaveBeenCalledWith(2);
    expect(screen.getByLabelText("Score page 2")).toBeTruthy();
  });

  it("ignores a stale page resolution that arrives after switching pages mid-flight", async () => {
    const stale = deferred<PdfPageHandle>();
    const fresh = makeReadyPage({ width: 700, height: 900 });
    const getPage = vi.fn((pageNumber: number) =>
      pageNumber === 1 ? stale.promise : Promise.resolve(fresh.page),
    );
    const document = makeDocument(getPage);
    const onSize = vi.fn();
    const view = render(
      <PdfPage
        document={document}
        pageNumber={1}
        active
        scale={1}
        onSize={onSize}
      />,
    );

    view.rerender(
      <PdfPage
        document={document}
        pageNumber={2}
        active
        scale={1}
        onSize={onSize}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const staleCleanup = vi.fn();
    const staleRender = vi.fn();
    await act(async () => {
      stale.resolve({
        width: 1,
        height: 1,
        cleanup: staleCleanup,
        render: staleRender,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(staleCleanup).toHaveBeenCalledTimes(1);
    expect(staleRender).not.toHaveBeenCalled();
    expect(onSize).not.toHaveBeenCalledWith(1, { width: 1, height: 1 });
    expect(onSize).toHaveBeenCalledWith(2, { width: 700, height: 900 });
  });

  it("applies the buffered-neighbor styling and accessibility attributes", () => {
    const document = makeDocument(() => new Promise(() => undefined));
    render(
      <PdfPage document={document} pageNumber={6} active scale={1} buffered />,
    );
    const section = screen.getByLabelText("Score page 6");
    expect(section.className).toContain("is-buffered");
    expect(section.getAttribute("data-buffered")).toBe("true");
    expect(section.getAttribute("aria-hidden")).toBe("true");
  });

  it("omits buffered attributes for a normal, in-flow page", () => {
    const document = makeDocument(() => new Promise(() => undefined));
    render(<PdfPage document={document} pageNumber={1} active scale={1} />);
    const section = screen.getByLabelText("Score page 1");
    expect(section.className).not.toContain("is-buffered");
    expect(section.getAttribute("data-buffered")).toBeNull();
    expect(section.getAttribute("aria-hidden")).toBeNull();
  });

  it("renders arbitrary children inside the page section", () => {
    const document = makeDocument(() => new Promise(() => undefined));
    render(
      <PdfPage document={document} pageNumber={1} active scale={1}>
        <span>overlay content</span>
      </PdfPage>,
    );
    expect(screen.getByText("overlay content")).toBeTruthy();
  });

  it("notifies onRasterized with the page number and painted canvas after a blit", async () => {
    const { page } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    const onRasterized = vi.fn();
    render(
      <PdfPage
        document={document}
        pageNumber={1}
        active
        scale={1}
        onRasterized={onRasterized}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRasterized).toHaveBeenCalledTimes(1);
    const [pageNumber, canvas] = onRasterized.mock.calls[0];
    expect(pageNumber).toBe(1);
    expect(canvas).toBe(screen.getByLabelText("Rendered score page 1"));
    expect((canvas as HTMLCanvasElement).width).toBe(1000);
  });

  it("does not fire onRasterized when the render task fails", async () => {
    const page: PdfPageHandle = {
      width: 600,
      height: 800,
      cleanup: vi.fn(),
      render: () => ({
        promise: Promise.reject(new Error("boom")),
        cancel: vi.fn(),
      }),
    };
    const document = makeDocument(() => Promise.resolve(page));
    const onRasterized = vi.fn();
    render(
      <PdfPage
        document={document}
        pageNumber={1}
        active
        scale={1}
        onRasterized={onRasterized}
      />,
    );

    expect(await screen.findByText("Page 1: boom")).toBeTruthy();
    expect(onRasterized).not.toHaveBeenCalled();
  });

  it("cancels any in-flight task and clears the canvas on unmount", async () => {
    const { page, cancel } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    const view = render(
      <PdfPage document={document} pageNumber={1} active scale={1} />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const canvas = screen.getByLabelText(
      "Rendered score page 1",
    ) as HTMLCanvasElement;
    expect(canvas.width).toBe(1000);

    view.unmount();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });
});

// The screen-resolution page-image fast path. On a 24-bit colour scan Rust
// answers in ~0.05–0.2 s where PDF.js needs 14–43 s, so it is tried FIRST and
// PDF.js is the fallback. Every test here is about the handover being safe: a
// refusal must land on a real rendered page, never a blank one, and the page box
// every overlay is positioned against must not move.
describe("PdfPage — page-image fast path", () => {
  /** A source that answers with an image of the given pixel size. */
  function makeSource(
    size: { width: number; height: number } | null,
    onBitmap?: (bitmap: { width: number; height: number }) => void,
  ) {
    if (size) {
      vi.stubGlobal("createImageBitmap", async () => {
        const bitmap = { ...size, close: vi.fn() };
        onBitmap?.(bitmap);
        return bitmap;
      });
    }
    const load = vi.fn(async () =>
      size ? new Blob([new Uint8Array([0xff, 0xd8, 0xff])]) : null,
    );
    return { load, warm: vi.fn() };
  }

  async function settle() {
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
  }

  it("displays the fast-path image and never touches the PDF renderer", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { page, render: renderPage, cleanup: cleanupPage } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    const source = makeSource({ width: 1536, height: 2048 });
    const onRasterized = vi.fn();
    render(
      <PdfPage
        document={document}
        pageNumber={1}
        active
        scale={1}
        pageImage={source}
        onRasterized={onRasterized}
      />,
    );
    await settle();

    expect(renderPage).not.toHaveBeenCalled();
    const section = screen.getByLabelText("Score page 1");
    expect(section.getAttribute("data-source")).toBe("image");
    expect(section.className).toContain("is-ready");
    const canvas = screen.getByLabelText(
      "Rendered score page 1",
    ) as HTMLCanvasElement;
    expect(canvas.width).toBe(1536);
    expect(canvas.height).toBe(2048);
    // The first-page snapshot cache is fed by the fast path too.
    expect(onRasterized).toHaveBeenCalledWith(1, canvas);
    // Nothing of this page stays resident in PDF.js beside the painted bitmap.
    expect(cleanupPage).toHaveBeenCalled();
  });

  it("asks for the bucket the real viewport needs, not a fixed size", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    // 600x800 page at scale 1, DPR 2 → 1600 device px on the long edge → 2048.
    const { page } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    const source = makeSource({ width: 1536, height: 2048 });
    render(
      <PdfPage
        document={document}
        pageNumber={4}
        active
        scale={1}
        pageImage={source}
      />,
    );
    await settle();
    expect(source.load).toHaveBeenCalledWith(4, 2048);
  });

  it("falls back to the PDF renderer when Rust refuses the page", async () => {
    const { page, render: renderPage } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    const source = makeSource(null);
    render(
      <PdfPage
        document={document}
        pageNumber={2}
        active
        scale={1}
        pageImage={source}
      />,
    );
    await settle();

    expect(source.load).toHaveBeenCalled();
    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Score page 2").getAttribute("data-source")).toBe(
      "pdf",
    );
  });

  it("never leaves a blank or errored page behind a refusal", async () => {
    const { page } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    const source = makeSource(null);
    render(
      <PdfPage
        document={document}
        pageNumber={2}
        active
        scale={1}
        pageImage={source}
      />,
    );
    await settle();

    const canvas = screen.getByLabelText(
      "Rendered score page 2",
    ) as HTMLCanvasElement;
    // makeReadyPage's render() stamps 1000x1400 — real pixels, not a 0x0 canvas.
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(1400);
    expect(screen.getByLabelText("Score page 2").className).toContain("is-ready");
    expect(screen.queryByText(/Rendering page 2/)).toBeNull();
    expect(screen.queryByText(/Page 2:/)).toBeNull();
  });

  it("falls back rather than paint an image that is not the shape of the page", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { page, render: renderPage } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    // Page box is 600x800 (0.75); this image is 2.0 — a rotated or partial
    // placement. Stretching it to fill the box would slide every overlay off
    // the staff, so it is refused.
    const source = makeSource({ width: 2000, height: 1000 });
    render(
      <PdfPage
        document={document}
        pageNumber={1}
        active
        scale={1}
        pageImage={source}
      />,
    );
    await settle();

    expect(renderPage).toHaveBeenCalledTimes(1);
    const canvas = screen.getByLabelText(
      "Rendered score page 1",
    ) as HTMLCanvasElement;
    expect(canvas.width).toBe(1000);
  });

  it("stops asking for a cached image once zoom passes what it can carry", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    // 600x800 page: the long edge crosses 3200 device px just above scale 2.
    const { page, render: renderPage } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    const source = makeSource({ width: 1536, height: 2048 });
    render(
      <PdfPage
        document={document}
        pageNumber={1}
        active
        scale={2.5}
        pageImage={source}
      />,
    );
    await settle();

    expect(source.load).not.toHaveBeenCalled();
    expect(renderPage).toHaveBeenCalledTimes(1);
  });

  it("re-requests a larger bucket as the reader zooms in", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { page } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    const source = makeSource({ width: 1536, height: 2048 });
    const view = render(
      <PdfPage
        document={document}
        pageNumber={1}
        active
        scale={0.5}
        pageImage={source}
      />,
    );
    await settle();
    expect(source.load).toHaveBeenLastCalledWith(1, 1024);

    view.rerender(
      <PdfPage
        document={document}
        pageNumber={1}
        active
        scale={1.5}
        pageImage={source}
      />,
    );
    // The crisp re-request is debounced exactly like the PDF.js re-raster is.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    await settle();
    expect(source.load).toHaveBeenLastCalledWith(1, 2560);
  });

  it("releases the decoded image as soon as it has been blitted", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { page } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    const closes: Array<ReturnType<typeof vi.fn>> = [];
    const source = makeSource({ width: 1536, height: 2048 }, (bitmap) => {
      closes.push((bitmap as unknown as { close: ReturnType<typeof vi.fn> }).close);
    });
    render(
      <PdfPage
        document={document}
        pageNumber={1}
        active
        scale={1}
        pageImage={source}
      />,
    );
    await settle();
    expect(closes).toHaveLength(1);
    expect(closes[0]).toHaveBeenCalledTimes(1);
  });

  it("lays the page box out identically whichever pipeline painted it", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    // The overlay contract: region rectangles, target rectangles and the mapping
    // calibration are all positioned as percentages of this box. If the box
    // differed between the fast path and the fallback, every mark would drift.
    const overlay = (
      <div
        data-testid="overlay-probe"
        style={{
          position: "absolute",
          left: "25%",
          top: "40%",
          width: "10%",
          height: "5%",
        }}
      />
    );

    const fastDoc = makeDocument(() =>
      Promise.resolve(makeReadyPage({ width: 613, height: 792 }).page),
    );
    render(
      <PdfPage
        document={fastDoc}
        pageNumber={1}
        active
        scale={1.25}
        pageImage={makeSource({ width: 1585, height: 2048 })}
      >
        {overlay}
      </PdfPage>,
    );
    await settle();
    const fastSection = screen.getByLabelText("Score page 1");
    const fastBox = fastSection.getAttribute("style");
    const fastProbe = screen.getByTestId("overlay-probe").getAttribute("style");
    expect(fastSection.getAttribute("data-source")).toBe("image");
    cleanup();

    const slowDoc = makeDocument(() =>
      Promise.resolve(makeReadyPage({ width: 613, height: 792 }).page),
    );
    render(
      <PdfPage
        document={slowDoc}
        pageNumber={1}
        active
        scale={1.25}
        pageImage={makeSource(null)}
      >
        {overlay}
      </PdfPage>,
    );
    await settle();
    const slowSection = screen.getByLabelText("Score page 1");
    expect(slowSection.getAttribute("data-source")).toBe("pdf");
    expect(slowSection.getAttribute("style")).toBe(fastBox);
    expect(screen.getByTestId("overlay-probe").getAttribute("style")).toBe(
      fastProbe,
    );
    // And the box really is the PDF page box at the live scale, not the image's.
    expect(fastBox).toContain("width: 766px");
    expect(fastBox).toContain("height: 990px");
  });

  it("behaves exactly as before when the host offers no fast path", async () => {
    const { page, render: renderPage } = makeReadyPage();
    const document = makeDocument(() => Promise.resolve(page));
    render(<PdfPage document={document} pageNumber={1} active scale={1} />);
    await settle();
    expect(renderPage).toHaveBeenCalledTimes(1);
  });
});
