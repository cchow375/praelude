import { useEffect, useRef, useState } from "react";
import { ASSISTANT } from "../../shell/terms";
import { TodayPracticePanel } from "./TodayPracticePanel";
import { compactDuration, todayLabel } from "./format";
import { StreakLine } from "../streak/StreakLine";
import { useStreak } from "../streak/useStreak";
import {
  PraeludeMark,
  ListIcon,
  NoteIcon,
  OrbitIcon,
  SheetIcon,
  SlidersIcon,
  SparkIcon,
  WarmupIcon,
} from "./menuIcons";
import "./TodayWorkspace.css";

interface TodayWorkspaceProps {
  /** Opens the Score workspace with no requested piece (the "Score" entry and
   *  the panel's Atlas launcher share this). */
  onOpenAtlas: () => void;
  onOpenWarmups: () => void;
  onOpenCalendar: () => void;
  /** Deep link (spec C3): a day-sheet piece heading opens Score on the Plan tab. */
  onOpenPiecePlan: (pieceId: number) => void;
  onOpenBrain: () => void;
  onOpenLedger: () => void;
  onOpenUniverse: () => void;
  onOpenSettings: () => void;
  /** Christian's 2026-08-24 request: the Assistant is off by default and can
   *  be fully disabled in Settings. Hides this menu entry when it is. */
  assistantEnabled?: boolean;
}

/**
 * The app's main menu. Not a landing page: a quiet app mark, the date, and
 * launcher entries. "Today's Practice" opens the real day surfaces as a window
 * over this menu (day-sheet-first, spec C5); the rest of the entries jump
 * straight to a workspace.
 */
export function TodayWorkspace({
  onOpenAtlas,
  onOpenWarmups,
  onOpenCalendar,
  onOpenPiecePlan,
  onOpenBrain,
  onOpenLedger,
  onOpenUniverse,
  onOpenSettings,
  assistantEnabled = false,
}: TodayWorkspaceProps) {
  const [practiceOpen, setPracticeOpen] = useState(false);
  const practiceTriggerRef = useRef<HTMLButtonElement>(null);
  const streak = useStreak();

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
        onClose={closePractice}
      />
    );
  }

  return (
    <div className="today-menu" data-testid="today-menu">
      <div className="today-menu-inner">
        <div className="today-menu-mark">
          <PraeludeMark className="today-menu-mark-glyph" />
          <span className="today-menu-wordmark">Praelude</span>
        </div>

        <p className="today-date today-menu-date">{todayLabel()}</p>
        <StreakLine summary={streak} />

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
            onClick={onOpenWarmups}
          >
            <WarmupIcon className="today-menu-icon" />
            <span>Warmups</span>
          </button>
          {assistantEnabled && (
            <button
              type="button"
              className="today-menu-item"
              onClick={onOpenBrain}
            >
              <SparkIcon className="today-menu-icon" />
              <span>{ASSISTANT}</span>
            </button>
          )}
          <button
            type="button"
            className="today-menu-item"
            onClick={onOpenLedger}
          >
            <ListIcon className="today-menu-icon" />
            <span>Pieces</span>
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
    </div>
  );
}

export { compactDuration, todayLabel };
