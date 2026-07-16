import { useCallback, useEffect, useMemo, useState } from "react";
import { universeSnapshot } from "../universe/api";
import type { PracticePieceContext, UniverseSnapshot } from "../universe/types";
import { todayLocal } from "../calendar/dates";
import { RetentionQueue } from "../retention";
import "./TodayWorkspace.css";

interface TodayWorkspaceProps {
  onOpenAtlas: () => void;
  onOpenCalendar: () => void;
  onOpenPiece: (piece: PracticePieceContext) => void;
  defaultCleanStreak?: number;
}

function messageOf(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "Today's practice state could not be loaded.";
}

function compactDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function todayLabel(now = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}

/**
 * A sourced launch surface, never a synthetic scorecard. It only projects
 * canonical Universe totals and the most recently practiced piece.
 */
export function TodayWorkspace({
  onOpenAtlas,
  onOpenCalendar,
  onOpenPiece,
  defaultCleanStreak = 5,
}: TodayWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<UniverseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retentionOpen, setRetentionOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await universeSnapshot());
    } catch (reason) {
      setSnapshot(null);
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const recent = useMemo(() => {
    const pieces = snapshot?.pieces ?? [];
    return [...pieces].sort((left, right) => {
      const a = Date.parse(left.last_practiced ?? "") || 0;
      const b = Date.parse(right.last_practiced ?? "") || 0;
      return b - a;
    })[0] ?? null;
  }, [snapshot]);

  return (
    <main
      className="today-workspace"
      data-testid="today-workspace"
    >
      <header className="today-masthead ck-reveal-item">
        <p className="today-date">{todayLabel()}</p>
        <h1 aria-label="Make one thing reliable.">Make one thing<br /><em>reliable.</em></h1>
        <p className="today-thesis">
          You make the musical judgment. CodaKiller keeps the contract, the clock, and the memory.
        </p>
      </header>

      {error && (
        <div className="today-error ck-reveal-item" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      )}

      <section className="today-board" aria-label="Today's practice launchpad">
        <article className="today-next ck-reveal-item">
          <p className="ck-kicker">Next honest move</p>
          {loading ? (
            <p className="today-loading" role="status">Reading the ledger…</p>
          ) : recent ? (
            <>
              <div className="today-index" aria-hidden="true">01</div>
              <h2>{recent.title}</h2>
              <p className="today-composer">{recent.composer ?? "Selected repertoire"}</p>
              <p className="today-copy">
                Resume from the score. The previous peak stays historical until a new retention check confirms it.
              </p>
              <div className="today-actions">
                <button
                  type="button"
                  className="ck-primary-action"
                  onClick={() => onOpenPiece({ piece_id: recent.piece_id, title: recent.title })}
                >
                  Continue in Atlas <span aria-hidden="true">↗</span>
                </button>
                <button type="button" className="ck-text-action" onClick={onOpenAtlas}>Choose another piece</button>
              </div>
            </>
          ) : (
            <>
              <div className="today-index" aria-hidden="true">01</div>
              <h2>Open the score.</h2>
              <p className="today-copy">Choose a piece, mark the exact target, and begin with a small explicit contract.</p>
              <button type="button" className="ck-primary-action" onClick={onOpenAtlas}>
                Open Score Atlas <span aria-hidden="true">↗</span>
              </button>
            </>
          )}
        </article>

        <aside className="today-rule ck-reveal-item" aria-label={`Default contract: ${defaultCleanStreak} clean attempts in a row`}>
          <p className="ck-kicker">Default contract</p>
          <p className="today-rule-number" aria-hidden="true">{defaultCleanStreak}</p>
          <h2 id="today-rule-title">clean attempts<br />in a row</h2>
          <p>A miss resets the streak. Nothing is erased; recovery is part of the evidence.</p>
        </aside>

        <article className="today-ledger ck-reveal-item" aria-labelledby="today-ledger-title">
          <div>
            <p className="ck-kicker">Ledger, not judgment</p>
            <h2 id="today-ledger-title">What the record can prove</h2>
          </div>
          <dl>
            <div><dt>Focused time</dt><dd>{snapshot ? compactDuration(snapshot.totals.focused_seconds) : "—"}</dd></div>
            <div><dt>Active days · 28</dt><dd>{snapshot?.totals.active_days_28 ?? "—"}</dd></div>
            <div><dt>Targets touched</dt><dd>{snapshot?.totals.regions_practiced ?? "—"}</dd></div>
            <div><dt>Targets revisited</dt><dd>{snapshot?.totals.regions_revisited ?? "—"}</dd></div>
          </dl>
        </article>

        <button type="button" className="today-plan ck-reveal-item" onClick={onOpenCalendar}>
          <span className="ck-kicker">Time available?</span>
          <strong>Shape the day</strong>
          <span>Review the Calendar and due work</span>
          <span className="today-plan-arrow" aria-hidden="true">→</span>
        </button>
      </section>

      <details className="today-retention ck-reveal-item" onToggle={(event) => setRetentionOpen(event.currentTarget.open)}>
        <summary>
          <span className="ck-kicker">What survived?</span>
          <strong>Retention checks</strong>
          <span>Yesterday’s peak stays historical until you test it.</span>
        </summary>
        {retentionOpen && <RetentionQueue asOfDate={todayLocal()} />}
      </details>
    </main>
  );
}

export { compactDuration, todayLabel };
