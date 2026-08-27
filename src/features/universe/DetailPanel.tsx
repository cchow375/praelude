import { HISTORY } from "../../shell/terms";
import { formatDate, formatDuration, formatSince } from "./format";
import {
  BLOCK_STATE_LABEL,
  blockState,
  findPiece,
  findRegion,
  type Selection,
} from "./repertoire";
import type {
  PracticePieceContext,
  RegionSignal,
  UniverseSnapshot,
} from "./types";

export interface DetailPanelProps {
  /** What the map has selected; null shows the resting prompt. */
  selection: Selection | null;
  snapshot: UniverseSnapshot;
  /** The snapshot stamp every "how long ago" on this panel is measured from. */
  reference: string | null | undefined;
  onClose: () => void;
  /** Drill into a region, or step back up to its piece. */
  onSelect: (selection: Selection) => void;
  onOpenScore: (piece: PracticePieceContext) => void;
  onOpenLedger?: (piece: PracticePieceContext) => void;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="universe-detail-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * The Universe detail panel — the record behind one card on the map.
 *
 * What it shows is bounded by the snapshot contract: pieces/regions carry
 * focused time, active days, coverage, mastery/recovery counts and rated/clean
 * rep totals, but NOT per-session rows, streaks or tempo paths, so those are
 * never invented here. Practice sessions appear as the count the snapshot
 * actually holds.
 *
 * The panel is always mounted, so selecting a piece never reflows the map beside
 * it; with nothing selected it shows a resting prompt.
 */
export function DetailPanel({
  selection,
  snapshot,
  reference,
  onClose,
  onSelect,
  onOpenScore,
  onOpenLedger,
}: DetailPanelProps) {
  const piece = selection ? findPiece(snapshot, selection.pieceId) : null;
  const region: RegionSignal | null =
    selection?.kind === "block" ? findRegion(piece, selection.regionId) : null;

  if (!selection || !piece || (selection.kind === "block" && !region)) {
    return (
      <aside
        className="universe-detail is-resting"
        aria-label="Practice record"
        data-testid="universe-detail"
      >
        <p className="universe-detail-note">
          Choose a piece to read its practice record.
        </p>
      </aside>
    );
  }

  const jumpContext: PracticePieceContext = {
    piece_id: piece.piece_id,
    title: piece.title,
  };
  const heading = region ? region.name : piece.title;

  return (
    <aside
      className="universe-detail"
      aria-label={heading}
      data-node-kind={region ? "region" : "piece"}
      data-testid="universe-detail"
    >
      <header className="universe-detail-head">
        <div>
          <p className="universe-detail-kicker">
            {piece.archived_at != null
              ? region
                ? "Archived target"
                : "Archived piece"
              : region
                ? "Target"
                : "Piece"}
          </p>
          <h3>{heading}</h3>
          {region ? (
            <button
              type="button"
              className="universe-detail-up"
              onClick={() =>
                onSelect({ kind: "piece", pieceId: piece.piece_id })
              }
            >
              ← {piece.title}
            </button>
          ) : (
            piece.composer && (
              <span className="universe-detail-sub">{piece.composer}</span>
            )
          )}
        </div>
        <button
          type="button"
          className="universe-detail-close"
          onClick={onClose}
          aria-label="Close detail panel"
        >
          ×
        </button>
      </header>

      {!region && (
        <>
          {piece.archived_at != null && (
            <p className="universe-detail-note">
              Archived repertoire stays here as practice history. It is not an
              active practice suggestion.
            </p>
          )}
          <dl className="universe-detail-metrics">
            <Metric
              label="Focused time"
              value={formatDuration(piece.focused_seconds)}
            />
            <Metric
              label="Active days · 28"
              value={String(piece.active_days_28)}
            />
            <Metric
              label="Targets practiced"
              value={`${piece.regions_practiced} / ${piece.regions_total}`}
            />
            <Metric label="Revisited" value={String(piece.regions_revisited)} />
            <Metric
              label="Verified mastery"
              value={`${piece.mastered_targets ?? 0} / ${piece.regions_total}`}
            />
            <Metric
              label="Honestly recovered"
              value={String(piece.recovered_targets ?? 0)}
            />
            <Metric
              label="Practice sessions"
              value={String(piece.practice_sessions ?? 0)}
            />
            <Metric
              label="Open recovery"
              value={String(piece.open_recovery_debt ?? 0)}
            />
            <Metric
              label="Last practiced"
              value={formatDate(piece.last_practiced)}
            />
          </dl>

          <section
            className="universe-detail-regions"
            aria-labelledby="universe-detail-regions-title"
          >
            <h4 id="universe-detail-regions-title">
              Targets ({piece.region_signals.length})
            </h4>
            {piece.region_signals.length === 0 ? (
              <p className="universe-detail-note">
                No targets marked on this piece yet.
              </p>
            ) : (
              <ul>
                {piece.region_signals.map((signal) => {
                  const state = blockState(signal);
                  return (
                    <li key={signal.region_id}>
                      <button
                        type="button"
                        className="universe-detail-region"
                        data-state={state}
                        onClick={() =>
                          onSelect({
                            kind: "block",
                            pieceId: piece.piece_id,
                            regionId: signal.region_id,
                          })
                        }
                      >
                        <span
                          className="universe-block"
                          data-state={state}
                          aria-hidden="true"
                        />
                        <span className="universe-detail-region-name">
                          {signal.name}
                        </span>
                        <span className="universe-detail-region-state">
                          {BLOCK_STATE_LABEL[state]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {region && (
        <>
          <dl className="universe-detail-metrics">
            <Metric label="Reps" value={String(region.rated_rep_events)} />
            <Metric
              label="Clean reps"
              value={String(region.clean_rep_events)}
            />
            <Metric
              label="Focused time"
              value={formatDuration(region.focused_seconds)}
            />
            <Metric
              label="Active days · 28"
              value={String(region.active_days_28)}
            />
            <Metric
              label="Distinct dates"
              value={String(region.distinct_practice_dates)}
            />
            <Metric
              label="Verified mastery"
              value={String(region.mastery_contracts_completed ?? 0)}
            />
            <Metric
              label="Recovery resets"
              value={String(region.recovery_resets ?? 0)}
            />
            <Metric
              label="Practice sessions"
              value={String(region.practice_sessions ?? 0)}
            />
            <Metric
              label="Last practiced"
              value={formatDate(region.last_practiced)}
            />
          </dl>
          <p className="universe-detail-note">
            {formatSince(region.last_practiced, reference)}.{" "}
            {region.revisited ? "Revisited on distinct dates. " : ""}
            {region.recovered ? "Honestly recovered. " : ""}
            Streak and tempo-path detail live in {HISTORY}, not the snapshot.
          </p>
        </>
      )}

      <div className="universe-detail-actions">
        {piece.archived_at == null && (
          <button
            type="button"
            className="universe-detail-action is-primary"
            onClick={() => onOpenScore(jumpContext)}
          >
            Open on score
          </button>
        )}
        {onOpenLedger && (
          <button
            type="button"
            className="universe-detail-action"
            onClick={() => onOpenLedger(jumpContext)}
          >
            Open in {HISTORY}
          </button>
        )}
      </div>
    </aside>
  );
}
