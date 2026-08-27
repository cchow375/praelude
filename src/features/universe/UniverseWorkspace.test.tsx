import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockProvider, useDock } from "../dock/DockProvider";
import { DockPanel } from "../dock/DockPanel";
import { DOCK_STORAGE_KEY } from "../dock/dockState";
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
  recovered_targets: 0,
  open_recovery_debt: 0,
  practice_sessions: 1,
  earned_maturity: 0.1,
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
      practice_sessions: 1,
    },
  ],
};

const UNTOUCHED_PIECE: UniversePiece = {
  piece_id: 3,
  title: "Prelude in C",
  composer: "Bach",
  focused_seconds: 0,
  active_days_28: 0,
  regions_total: 1,
  regions_practiced: 0,
  regions_revisited: 0,
  mastered_targets: 0,
  recovered_targets: 0,
  open_recovery_debt: 0,
  practice_sessions: 0,
  earned_maturity: 0,
  quality_brightness: 0.96,
  last_practiced: null,
  region_signals: [
    {
      region_id: 31,
      name: "Whole piece",
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
    },
  ],
};

const SNAPSHOT: UniverseSnapshot = {
  generated_at: GENERATED_AT,
  definitions: [
    {
      signal: "star_radius",
      label: "Focused time",
      definition: "Practice time after idle time is removed.",
    },
    {
      signal: "quality_brightness",
      label: "Subtle quality brightness",
      definition: "A visual tint, not a score.",
    },
  ],
  traces: {
    source: "canonical practice events",
    practice_event_kinds: ["rep_open", "rep", "verdict", "tempo_change"],
    idle_threshold_seconds: 300,
    active_window_start: "2026-06-15",
    active_window_end: "2026-07-12",
    quality_formula: "bounded smoothing",
    maturity_formula: "opaque composite that must not be surfaced",
  },
  totals: {
    focused_seconds: 5430,
    lifetime_focused_seconds: 7200,
    active_days_28: 5,
    lifetime_active_days: 12,
    best_streak_days: 5,
    regions_practiced: 2,
    regions_revisited: 1,
    revisited_targets: 3,
    mastered_targets: 1,
    recovered_targets: 1,
    practice_sessions: 8,
  },
  technique: {
    focused_seconds: 540,
    active_days_28: 2,
    completed_warmups: 3,
    practice_sessions: 2,
    last_practiced: isoDaysBefore(1),
  },
  pieces: [PIECE, STALE_PIECE],
};

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;

function memoryStorage(): Storage {
  const rows = new Map<string, string>();
  return {
    get length() {
      return rows.size;
    },
    clear: () => rows.clear(),
    getItem: (key) => rows.get(key) ?? null,
    key: (index) => [...rows.keys()][index] ?? null,
    removeItem: (key) => {
      rows.delete(key);
    },
    setItem: (key, value) => {
      rows.set(key, String(value));
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: memoryStorage(),
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalWidth,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: originalHeight,
  });
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) =>
    command === "universe_snapshot"
      ? Promise.resolve(SNAPSHOT)
      : Promise.resolve(null),
  );
});

afterEach(() => {
  cleanup();
});

async function renderProgress(
  props: Partial<{
    onOpenPractice: (piece: unknown) => void;
    onOpenLedger: (piece: unknown) => void;
    streak: { current_days: number } | null;
  }> = {},
) {
  const result = render(
    <UniverseWorkspace
      onOpenPractice={props.onOpenPractice ?? vi.fn()}
      onOpenLedger={props.onOpenLedger as ((piece: never) => void) | undefined}
      streak={props.streak}
    />,
  );
  await screen.findByRole("heading", { name: "Your repertoire" });
  return result;
}

