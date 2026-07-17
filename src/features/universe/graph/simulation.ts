import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import { starRadius, stableIdHash } from "../graphLayout";
import type { RegionSignal, UniversePiece, UniverseSnapshot } from "../types";

/**
 * The d3-force model behind the Universe galaxy.
 *
 * The Universe snapshot only carries *counts* (focused seconds, session totals,
 * rated/clean rep totals), never individual session rows, so the graph is built
 * honestly from those counts:
 *   - each piece  -> a "sun"       (radius = focused time, log scale)
 *   - each region -> a "planet"    (radius/brightness = its mastery state)
 *   - each recorded session -> a "satellite" orbiting its planet
 *   - sessions past a per-planet threshold collapse into one expandable
 *     "cluster" node so a long-lived region never spawns hundreds of dots.
 *
 * A whole piece-system shares one stable palette index (seeded by piece id) so
 * the sky reads the same across reloads. This module owns no rendering and no
 * React; it is pure graph math + a sleeping force simulation.
 */

export type NodeKind = "sun" | "planet" | "satellite" | "cluster";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  parentId?: string;
  radius: number;
  label: string;
  /** The database id of the entity this node stands for (piece/region id). */
  refId?: number;
  /** Owning piece id — lets the detail panel jump to Score/Ledger from any depth. */
  pieceRefId?: number;
  /** Owning region id for satellites/clusters. */
  regionRefId?: number;
  /** Stable per-piece palette bucket (0..7); shared by the whole system. */
  paletteIndex: number;
  /** Layer depth: sun 0, planet 1, satellite/cluster 2. Drives the radial force. */
  depth: number;
  /** For cluster nodes: how many sessions it aggregates. */
  aggregated?: number;
  // d3-force runtime fields (mutated in place by the simulation).
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** Individual satellites shown per planet before the rest collapse into a cluster. */
export const SESSION_CLUSTER_THRESHOLD = 4;

const PALETTE_COUNT = 8;

function paletteFor(pieceId: number): number {
  return stableIdHash(pieceId) % PALETTE_COUNT;
}

/** A planet's radius comes from its recorded mastery state, never from raw clicks. */
export function planetRadius(region: RegionSignal): number {
  let radius = region.practiced ? 8 : 5;
  radius += Math.min(
    4,
    Math.log2(1 + (region.distinct_practice_dates ?? 0)) * 1.6,
  );
  if ((region.mastery_contracts_completed ?? 0) > 0) radius += 3;
  if (region.recovered) radius += 1.5;
  return Math.max(5, Math.min(18, radius));
}

function sessionCount(region: RegionSignal): number {
  const sessions = region.practice_sessions ?? 0;
  return Number.isFinite(sessions) ? Math.max(0, Math.trunc(sessions)) : 0;
}

/**
 * Build the galaxy graph from an earned snapshot.
 *
 * @param expandedClusters ids of cluster nodes the user has expanded; those
 *   planets emit every session as an individual satellite instead of collapsing.
 */
