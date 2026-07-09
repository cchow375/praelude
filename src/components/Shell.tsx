import { useRef, useState } from "react";
import { Popover } from "./Popover";
import "./Shell.css";

type PanelId = "metronome" | "mic" | "settings";

/**
 * The app shell: a slim top bar and a large, quiet hero area. Per the CodaKiller
 * spec the score will become the hero surface and ALL secondary UI lives in
 * popovers — nothing is pinned on screen. For now the top-bar buttons open empty
 * placeholder popovers.
 */
export function Shell() {
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const metronomeRef = useRef<HTMLButtonElement>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);

  const toggle = (id: PanelId) =>
    setOpenPanel((cur) => (cur === id ? null : id));
  const close = () => setOpenPanel(null);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="topbar-brand">CodaKiller</span>
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
            className="icon-button"
            aria-label="Microphone"
            aria-haspopup="dialog"
            aria-expanded={openPanel === "mic"}
            onClick={() => toggle("mic")}
          >
            <MicGlyph />
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

      <main className="hero">
        <div className="hero-placeholder">
          <p className="hero-title">Ready when you are.</p>
          <p className="hero-subtitle">
            Your score will appear here. Say the word to begin.
          </p>
        </div>
      </main>

      <Popover
        anchorRef={metronomeRef}
        open={openPanel === "metronome"}
        onClose={close}
        label="Metronome"
      >
        <PlaceholderPanel title="Metronome" />
      </Popover>
      <Popover
        anchorRef={micRef}
        open={openPanel === "mic"}
        onClose={close}
        label="Microphone"
      >
        <PlaceholderPanel title="Microphone" />
      </Popover>
      <Popover
        anchorRef={settingsRef}
        open={openPanel === "settings"}
        onClose={close}
        label="Settings"
      >
        <PlaceholderPanel title="Settings" />
      </Popover>
    </div>
  );
}

function PlaceholderPanel({ title }: { title: string }) {
  return (
    <div className="panel-placeholder">
      <p className="panel-title">{title}</p>
      <p className="panel-hint">Coming soon.</p>
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
