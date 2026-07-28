import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegionSignal, UniversePiece, UniverseSnapshot } from "../types";
import { DetailPanel } from "./DetailPanel";
import type { GraphNode } from "./simulation";

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
// fallbacks in the "sun" metrics list and in maturityPercent.
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

function sunNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "piece-7",
    kind: "sun",
    radius: 22,
    label: "Nocturne Op. 9 No. 2",
    refId: 7,
    pieceRefId: 7,
    paletteIndex: 0,
    depth: 0,
    ...overrides,
  };
}

function planetNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "region-1",
    kind: "planet",
    parentId: "piece-7",
    radius: 12,
    label: "Opening",
    refId: 1,
    pieceRefId: 7,
    regionRefId: 1,
    paletteIndex: 0,
    depth: 1,
    ...overrides,
  };
}

function satelliteNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "session-1-0",
    kind: "satellite",
    parentId: "region-1",
    radius: 3,
    label: "Session 1",
    pieceRefId: 7,
    regionRefId: 1,
    paletteIndex: 0,
    depth: 2,
    ...overrides,
  };
}

function clusterNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "cluster-1",
    kind: "cluster",
    parentId: "region-1",
    radius: 9,
    label: "+5",
    aggregated: 5,
    pieceRefId: 7,
    regionRefId: 1,
    paletteIndex: 0,
    depth: 2,
    ...overrides,
  };
}

function metricValue(label: string): string | null | undefined {
  return screen.getByText(label).nextSibling?.textContent;
}

