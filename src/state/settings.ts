import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ThemePref } from "../design/theme";

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
    return normalizedSnapshot(await invoke<Partial<Settings>>("settings_snapshot"));
  } catch {
    return normalizedSnapshot(null);
  }
}

async function writeSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  memoryStore.set(key, value);
  try {
    await invoke("settings_update", { patch: { [key]: value } });
  } catch {
    // Backend not present yet — the in-memory write above is our source of truth.
  }
}

export interface UseSettings {
  settings: Settings;
  /** True until the initial async load from the backend resolves. */
  loading: boolean;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

/**
 * React hook exposing the current settings and an optimistic setter. The setter
 * updates local state immediately and persists in the background.
 */
export function useSettings(): UseSettings {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const snapshot = await readSettings();
      if (mounted.current) {
        setSettings(snapshot);
        setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  const setSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      void writeSetting(key, value);
    },
    [],
  );

  return { settings, loading, setSetting };
}
