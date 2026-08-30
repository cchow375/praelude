import { useState, type FormEvent } from "react";
import { useTodaySheet } from "./DaySheetStore";
import {
  appendPlanItem,
  planItemsForPiece,
  toggleChecked,
  withPlainText,
} from "./daySheetOps";
import { BoxCheckedIcon, BoxIcon, PlusIcon } from "./notebookIcons";
import "./ScorePlanTab.css";

export interface ScorePlanTabProps {
  /** The visible Score piece; its TODAY plan items are shown (spec C3). */
  pieceId: number;
}

/**
 * The Score workspace "Plan" tab (spec C3): today's plan items for the visible
 * piece, read and written through the SAME shared store the day sheet edits, so
 * the two surfaces live-sync with no duplicate state. Checking an item is display
 * state on the sheet only — it never writes practice truth (attempt history stays
 * the sole evidence). Every item is free editable text; adding one appends a
 * checkbox line under the piece on the sheet.
 */
export function ScorePlanTab({ pieceId }: ScorePlanTabProps) {
  const sheet = useTodaySheet();
  const [draft, setDraft] = useState("");

  const items = planItemsForPiece(sheet.body, pieceId);

  const addItem = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    sheet.setBody((prev) => appendPlanItem(prev, pieceId, text).body);
    setDraft("");
  };

  return (
    <section className="score-plan" aria-label="Today's plan for this piece">
      <header className="score-plan-head">
        <span className="ck-label">Today's plan</span>
      </header>

      {sheet.error && (
        <p className="score-plan-alert" role="alert">
          {sheet.error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="score-plan-empty" data-testid="score-plan-empty">
          Nothing planned for this piece today. Add a line, or type it on the
          day sheet.
        </p>
      ) : (
        <ul className="score-plan-list">
          {items.map(({ index, line }) => (
            <li key={index} className="score-plan-item">
              <button
                type="button"
                role="checkbox"
                aria-checked={line.checked}
                aria-label={line.checked ? "Mark not done" : "Mark done"}
                className="score-plan-check"
                onClick={() =>
                  sheet.setBody((prev) => toggleChecked(prev, index))
                }
              >
                {line.checked ? <BoxCheckedIcon /> : <BoxIcon />}
              </button>
              <input
                type="text"
                className="score-plan-text"
                aria-label={`Plan item ${index + 1}`}
                data-checked={line.checked}
                value={line.text}
                onChange={(event) =>
                  sheet.setBody((prev) => {
                    const next = prev.slice();
                    next[index] = withPlainText(
                      prev[index],
                      event.target.value,
                    );
                    return next;
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      <form className="score-plan-add" onSubmit={addItem}>
        <PlusIcon size={14} />
        <input
          type="text"
          aria-label="Add a plan item"
          placeholder="Add a plan item for today…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}
