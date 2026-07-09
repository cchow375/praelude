import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("no backend")),
}));

import App from "./App";

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

  it("applies a concrete data-theme to <html>", async () => {
    render(<App />);
    await waitFor(() =>
      expect(["dark", "light"]).toContain(
        document.documentElement.getAttribute("data-theme"),
      ),
    );
  });
});
