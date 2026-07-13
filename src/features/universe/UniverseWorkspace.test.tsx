import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UniverseSnapshot } from "./types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { UniverseWorkspace, formatDuration, starRadius } from "./UniverseWorkspace";

const SNAPSHOT: UniverseSnapshot = {
  generated_at: "2026-07-12T17:00:00Z",
  definitions: [
    { signal: "focused_time", label: "Star size", definition: "Focused practice time after idle time is removed." },
    { signal: "continuity", label: "Orbit continuity", definition: "Distinct active days in the inclusive 28-day window." },
    { signal: "regions", label: "Planets", definition: "Regions with recorded practice." },
    { signal: "revisited", label: "Planet halo", definition: "Regions practiced on at least two distinct local dates." },
    { signal: "quality", label: "Brightness", definition: "A subtle quality tint, never a score." },
  ],
  traces: {
    source: "canonical practice events",
    practice_event_kinds: ["rep_open", "rep", "verdict", "tempo_change"],
    idle_threshold_seconds: 300,
    active_window_start: "2026-06-15",
    active_window_end: "2026-07-12",
    quality_formula: "bounded smoothing",
  },
  totals: { focused_seconds: 5430, active_days_28: 5, regions_practiced: 2, regions_revisited: 1 },
  pieces: [
    {
      piece_id: 7,
      title: "Nocturne Op. 9 No. 2",
      composer: "Chopin",
      focused_seconds: 5430,
      active_days_28: 5,
      regions_total: 3,
      regions_practiced: 2,
      regions_revisited: 1,
      quality_brightness: 0.97,
      last_practiced: "2026-07-11T20:00:00Z",
      region_signals: [
        { region_id: 1, name: "Opening", kind: "section", focused_seconds: 3600, active_days_28: 3, practiced: true, revisited: true, quality_brightness: 0.98, last_practiced: "2026-07-11T20:00:00Z", practice_events: 12, rated_rep_events: 6, clean_rep_events: 5, distinct_practice_dates: 3 },
        { region_id: 2, name: "Coda", kind: "section", focused_seconds: 1830, active_days_28: 1, practiced: true, revisited: false, quality_brightness: 0.95, last_practiced: "2026-07-10T20:00:00Z", practice_events: 4, rated_rep_events: 2, clean_rep_events: 1, distinct_practice_dates: 1 },
        { region_id: 3, name: "Middle", kind: "section", focused_seconds: 0, active_days_28: 0, practiced: false, revisited: false, quality_brightness: 0.96, last_practiced: null, practice_events: 0, rated_rep_events: 0, clean_rep_events: 0, distinct_practice_dates: 0 },
      ],
    },
  ],
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) =>
    command === "universe_snapshot" ? Promise.resolve(SNAPSHOT) : Promise.resolve(null),
  );
});

afterEach(cleanup);

describe("UniverseWorkspace", () => {
  it("renders an accessible SVG and a complete text equivalent", async () => {
    const { container } = render(<UniverseWorkspace onOpenPractice={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("Mapping your practice");
    expect(await screen.findByRole("heading", { name: "Your working constellation" })).toBeTruthy();
    expect(screen.getByRole("group", { name: /^Practice pieces shown as stars/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open Nocturne Op\. 9 No\. 2 by Chopin in Practice\./ })).toBeTruthy();
    expect(screen.getAllByText("1h 30m")).toHaveLength(2);
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.getByText("97% tint · not a grade")).toBeTruthy();
    expect(screen.getByText("Signal definitions")).toBeTruthy();
    expect(screen.getByText("Focused practice time after idle time is removed.")).toBeTruthy();
    expect(screen.getByText(/Window: 2026-06-15 through 2026-07-12/)).toBeTruthy();
    expect(container.querySelector(".universe-orbit")?.getAttribute("stroke-dasharray")).toBe("5 23");
    expect(container.querySelectorAll(".universe-planet")).toHaveLength(2);

    fireEvent.click(screen.getByText("Regions"));
    expect(screen.getByText("Opening")).toBeTruthy();
    expect(screen.getByText("1h 0m · 3 active days · revisited")).toBeTruthy();
    expect(screen.getByText("No recorded work yet")).toBeTruthy();
  });

  it("selects a star with keyboard and only then enters Practice", async () => {
    const onOpenPractice = vi.fn();
    render(<UniverseWorkspace onOpenPractice={onOpenPractice} />);
    const star = await screen.findByRole("button", { name: /Open Nocturne Op\. 9 No\. 2 by Chopin in Practice\./ });

    fireEvent.keyDown(star, { key: "Enter" });

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("piece_select", { id: 7 }));
    expect(onOpenPractice).toHaveBeenCalledWith({ piece_id: 7, title: "Nocturne Op. 9 No. 2" });
  });

  it("moves focus between named stars with arrow keys", async () => {
    const second = {
      ...SNAPSHOT.pieces[0],
      piece_id: 8,
      title: "Ballade No. 1",
      composer: null,
      region_signals: [],
    };
    invokeMock.mockResolvedValue({ ...SNAPSHOT, pieces: [SNAPSHOT.pieces[0], second] });
    render(<UniverseWorkspace onOpenPractice={vi.fn()} />);
    const first = await screen.findByRole("button", { name: /Open Nocturne Op\. 9 No\. 2 by Chopin in Practice\./ });
    const next = screen.getByRole("button", { name: /Open Ballade No\. 1 in Practice\./ });

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(next);
  });

  it("keeps the user on Home and reports a failed piece selection", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "universe_snapshot") return Promise.resolve(SNAPSHOT);
      if (command === "piece_select") return Promise.reject(new Error("Piece is no longer available"));
      return Promise.resolve(null);
    });
    const onOpenPractice = vi.fn();
    render(<UniverseWorkspace onOpenPractice={onOpenPractice} />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Nocturne Op. 9 No. 2 in Practice" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Piece is no longer available");
    expect(onOpenPractice).not.toHaveBeenCalled();
  });

  it("has a useful empty state that goes directly to Practice", async () => {
    invokeMock.mockResolvedValue({ ...SNAPSHOT, pieces: [], totals: { focused_seconds: 0, active_days_28: 0, regions_practiced: 0, regions_revisited: 0 } });
    const onOpenPractice = vi.fn();
    render(<UniverseWorkspace onOpenPractice={onOpenPractice} />);

    expect(await screen.findByRole("heading", { name: "Your universe is quiet for now." })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Practice" }));
    expect(onOpenPractice).toHaveBeenCalledWith(null);
  });

  it("surfaces load failure and retries without inventing data", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("Database unavailable"))
      .mockResolvedValueOnce(SNAPSHOT);
    render(<UniverseWorkspace onOpenPractice={vi.fn()} />);

    expect((await screen.findByRole("alert")).textContent).toContain("Database unavailable");
    expect(screen.queryByText("Nocturne Op. 9 No. 2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Nocturne Op. 9 No. 2" })).toBeTruthy();
  });

  it("bounds visual size and formats tiny, minute, and hour durations", () => {
    expect(starRadius(0)).toBe(12);
    expect(starRadius(Number.MAX_SAFE_INTEGER)).toBe(31);
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(12)).toBe("<1m");
    expect(formatDuration(125)).toBe("2m");
    expect(formatDuration(3720)).toBe("1h 2m");
  });
});