export function buildGraph(
  snapshot: UniverseSnapshot | null | undefined,
  expandedClusters: ReadonlySet<string> = new Set(),
): Graph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  if (!snapshot) return { nodes, links };

  for (const piece of snapshot.pieces) {
    const sunId = `piece-${piece.piece_id}`;
    const palette = paletteFor(piece.piece_id);
    nodes.push({
      id: sunId,
      kind: "sun",
      radius: starRadius(piece.focused_seconds),
      label: piece.title,
      refId: piece.piece_id,
      pieceRefId: piece.piece_id,
      paletteIndex: palette,
      depth: 0,
    });

    for (const region of piece.region_signals) {
      const planetId = `region-${region.region_id}`;
      nodes.push({
        id: planetId,
        kind: "planet",
        parentId: sunId,
        radius: planetRadius(region),
        label: region.name,
        refId: region.region_id,
        pieceRefId: piece.piece_id,
        regionRefId: region.region_id,
        paletteIndex: palette,
        depth: 1,
      });
      links.push({ source: sunId, target: planetId });

      const sessions = sessionCount(region);
      const clusterId = `cluster-${region.region_id}`;
      const expanded = expandedClusters.has(clusterId);
      const individual = expanded
        ? sessions
        : Math.min(sessions, SESSION_CLUSTER_THRESHOLD);

      for (let index = 0; index < individual; index += 1) {
        const satelliteId = `session-${region.region_id}-${index}`;
        nodes.push({
          id: satelliteId,
          kind: "satellite",
          parentId: planetId,
          radius: 3,
          label: `Session ${index + 1}`,
          pieceRefId: piece.piece_id,
          regionRefId: region.region_id,
          paletteIndex: palette,
          depth: 2,
        });
        links.push({ source: planetId, target: satelliteId });
      }

      const remaining = sessions - individual;
      if (remaining > 0) {
        nodes.push({
          id: clusterId,
          kind: "cluster",
          parentId: planetId,
          radius: 6 + Math.min(6, Math.log2(1 + remaining) * 2),
          label: `+${remaining}`,
          aggregated: remaining,
          pieceRefId: piece.piece_id,
          regionRefId: region.region_id,
          paletteIndex: palette,
          depth: 2,
        });
        links.push({ source: planetId, target: clusterId });
      }
    }
  }

  return { nodes, links };
}

/** Distance a child should sit from its parent, by the child's kind. */
function linkDistance(link: GraphLink | { target: GraphNode }): number {
  const target = (link as { target: GraphNode }).target;
  const kind = typeof target === "object" ? target.kind : "planet";
  if (kind === "planet") return 78;
  if (kind === "cluster") return 34;
  return 24; // satellite
}

function chargeStrength(node: GraphNode): number {
  if (node.kind === "sun") return -520;
  if (node.kind === "planet") return -140;
  if (node.kind === "cluster") return -70;
  return -34; // satellite
}

/** Target orbital radius from the galaxy centre, by layer depth. */
function radialRadius(node: GraphNode): number {
  if (node.depth === 0) return 0;
  if (node.depth === 1) return 150;
  return 240;
}

function radialStrength(node: GraphNode): number {
  if (node.kind === "sun") return 0.02;
  if (node.kind === "planet") return 0.09;
  return 0.06;
}

export interface SimulationOptions {
  centerX?: number;
  centerY?: number;
}

/**
 * Build a d3-force simulation for the galaxy. It is returned **stopped** — the
 * caller drives ticks from a single requestAnimationFrame loop and stops
 * ticking once `alpha()` drops below `alphaMin()`, so a settled sky burns zero
 * idle CPU (this is an 8GB machine). `alphaTarget(0)` keeps it asleep at rest;
 * a drag reheats it with `alpha(...).restart-of-the-rAF-loop` on the caller side.
 */
export function createSimulation(
  nodes: GraphNode[],
  links: GraphLink[],
  options: SimulationOptions = {},
): Simulation<GraphNode, GraphLink> {
  const centerX = options.centerX ?? 0;
  const centerY = options.centerY ?? 0;

  const simulation = forceSimulation<GraphNode>(nodes)
    .force(
      "charge",
      forceManyBody<GraphNode>().strength(chargeStrength).distanceMax(900),
    )
    .force(
      "link",
      forceLink<GraphNode, GraphLink>(links)
        .id((node) => node.id)
        .distance(linkDistance)
        .strength(0.55),
    )
    .force(
      "collide",
      forceCollide<GraphNode>()
        .radius((node) => node.radius + 6)
        .strength(0.85),
    )
    .force(
      "radial",
      forceRadial<GraphNode>(radialRadius, centerX, centerY).strength(
        radialStrength,
      ),
    )
    .force("x", forceX<GraphNode>(centerX).strength(0.012))
    .force("y", forceY<GraphNode>(centerY).strength(0.012))
    .alpha(1)
    .alphaTarget(0)
    .alphaDecay(0.045);

  // Sleep by default: no internal timer runs. The React canvas owns the rAF
  // tick loop and only runs it while alpha() > alphaMin().
  simulation.stop();
  return simulation;
}
