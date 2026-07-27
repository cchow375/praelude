import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { universeSnapshot } from "./api";
import { stableIdHash } from "./graphLayout";
import type { PracticePieceContext, UniverseSnapshot } from "./types";
import { DetailPanel } from "./graph/DetailPanel";
import { formatDuration } from "./graph/format";
import { paletteAt } from "./graph/palettes";
import {
  buildGraph,
  createSimulation,
  type Graph,
  type GraphNode,
} from "./graph/simulation";
import type { Simulation } from "d3-force";
import "./universe.css";

interface UniverseWorkspaceProps {
  /** Jump to the Score/Atlas workspace (null = open Atlas with no piece). */
  onOpenPractice: (piece: PracticePieceContext | null) => void;
  /** Optional jump to the Ledger workspace for a piece. */
  onOpenLedger?: (piece: PracticePieceContext) => void;
}

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

const VIEW_WIDTH = 1_100;
const VIEW_HEIGHT = 640;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2.6;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const CLICK_SLOP = 4;

/**
 * Session-scoped position memory. The backend's PanelLayout is a typed
 * {panels: Vec<PanelGeometry>} with no piece keying, so there is NO honest
 * existing command to persist a per-node galaxy layout (see the report /
 * NOTES). Rather than abuse a typed store or add a backend command under the
 * freeze, dragged/settled positions are remembered here for the life of the
 * process, and the first-ever layout is deterministically seeded by piece id so
 * the sky looks the same every time it is opened.
 */
const POSITION_MEMORY = new Map<string, { x: number; y: number }>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A link endpoint is a string id until d3 ticks, then a node object. */
function linkEndId(end: string | { id: string }): string {
  return typeof end === "object" ? end.id : end;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string"
    ? error
    : "The Practice Universe could not be loaded.";
}

/** Deterministic first layout, or the remembered one, seeded by stable ids. */
function seedPositions(graph: Graph): void {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const suns = graph.nodes.filter((node) => node.kind === "sun");

  suns.forEach((sun, index) => {
    const remembered = POSITION_MEMORY.get(sun.id);
    if (remembered) {
      sun.x = remembered.x;
      sun.y = remembered.y;
      return;
    }
    if (suns.length === 1) {
      sun.x = 0;
      sun.y = 0;
      return;
    }
    const angle =
      index * GOLDEN_ANGLE + (stableIdHash(sun.refId ?? 0) % 12) * 0.02;
    const distance = 150 + index * 42;
    sun.x = Math.cos(angle) * distance;
    sun.y = Math.sin(angle) * distance;
  });

  for (const node of graph.nodes) {
    if (node.kind === "sun") continue;
    const remembered = POSITION_MEMORY.get(node.id);
    if (remembered) {
      node.x = remembered.x;
      node.y = remembered.y;
      continue;
    }
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const px = parent?.x ?? 0;
    const py = parent?.y ?? 0;
    const angle = (stringHash(node.id) % 3600) * (Math.PI / 1800);
    const distance =
      node.kind === "planet" ? 74 : node.kind === "cluster" ? 34 : 26;
    node.x = px + Math.cos(angle) * distance;
    node.y = py + Math.sin(angle) * distance;
  }
}

