import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beginMetroIntent } from "./intentGuard";

// ---------------------------------------------------------------------------
// Metronome hook.
//
// The Rust backend (src-tauri/src/metronome.rs) is the single source of truth:
// every command emits a `metro://state` event carrying the full, flattened
// snake_case MetroState. This hook subscribes to that event and mirrors it into
// React state. On mount it does ONE `metro_state()` fetch (never polls — a start
// can stall the control mutex up to ~300ms) and relies on events thereafter.
//
// Local state is also updated optimistically on user actions so the UI feels
// instant; the authoritative event that follows reconciles it. Commands can
// reject (unknown sound, "audio busy: speech playing", engine failure) — those
// rejections surface as a quiet inline error, never swallowed.
//
// Invoke arguments are camelCase (Tauri v2 maps them to the Rust snake_case
// parameter names, e.g. `beatsPerBar` -> `beats_per_bar`). The event PAYLOAD is
// serde-serialized snake_case, so MetroState below is snake_case to match it.
// ---------------------------------------------------------------------------

/** Mirrors the backend `MetroState` serde payload (flattened, snake_case). */
export interface MetroState {
  running: boolean;
  bpm: number;
  beats_per_bar: number;
  subdivision: number;
  accent_first: boolean;
  sound: string;
  gain: number;
  boost: boolean;
}

export const DEFAULT_METRO_STATE: MetroState = {
  running: false,
  bpm: 120,
  beats_per_bar: 4,
  subdivision: 1,
  accent_first: true,
  sound: "woodblock",
  gain: 1,
  boost: false,
};

// UI-facing ranges. The backend clamps bpm to 1..1000, but a musically sane
// range keeps the wheel/steppers usable; 20–300 covers Grave→Prestissimo with
// headroom. Subdivision hard-caps at 16 to mirror the engine (MAX_SUBDIVISION).
export const UI_BPM_MIN = 20;
export const UI_BPM_MAX = 300;
export const MAX_SUBDIVISION = 16;
export const MIN_BEATS_PER_BAR = 1;
export const MAX_BEATS_PER_BAR = 16;
export const MAX_GAIN = 4;

export interface SoundOption {
  id: string;
  label: string;
}

/** The six loaded click sounds (src-tauri/assets/clicks), in grid order. */
export const SOUNDS: SoundOption[] = [
  { id: "woodblock", label: "Woodblock" },
  { id: "clave", label: "Clave" },
  { id: "rim", label: "Rim" },
  { id: "cowbell", label: "Cowbell" },
  { id: "beep", label: "Beep" },
  { id: "tick", label: "Tick" },
];

/** Clamp + round a bpm into the UI range. Non-finite -> minimum. */
export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return UI_BPM_MIN;
  return Math.min(UI_BPM_MAX, Math.max(UI_BPM_MIN, Math.round(bpm)));
}

/** Parse typed tempo input; null when empty/non-numeric so the caller can revert. */
export function parseBpmInput(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return clampBpm(n);
}

// Standard metronome tempo marks (lower bound inclusive). The largest mark whose
// threshold the bpm meets wins.
const TEMPO_MARKS: { min: number; name: string }[] = [
  { min: 0, name: "Grave" },
  { min: 40, name: "Largo" },
  { min: 60, name: "Larghetto" },
  { min: 66, name: "Adagio" },
  { min: 76, name: "Andante" },
  { min: 108, name: "Moderato" },
  { min: 120, name: "Allegro" },
  { min: 156, name: "Vivace" },
  { min: 176, name: "Presto" },
  { min: 200, name: "Prestissimo" },
];

/** The Italian tempo name for a bpm (Grave…Prestissimo). */
export function tempoName(bpm: number): string {
  let name = TEMPO_MARKS[0].name;
  for (const m of TEMPO_MARKS) if (bpm >= m.min) name = m.name;
  return name;
}

