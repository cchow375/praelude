import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const setZoomMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Otherwise fully offline ("no backend"), but settings_snapshot must resolve
// so the shell can read assistant_enabled: true — this smoke suite predates
// Christian's 2026-08-24 "off by default" request and still exercises the
// Assistant nav tab/workspace, so it explicitly opts back in here.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "settings_snapshot") {
      return Promise.resolve({ assistant_enabled: true });
    }
    return Promise.reject(new Error("no backend"));
  }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: setZoomMock }),
}));

import App from "./App";

// globals:false disables testing-library's auto-cleanup, so unmount each
// render explicitly to keep queries scoped to a single App instance.
afterEach(cleanup);

describe("App shell smoke (v3)", () => {
  it("renders the core workspaces plus Assistant with Today mounted by default", async () => {
    render(<App />);
    const nav = screen.getByRole("tablist", { name: /workspace/i });
    // assistant_enabled is read async (settings_snapshot); wait for the
    // Assistant tab to actually appear before asserting the full nav order.
    await screen.findByRole("tab", { name: "Assistant" });
    expect(
      within(nav)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual([
      "Today",
      "Score",
      "Warmups",
      "Assistant",
      "History",
      "Universe",
    ]);
    expect(await screen.findByTestId("workspace-today")).toBeTruthy();
  });

  it("navigates to another workspace on nav click", async () => {
    render(<App />);
    await screen.findByTestId("workspace-today");
    fireEvent.click(screen.getByRole("tab", { name: "Assistant" }));
    expect(await screen.findByTestId("workspace-brain")).toBeTruthy();
  });

  it("pins a concrete paper data-theme to <html>", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("paper"),
    );
  });

  it("applies the default interface scale to the native webview", async () => {
    render(<App />);
    await waitFor(() => expect(setZoomMock).toHaveBeenCalledWith(0.9));
  });
});