function fitToNodes(nodes: GraphNode[]): ViewTransform {
  if (nodes.length === 0) {
    return { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2, scale: 1 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const r = node.radius + 60;
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = clamp(
    Math.min((VIEW_WIDTH - 80) / width, (VIEW_HEIGHT - 80) / height),
    MIN_ZOOM,
    1.4,
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    scale,
    x: VIEW_WIDTH / 2 - cx * scale,
    y: VIEW_HEIGHT / 2 - cy * scale,
  };
}

interface PointerActivity {
  pointerId: number;
  mode: "pan" | "node";
  nodeId: string | null;
  startClientX: number;
  startClientY: number;
  originViewX: number;
  originViewY: number;
  svgScaleX: number;
  svgScaleY: number;
  moved: boolean;
}

export function UniverseWorkspace({
  onOpenPractice,
  onOpenLedger,
}: UniverseWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<UniverseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [view, setView] = useState<ViewTransform>({
    x: VIEW_WIDTH / 2,
    y: VIEW_HEIGHT / 2,
    scale: 1,
  });
  const [dragging, setDragging] = useState(false);

  const simRef = useRef<Simulation<GraphNode, never> | null>(null);
  const rafRef = useRef<number | null>(null);
  const autoFittedRef = useRef(false);
  const interactedRef = useRef(false);
  const activityRef = useRef<PointerActivity | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // One state bump per animation frame — never one setState per node.
  const [, bump] = useReducer((tick: number) => tick + 1, 0);

  const load = useCallback(async () => {
    let alive = true;
    setLoading(true);
    setError(null);
    try {
      const next = await universeSnapshot();
      if (alive) setSnapshot(next);
    } catch (reason) {
      if (alive) {
        setSnapshot(null);
        setError(messageOf(reason));
      }
    } finally {
      if (alive) setLoading(false);
    }
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const graph = useMemo(
    () => buildGraph(snapshot, expandedClusters),
    [snapshot, expandedClusters],
  );
  const graphKey = useMemo(
    () => graph.nodes.map((node) => node.id).join("|"),
    [graph],
  );

  // Memoized gradient defs — recomputed only when the node set changes.
  const gradientDefs = useMemo(
    () =>
      graph.nodes
        .filter((node) => node.kind === "sun" || node.kind === "planet")
        .map((node) => ({
          id: `universe-fill-${node.id}`,
          palette: paletteAt(node.paletteIndex),
        })),
    [graphKey],
  );

  const ensureRunning = useCallback(() => {
    if (rafRef.current != null) return;
    const step = () => {
      const sim = simRef.current;
      if (!sim) {
        rafRef.current = null;
        return;
      }
      sim.tick();
      bump();
      if (sim.alpha() > sim.alphaMin()) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null; // settled — sleep, no idle CPU
        // Frame the settled galaxy once, so no system loads off-canvas. Skip if
        // the user already panned/zoomed/dragged (respect their view).
        if (!autoFittedRef.current && !interactedRef.current) {
          autoFittedRef.current = true;
          setView(fitToNodes(sim.nodes() as GraphNode[]));
        }
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const reheat = useCallback(
    (target = 0.5) => {
      const sim = simRef.current;
      if (!sim) return;
      sim.alpha(Math.max(sim.alpha(), target));
      ensureRunning();
    },
    [ensureRunning],
  );

  // Own the simulation lifecycle. Ticks stop when settled and the whole loop is
  // torn down when the Universe unmounts (i.e. when another workspace is shown).
  useEffect(() => {
    if (graph.nodes.length === 0) {
      simRef.current = null;
      return;
    }
    seedPositions(graph);
    const sim = createSimulation(
      graph.nodes,
      graph.links,
    ) as unknown as Simulation<GraphNode, never>;
    simRef.current = sim;
    autoFittedRef.current = false;
    interactedRef.current = false;
    setView(fitToNodes(graph.nodes));
    sim.alpha(0.9);
    ensureRunning();

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      for (const node of graph.nodes) {
        if (node.x != null && node.y != null) {
          POSITION_MEMORY.set(node.id, { x: node.x, y: node.y });
        }
      }
      sim.stop();
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey, ensureRunning]);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph],
  );

  const neighborhood = useMemo(() => {
    if (hoveredId == null) return null;
    const set = new Set<string>([hoveredId]);
    for (const link of graph.links) {
      const sourceId = linkEndId(link.source);
      const targetId = linkEndId(link.target);
      if (sourceId === hoveredId) set.add(targetId);
      if (targetId === hoveredId) set.add(sourceId);
    }
    return set;
  }, [hoveredId, graph.links]);

  const selectedNode = selectedId ? (nodeById.get(selectedId) ?? null) : null;

  // ---- pointer: delegation on the svg (no per-node closures) --------------

  const svgMetrics = (element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    return {
      scaleX: bounds.width > 0 ? VIEW_WIDTH / bounds.width : 1,
      scaleY: bounds.height > 0 ? VIEW_HEIGHT / bounds.height : 1,
      left: bounds.left,
      top: bounds.top,
    };
  };

  const clientToWorld = (
    element: SVGSVGElement,
    clientX: number,
    clientY: number,
  ) => {
    const metrics = svgMetrics(element);
    const svgX = (clientX - metrics.left) * metrics.scaleX;
    const svgY = (clientY - metrics.top) * metrics.scaleY;
    const v = viewRef.current;
    return { x: (svgX - v.x) / v.scale, y: (svgY - v.y) / v.scale };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    // Suppress the browser's focus-on-press: the node <g> is keyboard-focusable
    // (tabIndex 0, for a11y), and a mouse press would otherwise focus it and
    // scroll it to the centre of the nearest scroll container — the node appears
    // to "teleport" to the middle of the view. preventDefault on this (bubbled)
    // pointerdown cancels the compat mousedown whose default action is focus,
    // while leaving Tab keyboard focus untouched.
    event.preventDefault();
    const targetEl = event.target as Element;
    const nodeEl = targetEl.closest?.("[data-node-id]") as HTMLElement | null;
    const metrics = svgMetrics(event.currentTarget);
    activityRef.current = {
      pointerId: event.pointerId,
      mode: nodeEl ? "node" : "pan",
      nodeId: nodeEl?.dataset.nodeId ?? null,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originViewX: viewRef.current.x,
      originViewY: viewRef.current.y,
      svgScaleX: metrics.scaleX,
      svgScaleY: metrics.scaleY,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A non-active/synthetic pointer id can't be captured; harmless.
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const activity = activityRef.current;
    if (!activity || activity.pointerId !== event.pointerId) return;
    const dx = event.clientX - activity.startClientX;
    const dy = event.clientY - activity.startClientY;
    if (!activity.moved && Math.hypot(dx, dy) > CLICK_SLOP) {
      activity.moved = true;
      interactedRef.current = true; // the user owns the view from here
      if (activity.mode === "node") setDragging(true);
    }
    if (!activity.moved) return;

    if (activity.mode === "pan") {
      setView((current) => ({
        ...current,
        x: activity.originViewX + dx * activity.svgScaleX,
        y: activity.originViewY + dy * activity.svgScaleY,
      }));
      return;
    }
    // node drag: pin the node under the pointer and let physics react locally.
    const dragged = activity.nodeId ? nodeById.get(activity.nodeId) : null;
    if (!dragged) return;
    const world = clientToWorld(
      event.currentTarget,
      event.clientX,
      event.clientY,
    );
    dragged.fx = world.x;
    dragged.fy = world.y;
    dragged.x = world.x;
    dragged.y = world.y;
    bump();
    reheat(0.4);
  };

  const finishActivity = (event: ReactPointerEvent<SVGSVGElement>) => {
    const activity = activityRef.current;
    if (!activity || activity.pointerId !== event.pointerId) return;
    activityRef.current = null;
    try {
      // Throws NotFoundError if the pointer was already implicitly released
      // (e.g. a plain tap); that must never abort the click-select below.
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // no active capture for this pointer — fine.
    }
    setDragging(false);

    if (activity.mode === "node" && activity.nodeId) {
      const node = nodeById.get(activity.nodeId);
      if (!activity.moved) {
        // a click, not a drag
        if (node?.kind === "cluster") {
          setExpandedClusters((current) => {
            const next = new Set(current);
            next.add(activity.nodeId as string);
            return next;
          });
          setSelectedId(null);
        } else {
          setSelectedId(activity.nodeId);
        }
      } else if (node) {
        // release: free the node so the local system settles (Obsidian-style),
        // then let it come to rest.
        node.fx = null;
        node.fy = null;
        reheat(0.3);
      }
    }
  };

  const onPointerOver = (event: ReactPointerEvent<SVGSVGElement>) => {
    const nodeEl = (event.target as Element).closest?.(
      "[data-node-id]",
    ) as HTMLElement | null;
    if (nodeEl?.dataset.nodeId) setHoveredId(nodeEl.dataset.nodeId);
  };

  const onPointerOut = (event: ReactPointerEvent<SVGSVGElement>) => {
    const related = event.relatedTarget as Element | null;
    if (!related || !related.closest?.("[data-node-id]")) setHoveredId(null);
  };

  const zoomAt = useCallback(
    (factor: number, anchorX = VIEW_WIDTH / 2, anchorY = VIEW_HEIGHT / 2) => {
      interactedRef.current = true;
      setView((current) => {
        const nextScale = clamp(current.scale * factor, MIN_ZOOM, MAX_ZOOM);
        const worldX = (anchorX - current.x) / current.scale;
        const worldY = (anchorY - current.y) / current.scale;
        return {
          scale: nextScale,
          x: anchorX - worldX * nextScale,
          y: anchorY - worldY * nextScale,
        };
      });
    },
    [],
  );

  // React 19 registers root wheel listeners as passive, so preventDefault via
  // onWheel logs a console error per tick. Attach non-passive directly.
  const canvasRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svg = canvasRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const metrics = svgMetrics(svg);
      const anchorX = (event.clientX - metrics.left) * metrics.scaleX;
      const anchorY = (event.clientY - metrics.top) * metrics.scaleY;
      zoomAt(event.deltaY < 0 ? 1.12 : 0.89, anchorX, anchorY);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const resetView = useCallback(() => {
    setView(fitToNodes(graph.nodes));
  }, [graph.nodes]);

  const openScore = useCallback(
    (piece: PracticePieceContext) => onOpenPractice(piece),
    [onOpenPractice],
  );

  const expandCluster = useCallback((clusterId: string) => {
    setExpandedClusters((current) => {
      const next = new Set(current);
      next.add(clusterId);
      return next;
    });
    setSelectedId(null);
  }, []);

  const activateNode = useCallback((node: GraphNode) => {
    if (node.kind === "cluster") {
      setExpandedClusters((current) => {
        const next = new Set(current);
        next.add(node.id);
        return next;
      });
      setSelectedId(null);
      return;
    }
    setSelectedId(node.id);
  }, []);

  const pieces = snapshot?.pieces ?? [];

  return (
    <main className="universe-workspace" data-testid="universe-workspace">
      <header className="universe-intro">
        <div>
          <p className="universe-eyebrow">Earned practice evidence</p>
          <h1 id="universe-title">Practice Universe</h1>
        </div>
        <button
          type="button"
          className="universe-atlas-cta"
          onClick={() => onOpenPractice(null)}
        >
          Open Score Atlas
        </button>
      </header>

      {error && (
        <div className="universe-error" role="alert">
          <span>{error}</span>
          {!snapshot && (
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="universe-state" role="status" aria-live="polite">
          <span className="universe-loading-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <p>Mapping your recorded practice…</p>
        </div>
      ) : snapshot && pieces.length === 0 ? (
        <section
          className="universe-state universe-empty"
          aria-labelledby="universe-empty-title"
        >
          <span className="universe-empty-system" aria-hidden="true" />
          <h2 id="universe-empty-title">Your universe is quiet for now.</h2>
          <p>
            Import a piece and begin a session. Only recorded practice evidence
            will appear here.
          </p>
          <button
            type="button"
            className="universe-atlas-cta"
            onClick={() => onOpenPractice(null)}
          >
            Open Score Atlas
          </button>
        </section>
      ) : snapshot ? (
        <>
          <section className="universe-totals" aria-label="Practice overview">
            <SummaryValue
              label="Focused time"
              value={formatDuration(snapshot.totals.focused_seconds)}
            />
            <SummaryValue
              label="Active days · 28"
              value={String(snapshot.totals.active_days_28)}
            />
            <SummaryValue
              label="Targets practiced"
              value={String(snapshot.totals.regions_practiced)}
            />
            <SummaryValue
              label="Mastery verified"
              value={String(snapshot.totals.mastered_targets ?? 0)}
            />
            <SummaryValue
              label="Practice sessions"
              value={String(snapshot.totals.practice_sessions ?? 0)}
            />
          </section>

          <section
            className="universe-canvas-section"
            aria-labelledby="universe-canvas-title"
          >
            <div className="universe-canvas-heading">
              <div>
                <p className="universe-section-kicker">
                  Interactive evidence galaxy
                </p>
                <h2 id="universe-canvas-title">Your earned systems</h2>
              </div>
              <div
                className="universe-canvas-controls"
                role="group"
                aria-label="Map controls"
              >
                <button
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => zoomAt(0.82)}
                >
                  −
                </button>
                <output aria-label="Current zoom">
                  {Math.round(view.scale * 100)}%
                </output>
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => zoomAt(1.22)}
                >
                  +
                </button>
                <button type="button" onClick={resetView}>
                  Reset view
                </button>
              </div>
            </div>
            <p id="universe-canvas-help" className="universe-canvas-help">
              Drag · pan · zoom · click a system for detail
            </p>

            <div className="universe-canvas-and-detail">
              <div className="universe-canvas-frame">
                <svg
                  ref={canvasRef}
                  className={`universe-canvas${dragging ? " is-dragging" : ""}${
                    hoveredId ? " is-hovering" : ""
                  }`}
                  viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                  role="application"
                  aria-labelledby="universe-canvas-title"
                  aria-describedby="universe-canvas-help"
                  data-zoom={view.scale.toFixed(3)}
                  data-hovered={hoveredId ?? ""}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={finishActivity}
                  onPointerCancel={finishActivity}
                  onPointerOver={onPointerOver}
                  onPointerOut={onPointerOut}
                >
                  <defs>
                    {gradientDefs.map((def) => (
                      <radialGradient
                        key={def.id}
                        id={def.id}
                        cx="34%"
                        cy="28%"
                      >
                        <stop offset="0" stopColor={def.palette.core} />
                        <stop offset="0.55" stopColor={def.palette.body} />
                        <stop offset="1" stopColor={def.palette.edge} />
                      </radialGradient>
                    ))}
                  </defs>
                  <rect
                    className="universe-space"
                    width={VIEW_WIDTH}
                    height={VIEW_HEIGHT}
                  />
                  <g
                    className="universe-world"
                    transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}
                  >
                    <g className="universe-links" aria-hidden="true">
                      {graph.links.map((link) => {
                        // d3-force replaces string endpoints with node objects
                        // once the sim ticks; resolve either form.
                        const sourceId = linkEndId(link.source);
                        const targetId = linkEndId(link.target);
                        const a = nodeById.get(sourceId);
                        const b = nodeById.get(targetId);
                        if (!a || !b) return null;
                        const dimmed =
                          neighborhood != null &&
                          !(
                            neighborhood.has(sourceId) &&
                            neighborhood.has(targetId)
                          );
                        return (
                          <line
                            key={`${sourceId}>${targetId}`}
                            className={`universe-link${dimmed ? " is-dim" : ""}`}
                            x1={a.x ?? 0}
                            y1={a.y ?? 0}
                            x2={b.x ?? 0}
                            y2={b.y ?? 0}
                          />
                        );
                      })}
                    </g>
                    {graph.nodes.map((node) => {
                      const palette = paletteAt(node.paletteIndex);
                      const lit =
                        neighborhood == null || neighborhood.has(node.id);
                      const selected = node.id === selectedId;
                      const fill =
                        node.kind === "sun" || node.kind === "planet"
                          ? `url(#universe-fill-${node.id})`
                          : node.kind === "cluster"
                            ? palette.edge
                            : palette.signal;
                      return (
                        <g
                          key={node.id}
                          className={`universe-node universe-node-${node.kind}${
                            lit ? " is-lit" : " is-dim"
                          }${selected ? " is-selected" : ""}`}
                          data-node-id={node.id}
                          data-node-kind={node.kind}
                          transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}
                          role="button"
                          tabIndex={0}
                          aria-label={`${node.kind} · ${node.label}`}
                          aria-pressed={
                            node.kind === "cluster" ? undefined : selected
                          }
                          onFocus={() => setHoveredId(node.id)}
                          onBlur={() => setHoveredId(null)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ")
                              return;
                            event.preventDefault();
                            event.stopPropagation();
                            activateNode(node);
                          }}
                        >
                          {selected && (
                            <circle
                              className="universe-node-halo"
                              r={node.radius + 8}
                              style={{ stroke: palette.signal }}
                            />
                          )}
                          <circle
                            className="universe-node-body"
                            r={node.radius}
                            fill={fill}
                          />
                          {node.kind === "sun" && (
                            <circle
                              className="universe-node-core"
                              cx={-node.radius * 0.22}
                              cy={-node.radius * 0.22}
                              r={Math.max(2, node.radius * 0.16)}
                              fill={palette.core}
                            />
                          )}
                          {node.kind === "cluster" && (
                            <text
                              className="universe-cluster-label"
                              y={node.radius + 12}
                              textAnchor="middle"
                            >
                              {node.label}
                            </text>
                          )}
                          {node.kind === "sun" && (
                            <text
                              className="universe-node-label"
                              y={node.radius + 16}
                              textAnchor="middle"
                            >
                              {node.label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>

              {selectedNode && snapshot && (
                <DetailPanel
                  node={selectedNode}
                  snapshot={snapshot}
                  onClose={() => setSelectedId(null)}
                  onOpenScore={openScore}
                  onOpenLedger={onOpenLedger}
                  onExpandCluster={expandCluster}
                />
              )}
            </div>
          </section>

          <details className="universe-ledger">
            <summary>Evidence ledger — text equivalent</summary>
            <ul>
              {pieces.map((piece) => (
                <li
                  key={piece.piece_id}
                  data-testid={`universe-text-${piece.piece_id}`}
                >
                  <button
                    type="button"
                    className="universe-ledger-piece"
                    onClick={() => setSelectedId(`piece-${piece.piece_id}`)}
                  >
                    {piece.title}
                  </button>
                  {piece.composer ? ` · ${piece.composer}` : ""} —{" "}
                  {formatDuration(piece.focused_seconds)} focused ·{" "}
                  {piece.regions_practiced}/{piece.regions_total} targets ·{" "}
                  {piece.mastered_targets ?? 0} mastered ·{" "}
                  {piece.practice_sessions ?? 0} sessions
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </main>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="universe-summary-value">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export { formatDuration };
