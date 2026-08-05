import { useState, type ReactNode } from "react";
import { dayLabel } from "../calendar/dates";
import { plainText } from "./daySheetOps";
import {
  BoxCheckedIcon,
  BoxIcon,
  ClockIcon,
  FlagIcon,
  PieceIcon,
} from "./notebookIcons";
import type { BlockLine, ItemLine, NotebookLine } from "./lines";
import { useDaySheet } from "./useDaySheet";
import "./ReadOnlyDaySheet.css";

export interface ReadOnlyDaySheetProps {
  /** The calendar date this browsed page is for (always a past date). */
  date: string;
  /** A piece heading still opens its Score Plan tab, when wired. */
  onOpenPiece?: (pieceId: number) => void;
  /**
   * Carry-forward (spec A8): when provided, unchecked `ItemLine`s and every
   * `BlockLine` get a "→ today" affordance in their action slot. Omitted
   * entirely when this page isn't hosted alongside today's live sheet (e.g.
   * standalone rendering), so no affordance appears with nothing to carry to.
   */
  onCarry?: (line: ItemLine | BlockLine) => void;
}

/**
 * A past day's page (spec A7), read straight from `day_sheet_get` with NO
 * autosave mounted (`useDaySheet(date, { readOnly: true })`) — nothing here can
 * write `day_sheet_save`, and a date the backend has no row for renders an
 * empty page with the caption rather than seeding one. The line markup mirrors
 * the live editor's (same tag shapes, same marker icons) but every control is
 * inert: no textarea, no checkbox click, no chip row. Each row carries a
 * `.ck-ro-line-actions` slot — empty unless `onCarry` is passed, in which case
 * unchecked items and blocks get a "→ today" carry-forward affordance there
 * (Task A8).
 */
export function ReadOnlyDaySheet({
  date,
  onOpenPiece,
  onCarry,
}: ReadOnlyDaySheetProps) {
  const sheet = useDaySheet(date, { readOnly: true });
  const label = dayLabel(date);

  return (
    <section
      className="ck-ro"
      data-testid="read-only-day-sheet"
      aria-label={`Read-only day sheet for ${label.weekday} ${label.date}`}
    >
      <p className="ck-ro-caption" data-testid="read-only-caption">
        read-only — {label.weekday} · {label.date}
      </p>

      {sheet.error && (
        <div className="ck-ro-alert" role="alert">
          {sheet.error}
        </div>
      )}

      {sheet.status !== "ready" ? null : sheet.body.length === 0 ? (
        <p className="ck-ro-empty" data-testid="read-only-empty">
          Nothing was written on this day.
        </p>
      ) : (
        <div className="ck-ro-doc" role="list">
          {sheet.body.map((line, index) => (
            <div role="listitem" key={index}>
              {renderReadOnlyLine(line, index, onOpenPiece, onCarry)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function renderReadOnlyLine(
  line: NotebookLine,
  index: number,
  onOpenPiece?: (pieceId: number) => void,
  onCarry?: (line: ItemLine | BlockLine) => void,
) {
  switch (line.type) {
    case "text":
      return (
        <ReadOnlyRow type="text" key={index}>
          <span className="ck-ro-text">{plainText(line)}</span>
        </ReadOnlyRow>
      );
    case "item":
      return (
        <ReadOnlyRow
          type="item"
          key={index}
          actions={
            onCarry && !line.checked ? (
              <CarryButton onCarry={() => onCarry(line)} />
            ) : null
          }
        >
          <span className="ck-ro-check" aria-hidden="true">
            {line.checked ? (
              <BoxCheckedIcon size={19} />
            ) : (
              <BoxIcon size={19} />
            )}
          </span>
          <span className="ck-ro-text" data-checked={line.checked}>
            {plainText(line)}
          </span>
        </ReadOnlyRow>
      );
    case "piece":
      return (
        <ReadOnlyRow type="piece" key={index}>
          <span className="ck-ro-mark" aria-hidden="true">
            <PieceIcon size={18} />
          </span>
          {onOpenPiece ? (
            <button
              type="button"
              className="ck-ro-piece-title"
              onClick={() => onOpenPiece(line.piece_id)}
            >
              Piece #{line.piece_id}
            </button>
          ) : (
            <span className="ck-ro-text">Piece #{line.piece_id}</span>
          )}
        </ReadOnlyRow>
      );
    case "block":
      return (
        <ReadOnlyRow
          type="block"
          key={index}
          actions={
            onCarry ? <CarryButton onCarry={() => onCarry(line)} /> : null
          }
        >
          <ClockIcon size={14} />
          <span className="ck-ro-text">{line.minutes} min</span>
        </ReadOnlyRow>
      );
    case "lesson_notes":
      return (
        <ReadOnlyRow type="lesson_notes" key={index}>
          <span className="ck-ro-label">Lesson notes</span>
          <p className="ck-ro-text">{line.text}</p>
        </ReadOnlyRow>
      );
    case "lesson_prep":
      return (
        <ReadOnlyRow type="lesson_prep" key={index}>
          <span className="ck-ro-label">Bring to lesson</span>
          <span className="ck-ro-text">
            {line.bring.length > 0
              ? line.bring.map((id) => `#${id}`).join(", ")
              : "—"}
          </span>
          <span className="ck-ro-label">What I wanted from the lesson</span>
          <p className="ck-ro-text">{line.want || "—"}</p>
        </ReadOnlyRow>
      );
    case "goal_ref":
      return (
        <ReadOnlyRow type="goal_ref" key={index}>
          <span className="ck-ro-mark" aria-hidden="true">
            <FlagIcon size={15} />
          </span>
          <span className="ck-ro-text">Goal #{line.goal_id}</span>
        </ReadOnlyRow>
      );
    default:
      return null;
  }
}

/** One read-only row: the line's own content, plus a per-line action slot. */
function ReadOnlyRow({
  type,
  children,
  actions,
}: {
  type: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ck-ro-line" data-type={type}>
      <div className="ck-ro-line-main paper-ruled">{children}</div>
      <div className="ck-ro-line-actions">{actions}</div>
    </div>
  );
}

/**
 * The "→ today" carry-forward affordance (spec A8). Feedback is purely
 * optimistic and local — no receipt machinery, no new IPC: the click fires
 * `onCarry` (which appends through today's own save path) and the button
 * flips to a brief "added ✓", staying disabled so the same click can't carry
 * the same line twice by accident (a fresh carry still works from the next
 * date visited, or after a remount).
 */
function CarryButton({ onCarry }: { onCarry: () => void }) {
  const [added, setAdded] = useState(false);
  return (
    <button
      type="button"
      className="ck-ro-carry"
      data-testid="carry-to-today"
      disabled={added}
      onClick={() => {
        onCarry();
        setAdded(true);
      }}
    >
      {added ? "added ✓" : "→ today"}
    </button>
  );
}
