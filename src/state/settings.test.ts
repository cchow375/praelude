import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the Tauri core invoke so we can simulate the backend being absent
// (Task 4 not yet wired) and assert the in-memory fallback behavior.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useSettings, DEFAULT_SETTINGS, __resetSettingsForTests } from "./settings";

beforeEach(() => {
  __resetSettingsForTests();
});

afterEach(() => {
  invokeMock.mockReset();
});

describe("useSettings", () => {
  it("falls back to defaults when the backend commands are missing", async () => {
    invokeMock.mockRejectedValue(new Error("command settings_snapshot not found"));

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
    expect(invokeMock).toHaveBeenCalledWith("settings_update", {
      patch: { theme: "dark" },
    });
  });

  it("loads a stored value when the backend returns one", async () => {
    invokeMock.mockResolvedValue({ theme: "light", interface_scale: 80 });

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.settings.theme).toBe("light");
    expect(result.current.settings.interface_scale).toBe(80);
    expect(invokeMock).toHaveBeenCalledWith("settings_snapshot");
  });
});
