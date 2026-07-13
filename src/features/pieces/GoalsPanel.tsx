import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { EditableField } from "../../components/EditableField";
import { useCrud } from "../rep/useCrud";
import type { Goal } from "./types";
import type { DailyWork } from "../calendar/types";

export interface GoalsApi {
  goalList: (pieceId: number) => Promise<Goal[]>;
  goalCreate: (args: {
    piece_id: number;
    text: string;
    kind: "big" | "sub";
    parent_goal_id: number | null;
    target_date: string | null;
  }) => Promise<Goal>;
  goalUpdate: (id: number, patch: Partial<Pick<Goal, "text" | "done" | "target_date" | "parent_goal_id">>) => Promise<Goal>;
  goalDelete: (id: number) => Promise<void>;
  goalReorder: (pieceId: number, orderedIds: number[]) => Promise<void>;
  dailyWorkList: (pieceId: number) => Promise<DailyWork[]>;
}

export function GoalsPanel({ pieceId, api: injectedApi }: { pieceId: number; api?: GoalsApi }) {
  const defaultApi = useCrud();
  const api: GoalsApi = injectedApi ?? {
    ...defaultApi,
    dailyWorkList: (id) => invoke<DailyWork[]>("daily_work_list", {
      from: "0001-01-01",
      to: "9999-12-31",
      pieceId: id,
    }),
  };
  const [goals, setGoals] = useState<Goal[]>([]);
  const [dailyWork, setDailyWork] = useState<DailyWork[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [nextGoals, nextWork] = await Promise.all([
        api.goalList(pieceId),
        api.dailyWorkList(pieceId),
      ]);
      setGoals(nextGoals ?? []);
      setDailyWork(nextWork ?? []);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [pieceId]);

  async function mutate(operation: () => Promise<unknown>) {
    setError(null);
    try {
      await operation();
      await load();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  }

  async function reorder(siblings: Goal[], index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    const next = [...siblings];
    [next[index], next[target]] = [next[target], next[index]];
    setGoals((current) => current.map((goal) => {
      const nextIndex = next.findIndex((candidate) => candidate.id === goal.id);
      return nextIndex < 0 ? goal : { ...goal, order: nextIndex };
    }));
    try {
      await api.goalReorder(pieceId, next.map((goal) => goal.id));
    } catch (cause) {
      setError(errorMessage(cause));
      await load();
    }
  }

  const bigGoals = useMemo(() => goals
    .filter((goal) => goal.kind === "big" && goal.parent_goal_id === null)
    .sort(byOrder), [goals]);

  return (
    <section className="goals-panel" aria-label="Goals">
      <div className="piece-section-heading">
        <span className="ck-label">Goals</span>
        <span className="piece-section-hint">Big goals → concrete subgoals</span>
      </div>
      {error && <p className="ck-inline-error" role="alert">{error}</p>}
      {loading ? (
        <p className="goal-empty" role="status">Loading goals…</p>
      ) : bigGoals.length === 0 ? (
        <p className="goal-empty">No goals yet. Add the outcome you are working toward.</p>
      ) : (
        <ul className="goals-list goal-tree">
          {bigGoals.map((goal, index) => {
            const children = goals.filter((candidate) => candidate.parent_goal_id === goal.id).sort(byOrder);
            return (
              <GoalBranch
                key={goal.id}
                goal={goal}
                siblings={bigGoals}
                index={index}
                children={children}
                dailyWork={dailyWork}
                pieceId={pieceId}
                api={api}
                onMutate={mutate}
                onReorder={reorder}
              />
            );
          })}
        </ul>
      )}
      <form className="goal-add" onSubmit={async (event) => {
        event.preventDefault();
        const text = draft.trim();
        if (!text) return;
        const saved = await mutate(() => api.goalCreate({
          piece_id: pieceId,
          text,
          kind: "big",
          parent_goal_id: null,
          target_date: null,
        }));
        if (saved) setDraft("");
      }}>
        <input className="ck-input" value={draft} aria-label="New big goal" placeholder="Add a big goal…" onChange={(event) => setDraft(event.target.value)} />
        <button className="ck-add" type="submit">Add goal</button>
      </form>
    </section>
  );
}

function GoalBranch({
  goal,
  siblings,
  index,
  children,
  dailyWork,
  pieceId,
  api,
  onMutate,
  onReorder,
}: {
  goal: Goal;
  siblings: Goal[];
  index: number;
  children: Goal[];
  dailyWork: DailyWork[];
  pieceId: number;
  api: GoalsApi;
  onMutate: (operation: () => Promise<unknown>) => Promise<boolean>;
  onReorder: (siblings: Goal[], index: number, direction: -1 | 1) => Promise<void>;
}) {
  const [addingSubgoal, setAddingSubgoal] = useState(false);
  const [subgoalDraft, setSubgoalDraft] = useState("");
  const doneChildren = children.filter((child) => child.done).length;
  const branchGoalIds = new Set([goal.id, ...children.map((child) => child.id)]);
  const branchWork = dailyWork.filter((item) => branchGoalIds.has(item.goal_id));
  const plannedWork = branchWork.filter((item) => item.status === "planned").length;
  const doneWork = branchWork.filter((item) => item.status === "done").length;
  return (
    <li className={`goal-branch ${goal.done ? "is-done" : ""}`}>
      <GoalRow goal={goal} siblings={siblings} index={index} onMutate={onMutate} onReorder={onReorder} api={api} />
      <div className="goal-summary" aria-label={`Summary for ${goal.text}`}>
        <span>{children.length === 0 ? "No subgoals" : `${doneChildren}/${children.length} subgoals done`}</span>
        <span>{branchWork.length === 0 ? "No calendar work" : `${branchWork.length} calendar ${branchWork.length === 1 ? "item" : "items"} · ${plannedWork} planned · ${doneWork} done`}</span>
      </div>
      {children.length > 0 && (
        <ul className="goal-children">
          {children.map((child, childIndex) => (
            <li key={child.id} className={child.done ? "is-done" : ""}>
              <GoalRow goal={child} siblings={children} index={childIndex} onMutate={onMutate} onReorder={onReorder} api={api} />
            </li>
          ))}
        </ul>
      )}
      {addingSubgoal ? (
        <form className="goal-add goal-add-sub" onSubmit={async (event) => {
          event.preventDefault();
          const text = subgoalDraft.trim();
          if (!text) return;
          const saved = await onMutate(() => api.goalCreate({
            piece_id: pieceId,
            text,
            kind: "sub",
            parent_goal_id: goal.id,
            target_date: null,
          }));
          if (saved) {
            setSubgoalDraft("");
            setAddingSubgoal(false);
          }
        }}>
          <input autoFocus className="ck-input" aria-label={`New subgoal for ${goal.text}`} value={subgoalDraft} onChange={(event) => setSubgoalDraft(event.target.value)} />
          <button className="ck-add" type="submit">Add</button>
          <button className="ck-add is-quiet" type="button" onClick={() => setAddingSubgoal(false)}>Cancel</button>
        </form>
      ) : (
        <button
          className="goal-add-subgoal"
          type="button"
          aria-label={`Add subgoal to ${goal.text}`}
          onClick={() => setAddingSubgoal(true)}
        >+ Add subgoal</button>
      )}
    </li>
  );
}

function GoalRow({
  goal,
  siblings,
  index,
  api,
  onMutate,
  onReorder,
}: {
  goal: Goal;
  siblings: Goal[];
  index: number;
  api: GoalsApi;
  onMutate: (operation: () => Promise<unknown>) => Promise<boolean>;
  onReorder: (siblings: Goal[], index: number, direction: -1 | 1) => Promise<void>;
}) {
  return (
    <div className="goal-row">
      <input type="checkbox" checked={goal.done} aria-label={`Complete ${goal.text}`} onChange={(event) => void onMutate(() => api.goalUpdate(goal.id, { done: event.target.checked }))} />
      <EditableField value={goal.text} ariaLabel="goal text" onSave={async (text) => { await onMutate(() => api.goalUpdate(goal.id, { text })); }} />
      <label className="goal-date">
        <span className="sr-only">Target date for {goal.text}</span>
        <input
          type="date"
          aria-label={`Target date for ${goal.text}`}
          value={goal.target_date ?? ""}
          onChange={(event) => void onMutate(() => api.goalUpdate(goal.id, { target_date: event.target.value || null }))}
        />
      </label>
      <span className="goal-order-controls">
        <button type="button" disabled={index === 0} aria-label={`Move ${goal.text} up`} onClick={() => void onReorder(siblings, index, -1)}>↑</button>
        <button type="button" disabled={index === siblings.length - 1} aria-label={`Move ${goal.text} down`} onClick={() => void onReorder(siblings, index, 1)}>↓</button>
      </span>
      <ConfirmDelete label="Delete this goal?" onConfirm={async () => { await onMutate(() => api.goalDelete(goal.id)); }}>
        <button type="button" className="history-delete" aria-label={`Delete goal ${goal.text}`}>×</button>
      </ConfirmDelete>
    </div>
  );
}

function byOrder(left: Goal, right: Goal) {
  return left.order - right.order || left.id - right.id;
}

function errorMessage(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return "Goals could not be updated. Try again.";
}
