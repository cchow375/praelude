import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the Tauri core invoke so we can simulate the backend being absent
// (Task 4 not yet wired) and assert the in-memory fallback behavior.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useSettings, DEFAULT_SETTINGS } from "./settings";

afterEach(() => {
  invokeMock.mockReset();
});

describe("useSettings", () => {
  it("falls back to defaults when the backend commands are missing", async () => {
    invokeMock.mockRejectedValue(new Error("command get_setting not found"));

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps a set value in memory even when persistence fails", async () => {
    invokeMock.mockRejectedValue(new Error("no backend"));

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setSetting("theme", "dark"));

    expect(result.current.settings.theme).toBe("dark");
    // set_setting was attempted despite the backend being unavailable.
    expect(invokeMock).toHaveBeenCalledWith("set_setting", {
      key: "theme",
      value: "dark",
    });
  });

  it("loads a stored value when the backend returns one", async () => {
    invokeMock.mockResolvedValue("light");

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.settings.theme).toBe("light");
    expect(invokeMock).toHaveBeenCalledWith("get_setting", { key: "theme" });
  });
});
