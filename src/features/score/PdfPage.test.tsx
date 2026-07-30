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
