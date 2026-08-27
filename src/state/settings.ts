import { useCallback, useEffect, useRef, useState } from "react";
import type { ThemePref } from "../design/theme";
import {
  commandErrorMessage,
  defineCommand,
  executeCommand,
} from "../services/command";
import { useReceipts } from "../features/receipts/ReceiptCenter";

// -----------------------------------------------------------------------------
// Settings store.
//
// Backed by the same typed `settings_snapshot` / `settings_update` projection as
// the Settings form. Every invoke is wrapped so plain Vite and unit tests retain
// a process-lifetime fallback without creating a second persistence contract.
// -----------------------------------------------------------------------------

export interface Settings {
  theme: ThemePref;
  interface_scale: number;
  practice_default_clean_streak: number;
  /** Master switch for the verdict hotkeys (A6). */
  hotkeys_enabled: boolean;
  /** `KeyboardEvent.code` bound to each verdict. */
  hotkey_verdict_clean: string;
  hotkey_verdict_sloppy: string;
  hotkey_verdict_again: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "auto",
  interface_scale: 90,
  practice_default_clean_streak: 5,
  // Christian's confirmed mapping (2026-08-25): "so I don't have to move my
  // hand off the piano." Right-Shift is matched by `code`, never `key` — the
  // latter is "Shift" for both shift keys.
  hotkeys_enabled: true,
  hotkey_verdict_clean: "Space",
  hotkey_verdict_sloppy: "ShiftRight",
  hotkey_verdict_again: "Enter",
};

/**
 * A `KeyboardEvent.code` is always ASCII alphanumeric ("Space", "ShiftRight",
 * "Enter", "KeyA", "Digit1", "F7"). Anything else came from a stale or
 * hand-edited setting row and must not silently become a live binding.
 */
function keyCode(
  value: unknown,
  key: keyof Settings,
  fallback: string,
): string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 24 &&
    /^[A-Za-z0-9]+$/.test(value)
    ? value
    : ((memoryStore.get(key) as string | undefined) ?? fallback);
}

const SETTINGS_SNAPSHOT = defineCommand<undefined, Partial<Settings>>(
  "settings_snapshot",
  "Settings could not be loaded.",
);
const SETTINGS_UPDATE = defineCommand<{ patch: Partial<Settings> }, unknown>(
  "settings_update",
  "The setting could not be saved.",
);

/** Receipt wording, one entry per key so a new setting cannot go unnamed. */
const SETTING_LABELS: Record<keyof Settings, string> = {
  theme: "Theme",
  interface_scale: "Interface scale",
  practice_default_clean_streak: "Default clean streak",
  hotkeys_enabled: "Verdict hotkeys",
  hotkey_verdict_clean: "Clean hotkey",
  hotkey_verdict_sloppy: "Sloppy hotkey",
  hotkey_verdict_again: "Again hotkey",
};

// Process-lifetime fallback store used whenever the Tauri backend is unavailable.
const memoryStore = new Map<keyof Settings, Settings[keyof Settings]>();

type CommittedSettingsListener = (settings: Settings) => void;
const committedSettingsListeners = new Set<CommittedSettingsListener>();

export function __resetSettingsForTests() {
  memoryStore.clear();
}

/**
 * Accept a full settings projection only after the backend has committed it.
 * The Settings form uses a separate, broad snapshot type, so mounted focused
 * surfaces cannot rely on its React tree re-rendering when that form saves.
 * This process-local projection is the authoritative bridge for those live
 * consumers; persistence remains owned by `settings_update`.
 */
export function acceptCommittedSettings(
  value: Partial<Settings>,
): Settings {
  const snapshot = normalizedSnapshot(value);
  for (const key of Object.keys(snapshot) as (keyof Settings)[]) {
    memoryStore.set(key, snapshot[key]);
  }
  for (const listener of committedSettingsListeners) {
    listener(snapshot);
  }
  return snapshot;
}

/** Subscribe to projections accepted after a successful settings write. */
export function subscribeCommittedSettings(
  listener: CommittedSettingsListener,
): () => void {
  committedSettingsListeners.add(listener);
  return () => committedSettingsListeners.delete(listener);
}

