import { useMemo, useState } from "react";
import type {
  CalendarApi,
  RecoveryAction,
  RecoveryDecision,
  RecoveryPreview,
} from "./types";
import { dayLabel } from "./dates";

interface DraftDecision {
  action: RecoveryAction;
  date: string;
}

export function RecoveryReview({
  api,
  preview,
  onCancel,
  onApplied,
}: {
  api: CalendarApi;
  preview: RecoveryPreview;
  onCancel: () => void;
  onApplied: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<number, DraftDecision>>(() =>
    Object.fromEntries(preview.items.map(({ work, proposed_date }) => [
      work.id,
      { action: proposed_date ? "move" : "leave", date: proposed_date ?? preview.today },
    ])),
  );
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const grouped = new Map<string, typeof preview.items>();
    for (const item of preview.items) {
      const current = grouped.get(item.work.scheduled_date) ?? [];
      current.push(item);
      grouped.set(item.work.scheduled_date, current);
    }
    return [...grouped.entries()];
  }, [preview.items]);

  const apply = async () => {
    if (applying) return;
    setApplying(true);
    setError(null);
    const decisions: RecoveryDecision[] = preview.items.map(({ work }) => {
      const draft = drafts[work.id];
      return {
        id: work.id,
        expected_updated_ts: work.updated_ts,
        action: draft.action,
        ...(draft.action === "move" ? { date: draft.date } : {}),
      };
    });
    try {
      await api.recoveryApply(decisions);
      await onApplied();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="recovery-review" aria-labelledby="recovery-heading">
      <header className="recovery-review-head">
        <div>
          <p className="calendar-eyebrow">Recovery review</p>
          <h2 id="recovery-heading">Decide what happens to missed work</h2>
          <p>Nothing moves until you apply. Leaving an item here is a valid choice.</p>
        </div>
        <button type="button" className="calendar-quiet-button" onClick={onCancel}>Cancel</button>
      </header>

      {groups.map(([date, items]) => {
        const label = dayLabel(date);
        return (
          <section className="recovery-group" key={date} aria-label={`Missed ${label.weekday} ${label.date}`}>
            <h3>{label.weekday}, {label.date}</h3>
            {items.map((item) => {
              const { work } = item;
              const draft = drafts[work.id];
              return (
                <article className="recovery-item" key={work.id}>
                  <div className="recovery-item-copy">
                    <strong>{work.title}</strong>
                    <span>{work.piece_title} · {goalPath(work)} · {work.planned_minutes} min</span>
                    <p>{item.reason}</p>
                  </div>
                  <div className="recovery-item-decision">
                    <label>
                      <span>Decision</span>
                      <select
                        aria-label={`Decision for ${work.title}`}
                        value={draft.action}
                        onChange={(event) => setDrafts((current) => ({
                          ...current,
                          [work.id]: { ...draft, action: event.target.value as RecoveryAction },
                        }))}
                      >
                        <option value="move">Move</option>
                        <option value="done">Done — I did it</option>
                        <option value="dismiss">Dismiss</option>
                        <option value="leave">Leave unresolved</option>
                      </select>
                    </label>
                    {draft.action === "move" && (
                      <label>
                        <span>Move to</span>
                        <input
                          type="date"
                          aria-label={`Move ${work.title} to`}
                          min={preview.today}
                          value={draft.date}
                          onChange={(event) => setDrafts((current) => ({
                            ...current,
                            [work.id]: { ...draft, date: event.target.value },
                          }))}
                        />
                      </label>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}

      {error && <p className="calendar-error" role="alert">{error}</p>}
      <footer className="recovery-review-actions">
        <button type="button" className="calendar-quiet-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="calendar-primary-button" disabled={applying} onClick={() => void apply()}>
          {applying ? "Applying…" : "Apply decisions"}
        </button>
      </footer>
    </section>
  );
}

function goalPath(work: { goal_text: string; parent_goal_text: string | null }) {
  return work.parent_goal_text ? `${work.parent_goal_text} › ${work.goal_text}` : work.goal_text;
}

function errorMessage(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return "Recovery could not be applied. Refresh and try again.";
}
