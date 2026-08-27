import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegionSignal, UniversePiece, UniverseSnapshot } from "./types";
import { DetailPanel } from "./DetailPanel";
import type { Selection } from "./repertoire";

afterEach(cleanup);

const REGION_OPENING: RegionSignal = {
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
};

// Deliberately omits every optional RegionSignal field to exercise the `?? 0`
// fallbacks and the "not revisited / not recovered" note branch.
const REGION_MINIMAL: RegionSignal = {
  region_id: 2,
  name: "Coda",
  kind: "section",
  focused_seconds: 0,
  active_days_28: 0,
  practiced: false,
  revisited: false,
  quality_brightness: 0.9,
  last_practiced: null,
  practice_events: 0,
  rated_rep_events: 0,
  clean_rep_events: 0,
  distinct_practice_dates: 0,
};

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
  region_signals: [REGION_OPENING, REGION_MINIMAL],
};

// A piece with every optional numeric field omitted, to exercise the `?? 0`
// fallbacks in the piece metrics list and in maturityPercent.
const PIECE_MINIMAL: UniversePiece = {
  piece_id: 8,
  title: "Untitled Etude",
  composer: null,
  focused_seconds: 0,
  active_days_28: 0,
  regions_total: 0,
  regions_practiced: 0,
  regions_revisited: 0,
  quality_brightness: 0,
  last_practiced: null,
  region_signals: [],
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
  pieces: [PIECE, PIECE_MINIMAL],
};

const PIECE_SELECTION: Selection = { kind: "piece", pieceId: 7 };
const BLOCK_SELECTION: Selection = { kind: "block", pieceId: 7, regionId: 1 };

function renderPanel(
  selection: Selection | null,
  overrides: Partial<React.ComponentProps<typeof DetailPanel>> = {},
) {
  const props = {
    selection,
    snapshot: SNAPSHOT,
    reference: SNAPSHOT.generated_at,
    onClose: vi.fn(),
    onSelect: vi.fn(),
    onOpenScore: vi.fn(),
    ...overrides,
  };
  return { ...render(<DetailPanel {...props} />), props };
}

function metricValue(label: string): string | null | undefined {
  return screen.getByText(label).nextSibling?.textContent;
}

