import { useEffect, useState } from "react";
import { universeHistoryDays, universeSnapshot } from "../universe/api";
import { buildCadenceWindow, type CadenceWindow } from "../universe/cadence";
import { formatDuration } from "../universe/format";
import type { PracticePieceContext, UniverseSnapshot } from "../universe/types";
import { errorMessage } from "./StudioProvider";
import type { StudioProgress } from "./studioApi";

export function StudioRecord({
  progress,
  onOpenPractice,
  onOpenLedger,
}: {
  progress: StudioProgress;
  onOpenPractice: (piece: PracticePieceContext | null) => void;
  onOpenLedger?: (piece: PracticePieceContext) => void;
}) {
  const [data, setData] = useState<UniverseSnapshot | null>(null);
  const [cadence, setCadence] = useState<CadenceWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    void universeSnapshot()
      .then(async (snapshot) => {
        if (!active) return;
        setData(snapshot);
        const rows = await universeHistoryDays(
          snapshot.traces.active_window_start,
          snapshot.traces.active_window_end,
        );
        if (active)
          setCadence(
            buildCadenceWindow(
              snapshot.traces.active_window_start,
              snapshot.traces.active_window_end,
              rows,
            ),
          );
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [retry]);
  const pieces = [...(data?.pieces ?? [])].sort((a, b) =>
    (b.last_practiced ?? "").localeCompare(a.last_practiced ?? ""),
  );
  return (
    <section className="studio-record" aria-label="Practice record">
      <div className="studio-section-heading">
        <div>
          <h2>The work behind your room.</h2>
          <p>Your retained practice, including pieces you have put to rest.</p>
        </div>
      </div>
      <div className="studio-record-stats">
        <div>
          <strong>{formatDuration(progress.focused_seconds)}</strong>
          <span>focused practice</span>
        </div>
        <div>
          <strong>{progress.completed_sets.toLocaleString()}</strong>
          <span>completed sets</span>
        </div>
        <div>
          <strong>{progress.focus_xp.toLocaleString()}</strong>
          <span>XP from focus</span>
        </div>
        <div>
          <strong>{progress.set_xp.toLocaleString()}</strong>
          <span>XP from session milestones</span>
        </div>
      </div>
      {error && (
        <div className="studio-error" role="alert">
          {error}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {cadence && (
        <section className="studio-cadence" aria-label="Last 28 days">
          <div>
            <h3>One day at a time.</h3>
            <span>
              {cadence.activeDays} days with focused work ·{" "}
              {formatDuration(cadence.focusedSeconds)}
            </span>
          </div>
          <div className="studio-cadence-days">
            {cadence.days.map((day) => (
              <div
                key={day.date}
                data-band={day.band}
                title={`${day.date}: ${day.completedMinutes} focused minutes`}
                aria-label={`${day.date}: ${day.completedMinutes} focused minutes`}
              >
                <i />
                <span>{Number(day.date.slice(-2))}</span>
              </div>
            ))}
          </div>
          <p>Last 28 days · Brighter marks mean more focused time.</p>
        </section>
      )}
      <div className="studio-record-pieces">
        {pieces.map((piece) => (
          <article key={piece.piece_id}>
            <div>
              <h3>{piece.title}</h3>
              <p>
                {piece.composer ?? "Your repertoire"}
                {piece.archived_at ? " · Resting" : ""}
              </p>
            </div>
            <span>
              {formatDuration(piece.focused_seconds)}
              <small>{piece.regions_practiced} passages practiced</small>
            </span>
            <button
              type="button"
              className="studio-secondary"
              onClick={() =>
                onOpenPractice({ piece_id: piece.piece_id, title: piece.title })
              }
            >
              Open score
            </button>
            {onOpenLedger && (
              <button
                type="button"
                className="studio-text-button"
                onClick={() =>
                  onOpenLedger({ piece_id: piece.piece_id, title: piece.title })
                }
              >
                History
              </button>
            )}
          </article>
        ))}
      </div>
      {!data && !error && <p role="status">Reading your practice record…</p>}
      {data && pieces.length === 0 && (
        <p className="studio-empty-note">
          Your first piece starts the story. Add a PDF in Pieces, then choose a
          passage to practice.
        </p>
      )}
    </section>
  );
}
