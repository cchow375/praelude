import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Intake, PieceDetailData } from "./types";
import type { RepOpenArgs, RepSnapshot } from "../rep/useRep";
import { IntakeForm } from "./IntakeForm";
import { BlockForm } from "../rep/BlockForm";
import { EditableField } from "../../components/EditableField";
import { EditableNumber } from "../../components/EditableNumber";
import { useCrud } from "../rep/useCrud";
import { GoalsPanel } from "./GoalsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { ScoreView } from "../score/ScoreView";
import { ReferenceButtons } from "../references/ReferenceButtons";
import { TrickySectionsPanel } from "./RegionEditor";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import type { PracticeBrainContext } from "../brain/types";
import type { ScoreFocusContext } from "../score/types";

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
  activeRep?: RepSnapshot | null;
  /** Notifies the parent list when the piece record changes (badges/summary). */
  onUpdated?: (piece: PieceDetailData) => void;
  onPracticeContextChange?: (context: PracticeBrainContext | null) => void;
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
  activeRep = null,
  onUpdated,
  onPracticeContextChange,
}: PieceDetailProps) {
  const crud = useCrud();
  const [piece, setPiece] = useState<PieceDetailData>(initial);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [regionRevision, setRegionRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [surface, setSurface] = useState<"practice" | "score">(
    initial.has_pdf ? "score" : "practice",
  );

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
      } catch (cause) {
        // useRep publishes the application-level receipt. Keep this local
        // context too, and critically do not advance the history revision.
        setError(messageOf(cause));
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

  useEffect(() => {
    if (piece.intake_done && piece.has_pdf && surface === "score") return;
    onPracticeContextChange?.({
      piece_id: piece.id,
      piece_title: piece.title,
      composer: piece.composer,
      surface: "details",
      region: null,
      current_page: null,
      edition_id: null,
      edition_label: null,
    });
  }, [onPracticeContextChange, piece.composer, piece.has_pdf, piece.id, piece.intake_done, piece.title, surface]);

  const onScoreContextChange = useCallback((score: ScoreFocusContext) => {
    onPracticeContextChange?.({
      piece_id: piece.id,
      piece_title: piece.title,
      composer: piece.composer,
      surface: "score",
      ...score,
    });
  }, [onPracticeContextChange, piece.composer, piece.id, piece.title]);

  return (
    <section
      className={`piece-detail ${piece.intake_done && surface === "score" ? "is-score" : ""}`}
      aria-label={`Piece: ${piece.title}`}
    >
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
        {piece.intake_done && piece.has_pdf && (
          <div className="piece-surface-tabs" role="tablist" aria-label="Piece workspace">
            <button
              type="button"
              role="tab"
              aria-selected={surface === "score"}
              className={surface === "score" ? "is-on" : ""}
              onClick={() => setSurface("score")}
            >
              Score
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={surface === "practice"}
              className={surface === "practice" ? "is-on" : ""}
              onClick={() => setSurface("practice")}
            >
              Details
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="ck-inline-error" role="alert">
          {error}
        </p>
      )}

      {!piece.intake_done ? (
        <IntakeForm piece={piece} onSave={saveIntake} saving={saving} />
      ) : surface === "score" && piece.has_pdf ? (
        <ScoreView
          pieceId={piece.id}
          activeRange={activeRep ? { m_start: activeRep.m_start, m_end: activeRep.m_end } : null}
          defaultTargetBpm={piece.target_tempo}
          onOpenBlock={openBlock}
          opening={opening}
          onRegionsChanged={() => setRegionRevision((revision) => revision + 1)}
          onContextChange={onScoreContextChange}
        />
      ) : (
        <>
          <PieceSummary piece={piece} onUpdate={updatePieceField} />
          <ReferenceButtons pieceId={piece.id} />
          <GoalsPanel pieceId={piece.id} />
          <TrickySectionsPanel
            pieceId={piece.id}
            refreshToken={regionRevision}
            onChanged={() => setRegionRevision((revision) => revision + 1)}
          />
          <HistoryPanel pieceId={piece.id} refreshToken={historyRevision + regionRevision} />
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
      <div className="piece-summary-block">
        <div className="piece-notes-heading">
          <span className="ck-label">Piece-wide notes</span>
          {piece.notes && (
            <ConfirmDelete label="Delete the piece-wide note? Tricky Section notes and practice-rep notes are separate and will stay." onConfirm={() => onUpdate({ notes: null })}>
              <button type="button" className="piece-note-delete">Delete note</button>
            </ConfirmDelete>
          )}
        </div>
        <EditableField value={piece.notes ?? ""} placeholder="Double-click to add notes" ariaLabel="piece notes" onSave={(notes) => onUpdate({ notes: notes || null })} />
      </div>
    </div>
  );
}
