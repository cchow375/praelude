import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "./Popover";
import { MetronomePopover } from "../features/metronome/MetronomePopover";
import { useVoice, type VoiceStatus } from "../features/voice/useVoice";
import { VoiceToast } from "../features/voice/VoiceToast";
import { PiecesPanel } from "../features/pieces/PiecesPanel";
import { useRep } from "../features/rep/useRep";
import { RepHud } from "../features/rep/RepHud";
import { useSession } from "../features/session/useSession";
import { SessionBar } from "../features/session/SessionBar";
import { FloatingPanel } from "./FloatingPanel";
import { usePanels } from "./usePanels";
import { BrainWorkspace } from "../features/brain/BrainWorkspace";
import type { WakeQuestion } from "../features/brain/types";
import { CalendarWorkspace } from "../features/calendar/CalendarWorkspace";
import { UniverseWorkspace } from "../features/universe/UniverseWorkspace";
import type { PracticePieceContext } from "../features/universe/types";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import type { ThemePref } from "../design/theme";
import { version as appVersion } from "../../package.json";
import "./Shell.css";

const VOICE_STATUS_LABEL: Record<VoiceStatus, string> = {
  live: "Listening",
  muted: "Muted",
  down: "Unavailable",
};

type PanelId = "metronome" | "mic" | "settings";
type ViewId = "home" | "practice" | "calendar" | "brain";

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: "home", label: "Home" },
  { id: "practice", label: "Practice" },
  { id: "calendar", label: "Calendar" },
  { id: "brain", label: "Brain" },
];

