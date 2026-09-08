import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Christian's 2026-08-24 request flipped assistant_enabled's real default to
// off; this suite exercises the full nav, so it explicitly opts
// back in.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "settings_snapshot") {
      return Promise.resolve({ assistant_enabled: true });
    }
    return Promise.resolve(null);
  }),
}));

import { Shell } from "./Shell";

// B4 shell-scale contract: the rail nav is now icon + short label. Each target
// carries a quiet inline-SVG glyph (never emoji, never an icon font), the glyph
// is decorative (aria-hidden) so the accessible name still comes from the label
// alone, and the Metronome/Settings foot buttons get the same treatment.

afterEach(cleanup);

describe("Shell rail scale (B4)", () => {
  it("gives every workspace target a decorative inline-SVG glyph beside its label", async () => {
    render(<Shell />);
    const nav = screen.getByRole("tablist", { name: /workspace/i });
    await screen.findByRole("tab", { name: "Assistant" });
    const tabs = within(nav).getAllByRole("tab");

    expect(tabs).toHaveLength(6);
    for (const tab of tabs) {
      const glyph = tab.querySelector("svg.shell-nav-icon");
      expect(
        glyph,
        `nav target "${tab.textContent}" has an inline-SVG glyph`,
      ).not.toBeNull();
      // Decorative: hidden from the a11y tree, drawn in currentColor with the
      // consistent 1.5px monochrome stroke — no emoji, no icon-font glyph.
      expect(glyph?.getAttribute("aria-hidden")).toBe("true");
      expect(glyph?.getAttribute("stroke")).toBe("currentColor");
      expect(glyph?.getAttribute("stroke-width")).toBe("1.5");
      expect(tab.querySelector("svg")?.querySelector("image")).toBeNull();
    }

    // The accessible name still comes from the label text only — the glyph adds
    // no text content, so the label contract is preserved.
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Today",
      "Score",
      "Warmups",
      "Assistant",
      "Pieces",
      "Studio",
    ]);
  });

  it("gives the Metronome and Settings foot buttons the same inline-SVG glyph", () => {
    render(<Shell />);
    // Scope to the rail: the Today main menu renders its own "Settings" entry.
    const rail = screen
      .getByRole("tablist", { name: /workspace/i })
      .closest(".shell-rail") as HTMLElement;
    expect(rail, "rail container exists").not.toBeNull();
    for (const name of ["Metronome", "Settings"]) {
      const button = within(rail).getByRole("button", { name });
      expect(
        button.querySelector("svg.shell-nav-icon"),
        `${name} foot button has an inline-SVG glyph`,
      ).not.toBeNull();
      expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    }
  });
});
