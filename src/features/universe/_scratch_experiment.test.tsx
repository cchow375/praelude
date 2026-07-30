import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegionSignal, UniversePiece, UniverseSnapshot } from "./types";
import { DetailPanel } from "./graph/DetailPanel";
import type { GraphNode } from "./graph/simulation";
import { buildGraph, planetRadius } from "./graph/simulation";
import { layoutUniversePieces, stableIdHash } from "./graphLayout";

afterEach(cleanup);

const REGION: RegionSignal = {
  region_id: 1,
  name: "Opening",
  kind: "section",
  focused_seconds: 600,
  active_days_28: 1,
  practiced: true,
  revisited: false,
  quality_brightness: 0.9,
  last_practiced: null,
  practice_events: 1,
  rated_rep_events: 1,
  clean_rep_events: 1,
  distinct_practice_dates: 1,
};

const PIECE: UniversePiece = {
  piece_id: 7,
  title: "Piece",
  composer: null,
  focused_seconds: 600,
  active_days_28: 1,
  regions_total: 1,
  regions_practiced: 1,
  regions_revisited: 0,
  quality_brightness: 0.9,
  last_practiced: null,
  region_signals: [REGION],
};

const SNAPSHOT: UniverseSnapshot = {
  generated_at: "2026-07-12T17:00:00Z",
  definitions: [],
  traces: {
    source: "test",
    practice_event_kinds: [],
    idle_threshold_seconds: 300,
    active_window_start: "2026-06-15",
    active_window_end: "2026-07-12",
    quality_formula: "test",
  },
  totals: {
    focused_seconds: 0,
    active_days_28: 0,
    regions_practiced: 0,
    regions_revisited: 0,
  },
  pieces: [PIECE],
};

function sunNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "piece-7",
    kind: "sun",
    radius: 22,
    label: "Piece",
    refId: 7,
    pieceRefId: 7,
    paletteIndex: 0,
    depth: 0,
    ...overrides,
  };
}

describe("experiment: DetailPanel NaN paletteIndex", () => {
  it("check whether NaN paletteIndex throws", () => {
    let threw = false;
    let message = "";
    try {
      render(
        <DetailPanel
          node={sunNode({ paletteIndex: NaN })}
          snapshot={SNAPSHOT}
          onClose={vi.fn()}
          onOpenScore={vi.fn()}
        />,
      );
    } catch (e) {
      threw = true;
      message = (e as Error).message;
    }
    console.log("threw?", threw, "message:", message);
  });
});

describe("experiment: cluster threshold in default fixtures", () => {
  it("checks whether practice_sessions in the UniverseWorkspace test fixture ever exceeds threshold", () => {
    // just a placeholder to keep this file structurally valid
    expect(true).toBe(true);
  });
});

describe("experiment: planetRadius formula branches", () => {
  it("prints radius for various combos", () => {
    const base = (overrides: Partial<RegionSignal>) =>
      planetRadius({ ...REGION, ...overrides });
    console.log(
      "practiced=false, distinct=0:",
      base({ practiced: false, distinct_practice_dates: 0 }),
    );
    console.log(
      "practiced=true, distinct=0:",
      base({ practiced: true, distinct_practice_dates: 0 }),
    );
    console.log(
      "practiced=true, distinct=0, mastery=1:",
      base({
        practiced: true,
        distinct_practice_dates: 0,
        mastery_contracts_completed: 1,
      }),
    );
    console.log(
      "practiced=true, distinct=100, mastery=1, recovered=true:",
      base({
        practiced: true,
        distinct_practice_dates: 100,
        mastery_contracts_completed: 1,
        recovered: true,
      }),
    );
    console.log(
      "practiced=false, distinct=0, mastery=0, recovered=false (min floor check):",
      base({
        practiced: false,
        distinct_practice_dates: 0,
        mastery_contracts_completed: 0,
        recovered: false,
      }),
    );
  });
});

describe("experiment: sessionCount malformed inputs via buildGraph", () => {
  it("negative/fractional/undefined practice_sessions", () => {
    const g1 = buildGraph({
      ...SNAPSHOT,
      pieces: [
        {
          ...PIECE,
          region_signals: [{ ...REGION, practice_sessions: -5 }],
        },
      ],
    });
    console.log(
      "negative sessions -> satellites:",
      g1.nodes.filter((n) => n.kind === "satellite").length,
      "clusters:",
      g1.nodes.filter((n) => n.kind === "cluster").length,
    );

    const g2 = buildGraph({
      ...SNAPSHOT,
      pieces: [
        {
          ...PIECE,
          region_signals: [{ ...REGION, practice_sessions: 4.9 }],
        },
      ],
    });
    console.log(
      "4.9 sessions -> satellites:",
      g2.nodes.filter((n) => n.kind === "satellite").length,
      "clusters:",
      g2.nodes.filter((n) => n.kind === "cluster").length,
    );

    const { practice_sessions, ...regionNoSessions } = REGION;
    const g3 = buildGraph({
      ...SNAPSHOT,
      pieces: [
        {
          ...PIECE,
          region_signals: [regionNoSessions as RegionSignal],
        },
      ],
    });
    console.log(
      "omitted sessions -> satellites:",
      g3.nodes.filter((n) => n.kind === "satellite").length,
    );

    const g4 = buildGraph({
      ...SNAPSHOT,
      pieces: [
        {
          ...PIECE,
          region_signals: [{ ...REGION, practice_sessions: NaN }],
        },
      ],
    });
    console.log(
      "NaN sessions -> satellites:",
      g4.nodes.filter((n) => n.kind === "satellite").length,
      "clusters:",
      g4.nodes.filter((n) => n.kind === "cluster").length,
    );

    // exactly at threshold
    const g5 = buildGraph({
      ...SNAPSHOT,
      pieces: [
        {
          ...PIECE,
          region_signals: [{ ...REGION, practice_sessions: 4 }],
        },
      ],
    });
    console.log(
      "exactly 4 (threshold) sessions -> satellites:",
      g5.nodes.filter((n) => n.kind === "satellite").length,
      "clusters:",
      g5.nodes.filter((n) => n.kind === "cluster").length,
    );
  });
});

describe("experiment: layoutUniversePieces hash collision consequence", () => {
  it("two pieces 2**32 apart in id", () => {
    function piece(overrides: Partial<UniversePiece>): UniversePiece {
      return { ...PIECE, ...overrides };
    }
    const a = piece({ piece_id: 5, focused_seconds: 600 });
    const b = piece({ piece_id: 5 + 2 ** 32, focused_seconds: 1200 });
    const layout = layoutUniversePieces([a, b]);
    console.log("hashes equal?", stableIdHash(5) === stableIdHash(5 + 2 ** 32));
    for (const n of layout.nodes) {
      console.log(
        "piece_id",
        n.piece.piece_id,
        "x",
        n.x,
        "y",
        n.y,
        "paletteIndex",
        n.paletteIndex,
      );
    }
    const dx = layout.nodes[0].x - layout.nodes[1].x;
    const dy = layout.nodes[0].y - layout.nodes[1].y;
    console.log("distance", Math.sqrt(dx * dx + dy * dy));
  });
});
