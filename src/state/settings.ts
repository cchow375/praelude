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
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "auto",
  interface_scale: 90,
};

const SETTINGS_SNAPSHOT = defineCommand<undefined, Partial<Settings>>(
  "settings_snapshot",
  "Settings could not be loaded.",
);
const SETTINGS_UPDATE = defineCommand<
  { patch: Partial<Settings> },
  unknown
>("settings_update", "The setting could not be saved.");

// Process-lifetime fallback store used whenever the Tauri backend is unavailable.
const memoryStore = new Map<keyof Settings, Settings[keyof Settings]>();

export function __resetSettingsForTests() {
  memoryStore.clear();
}

function normalizedSnapshot(value: Partial<Settings> | null | undefined): Settings {
  const theme = value?.theme;
  const scale = Number(value?.interface_scale);
  return {
    theme: theme === "auto" || theme === "dark" || theme === "light"
      ? theme
      : (memoryStore.get("theme") as ThemePref | undefined) ?? DEFAULT_SETTINGS.theme,
    interface_scale: Number.isFinite(scale) && scale >= 75 && scale <= 125
      ? scale
      : (memoryStore.get("interface_scale") as number | undefined) ?? DEFAULT_SETTINGS.interface_scale,
  };
}

async function readSettings(): Promise<Settings> {
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
  acceptSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => void;
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
        memoryStore.set("theme", snapshot.theme);
        memoryStore.set("interface_scale", snapshot.interface_scale);
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
          if (
            writeVersion.current.get(key) === version
            && mounted.current
          ) {
            receipts.committed(
              `${key === "theme" ? "Theme" : "Interface scale"} saved.`,
            );
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
