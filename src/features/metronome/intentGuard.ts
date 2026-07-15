/**
 * Cross-hook ownership guard for user-initiated metronome commands.
 *
 * useRep and useMetronome subscribe independently to the native state event.
 * There is a short, real interval between an optimistic manual action and its
 * authoritative event. A revision alone cannot identify a command that was
 * already pending when a rep mutation began, so the guard carries both an
 * epoch and a pending lease count.
 */
export interface MetroIntentState {
  revision: number;
  pending: number;
}

let revision = 0;
let pending = 0;

export function readMetroIntentState(): MetroIntentState {
  return { revision, pending };
}

/** Begin one manual UI metronome write and return its idempotent release. */
export function beginMetroIntent(): () => void {
  revision += 1;
  pending += 1;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    pending = Math.max(0, pending - 1);
    revision += 1;
  };
}
