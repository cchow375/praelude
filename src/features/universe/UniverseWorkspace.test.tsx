import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UniversePiece, UniverseSnapshot } from "./types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  UniverseWorkspace,
  formatDuration,
  layoutUniversePieces,
  starRadius,
} from "./UniverseWorkspace";

const FIRST_PIECE: UniversePiece = {
  piece_id: 7,
  title: "Nocturne Op. 9 No. 2",
  composer: "Chopin",
  focused_seconds: 5430,
  active_days_28: 5,
  regions_total: 3,
  regions_practiced: 2,
  regions_revisited: 1,
  mastered_targets: 1,
  recovered_targets: 1,
  open_recovery_debt: 0,
  practice_sessions: 8,
  earned_maturity: 0.64,
  quality_brightness: 0.97,
  last_practiced: "2026-07-11T20:00:00Z",
  region_signals: [
    { region_id: 1, name: "Opening", kind: "section", focused_seconds: 3600, active_days_28: 3, practiced: true, revisited: true, quality_brightness: 0.98, last_practiced: "2026-07-11T20:00:00Z", practice_events: 12, rated_rep_events: 6, clean_rep_events: 5, distinct_practice_dates: 3, mastery_contracts_completed: 1, recovery_resets: 2, recovered: true, open_recovery_debt: 0, practice_sessions: 5 },
    { region_id: 2, name: "Coda", kind: "section", focused_seconds: 1830, active_days_28: 1, practiced: true, revisited: false, quality_brightness: 0.95, last_practiced: "2026-07-10T20:00:00Z", practice_events: 4, rated_rep_events: 2, clean_rep_events: 1, distinct_practice_dates: 1 },
    { region_id: 3, name: "Middle", kind: "section", focused_seconds: 0, active_days_28: 0, practiced: false, revisited: false, quality_brightness: 0.96, last_practiced: null, practice_events: 0, rated_rep_events: 0, clean_rep_events: 0, distinct_practice_dates: 0 },
  ],
};

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
  totals: { focused_seconds: 5430, active_days_28: 5, regions_practiced: 2, regions_revisited: 1, mastered_targets: 1, recovered_targets: 1, practice_sessions: 8 },
  pieces: [FIRST_PIECE],
};

const SECOND_PIECE: UniversePiece = {
  ...FIRST_PIECE,
  piece_id: 8,
  title: "Ballade No. 1",
  composer: null,
  focused_seconds: 2400,
  active_days_28: 2,
  regions_total: 1,
  regions_practiced: 1,
  regions_revisited: 0,
  quality_brightness: 0.93,
  region_signals: [{
    ...FIRST_PIECE.region_signals[0],
    region_id: 81,
    name: "Coda sprint",
    focused_seconds: 2400,
    active_days_28: 2,
    revisited: false,
    rated_rep_events: 900,
    clean_rep_events: 900,
  }],
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) =>
    command === "universe_snapshot" ? Promise.resolve(SNAPSHOT) : Promise.resolve(null),
  );
});

afterEach(cleanup);

