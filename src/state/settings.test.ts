import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  renderHook,
  act,
  screen,
  waitFor,
} from "@testing-library/react";

// Mock the Tauri core invoke so we can simulate the backend being absent
// (Task 4 not yet wired) and assert the in-memory fallback behavior.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useSettings, DEFAULT_SETTINGS, __resetSettingsForTests } from "./settings";
import { ReceiptCenterProvider } from "../features/receipts/ReceiptCenter";

function receiptWrapper({ children }: { children: ReactNode }) {
  return createElement(ReceiptCenterProvider, null, children);
}

beforeEach(() => {
  __resetSettingsForTests();
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("useSettings", () => {
  it("falls back to defaults when the backend commands are missing", async () => {
    invokeMock.mockRejectedValue(new Error("command settings_snapshot not found"));

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("restores the prior value and surfaces a persistence failure", async () => {
    invokeMock.mockImplementation((command: string) => (
      command === "settings_snapshot"
        ? Promise.resolve({ theme: "light", interface_scale: 80 })
        : Promise.reject({
            code: "write_failed",
            message: "The theme setting could not be saved.",
          })
    ));

    const { result } = renderHook(() => useSettings(), {
      wrapper: receiptWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.setSetting("theme", "dark")).rejects.toMatchObject({
        name: "CommandError",
        command: "settings_update",
        code: "write_failed",
      });
    });

    expect(result.current.settings.theme).toBe("light");
    expect(result.current.error).toBe("The theme setting could not be saved.");
    expect(invokeMock).toHaveBeenCalledWith("settings_update", {
      patch: { theme: "dark" },
    });
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toBe("The theme setting could not be saved.");
  });

  it("loads a stored value when the backend returns one", async () => {
    invokeMock.mockResolvedValue({ theme: "light", interface_scale: 80 });

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.settings.theme).toBe("light");
    expect(result.current.settings.interface_scale).toBe(80);
    expect(invokeMock).toHaveBeenCalledWith("settings_snapshot");
  });

  it("accepts a value already committed by the deep form without writing twice", async () => {
    invokeMock.mockResolvedValue({ theme: "light", interface_scale: 80 });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    invokeMock.mockClear();

    act(() => result.current.acceptSetting("theme", "dark"));

    expect(result.current.settings.theme).toBe("dark");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rolls back only the failed key when different settings save concurrently", async () => {
    invokeMock.mockImplementation((command: string, args?: { patch?: Partial<typeof DEFAULT_SETTINGS> }) => {
      if (command === "settings_snapshot") {
        return Promise.resolve({ theme: "light", interface_scale: 80 });
      }
      if (args?.patch?.theme === "dark") {
        return Promise.reject(new Error("Theme save failed."));
      }
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useSettings(), {
      wrapper: receiptWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let writes!: PromiseSettledResult<void>[];
    await act(async () => {
      writes = await Promise.allSettled([
        result.current.setSetting("theme", "dark"),
        result.current.setSetting("interface_scale", 100),
      ]);
    });

    expect(writes.map((write) => write.status)).toEqual(["rejected", "fulfilled"]);
    expect(result.current.settings).toEqual({ theme: "light", interface_scale: 100 });
  });

  it("does not let an older failed write roll back a newer value for the same key", async () => {
    let rejectFirst: (reason: unknown) => void = () => undefined;
    const firstWrite = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    invokeMock.mockImplementation((command: string, args?: { patch?: Partial<typeof DEFAULT_SETTINGS> }) => {
      if (command === "settings_snapshot") {
        return Promise.resolve({ theme: "auto", interface_scale: 90 });
      }
      if (args?.patch?.theme === "dark") return firstWrite;
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useSettings(), {
      wrapper: receiptWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let settled!: Promise<PromiseSettledResult<void>[]>;
    act(() => {
      settled = Promise.allSettled([
        result.current.setSetting("theme", "dark"),
        result.current.setSetting("theme", "light"),
      ]);
    });
    await act(async () => {
      rejectFirst(new Error("First write failed."));
      await settled;
    });

    expect(result.current.settings.theme).toBe("light");
    expect(result.current.error).toBeNull();
    expect(invokeMock).toHaveBeenLastCalledWith("settings_update", {
      patch: { theme: "light" },
    });
  });

  it("ignores a stale first StrictMode snapshot after the active mount resolves", async () => {
    const resolvers: Array<(value: Partial<typeof DEFAULT_SETTINGS>) => void> = [];
    invokeMock.mockImplementation((command: string) => {
      if (command !== "settings_snapshot") return Promise.resolve(null);
      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    });
    const { result } = renderHook(() => useSettings(), {
      wrapper: receiptWrapper,
      reactStrictMode: true,
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));

    await act(async () => {
      resolvers[1]({ theme: "dark", interface_scale: 80 });
    });
    await waitFor(() => expect(result.current.settings.theme).toBe("dark"));

    await act(async () => {
      resolvers[0]({ theme: "light", interface_scale: 100 });
      await Promise.resolve();
    });

    expect(result.current.settings).toEqual({ theme: "dark", interface_scale: 80 });
  });
});
