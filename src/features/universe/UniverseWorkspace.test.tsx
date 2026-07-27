import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UniversePiece, UniverseSnapshot } from "./types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { UniverseWorkspace, formatDuration } from "./UniverseWorkspace";

const PIECE: UniversePiece = {
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
    {
      region_id: 1,
      name: "Opening",
      kind: "section",
      focused_seconds: 3600,
      active_days_28: 3,
      practiced: true,
      revisited: true,
      quality_brightness: 0.98,
      last_practiced: "2026-07-11T20:00:00Z",
      practice_events: 12,
      rated_rep_events: 6,
      clean_rep_events: 5,
      distinct_practice_dates: 3,
      mastery_contracts_completed: 1,
      recovery_resets: 2,
      recovered: true,
      open_recovery_debt: 0,
      practice_sessions: 2,
    },
    {
      region_id: 2,
      name: "Coda",
      kind: "section",
      focused_seconds: 1830,
      active_days_28: 1,
      practiced: true,
      revisited: false,
      quality_brightness: 0.95,
      last_practiced: "2026-07-10T20:00:00Z",
      practice_events: 4,
      rated_rep_events: 2,
      clean_rep_events: 1,
      distinct_practice_dates: 1,
      practice_sessions: 1,
    },
    {
      region_id: 3,
      name: "Middle",
      kind: "section",
      focused_seconds: 0,
      active_days_28: 0,
      practiced: false,
      revisited: false,
      quality_brightness: 0.96,
      last_practiced: null,
      practice_events: 0,
      rated_rep_events: 0,
      clean_rep_events: 0,
      distinct_practice_dates: 0,
      practice_sessions: 0,
    },
  ],
};

const SNAPSHOT: UniverseSnapshot = {
  generated_at: "2026-07-12T17:00:00Z",
  definitions: [],
  traces: {
    source: "canonical practice events",
    practice_event_kinds: ["rep_open", "rep", "verdict", "tempo_change"],
    idle_threshold_seconds: 300,
    active_window_start: "2026-06-15",
    active_window_end: "2026-07-12",
    quality_formula: "bounded smoothing",
  },
  totals: {
    focused_seconds: 5430,
    active_days_28: 5,
    regions_practiced: 2,
    regions_revisited: 1,
    mastered_targets: 1,
    recovered_targets: 1,
    practice_sessions: 8,
  },
  pieces: [PIECE],
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) =>
    command === "universe_snapshot"
      ? Promise.resolve(SNAPSHOT)
      : Promise.resolve(null),
  );
});

afterEach(cleanup);

function node(container: HTMLElement, id: string): SVGGElement {
  const element = container.querySelector(`[data-node-id="${id}"]`);
  if (!element) throw new Error(`node ${id} not found`);
  return element as unknown as SVGGElement;
}