describe("UniverseWorkspace evidence-first progress", () => {
  it("puts momentum, focused time and exact progress before the repertoire", async () => {
    const { container } = await renderProgress({ streak: { current_days: 4 } });

    expect(
      screen.getByRole("heading", { name: "Practice progress" }),
    ).toBeTruthy();
    const momentum = screen.getByTestId("universe-momentum");
    expect(momentum.textContent).toContain("Momentum is holding.");
    expect(momentum.textContent).toContain("4 consecutive qualifying days");
    expect(momentum.textContent).toContain("1h 30m");
    expect(momentum.textContent).toContain("5 active days · 28");
    expect(momentum.textContent).toContain("8 sessions");

    const progress = container.querySelector(".universe-progress")!;
    const repertoire = container.querySelector(".universe-map")!;
    expect(
      momentum.compareDocumentPosition(progress) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      progress.compareDocumentPosition(repertoire) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("puts transparent Practice XP and evidence badges first without announcing old work", async () => {
    const { container } = await renderProgress();
    const game = screen.getByTestId("universe-game-panel");
    expect(within(game).getByRole("heading", { name: "Level 3" })).toBeTruthy();
    expect(within(game).getByTestId("universe-game-xp").textContent).toContain(
      "120 XP",
    );
    expect(game.textContent).toContain("1 XP = 1 completed focused minute");
    expect(game.textContent).toContain("Badge cabinet");
    expect(container.querySelector(".universe-earned-status")).toBeNull();

    const cadence = screen.getByTestId("universe-cadence");
    const momentum = screen.getByTestId("universe-momentum");
    expect(
      game.compareDocumentPosition(cadence) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      cadence.compareDocumentPosition(momentum) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders only the current canonical database and ignores legacy browser-stored progress", async () => {
    window.localStorage.setItem(
      "codakiller.universe.game-evidence.v1",
      JSON.stringify({
        version: 1,
        evidence: {
          lifetimeFocusedSeconds: 9_999_999,
          lifetimeActiveDays: 365,
          bestStreakDays: 100,
          revisitedTargets: 100,
          masteredTargets: 100,
          recoveredTargets: 100,
        },
      }),
    );
    await renderProgress();
    expect(screen.getByTestId("universe-game-xp").textContent).toBe("120 XP");

    invokeMock.mockImplementation((command: string) =>
      command === "universe_snapshot"
        ? Promise.resolve({
            ...SNAPSHOT,
            totals: {
              ...SNAPSHOT.totals,
              focused_seconds: 60,
              lifetime_focused_seconds: 60,
              lifetime_active_days: 1,
              best_streak_days: 1,
              revisited_targets: 0,
              mastered_targets: 0,
              recovered_targets: 0,
            },
          })
        : Promise.resolve(null),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));

    await waitFor(() =>
      expect(screen.getByTestId("universe-game-xp").textContent).toBe("1 XP"),
    );
    expect(screen.queryByText("7 active days")).toBeNull();
    expect(screen.queryByText(/Badge earned:/)).toBeNull();
  });

  it("keeps the newest canonical snapshot when StrictMode loads resolve out of order", async () => {
    let resolveOlder!: (value: UniverseSnapshot) => void;
    let resolveNewer!: (value: UniverseSnapshot) => void;
    let snapshotCalls = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === "universe_snapshot") {
        snapshotCalls += 1;
        return new Promise<UniverseSnapshot>((resolve) => {
          if (snapshotCalls === 1) resolveOlder = resolve;
          else resolveNewer = resolve;
        });
      }
      if (command === "universe_history_days") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(
      <StrictMode>
        <UniverseWorkspace onOpenPractice={vi.fn()} />
      </StrictMode>,
    );
    await waitFor(() => expect(snapshotCalls).toBe(2));
    const withSeconds = (seconds: number): UniverseSnapshot => ({
      ...SNAPSHOT,
      totals: {
        ...SNAPSHOT.totals,
        focused_seconds: seconds,
        lifetime_focused_seconds: seconds,
      },
    });

    resolveNewer(withSeconds(120));
    await waitFor(() =>
      expect(screen.getByTestId("universe-game-xp").textContent).toBe("2 XP"),
    );
    resolveOlder(withSeconds(60));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(screen.getByTestId("universe-game-xp").textContent).toBe("2 XP");
    expect(screen.queryByText(/Practice Level .* reached/)).toBeNull();
    expect(screen.queryByText(/Badge earned:/)).toBeNull();
  });

  it("announces only a real later level and badge crossing", async () => {
    await renderProgress();
    expect(screen.queryByText(/Practice Level .* reached/)).toBeNull();

    invokeMock.mockImplementation((command: string) =>
      command === "universe_snapshot"
        ? Promise.resolve({
            ...SNAPSHOT,
            totals: {
              ...SNAPSHOT.totals,
              lifetime_focused_seconds: 10_800,
              mastered_targets: 5,
            },
            pieces: [{ ...PIECE, mastered_targets: 5 }, STALE_PIECE],
          })
        : Promise.resolve(null),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh progress" }));

    expect(
      (await screen.findByText(/Practice Level 4 reached/)).textContent,
    ).toBe("Practice Level 4 reached · Badge earned: 5 verified masteries.");
    expect(screen.getByTestId("universe-game-xp").textContent).toContain(
      "180 XP",
    );
  });

  it("renders an accessible 28-day cadence from exact trace bounds and fills quiet dates", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "universe_snapshot") return Promise.resolve(SNAPSHOT);
      if (command === "history_days") {
        expect(args).toEqual({ from: "2026-06-15", to: "2026-07-12" });
        return Promise.resolve([
          {
            date: "2026-06-15",
            focused_seconds: 60,
            session_count: 1,
            attempts: 0,
            cleans: 0,
            sets_touched: 0,
            mastered_sets: 0,
            pieces: [],
          },
          {
            date: "2026-07-01",
            focused_seconds: 1_800,
            session_count: 1,
            attempts: 0,
            cleans: 0,
            sets_touched: 0,
            mastered_sets: 0,
            pieces: [],
          },
          {
            date: "2026-07-12",
            focused_seconds: 3_600,
            session_count: 1,
            attempts: 0,
            cleans: 0,
            sets_touched: 0,
            mastered_sets: 0,
            pieces: [],
          },
        ]);
      }
      return Promise.resolve(null);
    });
    await renderProgress();
    const days = await screen.findByRole("list", {
      name: "28-day focused-practice cadence",
    });

    expect(within(days).getAllByRole("listitem")).toHaveLength(28);
    expect(
      within(days).getByLabelText("Jun 15: 1 focused minute"),
    ).toBeTruthy();
    expect(
      within(days).getByLabelText("Jun 16: no focused practice recorded"),
    ).toBeTruthy();
    expect(
      within(days).getByLabelText("Jul 12: 60 focused minutes"),
    ).toBeTruthy();
    expect(screen.getByTestId("universe-cadence").textContent).toContain(
      "3 days with focused work · 1h 31m",
    );
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "history_days"),
    ).toHaveLength(1);
  });

  it("keeps Universe usable when the optional cadence command is unavailable", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "universe_snapshot"
        ? Promise.resolve(SNAPSHOT)
        : Promise.reject(new Error("unknown command history_days")),
    );
    await renderProgress();
    expect(
      await screen.findByText(
        "Daily cadence is unavailable; no days have been guessed.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("universe-game-panel")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders every primary rail as an exact snapshot-backed ratio", async () => {
    const { container } = await renderProgress();
    const tracks = [
      ...container.querySelectorAll(
        ".universe-progress-card [role='progressbar']",
      ),
    ];
    expect(tracks.map((track) => track.getAttribute("aria-valuetext"))).toEqual(
      ["5 of 28", "3 of 4", "1 of 3", "1 of 4"],
    );
    expect(
      [...container.querySelectorAll(".universe-progress-card")].map((card) =>
        card.getAttribute("data-evidence"),
      ),
    ).toEqual([
      "totals.active_days_28",
      "active_pieces.regions_practiced",
      "active_pieces.regions_revisited",
      "active_pieces.mastered_targets",
    ]);
    expect(screen.getByTestId("universe-recovery-line").textContent).toContain(
      "1 honestly recovered",
    );
    expect(document.body.textContent).not.toContain("Earned maturity");
    expect(document.body.textContent).not.toContain("64%");
  });

  it("shows technique as a separate hidden-system aggregate", async () => {
    await renderProgress();
    const technique = screen.getByTestId("universe-technique");
    expect(technique.textContent).toContain("3 warmups completed");
    expect(technique.textContent).toContain("9m");
    expect(technique.textContent).toContain("Active days · 28");
    expect(technique.textContent).toContain("2");
    expect(
      screen.queryByText("Warm-ups", { selector: ".universe-card-title" }),
    ).toBeNull();
  });

  it("teaches from a technique-only record without inventing repertoire", async () => {
    invokeMock.mockResolvedValue({
      ...SNAPSHOT,
      pieces: [],
      totals: {
        focused_seconds: 540,
        active_days_28: 2,
        regions_practiced: 0,
        regions_revisited: 0,
        mastered_targets: 0,
        recovered_targets: 0,
        practice_sessions: 2,
      },
    });
    render(<UniverseWorkspace onOpenPractice={vi.fn()} />);

    expect(await screen.findByTestId("universe-technique")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Your practice record is quiet." }),
    ).toBeNull();
    expect(
      screen.getByText(/No repertoire pieces are on this shelf yet/),
    ).toBeTruthy();
    expect(screen.queryByTestId("universe-piece-9999")).toBeNull();
  });

  it("shows truthful optional landmarks, not due dates or a generated plan", async () => {
    await renderProgress();
    const landmarks = screen.getByTestId("universe-landmarks");
    expect(landmarks.textContent).toContain("Milestones, not assignments.");
    expect(landmarks.textContent).toContain("7-day consistency mark");
    expect(landmarks.textContent).toContain(
      "2 more active days would reach 7 of this 28-day window.",
    );
    expect(landmarks.textContent).toContain("Proof still open");
    expect(landmarks.textContent).toContain(
      "Nocturne Op. 9 No. 2 · Coda has practice evidence",
    );
    expect(landmarks.textContent).toContain("Target still untouched");
    expect(landmarks.textContent).not.toMatch(/due|overdue|assigned/i);
  });

  it("puts open recovery first and styles only that real debt as open", async () => {
    invokeMock.mockResolvedValue({
      ...SNAPSHOT,
      pieces: [
        {
          ...PIECE,
          open_recovery_debt: 2,
          region_signals: PIECE.region_signals.map((region, index) => ({
            ...region,
            open_recovery_debt: index === 0 ? 2 : 0,
          })),
        },
        STALE_PIECE,
      ],
    });
    await renderProgress();
    const list = screen.getByTestId("universe-landmarks").querySelector("ol")!;
    expect(list.firstElementChild?.textContent).toContain("Recovery to clear");
    expect(list.firstElementChild?.textContent).toContain("2 targets");
    const recoveryLine = screen.getByTestId("universe-recovery-line");
    expect(
      recoveryLine.querySelector('[data-state="open"]')?.textContent,
    ).toContain("2 open recovery");
  });

  it("shows recent target touches with current state without claiming when it changed", async () => {
    await renderProgress();
    const recent = screen.getByTestId("universe-recent");
    const rows = within(recent).getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Nocturne Op. 9 No. 2 · Opening");
    expect(rows[0].textContent).toContain("Honestly recovered");
    expect(rows[0].textContent).toContain("Practiced yesterday");
    expect(rows[1].textContent).toContain("1 clean of 2 rated reps");
    expect(recent.textContent).toContain("not a guessed change log");
  });

  it("opens exact target detail from recent evidence and a target landmark", async () => {
    await renderProgress();
    fireEvent.click(
      within(screen.getByTestId("universe-recent")).getByRole("button", {
        name: /Opening/,
      }),
    );
    expect(
      await screen.findByRole("complementary", { name: "Opening" }),
    ).toBeTruthy();

    fireEvent.click(
      within(screen.getByTestId("universe-landmarks")).getByRole("button", {
        name: /Proof still open/,
      }),
    );
    expect(
      await screen.findByRole("complementary", { name: "Coda" }),
    ).toBeTruthy();
  });

  it("keeps an untouched shelf visibly empty without granting progress", async () => {
    invokeMock.mockResolvedValue({
      ...SNAPSHOT,
      pieces: [UNTOUCHED_PIECE],
      totals: {
        focused_seconds: 0,
        active_days_28: 0,
        regions_practiced: 0,
        regions_revisited: 0,
        mastered_targets: 0,
        recovered_targets: 0,
        practice_sessions: 0,
      },
    });
    const { container } = await renderProgress({ streak: { current_days: 0 } });
    expect(screen.getByTestId("universe-momentum").textContent).toContain(
      "Ready for the first mark.",
    );
    expect(screen.getByTestId("universe-momentum").textContent).toContain(
      "No current streak",
    );
    expect(screen.getByTestId("universe-momentum").textContent).not.toContain(
      "0-day current streak",
    );
    expect(
      screen
        .getByRole("progressbar", { name: "Targets practiced" })
        .getAttribute("aria-valuetext"),
    ).toBe("0 of 1");
    expect(
      screen
        .getByTestId("universe-piece-3")
        .querySelectorAll('.universe-block[data-state="untouched"]'),
    ).toHaveLength(1);
    expect(container.querySelector(".universe-galaxy")).toBeNull();
  });

  it("lays the repertoire out as a stable composer index with one target mark each", async () => {
    const { container } = await renderProgress();
    expect(
      [...container.querySelectorAll(".universe-group-name")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["Chopin", "Griffes"]);

    const card = screen.getByTestId("universe-piece-7");
    expect(card.textContent).toContain("Nocturne Op. 9 No. 2");
    expect(card.textContent).toContain("2 / 3 targets practiced");
    expect(card.textContent).toContain("1 verified");
    expect(card.textContent).toContain("1h 30m focused");
    expect(card.textContent).toContain("5 active days");
    expect(card.textContent).toContain("8 sessions");
    expect(
      [...card.querySelectorAll(".universe-block")].map((node) =>
        node.getAttribute("data-state"),
      ),
    ).toEqual(["mastered", "practiced", "untouched"]);
  });

  it("keeps archived repertoire dimmed as history and out of active suggestions", async () => {
    const archived = {
      ...STALE_PIECE,
      archived_at: 1_787_000_000,
      open_recovery_debt: 4,
    };
    invokeMock.mockResolvedValue({
      ...SNAPSHOT,
      pieces: [PIECE, archived],
    });
    const onOpenPractice = vi.fn();
    const onOpenLedger = vi.fn();
    await renderProgress({ onOpenPractice, onOpenLedger });

    const card = screen.getByTestId(`universe-piece-${archived.piece_id}`);
    expect(card.getAttribute("data-archived")).toBe("true");
    expect(card.textContent).toContain("Archived");
    expect(screen.getByText(/1 active piece · 1 archived/)).toBeTruthy();
    expect(
      screen
        .getByRole("progressbar", { name: "Targets practiced" })
        .getAttribute("aria-valuetext"),
    ).toBe("2 of 3");
    expect(
      screen
        .getByRole("progressbar", { name: "Targets revisited" })
        .getAttribute("aria-valuetext"),
    ).toBe("1 of 2");
    expect(screen.getByTestId("universe-landmarks").textContent).not.toContain(
      archived.title,
    );

    fireEvent.click(card);
    const detail = await screen.findByRole("complementary", {
      name: archived.title,
    });
    expect(detail.textContent).toContain("Archived repertoire stays here");
    expect(
      within(detail).queryByRole("button", { name: "Open on score" }),
    ).toBeNull();
    fireEvent.click(
      within(detail).getByRole("button", { name: /Open in History/ }),
    );
    expect(onOpenLedger).toHaveBeenCalledWith({
      piece_id: archived.piece_id,
      title: archived.title,
    });
    expect(onOpenPractice).not.toHaveBeenCalled();
  });

  it("does not use a simulation, SVG galaxy or ambient animation", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { container } = await renderProgress();
    expect(raf).not.toHaveBeenCalled();
    expect(container.querySelector(".universe-galaxy")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    const css = readFileSync(
      resolve("src/features/universe/universe.css"),
      "utf8",
    );
    expect(css).not.toContain("@keyframes");
    expect(css).not.toContain(".universe-star");
    expect(css).not.toContain("position: fixed");
    raf.mockRestore();
  });

  it("keeps the 720×520 progress hierarchy dense and in normal flow", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 720,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 520,
    });
    window.dispatchEvent(new Event("resize"));
    const { container } = await renderProgress();
    const css = readFileSync(
      resolve("src/features/universe/universe.css"),
      "utf8",
    );
    const dense = css.slice(css.indexOf("@media (max-height: 560px)"));
    expect(dense).toContain(".universe-momentum");
    expect(dense).toContain(".universe-progress-card");
    expect(container.querySelector(".universe-momentum")).toBeTruthy();
    expect(container.querySelector(".universe-progress-grid")).toBeTruthy();
    expect(container.querySelector(".universe-insights")).toBeTruthy();
  });

  it("tucks an already-open Rep Counter for an unobstructed overview and restores it on exit", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 720,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 520,
    });
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        rep: {
          x: 160,
          y: 108,
          minimized: false,
          open: true,
          z: 1,
          flashing: false,
        },
      }),
    );

    function Probe() {
      const rep = useDock("rep");
      return (
        <output data-testid="rep-dock-state">
          {rep.isOpen ? "open" : "closed"}:
          {rep.isMinimized ? "minimized" : "shown"}
        </output>
      );
    }
    function Harness() {
      const [showUniverse, setShowUniverse] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShowUniverse(false)}>
            Leave progress
          </button>
          {showUniverse ? (
            <UniverseWorkspace onOpenPractice={vi.fn()} />
          ) : (
            <p>Another workspace</p>
          )}
          <Probe />
        </>
      );
    }

    render(
      <DockProvider>
        <Harness />
      </DockProvider>,
    );
    expect(
      await screen.findByText(/Rep Counter is tucked into Tools/),
    ).toBeTruthy();
    expect(screen.getByTestId("rep-dock-state").textContent).toBe(
      "open:minimized",
    );

    fireEvent.click(screen.getByRole("button", { name: "Leave progress" }));
    await waitFor(() =>
      expect(screen.getByTestId("rep-dock-state").textContent).toBe(
        "open:shown",
      ),
    );
  });

  it("still tucks the Rep Counter when its dock registration lands after Universe mounts", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 720,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 520,
    });
    window.localStorage.removeItem(DOCK_STORAGE_KEY);

    function Probe() {
      const rep = useDock("rep");
      return (
        <output data-testid="late-rep-dock-state">
          {rep.isOpen ? "open" : "closed"}:
          {rep.isMinimized ? "minimized" : "shown"}
        </output>
      );
    }
    function LateOpen() {
      const rep = useDock("rep");
      useEffect(() => {
        rep.open();
        // Mirror RepPanel opening after its DockPanel registration effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    }

    render(
      <StrictMode>
        <DockProvider>
          <UniverseWorkspace onOpenPractice={vi.fn()} />
          <DockPanel
            id="rep"
            title="Rep Counter"
            defaultPosition={{ x: 160, y: 108 }}
          >
            Active set
          </DockPanel>
          <LateOpen />
          <Probe />
        </DockProvider>
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("late-rep-dock-state").textContent).toBe(
        "open:minimized",
      ),
    );
    expect(
      await screen.findByText(/Rep Counter is tucked into Tools/),
    ).toBeTruthy();
  });

  it("selects a piece, drills into a target, and returns without losing the index", async () => {
    await renderProgress();
    const card = screen.getByTestId("universe-piece-7");
    expect(card.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(card);
    const panel = await screen.findByRole("complementary", {
      name: "Nocturne Op. 9 No. 2",
    });
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(within(panel).getByText("Targets (3)")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: /Opening/ }));
    const target = await screen.findByRole("complementary", {
      name: "Opening",
    });
    expect(within(target).getByText("Target")).toBeTruthy();
    expect(within(target).getByText("Reps").nextSibling?.textContent).toBe("6");
    fireEvent.click(
      within(target).getByRole("button", { name: /← Nocturne Op. 9 No. 2/ }),
    );
    expect(
      await screen.findByRole("complementary", {
        name: "Nocturne Op. 9 No. 2",
      }),
    ).toBeTruthy();
  });

  it("keeps every piece reachable and activatable from the keyboard", async () => {
    await renderProgress();
    const card = screen.getByTestId("universe-piece-7");
    expect(card.tagName).toBe("BUTTON");
    card.focus();
    expect(document.activeElement).toBe(card);
    fireEvent.click(card);
    expect(document.activeElement).toBe(card);
    expect(
      await screen.findByRole("complementary", {
        name: "Nocturne Op. 9 No. 2",
      }),
    ).toBeTruthy();
  });

  it("closes selected detail back to its resting state", async () => {
    await renderProgress();
    fireEvent.click(screen.getByTestId("universe-piece-7"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Close detail panel" }),
    );
    expect(screen.getByTestId("universe-detail").classList).toContain(
      "is-resting",
    );
    expect(
      screen.getByTestId("universe-piece-7").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("opens the score map from the header and exact piece detail", async () => {
    const onOpenPractice = vi.fn();
    await renderProgress({ onOpenPractice });
    fireEvent.click(screen.getByRole("button", { name: "Open score map" }));
    expect(onOpenPractice).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByTestId("universe-piece-7"));
    const panel = await screen.findByRole("complementary", {
      name: "Nocturne Op. 9 No. 2",
    });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Open on score" }),
    );
    expect(onOpenPractice).toHaveBeenLastCalledWith({
      piece_id: 7,
      title: "Nocturne Op. 9 No. 2",
    });
  });

  it("discloses canonical definitions but omits retired visual formulas", async () => {
    await renderProgress();
    fireEvent.click(screen.getByText("How these numbers are earned"));
    expect(
      screen.getByText("Practice time after idle time is removed."),
    ).toBeTruthy();
    expect(screen.queryByText("Subtle quality brightness")).toBeNull();
    expect(document.body.textContent).not.toContain("opaque composite");
    expect(screen.getByText(/canonical practice events/).textContent).toContain(
      "300 seconds",
    );
  });

  it("has an honest empty state that opens the score map", async () => {
    invokeMock.mockResolvedValue({
      ...SNAPSHOT,
      pieces: [],
      technique: {
        focused_seconds: 0,
        active_days_28: 0,
        completed_warmups: 0,
        practice_sessions: 0,
        last_practiced: null,
      },
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
        name: "Your practice record is quiet.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/appear only after they are actually recorded/),
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
