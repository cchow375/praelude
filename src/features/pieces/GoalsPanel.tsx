import { useEffect, useState } from "react";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import { EditableField } from "../../components/EditableField";
import { useCrud } from "../rep/useCrud";
import type { Goal } from "./types";

export function GoalsPanel({ pieceId }: { pieceId: number }) {
  const crud = useCrud();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [draft, setDraft] = useState("");

  async function load() {
    setGoals((await crud.goalList(pieceId)) ?? []);
  }

  useEffect(() => { void load(); }, [pieceId]);

  async function reorder(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= goals.length) return;
    const next = [...goals];
    [next[index], next[target]] = [next[target], next[index]];
    setGoals(next);
    await crud.goalReorder(pieceId, next.map((goal) => goal.id));
  }

  return (
    <section className="goals-panel" aria-label="Goals">
      <div className="piece-section-heading"><span className="ck-label">Goals</span><span className="piece-section-hint">Double-click to edit</span></div>
      <ul className="goals-list">
        {goals.map((goal, index) => (
          <li key={goal.id} className={goal.done ? "goal-row is-done" : "goal-row"}>
            <input type="checkbox" checked={goal.done} aria-label={`Complete ${goal.text}`} onChange={async (event) => { await crud.goalUpdate(goal.id, { done: event.target.checked }); await load(); }} />
            <EditableField value={goal.text} ariaLabel="goal text" onSave={async (text) => { await crud.goalUpdate(goal.id, { text }); await load(); }} />
            <span className="goal-order-controls"><button type="button" disabled={index === 0} aria-label={`Move ${goal.text} up`} onClick={() => void reorder(index, -1)}>↑</button><button type="button" disabled={index === goals.length - 1} aria-label={`Move ${goal.text} down`} onClick={() => void reorder(index, 1)}>↓</button></span>
            <ConfirmDelete label="Delete this goal?" onConfirm={async () => { await crud.goalDelete(goal.id); await load(); }}><button type="button" className="history-delete" aria-label={`Delete goal ${goal.text}`}>×</button></ConfirmDelete>
          </li>
        ))}
      </ul>
      <form className="goal-add" onSubmit={async (event) => { event.preventDefault(); const text = draft.trim(); if (!text) return; await crud.goalCreate({ piece_id: pieceId, text, kind: "big", parent_goal_id: null, target_date: null }); setDraft(""); await load(); }}>
        <input className="ck-input" value={draft} aria-label="New goal" placeholder="Add a goal…" onChange={(event) => setDraft(event.target.value)} />
        <button className="ck-add" type="submit">Add</button>
      </form>
    </section>
  );
}