function messageOf(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

export interface UseMetronome {
  state: MetroState;
  /** Last command rejection, shown as a quiet inline notice. Auto-clears. */
  error: string | null;
  clearError: () => void;
  start: (bpm?: number) => void;
  stop: () => void;
  toggle: () => void;
  setBpm: (bpm: number) => void;
  /** Optimistic bpm update during an active drag; the invoke call is throttled
   * (trailing, ≤1 per 150ms) — call `commitBpmDrag` on drag end to flush. */
  setBpmDrag: (bpm: number) => void;
  /** Flush any pending throttled drag call and send one final, unconditional
   * `metro_set` with the given (final) bpm. */
  commitBpmDrag: (bpm: number) => void;
  nudgeBpm: (delta: number) => void;
  setBeatsPerBar: (n: number) => void;
  setSubdivision: (n: number) => void;
  setAccent: (on: boolean) => void;
  setGain: (g: number) => void;
  setBoost: (on: boolean) => void;
  /** Select a sound and audition it (live if running; a short one-shot if stopped). */
  selectSound: (soundId: string) => Promise<void>;
}

export function useMetronome(): UseMetronome {
  const [state, setState] = useState<MetroState>(DEFAULT_METRO_STATE);
  const [error, setError] = useState<string | null>(null);

  // Latest state for closures (setTimeout, event callbacks) without stale reads.
  const stateRef = useRef(state);
  stateRef.current = state;

  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Preview bookkeeping: `active` = we started the engine purely to audition a
  // sound (so it must be stopped again); `timer` = the pending auto-stop.
  const preview = useRef<{ active: boolean; timer?: ReturnType<typeof setTimeout> }>(
    { active: false },
  );

  const applyState = useCallback((s: MetroState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const patch = useCallback((p: Partial<MetroState>) => {
    const next = { ...stateRef.current, ...p };
    stateRef.current = next;
    setState(next);
  }, []);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4500);
  }, []);

  const clearError = useCallback(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setError(null);
  }, []);

  const call = useCallback(
    async (cmd: string, args?: Record<string, unknown>) => {
      const finishIntent = beginMetroIntent();
      try {
        await invoke(cmd, args);
      } catch (e) {
        showError(messageOf(e));
      } finally {
        finishIntent();
      }
    },
    [showError],
  );

  // Mount: subscribe to the event bus FIRST, then do the one-time initial
  // fetch. This ordering matters — if the fetch went first, any `metro://state`
  // event emitted while the fetch was in flight (e.g. another window's action)
  // would have no listener yet and be silently dropped. `eventArrived` guards
  // the fetch's result: once a live event has landed, it always wins over the
  // (now possibly stale) fetch response.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    let eventArrived = false;
    (async () => {
      try {
        const un = await listen<MetroState>("metro://state", (e) => {
          eventArrived = true;
          if (alive) applyState(e.payload);
        });
        if (alive) unlisten = un;
        else un();
      } catch {
        // No event bus (browser dev) — optimistic updates still drive the UI.
      }
      try {
        const s = await invoke<MetroState>("metro_state");
        if (alive && s && !eventArrived) applyState(s);
      } catch {
        // Backend absent (plain `vite` browser dev) — keep defaults.
      }
    })();
    return () => {
      alive = false;
      unlisten?.();
      if (errorTimer.current) clearTimeout(errorTimer.current);
      if (preview.current.timer) clearTimeout(preview.current.timer);
      if (dragThrottle.current.timer) clearTimeout(dragThrottle.current.timer);
      // If we're unmounted mid-audition (popover closed during a preview), the
      // pending auto-stop timer is now dead — so stop the engine directly, or it
      // would play forever. Only when the run is OURS (a preview), never when the
      // user has genuinely started the metronome.
      if (preview.current.active) {
        preview.current.active = false;
        const finishIntent = beginMetroIntent();
        void invoke("metro_stop").catch(() => {}).finally(finishIntent);
      }
    };
  }, [applyState]);

  const cancelPreview = useCallback(() => {
    if (preview.current.timer) {
      clearTimeout(preview.current.timer);
      preview.current.timer = undefined;
    }
  }, []);

  const start = useCallback(
    (bpm?: number) => {
      cancelPreview();
      preview.current.active = false; // a real start supersedes any preview
      if (bpm != null) {
        const v = clampBpm(bpm);
        patch({ running: true, bpm: v });
        void call("metro_start", { bpm: v });
      } else {
        patch({ running: true });
        void call("metro_start");
      }
    },
    [call, patch, cancelPreview],
  );

  const stop = useCallback(() => {
    cancelPreview();
    preview.current.active = false;
    patch({ running: false });
    void call("metro_stop");
  }, [call, patch, cancelPreview]);

  const toggle = useCallback(() => {
    if (stateRef.current.running) stop();
    else start();
  }, [start, stop]);

  const set = useCallback(
    (args: Record<string, unknown>, optimistic: Partial<MetroState>) => {
      patch(optimistic);
      void call("metro_set", args);
    },
    [call, patch],
  );

  const setBpm = useCallback(
    (bpm: number) => {
      const v = clampBpm(bpm);
      set({ bpm: v }, { bpm: v });
    },
    [set],
  );

  // Drag-wheel bpm: the displayed value updates optimistically on every
  // integer crossing, but the `metro_set` invoke is trailing-throttled to at
  // most once per 150ms so a fast drag doesn't flood the backend/persist path.
  const DRAG_THROTTLE_MS = 150;
  const dragThrottle = useRef<{
    timer?: ReturnType<typeof setTimeout>;
    lastCallAt: number;
    pendingBpm: number | null;
  }>({ lastCallAt: 0, pendingBpm: null });

  const setBpmDrag = useCallback(
    (bpm: number) => {
      const v = clampBpm(bpm);
      patch({ bpm: v });
      const dt = dragThrottle.current;
      const elapsed = Date.now() - dt.lastCallAt;
      if (elapsed >= DRAG_THROTTLE_MS) {
        dt.lastCallAt = Date.now();
        dt.pendingBpm = null;
        if (dt.timer) {
          clearTimeout(dt.timer);
          dt.timer = undefined;
        }
        void call("metro_set", { bpm: v });
      } else {
        dt.pendingBpm = v;
        if (!dt.timer) {
          dt.timer = setTimeout(() => {
            dt.timer = undefined;
            dt.lastCallAt = Date.now();
            const toSend = dt.pendingBpm;
            dt.pendingBpm = null;
            if (toSend != null) void call("metro_set", { bpm: toSend });
          }, DRAG_THROTTLE_MS - elapsed);
        }
      }
    },
    [call, patch],
  );

  const commitBpmDrag = useCallback(
    (bpm: number) => {
      const dt = dragThrottle.current;
      if (dt.timer) {
        clearTimeout(dt.timer);
        dt.timer = undefined;
      }
      dt.pendingBpm = null;
      dt.lastCallAt = Date.now();
      const v = clampBpm(bpm);
      patch({ bpm: v });
      void call("metro_set", { bpm: v });
    },
    [call, patch],
  );

  const nudgeBpm = useCallback(
    (delta: number) => setBpm(stateRef.current.bpm + delta),
    [setBpm],
  );

  const setBeatsPerBar = useCallback(
    (n: number) => {
      const v = Math.min(MAX_BEATS_PER_BAR, Math.max(MIN_BEATS_PER_BAR, Math.round(n)));
      set({ beatsPerBar: v }, { beats_per_bar: v });
    },
    [set],
  );

  const setSubdivision = useCallback(
    (n: number) => {
      const v = Math.min(MAX_SUBDIVISION, Math.max(1, Math.round(n)));
      set({ subdivision: v }, { subdivision: v });
    },
    [set],
  );

  const setAccent = useCallback(
    (on: boolean) => set({ accent: on }, { accent_first: on }),
    [set],
  );

  const setGain = useCallback(
    (g: number) => {
      const v = Math.min(MAX_GAIN, Math.max(0, g));
      set({ gain: v }, { gain: v });
    },
    [set],
  );

  const setBoost = useCallback(
    (on: boolean) => set({ boost: on }, { boost: on }),
    [set],
  );

  const selectSound = useCallback(
    async (soundId: string) => {
      patch({ sound: soundId });
      // Whether the user is actively running (not a preview): then the change is
      // already audible live and no one-shot is needed.
      const liveRunning = stateRef.current.running && !preview.current.active;
      // Await the set so the sound is applied before any preview start reads it.
      await call("metro_set", { sound: soundId });
      if (liveRunning) return;

      // Stopped, or already previewing: (re)start a short audition.
      cancelPreview();
      if (!preview.current.active) {
        preview.current.active = true;
        await call("metro_start");
      }
      // ~2 beats at the current tempo, clamped to a comfortable window.
      const beatMs = 60000 / Math.max(stateRef.current.bpm, 1);
      const holdMs = Math.min(1200, Math.max(350, Math.round(beatMs * 2)));
      preview.current.timer = setTimeout(() => {
        preview.current.timer = undefined;
        preview.current.active = false;
        void call("metro_stop");
      }, holdMs);
    },
    [call, patch, cancelPreview],
  );

  return {
    state,
    error,
    clearError,
    start,
    stop,
    toggle,
    setBpm,
    setBpmDrag,
    commitBpmDrag,
    nudgeBpm,
    setBeatsPerBar,
    setSubdivision,
    setAccent,
    setGain,
    setBoost,
    selectSound,
  };
}
