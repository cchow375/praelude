import { useEffect, useState } from "react";
import type { VoiceIntent, VoiceStatus } from "./useVoice";
import "./VoiceToast.css";

// ---------------------------------------------------------------------------
// Voice feedback surface. Two independent, non-pinned pieces:
//
//  1. A transient toast that appears when an intent is ACTIONED — i.e. every
//     recognised command except "question"/"ignored" (which do nothing the user
//     needs confirmation for). It shows what was heard plus a short label and
//     auto-dismisses after ~2.5s.
//
//  2. A persistent guidance banner shown while status === "down", carrying the
//     backend's guidance text (e.g. how to re-enable macOS dictation).
//
// Both consume design tokens only and adapt to light/dark via the theme vars.
// ---------------------------------------------------------------------------

const TOAST_MS = 2500;

/** Intent kinds that produce no user-facing confirmation toast. */
const SILENT_KINDS = new Set(["question", "ignored"]);

/** Whether an intent should surface a confirmation toast. */
export function isActionableIntent(kind: string): boolean {
  return !SILENT_KINDS.has(kind);
}

/** A short, human label for an actioned intent (the right-hand chip text). */
export function labelForIntent(intent: VoiceIntent): string {
  switch (intent.kind) {
    case "start":
    case "set":
      return intent.bpm != null ? `♩ = ${intent.bpm}` : "Tempo set";
    case "stop":
      return "Stopped";
    case "accent":
      return "Accent";
    case "busy":
      return "Busy";
    case "rep_pass":
      return "Rep passed";
    case "rep_fail":
      return "Rep failed";
    default:
      return intent.kind;
  }
}

interface VoiceToastProps {
  /** The latest recognised intent; a new object reference on every event. */
  lastIntent: VoiceIntent | null;
  status: VoiceStatus;
  downGuidance: string | null;
}

export function VoiceToast({ lastIntent, status, downGuidance }: VoiceToastProps) {
  const [toast, setToast] = useState<VoiceIntent | null>(null);

  // Show a transient toast whenever a NEW actionable intent lands. Each intent
  // event is a fresh object, so identical repeated commands still re-toast.
  useEffect(() => {
    if (!lastIntent || !isActionableIntent(lastIntent.kind)) return;
    setToast(lastIntent);
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [lastIntent]);

  return (
    <div className="voice-feedback" aria-live="polite">
      {status === "down" && downGuidance && (
        <div className="voice-banner" role="status">
          <span className="voice-banner-dot" aria-hidden="true" />
          <span className="voice-banner-text">{downGuidance}</span>
        </div>
      )}
      {toast && (
        <div className="voice-toast" role="status">
          {toast.text && <span className="voice-toast-heard">{toast.text}</span>}
          <span className="voice-toast-label">{labelForIntent(toast)}</span>
        </div>
      )}
    </div>
  );
}