describe("DetailPanel", () => {
  describe("sun node (piece)", () => {
    it("renders piece metrics, composer sub-label, and jump actions", () => {
      render(
        <DetailPanel
          node={sunNode()}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );

      const panel = screen.getByRole("complementary", {
        name: "Nocturne Op. 9 No. 2",
      });
      expect(within(panel).getByText("Piece")).toBeTruthy();
      expect(within(panel).getByText("Chopin")).toBeTruthy();
      expect(panel.getAttribute("data-node-kind")).toBe("sun");

      expect(metricValue("Focused time")).toBe("1h 30m");
      expect(metricValue("Active days · 28")).toBe("5");
      expect(metricValue("Targets practiced")).toBe("2 / 3");
      expect(metricValue("Revisited")).toBe("1");
      expect(metricValue("Verified mastery")).toBe("1 / 3");
      expect(metricValue("Honestly recovered")).toBe("1");
      expect(metricValue("Practice sessions")).toBe("8");
      expect(metricValue("Earned maturity")).toBe("64%");
      // Timezone-dependent formatting: just assert it is not the "no data" copy.
      expect(metricValue("Last practiced")).not.toBe("Not practiced yet");

      expect(
        within(panel).getByRole("button", { name: "Open on score" }),
      ).toBeTruthy();
    });

    it("clamps maturity and falls back optional counters to 0 when the piece omits them", () => {
      render(
        <DetailPanel
          node={sunNode({
            id: "piece-8",
            label: "Untitled Etude",
            pieceRefId: 8,
          })}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );

      expect(metricValue("Verified mastery")).toBe("0 / 0");
      expect(metricValue("Honestly recovered")).toBe("0");
      expect(metricValue("Practice sessions")).toBe("0");
      expect(metricValue("Earned maturity")).toBe("0%");
      expect(metricValue("Last practiced")).toBe("Not practiced yet");
      // composer is null -> no composer sub-label rendered.
      expect(screen.queryByText("Chopin")).toBeNull();
    });

    it("calls onOpenScore with only {piece_id, title}, never the full piece", () => {
      const onOpenScore = vi.fn();
      render(
        <DetailPanel
          node={sunNode()}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={onOpenScore}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Open on score" }));
      expect(onOpenScore).toHaveBeenCalledWith({
        piece_id: 7,
        title: "Nocturne Op. 9 No. 2",
      });
    });

    it("omits the Ledger jump button when onOpenLedger is not supplied", () => {
      render(
        <DetailPanel
          node={sunNode()}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Open in History" }),
      ).toBeNull();
    });

    it("calls onOpenLedger with the same jump context when supplied", () => {
      const onOpenLedger = vi.fn();
      render(
        <DetailPanel
          node={sunNode()}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
          onOpenLedger={onOpenLedger}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Open in History" }));
      expect(onOpenLedger).toHaveBeenCalledWith({
        piece_id: 7,
        title: "Nocturne Op. 9 No. 2",
      });
    });

    it("calls onClose when the close button is clicked", () => {
      const onClose = vi.fn();
      render(
        <DetailPanel
          node={sunNode()}
          snapshot={SNAPSHOT}
          onClose={onClose}
          onOpenScore={vi.fn()}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Close detail panel" }),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("renders a bare header with no metrics or actions when pieceRefId matches no piece (stale selection)", () => {
      render(
        <DetailPanel
          node={sunNode({
            id: "piece-999",
            pieceRefId: 999,
            label: "Ghost Piece",
          })}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      const panel = screen.getByRole("complementary", { name: "Ghost Piece" });
      expect(within(panel).getByText("Piece")).toBeTruthy();
      expect(within(panel).queryByText("Focused time")).toBeNull();
      expect(
        within(panel).queryByRole("button", { name: "Open on score" }),
      ).toBeNull();
    });
  });

  describe("planet node (region)", () => {
    it("renders region metrics and the piece title as a sub-label", () => {
      render(
        <DetailPanel
          node={planetNode()}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      const panel = screen.getByRole("complementary", { name: "Opening" });
      expect(within(panel).getByText("Region")).toBeTruthy();
      expect(within(panel).getByText("Nocturne Op. 9 No. 2")).toBeTruthy();

      expect(metricValue("Reps")).toBe("6");
      expect(metricValue("Clean reps")).toBe("5");
      expect(metricValue("Focused time")).toBe("1h 0m");
      expect(metricValue("Distinct dates")).toBe("3");
      expect(metricValue("Verified mastery")).toBe("1");
      expect(metricValue("Recovery resets")).toBe("2");
      expect(metricValue("Practice sessions")).toBe("2");

      expect(
        within(panel).getByText(/Revisited on distinct dates\./),
      ).toBeTruthy();
      expect(within(panel).getByText(/Honestly recovered\./)).toBeTruthy();
    });

    it("falls back optional region counters to 0 and omits the revisited/recovered note clauses", () => {
      render(
        <DetailPanel
          node={planetNode({
            id: "region-2",
            regionRefId: 2,
            label: "Coda",
          })}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      expect(metricValue("Verified mastery")).toBe("0");
      expect(metricValue("Recovery resets")).toBe("0");
      expect(metricValue("Practice sessions")).toBe("0");

      const note = screen.getByText(
        /Streak and tempo-path detail live in History/,
      );
      expect(note.textContent).not.toContain("Revisited on distinct dates.");
      expect(note.textContent).not.toContain("Honestly recovered.");
    });

    it("renders only the header when regionRefId matches no region on the piece (stale selection)", () => {
      render(
        <DetailPanel
          node={planetNode({
            id: "region-999",
            regionRefId: 999,
            label: "Ghost Region",
          })}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      const panel = screen.getByRole("complementary", { name: "Ghost Region" });
      // Piece was found, so the piece-title sub-label still renders...
      expect(within(panel).getByText("Nocturne Op. 9 No. 2")).toBeTruthy();
      // ...but region-only metrics/note are silently absent, no error shown.
      expect(within(panel).queryByText("Reps")).toBeNull();
      expect(
        within(panel).queryByText(/Streak and tempo-path detail/),
      ).toBeNull();
    });
  });

  describe("satellite node (session)", () => {
    it("names its region and piece when both are resolvable", () => {
      render(
        <DetailPanel
          node={satelliteNode()}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      const panel = screen.getByRole("complementary", { name: "Session 1" });
      expect(within(panel).getByText("Practice session")).toBeTruthy();
      expect(
        within(panel).getByText(
          "One recorded practice session on Opening in Nocturne Op. 9 No. 2. The Universe snapshot aggregates sessions as counts, so the full story of this session lives in History.",
        ),
      ).toBeTruthy();
    });

    it("degrades gracefully to the bare sentence when it carries no piece/region refs", () => {
      render(
        <DetailPanel
          node={satelliteNode({
            pieceRefId: undefined,
            regionRefId: undefined,
          })}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      expect(
        screen.getByText(
          "One recorded practice session. The Universe snapshot aggregates sessions as counts, so the full story of this session lives in History.",
        ),
      ).toBeTruthy();
    });

    it("still exposes score/ledger jump actions when its piece resolves", () => {
      render(
        <DetailPanel
          node={satelliteNode()}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Open on score" }),
      ).toBeTruthy();
    });
  });

  describe("cluster node", () => {
    it("shows the aggregated session count and region name", () => {
      render(
        <DetailPanel
          node={clusterNode()}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      expect(
        screen.getByText(
          "5 older sessions on Opening, collapsed to keep the sky legible.",
        ),
      ).toBeTruthy();
    });

    it("silently drops the count (blank, not an error) when aggregated is missing (malformed node)", () => {
      render(
        <DetailPanel
          node={clusterNode({ aggregated: undefined })}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      // Documents current (undefended) behavior for a malformed GraphNode:
      // React silently renders nothing for `undefined`, leaving a dangling
      // "older sessions" sentence with no count and no error surfaced.
      expect(
        screen.getByText(
          "older sessions on Opening, collapsed to keep the sky legible.",
          {
            exact: false,
          },
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/\d+ older sessions/)).toBeNull();
    });

    it("omits the Expand button when onExpandCluster is not supplied", () => {
      render(
        <DetailPanel
          node={clusterNode()}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Expand sessions" }),
      ).toBeNull();
    });

    it("calls onExpandCluster with the node id when Expand is clicked", () => {
      const onExpandCluster = vi.fn();
      render(
        <DetailPanel
          node={clusterNode()}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
          onExpandCluster={onExpandCluster}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Expand sessions" }));
      expect(onExpandCluster).toHaveBeenCalledWith("cluster-1");
    });

    it("never renders the score/ledger jump actions for a cluster, even with a resolvable piece", () => {
      render(
        <DetailPanel
          node={clusterNode()}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
          onOpenLedger={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Open on score" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Open in History" }),
      ).toBeNull();
    });
  });

  describe("malformed/empty snapshot data", () => {
    it("resolves no piece and no region against an empty snapshot without throwing", () => {
      const emptySnapshot: UniverseSnapshot = { ...SNAPSHOT, pieces: [] };
      expect(() =>
        render(
          <DetailPanel
            node={planetNode()}
            snapshot={emptySnapshot}
            onClose={vi.fn()}
            onOpenScore={vi.fn()}
          />,
        ),
      ).not.toThrow();
      const panel = screen.getByRole("complementary", { name: "Opening" });
      expect(within(panel).queryByText("Reps")).toBeNull();
    });

    it("wraps an out-of-range paletteIndex instead of crashing", () => {
      const { container } = render(
        <DetailPanel
          node={sunNode({ paletteIndex: -3 })}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
      const swatch = container.querySelector(".universe-detail-swatch");
      expect(swatch).toBeTruthy();
      expect((swatch as HTMLElement).style.background).not.toBe("");
    });
  });
});
