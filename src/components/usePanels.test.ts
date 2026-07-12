import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { usePanels } from "./usePanels";

describe("usePanels", () => {
  beforeEach(() => invokeMock.mockReset());

  it("hydrates saved geometry and persists an update", async () => {
    invokeMock.mockResolvedValue(null);
    invokeMock.mockResolvedValueOnce({
      panels: [
        { id: "rep", x: 10, y: 10, w: 300, h: 200, collapsed: false, z: 1 },
      ],
    });
    const { result } = renderHook(() => usePanels());
    await waitFor(() => expect(result.current.panels.rep?.x).toBe(10));

    act(() => {
      result.current.update({
        id: "rep",
        x: 40,
        y: 10,
        w: 300,
        h: 200,
        collapsed: false,
        z: 1,
      });
    });
    await waitFor(
      () =>
        expect(invokeMock).toHaveBeenCalledWith("layout_set", {
          layout: {
            panels: [expect.objectContaining({ id: "rep", x: 40 })],
          },
        }),
      { timeout: 1000 },
    );
  });

  it("registers defaults, raises panels, and restores defaults", async () => {
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
      result.current.register("session", {
        x: 3,
        y: 4,
        w: 320,
        h: 180,
        collapsed: false,
        z: 2,
      });
    });
    expect(result.current.panels.rep.x).toBe(1);

    act(() => result.current.raise("rep"));
    expect(result.current.panels.rep.z).toBeGreaterThan(
      result.current.panels.session.z,
    );

    act(() =>
      result.current.update({ ...result.current.panels.rep, x: 99 }),
    );
    act(() => result.current.resetLayout());
    expect(result.current.panels.rep.x).toBe(1);
  });
});
