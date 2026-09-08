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
  StudioIcon,
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

/** A quiet practice launchpad: music first, today's notes beside it, and
 * supporting workspaces a single click away. No progress is invented here. */
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

        <header className="today-welcome">
          <p className="today-date today-menu-date">{todayLabel()}</p>
          <h1>A space for your practice.</h1>
          <StreakLine summary={streak} />
        </header>

        <nav className="today-menu-nav" aria-label="Main menu">
          <div className="today-practice-launchers">
            <button
              type="button"
              aria-label="Score"
              className="today-menu-item today-score-launch is-primary"
              onClick={onOpenAtlas}
            >
              <NoteIcon className="today-menu-icon" />
              <span className="today-launch-copy">
                <strong>Open Score</strong>
                <span>Your music. One passage at a time.</span>
              </span>
              <span className="today-launch-arrow" aria-hidden="true">↗</span>
            </button>
            <button
              ref={practiceTriggerRef}
              type="button"
              aria-label="Today's Practice"
              className="today-menu-item today-notes-launch"
              onClick={() => setPracticeOpen(true)}
            >
              <SheetIcon className="today-menu-icon" />
              <span className="today-launch-copy">
                <strong>Today's Practice</strong>
                <span>Your plan, notes, and next steps.</span>
              </span>
              <span className="today-launch-arrow" aria-hidden="true">↗</span>
            </button>
          </div>

          <div className="today-workspace-links">
            <button
              type="button"
              aria-label="Pieces"
              className="today-menu-item"
              onClick={onOpenLedger}
            >
              <ListIcon className="today-menu-icon" />
              <span className="today-launch-copy">
                <strong>Pieces</strong>
                <span>Your repertoire</span>
              </span>
            </button>
            <button
              type="button"
              aria-label="Warmups"
              className="today-menu-item"
              onClick={onOpenWarmups}
            >
              <WarmupIcon className="today-menu-icon" />
              <span className="today-launch-copy">
                <strong>Warmups</strong>
                <span>Settle into playing</span>
              </span>
            </button>
            <button
              type="button"
              aria-label="Studio"
              className="today-menu-item"
              onClick={onOpenUniverse}
            >
              <StudioIcon className="today-menu-icon" />
              <span className="today-launch-copy">
                <strong>Studio</strong>
                <span>Watch your practice grow</span>
              </span>
            </button>
          </div>

          <div className="today-utility-links">
            <button type="button" className="today-utility-link" onClick={onOpenCalendar}>
              Calendar
            </button>
            {assistantEnabled && (
              <button type="button" className="today-utility-link" onClick={onOpenBrain}>
                <SparkIcon />
                {ASSISTANT}
              </button>
            )}
            <button type="button" className="today-utility-link" onClick={onOpenSettings}>
              <SlidersIcon />
              Settings
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}

export { compactDuration, todayLabel };