/** The app shell: Home plus focused workspaces and always-reachable tools. */
export function Shell({ onThemeChange }: { onThemeChange?: (theme: ThemePref) => void }) {
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const [view, setView] = useState<ViewId>("home");
  const [practiceContext, setPracticeContext] = useState<PracticePieceContext | null>(null);
  const [wakeQuestion, setWakeQuestion] = useState<WakeQuestion | null>(null);
  const [ending, setEnding] = useState(false);
  const wakeQuestionId = useRef(0);
  const metronomeRef = useRef<HTMLButtonElement>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const viewTabRefs = useRef<Partial<Record<ViewId, HTMLButtonElement | null>>>({});
  const voice = useVoice();
  const rep = useRep();
  const session = useSession();
  const panelManager = usePanels();

  // useVoice owns the one global voice://intent listener. A wake-prefixed
  // non-command arrives as kind=question; open Brain and hand it off once.
  useEffect(() => {
    if (voice.lastIntent?.kind !== "question") return;
    wakeQuestionId.current += 1;
    setWakeQuestion({ id: wakeQuestionId.current, text: voice.lastIntent.text });
    setView("brain");
  }, [voice.lastIntent]);

  useEffect(() => {
    panelManager.register("rep", {
      x: Math.max(16, panelManager.viewport.w - 430),
      y: 68,
      w: 410,
      h: 330,
      collapsed: false,
      z: 42,
    });
    panelManager.register("session", {
      x: Math.min(Math.max(310, panelManager.viewport.w / 2 - 130), panelManager.viewport.w - 276),
      y: 7,
      w: 260,
      h: 180,
      collapsed: true,
      z: 41,
    });
  }, [panelManager.register, panelManager.viewport.h, panelManager.viewport.w]);

  const toggle = (id: PanelId) =>
    setOpenPanel((cur) => (cur === id ? null : id));
  const close = () => setOpenPanel(null);

  const navigateView = (nextView: ViewId, focus = false) => {
    setView(nextView);
    if (focus) requestAnimationFrame(() => viewTabRefs.current[nextView]?.focus());
  };

  const onViewKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: ViewId) => {
    const index = VIEWS.findIndex((item) => item.id === current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % VIEWS.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + VIEWS.length) % VIEWS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = VIEWS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    navigateView(VIEWS[nextIndex].id, true);
  };

  const endSession = async () => {
    setEnding(true);
    try {
      await session.endSession();
    } finally {
      setEnding(false);
    }
  };

  return (
    <div className={`shell ${rep.snap ? "has-rep-panel" : ""}`}>
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-identity">
            <span className="topbar-brand">CodaKiller</span>
            <span className="topbar-version" aria-label={`Version ${appVersion}`}>
              v{appVersion}
            </span>
          </div>
          <nav className="view-switcher" aria-label="View" role="tablist">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                ref={(node) => { viewTabRefs.current[item.id] = node; }}
                id={`tab-${item.id}`}
                type="button"
                role="tab"
                aria-controls={`panel-${item.id}`}
                aria-selected={view === item.id}
                tabIndex={view === item.id ? 0 : -1}
                className={`view-tab ${view === item.id ? "is-on" : ""}`}
                onClick={() => navigateView(item.id)}
                onKeyDown={(event) => onViewKeyDown(event, item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <nav className="topbar-actions" aria-label="Tools">
          <button
            ref={metronomeRef}
            type="button"
            className="icon-button"
            aria-label="Metronome"
            aria-haspopup="dialog"
            aria-expanded={openPanel === "metronome"}
            onClick={() => toggle("metronome")}
          >
            <MetronomeGlyph />
          </button>
          <button
            ref={micRef}
            type="button"
            className={`icon-button voice-mic is-${voice.status}`}
            aria-label="Microphone"
            aria-haspopup="dialog"
            aria-expanded={openPanel === "mic"}
            onClick={() => toggle("mic")}
          >
            <MicGlyph />
            <span
              className="voice-status-dot"
              data-status={voice.status}
              aria-hidden="true"
            />
          </button>
          <button
            ref={settingsRef}
            type="button"
            className="icon-button"
            aria-label="Settings"
            aria-haspopup="dialog"
            aria-expanded={openPanel === "settings"}
            onClick={() => toggle("settings")}
          >
            <SettingsGlyph />
          </button>
        </nav>
      </header>

      {view === "home" ? (
        <UniverseWorkspace
          onOpenPractice={(piece) => {
            setPracticeContext(piece);
            navigateView("practice");
          }}
        />
      ) : view === "practice" ? (
        <main className="practice-main" data-testid="main-practice" id="panel-practice" role="tabpanel" aria-labelledby="tab-practice">
          {practiceContext && (
            <div className="practice-context" role="status">
              <span><strong>{practiceContext.title}</strong> is selected for practice tools.</span>
              <span>Open its piece card below to view the score and Regions.</span>
              <button type="button" onClick={() => setPracticeContext(null)} aria-label="Dismiss selected piece context">Dismiss</button>
            </div>
          )}
          <PiecesPanel onOpenBlock={rep.open} activeRep={rep.snap} />
        </main>
      ) : view === "calendar" ? (
        <div id="panel-calendar" role="tabpanel" aria-labelledby="tab-calendar" className="workspace-panel-reset">
          <CalendarWorkspace />
        </div>
      ) : (
        <div id="panel-brain" role="tabpanel" aria-labelledby="tab-brain" className="workspace-panel-reset">
          <BrainWorkspace wakeQuestion={wakeQuestion} />
        </div>
      )}

      <MetronomePopover
        anchorRef={metronomeRef}
        open={openPanel === "metronome"}
        onClose={close}
      />
      <Popover
        anchorRef={micRef}
        open={openPanel === "mic"}
        onClose={close}
        label="Microphone"
      >
        <VoiceMicPanel status={voice.status} onMute={voice.mute} />
      </Popover>
      <Popover
        anchorRef={settingsRef}
        open={openPanel === "settings"}
        onClose={close}
        label="Settings"
        size="wide"
      >
        <SettingsPanel onResetLayout={panelManager.resetLayout} onThemeSaved={onThemeChange} />
      </Popover>

      <VoiceToast
        lastIntent={voice.lastIntent}
        status={voice.status}
        downGuidance={voice.downGuidance}
      />

      {/* Session + rep surfaces live at shell level so practice tools remain
          available while moving between workspaces. */}
      {session.session && panelManager.panels.session && (
        <FloatingPanel
          geometry={panelManager.panels.session}
          title="Practice session"
          viewport={panelManager.viewport}
          onGeometryChange={panelManager.update}
          onFocus={panelManager.raise}
          testId="panel-session"
        >
          <SessionBar session={session.session} onEnd={endSession} ending={ending} />
        </FloatingPanel>
      )}
      {rep.snap && panelManager.panels.rep && (
        <FloatingPanel
          geometry={panelManager.panels.rep}
          title="Active block"
          viewport={panelManager.viewport}
          onGeometryChange={panelManager.update}
          onFocus={panelManager.raise}
          testId="panel-rep"
        >
          <RepHud snap={rep.snap} feed={rep.feed} error={rep.error} onCheck={rep.check} onClose={rep.close} />
        </FloatingPanel>
      )}
    </div>
  );
}

/** The mic popover panel: current voice status plus a mute/unmute toggle. */
function VoiceMicPanel({
  status,
  onMute,
}: {
  status: VoiceStatus;
  onMute: (muted: boolean) => void;
}) {
  const isMuted = status === "muted";
  return (
    <div className="voice-panel">
      <div className="voice-panel-status">
        <span className="voice-status-dot" data-status={status} aria-hidden="true" />
        <span className="voice-panel-label">{VOICE_STATUS_LABEL[status]}</span>
      </div>
      <button
        type="button"
        className="voice-panel-button"
        onClick={() => onMute(!isMuted)}
      >
        {isMuted ? "Unmute" : "Mute"}
      </button>
    </div>
  );
}

/* --- Minimal inline glyphs (stroke follows currentColor) ------------------ */

function MetronomeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M9 3.5h6l3.5 17H5.5L9 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 18 16 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="16" cy="7" r="1.4" fill="currentColor" />
    </svg>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