describe("UniverseWorkspace force graph", () => {
  it("renders a live galaxy of suns, planets and satellites from the snapshot", async () => {
    const { container } = render(
      <UniverseWorkspace onOpenPractice={vi.fn()} />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Mapping your recorded practice",
    );
    expect(
      await screen.findByRole("heading", { name: "Your earned systems" }),
    ).toBeTruthy();

    // sun for the piece, one planet per region, satellites from session counts.
    expect(container.querySelector('[data-node-id="piece-7"]')).toBeTruthy();
    expect(container.querySelectorAll(".universe-node-planet")).toHaveLength(3);
    // region 1 has 2 sessions, region 2 has 1, region 3 has 0 -> 3 satellites.
    expect(container.querySelectorAll(".universe-node-satellite")).toHaveLength(
      3,
    );
  });

  it("drags a node: position updates and nothing throws", async () => {
    const { container } = render(
      <UniverseWorkspace onOpenPractice={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: "Your earned systems" });

    const planet = node(container, "region-1");
    const before = planet.getAttribute("transform");

    expect(() => {
      fireEvent.pointerDown(planet, {
        pointerId: 1,
        button: 0,
        clientX: 200,
        clientY: 200,
      });
      fireEvent.pointerMove(planet, {
        pointerId: 1,
        clientX: 320,
        clientY: 300,
      });
      fireEvent.pointerUp(planet, { pointerId: 1, clientX: 320, clientY: 300 });
    }).not.toThrow();

    expect(node(container, "region-1").getAttribute("transform")).not.toBe(
      before,
    );
  });

  it("clicking a planet opens the DetailPanel with that region's data", async () => {
    const { container } = render(
      <UniverseWorkspace onOpenPractice={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: "Your earned systems" });

    const planet = node(container, "region-1");
    fireEvent.pointerDown(planet, {
      pointerId: 2,
      button: 0,
      clientX: 150,
      clientY: 150,
    });
    fireEvent.pointerUp(planet, { pointerId: 2, clientX: 150, clientY: 150 });

    const panel = await screen.findByRole("complementary", { name: "Opening" });
    expect(within(panel).getByText("Region")).toBeTruthy();
    // reps = rated_rep_events (6), clean reps = clean_rep_events (5)
    expect(within(panel).getByText("Reps").nextSibling?.textContent).toBe("6");
    expect(
      within(panel).getByRole("button", { name: "Open on score" }),
    ).toBeTruthy();
  });

  it("suppresses mouse-press focus on a node so a click can't scroll-teleport it", async () => {
    const { container } = render(
      <UniverseWorkspace onOpenPractice={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: "Your earned systems" });

    const planet = node(container, "region-1");
    // The node stays keyboard-focusable for a11y (Tab + Enter still work).
    expect(planet.getAttribute("tabindex")).toBe("0");

    // A primary-button press must call preventDefault. Because the <g> is
    // focusable, the browser's focus-on-press would otherwise scroll it to the
    // centre of the nearest scroll container — the reported "clicked ball
    // teleports to the middle of the view" regression. preventDefault on the
    // (delegated) pointerdown cancels the compat mousedown whose default action
    // is focus, while leaving keyboard Tab focus untouched.
    const down = createEvent.pointerDown(planet, { button: 0, pointerId: 5 });
    fireEvent(planet, down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("opens graph detail with the keyboard and from the text equivalent", async () => {
    render(<UniverseWorkspace onOpenPractice={vi.fn()} />);
    await screen.findByRole("heading", { name: "Your earned systems" });

    const region = screen.getByRole("button", { name: /planet · Opening/i });
    region.focus();
    fireEvent.keyDown(region, { key: "Enter" });
    expect(
      await screen.findByRole("complementary", { name: "Opening" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Evidence ledger — text equivalent"));
    fireEvent.click(
      screen.getByRole("button", { name: "Nocturne Op. 9 No. 2" }),
    );
    expect(
      await screen.findByRole("complementary", {
        name: "Nocturne Op. 9 No. 2",
      }),
    ).toBeTruthy();
  });

  it("hover focuses a system: the canvas takes the hovering class", async () => {
    const { container } = render(
      <UniverseWorkspace onOpenPractice={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: "Your earned systems" });
    const canvas = container.querySelector(".universe-canvas") as SVGSVGElement;
    expect(canvas.classList.contains("is-hovering")).toBe(false);

    fireEvent.pointerOver(node(container, "piece-7"));
    expect(canvas.classList.contains("is-hovering")).toBe(true);
    expect(canvas.getAttribute("data-hovered")).toBe("piece-7");

    // Neighborhood highlight: the hovered sun stays lit, an unrelated planet dims.
    expect(node(container, "piece-7").classList.contains("is-lit")).toBe(true);
  });

  it("opens Score Atlas from the header and detail jump action", async () => {
    const onOpenPractice = vi.fn();
    const { container } = render(
      <UniverseWorkspace onOpenPractice={onOpenPractice} />,
    );
    await screen.findByRole("heading", { name: "Your earned systems" });

    fireEvent.click(
      screen.getAllByRole("button", { name: "Open Score Atlas" })[0],
    );
    expect(onOpenPractice).toHaveBeenCalledWith(null);

    const sun = node(container, "piece-7");
    fireEvent.pointerDown(sun, {
      pointerId: 3,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(sun, { pointerId: 3, clientX: 100, clientY: 100 });
    const panel = await screen.findByRole("complementary", {
      name: "Nocturne Op. 9 No. 2",
    });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Open on score" }),
    );
    expect(onOpenPractice).toHaveBeenCalledWith({
      piece_id: 7,
      title: "Nocturne Op. 9 No. 2",
    });
  });

  it("has an honest empty state that opens Score Atlas", async () => {
    invokeMock.mockResolvedValue({
      ...SNAPSHOT,
      pieces: [],
      totals: {
        focused_seconds: 0,
        active_days_28: 0,
        regions_practiced: 0,
        regions_revisited: 0,
      },
    });
    const onOpenPractice = vi.fn();
    render(<UniverseWorkspace onOpenPractice={onOpenPractice} />);
    expect(
      await screen.findByRole("heading", {
        name: "Your universe is quiet for now.",
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Open Score Atlas" })[1],
    );
    expect(onOpenPractice).toHaveBeenCalledWith(null);
  });

  it("surfaces load failure and retries", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("Database unavailable"))
      .mockResolvedValueOnce(SNAPSHOT);
    const { container } = render(
      <UniverseWorkspace onOpenPractice={vi.fn()} />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Database unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Your earned systems" });
    expect(container.querySelector('[data-node-id="piece-7"]')).toBeTruthy();
  });

  it("formats durations safely", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(12)).toBe("<1m");
    expect(formatDuration(125)).toBe("2m");
    expect(formatDuration(3720)).toBe("1h 2m");
    expect(formatDuration(Number.NaN)).toBe("0m");
  });
});
