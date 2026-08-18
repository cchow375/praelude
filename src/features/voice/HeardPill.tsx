import { useEffect, useState } from "react";
import "./HeardPill.css";

// ---------------------------------------------------------------------------
// Visible hearing (v6 S9).
//
// Christian, July 31: commands "barely work" — but from the outside a command
// that was misheard and a command that was never heard look identical. Both are
// silence. This pill removes that ambiguity: EVERY final the app accepts flashes
// its raw text here, including the ambient ones the router deliberately ignored.
// A miss stops being a mystery and becomes a sentence you can read.
//
// It is not the toast. `VoiceToast`'s SILENT_KINDS still suppresses the
// confirmation toast for `question`/`ignored`, and it should: those actioned
// nothing. What was wrong was letting "no toast" also mean "no evidence you were
// heard at all". The two surfaces answer different questions — the toast says
// what the app DID, the pill says what the app HEARD.
//
// Anchored rather than nested inside the Rep Counter panel: that panel is
// draggable, minimizable, and empty when no set is open, and a hearing indicator
// that can be closed is worse than none. It sits low-left, clear of the dock's
// own pill bar (right) and the toast stack (bottom-centre).
// ---------------------------------------------------------------------------

/**
 * The honest limit, stated in-app (Settings ▸ Voice & wake-word).
 *
 * There is no quiet-speech sensitivity control to build: recognition happens
 * inside the macOS speech engine and the app receives finished text, never
 * audio. A mic-level meter would need a SECOND audio input stream alongside
 * `hear`'s — memory this machine does not have to spare — and it still would not
 * make the engine hear better. So the app promises only what it can deliver:
 * showing exactly what it was given.
 */
export const QUIET_SPEECH_NOTE =
  "Quiet-speech sensitivity belongs to the macOS speech engine — the app shows what it heard; it can't hear better.";

/** How long a heard line stays up. Short — this is a flash, not a log. */
export const HEARD_MS = 1800;

/** Longest text rendered; anything past this is elided. A dictated sentence can
 * run long, and the pill must never become a wall of text over the score. */
const MAX_CHARS = 72;

export function truncateHeard(text: string): string {
  const trimmed = text.trim().replace(/\s+/gu, " ");
  if (trimmed.length <= MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_CHARS - 1).trimEnd()}…`;
}

interface HeardPillProps {
  /**
   * The latest accepted final transcript. A NEW object reference per delivery,
   * so two identical utterances still re-flash. `null` before anything is heard.
   */
  readonly delivery: {
    readonly text: string;
    readonly is_final: boolean;
  } | null;
}

export function HeardPill({ delivery }: HeardPillProps) {
  const [heard, setHeard] = useState<string | null>(null);

  useEffect(() => {
    if (!delivery || !delivery.is_final) return;
    const text = truncateHeard(delivery.text);
    if (!text) return;
    setHeard(text);
    const timer = setTimeout(() => setHeard(null), HEARD_MS);
    return () => clearTimeout(timer);
  }, [delivery]);

  if (!heard) return null;
  return (
    <div className="heard-pill" role="status" aria-live="polite">
      <span className="heard-pill-ear" aria-hidden="true" />
      <span className="heard-pill-text">{heard}</span>
    </div>
  );
}