function normalizedSnapshot(
  value: Partial<Settings> | null | undefined,
): Settings {
  const theme = value?.theme;
  const scale = Number(value?.interface_scale);
  return {
    theme:
      theme === "auto" || theme === "dark" || theme === "light"
        ? theme
        : ((memoryStore.get("theme") as ThemePref | undefined) ??
          DEFAULT_SETTINGS.theme),
    interface_scale:
      Number.isFinite(scale) && scale >= 75 && scale <= 125
        ? scale
        : ((memoryStore.get("interface_scale") as number | undefined) ??
          DEFAULT_SETTINGS.interface_scale),
    practice_default_clean_streak:
      Number.isInteger(value?.practice_default_clean_streak) &&
      Number(value?.practice_default_clean_streak) >= 1 &&
      Number(value?.practice_default_clean_streak) <= 100
        ? Number(value?.practice_default_clean_streak)
        : ((memoryStore.get("practice_default_clean_streak") as
            number | undefined) ??
          DEFAULT_SETTINGS.practice_default_clean_streak),
    hotkeys_enabled:
      typeof value?.hotkeys_enabled === "boolean"
        ? value.hotkeys_enabled
        : ((memoryStore.get("hotkeys_enabled") as boolean | undefined) ??
          DEFAULT_SETTINGS.hotkeys_enabled),
    hotkey_verdict_clean: keyCode(
      value?.hotkey_verdict_clean,
      "hotkey_verdict_clean",
      DEFAULT_SETTINGS.hotkey_verdict_clean,
    ),
    hotkey_verdict_sloppy: keyCode(
      value?.hotkey_verdict_sloppy,
      "hotkey_verdict_sloppy",
      DEFAULT_SETTINGS.hotkey_verdict_sloppy,
    ),
    hotkey_verdict_again: keyCode(
      value?.hotkey_verdict_again,
      "hotkey_verdict_again",
      DEFAULT_SETTINGS.hotkey_verdict_again,
    ),
  };
}

/**
 * Read the whole settings projection, falling back to the process-lifetime
 * defaults whenever the native backend is unavailable. Exported so surfaces
 * that need one setting (the verdict hotkeys) can read it without mounting the
 * full `useSettings` store.
 */
export async function readSettings(): Promise<Settings> {
  try {
    return normalizedSnapshot(
      await executeCommand(SETTINGS_SNAPSHOT, undefined),
    );
  } catch {
    return normalizedSnapshot(null);
  }
}

async function writeSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  await executeCommand(SETTINGS_UPDATE, {
    patch: { [key]: value } as Partial<Settings>,
  });
}

export interface UseSettings {
  settings: Settings;
  /** True until the initial async load from the backend resolves. */
  loading: boolean;
  /** Last rejected persistence write. */
  error: string | null;
  clearError: () => void;
  /** Accept a value already committed by the full Settings form. */
  acceptSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** Optimistically change and persist a lightweight setting. */
  setSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
}

/**
 * React hook exposing the current settings and an optimistic setter. The setter
 * updates local state immediately and persists in the background.
 */
export function useSettings(): UseSettings {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const receipts = useReceipts();
  const mounted = useRef(true);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const committedRef = useRef(DEFAULT_SETTINGS);
  const writeVersion = useRef(new Map<keyof Settings, number>());
  const writeChains = useRef(new Map<keyof Settings, Promise<void>>());

  useEffect(() => {
    // `mounted` guards user-initiated writes. This effect-local flag is
    // deliberately separate: StrictMode mounts, cleans up, and mounts again,
    // so a shared boolean would let the first stale snapshot overwrite the
    // second mount after it resolves.
    let active = true;
    mounted.current = true;
    (async () => {
      const snapshot = await readSettings();
      if (active) {
        settingsRef.current = snapshot;
        committedRef.current = snapshot;
        for (const key of Object.keys(snapshot) as (keyof Settings)[]) {
          memoryStore.set(key, snapshot[key]);
        }
        setSettings(snapshot);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);

  const setSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      const version = (writeVersion.current.get(key) ?? 0) + 1;
      writeVersion.current.set(key, version);
      settingsRef.current = { ...settingsRef.current, [key]: value };
      setSettings(settingsRef.current);
      setError(null);

      const previousWrite = writeChains.current.get(key) ?? Promise.resolve();
      const write = previousWrite
        .catch(() => undefined)
        .then(() => writeSetting(key, value))
        .then(() => {
          // Writes for one key are serialized, so this is the last value the
          // backend actually committed even when a newer optimistic value is
          // already queued behind it.
          committedRef.current = { ...committedRef.current, [key]: value };
          memoryStore.set(key, value);
          if (writeVersion.current.get(key) === version && mounted.current) {
            receipts.committed(`${SETTING_LABELS[key]} saved.`);
          }
        })
        .catch((cause) => {
          if (writeVersion.current.get(key) === version && mounted.current) {
            const restored = committedRef.current[key];
            settingsRef.current = {
              ...settingsRef.current,
              [key]: restored,
            };
            memoryStore.set(key, restored);
            setSettings(settingsRef.current);
            const message = commandErrorMessage(
              cause,
              "The setting could not be saved.",
            );
            setError(message);
            receipts.error(cause, message);
          }
          throw cause;
        });
      writeChains.current.set(key, write);
      return write;
    },
    [receipts],
  );

  const acceptSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      writeVersion.current.set(key, (writeVersion.current.get(key) ?? 0) + 1);
      settingsRef.current = { ...settingsRef.current, [key]: value };
      committedRef.current = { ...committedRef.current, [key]: value };
      memoryStore.set(key, value);
      setSettings(settingsRef.current);
      setError(null);
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    settings,
    loading,
    error,
    clearError,
    acceptSetting,
    setSetting,
  };
}
