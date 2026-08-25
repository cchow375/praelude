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
const REP_SNAPSHOT_FIXTURE = {
  block_id: 1,
  piece_id: 7,
  piece_title: "Gymnopédie No. 1",
  m_start: 1,
  m_end: 8,
  label: null,
  bpm: 72,
  start_bpm: 60,
  target_bpm: 84,
  planned_reps: 30,
  reps_done: 4,
  cleans_at_step: 1,
  rule: { clean_needed: 3, bpm_step: 4 },
  variant: null,
  variants: [],
  verdicts: { clean: 3, flawed: 1, failed: 0 },
  last: { verdict: "flawed", note: "rushed", bpm: 72 },
  status: "active",
  focus: "tempo",
  use_metronome: true,
  current_clean_streak: 2,
  best_clean_streak: 3,
  reset_count: 1,
  accuracy: 0.75,
  required_clean_streak: 5,
  effective_required_clean_streak: 5,
  recovery_remaining: 0,
  mastery_status: "not_satisfied",
  mastery_verified: true,
  set_state: "active",
  last_attempt_id: 44,
  last_adjustment_id: null,
};

let repStateResponse: unknown = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "settings_snapshot") {
      return Promise.resolve({ assistant_enabled: true });
    }
    if (command === "rep_state") {
      return Promise.resolve(repStateResponse);
    }
    return Promise.resolve(null);
  }),
}));

import { Shell } from "./Shell";

afterEach(() => {
  cleanup();
  repStateResponse = null;
});

describe("Shell", () => {
  describe("the rep HUD's collapse state (B82)", () => {
    const originalInnerHeight = window.innerHeight;

    afterEach(() => {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      });
    });

    it("never seeds collapsed, regardless of window height — the 520px OS floor always fits the expanded HUD", async () => {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 520,
      });
      repStateResponse = REP_SNAPSHOT_FIXTURE;
      render(<Shell />);
      const hud = await screen.findByRole("region", {
        name: "Active practice set",
      });
      expect(hud.classList.contains("is-collapsed")).toBe(false);
      expect(screen.getByRole("button", { name: "Clean" })).toBeTruthy();
    });

    it("keeps a deliberate 'Collapse set' choice across an ordinary window resize", async () => {
      repStateResponse = REP_SNAPSHOT_FIXTURE;
      render(<Shell />);
      const hud = await screen.findByRole("region", {
        name: "Active practice set",
      });
      fireEvent.click(screen.getByRole("button", { name: "Collapse set" }));
      expect(hud.classList.contains("is-collapsed")).toBe(true);

      fireEvent(window, new Event("resize"));

      expect(hud.classList.contains("is-collapsed")).toBe(true);
    });
  });
  it("shows the mic control in the rail with nothing open (the one-gesture rule)", async () => {
    render(<Shell />);
    expect(
      await screen.findByRole("button", { name: /^mic (listening|muted)/i }),
    ).toBeTruthy();
  });

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
