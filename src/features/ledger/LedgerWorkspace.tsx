import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HistoryPanel } from "../pieces/HistoryPanel";
import { HISTORY, HISTORY_LOWER } from "../../shell/terms";
import type { PieceSummary } from "../pieces/types";
import { AnomaliesPanel } from "./AnomaliesPanel";
import { DayTimeline } from "./DayTimeline";
import "./LedgerWorkspace.css";

function messageOf(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string"
    ? reason
    : `The practice ${HISTORY_LOWER} could not be loaded.`;
}

type HistoryView = "days" | "pieces";

const HISTORY_VIEW_KEY = "ck.history.view";

/** Days is the default view (binding ambiguity resolution). Anything other
 * than the literal stored value "pieces" falls back to Days — including a
 * missing/inaccessible localStorage. */
function loadStoredHistoryView(): HistoryView {
  try {
    return window.localStorage.getItem(HISTORY_VIEW_KEY) === "pieces"
      ? "pieces"
      : "days";
  } catch {
    return "days";
  }
}

function saveStoredHistoryView(view: HistoryView) {
  try {
    window.localStorage.setItem(HISTORY_VIEW_KEY, view);
  } catch {
    // Best-effort persistence only; the in-memory view still works this session.
  }
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
  const [view, setView] = useState<HistoryView>(loadStoredHistoryView);

  const changeView = useCallback((next: HistoryView) => {
    setView(next);
    saveStoredHistoryView(next);
  }, []);

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

  // A deep link (Universe jump / `openLedgerForPiece`) asks for ONE exact
  // record, which only exists in the Pieces view. Landing on the Days default
  // while `piece_select` fires for an invisible piece is the regression this
  // guards. The view state moves, but `ck.history.view` is deliberately NOT
  // rewritten: a transient jump must not redefine the user's chosen default.
  useEffect(() => {
    if (requestedPieceId == null) return;
    setView("pieces");
  }, [requestRevision, requestedPieceId]);

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
        `Your ${HISTORY_LOWER} changed, but voice context did not: ${messageOf(reason)}`,
      );
    });
  }, [selectedId]);

  const selected = pieces.find((piece) => piece.id === selectedId) ?? null;

  return (
    <main className="ledger-workspace" data-testid="ledger-workspace">
      <header className="ledger-masthead ck-reveal-item">
        <div>
          <p className="ck-kicker">Immutable practice evidence</p>
          <h1>{HISTORY}</h1>
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

      <div
        className="ledger-view-switch"
        role="tablist"
        aria-label="History view"
      >
        <button
          type="button"
          role="tab"
          id="history-view-tab-days"
          aria-controls="history-view-panel-days"
          aria-selected={view === "days"}
          className={`ledger-view-tab${view === "days" ? " is-active" : ""}`}
          onClick={() => changeView("days")}
        >
          Days
        </button>
        <button
          type="button"
          role="tab"
          id="history-view-tab-pieces"
          aria-controls="history-view-panel-pieces"
          aria-selected={view === "pieces"}
          className={`ledger-view-tab${view === "pieces" ? " is-active" : ""}`}
          onClick={() => changeView("pieces")}
        >
          Pieces
        </button>
      </div>

      {view === "days" ? (
        <div
          role="tabpanel"
          id="history-view-panel-days"
          aria-labelledby="history-view-tab-days"
        >
          <DayTimeline />
        </div>
      ) : (
        <div
          className="ledger-layout ck-reveal-item"
          role="tabpanel"
          id="history-view-panel-pieces"
          aria-labelledby="history-view-tab-pieces"
        >
          <aside
            className="ledger-piece-index"
            aria-label={`Pieces in ${HISTORY}`}
          >
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
                      className={`ck-fit-reveal${piece.id === selectedId ? " is-selected" : ""}`}
                      aria-pressed={piece.id === selectedId}
                      onClick={() => setSelectedId(piece.id)}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <span>
                        <strong className="ck-fit">{piece.title}</strong>
                        {piece.composer && (
                          <small className="ck-fit">{piece.composer}</small>
                        )}
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
      )}

      <AnomaliesPanel />
    </main>
  );
}
