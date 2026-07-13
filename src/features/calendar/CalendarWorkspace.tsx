import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import type { Goal, PieceSummary } from "../pieces/types";
import { calendarApi } from "./api";
import { addDays, dayLabel, startOfWeek, todayLocal, weekLabel } from "./dates";
import { RecoveryReview } from "./RecoveryReview";
import type {
  CalendarApi,
  DailyWork,
  DailyWorkPatch,
  RecoveryPreview,
} from "./types";
import "./CalendarWorkspace.css";

export interface CalendarWorkspaceProps {
  api?: CalendarApi;
  /** Test seam; production always uses the backend-aligned local day. */
  initialToday?: string;
}

interface References {
  pieces: PieceSummary[];
  goals: Goal[];
}

export function CalendarWorkspace({ api = calendarApi, initialToday }: CalendarWorkspaceProps) {
  const today = initialToday ?? todayLocal();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  const [work, setWork] = useState<DailyWork[]>([]);
  const [references, setReferences] = useState<References>({ pieces: [], goals: [] });
  const [capacity, setCapacity] = useState(60);
  const [capacityDraft, setCapacityDraft] = useState("60");
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const weekEnd = addDays(weekStart, 6);
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);

  const loadWeek = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWork(await api.list({ from: weekStart, to: weekEnd, pieceId: null }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api, weekEnd, weekStart]);

  const loadPreview = useCallback(async () => {
    try {
      const next = await api.recoveryPreview();
      setPreview(next);
      setCapacity(next.capacity_minutes);
      setCapacityDraft(String(next.capacity_minutes));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [api]);

  useEffect(() => { void loadWeek(); }, [loadWeek]);
  useEffect(() => { void loadPreview(); }, [loadPreview]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const pieces = await api.listPieces();
        const goalLists = await Promise.all(pieces.map((piece) => api.listGoals(piece.id)));
        if (active) setReferences({ pieces, goals: goalLists.flat() });
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      }
    })();
    return () => { active = false; };
  }, [api]);

  const mutate = async (operation: () => Promise<unknown>) => {
    setError(null);
    try {
      await operation();
      await Promise.all([loadWeek(), loadPreview()]);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  };

  const saveCapacity = async () => {
    const minutes = Number(capacityDraft);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      setError("Daily capacity must be a whole number from 1 to 1440 minutes.");
      return;
    }
    await mutate(() => api.setCapacity(minutes));
  };

  if (reviewing && preview && preview.items.length > 0) {
    return (
      <main className="calendar-workspace" data-testid="calendar-workspace">
        <RecoveryReview
          api={api}
          preview={preview}
          onCancel={() => setReviewing(false)}
          onApplied={async () => {
            setReviewing(false);
            await Promise.all([loadWeek(), loadPreview()]);
          }}
        />
      </main>
    );
  }

  return (
    <main className="calendar-workspace" data-testid="calendar-workspace">
      <header className="calendar-header">
        <div>
          <p className="calendar-eyebrow">Calendar</p>
          <h1>Make the week explicit.</h1>
          <p>Plan real work. Completing a card never invents practice time or reps.</p>
        </div>
        <div className="calendar-capacity">
          <label htmlFor="calendar-capacity">Daily capacity</label>
          <div>
            <input
              id="calendar-capacity"
              type="number"
              min="1"
              max="1440"
              value={capacityDraft}
              onChange={(event) => setCapacityDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveCapacity();
              }}
            />
            <span>min</span>
            <button type="button" aria-label="Save daily capacity" onClick={() => void saveCapacity()}>Save</button>
          </div>
        </div>
      </header>

      {preview && preview.items.length > 0 && (
        <section className="recovery-banner" aria-label="Missed work available for review">
          <div>
            <strong>{preview.items.length} missed {preview.items.length === 1 ? "item" : "items"} need a decision.</strong>
            <span>Reviewing is not a penalty. Nothing moves automatically.</span>
          </div>
          <button type="button" onClick={() => setReviewing(true)}>Review missed work</button>
        </section>
      )}

      <nav className="calendar-week-nav" aria-label="Calendar week">
        <button type="button" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>←</button>
        <button type="button" onClick={() => setWeekStart(startOfWeek(today))}>This week</button>
        <strong aria-live="polite">{weekLabel(weekStart, weekEnd)}</strong>
        <button type="button" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>→</button>
      </nav>

      {error && <p className="calendar-error" role="alert">{error}</p>}
      {loading ? (
        <p className="calendar-loading" role="status">Loading this week…</p>
      ) : (
        <section className="calendar-strip" aria-label={`Week of ${weekStart}`}>
          {dates.map((date) => {
            const items = work
              .filter((item) => item.scheduled_date === date)
              .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
            const milestones = references.goals
              .filter((goal) => goal.kind === "big" && goal.parent_goal_id === null && goal.target_date === date)
              .sort((left, right) => left.order - right.order || left.id - right.id);
            return (
              <CalendarDay
                key={date}
                date={date}
                today={today}
                items={items}
                milestones={milestones}
                capacity={capacity}
                references={references}
                api={api}
                onMutate={mutate}
              />
            );
          })}
        </section>
      )}
    </main>
  );
}

