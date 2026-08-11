import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ---------------------------------------------------------------------------
// Degraded cloud-voice state (v6 S9).
//
// The Rust TTS wrapper puts the cloud voice on a cooldown after repeated synth
// failures and speaks through the macOS `say` voice meanwhile. It reports only
// the two TRANSITIONS — degraded and recovered — on `voice://tts`
// (`{ degraded: boolean }`), never one event per failure, so this never turns
// into toast spam.
//
// Same ordering discipline as `useVoice`: subscribe FIRST, then take the
// one-shot `tts_degraded()` snapshot for a UI that mounted mid-cooldown, and let
// a live event that arrived in flight win over the snapshot. Every IPC call can
// reject with no backend (browser dev, mocked tests) — that is swallowed and
// reads as "not degraded", because this surface is purely reflective.
// ---------------------------------------------------------------------------

/** Payload of a `voice://tts` event. */
export interface TtsStatusEvent {
  degraded: boolean;
}

/** The user-facing degraded line. One phrase, used by every surface. */
export const TTS_DEGRADED_LABEL = "Voice degraded — using system voice";

/** `true` while spoken output is coming from the macOS voice, not the cloud voice. */
export function useTtsDegraded(): boolean {
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    let alive = true;
    let eventArrived = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const un = await listen<TtsStatusEvent>("voice://tts", (e) => {
          eventArrived = true;
          if (alive) setDegraded(e.payload?.degraded === true);
        });
        if (alive) unlisten = un;
        else un();
      } catch {
        // No event bus (browser dev) — stay non-degraded.
      }

      try {
        const snap = await invoke<boolean>("tts_degraded");
        // A live transition always wins over the one-shot snapshot.
        if (alive && !eventArrived) setDegraded(snap === true);
      } catch {
        // Backend absent / command rejected — swallow quietly.
      }
    })();

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return degraded;
}
