import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { TodayWorkspace, compactDuration, todayLabel } from "./TodayWorkspace";

const SNAPSHOT = {
  generated_at: "2026-07-15T12:00:00Z",
  definitions: [],
  traces: {
    source: "canonical ledger",
    practice_event_kinds: [],
    idle_threshold_seconds: 300,
    active_window_start: "2026-06-18",
    active_window_end: "2026-07-15",
    quality_formula: "bounded",
  },
  totals: { focused_seconds: 7320, active_days_28: 8, regions_practiced: 12, regions_revisited: 5 },
  pieces: [
    {
      piece_id: 1,
      title: "Older Piece",
      composer: null,
      focused_seconds: 120,
      active_days_28: 1,
      regions_total: 1,
      regions_practiced: 1,
      regions_revisited: 0,
      quality_brightness: 1,
      last_practiced: "2026-07-10T12:00:00Z",
      region_signals: [],
    },
    {
      piece_id: 7,
      title: "Scherzo No. 2",
      composer: "Chopin",
      focused_seconds: 7200,
      active_days_28: 7,
      regions_total: 14,
      regions_practiced: 11,
      regions_revisited: 5,
      quality_brightness: 1,
      last_practiced: "2026-07-14T12:00:00Z",
      region_signals: [],
    },
  ],
};

beforeEach(() => invokeMock.mockReset().mockResolvedValue(SNAPSHOT));
afterEach(cleanup);

describe("TodayWorkspace", () => {
  it("launches the most recent canonical piece and exposes sourced totals", async () => {
    const onOpenPiece = vi.fn();
    render(<TodayWorkspace onOpenAtlas={vi.fn()} onOpenCalendar={vi.fn()} onOpenPiece={onOpenPiece} />);

    expect(await screen.findByRole("heading", { name: "Scherzo No. 2" })).toBeTruthy();
    expect(screen.getByText("2h 2m")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Targets revisited").parentElement?.textContent).toBe("Targets revisited5");

    fireEvent.click(screen.getByRole("button", { name: /Continue in Atlas/ }));
    expect(onOpenPiece).toHaveBeenCalledWith({ piece_id: 7, title: "Scherzo No. 2" });
  });

  it("routes the day action and keeps failures explicit/retryable", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Ledger unavailable")).mockResolvedValueOnce(SNAPSHOT);
    const onOpenCalendar = vi.fn();
    render(<TodayWorkspace onOpenAtlas={vi.fn()} onOpenCalendar={onOpenCalendar} onOpenPiece={vi.fn()} />);

    expect((await screen.findByRole("alert")).textContent).toContain("Ledger unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Scherzo No. 2" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Shape the day/ }));
    expect(onOpenCalendar).toHaveBeenCalledOnce();
  });

  it("shows the configured default contract instead of claiming a fixed five", async () => {
    render(
      <TodayWorkspace
        onOpenAtlas={vi.fn()}
        onOpenCalendar={vi.fn()}
        onOpenPiece={vi.fn()}
        defaultCleanStreak={7}
      />,
    );

    await screen.findByRole("heading", { name: "Scherzo No. 2" });
    expect(screen.getByLabelText("Default contract: 7 clean attempts in a row")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("has deterministic time and date formatting", () => {
    expect(compactDuration(0)).toBe("0m");
    expect(compactDuration(59)).toBe("1m");
    expect(compactDuration(3600)).toBe("1h");
    expect(compactDuration(7320)).toBe("2h 2m");
    expect(todayLabel(new Date(2026, 6, 15))).toMatch(/Wednesday/);
  });
});
