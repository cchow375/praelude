import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { universeSnapshot } from "./api";
import { DetailPanel } from "./DetailPanel";
import { formatDuration, formatSince } from "./format";
import {
  fnv1a32,
  galaxyLayout,
  GLOW_RADIUS_GAP,
  ORBIT_BODY_RADIUS,
  type GalaxyLayout,
} from "./galaxy";
import {
  attentionList,
  blockState,
  BLOCK_STATE_LABEL,
  groupByComposer,
  pieceAttention,
  selectionExists,
  type Attention,
  type ComposerGroup,
  type Selection,
} from "./repertoire";
import type {
  PracticePieceContext,
  UniversePiece,
  UniverseSnapshot,
} from "./types";
import "./universe.css";

interface UniverseWorkspaceProps {
  /** Jump to the Score/Atlas workspace (null = open Atlas with no piece). */
  onOpenPractice: (piece: PracticePieceContext | null) => void;
  /** Optional jump to the History workspace for a piece. */
  onOpenLedger?: (piece: PracticePieceContext) => void;
  /**
   * A2's day-streak read model. The ONLY thing it may change is whether stars
   * glow; it can never add, move or resize one. Null = no streak known yet,
   * which renders un-glowed rather than optimistically lit.
   */
  streak?: { current_days: number } | null;
}

/** The galaxy is laid out for the dense floor and scaled by the SVG viewBox. */
const GALAXY_VIEWPORT = { width: 720, height: 520 };

/** How many pieces the "Wants work" band names before it summarises the rest. */
const ATTENTION_BAND_LIMIT = 6;

/**
 * A couple of earned systems can look like a failed render when the rest of
 * the repertoire is deliberately hollow. Teach that earned-only rule while
 * it is useful, then get out of the way once the map has enough evidence to
 * explain itself.
 */
const SPARSE_EARNED_SYSTEM_LIMIT = 2;

interface EarnedGuide {
  title: string;
  body: string;
}

function earnedGuideFor(galaxy: GalaxyLayout | null): EarnedGuide | null {
  if (!galaxy || galaxy.stars.length === 0) return null;

  const earnedSystems = galaxy.stars.filter((star) => star.earned).length;
  if (earnedSystems === 0) {
    return {
      title: "Nothing is missing.",
      body: "Hollow marks are pieces on the shelf. Filled stars and rings appear only as real focused practice is recorded.",
    };
  }
  if (earnedSystems <= SPARSE_EARNED_SYSTEM_LIMIT) {
    return {
      title: "Your universe is taking shape.",
      body: "Filled stars and rings grow only from recorded focused practice. This view stays deliberately sparse until that evidence exists.",
    };
  }
  return null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string"
    ? error
    : "The Practice Universe could not be loaded.";
}

/**
 * The Practice Universe — an earned-only living galaxy.
 *
 * This screen used to be a live d3-force galaxy: drifting bodies, a
 * requestAnimationFrame tick loop, pan/zoom and eight glowing palettes. v5
 * removed all of that and left a still index on paper. v7 A1 brings motion
 * back, but only as a pure function of recorded practice evidence: every
 * piece renders as a star system whose size, brightness, growth ring and
 * orbiting bodies are computed once by `galaxyLayout` (a pure, deterministic
 * function of the snapshot) and animated only by CSS `@keyframes` in
 * universe.css. There is still no simulation, no requestAnimationFrame loop
 * and no per-frame JS of any kind — the property that killed the v5 galaxy
 * stays dead. The composer index below the galaxy is unchanged: it is still
 * the place you can learn a piece's name, not just look at its star.
 */