describe("UniverseWorkspace", () => {
  it("renders an interactive earned graph and a signal-for-signal text equivalent", async () => {
    const { container } = render(<UniverseWorkspace onOpenPractice={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("Mapping your recorded practice");
    expect(await screen.findByRole("heading", { name: "Your earned systems" })).toBeTruthy();
    expect(screen.getByRole("region", { name: /Interactive graph of practice piece systems/ })).toBeTruthy();
    expect(screen.getByText(/Clean clicks alone never make a system larger/)).toBeTruthy();
    expect(screen.getByText("Evidence ledger")).toBeTruthy();

    const graphSystem = screen.getByTestId("universe-system-7");
    const textSystem = screen.getByTestId("universe-text-7");
    for (const attribute of [
      "data-focused-seconds",
      "data-active-days",
      "data-regions-practiced",
      "data-regions-total",
      "data-regions-revisited",
      "data-mastered-targets",
      "data-recovered-targets",
      "data-practice-sessions",
      "data-earned-maturity",
      "data-quality-tint",
    ]) {
      expect(graphSystem.getAttribute(attribute)).toBe(textSystem.getAttribute(attribute));
    }
    expect(graphSystem.getAttribute("data-radius")).toBe(starRadius(FIRST_PIECE.focused_seconds).toFixed(2));
    expect(graphSystem.outerHTML).not.toContain("clean_rep_events");

    expect(container.querySelector(".universe-active-arc")?.getAttribute("stroke-dasharray")).toBe("5 23");
    expect(container.querySelector(".universe-coverage-arc")?.getAttribute("stroke-dasharray")).toMatch(/^66\.66/);
    expect(container.querySelector(".universe-mastery-arc")?.getAttribute("stroke-dasharray")).toMatch(/^33\.33/);
    expect(container.querySelectorAll(".universe-session-spark")).toHaveLength(8);
    expect(container.querySelectorAll(".universe-target-mark")).toHaveLength(3);
    expect(container.querySelectorAll(".universe-target-mark.is-practiced")).toHaveLength(2);
    expect(container.querySelectorAll(".universe-target-revisit")).toHaveLength(1);
    expect(container.querySelectorAll(".universe-target-mastery")).toHaveLength(1);
    expect(container.querySelectorAll(".universe-target-recovery")).toHaveLength(1);

    const inspector = await screen.findByRole("complementary", { name: "Nocturne Op. 9 No. 2" });
    expect(within(inspector).getByText("Opening")).toBeTruthy();
    expect(within(inspector).getByText("No recorded work", { exact: false })).toBeTruthy();
    expect(within(inspector).getByText("64%" )).toBeTruthy();
    expect(screen.getByText("Focused practice time after idle time is removed.")).toBeTruthy();
    expect(screen.getByText(/Window: 2026-06-15 through 2026-07-12/)).toBeTruthy();
  });

  it("selects systems without navigating, then opens the selected piece in Atlas explicitly", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "universe_snapshot"
        ? Promise.resolve({ ...SNAPSHOT, pieces: [FIRST_PIECE, SECOND_PIECE] })
        : Promise.resolve(null),
    );
    const onOpenPractice = vi.fn();
    render(<UniverseWorkspace onOpenPractice={onOpenPractice} />);
    const ballade = await screen.findByRole("button", { name: /Inspect Ballade No\. 1\./ });

    fireEvent.click(ballade);
    expect(onOpenPractice).not.toHaveBeenCalled();
    const inspector = await screen.findByRole("complementary", { name: "Ballade No. 1" });
    fireEvent.click(within(inspector).getByRole("button", { name: "Open Ballade No. 1 in Atlas" }));

    expect(onOpenPractice).toHaveBeenCalledTimes(1);
    expect(onOpenPractice).toHaveBeenCalledWith({ piece_id: 8, title: "Ballade No. 1" });
    expect(invokeMock.mock.calls.filter(([command]) => command === "piece_select")).toHaveLength(0);
  });

  it("supports zoom controls, wheel zoom, keyboard pan, pointer pan, and reset", async () => {
    const { container } = render(<UniverseWorkspace onOpenPractice={vi.fn()} />);
    const graph = await screen.findByRole("region", { name: /Interactive graph of practice piece systems/ });
    const world = container.querySelector(".universe-map > g") as SVGGElement;
    const initialZoom = Number(graph.getAttribute("data-zoom"));
    const initialTransform = world.getAttribute("transform");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(Number(graph.getAttribute("data-zoom"))).toBeGreaterThan(initialZoom);
    const afterButtonZoom = Number(graph.getAttribute("data-zoom"));
    fireEvent.wheel(graph, { deltaY: -100, clientX: 220, clientY: 180 });
    expect(Number(graph.getAttribute("data-zoom"))).toBeGreaterThan(afterButtonZoom);

    const beforeKeyboardPan = world.getAttribute("transform");
    fireEvent.keyDown(graph, { key: "ArrowRight" });
    expect(world.getAttribute("transform")).not.toBe(beforeKeyboardPan);

    const beforePointerPan = world.getAttribute("transform");
    fireEvent.pointerDown(graph, { pointerId: 4, button: 0, clientX: 40, clientY: 40 });
    fireEvent.pointerMove(graph, { pointerId: 4, clientX: 100, clientY: 85 });
    fireEvent.pointerUp(graph, { pointerId: 4, clientX: 100, clientY: 85 });
    expect(world.getAttribute("transform")).not.toBe(beforePointerPan);

    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(Number(graph.getAttribute("data-zoom"))).toBe(initialZoom);
    expect(world.getAttribute("transform")).toBe(initialTransform);
  });

  it("uses roving arrow-key focus between named systems without opening Practice", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "universe_snapshot"
        ? Promise.resolve({ ...SNAPSHOT, pieces: [FIRST_PIECE, SECOND_PIECE] })
        : Promise.resolve(null),
    );
    const onOpenPractice = vi.fn();
    render(<UniverseWorkspace onOpenPractice={onOpenPractice} />);
    const nocturne = await screen.findByRole("button", { name: /Inspect Nocturne Op\. 9 No\. 2 by Chopin\./ });
    const ballade = screen.getByRole("button", { name: /Inspect Ballade No\. 1\./ });

    nocturne.focus();
    fireEvent.keyDown(nocturne, { key: "ArrowRight" });
    expect(document.activeElement).toBe(ballade);
    expect(ballade.getAttribute("aria-pressed")).toBe("true");
    expect(onOpenPractice).not.toHaveBeenCalled();
  });

  it("has an honest empty state that goes directly to Practice", async () => {
    invokeMock.mockResolvedValue({ ...SNAPSHOT, pieces: [], totals: { focused_seconds: 0, active_days_28: 0, regions_practiced: 0, regions_revisited: 0 } });
    const onOpenPractice = vi.fn();
    render(<UniverseWorkspace onOpenPractice={onOpenPractice} />);

    expect(await screen.findByRole("heading", { name: "Your universe is quiet for now." })).toBeTruthy();
    expect(screen.queryByText("Your earned systems")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Open Score Atlas" })[1]);
    expect(onOpenPractice).toHaveBeenCalledWith(null);
  });

  it("surfaces load failure and retries without inventing graph data", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("Database unavailable"))
      .mockResolvedValueOnce(SNAPSHOT);
    render(<UniverseWorkspace onOpenPractice={vi.fn()} />);

    expect((await screen.findByRole("alert")).textContent).toContain("Database unavailable");
    expect(screen.queryByTestId("universe-system-7")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("universe-system-7")).toBeTruthy();
  });

  it("lays out dense snapshots deterministically from IDs, independent of API order", () => {
    const dense = Array.from({ length: 64 }, (_, index) => ({
      ...FIRST_PIECE,
      piece_id: 1_000 + index * 17,
      title: `Piece ${index}`,
      region_signals: [],
    }));
    const forward = layoutUniversePieces(dense);
    const reversed = layoutUniversePieces([...dense].reverse());
    const coordinates = (layout: ReturnType<typeof layoutUniversePieces>) => new Map(
      layout.nodes.map((node) => [node.piece.piece_id, `${node.x.toFixed(3)}:${node.y.toFixed(3)}`]),
    );

    expect(coordinates(forward)).toEqual(coordinates(reversed));
    expect(new Set(forward.nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(64);
    expect(forward.rows).toBeGreaterThan(1);
    expect(forward.columns).toBeGreaterThan(1);
    expect(forward.width).toBeGreaterThan(1_060);
  });

  it("never lets clean-click volume buy radius and safely formats durations", () => {
    const noCleans = { ...FIRST_PIECE, region_signals: [{ ...FIRST_PIECE.region_signals[0], clean_rep_events: 0 }] };
    const manyCleans = { ...FIRST_PIECE, piece_id: 99, region_signals: [{ ...FIRST_PIECE.region_signals[0], clean_rep_events: 999_999 }] };
    const layout = layoutUniversePieces([noCleans, manyCleans]);
    expect(layout.nodes[0].radius).toBe(layout.nodes[1].radius);
    expect(starRadius(0)).toBe(18);
    expect(starRadius(Number.MAX_SAFE_INTEGER)).toBe(50);
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(12)).toBe("<1m");
    expect(formatDuration(125)).toBe("2m");
    expect(formatDuration(3720)).toBe("1h 2m");
    expect(formatDuration(Number.NaN)).toBe("0m");
  });
});
