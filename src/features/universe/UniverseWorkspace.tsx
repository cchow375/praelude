import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { universeSnapshot } from "./api";
import {
  layoutUniversePieces,
  stableIdHash,
  starRadius,
  type UniverseGraphLayout,
} from "./graphLayout";
import type {
  PracticePieceContext,
  RegionSignal,
  UniversePiece,
  UniverseSnapshot,
} from "./types";
import "./UniverseWorkspace.css";

interface UniverseWorkspaceProps {
  onOpenPractice: (piece: PracticePieceContext | null) => void;
}

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

interface DragState {
  pointerId: number;
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
}

const VIEW_WIDTH = 1_100;
const VIEW_HEIGHT = 620;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2.6;
const MAX_VISIBLE_TARGETS = 18;
const MAX_VISIBLE_SESSIONS = 24;

// Every system gets an ID-stable mineral, sky, sea, leaf, ember, or sunlight
// palette instead of one generic glow color.
const SYSTEM_PALETTES = [
  { core: "#fff1ad", body: "#e8ad43", edge: "#8e5128", signal: "#ffd76b" },
  { core: "#c4fff0", body: "#37c7ab", edge: "#126d70", signal: "#70ead2" },
  { core: "#d7f1ff", body: "#50a9dc", edge: "#245a91", signal: "#8fd8ff" },
  { core: "#ffe0c7", body: "#e97d50", edge: "#8e3d32", signal: "#ffad7e" },
  { core: "#e7ffc0", body: "#8bc65a", edge: "#416d3a", signal: "#b9ed7d" },
  { core: "#fff4c9", body: "#dfbd55", edge: "#80682c", signal: "#ffe18a" },
  { core: "#c9f7ff", body: "#43b8c9", edge: "#216b79", signal: "#82e4ed" },
  { core: "#ffe2bb", body: "#d98e47", edge: "#7f4a2c", signal: "#ffc47b" },
] as const;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "The Practice Universe could not be loaded.";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return safe > 0 ? "<1m" : "0m";
}

function formatDate(value: string | null): string {
  if (!value) return "Not practiced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function brightnessPercent(value: number) {
  return `${Math.round(clamp(value, 0.92, 1) * 100)}%`;
}

function coveragePercent(piece: UniversePiece) {
  if (piece.regions_total <= 0) return 0;
  return clamp((piece.regions_practiced / piece.regions_total) * 100, 0, 100);
}

function revisitPercent(piece: UniversePiece) {
  if (piece.regions_total <= 0) return 0;
  return clamp((piece.regions_revisited / piece.regions_total) * 100, 0, 100);
}

function masteryPercent(piece: UniversePiece) {
  if (piece.regions_total <= 0) return 0;
  return clamp(((piece.mastered_targets ?? 0) / piece.regions_total) * 100, 0, 100);
}

function maturityPercent(piece: UniversePiece) {
  return Math.round(clamp(piece.earned_maturity ?? 0, 0, 1) * 100);
}

function pieceSignalDescription(piece: UniversePiece) {
  return [
    `${formatDuration(piece.focused_seconds)} focused time`,
    `${piece.active_days_28} active ${piece.active_days_28 === 1 ? "day" : "days"} in the last 28`,
    `${piece.regions_practiced} of ${piece.regions_total} targets practiced`,
    `${piece.regions_revisited} revisited`,
    `${piece.mastered_targets ?? 0} verified mastered`,
    `${piece.recovered_targets ?? 0} honestly recovered`,
    `${piece.practice_sessions ?? 0} practice sessions`,
    `${maturityPercent(piece)}% earned maturity`,
    `${brightnessPercent(piece.quality_brightness)} quality tint`,
    "not a grade",
  ].join(", ");
}

