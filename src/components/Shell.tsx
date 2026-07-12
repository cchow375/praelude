import { useEffect, useRef, useState } from "react";
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
import "./Shell.css";

const VOICE_STATUS_LABEL: Record<VoiceStatus, string> = {
  live: "Listening",
  muted: "Muted",
  down: "Unavailable",
};

type PanelId = "metronome" | "mic" | "settings";
type ViewId = "practice" | "metronome";

/**
 * The app shell: a slim top bar and a large, quiet hero area. Per the CodaKiller
 * spec the score will become the hero surface and ALL secondary UI lives in
 * popovers — nothing is pinned on screen. For now the top-bar buttons open empty
 * placeholder popovers.
 */
export function Shell() {
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const [view, setView] = useState<ViewId>("practice");
  const [ending, setEnding] = useState(false);
  const metronomeRef = useRef<HTMLButtonElement>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const voice = useVoice();
  const rep = useRep();
  const session = useSession();
  const panelManager = usePanels();

  useEffect(() => {
    panelManager.register("rep", {
      x: Math.max(16, panelManager.viewport.w - 430),
      y: Math.max(68, panelManager.viewport.h - 390),
      w: 410,
      h: 360,
      collapsed: false,
      z: 42,
    });
    panelManager.register("session", {
      x: 16,
      y: 68,
      w: 350,
      h: 300,
      collapsed: false,
      z: 41,
    });
  }, [panelManager.register, panelManager.viewport.h, panelManager.viewport.w]);

  const toggle = (id: PanelId) =>
    setOpenPanel((cur) => (cur === id ? null : id));
  const close = () => setOpenPanel(null);

  const endSession = async () => {
    setEnding(true);
    try {
      await session.endSession();
    } finally {
      setEnding(false);
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-brand">CodaKiller</span>
          <nav className="view-switcher" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected={view === "practice"}
              className={`view-tab ${view === "practice" ? "is-on" : ""}`}
              onClick={() => setView("practice")}
            >
              Practice
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "metronome"}
              className={`view-tab ${view === "metronome" ? "is-on" : ""}`}
              onClick={() => setView("metronome")}
            >
              Metronome
            </button>
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

      {view === "practice" ? (
        <main className="practice-main" data-testid="main-practice">
          <PiecesPanel onOpenBlock={rep.open} />
        </main>
      ) : (
        <main className="hero">
          <div className="hero-placeholder">
            <p className="hero-title">Ready when you are.</p>
            <p className="hero-subtitle">
              The mic is always listening — no wake word needed. Try saying:
            </p>
            <ul className="hero-examples">
              <li>“metronome ninety-six”</li>
              <li>“bump it up four” · “faster” · “slower”</li>
              <li>“accent every three”</li>
              <li>“stop”</li>
            </ul>
            <p className="hero-footnote">
              Playing, singing, and conversation are ignored. Your score view
              arrives in a later update.
            </p>
          </div>
        </main>
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
      >
        <SettingsPanel onResetLayout={panelManager.resetLayout} />
      </Popover>

      <VoiceToast
        lastIntent={voice.lastIntent}
        status={voice.status}
        downGuidance={voice.downGuidance}
      />

      {/* Session + rep surfaces live at shell level so they are visible from
          both the Practice and Metronome views. */}
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

function SettingsPanel({ onResetLayout }: { onResetLayout: () => void }) {
  return (
    <div className="panel-placeholder">
      <p className="panel-title">Workspace</p>
      <p className="panel-hint">Moved a window somewhere awkward?</p>
      <button type="button" className="voice-panel-button" onClick={onResetLayout}>Reset panel layout</button>
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
