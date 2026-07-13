import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn().mockImplementation((command: string) => {
  if (command === "pieces_list" || command === "daily_work_list") return Promise.resolve([]);
  if (command === "recovery_preview") {
    return Promise.resolve({
      today: "2026-07-12",
      capacity_minutes: 60,
      items: [],
      days: [],
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

import { Shell } from "./Shell";

afterEach(cleanup);

describe("Shell floating workspace", () => {
  it("hosts active surfaces in movable panels without removing main practice", async () => {
    render(<Shell />);
    expect(screen.getByLabelText("Version 0.5.0")).toBeTruthy();
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
});