describe("DetailPanel", () => {
  describe("no selection", () => {
    it("rests with a prompt instead of unmounting, so the map never reflows", () => {
      renderPanel(null);
      const panel = screen.getByTestId("universe-detail");
      expect(panel.classList.contains("is-resting")).toBe(true);
      expect(
        within(panel).getByText("Choose a piece to read its practice record."),
      ).toBeTruthy();
      // No jump actions are offered when nothing is selected.
      expect(within(panel).queryByRole("button")).toBeNull();
    });

    it("rests rather than throwing when a selection no longer resolves", () => {
      renderPanel({ kind: "piece", pieceId: 999 });
      expect(
        screen.getByTestId("universe-detail").classList.contains("is-resting"),
      ).toBe(true);

      cleanup();
      renderPanel({ kind: "block", pieceId: 7, regionId: 999 });
      expect(
        screen.getByTestId("universe-detail").classList.contains("is-resting"),
      ).toBe(true);
    });
  });

  describe("piece selection", () => {
    it("renders every piece metric the snapshot carries", () => {
      renderPanel(PIECE_SELECTION);
      const panel = screen.getByRole("complementary", {
        name: "Nocturne Op. 9 No. 2",
      });
      expect(within(panel).getByText("Piece")).toBeTruthy();
      expect(within(panel).getByText("Chopin")).toBeTruthy();
      expect(metricValue("Focused time")).toBe("1h 30m");
      expect(metricValue("Active days · 28")).toBe("5");
      expect(metricValue("Targets practiced")).toBe("2 / 3");
      expect(metricValue("Revisited")).toBe("1");
      expect(metricValue("Verified mastery")).toBe("1 / 3");
      expect(metricValue("Honestly recovered")).toBe("1");
      expect(metricValue("Practice sessions")).toBe("8");
      expect(metricValue("Open recovery")).toBe("0");
      expect(metricValue("Last practiced")).toBe("Jul 11, 2026");
    });

    it("falls back to zero for every optional field a piece may omit", () => {
      renderPanel({ kind: "piece", pieceId: 8 });
      expect(metricValue("Verified mastery")).toBe("0 / 0");
      expect(metricValue("Honestly recovered")).toBe("0");
      expect(metricValue("Practice sessions")).toBe("0");
      expect(metricValue("Open recovery")).toBe("0");
      expect(metricValue("Last practiced")).toBe("Not practiced yet");
      // No composer recorded -> no sub-label invented.
      expect(screen.queryByText("Chopin")).toBeNull();
    });

    it("does not surface the opaque earned_maturity composite as a score", () => {
      const snapshot: UniverseSnapshot = {
        ...SNAPSHOT,
        pieces: [{ ...PIECE, earned_maturity: 4.2 }],
      };
      renderPanel(PIECE_SELECTION, { snapshot });
      expect(screen.queryByText("Earned maturity")).toBeNull();
      expect(document.body.textContent).not.toContain("420%");
    });

    it("lists every target as a labelled, clickable row", () => {
      const { props } = renderPanel(PIECE_SELECTION);
      const list = screen.getByRole("region", { name: /^Targets/ });
      expect(within(list).getByText("Targets (2)")).toBeTruthy();

      const opening = within(list).getByRole("button", { name: /Opening/ });
      expect(opening.textContent).toContain("Mastery verified");
      expect(
        within(list).getByRole("button", { name: /Coda/ }).textContent,
      ).toContain("Not practiced");

      fireEvent.click(opening);
      expect(props.onSelect).toHaveBeenCalledWith({
        kind: "block",
        pieceId: 7,
        regionId: 1,
      });
    });

    it("says so honestly when a piece has no targets marked yet", () => {
      renderPanel({ kind: "piece", pieceId: 8 });
      expect(screen.getByText("Targets (0)")).toBeTruthy();
      expect(
        screen.getByText("No targets marked on this piece yet."),
      ).toBeTruthy();
    });

    it("jumps to the score and to History with the piece context", () => {
      const onOpenScore = vi.fn();
      const onOpenLedger = vi.fn();
      renderPanel(PIECE_SELECTION, { onOpenScore, onOpenLedger });

      fireEvent.click(screen.getByRole("button", { name: "Open on score" }));
      expect(onOpenScore).toHaveBeenCalledWith({
        piece_id: 7,
        title: "Nocturne Op. 9 No. 2",
      });

      fireEvent.click(screen.getByRole("button", { name: "Open in History" }));
      expect(onOpenLedger).toHaveBeenCalledWith({
        piece_id: 7,
        title: "Nocturne Op. 9 No. 2",
      });
    });

    it("omits the History action when no handler is supplied", () => {
      renderPanel(PIECE_SELECTION);
      expect(screen.queryByRole("button", { name: "Open in History" })).toBe(
        null,
      );
      expect(
        screen.getByRole("button", { name: "Open on score" }),
      ).toBeTruthy();
    });

    it("closes on request", () => {
      const { props } = renderPanel(PIECE_SELECTION);
      fireEvent.click(
        screen.getByRole("button", { name: "Close detail panel" }),
      );
      expect(props.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("target selection", () => {
    it("renders every target metric the snapshot carries", () => {
      renderPanel(BLOCK_SELECTION);
      const panel = screen.getByRole("complementary", { name: "Opening" });
      expect(within(panel).getByText("Target")).toBeTruthy();
      expect(metricValue("Reps")).toBe("6");
      expect(metricValue("Clean reps")).toBe("5");
      expect(metricValue("Focused time")).toBe("1h 0m");
      expect(metricValue("Active days · 28")).toBe("3");
      expect(metricValue("Distinct dates")).toBe("3");
      expect(metricValue("Verified mastery")).toBe("1");
      expect(metricValue("Recovery resets")).toBe("2");
      expect(metricValue("Practice sessions")).toBe("2");
      expect(metricValue("Last practiced")).toBe("Jul 11, 2026");
    });

    it("notes revisited/recovered state and points streaks at History", () => {
      renderPanel(BLOCK_SELECTION);
      const note = screen.getByText(/Streak and tempo-path detail/);
      expect(note.textContent).toContain("Revisited on distinct dates.");
      expect(note.textContent).toContain("Honestly recovered.");
      // 21 hours before generated_at — elapsed days, not calendar days.
      expect(note.textContent).toContain("Practiced today");
      expect(note.textContent).toContain("History");
    });

    it("omits the revisited/recovered claims a region has not earned", () => {
      renderPanel({ kind: "block", pieceId: 7, regionId: 2 });
      const note = screen.getByText(/Streak and tempo-path detail/);
      expect(note.textContent).not.toContain("Revisited on distinct dates.");
      expect(note.textContent).not.toContain("Honestly recovered.");
      expect(note.textContent).toContain("Never practiced");
      expect(metricValue("Verified mastery")).toBe("0");
      expect(metricValue("Recovery resets")).toBe("0");
      expect(metricValue("Practice sessions")).toBe("0");
    });

    it("offers a labelled way back up to the owning piece", () => {
      const { props } = renderPanel(BLOCK_SELECTION);
      const up = screen.getByRole("button", { name: /Nocturne Op. 9 No. 2/ });
      fireEvent.click(up);
      expect(props.onSelect).toHaveBeenCalledWith({
        kind: "piece",
        pieceId: 7,
      });
    });

    it("still jumps to the score for the owning piece", () => {
      const onOpenScore = vi.fn();
      renderPanel(BLOCK_SELECTION, { onOpenScore });
      fireEvent.click(screen.getByRole("button", { name: "Open on score" }));
      expect(onOpenScore).toHaveBeenCalledWith({
        piece_id: 7,
        title: "Nocturne Op. 9 No. 2",
      });
    });

    it("does not show the piece-level region list while a region is open", () => {
      renderPanel(BLOCK_SELECTION);
      expect(screen.queryByText(/^Regions \(/)).toBeNull();
    });
  });

  describe("malformed snapshot data", () => {
    it("renders a piece whose region_signals array is empty without throwing", () => {
      expect(() => renderPanel({ kind: "piece", pieceId: 8 })).not.toThrow();
    });

    it("survives a snapshot with no pieces at all", () => {
      renderPanel(PIECE_SELECTION, {
        snapshot: { ...SNAPSHOT, pieces: [] },
      });
      expect(
        screen.getByTestId("universe-detail").classList.contains("is-resting"),
      ).toBe(true);
    });
  });
});
