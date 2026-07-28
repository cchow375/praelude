import { useRef, useState } from "react";
import type { PracticePieceContext } from "../universe/types";
import type { RepSnapshot } from "../rep/useRep";
import { ASSISTANT, HISTORY } from "../../shell/terms";
import { TodayPracticePanel } from "./TodayPracticePanel";
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

// One tasteful placeholder practice line for the menu's quote slot. Phase D
// replaces this with a deterministic rotation over the verified quotes.json
// corpus — the single-line slot, styling, and behaviour are already final.
const PLACEHOLDER_QUOTE = "Slow practice is fast learning.";

interface TodayWorkspaceProps {
  /** Opens the Score workspace with no requested piece (the "Score" entry and
   *  the panel's Atlas launchers share this). */
  onOpenAtlas: () => void;
  onOpenCalendar: () => void;
  onOpenPiece: (piece: PracticePieceContext) => void;
  onOpenBrain: () => void;
  onOpenLedger: () => void;
  onOpenUniverse: () => void;
  onOpenSettings: () => void;
  defaultCleanStreak?: number;
  /** The live rep set, forwarded to the practice panel's plan progression. */
  activeBlock?: RepSnapshot | null;
}

/**
 * The app's main menu. Not a landing page: a quiet app mark, the date, a single
 * practice line, and quiet launcher entries. "Today's Practice" opens the real
 * day surfaces as a window over this menu (all prior Today functionality lives
 * there, unchanged); the rest of the entries jump straight to a workspace.
 */
export function TodayWorkspace({
  onOpenAtlas,
  onOpenCalendar,
  onOpenPiece,
  onOpenBrain,
  onOpenLedger,
  onOpenUniverse,
  onOpenSettings,
  defaultCleanStreak = 5,
  activeBlock = null,
}: TodayWorkspaceProps) {
  const [practiceOpen, setPracticeOpen] = useState(false);
  const practiceTriggerRef = useRef<HTMLButtonElement>(null);

  const closePractice = () => {
    setPracticeOpen(false);
    // Return focus to the entry that opened the window (it stays mounted under
    // the scrim), so keyboard users are not dropped onto <body>.
    practiceTriggerRef.current?.focus();
  };

  return (
    <div className="today-menu" data-testid="today-menu">
      <div className="today-menu-inner">
        <div className="today-menu-mark">
          <CodaMark className="today-menu-mark-glyph" />
          <span className="today-menu-wordmark">CodaKiller</span>
        </div>

        <p className="today-date today-menu-date">{todayLabel()}</p>
        <p className="today-menu-quote" title={PLACEHOLDER_QUOTE}>
          {PLACEHOLDER_QUOTE}
        </p>

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

      {practiceOpen && (
        <TodayPracticePanel
          onOpenAtlas={onOpenAtlas}
          onOpenCalendar={onOpenCalendar}
          onOpenPiece={onOpenPiece}
          defaultCleanStreak={defaultCleanStreak}
          activeBlock={activeBlock}
          onClose={closePractice}
        />
      )}
    </div>
  );
}

export { compactDuration, todayLabel };
