import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Whether Christian has switched the Assistant ("Brain") on in Settings.
 * Off by default (2026-08-24 request: it "just gets in the way"; the
 * deterministic voice commands, metronome, and rep tracking never use it).
 *
 * Every surface that offers or auto-triggers an Assistant action — not just
 * the rail tab — must gate on this: PassageHelper's assistant_suggest
 * action, and the Settings BrainConnection panel's brain_status /
 * Test-connection controls.
 */
export function useAssistantEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    invoke<{ assistant_enabled?: boolean }>("settings_snapshot")
      .then((snapshot) => {
        if (active) setEnabled(Boolean(snapshot?.assistant_enabled));
      })
      .catch(() => {
        // Honest default: if settings can't be read, the Assistant stays off.
      });
    return () => {
      active = false;
    };
  }, []);
  return enabled;
}
