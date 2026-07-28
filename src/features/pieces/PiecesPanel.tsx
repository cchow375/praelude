import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PieceDetailData, PieceSummary } from "./types";
import type { RepOpenArgs, RepSnapshot } from "../rep/useRep";
import { PieceDetail } from "./PieceDetail";
import type { PracticeBrainContext } from "../brain/types";
import "./Pieces.css";

// ---------------------------------------------------------------------------
// The Practice view root: the piece library. Lists pieces from `pieces_list`,
// rescans the vault on demand (`pieces_scan`), and drills into a selected piece
// (`piece_select` + `piece_get`). Opening a block is delegated up to the shared
// rep hook so the shell-level HUD reflects it.
// ---------------------------------------------------------------------------

interface PiecesPanelProps {
  onOpenBlock: (args: RepOpenArgs) => Promise<void>;
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
  const [selected, setSelected] = useState<PieceDetailData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectionGeneration = useRef(0);

  const loadList = useCallback(async () => {
    try {
      const list = await invoke<PieceSummary[]>("pieces_list");
      setPieces(list ?? []);
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
      const list = await invoke<PieceSummary[]>("pieces_scan");
      setPieces(list ?? []);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setScanning(false);
    }
  }, []);

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
          onPracticeContextChange={onPracticeContextChange}
        />
      </div>
    );
  }

  return (
    <div className="pieces-view">
      <div className="pieces-header">
        <div>
          <p className="ck-kicker">Score-centered workspace</p>
          <h2 className="pieces-heading">Score Atlas</h2>
          <p className="pieces-subheading">
            Choose a score, then work from an exact visible target.
          </p>
        </div>
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

      <div className="atlas-instruction" aria-label="Score Atlas workflow">
        <span>01 · choose score</span>
        <span aria-hidden="true">→</span>
        <span>02 · mark target</span>
        <span aria-hidden="true">→</span>
        <span>03 · start contract</span>
      </div>

      {error && (
        <p className="ck-inline-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="pieces-empty">Loading…</p>
      ) : pieces.length === 0 ? (
        <div className="pieces-empty-state">
          <p className="pieces-empty">No pieces yet.</p>
          <p className="pieces-empty-hint">
            Scan your pieces folder to import scores.
          </p>
        </div>
      ) : (
        <ul className="pieces-list">
          {pieces.map((p, index) => (
            <li key={p.id}>
              <button
                type="button"
                className="piece-row ck-fit-reveal"
                onClick={() => select(p.id)}
              >
                <span className="piece-row-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="piece-row-main">
                  <span className="piece-row-title ck-fit">{p.title}</span>
                  {p.composer && (
                    <span className="piece-row-composer ck-fit">
                      {p.composer}
                    </span>
                  )}
                </span>
                <span className="piece-row-badges">
                  {p.has_xml && <span className="piece-badge is-xml">XML</span>}
                  {p.has_pdf && <span className="piece-badge is-pdf">PDF</span>}
                  {!p.intake_done && (
                    <span className="piece-badge is-intake">needs intake</span>
                  )}
                  <span className="piece-row-arrow" aria-hidden="true">
                    ↗
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
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
