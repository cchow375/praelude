import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HistoryPanel } from "../pieces/HistoryPanel";
import type { PieceSummary } from "../pieces/types";
import { AnomaliesPanel } from "./AnomaliesPanel";
import "./LedgerWorkspace.css";

function messageOf(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string"
    ? reason
    : "The practice ledger could not be loaded.";
}

interface LedgerWorkspaceProps {
  /** Exact record requested by a Universe/deep-link jump. */
  requestedPieceId?: number | null;
  /** Changes for every navigation request, including repeat requests. */
  requestRevision?: number;
}

/** Global entry to exact set evidence without duplicating ledger semantics. */
export function LedgerWorkspace({
  requestedPieceId = null,
  requestRevision = 0,
}: LedgerWorkspaceProps = {}) {
  const [pieces, setPieces] = useState<PieceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await invoke<PieceSummary[]>("pieces_list");
      const safe = next ?? [];
      setPieces(safe);
      setSelectedId((current) => {
        if (
          requestedPieceId != null &&
          safe.some((piece) => piece.id === requestedPieceId)
        )
          return requestedPieceId;
        return current != null && safe.some((piece) => piece.id === current)
          ? current
          : (safe[0]?.id ?? null);
      });
    } catch (reason) {
      setPieces([]);
      setSelectedId(null);
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, [requestRevision, requestedPieceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (
      requestedPieceId != null &&
      pieces.some((piece) => piece.id === requestedPieceId)
    ) {
      setSelectedId(requestedPieceId);
    }
  }, [pieces, requestRevision, requestedPieceId]);

  useEffect(() => {
    if (selectedId == null) return;
    setSelectionError(null);
    void invoke("piece_select", { id: selectedId }).catch((reason) => {
      setSelectionError(
        `The ledger changed, but voice context did not: ${messageOf(reason)}`,
      );
    });
  }, [selectedId]);

  const selected = pieces.find((piece) => piece.id === selectedId) ?? null;

  return (
    <main className="ledger-workspace" data-testid="ledger-workspace">
      <header className="ledger-masthead ck-reveal-item">
        <div>
          <p className="ck-kicker">Immutable practice evidence</p>
          <h1>Ledger</h1>
        </div>
      </header>

      {error && (
        <p className="ledger-error" role="alert">
          {error}
        </p>
      )}
      {selectionError && !error && (
        <p className="ledger-error" role="alert">
          {selectionError}
        </p>
      )}

      <div className="ledger-layout ck-reveal-item">
        <aside className="ledger-piece-index" aria-label="Pieces in ledger">
          <div className="ledger-index-head">
            <span>Repertoire</span>
            <strong>{pieces.length}</strong>
          </div>
          {loading ? (
            <p role="status">Reading pieces…</p>
          ) : pieces.length === 0 ? (
            <p>No pieces are recorded yet.</p>
          ) : (
            <ul>
              {pieces.map((piece, index) => (
                <li key={piece.id}>
                  <button
                    type="button"
                    className={piece.id === selectedId ? "is-selected" : ""}
                    aria-pressed={piece.id === selectedId}
                    onClick={() => setSelectedId(piece.id)}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span>
                      <strong>{piece.title}</strong>
                      {piece.composer && <small>{piece.composer}</small>}
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section
          className="ledger-record"
          aria-label={
            selected
              ? `${selected.title} practice evidence`
              : "Practice evidence"
          }
        >
          {selected ? (
            <>
              <header>
                <p className="ck-kicker">Selected record</p>
                <h2>{selected.title}</h2>
                {selected.composer && <p>{selected.composer}</p>}
              </header>
              <HistoryPanel pieceId={selected.id} />
            </>
          ) : !loading ? (
            <div className="ledger-empty">
              <p>Select a piece to inspect its exact sets and attempts.</p>
            </div>
          ) : null}
        </section>
      </div>

      <AnomaliesPanel />
    </main>
  );
}
