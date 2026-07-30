import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { usePanels } from "./usePanels";

afterEach(() => cleanup());

describe("usePanels gap validation scratch", () => {
  beforeEach(() => invokeMock.mockReset());

  it("swallows a layout_get rejection and keeps panels empty", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "layout_get"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(undefined),
    );
    const { result } = renderHook(() => usePanels());

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("layout_get"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.panels).toEqual({});
  });

  it("swallows a layout_set rejection and still accepts subsequent updates", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "layout_get") return Promise.resolve(null);
      if (cmd === "layout_set") return Promise.reject(new Error("disk full"));
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => usePanels());
    act(() => {
      result.current.register("rep", {
        x: 1,
        y: 2,
        w: 300,
        h: 200,
        collapsed: false,
        z: 1,
      });
    });

    act(() => {
      result.current.update({ ...result.current.panels.rep, x: 55 });
    });

    await waitFor(
      () =>
        expect(invokeMock).toHaveBeenCalledWith(
          "layout_set",
          expect.any(Object),
        ),
      { timeout: 1000 },
    );

    invokeMock.mockClear();
    act(() => {
      result.current.update({ ...result.current.panels.rep, x: 77 });
    });
    await waitFor(
      () =>
        expect(invokeMock).toHaveBeenCalledWith("layout_set", {
          layout: { panels: [expect.objectContaining({ x: 77 })] },
        }),
      { timeout: 1000 },
    );
  });

  it("tracks window resize into viewport", async () => {
    invokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => usePanels());
    const initialW = result.current.viewport.w;

    act(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: initialW + 200,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 555,
      });
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current.viewport).toEqual({ w: initialW + 200, h: 555 });
  });

  it("removes the resize listener on unmount", async () => {
    invokeMock.mockResolvedValue(null);
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => usePanels());

    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    const call = addSpy.mock.calls.find(([type]) => type === "resize")!;
    const resizeHandler = call[1];

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("resize", resizeHandler);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("clears the pending persist timer on unmount so layout_set never fires", async () => {
    invokeMock.mockResolvedValue(null);
    const { result, unmount } = renderHook(() => usePanels());
    act(() => {
      result.current.register("rep", {
        x: 1,
        y: 2,
        w: 300,
        h: 200,
        collapsed: false,
        z: 1,
      });
    });

    act(() => {
      result.current.update({ ...result.current.panels.rep, x: 42 });
    });

    unmount();
    invokeMock.mockClear();

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(invokeMock).not.toHaveBeenCalledWith(
      "layout_set",
      expect.anything(),
    );
  });

  it("ignores a layout_get resolution that arrives after unmount", async () => {
    let resolveLayout!: (value: unknown) => void;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "layout_get") {
        return new Promise((resolve) => {
          resolveLayout = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    const { result, unmount } = renderHook(() => usePanels());
    unmount();

    let threw: unknown = null;
    try {
      await act(async () => {
        resolveLayout({
          panels: [
            { id: "rep", x: 10, y: 10, w: 300, h: 200, collapsed: false, z: 1 },
          ],
        });
        await Promise.resolve();
        await Promise.resolve();
      });
    } catch (err) {
      threw = err;
    }

    expect(threw).toBeNull();
    expect(result.current.panels).toEqual({});
  });

  it("register() no-op for existing id but refreshes defaults ref", async () => {
    invokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => usePanels());

    act(() => {
      result.current.register("rep", {
        x: 1,
        y: 2,
        w: 300,
        h: 200,
        collapsed: false,
        z: 1,
      });
    });
    act(() => {
      result.current.update({ ...result.current.panels.rep, x: 50 });
    });

    act(() => {
      result.current.register("rep", {
        x: 999,
        y: 999,
        w: 300,
        h: 200,
        collapsed: false,
        z: 1,
      });
    });
    expect(result.current.panels.rep.x).toBe(50);

    act(() => result.current.resetLayout());
    expect(result.current.panels.rep.x).toBe(999);
  });

  it("no-ops raise() for an id that is not registered", async () => {
    invokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => usePanels());
    act(() => {
      result.current.register("rep", {
        x: 1,
        y: 2,
        w: 300,
        h: 200,
        collapsed: false,
        z: 1,
      });
    });
    const panelsBefore = result.current.panels;

    invokeMock.mockClear();
    act(() => result.current.raise("does-not-exist"));

    expect(result.current.panels).toBe(panelsBefore);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(invokeMock).not.toHaveBeenCalledWith(
      "layout_set",
      expect.anything(),
    );
  });

  it("no-ops raise() when the panel is already on top", async () => {
    invokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => usePanels());
    act(() => {
      result.current.register("rep", {
        x: 1,
        y: 2,
        w: 300,
        h: 200,
        collapsed: false,
        z: 5,
      });
      result.current.register("session", {
        x: 3,
        y: 4,
        w: 320,
        h: 180,
        collapsed: false,
        z: 1,
      });
    });
    const panelsBefore = result.current.panels;

    invokeMock.mockClear();
    act(() => result.current.raise("rep"));

    expect(result.current.panels).toBe(panelsBefore);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(invokeMock).not.toHaveBeenCalledWith(
      "layout_set",
      expect.anything(),
    );
  });

  it("keeps a strict z-order across repeated raises of three panels", async () => {
    invokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => usePanels());
    act(() => {
      result.current.register("a", {
        x: 0,
        y: 0,
        w: 300,
        h: 200,
        collapsed: false,
        z: 1,
      });
      result.current.register("b", {
        x: 0,
        y: 0,
        w: 300,
        h: 200,
        collapsed: false,
        z: 2,
      });
      result.current.register("c", {
        x: 0,
        y: 0,
        w: 300,
        h: 200,
        collapsed: false,
        z: 3,
      });
    });

    act(() => result.current.raise("a"));
    act(() => result.current.raise("b"));

    const { a, b, c } = result.current.panels;
    expect(c.z).toBeLessThan(a.z);
    expect(a.z).toBeLessThan(b.z);
  });

  it("adds a brand-new panel when update() is called for an unregistered id", async () => {
    invokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => usePanels());

    act(() => {
      result.current.update({
        id: "adhoc",
        x: 5,
        y: 6,
        w: 300,
        h: 200,
        collapsed: false,
        z: 1,
      });
    });

    expect(result.current.panels.adhoc).toEqual({
      id: "adhoc",
      x: 5,
      y: 6,
      w: 300,
      h: 200,
      collapsed: false,
      z: 1,
    });
  });

  it("adopts a higher incoming z from update() rather than the stale one", async () => {
    invokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => usePanels());
    act(() => {
      result.current.register("rep", {
        x: 1,
        y: 2,
        w: 300,
        h: 200,
        collapsed: false,
        z: 1,
      });
    });

    act(() => {
      result.current.update({ ...result.current.panels.rep, z: 40 });
    });

    expect(result.current.panels.rep.z).toBe(40);
  });

  it("drops panels from state on resetLayout if they were never registered", async () => {
    invokeMock.mockResolvedValueOnce({
      panels: [
        {
          id: "hydrated-only",
          x: 9,
          y: 9,
          w: 300,
          h: 200,
          collapsed: false,
          z: 1,
        },
      ],
    });
    invokeMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePanels());
    await waitFor(() =>
      expect(result.current.panels["hydrated-only"]).toBeDefined(),
    );

    act(() => result.current.resetLayout());

    expect(result.current.panels["hydrated-only"]).toBeUndefined();
  });

  it("wipes panels to {} when resetLayout runs with nothing registered", async () => {
    invokeMock.mockResolvedValueOnce({
      panels: [
        { id: "rep", x: 10, y: 10, w: 300, h: 200, collapsed: false, z: 1 },
      ],
    });
    invokeMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePanels());
    await waitFor(() => expect(result.current.panels.rep).toBeDefined());

    act(() => result.current.resetLayout());

    expect(result.current.panels).toEqual({});
  });

  it("coalesces rapid updates into a single debounced layout_set call", async () => {
    invokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => usePanels());
    act(() => {
      result.current.register("rep", {
        x: 0,
        y: 0,
        w: 300,
        h: 200,
        collapsed: false,
        z: 1,
      });
    });

    act(() => {
      result.current.update({ ...result.current.panels.rep, x: 1 });
      result.current.update({ ...result.current.panels.rep, x: 2 });
      result.current.update({ ...result.current.panels.rep, x: 3 });
    });

    await waitFor(
      () =>
        expect(invokeMock).toHaveBeenCalledWith("layout_set", {
          layout: { panels: [expect.objectContaining({ x: 3 })] },
        }),
      { timeout: 1000 },
    );

    const layoutSetCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "layout_set",
    );
    expect(layoutSetCalls).toHaveLength(1);
  });

  it("lets a late layout_get response overwrite an already-registered panel's geometry", async () => {
    invokeMock.mockResolvedValueOnce({
      panels: [
        { id: "rep", x: 77, y: 77, w: 300, h: 200, collapsed: false, z: 9 },
      ],
    });
    invokeMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePanels());

    act(() => {
      result.current.register("rep", {
        x: 1,
        y: 2,
        w: 300,
        h: 200,
        collapsed: false,
        z: 1,
      });
    });
    expect(result.current.panels.rep.x).toBe(1);

    await waitFor(() => expect(result.current.panels.rep.x).toBe(77));
  });

  it("clamps viewport dimensions to a minimum of 1 on resize", async () => {
    invokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => usePanels());

    act(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 0,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: -10,
      });
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current.viewport).toEqual({ w: 1, h: 1 });
  });
});
