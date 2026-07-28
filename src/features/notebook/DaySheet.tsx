import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { defineCommand, executeCommand } from "../../services/command";
import { useReceipts } from "../receipts/ReceiptCenter";
import { addDays, parseLocalDate, todayLocal } from "../calendar/dates";
import type { Goal, PieceSummary } from "../pieces/types";
import type { DaySheet as DaySheetData, NotebookLine } from "./lines";
import { useDaySheet } from "./useDaySheet";
import {
  addBring,
  clampMinutes,
  convertToPiece,
  insertAfter,
  insertBlock,
  insertIntoText,
  insertPiece,
  joinBackspace,
  nextEditableIndex,
  outdent,
  indent,
  pieceContextAt,
  plainText,
  prevEditableIndex,
  removeAt,
  removeBring,
  setMinutes,
  setWant,
  splitLine,
  toGoalRef,
  toggleChecked,
  totalMinutes,
  unchecked,
  withPlainText,
  type Caret,
} from "./daySheetOps";
import {
  BoxCheckedIcon,
  BoxIcon,
  ChevronIcon,
  ClockIcon,
  CloseIcon,
  FlagIcon,
  NotesIcon,
  PieceIcon,
  PlusIcon,
} from "./notebookIcons";
import "./DaySheet.css";

// Read-only companions the editor needs but the day-sheet hook doesn't own:
// the piece list (for headings + the picker), yesterday's page (copy-forward),
// and the goal domain (promotion + inline goal edits). All go through the same
// typed command boundary as everything else.
const PIECES_LIST = defineCommand<undefined, PieceSummary[]>(
  "pieces_list",
  "Your pieces could not be loaded.",
);
const DAY_SHEET_GET = defineCommand<{ date: string }, DaySheetData | null>(
  "day_sheet_get",
  "Yesterday's page could not be read.",
);
const GOAL_LIST = defineCommand<{ pieceId: number }, Goal[]>(
  "goal_list",
  "Goals could not be read.",
);
const GOAL_CREATE = defineCommand<
  {
    args: {
      piece_id: number;
      text: string;
      kind: "big" | "sub";
      parent_goal_id: number | null;
      target_date: string | null;
    };
  },
  Goal
>("goal_create", "The goal could not be created.");
const GOAL_UPDATE = defineCommand<
  { id: number; patch: Partial<Pick<Goal, "text" | "target_date">> },
  Goal
>("goal_update", "The goal could not be updated.");

const DEFAULT_BLOCK_MINUTES = 25;

/** The focused item's text shortcuts — chips that INSERT editable text (spec C1). */
const ITEM_CHIPS: { label: string; snippet: string; hint: string }[] = [
  { label: "mm.", snippet: "mm. ", hint: "Add a section / measures" },
  { label: "learn:", snippet: "learn: ", hint: "Mark something to learn" },
  { label: "♩", snippet: "♩=", hint: "Set a tempo" },
];

function fullDateLabel(date: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(parseLocalDate(date));
  } catch {
    return date;
  }
}

export interface DaySheetProps {
  /** The calendar date this page is for; defaults to today. */
  date?: string;
  /** Clicking a piece heading opens its Score Plan tab (spec C3), when wired. */
  onOpenPiece?: (pieceId: number) => void;
}

/**
 * The day sheet (spec C1): one paper-like column you type into. Every line is a
 * typed NotebookLine, and every line reads and edits as text — chips and pickers
 * only ADD or REMOVE structure, never anything the user can't also type or
 * delete. Persistence, debounce, reconcile and save receipts are the day-sheet
 * hook's job; this component owns the cursor-first editing surface over its body.
 */
