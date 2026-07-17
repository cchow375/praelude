import { describe, expect, it } from "vitest";
import {
  buildGraph,
  createSimulation,
  planetRadius,
  SESSION_CLUSTER_THRESHOLD,
  type GraphNode,
} from "./simulation";
import type { RegionSignal, UniversePiece, UniverseSnapshot } from "../types";

function region(overrides: Partial<RegionSignal>): RegionSignal {
  return {
    region_id: 1,
    name: "Region",
    kind: "section",
    focused_seconds: 600,
    active_days_28: 1,
    practiced: true,
    revisited: false,
    quality_brightness: 0.95,
    last_practiced: "2026-07-10T00:00:00Z",
    practice_events: 1,
    rated_rep_events: 1,
    clean_rep_events: 1,
    distinct_practice_dates: 1,
    practice_sessions: 1,
    ...overrides,
  };
}

function piece(overrides: Partial<UniversePiece>): UniversePiece {
  return {
    piece_id: 1,
    title: "Piece",
    composer: null,
    focused_seconds: 600,
    active_days_28: 1,
    regions_total: 1,
    regions_practiced: 1,
    regions_revisited: 0,
    mastered_targets: 0,
    recovered_targets: 0,
    open_recovery_debt: 0,
    practice_sessions: 1,
    earned_maturity: 0.1,
    quality_brightness: 0.95,
    last_practiced: "2026-07-10T00:00:00Z",
    region_signals: [region({})],
    ...overrides,
  };
}

function snapshot(pieces: UniversePiece[]): UniverseSnapshot {
  return {
    generated_at: "2026-07-12T00:00:00Z",
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
    pieces,
  };
}

describe("buildGraph", () => {
  it("maps a two-piece snapshot to two suns with their child planets and satellites", () => {
    const graph = buildGraph(
      snapshot([
        piece({
          piece_id: 1,
          region_signals: [
            region({ region_id: 11, practice_sessions: 2 }),
            region({ region_id: 12, practice_sessions: 1 }),
          ],
        }),
        piece({
          piece_id: 2,
          region_signals: [region({ region_id: 21, practice_sessions: 3 })],
        }),
      ]),
    );

    const suns = graph.nodes.filter((n) => n.kind === "sun");
    const planets = graph.nodes.filter((n) => n.kind === "planet");
    const satellites = graph.nodes.filter((n) => n.kind === "satellite");
    expect(suns.map((n) => n.id)).toEqual(["piece-1", "piece-2"]);
    expect(planets.map((n) => n.id)).toEqual([
      "region-11",
      "region-12",
      "region-21",
    ]);
    // 2 + 1 + 3 sessions, all under threshold -> one satellite each.
    expect(satellites).toHaveLength(6);

    // Every planet links to its sun; every satellite links to its planet.
    expect(graph.links).toContainEqual({
      source: "piece-1",
      target: "region-11",
    });
    expect(graph.links).toContainEqual({
      source: "region-21",
      target: "session-21-0",
    });

    // A whole piece-system shares one palette bucket.
    const system1 = graph.nodes.filter((n) => n.pieceRefId === 1);
    expect(new Set(system1.map((n) => n.paletteIndex)).size).toBe(1);
  });

  it("collapses sessions past the threshold into an expandable cluster node", () => {
    const overflow = SESSION_CLUSTER_THRESHOLD + 3;
    const graph = buildGraph(
      snapshot([
        piece({
          piece_id: 5,
          region_signals: [
            region({ region_id: 55, practice_sessions: overflow }),
          ],
        }),
      ]),
    );
    const satellites = graph.nodes.filter((n) => n.kind === "satellite");
    const clusters = graph.nodes.filter((n) => n.kind === "cluster");
    expect(satellites).toHaveLength(SESSION_CLUSTER_THRESHOLD);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].id).toBe("cluster-55");
    expect(clusters[0].aggregated).toBe(overflow - SESSION_CLUSTER_THRESHOLD);
    expect(clusters[0].label).toBe(`+${overflow - SESSION_CLUSTER_THRESHOLD}`);

    // Expanding that cluster emits every session as an individual satellite.
    const expanded = buildGraph(
      snapshot([
        piece({
          piece_id: 5,
          region_signals: [
            region({ region_id: 55, practice_sessions: overflow }),
          ],
        }),
      ]),
      new Set(["cluster-55"]),
    );
    expect(expanded.nodes.filter((n) => n.kind === "satellite")).toHaveLength(
      overflow,
    );
    expect(expanded.nodes.filter((n) => n.kind === "cluster")).toHaveLength(0);
  });

  it("grows sun radius with focused time (log scale)", () => {
    const small = buildGraph(
      snapshot([piece({ piece_id: 1, focused_seconds: 600 })]),
    ).nodes.find((n) => n.kind === "sun")!;
    const large = buildGraph(
      snapshot([piece({ piece_id: 1, focused_seconds: 36000 })]),
    ).nodes.find((n) => n.kind === "sun")!;
    expect(large.radius).toBeGreaterThan(small.radius);
  });

  it("never lets a planet's radius come from raw clean-click volume", () => {
    const few = planetRadius(
      region({ clean_rep_events: 1, rated_rep_events: 1 }),
    );
    const many = planetRadius(
      region({ clean_rep_events: 999_999, rated_rep_events: 999_999 }),
    );
    expect(few).toBe(many);
  });

  it("returns an empty graph for a missing snapshot", () => {
    expect(buildGraph(null)).toEqual({ nodes: [], links: [] });
  });
});

describe("createSimulation", () => {
  it("registers charge, link, collide and radial forces and starts stopped", () => {
    const { nodes, links } = buildGraph(
      snapshot([
        piece({
          piece_id: 1,
          region_signals: [region({ region_id: 11, practice_sessions: 2 })],
        }),
      ]),
    );
    const sim = createSimulation(nodes, links);
    expect(sim.force("charge")).toBeTruthy();
    expect(sim.force("link")).toBeTruthy();
    expect(sim.force("collide")).toBeTruthy();
    expect(sim.force("radial")).toBeTruthy();
    // alphaTarget 0 => it wants to sleep; stopped => no internal timer burns CPU.
    expect(sim.alphaTarget()).toBe(0);
  });

  it("settles: alpha decays below alphaMin after enough manual ticks, then can sleep", () => {
    const { nodes, links } = buildGraph(
      snapshot([
        piece({
          piece_id: 1,
          region_signals: [
            region({ region_id: 11, practice_sessions: 3 }),
            region({ region_id: 12, practice_sessions: 2 }),
          ],
        }),
      ]),
    );
    const sim = createSimulation(nodes, links);
    let ticks = 0;
    while (sim.alpha() > sim.alphaMin() && ticks < 1000) {
      sim.tick();
      ticks += 1;
    }
    expect(sim.alpha()).toBeLessThanOrEqual(sim.alphaMin());
    expect(ticks).toBeLessThan(1000);
    // Positions are finite numbers the renderer can read.
    for (const node of nodes as GraphNode[]) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });
});