function CalendarDay({
  date,
  today,
  items,
  milestones,
  capacity,
  references,
  api,
  onMutate,
}: {
  date: string;
  today: string;
  items: DailyWork[];
  milestones: Goal[];
  capacity: number;
  references: References;
  api: CalendarApi;
  onMutate: (operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const used = items.filter((item) => item.status === "planned").reduce((sum, item) => sum + item.planned_minutes, 0);
  const label = dayLabel(date);
  return (
    <section className={`calendar-day ${date === today ? "is-today" : ""}`} aria-label={`${label.weekday} ${label.date}`}>
      <header>
        <div><span>{label.weekday}</span><strong>{label.date}</strong></div>
        <span className={used > capacity ? "is-over" : ""}>{used}/{capacity} min</span>
      </header>
      {milestones.length > 0 && (
        <div className="calendar-goal-milestones" aria-label={`Big goal deadlines on ${date}`}>
          {milestones.map((goal) => {
            const piece = references.pieces.find((candidate) => candidate.id === goal.piece_id);
            return (
              <article key={goal.id} className={`calendar-goal-milestone ${goal.done ? "is-done" : ""}`}>
                <span>Big Goal deadline</span>
                <strong>{goal.text}</strong>
                <small>{piece?.title ?? "Piece"}{goal.done ? " · complete" : ""}</small>
              </article>
            );
          })}
        </div>
      )}
      <div className="calendar-day-work">
        {items.length === 0 && milestones.length === 0 && <p className="calendar-day-empty">No work planned.</p>}
        {items.map((item) => editing === item.id ? (
          <WorkForm
            key={item.id}
            date={date}
            references={references}
            work={item}
            onCancel={() => setEditing(null)}
            onSave={async (draft) => {
              const saved = await onMutate(() => api.update(item.id, item.updated_ts, {
                title: draft.title,
                planned_minutes: draft.minutes,
                scheduled_date: draft.date,
              }));
              if (saved) setEditing(null);
            }}
          />
        ) : (
          <WorkCard
            key={item.id}
            item={item}
            onEdit={() => setEditing(item.id)}
            onMove={() => setEditing(item.id)}
            onPatch={async (patch) => { await onMutate(() => api.update(item.id, item.updated_ts, patch)); }}
            onDelete={async () => { await onMutate(() => api.delete(item.id, item.updated_ts)); }}
          />
        ))}
      </div>
      {creating ? (
        <WorkForm
          date={date}
          references={references}
          onCancel={() => setCreating(false)}
          onSave={async (draft) => {
            const saved = await onMutate(() => api.create({
              goal_id: draft.goalId,
              region_id: null,
              block_id: null,
              title: draft.title,
              minutes: draft.minutes,
              date: draft.date,
              source: "manual",
            }));
            if (saved) setCreating(false);
          }}
        />
      ) : (
        <button type="button" className="calendar-add-work" onClick={() => setCreating(true)}>+ Add work</button>
      )}
    </section>
  );
}

function WorkCard({
  item,
  onEdit,
  onMove,
  onPatch,
  onDelete,
}: {
  item: DailyWork;
  onEdit: () => void;
  onMove: () => void;
  onPatch: (patch: DailyWorkPatch) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <article className={`calendar-work-card is-${item.status}`}>
      <div className="calendar-work-card-copy">
        <strong>{item.title}</strong>
        <span>{item.piece_title}</span>
        <span>{item.parent_goal_text ? `${item.parent_goal_text} › ` : ""}{item.goal_text}</span>
      </div>
      <span className="calendar-work-minutes">{item.planned_minutes} min</span>
      {item.status !== "planned" && <span className="calendar-work-status">{item.status === "done" ? "Done" : "Dismissed"}</span>}
      <div className="calendar-work-actions">
        <button type="button" onClick={onEdit}>Edit</button>
        <button type="button" onClick={onMove}>Move</button>
        {item.status === "planned" && (
          <>
            <button type="button" onClick={() => void onPatch({ status: "done" })}>Done</button>
            <button type="button" onClick={() => void onPatch({ status: "dismissed" })}>Dismiss</button>
          </>
        )}
        <ConfirmDelete label="Delete this daily work?" onConfirm={onDelete}>
          <button type="button">Delete</button>
        </ConfirmDelete>
      </div>
    </article>
  );
}

interface WorkDraft { goalId: number; title: string; minutes: number; date: string }

function WorkForm({
  date,
  references,
  work,
  onCancel,
  onSave,
}: {
  date: string;
  references: References;
  work?: DailyWork;
  onCancel: () => void;
  onSave: (draft: WorkDraft) => Promise<void>;
}) {
  const firstGoal = work?.goal_id ?? references.goals[0]?.id ?? 0;
  const [goalId, setGoalId] = useState(firstGoal);
  const [title, setTitle] = useState(work?.title ?? "");
  const [minutes, setMinutes] = useState(work?.planned_minutes ?? 20);
  const [scheduledDate, setScheduledDate] = useState(work?.scheduled_date ?? date);
  const [saving, setSaving] = useState(false);
  const valid = goalId > 0 && title.trim().length > 0 && Number.isInteger(minutes) && minutes >= 1 && minutes <= 240;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSave({ goalId, title: title.trim(), minutes, date: scheduledDate });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="calendar-work-form" aria-label={work ? `Edit ${work.title}` : `Add work on ${date}`} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {!work && (
        <label>
          <span>Goal</span>
          <select aria-label="Goal" value={goalId} onChange={(event) => setGoalId(Number(event.target.value))}>
            {references.goals.length === 0 && <option value={0}>Create a goal in Practice first</option>}
            {references.goals.map((goal) => {
              const piece = references.pieces.find((candidate) => candidate.id === goal.piece_id);
              const parent = references.goals.find((candidate) => candidate.id === goal.parent_goal_id);
              return <option key={goal.id} value={goal.id}>{piece?.title ?? "Piece"} · {parent ? `${parent.text} › ` : ""}{goal.text}</option>;
            })}
          </select>
        </label>
      )}
      <label><span>Exact work step (separate from the Goal)</span><input autoFocus value={title} aria-label="Work title" onChange={(event) => setTitle(event.target.value)} /></label>
      <div className="calendar-form-row">
        <label><span>Minutes</span><input type="number" min="1" max="240" value={minutes} aria-label="Planned minutes" onChange={(event) => setMinutes(Number(event.target.value))} /></label>
        <label><span>Date</span><input type="date" value={scheduledDate} aria-label="Scheduled date" onChange={(event) => setScheduledDate(event.target.value)} /></label>
      </div>
      <div className="calendar-form-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={!valid || saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

function errorMessage(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return "Calendar data could not be loaded. Try again.";
}
