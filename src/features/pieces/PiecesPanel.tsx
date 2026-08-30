import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PieceDetailData, PieceFolder, PieceSummary } from "./types";
import type { RepOpenArgs, RepSnapshot } from "../rep/useRep";
import { PieceDetail } from "./PieceDetail";
import { AddPiece } from "./AddPiece";
import { PieceLibrary, type LibraryLocation } from "./PieceLibrary";
import type { PracticeBrainContext } from "../brain/types";
import "./Pieces.css";

// ---------------------------------------------------------------------------
// The Practice view root: the piece library. Lists pieces from `pieces_list`,
// rescans the vault on demand (`pieces_scan`), and drills into a selected piece
// (`piece_select` + `piece_get`). Opening a block is delegated up to the shared
// rep hook so the shell-level HUD reflects it.
// ---------------------------------------------------------------------------

interface PiecesPanelProps {
  onOpenBlock: (args: RepOpenArgs) => Promise<RepSnapshot | void>;
  activeRep?: RepSnapshot | null;
  defaultCleanStreak?: number;
  /** A Home-star selection opens this piece directly, bypassing the library. */
  initialPieceId?: number | null;
  onLeavePiece?: () => void;
  onPracticeContextChange?: (context: PracticeBrainContext | null) => void;
}

function messageOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function PiecesPanel({
  onOpenBlock,
  activeRep = null,
  defaultCleanStreak = 5,
  initialPieceId = null,
  onLeavePiece,
  onPracticeContextChange,
}: PiecesPanelProps) {
  const [pieces, setPieces] = useState<PieceSummary[]>([]);
  const [folders, setFolders] = useState<PieceFolder[]>([]);
  const [location, setLocation] = useState<LibraryLocation>("all");
  const [selected, setSelected] = useState<PieceDetailData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const selectionGeneration = useRef(0);

  const loadList = useCallback(async () => {
    try {
      const [list, nextFolders] = await Promise.all([
        invoke<PieceSummary[]>("pieces_list", { includeArchived: true }),
        invoke<PieceFolder[]>("piece_folders_list"),
      ]);
      setPieces(list ?? []);
      setFolders(nextFolders ?? []);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      await invoke<PieceSummary[]>("pieces_scan");
      await loadList();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setScanning(false);
    }
  }, [loadList]);

  const select = useCallback(async (id: number) => {
    const generation = ++selectionGeneration.current;
    setError(null);
    try {
      const detail = await invoke<PieceDetailData>("piece_get", { id });
      if (!detail || generation !== selectionGeneration.current) return;
      await invoke("piece_select", { id });
      if (generation === selectionGeneration.current) setSelected(detail);
    } catch (e) {
      if (generation === selectionGeneration.current) setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    if (initialPieceId != null) void select(initialPieceId);
  }, [initialPieceId, select]);

  // Reflect an intake save / detail edit back into the list badges.
  const onPieceUpdated = useCallback((updated: PieceDetailData) => {
    setPieces((list) =>
      list.map((p) =>
        p.id === updated.id
          ? {
              id: updated.id,
              title: updated.title,
              composer: updated.composer,
              has_xml: updated.has_xml,
              has_pdf: updated.has_pdf,
              intake_done: updated.intake_done,
              folder_id: updated.folder_id ?? null,
              completed_at: updated.completed_at ?? null,
              archived_at: updated.archived_at ?? p.archived_at ?? null,
              last_practiced:
                updated.last_practiced ?? p.last_practiced ?? null,
            }
          : p,
      ),
    );
  }, []);

  if (selected) {
    return (
      <div className="pieces-view">
        <PieceDetail
          key={selected.id}
          piece={selected}
          onBack={() => {
            selectionGeneration.current += 1;
            setSelected(null);
            onPracticeContextChange?.(null);
            onLeavePiece?.();
          }}
          onOpenBlock={onOpenBlock}
          activeRep={activeRep}
          defaultCleanStreak={defaultCleanStreak}
          onUpdated={onPieceUpdated}
          onRemoved={(id) => {
            setPieces((list) => list.filter((p) => p.id !== id));
            setSelected(null);
            onPracticeContextChange?.(null);
            onLeavePiece?.();
          }}
          onArchived={(id) => {
            setPieces((list) =>
              list.map((piece) =>
                piece.id === id
                  ? { ...piece, archived_at: Math.floor(Date.now() / 1000) }
                  : piece,
              ),
            );
            setSelected(null);
            onPracticeContextChange?.(null);
            onLeavePiece?.();
          }}
          onPracticeContextChange={onPracticeContextChange}
        />
      </div>
    );
  }

  return (
    <div className="pieces-view">
      <div className="pieces-header">
        <div>
          <p className="ck-kicker">Your repertoire</p>
          <h2 className="pieces-heading">Pieces Library</h2>
          <p className="pieces-subheading">
            Add your own scores, organize them your way, and choose what to practice.
          </p>
        </div>
        <div className="pieces-header-actions">
          <button
            type="button"
            className="pieces-scan"
            aria-label="Add a piece"
            aria-pressed={adding}
            onClick={() => setAdding((v) => !v)}
          >
            <span>Add Piece</span>
          </button>
          <button
            type="button"
            className="pieces-scan"
            aria-label="Rescan pieces folder"
            onClick={scan}
            disabled={scanning}
          >
            <RescanGlyph spinning={scanning} />
            <span>{scanning ? "Scanning…" : "Scan"}</span>
          </button>
        </div>
      </div>

      {adding && (
        <AddPiece
          folders={folders}
          initialFolderId={typeof location === "number" ? location : null}
          onImported={(piece) => {
            setAdding(false);
            setSelected(piece);
            setPieces((current) => [
              ...current.filter((item) => item.id !== piece.id),
              piece,
            ]);
            void invoke("piece_select", { id: piece.id });
            void loadList();
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {error && (
        <p className="ck-inline-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="pieces-empty">Loading…</p>
      ) : (
        <PieceLibrary
          pieces={pieces}
          folders={folders}
          location={location}
          onLocationChange={setLocation}
          onOpen={(id) => void select(id)}
          onReload={loadList}
          onError={setError}
        />
      )}
    </div>
  );
}

function RescanGlyph({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      className={spinning ? "rescan-glyph is-spinning" : "rescan-glyph"}
    >
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
