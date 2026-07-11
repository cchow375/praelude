import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BlockHistory, Intake, PieceDetailData } from "./types";
import type { RepOpenArgs } from "../rep/useRep";
import { IntakeForm } from "./IntakeForm";
import { BlockForm } from "../rep/BlockForm";

// ---------------------------------------------------------------------------
// The detail surface for a selected piece. Before intake is done it shows the
// IntakeForm; afterwards a compact summary card, the block history, and the
// BlockForm to open a new drill. Intake persistence and block-history loading
// happen here; opening a block is delegated up to the shared rep hook so the
// RepHud (mounted at shell level) reflects it immediately.
// ---------------------------------------------------------------------------

interface PieceDetailProps {
  piece: PieceDetailData;
  onBack: () => void;
  onOpenBlock: (args: RepOpenArgs) => Promise<void>;
  /** Notifies the parent list when the piece record changes (badges/summary). */
  onUpdated?: (piece: PieceDetailData) => void;
}

function messageOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function PieceDetail({
  piece: initial,
  onBack,
  onOpenBlock,
  onUpdated,
}: PieceDetailProps) {
  const [piece, setPiece] = useState<PieceDetailData>(initial);
  const [blocks, setBlocks] = useState<BlockHistory[]>([]);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBlocks = useCallback(async (pieceId: number) => {
    try {
      const list = await invoke<BlockHistory[]>("rep_blocks_for_piece", {
        pieceId,
      });
      setBlocks(list ?? []);
    } catch {
      setBlocks([]);
    }
  }, []);

  useEffect(() => {
    if (piece.intake_done) void loadBlocks(piece.id);
  }, [piece.id, piece.intake_done, loadBlocks]);

  const saveIntake = useCallback(
    async (intake: Intake) => {
      setSaving(true);
      setError(null);
      try {
        const updated = await invoke<PieceDetailData>("piece_intake_save", {
          id: piece.id,
          intake,
        });
        if (updated) {
          setPiece(updated);
          onUpdated?.(updated);
        }
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setSaving(false);
      }
    },
    [piece.id, onUpdated],
  );

  const openBlock = useCallback(
    async (args: RepOpenArgs) => {
      setOpening(true);
      setError(null);
      try {
        await onOpenBlock(args);
        // Refresh history so the just-opened block appears.
        void loadBlocks(piece.id);
      } finally {
        setOpening(false);
      }
    },
    [onOpenBlock, loadBlocks, piece.id],
  );

  return (
    <section className="piece-detail" aria-label={`Piece: ${piece.title}`}>
      <div className="piece-detail-head">
        <button type="button" className="ck-back" onClick={onBack}>
          ← Pieces
        </button>
        <div className="piece-detail-titles">
          <h2 className="piece-detail-title">{piece.title}</h2>
          {piece.composer && (
            <p className="piece-detail-composer">{piece.composer}</p>
          )}
        </div>
      </div>

      {error && (
        <p className="ck-inline-error" role="alert">
          {error}
        </p>
      )}

      {!piece.intake_done ? (
        <IntakeForm piece={piece} onSave={saveIntake} saving={saving} />
      ) : (
        <>
          <PieceSummary piece={piece} />
          <BlockHistoryList blocks={blocks} />
          <BlockForm
            pieceId={piece.id}
            defaultTargetBpm={piece.target_tempo}
            onOpen={openBlock}
            opening={opening}
          />
        </>
      )}
    </section>
  );
}

function PieceSummary({ piece }: { piece: PieceDetailData }) {
  return (
    <div className="piece-summary">
      {piece.goals.length > 0 && (
        <div className="piece-summary-block">
          <span className="ck-label">Goals</span>
          <ul className="piece-goals">
            {piece.goals.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="piece-summary-facts">
        {piece.deadline && (
          <div className="piece-fact">
            <span className="ck-label">Deadline</span>
            <span>{piece.deadline}</span>
          </div>
        )}
        {piece.target_tempo != null && (
          <div className="piece-fact">
            <span className="ck-label">Target</span>
            <span>♩ = {piece.target_tempo}</span>
          </div>
        )}
      </div>
      {piece.hard_spots.length > 0 && (
        <div className="piece-summary-block">
          <span className="ck-label">Hard spots</span>
          <ul className="piece-hardspots">
            {piece.hard_spots.map((s, i) => (
              <li key={i}>
                <span className="piece-hardspot-mm">{s.measures}</span>
                {s.note && <span className="piece-hardspot-note">{s.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {piece.current_state && (
        <div className="piece-summary-block">
          <span className="ck-label">Where I am</span>
          <p className="piece-current-state">{piece.current_state}</p>
        </div>
      )}
    </div>
  );
}

function BlockHistoryList({ blocks }: { blocks: BlockHistory[] }) {
  return (
    <div className="block-history">
      <span className="ck-label">Block history</span>
      {blocks.length === 0 ? (
        <p className="block-history-empty">No blocks yet.</p>
      ) : (
        <ul className="block-history-list">
          {blocks.map((b) => (
            <li className="block-history-row" key={b.block_id}>
              <span className="block-history-mm">
                mm. {b.m_start}–{b.m_end}
                {b.label ? ` · ${b.label}` : ""}
              </span>
              <span className="block-history-tempo">
                ♩ {b.start_bpm}
                {b.bpm !== b.start_bpm ? `→${b.bpm}` : ""}
              </span>
              <span className="block-history-counts">
                <span className="verdict-tally is-clean">
                  {b.verdicts?.clean ?? 0}
                </span>
                <span className="verdict-tally is-flawed">
                  {b.verdicts?.flawed ?? 0}
                </span>
                <span className="verdict-tally is-failed">
                  {b.verdicts?.failed ?? 0}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
