import { useState } from "react";
import type { LastRep, RepSnapshot, Verdict } from "./useRep";
import "./RepHud.css";

// ---------------------------------------------------------------------------
// The rep HUD: a pinned strip that appears whenever a block is open (snap is
// non-null), floating above whichever view is showing. It mirrors the block —
// piece, measure range, the big rep counter, current tempo, the active variant
// — and offers the three verdicts. Clean / Sloppy / Again map to the SAME
// `rep_check` verdicts the voice loop sends (clean / flawed / failed), so the
// button and voice paths are one. An optional note rides along with the next
// verdict, and the last five verdicts show as a compact feed.
// ---------------------------------------------------------------------------

interface RepHudProps {
  snap: RepSnapshot | null;
  feed: LastRep[];
  error: string | null;
  onCheck: (verdict: Verdict, note?: string | null) => void;
  onClose: () => void;
}

const VERDICT_BUTTONS: { verdict: Verdict; label: string; cls: string }[] = [
  { verdict: "clean", label: "Clean", cls: "is-clean" },
  { verdict: "flawed", label: "Sloppy", cls: "is-flawed" },
  { verdict: "failed", label: "Again", cls: "is-failed" },
];

const VERDICT_SYMBOL: Record<string, string> = {
  clean: "✓",
  flawed: "~",
  failed: "✗",
};

export function RepHud({ snap, feed, error, onCheck, onClose }: RepHudProps) {
  const [note, setNote] = useState("");

  // Nothing to show without an active block — the HUD is fully hidden.
  if (!snap) return null;

  const submit = (verdict: Verdict) => {
    const trimmed = note.trim();
    onCheck(verdict, trimmed === "" ? null : trimmed);
    setNote("");
  };

  const range =
    snap.m_start === snap.m_end
      ? `m. ${snap.m_start}`
      : `mm. ${snap.m_start}–${snap.m_end}`;

  return (
    <div className="rep-hud" role="region" aria-label="Active practice block">
      <div className="rep-hud-inner">
        <div className="rep-hud-context">
          <span className="rep-hud-piece">{snap.piece_title}</span>
          <span className="rep-hud-range">{range}</span>
          {snap.label && <span className="rep-hud-label">{snap.label}</span>}
          {snap.variant && (
            <span className="rep-hud-variant" title="Active variant">
              {snap.variant}
            </span>
          )}
        </div>

        <div className="rep-hud-counter">
          <span className="rep-hud-reps">
            <span className="rep-hud-done">{snap.reps_done}</span>
            <span className="rep-hud-slash">/</span>
            <span className="rep-hud-planned">{snap.planned_reps}</span>
          </span>
          <span className="rep-hud-bpm">♩ = {snap.bpm}</span>
        </div>

        <div className="rep-hud-actions">
          {VERDICT_BUTTONS.map((b) => (
            <button
              key={b.verdict}
              type="button"
              className={`rep-verdict ${b.cls}`}
              onClick={() => submit(b.verdict)}
            >
              {b.label}
            </button>
          ))}
        </div>

        <input
          className="rep-hud-note"
          type="text"
          value={note}
          placeholder="note (optional)…"
          aria-label="Rep note"
          onChange={(e) => setNote(e.target.value)}
        />

        <button
          type="button"
          className="rep-hud-close"
          aria-label="Close block"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {feed.length > 0 && (
        <ul className="rep-hud-feed" aria-label="Recent verdicts">
          {feed.map((r, i) => (
            <li key={i} className={`rep-feed-item is-${r.verdict}`}>
              <span className="rep-feed-symbol" aria-hidden="true">
                {VERDICT_SYMBOL[r.verdict] ?? "•"}
              </span>
              <span className="rep-feed-bpm">{r.bpm}</span>
              {r.note && <span className="rep-feed-note">{r.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="rep-hud-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
