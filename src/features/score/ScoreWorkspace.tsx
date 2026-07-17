import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PieceSummary } from "../pieces/types";
import type { RepOpenArgs } from "../rep/useRep";
import { ScoreView } from "./ScoreView";
import "./ScoreWorkspace.css";

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string"
    ? reason
    : "The score library could not be loaded.";
}

export interface ScoreWorkspaceProps {
  /** Shell's rep.open — without it ScoreView's Practice tab renders nothing. */
  onOpenBlock?: (args: RepOpenArgs) => Promise<void>;
  defaultCleanStreak?: number;
}

/**
 * v3 Score workspace: a quiet piece picker over the existing PDF viewer +
 * atlas. It reuses `ScoreView` (PdfPage/RegionOverlay/pdfjs) unchanged and adds
 * the monochrome chrome; the "Map this score" wizard lives inside `ScoreView`.
 */
export function ScoreWorkspace({
  onOpenBlock,
  defaultCleanStreak,
}: ScoreWorkspaceProps = {}) {
  const [pieces, setPieces] = useState<PieceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const openBlock = useCallback(
    async (args: RepOpenArgs) => {
      if (!onOpenBlock) return;
      setOpening(true);
      try {
        await onOpenBlock(args);
      } finally {
        // useRep publishes the application-level receipt on failure; the
        // shell-level RepHud appears on success. Here we only clear the
        // in-flight flag.
        setOpening(false);
      }
    },
    [onOpenBlock],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = (await invoke<PieceSummary[]>("pieces_list")) ?? [];
      const withPdf = next.filter((piece) => piece.has_pdf);
      const list = withPdf.length > 0 ? withPdf : next;
      setPieces(list);
      setSelectedId((current) =>
        current != null && list.some((piece) => piece.id === current)
          ? current
          : (list[0]?.id ?? null),
      );
    } catch (reason) {
      setPieces([]);
      setSelectedId(null);
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = pieces.find((piece) => piece.id === selectedId) ?? null;

  return (
    <main className="score-workspace" data-testid="score-workspace">
      <header className="score-workspace-head">
        <div>
          <span className="score-workspace-kicker">Score</span>
          <h1 className="score-workspace-title">
            {selected ? selected.title : "Your scores"}
          </h1>
        </div>
        {pieces.length > 0 && (
          <label className="score-workspace-picker">
            <span>Piece</span>
            <select
              aria-label="Choose a piece"
              value={selectedId ?? ""}
              onChange={(event) => setSelectedId(Number(event.target.value))}
            >
              {pieces.map((piece) => (
                <option key={piece.id} value={piece.id}>
                  {piece.title}
                  {piece.composer ? ` · ${piece.composer}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <div className="score-workspace-body">
        {loading && (
          <p className="score-workspace-state" role="status">
            Loading your scores…
          </p>
        )}
        {error && !loading && (
          <p className="score-workspace-state is-error" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && selectedId == null && (
          <p className="score-workspace-state">
            No pieces with a PDF score yet. Add a PDF to a piece’s folder and
            rescan.
          </p>
        )}
        {!loading && !error && selectedId != null && (
          <ScoreView
            key={selectedId}
            pieceId={selectedId}
            onOpenBlock={onOpenBlock ? openBlock : undefined}
            opening={opening}
            defaultCleanStreak={defaultCleanStreak}
          />
        )}
      </div>
    </main>
  );
}
