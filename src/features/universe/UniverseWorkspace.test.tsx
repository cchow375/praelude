import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { galaxyLayout } from "./galaxy";
import type { UniversePiece, UniverseSnapshot } from "./types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { UniverseWorkspace, formatDuration } from "./UniverseWorkspace";

const GENERATED_AT = "2026-07-12T17:00:00Z";

function isoDaysBefore(days: number): string {
  return new Date(Date.parse(GENERATED_AT) - days * 86_400_000).toISOString();
}

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
  last_practiced: isoDaysBefore(1),
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
      last_practiced: isoDaysBefore(1),
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
      last_practiced: isoDaysBefore(2),
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

/** Cold: untouched for well past the stale threshold. */
const STALE_PIECE: UniversePiece = {
  piece_id: 9,
  title: "The White Peacock",
  composer: "Griffes",
  focused_seconds: 600,
  active_days_28: 0,
  regions_total: 1,
  regions_practiced: 1,
  regions_revisited: 0,
  mastered_targets: 0,
  practice_sessions: 1,
  quality_brightness: 0.5,
  last_practiced: isoDaysBefore(40),
  region_signals: [
    {
      region_id: 21,
      name: "Whole piece",
      kind: "section",
      focused_seconds: 600,
      active_days_28: 0,
      practiced: true,
      revisited: false,
      quality_brightness: 0.5,
      last_practiced: isoDaysBefore(40),
      practice_events: 2,
      rated_rep_events: 1,
      clean_rep_events: 0,
      distinct_practice_dates: 1,
    },
  ],
};

