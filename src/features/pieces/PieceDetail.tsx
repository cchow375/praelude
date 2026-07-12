import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Intake, PieceDetailData } from "./types";
import type { RepOpenArgs } from "../rep/useRep";
import { IntakeForm } from "./IntakeForm";
import { BlockForm } from "../rep/BlockForm";
import { EditableField } from "../../components/EditableField";
import { EditableNumber } from "../../components/EditableNumber";
import { useCrud } from "../rep/useCrud";
import { GoalsPanel } from "./GoalsPanel";
import { HistoryPanel } from "./HistoryPanel";

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
  const crud = useCrud();
  const [piece, setPiece] = useState<PieceDetailData>(initial);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setHistoryRevision((revision) => revision + 1);
      } finally {
        setOpening(false);
      }
    },
    [onOpenBlock],
  );

  const updatePieceField = useCallback(
    async (
      patch: Partial<Pick<PieceDetailData, "current_state" | "deadline" | "target_tempo" | "notes">>,
    ) => {
      await crud.pieceFieldUpdate(piece.id, patch);
      const updated = { ...piece, ...patch };
      setPiece(updated);
      onUpdated?.(updated);
    },
    [crud, onUpdated, piece],
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
          <PieceSummary piece={piece} onUpdate={updatePieceField} />
          <GoalsPanel pieceId={piece.id} />
          <HistoryPanel pieceId={piece.id} refreshToken={historyRevision} />
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

function PieceSummary({
  piece,
  onUpdate,
}: {
  piece: PieceDetailData;
  onUpdate: (
    patch: Partial<Pick<PieceDetailData, "current_state" | "deadline" | "target_tempo" | "notes">>,
  ) => Promise<void>;
}) {
  return (
    <div className="piece-summary">
      <div className="piece-summary-block piece-summary-lead">
        <span className="ck-label">Where I am</span>
        <EditableField
          value={piece.current_state ?? ""}
          placeholder="Double-click to add your current state"
          ariaLabel="current state"
          onSave={(current_state) => onUpdate({ current_state: current_state || null })}
        />
      </div>
      <div className="piece-summary-facts">
        <div className="piece-fact">
          <span className="ck-label">Deadline</span>
          <EditableField value={piece.deadline ?? ""} placeholder="None" ariaLabel="deadline" onSave={(deadline) => onUpdate({ deadline: deadline || null })} />
        </div>
        <div className="piece-fact">
          <span className="ck-label">Target tempo</span>
          <span>♩ = <EditableNumber value={piece.target_tempo} min={1} allowNull ariaLabel="target tempo" onSave={(target_tempo) => onUpdate({ target_tempo })} /></span>
        </div>
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
      <div className="piece-summary-block">
        <span className="ck-label">Notes</span>
        <EditableField value={piece.notes ?? ""} placeholder="Double-click to add notes" ariaLabel="piece notes" onSave={(notes) => onUpdate({ notes: notes || null })} />
      </div>
    </div>
  );
}
