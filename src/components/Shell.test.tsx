import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepSnapshot } from "../features/rep/useRep";

const invokeMock = vi.fn().mockImplementation((command: string) => {
  if (command === "pieces_list" || command === "daily_work_list") return Promise.resolve([]);
  if (command === "universe_snapshot") {
    return Promise.resolve({
      generated_at: "2026-07-12T17:00:00Z",
      definitions: [],
      traces: {
        source: "canonical practice events",
        practice_event_kinds: ["rep"],
        idle_threshold_seconds: 300,
        active_window_start: "2026-06-15",
        active_window_end: "2026-07-12",
        quality_formula: "bounded smoothing",
      },
      totals: { focused_seconds: 0, active_days_28: 0, regions_practiced: 0, regions_revisited: 0 },
      pieces: [],
    });
  }
  if (command === "recovery_preview") {
    return Promise.resolve({
      today: "2026-07-12",
      capacity_minutes: 60,
      items: [],
      days: [],
    });
  }
  if (command === "settings_snapshot") {
    return Promise.resolve({
      theme: "auto", tts_provider: "auto", tts_voice: "Kore", brain_provider: "auto",
      wake_word_enabled: false, wake_word: "coda", metronome_sound: "woodblock",
      metronome_boost: false, metronome_boost_level: 85, ladder_default_reps: 30,
      ladder_bpm_step: 4, calendar_capacity_minutes: 60,
      vault_pieces_dir: "/vault/Pieces",
      verdict_aliases: { clean: [], flawed: [], failed: [] },
      api_keys: [
        { provider: "claude", configured: false, source: "none" },
        { provider: "gemini", configured: true, source: "keychain" },
      ],
    });
  }
  return Promise.resolve(null);
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("../features/voice/useVoice", () => ({
  useVoice: () => ({ status: "live", mute: vi.fn(), lastIntent: null, downGuidance: null }),
}));
vi.mock("../features/rep/useRep", () => ({
  useRep: () => ({
    snap: { block_id: 1, piece_id: 1, piece_title: "Scherzo", m_start: 1, m_end: 8, label: null, bpm: 60, start_bpm: 60, target_bpm: 90, planned_reps: 10, reps_done: 2, cleans_at_step: 0, rule: { clean_needed: 3, bpm_step: 4 }, variant: null, variants: [], verdicts: { clean: 2, flawed: 0, failed: 0 }, last: null, status: "open", focus: "tempo", use_metronome: true },
    feed: [], error: null, open: vi.fn(), check: vi.fn(), close: vi.fn(), clearError: vi.fn(),
  }),
}));
vi.mock("../features/session/useSession", () => ({
  useSession: () => ({
    session: { id: 1, started_at: new Date().toISOString(), events: [] },
    endSession: vi.fn(), error: null, clearError: vi.fn(),
  }),
}));

import { Shell, groundPracticeBrainContext } from "./Shell";

afterEach(cleanup);

describe("Shell floating workspace", () => {
  it("never labels another piece's active rep as the selected piece", () => {
    const context = {
      piece_id: 2,
      piece_title: "Beethoven",
      composer: "Beethoven",
      surface: "score" as const,
      region: null,
      current_page: 1,
      edition_id: null,
      edition_label: null,
    };
    const otherPieceRep = {
      piece_id: 1,
      m_start: 40,
      m_end: 56,
      bpm: 92,
      target_bpm: 120,
      focus: "tempo",
      reps_done: 4,
      planned_reps: 10,
    } as RepSnapshot;
    expect(groundPracticeBrainContext(context, otherPieceRep)?.active_block).toBeNull();
  });

  it("lands intentionally on Home, then keeps active surfaces when Practice opens", async () => {
    render(<Shell />);
    expect(screen.getByLabelText("Version 1.3.0")).toBeTruthy();
    expect(await screen.findByTestId("universe-workspace")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Practice" }));
    await waitFor(() => expect(screen.getByTestId("panel-rep")).toBeTruthy());
    expect(screen.getByTestId("panel-session")).toBeTruthy();
    expect(screen.getByTestId("main-practice")).toBeTruthy();
    expect(screen.getAllByLabelText("Collapse panel")).toHaveLength(1);
    expect(screen.getByLabelText("Expand panel")).toBeTruthy();
  });

  it("exposes a reset-layout recovery control", async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset panel layout" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("layout_set", expect.anything()), { timeout: 1000 });
  });

  it("opens Calendar as a top-level workspace", async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(await screen.findByTestId("calendar-workspace")).toBeTruthy();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("daily_work_list", expect.anything()));
  });

  it("keeps Brain as an overlay tool while the three workspaces stay navigable", async () => {
    render(<Shell />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Home", "Practice", "Calendar"]);
    expect(screen.queryByRole("tab", { name: "Brain" })).toBeNull();
    const brain = screen.getByRole("button", { name: "Brain" });
    fireEvent.click(brain);
    expect(brain.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("complementary", { name: "Practice Brain" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Metronome" })).toBeTruthy();

    const home = screen.getByRole("tab", { name: "Home" });
    fireEvent.keyDown(home, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Practice" }).getAttribute("aria-selected")).toBe("true"));
  });
});
