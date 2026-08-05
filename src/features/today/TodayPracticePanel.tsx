import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useComposerCandidates, type ComposerCandidateApi } from "../composer";
import { todayLocal } from "../calendar/dates";
import { useTodaySheet } from "../notebook/DaySheetStore";
import { insertSuggestion } from "../notebook/daySheetOps";
import { MetronomeQuickBar } from "../metronome/MetronomeQuickBar";
import { DaySheetNav } from "./DaySheetNav";
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
 * block) into the same sheet, never a second surface. The active-set HUD no
 * longer docks here at all (Task A3) — it moved to a shell-level floating
 * Practice Dock panel that persists over every workspace, this window
 * included, so it never has to be threaded down into this surface; receipts
 * and recovery live underneath as before. Esc, the ×, or the trigger returns
 * to the menu.
 */
export function TodayPracticePanel({
  onOpenAtlas,
  onOpenCalendar,
  onOpenPiecePlan,
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
    // Not a modal. This used to be a `position: fixed; inset: 0` window floating
    // over a dimmed copy of the app, which left the nav rail and session strip
    // showing through around its edges — two stacked surfaces with a hairline
    // between them, which reads as a rendering glitch rather than as depth
    // (Christian: "you are rendering everything wrong"). It is now the Today
    // workspace's own content: TodayWorkspace renders EITHER the menu or this,
    // so there is nothing behind it to show through. Esc and the × close it.
    <div className="today-practice-surface">
      <div
        // A landmark region, NOT role="dialog"/aria-modal. This is the Today
        // workspace's content now, so claiming the rest of the app is inert
        // would be a lie to a screen reader — the nav rail really is reachable.
        role="region"
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
          <DaySheetNav onOpenPiece={onOpenPiecePlan} />

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
