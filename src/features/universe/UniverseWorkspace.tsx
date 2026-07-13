import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { universeSnapshot } from "./api";
import type {
  PracticePieceContext,
  UniversePiece,
  UniverseSnapshot,
} from "./types";
import "./UniverseWorkspace.css";

interface UniverseWorkspaceProps {
  onOpenPractice: (piece: PracticePieceContext | null) => void;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "The Practice Universe could not be loaded.";
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
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

function starRadius(seconds: number): number {
  // Time is allowed to grow without letting one long-running piece swallow the map.
  return Math.max(12, Math.min(31, 12 + Math.sqrt(Math.max(0, seconds) / 180)));
}

function starPosition(index: number, count: number): { x: number; y: number } {
  if (count <= 1) return { x: 500, y: 245 };
  const angle = index * 2.399963229728653 - Math.PI / 2;
  const progress = Math.sqrt((index + 0.65) / count);
  const radius = 72 + progress * 330;
  return {
    x: 500 + Math.cos(angle) * radius,
    y: 255 + Math.sin(angle) * radius * 0.48,
  };
}

export function UniverseWorkspace({ onOpenPractice }: UniverseWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<UniverseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const starRefs = useRef<Array<SVGGElement | null>>([]);

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

  const pieces = snapshot?.pieces ?? [];
  const positions = useMemo(
    () => pieces.map((_, index) => starPosition(index, pieces.length)),
    [pieces],
  );

  const openPiece = useCallback(async (piece: UniversePiece) => {
    setOpeningId(piece.piece_id);
    setError(null);
    try {
      await invoke("piece_select", { id: piece.piece_id });
      onOpenPractice({ piece_id: piece.piece_id, title: piece.title });
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setOpeningId(null);
    }
  }, [onOpenPractice]);

  const moveStarFocus = (current: number, direction: number) => {
    if (pieces.length < 2) return;
    const next = (current + direction + pieces.length) % pieces.length;
    starRefs.current[next]?.focus();
  };

  return (
    <main className="universe-workspace" data-testid="universe-workspace" id="panel-home" role="tabpanel" aria-labelledby="tab-home">
      <header className="universe-intro">
        <div>
          <p className="universe-eyebrow">Home</p>
          <h1>Practice Universe</h1>
          <p className="universe-lede">
            A quiet map of work already done. Size shows focused time; nothing here grades you.
          </p>
        </div>
        <button type="button" className="universe-practice-button" onClick={() => onOpenPractice(null)}>
          Open Practice
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
          <span className="universe-loading-mark" aria-hidden="true" />
          <p>Mapping your practice…</p>
        </div>
      ) : snapshot && pieces.length === 0 ? (
        <section className="universe-state universe-empty" aria-labelledby="universe-empty-title">
          <span className="universe-empty-star" aria-hidden="true" />
          <h2 id="universe-empty-title">Your universe is quiet for now.</h2>
          <p>Import a piece and begin a session. Recorded practice will appear here without streak pressure.</p>
          <button type="button" className="universe-practice-button" onClick={() => onOpenPractice(null)}>
            Go to Practice
          </button>
        </section>
      ) : snapshot ? (
        <>
          <section className="universe-totals" aria-label="Practice overview">
            <SummaryValue label="Focused time" value={formatDuration(snapshot.totals.focused_seconds)} />
            <SummaryValue label="Active days · last 28" value={String(snapshot.totals.active_days_28)} />
            <SummaryValue label="Regions practiced" value={String(snapshot.totals.regions_practiced)} />
            <SummaryValue label="Regions revisited" value={String(snapshot.totals.regions_revisited)} />
          </section>

          <section className="universe-map-section" aria-labelledby="universe-map-title">
            <div className="universe-section-heading">
              <div>
                <p className="universe-section-kicker">All pieces</p>
                <h2 id="universe-map-title">Your working constellation</h2>
              </div>
              <p>Choose a star to select that piece and continue in Practice.</p>
            </div>
            <svg className="universe-map" viewBox="0 0 1000 520" role="group" aria-labelledby="universe-svg-title universe-svg-description">
              <title id="universe-svg-title">Practice pieces shown as stars</title>
              <desc id="universe-svg-description">
                Star size represents focused time. Orbit rings represent active days in the last 28 days. Small planets represent Regions with recorded work, and a halo marks revisited Regions. The text list after this graphic provides the same information.
              </desc>
              <defs>
                <radialGradient id="universe-star-fill">
                  <stop offset="0" stopColor="var(--universe-star-core)" />
                  <stop offset="0.58" stopColor="var(--accent)" />
                  <stop offset="1" stopColor="var(--universe-star-edge)" />
                </radialGradient>
              </defs>
              {pieces.map((piece, index) => {
                const { x, y } = positions[index];
                const radius = starRadius(piece.focused_seconds);
                const practiced = piece.region_signals.filter((region) => region.practiced);
                const activeDays = Math.max(0, Math.min(28, piece.active_days_28));
                const brightness = Math.max(0.92, Math.min(1, piece.quality_brightness));
                return (
                  <g
                    key={piece.piece_id}
                    ref={(node) => { starRefs.current[index] = node; }}
                    className="universe-star-target"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${piece.title}${piece.composer ? ` by ${piece.composer}` : ""} in Practice. ${formatDuration(piece.focused_seconds)} focused time, ${piece.active_days_28} active days in the last 28, ${piece.regions_practiced} of ${piece.regions_total} Regions practiced, ${piece.regions_revisited} revisited, ${brightnessPercent(piece.quality_brightness)} visual brightness tint, not a grade.`}
                    onClick={() => void openPiece(piece)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void openPiece(piece);
                      } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                        event.preventDefault();
                        moveStarFocus(index, 1);
                      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                        event.preventDefault();
                        moveStarFocus(index, -1);
                      }
                    }}
                  >
                    {activeDays > 0 && (
                      <circle
                        className="universe-orbit"
                        cx={x}
                        cy={y}
                        r={radius + 13}
                        fill="none"
                        pathLength="28"
                        strokeDasharray={`${activeDays} ${28 - activeDays}`}
                      />
                    )}
                    <circle className="universe-star-glow" cx={x} cy={y} r={radius + 10} opacity={brightness * 0.22} />
                    <circle className="universe-star" data-testid={`universe-star-${piece.piece_id}`} cx={x} cy={y} r={radius} opacity={brightness} fill="url(#universe-star-fill)" />
                    {practiced.map((region, planetIndex) => {
                      const ring = Math.floor(planetIndex / 12);
                      const ringStart = ring * 12;
                      const ringCount = Math.min(12, practiced.length - ringStart);
                      const angle = ((planetIndex - ringStart) / ringCount) * Math.PI * 2 - Math.PI / 2;
                      const distance = radius + 27 + ring * 9;
                      const px = x + Math.cos(angle) * distance;
                      const py = y + Math.sin(angle) * distance;
                      return (
                        <g key={region.region_id} aria-hidden="true">
                          {region.revisited && <circle className="universe-planet-halo" cx={px} cy={py} r="5.5" />}
                          <circle className="universe-planet" cx={px} cy={py} r="2.7" />
                        </g>
                      );
                    })}
                    <text className="universe-star-label" x={x} y={y + radius + 22} textAnchor="middle">
                      {piece.title.length > 24 ? `${piece.title.slice(0, 23)}…` : piece.title}
                    </text>
                  </g>
                );
              })}
            </svg>
          </section>

          <section className="universe-piece-section" aria-labelledby="universe-pieces-title">
            <div className="universe-section-heading">
              <div>
                <p className="universe-section-kicker">Text view</p>
                <h2 id="universe-pieces-title">Piece and Region signals</h2>
              </div>
              <p>Every signal in the map is repeated here.</p>
            </div>
            <div className="universe-piece-list">
              {pieces.map((piece) => (
                <PieceSignals key={piece.piece_id} piece={piece} opening={openingId === piece.piece_id} onOpen={() => void openPiece(piece)} />
              ))}
            </div>
          </section>

          <section className="universe-definitions" aria-labelledby="universe-definitions-title">
            <p className="universe-section-kicker">How to read this</p>
            <h2 id="universe-definitions-title">Signal definitions</h2>
            <dl>
              {snapshot.definitions.map((definition) => (
                <div key={definition.signal}>
                  <dt>{definition.label}</dt>
                  <dd>{definition.definition}</dd>
                </div>
              ))}
            </dl>
            <p className="universe-source-note">
              Window: {snapshot.traces.active_window_start} through {snapshot.traces.active_window_end}. Source: {snapshot.traces.source}.
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

function PieceSignals({ piece, opening, onOpen }: { piece: UniversePiece; opening: boolean; onOpen: () => void }) {
  return (
    <article className="universe-piece-card">
      <header>
        <div>
          <h3>{piece.title}</h3>
          {piece.composer && <p>{piece.composer}</p>}
        </div>
        <button type="button" onClick={onOpen} disabled={opening} aria-label={`Open ${piece.title} in Practice`}>
          {opening ? "Opening…" : "Open in Practice"}
        </button>
      </header>
      <dl className="universe-piece-metrics">
        <div><dt>Focused time</dt><dd>{formatDuration(piece.focused_seconds)}</dd></div>
        <div><dt>Active days · 28</dt><dd>{piece.active_days_28}</dd></div>
        <div><dt>Regions practiced</dt><dd>{piece.regions_practiced} of {piece.regions_total}</dd></div>
        <div><dt>Regions revisited</dt><dd>{piece.regions_revisited}</dd></div>
        <div><dt>Visual brightness</dt><dd>{brightnessPercent(piece.quality_brightness)} tint · not a grade</dd></div>
        <div><dt>Last practiced</dt><dd>{formatDate(piece.last_practiced)}</dd></div>
      </dl>
      {piece.region_signals.length > 0 ? (
        <details className="universe-region-details">
          <summary>Regions <span>{piece.region_signals.length}</span></summary>
          <ul>
            {piece.region_signals.map((region) => (
              <li key={region.region_id}>
                <div>
                  <strong>{region.name}</strong>
                  <span>{region.kind}</span>
                </div>
                <p>
                  {region.practiced
                    ? `${formatDuration(region.focused_seconds)} · ${region.active_days_28} active ${region.active_days_28 === 1 ? "day" : "days"}${region.revisited ? " · revisited" : ""}`
                    : "No recorded work yet"}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="universe-no-regions">No Regions defined yet.</p>
      )}
    </article>
  );
}

export { formatDuration, starPosition, starRadius };

function brightnessPercent(value: number) {
  return `${Math.round(Math.max(0.92, Math.min(1, value)) * 100)}%`;
}
