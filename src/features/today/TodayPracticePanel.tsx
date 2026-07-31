import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useComposerCandidates, type ComposerCandidateApi } from "../composer";
import { todayLocal } from "../calendar/dates";
import { TodayDaySheet, useTodaySheet } from "../notebook/DaySheetStore";
import { insertSuggestion } from "../notebook/daySheetOps";
import { MetronomeQuickBar } from "../metronome/MetronomeQuickBar";
import { CloseIcon } from "./menuIcons";
import "./TodayWorkspace.css";

export interface TodayPracticePanelProps {
  /** Quiet entry point to the full Score library from inside the window. */
  onOpenAtlas: () => void;
  /** Quiet entry point to the Calendar (past-day sheets live there — spec C1). */
  onOpenCalendar: () => void;
  /** Deep link (spec C3): a day-sheet piece heading opens Score on that piece's
   *  Plan tab. Threaded up to the shell's score navigation idiom. */
  onOpenPiecePlan: (pieceId: number) => void;
  /** The shell-owned active-set HUD, docked here so it stays reachable over the
   *  window while a practice set is live (requirement 2). Null when no set. */
  activeSetHud?: ReactNode;
  /** Dismisses the panel back to the main menu (Esc, the ×, or the trigger). */
  onClose: () => void;
  /** Test seam for the suggested-from-retention evidence; native by default. */
  candidateApi?: ComposerCandidateApi;
}

/**
 * Today's Practice, re-housed as a window over the main menu and rebuilt
 * day-sheet-first (spec C5). The notebook IS the surface: you open the window and
 * type your practice. The old plain-language plan box, the launch board, and the
 * parallel session composer are gone; retention/repair evidence now appears as one
 * quiet "suggested" fold that INSERTS real plan lines (a checkbox item + a timed
 * block) into the same sheet, never a second surface. The active-set HUD docks as
 * a strip along the FOOT of the window — it used to sit above the sheet, where it
 * pushed the writing surface below the fold and made the whole screen read as a
 * form; receipts and recovery live underneath as before. Esc, the ×, or the
 * trigger returns to the menu.
 */
export function TodayPracticePanel({
  onOpenAtlas,
  onOpenCalendar,
  onOpenPiecePlan,
  activeSetHud = null,
  onClose,
  candidateApi,
}: TodayPracticePanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Move focus into the window on open so keyboard dismissal works and the
  // background menu is not left focused underneath.
  useEffect(() => {
    const raf = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // Let a nested surface (a popover, a confirm) claim Escape first; it will
      // stop propagation. Anything reaching the window closes it.
      event.stopPropagation();
      onClose();
    }
  };

  return (
    // The scrim only dims the menu; it does not dismiss, so a stray click never
    // discards an in-progress notebook edit. Esc and the × are the closers.
    <div className="today-practice-overlay">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Today's Practice"
        tabIndex={-1}
        className="today-practice-window"
        data-testid="today-practice-panel"
        onKeyDown={onKeyDown}
      >
        {/* Chrome, not a hero. The window's own title bar is one thin strip so
            the page below it starts at the top of the surface; the full date is
            written on the sheet itself, where a date belongs. */}
        <header className="today-practice-head">
          <h1 id="today-practice-title">Today's Practice</h1>
          <div className="today-practice-head-tools">
            <MetronomeQuickBar />
            <button
              ref={closeRef}
              type="button"
              className="today-practice-close"
              aria-label="Close Today's Practice"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="today-practice-body">
          <TodayDaySheet onOpenPiece={onOpenPiecePlan} />

          <div className="today-practice-margin">
            <SuggestedFromRetention candidateApi={candidateApi} />

            <div className="today-practice-foot">
              <button
                type="button"
                className="ck-text-action"
                onClick={onOpenCalendar}
              >
                Open the Calendar
              </button>
              <button
                type="button"
                className="ck-text-action"
                onClick={onOpenAtlas}
              >
                Open Score
              </button>
            </div>
          </div>
        </div>

        {/* The live set docks as a strip along the foot of the window rather than
            as a card stacked on top of the page: it stays reachable the whole
            time a set is open without ever displacing the writing surface. The
            HUD's own layout is owned elsewhere; this is only the dock. */}
        {activeSetHud && (
          <div className="today-practice-hud" data-testid="today-practice-hud">
            {activeSetHud}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The single quiet "suggested from retention" fold (spec C5). Due retention
 * checks, recent-failure repairs, and planned work are shown as suggestions;
 * accepting one INSERTS a checkbox plan item and a timed block (its minutes) into
 * the same day sheet through the shared store. It is never a parallel plan.
 */
function SuggestedFromRetention({
  candidateApi,
}: {
  candidateApi?: ComposerCandidateApi;
}) {
  const sheet = useTodaySheet();
  const [open, setOpen] = useState(false);
  // Fetch candidates only once the fold is opened — the collapsed summary is
  // static text, so eager 1+2N invokes on every window open buy nothing.
  const { candidates, loading, error } = useComposerCandidates({
    active: open,
    asOfDate: todayLocal(),
    api: candidateApi,
  });
  const [added, setAdded] = useState<Set<string>>(new Set());

  const insert = (candidate: (typeof candidates)[number]) => {
    const pieceId = Number(candidate.piece_ref);
    if (!Number.isInteger(pieceId) || pieceId < 1) return;
    const label =
      (candidate.target_label ?? candidate.piece_label ?? "Practice").trim() ||
      "Practice";
    sheet.setBody((prev) =>
      insertSuggestion(prev, pieceId, label, candidate.estimated_minutes),
    );
    setAdded((prev) => new Set(prev).add(candidate.id));
  };

  return (
    <details
      className="today-suggested"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="ck-kicker">Suggested from retention</span>
        <strong>Add due checks and repairs to the sheet</strong>
      </summary>
      {open &&
        (error ? (
          <p className="today-suggested-note" role="status">
            {error}
          </p>
        ) : loading && candidates.length === 0 ? (
          <p className="today-suggested-note" role="status">
            Reading due retention, repair, and planned work…
          </p>
        ) : candidates.length === 0 ? (
          <p className="today-suggested-note" role="status">
            Nothing is suggested right now.
          </p>
        ) : (
          <ul className="today-suggested-list">
            {candidates.map((candidate) => {
              const isAdded = added.has(candidate.id);
              return (
                <li key={candidate.id}>
                  <div className="today-suggested-copy">
                    <strong>
                      {candidate.target_label ??
                        candidate.piece_label ??
                        "Practice"}
                    </strong>
                    <span>
                      {candidate.piece_label ?? "Selected repertoire"} ·{" "}
                      {candidate.estimated_minutes} min
                    </span>
                  </div>
                  <button
                    type="button"
                    className="ck-text-action"
                    disabled={isAdded}
                    onClick={() => insert(candidate)}
                  >
                    {isAdded ? "Added" : "Add to today"}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
    </details>
  );
}
