import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

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

describe("App shell smoke", () => {
  it("renders the shell and toggles a popover open/closed", async () => {
    render(<App />);

    expect(screen.getByText("CodaKiller")).toBeTruthy();

    const settingsBtn = screen.getByRole("button", { name: "Settings" });
    fireEvent.click(settingsBtn);

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy(),
    );

    // Escape dismisses.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(settingsBtn.getAttribute("aria-expanded")).toBe("false"),
    );
  });

  it("renders the mic button and toggles mute inside its popover", async () => {
    render(<App />);

    const micBtn = screen.getByRole("button", { name: "Microphone" });
    expect(micBtn).toBeTruthy();

    fireEvent.click(micBtn);
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Microphone" })).toBeTruthy(),
    );

    // Starts live -> the toggle offers "Mute". Clicking it optimistically
    // mutes (the mocked invoke rejects, but that is swallowed) so the control
    // flips to "Unmute".
    const muteBtn = screen.getByRole("button", { name: "Mute" });
    fireEvent.click(muteBtn);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy(),
    );
  });

  it("applies a concrete data-theme to <html>", async () => {
    render(<App />);
    await waitFor(() =>
      expect(["dark", "light"]).toContain(
        document.documentElement.getAttribute("data-theme"),
      ),
    );
  });

  it("applies the default interface scale to the native webview", async () => {
    render(<App />);
    await waitFor(() => expect(setZoomMock).toHaveBeenCalledWith(0.9));
  });
});
