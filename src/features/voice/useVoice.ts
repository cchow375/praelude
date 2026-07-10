import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ---------------------------------------------------------------------------
// Voice-status hook.
//
// The Rust voice loop is the single source of truth. It emits three events:
//   voice://status     — { state, reason?, guidance? } authoritative lifecycle
//   voice://transcript — { text, is_final } live dictation text
//   voice://intent     — { kind, text, bpm } a recognised command
// and exposes two commands: `voice_mute(muted)` and `voice_state()` (a one-shot
// snapshot used only on mount).
//
// This hook subscribes to the three events FIRST, then does the single
// `voice_state()` fetch — same ordering as useMetronome: if the fetch went
// first, a status event emitted while it was in flight would land with no
// listener and be dropped. `statusEventArrived` guards the fetch's result so a
// live event always wins over the (possibly stale) snapshot. Every invoke can
// reject when there is no backend (plain `vite` browser dev, or the App smoke
// test that mocks invoke to REJECT) — those rejections are swallowed quietly;
// the voice UI is purely reflective, so a missing backend just means "live".
//
// Invoke arguments are camelCase (Tauri maps `muted` -> the Rust parameter).
// Event PAYLOADs are serde snake_case, so the transcript's `is_final` is
// snake_case to match.
// ---------------------------------------------------------------------------

export type VoiceStatus = "live" | "muted" | "down";

/** Payload of the one-shot `voice_state()` command. */
export interface VoiceStateSnapshot {
  muted: boolean;
  /** Non-null when the pipeline is down; the string is a short reason. */
  down: string | null;
}

/** Payload of a `voice://status` event. */
export interface VoiceStatusEvent {
  state: VoiceStatus;
  reason?: string;
  guidance?: string;
}

/** Payload of a `voice://transcript` event. */
export interface VoiceTranscriptEvent {
  text: string;
  is_final: boolean;
}

/** Payload of a `voice://intent` event. */
export interface VoiceIntent {
  kind: string;
  text: string;
  bpm: number | null;
}

/**
 * Collapse the two independent flags into a single display status. `down` beats
 * `muted` beats `live`: a downed pipeline is the most important thing to show,
 * and a muted-but-otherwise-live mic reads as "muted".
 */
export function deriveStatus(muted: boolean, down: boolean): VoiceStatus {
  if (down) return "down";
  if (muted) return "muted";
  return "live";
}

export interface UseVoice {
  /** Derived display status (down beats muted beats live). */
  status: VoiceStatus;
  /** Short reason for a down pipeline, when provided. */
  downReason: string | null;
  /** User-facing guidance for a down pipeline (e.g. how to re-enable dictation). */
  downGuidance: string | null;
  /** Latest transcript text — updated on EVERY transcript event for liveness. */
  transcript: string | null;
  /** The most recent recognised intent, or null before any has arrived. */
  lastIntent: VoiceIntent | null;
  /** Mute/unmute the mic. Optimistically updates local status, then invokes. */
  mute: (muted: boolean) => void;
}

export function useVoice(): UseVoice {
  // The two authoritative flags are held in refs so event/command closures read
  // them without staleness; `status` is the derived value mirrored into React
  // state so the UI re-renders.
  const mutedRef = useRef(false);
  const downRef = useRef(false);

  const [status, setStatus] = useState<VoiceStatus>("live");
  const [downReason, setDownReason] = useState<string | null>(null);
  const [downGuidance, setDownGuidance] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [lastIntent, setLastIntent] = useState<VoiceIntent | null>(null);

  const syncStatus = useCallback(() => {
    setStatus(deriveStatus(mutedRef.current, downRef.current));
  }, []);

  const applyStatusEvent = useCallback(
    (e: VoiceStatusEvent) => {
      switch (e.state) {
        case "live":
          mutedRef.current = false;
          downRef.current = false;
          setDownReason(null);
          setDownGuidance(null);
          break;
        case "muted":
          mutedRef.current = true;
          downRef.current = false;
          setDownReason(null);
          setDownGuidance(null);
          break;
        case "down":
          downRef.current = true;
          setDownReason(e.reason ?? null);
          setDownGuidance(e.guidance ?? null);
          break;
      }
      syncStatus();
    },
    [syncStatus],
  );

  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];
    let statusEventArrived = false;

    const track = (un: (() => void) | undefined) => {
      if (!un) return;
      if (alive) unlisteners.push(un);
      else un();
    };

    (async () => {
      try {
        track(
          await listen<VoiceStatusEvent>("voice://status", (e) => {
            statusEventArrived = true;
            if (alive) applyStatusEvent(e.payload);
          }),
        );
        track(
          await listen<VoiceTranscriptEvent>("voice://transcript", (e) => {
            if (alive) setTranscript(e.payload.text);
          }),
        );
        track(
          await listen<VoiceIntent>("voice://intent", (e) => {
            if (alive) setLastIntent(e.payload);
          }),
        );
      } catch {
        // No event bus (browser dev) — optimistic mute updates still drive the UI.
      }

      try {
        const snap = await invoke<VoiceStateSnapshot>("voice_state");
        // A live status event always wins over the one-shot snapshot.
        if (alive && snap && !statusEventArrived) {
          mutedRef.current = !!snap.muted;
          downRef.current = snap.down != null;
          setDownReason(snap.down);
          syncStatus();
        }
      } catch {
        // Backend absent / command rejected — swallow quietly, keep "live".
      }
    })();

    return () => {
      alive = false;
      for (const un of unlisteners) un();
    };
  }, [applyStatusEvent, syncStatus]);

  const mute = useCallback(
    (muted: boolean) => {
      mutedRef.current = muted;
      syncStatus();
      // Optimistic; the authoritative voice://status event reconciles. Reject
      // (no backend) is swallowed — the reflected status is best-effort.
      void invoke("voice_mute", { muted }).catch(() => {});
    },
    [syncStatus],
  );

  return { status, downReason, downGuidance, transcript, lastIntent, mute };
}
