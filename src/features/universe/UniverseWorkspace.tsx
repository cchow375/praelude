import { useCallback, useEffect, useMemo, useState } from "react";
import { universeSnapshot } from "./api";
import { DetailPanel } from "./DetailPanel";
import { formatDuration, formatSince } from "./format";
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
}

/** How many pieces the "Wants work" band names before it summarises the rest. */
const ATTENTION_BAND_LIMIT = 6;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string"
    ? error
    : "The Practice Universe could not be loaded.";
}

/**
 * The Practice Universe — a still map of the repertoire.
 *
 * This screen used to be a live d3-force galaxy: drifting bodies, a
 * requestAnimationFrame tick loop, pan/zoom and eight glowing palettes. It is
 * now a laid-out index on paper. Every piece is a card under its composer,
 * every region is one pencil mark on that card, and the order is derived only
 * from names and ids — so a piece keeps its place between visits and the marks,
 * not the layout, are what change when you practise.
 *
 * There is no animation of any kind here, ambient or otherwise: no simulation,
 * no rAF, no keyframes. Interaction gets a colour change and nothing more.
 */
export function UniverseWorkspace({
  onOpenPractice,
  onOpenLedger,
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
            Import a piece and begin a session. Only recorded practice evidence
            will appear here.
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