export function DaySheet({ date = todayLocal(), onOpenPiece }: DaySheetProps) {
  const sheet = useDaySheet(date);
  const { body, setBody } = sheet;
  const receipts = useReceipts();

  const [pieces, setPieces] = useState<PieceSummary[]>([]);
  const [goalCache, setGoalCache] = useState<Map<number, Goal>>(new Map());
  const [yesterday, setYesterday] = useState<NotebookLine[] | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [collapsedNotes, setCollapsedNotes] = useState<Set<number>>(new Set());
  const [picker, setPicker] = useState<{
    mode: "insert" | "convert" | "bring";
    index: number;
  } | null>(null);

  // Focus follows structural edits: an op stashes where the caret must land, and
  // the layout effect places it after the resulting render commits the new rows.
  const textRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());
  const pendingFocus = useRef<Caret | null>(null);
  const queriedPieces = useRef<Set<number>>(new Set());

  const registerText = useCallback(
    (index: number, el: HTMLTextAreaElement | null) => {
      if (el) textRefs.current.set(index, el);
      else textRefs.current.delete(index);
    },
    [],
  );

  const focusCaret = useCallback((caret: Caret) => {
    const el = textRefs.current.get(caret.index);
    if (!el) return;
    el.focus();
    const pos = Math.min(caret.offset, el.value.length);
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      /* jsdom / non-text inputs: focus alone is enough */
    }
  }, []);

  useLayoutEffect(() => {
    const caret = pendingFocus.current;
    if (!caret) return;
    pendingFocus.current = null;
    focusCaret(caret);
  });

  // Pieces load once; the editor renders "Piece #id" until they arrive.
  useEffect(() => {
    let alive = true;
    executeCommand(PIECES_LIST, undefined).then(
      (list) => {
        if (alive) setPieces(list);
      },
      () => {
        /* the sheet is still fully usable without piece titles */
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  // Yesterday's page (for the quiet copy-forward affordance). Reloads per date.
  useEffect(() => {
    let alive = true;
    executeCommand(DAY_SHEET_GET, { date: addDays(date, -1) }).then(
      (prev) => {
        if (alive)
          setYesterday(prev && prev.body.length > 0 ? prev.body : null);
      },
      () => {
        if (alive) setYesterday(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [date]);

  // Resolve the text + deadline behind any goal_ref line by reading its piece's
  // goals. Bounded: each piece context is queried at most once (an unresolved
  // ref then renders a bare fallback rather than refetching forever).
  useEffect(() => {
    const wanted = new Set<number>();
    body.forEach((line, index) => {
      if (line.type !== "goal_ref" || goalCache.has(line.goal_id)) return;
      const context = pieceContextAt(body, index);
      if (context != null && !queriedPieces.current.has(context)) {
        wanted.add(context);
      }
    });
    if (wanted.size === 0) return;
    wanted.forEach((id) => queriedPieces.current.add(id));
    let alive = true;
    Promise.all(
      [...wanted].map((pieceId) =>
        executeCommand(GOAL_LIST, { pieceId }).catch(() => [] as Goal[]),
      ),
    ).then((lists) => {
      if (!alive) return;
      setGoalCache((prev) => {
        const next = new Map(prev);
        lists.flat().forEach((goal) => next.set(goal.id, goal));
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [body, goalCache]);

  const pieceTitle = useCallback(
    (pieceId: number) =>
      pieces.find((piece) => piece.id === pieceId)?.title ??
      `Piece #${pieceId}`,
    [pieces],
  );
  const pieceComposer = useCallback(
    (pieceId: number) =>
      pieces.find((piece) => piece.id === pieceId)?.composer ?? null,
    [pieces],
  );

  const total = useMemo(() => totalMinutes(body), [body]);

  // --- Editing primitives --------------------------------------------------

  const editText = useCallback(
    (index: number, value: string) => {
      setBody((prev) => {
        const next = prev.slice();
        next[index] = withPlainText(prev[index], value);
        return next;
      });
      // Typing "/piece" on its own line opens the picker to swap it for a heading.
      if (value.trim() === "/piece") {
        setPicker({ mode: "convert", index });
      }
    },
    [setBody],
  );

  const runEdit = useCallback(
    (edit: { body: NotebookLine[]; caret: Caret }) => {
      pendingFocus.current = edit.caret;
      setBody(edit.body);
    },
    [setBody],
  );

  const onTextKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>, index: number) => {
      const el = event.currentTarget;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      switch (event.key) {
        case "Enter": {
          if (event.shiftKey) return; // Shift+Enter is a literal newline
          event.preventDefault();
          runEdit(splitLine(body, index, start));
          return;
        }
        case "Backspace": {
          if (start !== 0 || end !== 0) return;
          const edit = joinBackspace(body, index);
          if (edit) {
            event.preventDefault();
            runEdit(edit);
          }
          return;
        }
        case "Tab": {
          event.preventDefault();
          pendingFocus.current = { index, offset: start };
          setBody(event.shiftKey ? outdent(body, index) : indent(body, index));
          return;
        }
        case "ArrowUp": {
          if (start !== 0) return;
          const prev = prevEditableIndex(body, index);
          if (prev != null) {
            event.preventDefault();
            focusCaret({ index: prev, offset: Number.MAX_SAFE_INTEGER });
          }
          return;
        }
        case "ArrowDown": {
          if (start !== el.value.length) return;
          const nextIndex = nextEditableIndex(body, index);
          if (nextIndex != null) {
            event.preventDefault();
            focusCaret({ index: nextIndex, offset: 0 });
          }
          return;
        }
        default:
      }
    },
    [body, focusCaret, runEdit, setBody],
  );

  // Chip: insert editable text at the focused item's caret (spec C1). The chip
  // row suppresses mousedown so the textarea keeps focus + selection.
  const insertChip = useCallback(
    (index: number, snippet: string) => {
      const el = textRefs.current.get(index);
      const offset = el ? (el.selectionStart ?? el.value.length) : Infinity;
      const { line, caret } = insertIntoText(body[index], offset, snippet);
      const next = body.slice();
      next[index] = line;
      pendingFocus.current = { index, offset: caret };
      setBody(next);
    },
    [body, setBody],
  );

  const addBlock = useCallback(
    (index: number) => {
      setBody(insertBlock(body, index, DEFAULT_BLOCK_MINUTES).body);
    },
    [body, setBody],
  );

  const addLine = useCallback(
    (line: NotebookLine, afterIndex: number) => {
      setBody(insertAfter(body, afterIndex, line).body);
    },
    [body, setBody],
  );

  const promoteGoal = useCallback(
    async (index: number) => {
      const line = body[index];
      if (line.type !== "item") return;
      const context = pieceContextAt(body, index);
      if (context == null) return; // a goal must belong to a piece (backend rule)
      try {
        const goal = await executeCommand(GOAL_CREATE, {
          args: {
            piece_id: context,
            text: line.text,
            kind: "big",
            parent_goal_id: null,
            target_date: null,
          },
        });
        setGoalCache((prev) => new Map(prev).set(goal.id, goal));
        setBody((prev) => toGoalRef(prev, index, goal.id));
        receipts.committed("Goal created from this line.");
      } catch (cause) {
        receipts.error(cause, "The goal could not be created.");
      }
    },
    [body, receipts, setBody],
  );

  const commitGoal = useCallback(
    async (id: number, patch: Partial<Pick<Goal, "text" | "target_date">>) => {
      setGoalCache((prev) => {
        const existing = prev.get(id);
        if (!existing) return prev;
        return new Map(prev).set(id, { ...existing, ...patch });
      });
      try {
        const goal = await executeCommand(GOAL_UPDATE, { id, patch });
        setGoalCache((prev) => new Map(prev).set(goal.id, goal));
      } catch (cause) {
        receipts.error(cause, "The goal could not be updated.");
      }
    },
    [receipts],
  );

  const choosePiece = useCallback(
    (pieceId: number) => {
      if (!picker) return;
      if (picker.mode === "insert") {
        setBody(insertPiece(body, picker.index, pieceId).body);
      } else if (picker.mode === "convert") {
        setBody(convertToPiece(body, picker.index, pieceId));
      } else {
        setBody(addBring(body, picker.index, pieceId));
      }
      setPicker(null);
    },
    [body, picker, setBody],
  );

  const seedFirstLine = useCallback(
    (value: string) => {
      pendingFocus.current = { index: 0, offset: value.length };
      setBody([{ type: "text", text: value }]);
    },
    [setBody],
  );

  const toggleNotes = useCallback((index: number) => {
    setCollapsedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // --- Rows ----------------------------------------------------------------

  const renderText = (line: NotebookLine, index: number, isItem: boolean) => {
    const text = plainText(line) ?? "";
    const focused = focusedIndex === index;
    return (
      <div className="ck-ns-line" data-type={isItem ? "item" : "text"}>
        <div className="ck-ns-line-main">
          {isItem && line.type === "item" && (
            <button
              type="button"
              role="checkbox"
              aria-checked={line.checked}
              aria-label={line.checked ? "Mark not done" : "Mark done"}
              className="ck-ns-check"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setBody(toggleChecked(body, index))}
            >
              {line.checked ? <BoxCheckedIcon /> : <BoxIcon />}
            </button>
          )}
          <AutoText
            value={text}
            data-checked={
              isItem && line.type === "item" ? line.checked : undefined
            }
            placeholder={index === 0 ? "Write your practice for the day…" : ""}
            ariaLabel={isItem ? `Plan item ${index + 1}` : `Line ${index + 1}`}
            registerRef={(el) => registerText(index, el)}
            onChange={(value) => editText(index, value)}
            onKeyDown={(event) => onTextKeyDown(event, index)}
            onFocus={() => setFocusedIndex(index)}
          />
        </div>
        {focused && isItem && (
          <div
            className="ck-ns-tools"
            onMouseDown={(event) => event.preventDefault()}
          >
            {ITEM_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className="ck-ns-chip"
                title={chip.hint}
                onClick={() => insertChip(index, chip.snippet)}
              >
                {chip.label}
              </button>
            ))}
            <button
              type="button"
              className="ck-ns-chip"
              onClick={() => addBlock(index)}
            >
              <ClockIcon size={13} /> {DEFAULT_BLOCK_MINUTES} min
            </button>
            <button
              type="button"
              className="ck-ns-chip"
              disabled={pieceContextAt(body, index) == null}
              title={
                pieceContextAt(body, index) == null
                  ? "Add this under a piece to make it a goal"
                  : "Promote to a goal with a deadline"
              }
              onClick={() => void promoteGoal(index)}
            >
              <FlagIcon size={13} /> goal
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderPiece = (line: NotebookLine, index: number) => {
    if (line.type !== "piece") return null;
    const focused = focusedIndex === index;
    const composer = pieceComposer(line.piece_id);
    return (
      <div className="ck-ns-line" data-type="piece">
        <div className="ck-ns-piece">
          <span className="ck-ns-piece-mark" aria-hidden="true">
            <PieceIcon size={18} />
          </span>
          <button
            type="button"
            className="ck-ns-piece-title"
            onFocus={() => setFocusedIndex(index)}
            onClick={() => onOpenPiece?.(line.piece_id)}
          >
            {pieceTitle(line.piece_id)}
          </button>
          {composer && <span className="ck-ns-piece-by">{composer}</span>}
          <span className="ck-ns-line-spacer" />
          <button
            type="button"
            className="ck-ns-icon-btn"
            aria-label="Remove piece"
            onClick={() => setBody(removeAt(body, index))}
          >
            <CloseIcon size={14} />
          </button>
        </div>
        {focused && (
          <div
            className="ck-ns-tools"
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className="ck-ns-chip"
              onClick={() => addBlock(index)}
            >
              <ClockIcon size={13} /> {DEFAULT_BLOCK_MINUTES} min
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderBlock = (line: NotebookLine, index: number) => {
    if (line.type !== "block") return null;
    return (
      <div className="ck-ns-line" data-type="block">
        <div className="ck-ns-block">
          <ClockIcon size={14} />
          <MinutesChip
            minutes={line.minutes}
            onCommit={(minutes) => setBody(setMinutes(body, index, minutes))}
          />
          <span className="ck-ns-line-spacer" />
          <button
            type="button"
            className="ck-ns-icon-btn"
            aria-label="Remove timed block"
            onClick={() => setBody(removeAt(body, index))}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      </div>
    );
  };

  const renderNotes = (line: NotebookLine, index: number) => {
    if (line.type !== "lesson_notes") return null;
    const open = !collapsedNotes.has(index);
    return (
      <div className="ck-ns-line" data-type="lesson_notes">
        <button
          type="button"
          className="ck-ns-fold"
          aria-expanded={open}
          onClick={() => toggleNotes(index)}
        >
          <span className="ck-ns-fold-mark" data-open={open} aria-hidden="true">
            <ChevronIcon size={14} />
          </span>
          <NotesIcon size={15} />
          Lesson notes
        </button>
        {open && (
          <textarea
            className="ck-ns-notes-text"
            aria-label="Lesson notes"
            placeholder="What the teacher said…"
            value={line.text}
            rows={2}
            onChange={(event) =>
              setBody((prev) => {
                const next = prev.slice();
                next[index] = {
                  type: "lesson_notes",
                  text: event.target.value,
                };
                return next;
              })
            }
          />
        )}
      </div>
    );
  };

  const renderPrep = (line: NotebookLine, index: number) => {
    if (line.type !== "lesson_prep") return null;
    return (
      <div className="ck-ns-line" data-type="lesson_prep">
        <div className="ck-ns-prep">
          <div className="ck-ns-prep-col">
            <span className="ck-ns-prep-label">Bring to lesson</span>
            <div className="ck-ns-prep-bring">
              {line.bring.map((pieceId) => (
                <span key={pieceId} className="ck-ns-bring-chip">
                  {pieceTitle(pieceId)}
                  <button
                    type="button"
                    aria-label={`Remove ${pieceTitle(pieceId)} from bring list`}
                    onClick={() => setBody(removeBring(body, index, pieceId))}
                  >
                    <CloseIcon size={12} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="ck-ns-quiet"
                onClick={() => setPicker({ mode: "bring", index })}
              >
                <PlusIcon size={13} /> piece
              </button>
            </div>
          </div>
          <div className="ck-ns-prep-col">
            <span className="ck-ns-prep-label">
              What I want from the lesson
            </span>
            <textarea
              className="ck-ns-notes-text"
              aria-label="What I want from the lesson"
              placeholder="A question, a passage, a decision…"
              value={line.want}
              rows={2}
              onChange={(event) =>
                setBody(setWant(body, index, event.target.value))
              }
            />
          </div>
          <button
            type="button"
            className="ck-ns-icon-btn ck-ns-prep-remove"
            aria-label="Remove lesson prep"
            onClick={() => setBody(removeAt(body, index))}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      </div>
    );
  };

  const renderGoal = (line: NotebookLine, index: number) => {
    if (line.type !== "goal_ref") return null;
    const goal = goalCache.get(line.goal_id);
    return (
      <div className="ck-ns-line" data-type="goal_ref">
        <div className="ck-ns-goal">
          <span className="ck-ns-goal-mark" aria-hidden="true">
            <FlagIcon size={15} />
          </span>
          <input
            type="text"
            className="ck-ns-goal-text"
            aria-label="Goal"
            placeholder="Goal"
            value={goal?.text ?? ""}
            onFocus={() => setFocusedIndex(index)}
            onChange={(event) =>
              setGoalCache((prev) => {
                const existing = prev.get(line.goal_id);
                if (!existing) return prev;
                return new Map(prev).set(line.goal_id, {
                  ...existing,
                  text: event.target.value,
                });
              })
            }
            onBlur={(event) =>
              void commitGoal(line.goal_id, { text: event.target.value })
            }
          />
          <input
            type="date"
            className="ck-ns-goal-date"
            aria-label="Goal deadline"
            value={goal?.target_date ?? ""}
            onChange={(event) =>
              void commitGoal(line.goal_id, {
                target_date: event.target.value || null,
              })
            }
          />
          <button
            type="button"
            className="ck-ns-icon-btn"
            aria-label="Remove goal from sheet"
            onClick={() => setBody(removeAt(body, index))}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      </div>
    );
  };

  const renderLine = (line: NotebookLine, index: number) => {
    switch (line.type) {
      case "text":
        return renderText(line, index, false);
      case "item":
        return renderText(line, index, true);
      case "piece":
        return renderPiece(line, index);
      case "block":
        return renderBlock(line, index);
      case "lesson_notes":
        return renderNotes(line, index);
      case "lesson_prep":
        return renderPrep(line, index);
      case "goal_ref":
        return renderGoal(line, index);
      default:
        return null;
    }
  };

  const insertTarget = focusedIndex != null ? focusedIndex : body.length - 1;

  return (
    <section
      className="ck-ns"
      data-testid="day-sheet"
      aria-label={`Day sheet for ${fullDateLabel(date)}`}
    >
      <header className="ck-ns-head">
        <p className="ck-ns-date">{fullDateLabel(date)}</p>
        {total > 0 && (
          <p className="ck-ns-total" aria-label={`${total} minutes planned`}>
            {total} min planned
          </p>
        )}
      </header>

      {sheet.error && (
        <div className="ck-ns-alert" role="alert">
          {sheet.error}
        </div>
      )}

      {sheet.status !== "ready" ? null : body.length === 0 ? (
        <div className="ck-ns-blank" data-testid="day-sheet-blank">
          <input
            type="text"
            className="ck-ns-ghost"
            aria-label="Start the day sheet"
            placeholder="Write your practice for the day…"
            value=""
            onChange={(event) => seedFirstLine(event.target.value)}
          />
          {yesterday && (
            <button
              type="button"
              className="ck-ns-quiet ck-ns-copy"
              onClick={() => setBody(unchecked(yesterday))}
            >
              Copy yesterday
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="ck-ns-doc" role="list">
            {body.map((line, index) => (
              <div role="listitem" key={index}>
                {renderLine(line, index)}
              </div>
            ))}
          </div>
          <div
            className="ck-ns-foot"
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className="ck-ns-quiet"
              onClick={() => setPicker({ mode: "insert", index: insertTarget })}
            >
              <PlusIcon size={14} /> piece
            </button>
            <button
              type="button"
              className="ck-ns-quiet"
              onClick={() =>
                addLine({ type: "lesson_notes", text: "" }, insertTarget)
              }
            >
              <PlusIcon size={14} /> lesson notes
            </button>
            <button
              type="button"
              className="ck-ns-quiet"
              onClick={() =>
                addLine(
                  { type: "lesson_prep", bring: [], want: "" },
                  insertTarget,
                )
              }
            >
              <PlusIcon size={14} /> lesson prep
            </button>
          </div>
        </>
      )}

      {picker && (
        <PiecePicker
          pieces={pieces}
          onPick={choosePiece}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}

// --- Small building blocks -------------------------------------------------

interface AutoTextProps {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  registerRef: (el: HTMLTextAreaElement | null) => void;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  "data-checked"?: boolean;
}

/** A one-line-feeling textarea that grows with its text (paper, not a form field). */
function AutoText({
  value,
  placeholder,
  ariaLabel,
  registerRef,
  onChange,
  onKeyDown,
  onFocus,
  ...rest
}: AutoTextProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      {...rest}
      ref={(el) => {
        ref.current = el;
        registerRef(el);
      }}
      className="ck-ns-text"
      rows={1}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    />
  );
}

interface MinutesChipProps {
  minutes: number;
  onCommit: (minutes: number) => void;
}

/** An editable "N min" chip; commits a clamped integer on blur / Enter. */
function MinutesChip({ minutes, onCommit }: MinutesChipProps) {
  const [draft, setDraft] = useState(String(minutes));
  useEffect(() => {
    setDraft(String(minutes));
  }, [minutes]);
  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isFinite(parsed)) {
      const clamped = clampMinutes(parsed);
      setDraft(String(clamped));
      if (clamped !== minutes) onCommit(clamped);
    } else {
      setDraft(String(minutes));
    }
  };
  return (
    <span className="ck-ns-minutes">
      <input
        type="text"
        inputMode="numeric"
        aria-label="Block minutes"
        className="ck-ns-minutes-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <span className="ck-ns-minutes-unit">min</span>
    </span>
  );
}

interface PiecePickerProps {
  pieces: PieceSummary[];
  onPick: (pieceId: number) => void;
  onClose: () => void;
}

/** A one-click piece picker (spec C1). Type to filter; Esc / Cancel dismisses. */
function PiecePicker({ pieces, onPick, onClose }: PiecePickerProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pieces;
    return pieces.filter(
      (piece) =>
        piece.title.toLowerCase().includes(q) ||
        (piece.composer ?? "").toLowerCase().includes(q),
    );
  }, [pieces, query]);
  return (
    <div className="ck-ns-picker-scrim" onMouseDown={onClose}>
      <div
        className="ck-ns-picker"
        role="dialog"
        aria-label="Choose a piece"
        data-testid="piece-picker"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <input
          ref={inputRef}
          type="text"
          className="ck-ns-picker-input"
          aria-label="Find a piece"
          placeholder="Find a piece…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="ck-ns-picker-list">
          {filtered.map((piece) => (
            <li key={piece.id}>
              <button type="button" onClick={() => onPick(piece.id)}>
                <span className="ck-ns-picker-title">{piece.title}</span>
                {piece.composer && (
                  <span className="ck-ns-picker-by">{piece.composer}</span>
                )}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="ck-ns-picker-empty">No pieces found.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
