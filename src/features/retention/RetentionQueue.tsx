import { useEffect, useState } from "react";
import { defaultSnoozeDate, isValidSnoozeDate } from "./date";
import type { RetentionApi, RetentionCheckView, RetentionCondition } from "./types";
import { useRetention } from "./useRetention";
import "./RetentionQueue.css";

export interface RetentionQueueProps {
  readonly asOfDate: string;
  readonly api?: RetentionApi;
}

/** Render the typed working condition as one readable line, never raw JSON. */
function formatCondition(condition: RetentionCondition): string {
  const parts: string[] = [];
  if (condition.bpm != null) parts.push(`${condition.bpm} BPM`);
  if (condition.m_start != null && condition.m_end != null) {
    parts.push(`m. ${condition.m_start}–${condition.m_end}`);
  }
  if (condition.hands) parts.push(`hands ${condition.hands}`);
  if (condition.method) parts.push(condition.method);
  if (condition.judging_axis) parts.push(`judging ${condition.judging_axis}`);
  if (condition.required_clean_streak != null) {
    parts.push(`${condition.required_clean_streak} clean in a row`);
  }
  if (condition.cold) parts.push("cold");
  return parts.length > 0 ? parts.join(" · ") : "not recorded";
}

function RetentionCheckCard({
  check,
  asOfDate,
  pending,
  onConfirm,
  onLower,
  onReopen,
  onSnooze,
}: {
  check: RetentionCheckView;
  asOfDate: string;
  pending: boolean;
  onConfirm: (note: string) => void;
  onLower: (note: string) => void;
  onReopen: (note: string) => void;
  onSnooze: (date: string) => void;
}) {
  const [note, setNote] = useState("");
  const [snoozeDate, setSnoozeDate] = useState(() => (
    defaultSnoozeDate(check.due_date, asOfDate)
  ));

  useEffect(() => {
    setSnoozeDate(defaultSnoozeDate(check.due_date, asOfDate));
  }, [asOfDate, check.due_date]);

  const targetName = `target ${check.region_id}`;
  const noteReady = note.trim() !== "";
  const snoozeReady = isValidSnoozeDate(snoozeDate, check.due_date, asOfDate);

  return (
    <li className="retention-card" data-state={check.state}>
      <header className="retention-card-head">
        <div>
          <span className="retention-target-kicker">Target {check.region_id}</span>
          <h3>Check what survived.</h3>
        </div>
        <time dateTime={check.due_date}>Due {check.due_date}</time>
      </header>

      <dl className="retention-condition">
        <div>
          <dt>Historical condition</dt>
          <dd>{formatCondition(check.condition)}</dd>
        </div>
        <div>
          <dt>Original due date</dt>
          <dd>{check.original_due_date}</dd>
        </div>
      </dl>

      <label className="retention-note-label" htmlFor={`retention-note-${check.id}`}>
        Result or note for {targetName}
      </label>
      <textarea
        id={`retention-note-${check.id}`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What remained reliable at the checked condition?"
        rows={2}
        disabled={pending}
      />

      <div className="retention-decisions" aria-label={`Retention decisions for ${targetName}`}>
        <button
          type="button"
          disabled={pending || !noteReady}
          onClick={() => onConfirm(note)}
          aria-label={`Confirm retained for ${targetName}`}
        >
          Confirm retained
        </button>
        <button
          type="button"
          disabled={pending || !noteReady}
          onClick={() => onLower(note)}
          aria-label={`Lower working condition for ${targetName}`}
        >
          Lower working condition
        </button>
        <button
          type="button"
          disabled={pending || !noteReady}
          onClick={() => onReopen(note)}
          aria-label={`Reopen ${targetName}`}
        >
          Reopen target
        </button>
      </div>

      <div className="retention-snooze">
        <label htmlFor={`retention-date-${check.id}`}>Snooze {targetName} until</label>
        <input
          id={`retention-date-${check.id}`}
          type="date"
          value={snoozeDate}
          min={defaultSnoozeDate(check.due_date, asOfDate)}
          onChange={(event) => setSnoozeDate(event.target.value)}
          disabled={pending}
        />
        <button
          type="button"
          disabled={pending || !snoozeReady}
          onClick={() => onSnooze(snoozeDate)}
          aria-label={`Snooze ${targetName} until ${snoozeDate || "a later date"}`}
        >
          Snooze
        </button>
      </div>
      <p className="retention-snooze-note">
        Snooze changes only the due date; it does not claim a result.
      </p>
      {pending && <p className="retention-pending" role="status">Saving explicit result…</p>}
    </li>
  );
}

export function RetentionQueue({ asOfDate, api }: RetentionQueueProps) {
  const retention = useRetention({ asOfDate, api });

  return (
    <section className="retention-queue" aria-labelledby="retention-queue-title">
      <header className="retention-queue-head">
        <div>
          <span className="retention-kicker">Retention queue</span>
          <h2 id="retention-queue-title">Yesterday’s peak is historical until checked.</h2>
        </div>
        <button type="button" onClick={() => void retention.reload()} disabled={retention.loading}>
          Refresh
        </button>
      </header>

      <p className="retention-explainer">
        CodaKiller does not carry mastery forward automatically. Play the target, then record only
        the result you observed.
      </p>

      {retention.error && (
        <div className="retention-error" role="alert">
          <span>{retention.error}</span>
          <button type="button" onClick={retention.clearError}>Dismiss</button>
        </div>
      )}

      {retention.loading ? (
        <p className="retention-state" role="status">Loading retention checks…</p>
      ) : retention.checks.length === 0 ? (
        <p className="retention-state">No retention checks are due for {asOfDate}.</p>
      ) : (
        <ol className="retention-list">
          {retention.checks.map((check) => (
            <RetentionCheckCard
              key={check.id}
              check={check}
              asOfDate={asOfDate}
              pending={retention.pending_check_ids.has(check.id)}
              onConfirm={(note) => void retention.confirm(check.id, note)}
              onLower={(note) => void retention.lower(check.id, note)}
              onReopen={(note) => void retention.reopen(check.id, note)}
              onSnooze={(date) => void retention.snooze(check.id, date)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