export function UniverseWorkspace({
  onOpenPractice,
  onOpenLedger,
  streak = null,
}: UniverseWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<UniverseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await universeSnapshot();
      setSnapshot(next);
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
  /** Every "how long ago" on this screen is measured from the snapshot stamp,
   *  never the wall clock, so one snapshot always renders identically. */
  const reference = snapshot?.generated_at ?? null;

  const groups = useMemo(() => groupByComposer(pieces), [pieces]);
  const attention = useMemo(
    () => attentionList(pieces, reference),
    [pieces, reference],
  );
  // A triage line, not a second index: past a handful of names the band stops
  // being scannable and starts being the wall of text it is meant to prevent.
  // Nothing is hidden — every one of these pieces carries its own mark below.
  const shownAttention = attention.slice(0, ATTENTION_BAND_LIMIT);
  const hiddenAttention = attention.length - shownAttention.length;

  // A reload that drops the selected piece must not leave a stale panel open.
  const liveSelection = selectionExists(snapshot, selection) ? selection : null;

  const openScore = useCallback(
    (piece: PracticePieceContext) => onOpenPractice(piece),
    [onOpenPractice],
  );

  const galaxy = useMemo<GalaxyLayout | null>(
    () => (snapshot ? galaxyLayout(snapshot, GALAXY_VIEWPORT, streak ?? null) : null),
    [snapshot, streak],
  );
  const earnedGuide = useMemo(() => earnedGuideFor(galaxy), [galaxy]);

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
          Open score map
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
        <p className="universe-state" role="status" aria-live="polite">
          Reading your practice record…
        </p>
      ) : snapshot && pieces.length === 0 ? (
        <section
          className="universe-state universe-empty"
          aria-labelledby="universe-empty-title"
        >
          <h2 id="universe-empty-title">Your universe is quiet for now.</h2>
          <p>
            Import a piece and begin a focused session. Filled stars and rings
            appear only from recorded practice; this view never fills itself in
            for show.
          </p>
          <button
            type="button"
            className="universe-atlas-cta"
            onClick={() => onOpenPractice(null)}
          >
            Open score map
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

          {earnedGuide && (
            <aside
              className="universe-earned-guide"
              aria-label="How the Universe grows"
              data-testid="universe-earned-guide"
            >
              <strong>{earnedGuide.title}</strong>
              <p>{earnedGuide.body}</p>
            </aside>
          )}

          {attention.length > 0 && (
            <section
              className="universe-attention"
              aria-labelledby="universe-attention-title"
              data-testid="universe-wants-work"
            >
              <h2 id="universe-attention-title" className="universe-band-title">
                Wants work
              </h2>
              <ul>
                {shownAttention.map((entry) => (
                  <li key={entry.piece.piece_id}>
                    <button
                      type="button"
                      className="universe-attention-chip"
                      data-attention={entry.attention.kind}
                      onClick={() =>
                        setSelection({
                          kind: "piece",
                          pieceId: entry.piece.piece_id,
                        })
                      }
                    >
                      <span className="universe-attention-name">
                        {entry.piece.title}
                      </span>
                      <span className="universe-attention-reason">
                        {entry.attention.label}
                      </span>
                    </button>
                  </li>
                ))}
                {hiddenAttention > 0 && (
                  <li className="universe-attention-rest">
                    and {hiddenAttention} more, marked in the index below
                  </li>
                )}
              </ul>
            </section>
          )}

          <section
            className="universe-map"
            aria-labelledby="universe-map-title"
          >
            <div className="universe-map-heading">
              <div>
                <p className="universe-section-kicker">
                  {pieces.length === 1 ? "1 piece" : `${pieces.length} pieces`}{" "}
                  · one mark per region
                </p>
                <h2 id="universe-map-title">Your repertoire</h2>
              </div>
              <BlockLegend />
            </div>

            <div className="universe-map-and-detail">
              {galaxy && galaxy.stars.length > 0 && (
                <svg
                  className="universe-galaxy"
                  data-testid="universe-galaxy"
                  viewBox={`0 0 ${GALAXY_VIEWPORT.width} ${galaxyHeight(galaxy)}`}
                  role="img"
                  aria-label={`${galaxy.stars.length} pieces as star systems`}
                >
                  {/* One parallax layer: a still field of tick marks derived from the star
                      grid itself, drifting a few pixels. It carries no data — it is the
                      page, not a signal — which is why it has no data-evidence attribute
                      and no piece/region id. */}
                  <g className="universe-galaxy-field" aria-hidden="true">
                    {galaxy.stars.map((star) => (
                      <circle
                        key={`field-${star.piece_id}`}
                        cx={star.cx + 46}
                        cy={star.cy - 38}
                        r={1}
                      />
                    ))}
                  </g>
                  {galaxy.stars.map((star) => (
                    <g
                      key={star.piece_id}
                      className={
                        star.earned ? "universe-star" : "universe-star is-unlit"
                      }
                      data-piece-id={star.piece_id}
                      data-evidence={star.evidence}
                      style={
                        {
                          "--star-brightness": star.brightness,
                          "--star-phase": `${fnv1a32(`piece:${star.piece_id}`) % 4000}ms`,
                        } as CSSProperties
                      }
                    >
                      {/* The click target renders FIRST and every decorative element
                          after it gets pointer-events:none (universe.css), so hover/
                          focus always lands on this hit circle regardless of what
                          draws on top of it — fix-wave U1. It is a real <circle> with
                          a title, not a bare <g>: SVG hit areas need geometry, and the
                          composer index below still carries the accessible <button>
                          for every piece. */}
                      <circle
                        className="universe-star-hit"
                        cx={star.cx}
                        cy={star.cy}
                        r={Math.max(star.radius + 10, 18)}
                        onClick={() => setSelection({ kind: "piece", pieceId: star.piece_id })}
                      >
                        <title>{star.title}</title>
                      </circle>
                      {star.earned ? (
                        <>
                          {star.glow && (
                            <circle
                              className="universe-star-glow"
                              data-evidence="streak.current_days"
                              cx={star.cx}
                              cy={star.cy}
                              r={star.radius + GLOW_RADIUS_GAP}
                            />
                          )}
                          {star.ring > 0 && (
                            <circle
                              className="universe-star-ring"
                              data-evidence="earned_maturity"
                              cx={star.cx}
                              cy={star.cy}
                              r={star.radius + 3}
                              style={{ strokeWidth: 1 + 3 * star.ring }}
                            />
                          )}
                          <circle
                            className="universe-star-disc"
                            cx={star.cx}
                            cy={star.cy}
                            r={star.radius}
                          />
                          {star.orbits.map((orbit) => (
                            <g
                              key={orbit.region_id}
                              className="universe-orbit"
                              style={
                                {
                                  "--orbit-period": `${orbit.period}s`,
                                  "--orbit-phase": `${orbit.phase}deg`,
                                  transformOrigin: `${star.cx}px ${star.cy}px`,
                                } as CSSProperties
                              }
                            >
                              <circle
                                className="universe-orbit-body"
                                data-region-id={orbit.region_id}
                                data-evidence="mastery_contracts_completed"
                                cx={star.cx + orbit.radius}
                                cy={star.cy}
                                r={ORBIT_BODY_RADIUS}
                              />
                            </g>
                          ))}
                        </>
                      ) : (
                        /* Earned-only law (fix-wave F1): zero practice evidence gets
                           no star — not even a dim one. A hollow, non-animated marker
                           keeps the piece discoverable without granting it unearned
                           growth (no fill, no twinkle, no glow, no ring, no orbits). */
                        <circle
                          className="universe-star-unlit"
                          data-evidence="none"
                          aria-label="not yet practised"
                          cx={star.cx}
                          cy={star.cy}
                          r={star.radius}
                        />
                      )}
                    </g>
                  ))}
                </svg>
              )}
              <div className="universe-index">
                {groups.map((group) => (
                  <ComposerSection
                    key={group.key}
                    group={group}
                    reference={reference}
                    selectedPieceId={liveSelection?.pieceId ?? null}
                    onSelectPiece={(pieceId) =>
                      setSelection({ kind: "piece", pieceId })
                    }
                  />
                ))}
              </div>

              <DetailPanel
                selection={liveSelection}
                snapshot={snapshot}
                reference={reference}
                onClose={() => setSelection(null)}
                onSelect={setSelection}
                onOpenScore={openScore}
                onOpenLedger={onOpenLedger}
              />
            </div>
          </section>

          <details className="universe-method">
            <summary>How these numbers are earned</summary>
            <dl>
              {snapshot.definitions.map((definition) => (
                <div key={definition.signal}>
                  <dt>{definition.label}</dt>
                  <dd>{definition.definition}</dd>
                </div>
              ))}
            </dl>
            <p>
              Drawn from {snapshot.traces.source}, over{" "}
              {snapshot.traces.active_window_start} to{" "}
              {snapshot.traces.active_window_end}. Idle time beyond{" "}
              {snapshot.traces.idle_threshold_seconds} seconds is not counted as
              focus.
            </p>
          </details>
        </>
      ) : null}
    </main>
  );
}

