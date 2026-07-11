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
//  2. A persistent, DISMISSIBLE guidance banner shown while status === "down",
//     carrying the backend's guidance text (e.g. how to grant mic permission or
//     re-enable macOS dictation). Unlike the toast it does NOT auto-dismiss —
//     a down pipeline needs a deliberate user action — but the user can close it.
//     Dismissal is keyed to the guidance text: a NEW down reason (different
//     guidance) re-shows the banner even if a previous one was dismissed, and a
//     recovery (status leaves "down") resets dismissal so the next down re-shows.
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
  // The guidance string the user has dismissed. The banner is hidden only while
  // this equals the CURRENT guidance, so a different down reason re-shows it.
  const [dismissedGuidance, setDismissedGuidance] = useState<string | null>(null);

  // Show a transient toast whenever a NEW actionable intent lands. Each intent
  // event is a fresh object, so identical repeated commands still re-toast.
  useEffect(() => {
    if (!lastIntent || !isActionableIntent(lastIntent.kind)) return;
    setToast(lastIntent);
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [lastIntent]);

  // When the pipeline recovers (status leaves "down"), clear the dismissal so the
  // banner is shown again the next time it goes down.
  useEffect(() => {
    if (status !== "down") setDismissedGuidance(null);
  }, [status]);

  const bannerVisible =
    status === "down" && !!downGuidance && downGuidance !== dismissedGuidance;

  return (
    <div className="voice-feedback" aria-live="polite">
      {bannerVisible && (
        <div className="voice-banner" role="status">
          <span className="voice-banner-dot" aria-hidden="true" />
          <span className="voice-banner-text">{downGuidance}</span>
          <button
            type="button"
            className="voice-banner-dismiss"
            aria-label="Dismiss"
            onClick={() => setDismissedGuidance(downGuidance)}
          >
            ✕
          </button>
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