const SNAPSHOT: UniverseSnapshot = {
  generated_at: GENERATED_AT,
  definitions: [
    {
      signal: "focused_time",
      label: "Focused time",
      definition: "Practice time after idle time is removed.",
    },
  ],
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
  pieces: [PIECE, STALE_PIECE],
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

async function renderMap(
  props: Partial<{
    onOpenPractice: (piece: unknown) => void;
    onOpenLedger: (piece: unknown) => void;
  }> = {},
) {
  const result = render(
    <UniverseWorkspace
      onOpenPractice={props.onOpenPractice ?? vi.fn()}
      onOpenLedger={props.onOpenLedger as ((piece: never) => void) | undefined}
    />,
  );
  await screen.findByRole("heading", { name: "Your repertoire" });
  return result;
}

describe("UniverseWorkspace repertoire map", () => {
  it("lays the repertoire out as a still index grouped by composer", async () => {
    const { container } = await renderMap();

    // Composer headings, alphabetical and deterministic.
    const groups = [...container.querySelectorAll(".universe-group-name")].map(
      (node) => node.textContent,
    );
    expect(groups).toEqual(["Chopin", "Griffes"]);

    const card = screen.getByTestId("universe-piece-7");
    expect(card.textContent).toContain("Nocturne Op. 9 No. 2");
    expect(card.textContent).toContain("2 / 3 regions practiced");
    expect(card.textContent).toContain("1 verified");
    expect(card.textContent).toContain("1h 30m focused");
    expect(card.textContent).toContain("8 sessions");
    expect(card.textContent).toContain("Practiced yesterday");
  });

  // (a) The v5 lesson still holds: declarative motion only, never a loop.
  it("runs no simulation and no animation frame loop", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { container } = await renderMap();
    expect(raf).not.toHaveBeenCalled();
    // The galaxy IS an <svg> now — but a static one, drawn once from a layout.
    expect(container.querySelector(".universe-canvas")).toBeNull();
    expect(container.querySelectorAll("svg.universe-galaxy")).toHaveLength(1);
    raf.mockRestore();
  });

  // (b) Property: identical event history => identical galaxy.
  it("lays the galaxy out deterministically for the same snapshot", () => {
    const viewport = { width: 720, height: 520 };
    const once = galaxyLayout(SNAPSHOT, viewport, { current_days: 2 });
    const twice = galaxyLayout(SNAPSHOT, viewport, { current_days: 2 });
    expect(once).toEqual(twice);
  });

  // (c) Earned-only: every rendered visual traces back to a snapshot field.
  it("renders no visual that is not backed by snapshot evidence", async () => {
    const { container } = await renderMap();
    const galaxy = container.querySelector(".universe-galaxy") as SVGElement;

    const pieceIds = new Set(SNAPSHOT.pieces.map((p) => String(p.piece_id)));
    const masteredRegionIds = new Set(
      SNAPSHOT.pieces.flatMap((p) =>
        p.region_signals
          .filter((r) => (r.mastery_contracts_completed ?? 0) > 0)
          .map((r) => String(r.region_id)),
      ),
    );

    const stars = [...galaxy.querySelectorAll(".universe-star")];
    expect(stars).toHaveLength(SNAPSHOT.pieces.length);
    for (const star of stars) {
      expect(pieceIds.has(star.getAttribute("data-piece-id") ?? "")).toBe(true);
    }

    const bodies = [...galaxy.querySelectorAll(".universe-orbit-body")];
    expect(bodies.length).toBe(masteredRegionIds.size);
    for (const body of bodies) {
      expect(
        masteredRegionIds.has(body.getAttribute("data-region-id") ?? ""),
      ).toBe(true);
      expect(body.getAttribute("data-evidence")).toBe(
        "mastery_contracts_completed",
      );
    }

    // A ring only exists where earned_maturity does.
    const ringed = [...galaxy.querySelectorAll(".universe-star-ring")].map(
      (node) => node.closest(".universe-star")!.getAttribute("data-piece-id"),
    );
    const withMaturity = SNAPSHOT.pieces
      .filter((p) => (p.earned_maturity ?? 0) > 0)
      .map((p) => String(p.piece_id));
    expect(ringed.sort()).toEqual(withMaturity.sort());

    // No streak was supplied, so nothing may glow.
    expect(galaxy.querySelectorAll(".universe-star-glow")).toHaveLength(0);
  });

  it("glows every star only when a live streak is passed in", async () => {
    const { container } = render(
      <UniverseWorkspace
        onOpenPractice={vi.fn()}
        streak={{ current_days: 4 }}
      />,
    );
    await screen.findByRole("heading", { name: "Your repertoire" });
    expect(container.querySelectorAll(".universe-star-glow")).toHaveLength(
      SNAPSHOT.pieces.length,
    );
  });

  it("draws nothing at all when there is no practice evidence", async () => {
    invokeMock.mockResolvedValue({ ...SNAPSHOT, pieces: [] });
    const { container } = render(
      <UniverseWorkspace
        onOpenPractice={vi.fn()}
        streak={{ current_days: 9 }}
      />,
    );
    await screen.findByRole("heading", {
      name: "Your universe is quiet for now.",
    });
    expect(container.querySelector(".universe-galaxy")).toBeNull();
  });

  // (d) Reduced motion collapses the galaxy to a fully static render, CSS-only.
  it("wraps every keyframe animation in a prefers-reduced-motion escape", () => {
    // NOTE: the plan's original snippet used
    // `fileURLToPath(new URL("./universe.css", import.meta.url))`, which
    // throws "The URL must be of scheme file" under this project's vitest/vite
    // transform (import.meta.url does not resolve to a file: URL here).
    // Fixed to the same `resolve("src/...")` pattern every sibling CSS-reading
    // test in this repo already uses (e.g. shellOverlap.test.tsx,
    // RepHudDensity.test.tsx, dockStacking.test.ts).
    const css = readFileSync(
      resolve("src/features/universe/universe.css"),
      "utf8",
    );
    const animated = [
      ".universe-star-disc",
      ".universe-orbit-body",
      ".universe-galaxy-field",
    ];
    for (const selector of animated) {
      expect(css).toContain(selector);
    }
    expect(css).toMatch(/@keyframes universe-twinkle/);
    expect(css).toMatch(/@keyframes universe-orbit/);
    expect(css).toMatch(/@keyframes universe-parallax/);

    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).not.toBe("");
    expect(reduced).toContain("animation: none !important");
    // And no JS ever reads the media query — the app has zero matchMedia calls.
    expect(css).not.toContain("matchMedia");
  });

  it("selects a piece by clicking its star, same as clicking its card", async () => {
    await renderMap();
    fireEvent.click(
      screen
        .getByTestId("universe-galaxy")
        .querySelector(
          '.universe-star[data-piece-id="7"] .universe-star-hit',
        ) as Element,
    );
    expect(
      await screen.findByRole("complementary", {
        name: "Nocturne Op. 9 No. 2",
      }),
    ).toBeTruthy();
  });

  it("draws one mark per region, in snapshot order, with its earned state", async () => {
    await renderMap();
    const marks = [
      ...screen
        .getByTestId("universe-piece-7")
        .querySelectorAll(".universe-block"),
    ].map((node) => node.getAttribute("data-state"));
    // Opening = mastery verified, Coda = practiced, Middle = untouched.
    expect(marks).toEqual(["mastered", "practiced", "untouched"]);
  });

  it("places a piece in the same spot however the snapshot is ordered", async () => {
    const order = async () => {
      const { container } = await renderMap();
      const ids = [...container.querySelectorAll("[data-piece-id]")].map(
        (node) => node.getAttribute("data-piece-id"),
      );
      cleanup();
      return ids;
    };
    const forward = await order();
    invokeMock.mockResolvedValue({
      ...SNAPSHOT,
      pieces: [STALE_PIECE, PIECE],
    });
    expect(await order()).toEqual(forward);
  });

  it("names what wants work, most pressing first, without inventing a due date", async () => {
    await renderMap();
    const band = screen.getByTestId("universe-wants-work");
    const chips = within(band).getAllByRole("button");
    // A piece practised yesterday is not nagged about; only the cold one is.
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain("The White Peacock");
    expect(chips[0].textContent).toContain("Rested 40 days");
  });

  it("marks recovery debt ahead of staleness", async () => {
    invokeMock.mockResolvedValue({
      ...SNAPSHOT,
      pieces: [{ ...PIECE, open_recovery_debt: 2 }, STALE_PIECE],
    });
    await renderMap();
    const band = screen.getByTestId("universe-wants-work");
    const chips = within(band).getAllByRole("button");
    expect(chips.map((chip) => chip.getAttribute("data-attention"))).toEqual([
      "recovering",
      "stale",
    ]);
    expect(chips[0].textContent).toContain("2 regions in recovery");
  });

  it("caps the wants-work band and summarises the rest instead of listing 22 names", async () => {
    invokeMock.mockResolvedValue({
      ...SNAPSHOT,
      pieces: Array.from({ length: 10 }, (_, index) => ({
        ...STALE_PIECE,
        piece_id: 200 + index,
        title: `Cold piece ${index}`,
        last_practiced: isoDaysBefore(20 + index),
      })),
    });
    await renderMap();
    const band = screen.getByTestId("universe-wants-work");
    expect(within(band).getAllByRole("button")).toHaveLength(6);
    expect(band.textContent).toContain("and 4 more, marked in the index below");
    // Nothing is actually hidden: all ten still carry their own card + mark.
    expect(document.querySelectorAll(".universe-card")).toHaveLength(10);
    expect(
      document.querySelectorAll('.universe-card[data-attention="stale"]'),
    ).toHaveLength(10);
  });

  it("selects a piece from its card and opens the record beside it", async () => {
    await renderMap();
    const card = screen.getByTestId("universe-piece-7");
    expect(card.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(card);
    expect(
      screen.getByTestId("universe-piece-7").getAttribute("aria-pressed"),
    ).toBe("true");

    const panel = await screen.findByRole("complementary", {
      name: "Nocturne Op. 9 No. 2",
    });
    expect(within(panel).getByText("Piece")).toBeTruthy();
    expect(within(panel).getByText("Regions (3)")).toBeTruthy();
  });

  it("selects a piece from the wants-work band", async () => {
    await renderMap();
    const band = screen.getByTestId("universe-wants-work");
    fireEvent.click(
      within(band).getByRole("button", { name: /The White Peacock/ }),
    );
    expect(
      await screen.findByRole("complementary", { name: "The White Peacock" }),
    ).toBeTruthy();
  });

  it("drills from a piece into one region and back again", async () => {
    await renderMap();
    fireEvent.click(screen.getByTestId("universe-piece-7"));

    const panel = await screen.findByRole("complementary", {
      name: "Nocturne Op. 9 No. 2",
    });
    fireEvent.click(within(panel).getByRole("button", { name: /Opening/ }));

    const regionPanel = await screen.findByRole("complementary", {
      name: "Opening",
    });
    // reps = rated_rep_events (6), clean reps = clean_rep_events (5)
    expect(within(regionPanel).getByText("Reps").nextSibling?.textContent).toBe(
      "6",
    );

    fireEvent.click(
      within(regionPanel).getByRole("button", {
        name: /← Nocturne Op. 9 No. 2/,
      }),
    );
    expect(
      await screen.findByRole("complementary", {
        name: "Nocturne Op. 9 No. 2",
      }),
    ).toBeTruthy();
  });

  it("keeps every card reachable and activatable from the keyboard", async () => {
    await renderMap();
    const card = screen.getByTestId("universe-piece-7");
    // A real <button>, so Tab reaches it and Enter/Space activate it natively —
    // no tabIndex on a non-interactive node, and no focus-scroll workaround.
    expect(card.tagName).toBe("BUTTON");
    expect(card.getAttribute("tabindex")).toBeNull();

    card.focus();
    expect(document.activeElement).toBe(card);
    fireEvent.click(card);
    // Selecting must not move focus away from the card the user pressed.
    expect(document.activeElement).toBe(screen.getByTestId("universe-piece-7"));
    expect(
      await screen.findByRole("complementary", {
        name: "Nocturne Op. 9 No. 2",
      }),
    ).toBeTruthy();
  });

  it("closes the record back to its resting prompt", async () => {
    await renderMap();
    fireEvent.click(screen.getByTestId("universe-piece-7"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Close detail panel" }),
    );
    expect(
      screen.getByTestId("universe-detail").classList.contains("is-resting"),
    ).toBe(true);
    expect(
      screen.getByTestId("universe-piece-7").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("shows the totals band", async () => {
    const { container } = await renderMap();
    const totals = container.querySelector(".universe-totals") as HTMLElement;
    expect(totals.textContent).toContain("1h 30m");
    expect(within(totals).getByText("Mastery verified")).toBeTruthy();
    expect(within(totals).getByText("Practice sessions")).toBeTruthy();
  });

  it("discloses how the numbers are earned", async () => {
    await renderMap();
    fireEvent.click(screen.getByText("How these numbers are earned"));
    expect(
      screen.getByText("Practice time after idle time is removed."),
    ).toBeTruthy();
    expect(screen.getByText(/canonical practice events/).textContent).toContain(
      "300 seconds",
    );
  });

  it("opens Score Atlas from the header and from the record", async () => {
    const onOpenPractice = vi.fn();
    await renderMap({ onOpenPractice });

    fireEvent.click(
      screen.getAllByRole("button", { name: "Open score map" })[0],
    );
    expect(onOpenPractice).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByTestId("universe-piece-7"));
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
      screen.getAllByRole("button", { name: "Open score map" })[1],
    );
    expect(onOpenPractice).toHaveBeenCalledWith(null);
  });

  it("announces loading without an animated placeholder", async () => {
    render(<UniverseWorkspace onOpenPractice={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Reading your practice record");
    expect(status.querySelector("i")).toBeNull();
    await screen.findByRole("heading", { name: "Your repertoire" });
  });

  it("surfaces load failure and retries", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("Database unavailable"))
      .mockResolvedValueOnce(SNAPSHOT);
    render(<UniverseWorkspace onOpenPractice={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Database unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Your repertoire" });
    expect(screen.getByTestId("universe-piece-7")).toBeTruthy();
  });

  it("formats durations safely", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(12)).toBe("<1m");
    expect(formatDuration(125)).toBe("2m");
    expect(formatDuration(3720)).toBe("1h 2m");
    expect(formatDuration(Number.NaN)).toBe("0m");
  });
});