/** Tall enough for the last row of stars, so nothing is clipped. */
function galaxyHeight(galaxy: GalaxyLayout): number {
  const lowest = galaxy.stars.reduce(
    (max, star) => Math.max(max, star.cy + star.radius + 24),
    0,
  );
  return Math.max(galaxy.viewport.height, lowest);
}

function ComposerSection({
  group,
  reference,
  selectedPieceId,
  onSelectPiece,
}: {
  group: ComposerGroup;
  reference: string | null;
  selectedPieceId: number | null;
  onSelectPiece: (pieceId: number) => void;
}) {
  const titleId = `universe-composer-${group.key}`;
  return (
    <section className="universe-group" aria-labelledby={titleId}>
      <h3 className="universe-group-name" id={titleId}>
        {group.composer}
      </h3>
      <ul className="universe-cards">
        {group.pieces.map((piece) => (
          <li key={piece.piece_id}>
            <PieceCard
              piece={piece}
              reference={reference}
              selected={piece.piece_id === selectedPieceId}
              onSelect={() => onSelectPiece(piece.piece_id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PieceCard({
  piece,
  reference,
  selected,
  onSelect,
}: {
  piece: UniversePiece;
  reference: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const attention: Attention | null = pieceAttention(piece, reference);
  return (
    <button
      type="button"
      className="universe-card"
      data-testid={`universe-piece-${piece.piece_id}`}
      data-piece-id={piece.piece_id}
      data-attention={attention?.kind ?? "none"}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="universe-card-title">{piece.title}</span>

      <span className="universe-blocks" aria-hidden="true">
        {piece.region_signals.map((signal) => (
          <span
            key={signal.region_id}
            className="universe-block"
            data-state={blockState(signal)}
          />
        ))}
      </span>

      <span className="universe-card-line">
        {piece.regions_practiced} / {piece.regions_total} regions practiced ·{" "}
        {piece.mastered_targets ?? 0} verified
      </span>
      <span className="universe-card-line is-quiet">
        {formatDuration(piece.focused_seconds)} focused ·{" "}
        {piece.practice_sessions ?? 0} sessions
      </span>
      <span className="universe-card-when">
        {formatSince(piece.last_practiced, reference)}
        {attention?.kind === "recovering" ? ` · ${attention.label}` : ""}
      </span>
    </button>
  );
}

/** Reads the five marks once, so a card never has to explain itself. */
function BlockLegend() {
  return (
    <ul className="universe-legend" aria-label="What a region mark means">
      {(
        [
          "untouched",
          "practiced",
          "revisited",
          "mastered",
          "recovering",
        ] as const
      ).map((state) => (
        <li key={state}>
          <span
            className="universe-block"
            data-state={state}
            aria-hidden="true"
          />
          {BLOCK_STATE_LABEL[state]}
        </li>
      ))}
    </ul>
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
