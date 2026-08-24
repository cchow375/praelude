import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The Brain workspace and its status line drive themselves off the native
// Tauri invoke seam. Mock it to answer the load-path commands the workspace
// issues on mount (status + pieces + plan) and a typed question (brain_ask).
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((command: string) => {
    switch (command) {
      // Christian's 2026-08-24 request flipped the real default to off; this
      // suite exercises the Brain workspace, so it explicitly opts back in.
      case "settings_snapshot":
        return Promise.resolve({ assistant_enabled: true });
      case "brain_status":
        return Promise.resolve({
          online: true,
          provider: "gemini",
          reason: null,
        });
      case "pieces_list":
        return Promise.resolve([]);
      case "brain_plan_preview":
        return Promise.resolve([]);
      case "brain_ask":
        return Promise.resolve({
          id: "voice-answer",
          answer: "Try three slow landings.",
          provider: "offline",
          citations: [],
          methods: [],
          intake_review: null,
        });
      default:
        return Promise.resolve(null);
    }
  }),
}));

import { Shell } from "../../shell/Shell";

afterEach(cleanup);

describe("Brain navigation (v3 shell)", () => {
  it("navigates to the Brain workspace from the shell nav", async () => {
    render(<Shell />);
    fireEvent.click(await screen.findByRole("tab", { name: "Assistant" }));
    expect(await screen.findByTestId("workspace-brain")).toBeTruthy();
    // Today is no longer mounted once Brain is the active tab.
    expect(screen.queryByTestId("workspace-today")).toBeNull();
  });

  it("answers a typed question inside the Brain workspace", async () => {
    render(<Shell />);
    fireEvent.click(await screen.findByRole("tab", { name: "Assistant" }));

    fireEvent.change(await screen.findByLabelText("Ask Coda"), {
      target: { value: "How do I land this leap?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("Try three slow landings.")).toBeTruthy();
  });

  it("shows the persistent Brain status line", async () => {
    render(<Shell />);
    fireEvent.click(await screen.findByRole("tab", { name: "Assistant" }));
    expect(await screen.findByText("● configured — gemini")).toBeTruthy();
  });
});
