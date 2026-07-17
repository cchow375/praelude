import { useMemo } from "react";
import type {
  PracticePieceContext,
  RegionSignal,
  UniversePiece,
  UniverseSnapshot,
} from "../types";
import { formatDate, formatDuration } from "./format";
import { paletteAt } from "./palettes";
import type { GraphNode } from "./simulation";

export interface DetailPanelProps {
  node: GraphNode;
  snapshot: UniverseSnapshot;
  onClose: () => void;
  onOpenScore: (piece: PracticePieceContext) => void;
  onOpenLedger?: (piece: PracticePieceContext) => void;
  onExpandCluster?: (clusterId: string) => void;
}

function maturityPercent(piece: UniversePiece): number {
  return Math.round(Math.max(0, Math.min(1, piece.earned_maturity ?? 0)) * 100);
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
 * The Universe detail panel. What it shows is bounded by the snapshot contract:
 * pieces/regions carry focused time, active days, coverage, mastery/recovery
 * counts, and rated/clean rep totals — but NOT per-session rows, streaks, or
 * tempo paths, so those are never invented here. A satellite is one recorded
 * session; the snapshot aggregates them, so a satellite shows its region's
 * context rather than a fabricated per-session story.
 */
export function DetailPanel({
  node,
  snapshot,
  onClose,
  onOpenScore,
  onOpenLedger,
  onExpandCluster,
}: DetailPanelProps) {
  const piece = useMemo(
    () => snapshot.pieces.find((p) => p.piece_id === node.pieceRefId) ?? null,
    [snapshot, node.pieceRefId],
  );
  const region: RegionSignal | null = useMemo(() => {
    if (node.regionRefId == null || !piece) return null;
    return (
      piece.region_signals.find((r) => r.region_id === node.regionRefId) ?? null
    );
  }, [piece, node.regionRefId]);

  const palette = paletteAt(node.paletteIndex);
  const jumpContext: PracticePieceContext | null = piece
    ? { piece_id: piece.piece_id, title: piece.title }
    : null;

  const kindLabel =
    node.kind === "sun"
      ? "Piece"
      : node.kind === "planet"
        ? "Region"
        : node.kind === "cluster"
          ? "Session cluster"
          : "Practice session";

  return (
    <aside
      className="universe-detail"
      role="complementary"
      aria-label={node.label}
      data-node-kind={node.kind}
    >
      <header className="universe-detail-head">
        <span
          className="universe-detail-swatch"
          style={{ background: palette.body }}
          aria-hidden="true"
        />
        <div>
          <p className="universe-detail-kicker">{kindLabel}</p>
          <h3>{node.label}</h3>
          {node.kind === "sun" && piece?.composer && (
            <span className="universe-detail-sub">{piece.composer}</span>
          )}
          {node.kind !== "sun" && piece && (
            <span className="universe-detail-sub">{piece.title}</span>
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

      {node.kind === "sun" && piece && (
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
            label="Earned maturity"
            value={`${maturityPercent(piece)}%`}
          />
          <Metric
            label="Last practiced"
            value={formatDate(piece.last_practiced)}
          />
        </dl>
      )}

      {node.kind === "planet" && region && (
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
            {region.revisited ? "Revisited on distinct dates. " : ""}
            {region.recovered ? "Honestly recovered. " : ""}
            Streak and tempo-path detail live in the Ledger, not the snapshot.
          </p>
        </>
      )}

      {node.kind === "satellite" && (
        <p className="universe-detail-note">
          One recorded practice session
          {region ? ` on ${region.name}` : ""}
          {piece ? ` in ${piece.title}` : ""}. The Universe snapshot aggregates
          sessions as counts, so the full story of this session lives in the
          Ledger.
        </p>
      )}

      {node.kind === "cluster" && (
        <>
          <p className="universe-detail-note">
            {node.aggregated} older sessions
            {region ? ` on ${region.name}` : ""}, collapsed to keep the sky
            legible.
          </p>
          {onExpandCluster && (
            <button
              type="button"
              className="universe-detail-action is-primary"
              onClick={() => onExpandCluster(node.id)}
            >
              Expand sessions
            </button>
          )}
        </>
      )}

      {node.kind !== "cluster" && jumpContext && (
        <div className="universe-detail-actions">
          <button
            type="button"
            className="universe-detail-action is-primary"
            onClick={() => onOpenScore(jumpContext)}
          >
            Open on score
          </button>
          {onOpenLedger && (
            <button
              type="button"
              className="universe-detail-action"
              onClick={() => onOpenLedger(jumpContext)}
            >
              Open in Ledger
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
