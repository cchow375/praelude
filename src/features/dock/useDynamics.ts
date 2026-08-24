import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  activeProfile,
  type CalibrationPoint,
  type DynamicsProfile,
} from "./calibration";

/**
 * The frontend half of the dynamics meter (Plan B, task B3).
 *
 * THE LAW: loudness only. Everything crossing this seam is a dB figure. The
 * backend exposes no spectrum, no pitch, no onset, no note and no verdict, and
 * this hook adds none.
 *
 * The mic is NEVER open while the panel is closed or minimized-to-pill:
 * `enabled` is the panel's own open state, and both `enabled -> false` and
 * unmount stop the meter.
 */

/** The `dynamics://level` payload. dB figures and a timestamp, nothing else. */
export interface LevelEvent {
  rms_db: number;
  peak_db: number;
  ts_ms: number;
}

export interface MeterState {
  running: boolean;
  has_input_device: boolean;
}

export interface UseDynamics {
  level: LevelEvent | null;
  meter: MeterState;
  /** The ACTIVE profile, or null if uncalibrated. */
  profile: DynamicsProfile | null;
  profiles: DynamicsProfile[];
  error: string | null;
  /** Subscribe to the raw level stream — what CalibrationWizard consumes. */
  subscribeLevel: (fn: (rmsDb: number) => void) => () => void;
  saveProfile: (label: string, points: CalibrationPoint[]) => Promise<void>;
  activateProfile: (id: number) => Promise<void>;
}

/**
 * The capture device a profile is filed under. The meter always opens the
 * system default input, and the command surface deliberately exposes no device
 * enumeration (it would be one more thing to keep honest for no musical gain),
 * so every profile shares this id. It exists so a future multi-device build has
 * a column to key on rather than a migration to write.
 */
const DEVICE_ID = "default-input";

const IDLE_METER: MeterState = { running: false, has_input_device: false };

function messageOf(error: unknown): string {
  return typeof error === "string" ? error : String(error);
}

export function useDynamics(enabled: boolean): UseDynamics {
  const [level, setLevel] = useState<LevelEvent | null>(null);
  const [meter, setMeter] = useState<MeterState>(IDLE_METER);
  const [profiles, setProfiles] = useState<DynamicsProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Raw-level subscribers (the calibration wizard). A ref, not state: adding a
  // subscriber must not re-render, and the identity of `subscribeLevel` must be
  // stable for the whole mount so consumers' effects do not re-subscribe.
  const subscribers = useRef(new Set<(rmsDb: number) => void>());

  const subscribeLevel = useCallback((fn: (rmsDb: number) => void) => {
    subscribers.current.add(fn);
    return () => {
      subscribers.current.delete(fn);
    };
  }, []);

  // Mount: subscribe to the event bus FIRST, then do the one-time initial
  // fetch. This ordering matters — if the fetch went first, any
  // `dynamics://level` event emitted while the fetch was in flight would have
  // no listener yet and be silently dropped. `eventArrived` guards the fetch's
  // result: once a live event has landed it always wins over the (now possibly
  // stale) fetch response. Copied deliberately from
  // `src/features/metronome/useMetronome.ts:194-221`.
  //
  // There is NO setInterval anywhere in this hook. The meter pushes at 8 Hz;
  // polling it would be both redundant and a second source of truth.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    let eventArrived = false;
    (async () => {
      try {
        const un = await listen<LevelEvent>("dynamics://level", (e) => {
          eventArrived = true;
          if (!alive) return;
          const payload = e.payload;
          setLevel(payload);
          for (const fn of subscribers.current) fn(payload.rms_db);
        });
        if (alive) unlisten = un;
        else un();
      } catch {
        // No event bus (plain browser dev) — the panel still renders.
      }
      try {
        const s = await invoke<MeterState>("dynamics_meter_state");
        if (alive && s && !eventArrived) setMeter(s);
      } catch {
        // Backend absent — keep the idle defaults.
      }
    })();
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const refreshProfiles = useCallback(async () => {
    const list = await invoke<DynamicsProfile[]>("dynamics_profile_list");
    setProfiles(list ?? []);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await invoke<DynamicsProfile[]>("dynamics_profile_list");
        if (alive) setProfiles(list ?? []);
      } catch (e) {
        if (alive) setError(messageOf(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The mic's whole life. `enabled` is the panel's open state; false, and
  // unmount, both tear the input stream down. There is no warm/paused state.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        const s = await invoke<MeterState>("dynamics_meter_start");
        if (alive && s) setMeter(s);
      } catch (e) {
        if (alive) setError(messageOf(e));
      }
    })();
    return () => {
      alive = false;
      void (async () => {
        try {
          const s = await invoke<MeterState>("dynamics_meter_stop");
          setMeter(s ?? IDLE_METER);
        } catch {
          // Best effort: the backend's own shutdown handler is the backstop.
        }
      })();
    };
  }, [enabled]);

  const saveProfile = useCallback(
    async (label: string, points: CalibrationPoint[]) => {
      try {
        await invoke<DynamicsProfile>("dynamics_profile_save", {
          deviceId: DEVICE_ID,
          label,
          points,
        });
        setError(null);
        await refreshProfiles();
      } catch (e) {
        setError(messageOf(e));
        throw e;
      }
    },
    [refreshProfiles],
  );

  const activateProfile = useCallback(
    async (id: number) => {
      try {
        await invoke<DynamicsProfile>("dynamics_profile_activate", { id });
        setError(null);
        await refreshProfiles();
      } catch (e) {
        setError(messageOf(e));
        throw e;
      }
    },
    [refreshProfiles],
  );

  return {
    level,
    meter,
    profile: activeProfile(profiles),
    profiles,
    error,
    subscribeLevel,
    saveProfile,
    activateProfile,
  };
}
