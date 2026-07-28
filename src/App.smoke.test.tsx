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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("no backend")),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: setZoomMock }),
}));

import App from "./App";

// globals:false disables testing-library's auto-cleanup, so unmount each
// render explicitly to keep queries scoped to a single App instance.
afterEach(cleanup);

describe("App shell smoke (v3)", () => {
  it("renders the five-workspace shell with Today mounted by default", async () => {
    render(<App />);
    const nav = screen.getByRole("tablist", { name: /workspace/i });
    expect(
      within(nav)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Today", "Score", "Assistant", "History", "Universe"]);
    expect(await screen.findByTestId("workspace-today")).toBeTruthy();
  });

  it("navigates to another workspace on nav click", async () => {
    render(<App />);
    await screen.findByTestId("workspace-today");
    fireEvent.click(screen.getByRole("tab", { name: "Assistant" }));
    expect(await screen.findByTestId("workspace-brain")).toBeTruthy();
  });

  it("pins a concrete dark data-theme to <html>", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark"),
    );
  });

  it("applies the default interface scale to the native webview", async () => {
    render(<App />);
    await waitFor(() => expect(setZoomMock).toHaveBeenCalledWith(0.9));
  });
});