function signalData(piece: UniversePiece) {
  return {
    "data-focused-seconds": String(piece.focused_seconds),
    "data-active-days": String(piece.active_days_28),
    "data-regions-practiced": String(piece.regions_practiced),
    "data-regions-total": String(piece.regions_total),
    "data-regions-revisited": String(piece.regions_revisited),
    "data-mastered-targets": String(piece.mastered_targets ?? 0),
    "data-recovered-targets": String(piece.recovered_targets ?? 0),
    "data-practice-sessions": String(piece.practice_sessions ?? 0),
    "data-earned-maturity": `${maturityPercent(piece)}%`,
    "data-quality-tint": brightnessPercent(piece.quality_brightness),
  };
}

function fitLayout(layout: UniverseGraphLayout): ViewTransform {
  const scale = clamp(
    Math.min((VIEW_WIDTH - 76) / layout.width, (VIEW_HEIGHT - 76) / layout.height),
    MIN_ZOOM,
    1,
  );
  return {
    scale,
    x: (VIEW_WIDTH - layout.width * scale) / 2,
    y: (VIEW_HEIGHT - layout.height * scale) / 2,
  };
}

function shortTitle(title: string) {
  return title.length > 25 ? `${title.slice(0, 24)}…` : title;
}

function sampledTargets(piece: UniversePiece): RegionSignal[] {
  return [...piece.region_signals]
    .sort((left, right) => left.region_id - right.region_id)
    .slice(0, MAX_VISIBLE_TARGETS);
}

function sessionSparkPosition(index: number, count: number, radius: number) {
  const angle = index * 2.399963229728653 - Math.PI / 2;
  const progress = Math.sqrt((index + 0.7) / Math.max(1, count));
  const distance = Math.max(4, radius * 0.18 + progress * radius * 0.58);
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
}

/** Legacy helper retained for callers that used the old static-map export. */
function starPosition(index: number, count: number): { x: number; y: number } {
  if (count <= 1) return { x: 500, y: 245 };
  const angle = index * 2.399963229728653 - Math.PI / 2;
  const progress = Math.sqrt((index + 0.65) / count);
  const radius = 72 + progress * 330;
  return { x: 500 + Math.cos(angle) * radius, y: 255 + Math.sin(angle) * radius * 0.48 };
}

