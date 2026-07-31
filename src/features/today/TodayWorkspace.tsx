import { useEffect, useRef, useState, type ReactNode } from "react";
import { ASSISTANT, HISTORY } from "../../shell/terms";
import { TodayPracticePanel } from "./TodayPracticePanel";
import { ReaderWindow } from "../reader/ReaderWindow";
import { clampToWords } from "./quoteRotation";
import { useHomeQuote, useQuoteSignals } from "./quoteSignals";
import { compactDuration, todayLabel } from "./format";
import {
  CodaMark,
  ListIcon,
  NoteIcon,
  OrbitIcon,
  SheetIcon,
  SlidersIcon,
  SparkIcon,
} from "./menuIcons";
import "./TodayWorkspace.css";

interface TodayWorkspaceProps {
  /** Opens the Score workspace with no requested piece (the "Score" entry and
   *  the panel's Atlas launcher share this). */
  onOpenAtlas: () => void;
  onOpenCalendar: () => void;
  /** Deep link (spec C3): a day-sheet piece heading opens Score on the Plan tab. */
  onOpenPiecePlan: (pieceId: number) => void;
  onOpenBrain: () => void;
  onOpenLedger: () => void;
  onOpenUniverse: () => void;
  onOpenSettings: () => void;
  /** The shell-owned active-set HUD, docked into the practice window so it stays
   *  reachable while a set is live (requirement 2). */
  activeSetHud?: ReactNode;
  /** Lets the shell hide its own stage HUD while the window owns it (no double). */
  onPracticeOpenChange?: (open: boolean) => void;
}

/**
 * The app's main menu. Not a landing page: a quiet app mark, the date, a single
 * cycling quote, and quiet launcher entries. "Today's Practice" opens the real
 * day surfaces as a window over this menu (day-sheet-first, spec C5); the rest of
 * the entries jump straight to a workspace.
 */
export function TodayWorkspace({
  onOpenAtlas,
  onOpenCalendar,
  onOpenPiecePlan,
  onOpenBrain,
  onOpenLedger,
  onOpenUniverse,
  onOpenSettings,
  activeSetHud = null,
  onPracticeOpenChange,
}: TodayWorkspaceProps) {
  const [practiceOpen, setPracticeOpen] = useState(false);
  const practiceTriggerRef = useRef<HTMLButtonElement>(null);
  // The quote answers what he is actually doing, so it is resolved only once the
  // signals are in — a pick made on half-read state would have to be swapped out
  // a moment later. The rotation only advances when the context has genuinely
  // moved on, so navigating back to the menu does not burn a new quote; the
  // CONNECTOR, though, is re-derived from live signals on every render and is
  // never carried over from the state the pick was made in (see useHomeQuote).
  const { quote, connector } = useHomeQuote(useQuoteSignals());
  const [readerOpen, setReaderOpen] = useState(false);

  // Keep the shell informed so it can hand HUD ownership to the window while the
  // window is open (and reclaim its stage dock when the window closes).
  useEffect(() => {
    onPracticeOpenChange?.(practiceOpen);
  }, [practiceOpen, onPracticeOpenChange]);

  // The practice page REPLACES the menu rather than floating over it, so the
  // trigger is unmounted while it is open and cannot be focused synchronously
  // on close. Ask for the focus and hand it over once the menu is back.
  const restoreMenuFocus = useRef(false);

  const closePractice = () => {
    restoreMenuFocus.current = true;
    setPracticeOpen(false);
  };

  useEffect(() => {
    if (practiceOpen || !restoreMenuFocus.current) return;
    restoreMenuFocus.current = false;
    // Never drop a keyboard user onto <body>.
    practiceTriggerRef.current?.focus();
  }, [practiceOpen]);

  if (practiceOpen) {
    return (
      <TodayPracticePanel
        onOpenAtlas={onOpenAtlas}
        onOpenCalendar={onOpenCalendar}
        onOpenPiecePlan={onOpenPiecePlan}
        activeSetHud={activeSetHud}
        onClose={closePractice}
      />
    );
  }

  return (
    <div className="today-menu" data-testid="today-menu">
      <div className="today-menu-inner">
        <div className="today-menu-mark">
          <CodaMark className="today-menu-mark-glyph" />
          <span className="today-menu-wordmark">CodaKiller</span>
        </div>

        <p className="today-date today-menu-date">{todayLabel()}</p>
        {/* The slot keeps its height while the signals resolve, so the menu
            below it never jumps when the quote arrives. */}
        <div className="today-menu-quote-slot">
          {connector && (
            <p
              className="today-menu-quote-why"
              data-testid="today-menu-quote-why"
            >
              {connector.connector}
            </p>
          )}
          {quote && (
            <button
              type="button"
              className="today-menu-quote"
              title={`${quote.text} — ${quote.author}`}
              aria-label={`Open the reader for this quote by ${quote.author}`}
              data-testid="today-menu-quote"
              onClick={() => setReaderOpen(true)}
            >
              <span className="today-menu-quote-text">
                “{clampToWords(quote.text)}”
              </span>
              <span className="today-menu-quote-author"> — {quote.author}</span>
            </button>
          )}
        </div>

        <nav className="today-menu-nav" aria-label="Main menu">
          <button
            ref={practiceTriggerRef}
            type="button"
            className="today-menu-item is-primary"
            onClick={() => setPracticeOpen(true)}
          >
            <SheetIcon className="today-menu-icon" />
            <span>Today's Practice</span>
          </button>
          <button
            type="button"
            className="today-menu-item"
            onClick={onOpenAtlas}
          >
            <NoteIcon className="today-menu-icon" />
            <span>Score</span>
          </button>
          <button
            type="button"
            className="today-menu-item"
            onClick={onOpenBrain}
          >
            <SparkIcon className="today-menu-icon" />
            <span>{ASSISTANT}</span>
          </button>
          <button
            type="button"
            className="today-menu-item"
            onClick={onOpenLedger}
          >
            <ListIcon className="today-menu-icon" />
            <span>{HISTORY}</span>
          </button>
          <button
            type="button"
            className="today-menu-item"
            onClick={onOpenUniverse}
          >
            <OrbitIcon className="today-menu-icon" />
            <span>Universe</span>
          </button>
          <button
            type="button"
            className="today-menu-item"
            onClick={onOpenSettings}
          >
            <SlidersIcon className="today-menu-icon" />
            <span>Settings</span>
          </button>
        </nav>
      </div>

      {readerOpen && quote && (
        <ReaderWindow
          quote={{
            sourceId: quote.source_id,
            text: quote.text,
            author: quote.author,
            book: quote.book,
            heading: quote.heading,
          }}
          onClose={() => setReaderOpen(false)}
        />
      )}
    </div>
  );
}

export { compactDuration, todayLabel };
