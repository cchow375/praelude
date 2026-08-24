import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Christian's 2026-08-24 request flipped assistant_enabled's real default to
// off; this suite exercises the full five-tab nav, so it explicitly opts
// back in. Every other command resolves null (this file otherwise runs with
// no backend, as before).
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "settings_snapshot") {
      return Promise.resolve({ assistant_enabled: true });
    }
    return Promise.resolve(null);
  }),
}));

import { Shell } from "./Shell";

afterEach(cleanup);

describe("Shell", () => {
  it("renders exactly five workspace nav targets", async () => {
    render(<Shell />);
    const nav = screen.getByRole("tablist", { name: /workspace/i });
    await screen.findByRole("tab", { name: "Assistant" });
    const tabs = within(nav).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Today",
      "Score",
      "Assistant",
      "History",
      "Universe",
    ]);
  });

  it("mounts the Today workspace by default", async () => {
    render(<Shell />);
    expect(await screen.findByTestId("workspace-today")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Today" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("switches the mounted workspace when a nav target is chosen", async () => {
    render(<Shell />);
    await screen.findByTestId("workspace-today");
    fireEvent.click(screen.getByRole("tab", { name: "Universe" }));
    await waitFor(() =>
      expect(screen.getByTestId("workspace-universe")).toBeTruthy(),
    );
    expect(
      screen
        .getByRole("tab", { name: "Universe" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});