export function UniverseWorkspace({ onOpenPractice }: UniverseWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<UniverseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<ViewTransform>({ x: 20, y: 20, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const systemRefs = useRef(new Map<number, SVGGElement>());
  const dragRef = useRef<DragState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await universeSnapshot());
    } catch (reason) {
      setSnapshot(null);
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pieces = useMemo(() => snapshot?.pieces ?? [], [snapshot]);
  const layout = useMemo(() => layoutUniversePieces(pieces), [pieces]);
  const fittedView = useMemo(() => fitLayout(layout), [layout]);
  const layoutKey = layout.nodes.map((node) => node.piece.piece_id).join(":");

  useLayoutEffect(() => {
    setView(fittedView);
    setSelectedId((current) => (
      current != null && pieces.some((piece) => piece.piece_id === current)
        ? current
        : layout.nodes[0]?.piece.piece_id ?? null
    ));
  }, [fittedView.x, fittedView.y, fittedView.scale, layoutKey, pieces]);

  const selectedPiece = pieces.find((piece) => piece.piece_id === selectedId) ?? null;

  const openPiece = useCallback((piece: UniversePiece) => {
    onOpenPractice({ piece_id: piece.piece_id, title: piece.title });
  }, [onOpenPractice]);

  const resetView = useCallback(() => setView(fittedView), [fittedView]);

  const zoomAt = useCallback((factor: number, anchorX = VIEW_WIDTH / 2, anchorY = VIEW_HEIGHT / 2) => {
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
  }, []);

  const moveSystemFocus = (currentIndex: number, direction: number) => {
    if (layout.nodes.length < 2) return;
    const nextIndex = (currentIndex + direction + layout.nodes.length) % layout.nodes.length;
    const nextId = layout.nodes[nextIndex].piece.piece_id;
    setSelectedId(nextId);
    systemRefs.current.get(nextId)?.focus();
  };

  const beginPan = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest(".universe-system")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      originX: view.x,
      originY: view.y,
      scaleX: bounds.width > 0 ? VIEW_WIDTH / bounds.width : 1,
      scaleY: bounds.height > 0 ? VIEW_HEIGHT / bounds.height : 1,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const movePan = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setView((current) => ({
      ...current,
      x: drag.originX + (event.clientX - drag.clientX) * drag.scaleX,
      y: drag.originY + (event.clientY - drag.clientY) * drag.scaleY,
    }));
  };

  const endPan = (event: PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
  };

  const wheelMap = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchorX = bounds.width > 0
      ? (event.clientX - bounds.left) * (VIEW_WIDTH / bounds.width)
      : VIEW_WIDTH / 2;
    const anchorY = bounds.height > 0
      ? (event.clientY - bounds.top) * (VIEW_HEIGHT / bounds.height)
      : VIEW_HEIGHT / 2;
    zoomAt(event.deltaY < 0 ? 1.12 : 0.89, anchorX, anchorY);
  };

  const keyboardMap = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    const panStep = 58;
    if (event.key === "ArrowRight") setView((current) => ({ ...current, x: current.x - panStep }));
    else if (event.key === "ArrowLeft") setView((current) => ({ ...current, x: current.x + panStep }));
    else if (event.key === "ArrowDown") setView((current) => ({ ...current, y: current.y - panStep }));
    else if (event.key === "ArrowUp") setView((current) => ({ ...current, y: current.y + panStep }));
    else if (event.key === "+" || event.key === "=") zoomAt(1.16);
    else if (event.key === "-") zoomAt(0.86);
    else if (event.key === "0" || event.key === "Home") resetView();
    else return;
    event.preventDefault();
  };

  return (
    <main
      className="universe-workspace"
      data-testid="universe-workspace"
    >
      <header className="universe-intro">
        <div className="universe-intro-copy">
          <p className="universe-eyebrow">Earned practice evidence</p>
          <h1 id="universe-title">Practice Universe</h1>
          <p className="universe-lede">
            A navigable record of where your attention has gone—not a score, rank, streak contest, or judgment of the music.
          </p>
          <p className="universe-growth-rule">
            <strong>Growth rule</strong>
            System size comes only from focused time after idle removal. Clean clicks alone never make a system larger.
          </p>
        </div>
        <button type="button" className="universe-practice-button" onClick={() => onOpenPractice(null)}>
          Open Score Atlas
        </button>
      </header>

      {error && (
        <div className="universe-error" role="alert">
          <span>{error}</span>
          {!snapshot && <button type="button" onClick={() => void load()}>Try again</button>}
        </div>
      )}

      {loading ? (
        <div className="universe-state" role="status" aria-live="polite">
          <span className="universe-loading-mark" aria-hidden="true"><i /><i /><i /></span>
          <p>Mapping your recorded practice…</p>
        </div>
      ) : snapshot && pieces.length === 0 ? (
        <section className="universe-state universe-empty" aria-labelledby="universe-empty-title">
          <span className="universe-empty-system" aria-hidden="true" />
          <h2 id="universe-empty-title">Your universe is quiet for now.</h2>
          <p>Import a piece and begin a session. Only recorded practice evidence will appear here.</p>
          <button type="button" className="universe-practice-button" onClick={() => onOpenPractice(null)}>
            Open Score Atlas
          </button>
        </section>
      ) : snapshot ? (
        <>
          <section className="universe-totals" aria-label="Practice overview">
            <SummaryValue label="Focused time" value={formatDuration(snapshot.totals.focused_seconds)} />
            <SummaryValue label="Active days · last 28" value={String(snapshot.totals.active_days_28)} />
            <SummaryValue label="Targets practiced" value={String(snapshot.totals.regions_practiced)} />
            <SummaryValue label="Targets revisited" value={String(snapshot.totals.regions_revisited)} />
            <SummaryValue label="Mastery verified" value={String(snapshot.totals.mastered_targets ?? 0)} />
            <SummaryValue label="Honestly recovered" value={String(snapshot.totals.recovered_targets ?? 0)} />
            <SummaryValue label="Practice sessions" value={String(snapshot.totals.practice_sessions ?? 0)} />
          </section>

          <section className="universe-map-section" aria-labelledby="universe-map-title">
            <div className="universe-section-heading">
              <div>
                <p className="universe-section-kicker">Interactive evidence graph</p>
                <h2 id="universe-map-title">Your earned systems</h2>
              </div>
              <p id="universe-map-instructions">
                Drag empty space or use arrow keys to pan. Scroll/pinch or use +/− to zoom. Select a system to inspect it; open Atlas from its panel.
              </p>
            </div>

            <div className="universe-map-shell">
              <div className="universe-map-toolbar">
                <div className="universe-map-controls" role="group" aria-label="Map controls">
                  <button type="button" aria-label="Zoom out" onClick={() => zoomAt(0.82)}>−</button>
                  <output aria-label="Current zoom">{Math.round(view.scale * 100)}%</output>
                  <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.22)}>+</button>
                  <button type="button" onClick={resetView}>Reset view</button>
                </div>
                <p>{layout.nodes.length} {layout.nodes.length === 1 ? "system" : "systems"} · deterministic layout from piece identity</p>
              </div>

              <div className="universe-map-and-inspector">
                <div className="universe-map-frame">
                  <svg
                    className={`universe-map ${dragging ? "is-dragging" : ""}`}
                    viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                    role="region"
                    aria-labelledby="universe-graph-title universe-graph-description"
                    aria-describedby="universe-map-instructions"
                    tabIndex={0}
                    data-zoom={view.scale.toFixed(3)}
                    onPointerDown={beginPan}
                    onPointerMove={movePan}
                    onPointerUp={endPan}
                    onPointerCancel={endPan}
                    onWheel={wheelMap}
                    onKeyDown={keyboardMap}
                  >
                    <title id="universe-graph-title">Interactive graph of practice piece systems</title>
                    <desc id="universe-graph-description">
                      System size is focused time only. Active-day arcs show continuity, inner rings show target coverage and verified mastery, target marks disclose revisits and recovery, and interior sparks represent durable practice sessions. The evidence ledger below repeats every signal in text.
                    </desc>
                    <defs>
                      {layout.nodes.map((node) => {
                        const palette = SYSTEM_PALETTES[node.paletteIndex];
                        return (
                          <radialGradient key={node.piece.piece_id} id={`universe-fill-${node.piece.piece_id}`} cx="34%" cy="28%">
                            <stop offset="0" stopColor={palette.core} />
                            <stop offset="0.5" stopColor={palette.body} />
                            <stop offset="1" stopColor={palette.edge} />
                          </radialGradient>
                        );
                      })}
                    </defs>
                    <rect className="universe-space-hit" width={VIEW_WIDTH} height={VIEW_HEIGHT} />
                    <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
                      <rect className="universe-world-boundary" width={layout.width} height={layout.height} rx="46" />
                      {layout.nodes.map((node, index) => {
                        const piece = node.piece;
                        const palette = SYSTEM_PALETTES[node.paletteIndex];
                        const activeDays = clamp(piece.active_days_28, 0, 28);
                        const coverage = coveragePercent(piece);
                        const revisits = revisitPercent(piece);
                        const mastery = masteryPercent(piece);
                        const targets = sampledTargets(piece);
                        const sessionCount = Math.min(piece.practice_sessions ?? 0, MAX_VISIBLE_SESSIONS);
                        const selected = selectedId === piece.piece_id;
                        const quality = clamp(piece.quality_brightness, 0.92, 1);
                        const maturity = clamp(piece.earned_maturity ?? 0, 0, 1);
                        return (
                          <g
                            key={piece.piece_id}
                            ref={(element) => {
                              if (element) systemRefs.current.set(piece.piece_id, element);
                              else systemRefs.current.delete(piece.piece_id);
                            }}
                            className={`universe-system ${selected ? "is-selected" : ""}`}
                            role="button"
                            tabIndex={selected || (selectedId == null && index === 0) ? 0 : -1}
                            aria-pressed={selected}
                            aria-label={`Inspect ${piece.title}${piece.composer ? ` by ${piece.composer}` : ""}. ${pieceSignalDescription(piece)}.`}
                            data-testid={`universe-system-${piece.piece_id}`}
                            data-radius={node.radius.toFixed(2)}
                            {...signalData(piece)}
                            onFocus={() => setSelectedId(piece.piece_id)}
                            onClick={() => setSelectedId(piece.piece_id)}
                            onDoubleClick={() => openPiece(piece)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                setSelectedId(piece.piece_id);
                              } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                                event.preventDefault();
                                event.stopPropagation();
                                moveSystemFocus(index, 1);
                              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                                event.preventDefault();
                                event.stopPropagation();
                                moveSystemFocus(index, -1);
                              }
                            }}
                          >
                            <circle className="universe-selection-ring" cx={node.x} cy={node.y} r={node.radius + 43} />
                            <circle className="universe-active-track" cx={node.x} cy={node.y} r={node.radius + 31} />
                            <circle
                              className="universe-active-arc"
                              cx={node.x}
                              cy={node.y}
                              r={node.radius + 31}
                              pathLength="28"
                              strokeDasharray={`${activeDays} ${28 - activeDays}`}
                              style={{ stroke: palette.signal }}
                            />
                            <circle className="universe-revisit-track" cx={node.x} cy={node.y} r={node.radius + 24} />
                            <circle
                              className="universe-revisit-arc"
                              cx={node.x}
                              cy={node.y}
                              r={node.radius + 24}
                              pathLength="100"
                              strokeDasharray={`${revisits} ${100 - revisits}`}
                              style={{ stroke: palette.core }}
                            />
                            <circle className="universe-coverage-track" cx={node.x} cy={node.y} r={node.radius + 15} />
                            <circle
                              className="universe-coverage-arc"
                              cx={node.x}
                              cy={node.y}
                              r={node.radius + 15}
                              pathLength="100"
                              strokeDasharray={`${coverage} ${100 - coverage}`}
                              style={{ stroke: palette.body }}
                            />
                            <circle className="universe-mastery-track" cx={node.x} cy={node.y} r={node.radius + 8} />
                            <circle
                              className="universe-mastery-arc"
                              cx={node.x}
                              cy={node.y}
                              r={node.radius + 8}
                              pathLength="100"
                              strokeDasharray={`${mastery} ${100 - mastery}`}
                              style={{ stroke: palette.core }}
                            />
                            <circle className="universe-system-aura" cx={node.x} cy={node.y} r={node.radius + 5} fill={palette.edge} opacity={0.08 + maturity * 0.22} />
                            <circle
                              className="universe-system-star"
                              cx={node.x}
                              cy={node.y}
                              r={node.radius}
                              fill={`url(#universe-fill-${piece.piece_id})`}
                              opacity={quality}
                            />
                            <circle className="universe-system-core" cx={node.x - node.radius * 0.2} cy={node.y - node.radius * 0.2} r={Math.max(2.4, node.radius * 0.12)} fill={palette.core} />
                            {Array.from({ length: sessionCount }, (_, sessionIndex) => {
                              const spark = sessionSparkPosition(sessionIndex, sessionCount, node.radius);
                              return (
                                <circle
                                  key={`session-${sessionIndex}`}
                                  className="universe-session-spark"
                                  cx={node.x + spark.x}
                                  cy={node.y + spark.y}
                                  r={sessionIndex % 5 === 0 ? 1.5 : 0.9}
                                  fill={sessionIndex % 5 === 0 ? palette.core : palette.signal}
                                  aria-hidden="true"
                                />
                              );
                            })}
                            {targets.map((target, targetIndex) => {
                              const angle = (targetIndex / Math.max(1, targets.length)) * Math.PI * 2 - Math.PI / 2;
                              const distance = node.radius + 39;
                              const targetX = node.x + Math.cos(angle) * distance;
                              const targetY = node.y + Math.sin(angle) * distance;
                              return (
                                <g key={target.region_id} aria-hidden="true">
                                  {target.revisited && <circle className="universe-target-revisit" cx={targetX} cy={targetY} r="5.7" style={{ stroke: palette.core }} />}
                                  {(target.mastery_contracts_completed ?? 0) > 0 && <circle className="universe-target-mastery" cx={targetX} cy={targetY} r="7.6" style={{ stroke: palette.signal }} />}
                                  {target.recovered && <circle className="universe-target-recovery" cx={targetX} cy={targetY} r="9.1" style={{ stroke: palette.core }} />}
                                  <circle
                                    className={`universe-target-mark ${target.practiced ? "is-practiced" : ""}`}
                                    cx={targetX}
                                    cy={targetY}
                                    r="3.1"
                                    style={target.practiced ? { fill: palette.signal, stroke: palette.signal } : { stroke: palette.edge }}
                                  />
                                </g>
                              );
                            })}
                            {piece.region_signals.length > MAX_VISIBLE_TARGETS && (
                              <text className="universe-target-overflow" x={node.x + node.radius + 31} y={node.y + node.radius + 34}>
                                +{piece.region_signals.length - MAX_VISIBLE_TARGETS}
                              </text>
                            )}
                            <text className="universe-system-label" x={node.x} y={node.y + node.radius + 60} textAnchor="middle">
                              {shortTitle(piece.title)}
                            </text>
                            <text className="universe-system-evidence" x={node.x} y={node.y + node.radius + 77} textAnchor="middle">
                              {formatDuration(piece.focused_seconds)} · {piece.mastered_targets ?? 0}/{piece.regions_total} mastered · {piece.practice_sessions ?? 0} sessions
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  </svg>
                </div>

                {selectedPiece && (
                  <SystemInspector
                    piece={selectedPiece}
                    onOpen={() => openPiece(selectedPiece)}
                  />
                )}
              </div>
            </div>
          </section>

          <section className="universe-piece-section" aria-labelledby="universe-ledger-title">
            <div className="universe-section-heading">
              <div>
                <p className="universe-section-kicker">Complete text equivalent</p>
                <h2 id="universe-ledger-title">Evidence ledger</h2>
              </div>
              <p>Every graph signal and every target is available here without relying on color, size, or spatial position.</p>
            </div>
            <div className="universe-piece-list">
              {pieces.map((piece) => (
                <PieceEvidenceCard
                  key={piece.piece_id}
                  piece={piece}
                  selected={selectedId === piece.piece_id}
                  onInspect={() => setSelectedId(piece.piece_id)}
                  onOpen={() => openPiece(piece)}
                />
              ))}
            </div>
          </section>

          <section className="universe-definitions" aria-labelledby="universe-definitions-title">
            <div>
              <p className="universe-section-kicker">Evidence contract</p>
              <h2 id="universe-definitions-title">How this universe earns its shape</h2>
            </div>
            <div className="universe-visual-key" aria-label="Graph visual key">
              <p><i className="is-size" aria-hidden="true" /><strong>System size</strong><span>Focused time only; raw clean clicks cannot enlarge it.</span></p>
              <p><i className="is-days" aria-hidden="true" /><strong>Outer arc</strong><span>Distinct active days in the 28-day window.</span></p>
              <p><i className="is-targets" aria-hidden="true" /><strong>Inner ring</strong><span>Recorded target coverage; outlined marks are not yet practiced.</span></p>
              <p><i className="is-return" aria-hidden="true" /><strong>Bright marks</strong><span>Targets revisited on distinct practice dates.</span></p>
              <p><i className="is-mastery" aria-hidden="true" /><strong>Mastery ring</strong><span>Only verified consecutive-clean contracts; never raw click totals.</span></p>
              <p><i className="is-recovery" aria-hidden="true" /><strong>Recovery marks</strong><span>A recorded reset followed by verified mastery.</span></p>
              <p><i className="is-sessions" aria-hidden="true" /><strong>Interior sparks</strong><span>Distinct durable practice sessions, capped visually at {MAX_VISIBLE_SESSIONS}.</span></p>
              <p><i className="is-tint" aria-hidden="true" /><strong>Brightness tint</strong><span>A bounded quality context signal; never a score or verdict.</span></p>
            </div>
            <dl>
              {snapshot.definitions.map((definition) => (
                <div key={definition.signal}>
                  <dt>{definition.label}</dt>
                  <dd>{definition.definition}</dd>
                </div>
              ))}
            </dl>
            <p className="universe-source-note">
              Window: {snapshot.traces.active_window_start} through {snapshot.traces.active_window_end}. Source: {snapshot.traces.source}. Idle threshold: {Math.round(snapshot.traces.idle_threshold_seconds / 60)} minutes.
              {snapshot.traces.maturity_formula && <> Earned maturity: {snapshot.traces.maturity_formula}.</>}
            </p>
          </section>
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

function SystemInspector({ piece, onOpen }: { piece: UniversePiece; onOpen: () => void }) {
  const palette = SYSTEM_PALETTES[stableIdHash(piece.piece_id) % SYSTEM_PALETTES.length];
  return (
    <aside className="universe-inspector" aria-labelledby={`universe-inspector-${piece.piece_id}`}>
      <header>
        <span className="universe-inspector-swatch" style={{ background: palette.body }} aria-hidden="true" />
        <div>
          <p>Selected system · inspection only</p>
          <h3 id={`universe-inspector-${piece.piece_id}`}>{piece.title}</h3>
          {piece.composer && <span>{piece.composer}</span>}
        </div>
      </header>
      <dl className="universe-inspector-metrics">
        <div><dt>Focused time / size</dt><dd>{formatDuration(piece.focused_seconds)}</dd></div>
        <div><dt>Active days · 28</dt><dd>{piece.active_days_28}</dd></div>
        <div><dt>Target coverage</dt><dd>{piece.regions_practiced} / {piece.regions_total}</dd></div>
        <div><dt>Revisited targets</dt><dd>{piece.regions_revisited}</dd></div>
        <div><dt>Verified mastery</dt><dd>{piece.mastered_targets ?? 0} / {piece.regions_total}</dd></div>
        <div><dt>Honest recoveries</dt><dd>{piece.recovered_targets ?? 0}</dd></div>
        <div><dt>Open recovery debt</dt><dd>{piece.open_recovery_debt ?? 0}</dd></div>
        <div><dt>Practice sessions</dt><dd>{piece.practice_sessions ?? 0}</dd></div>
        <div><dt>Earned maturity</dt><dd>{maturityPercent(piece)}%</dd></div>
        <div><dt>Quality tint</dt><dd>{brightnessPercent(piece.quality_brightness)} · not a grade</dd></div>
        <div><dt>Last practiced</dt><dd>{formatDate(piece.last_practiced)}</dd></div>
      </dl>
      <p className="universe-inspector-rule">Clean verdict counts never change this system’s radius.</p>
      <TargetList regions={piece.region_signals} />
      <button type="button" className="universe-atlas-button" onClick={onOpen} aria-label={`Open ${piece.title} in Atlas`}>
        Open Atlas
      </button>
    </aside>
  );
}

function TargetList({ regions }: { regions: RegionSignal[] }) {
  if (regions.length === 0) return <p className="universe-no-regions">No targets are defined for this piece yet.</p>;
  return (
    <div className="universe-target-list">
      <h4>Targets <span>{regions.length}</span></h4>
      <ul>
        {regions.map((region) => (
          <li key={region.region_id} data-practiced={region.practiced}>
            <span className="universe-target-status" aria-hidden="true" />
            <div>
              <strong>{region.name}</strong>
              <span>{region.kind} · {region.practiced ? formatDuration(region.focused_seconds) : "No recorded work"}</span>
            </div>
            <p>{region.practiced
              ? [
                  `${region.active_days_28}d`,
                  region.revisited ? "revisited" : null,
                  (region.mastery_contracts_completed ?? 0) > 0 ? "mastered" : null,
                  region.recovered ? "recovered" : null,
                  (region.open_recovery_debt ?? 0) > 0 ? `${region.open_recovery_debt} recovery due` : null,
                ].filter(Boolean).join(" · ")
              : "Unpracticed"}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PieceEvidenceCard({
  piece,
  selected,
  onInspect,
  onOpen,
}: {
  piece: UniversePiece;
  selected: boolean;
  onInspect: () => void;
  onOpen: () => void;
}) {
  return (
    <article
      className={`universe-piece-card ${selected ? "is-selected" : ""}`}
      data-testid={`universe-text-${piece.piece_id}`}
      {...signalData(piece)}
    >
      <header>
        <div>
          <h3>{piece.title}</h3>
          {piece.composer && <p>{piece.composer}</p>}
        </div>
        <span>{selected ? "Selected" : "System"}</span>
      </header>
      <dl className="universe-piece-metrics">
        <div><dt>Focused time / size</dt><dd>{formatDuration(piece.focused_seconds)}</dd></div>
        <div><dt>Active days · 28</dt><dd>{piece.active_days_28}</dd></div>
        <div><dt>Targets practiced</dt><dd>{piece.regions_practiced} of {piece.regions_total}</dd></div>
        <div><dt>Targets revisited</dt><dd>{piece.regions_revisited}</dd></div>
        <div><dt>Mastery verified</dt><dd>{piece.mastered_targets ?? 0} of {piece.regions_total}</dd></div>
        <div><dt>Honestly recovered</dt><dd>{piece.recovered_targets ?? 0}</dd></div>
        <div><dt>Practice sessions</dt><dd>{piece.practice_sessions ?? 0}</dd></div>
        <div><dt>Earned maturity</dt><dd>{maturityPercent(piece)}%</dd></div>
        <div><dt>Quality tint</dt><dd>{brightnessPercent(piece.quality_brightness)} · not a grade</dd></div>
        <div><dt>Last practiced</dt><dd>{formatDate(piece.last_practiced)}</dd></div>
      </dl>
      <p className="universe-card-rule">Radius source: focused time only.</p>
      <div className="universe-card-actions">
        <button type="button" onClick={onInspect} aria-pressed={selected}>Inspect system</button>
        <button type="button" onClick={onOpen} aria-label={`Open ${piece.title} in Atlas`}>
          Open Atlas
        </button>
      </div>
      {piece.region_signals.length > 0 ? (
        <details className="universe-region-details">
          <summary>All targets <span>{piece.region_signals.length}</span></summary>
          <ul>
            {piece.region_signals.map((region) => (
              <li key={region.region_id}>
                <div><strong>{region.name}</strong><span>{region.kind}</span></div>
                <p>{region.practiced ? `${formatDuration(region.focused_seconds)} · ${region.active_days_28} active ${region.active_days_28 === 1 ? "day" : "days"}${region.revisited ? " · revisited" : ""}${(region.mastery_contracts_completed ?? 0) > 0 ? " · mastery verified" : ""}${region.recovered ? " · honestly recovered" : ""}` : "No recorded work yet"}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : <p className="universe-no-regions">No targets defined yet.</p>}
    </article>
  );
}

export { layoutUniversePieces, starPosition, starRadius };
