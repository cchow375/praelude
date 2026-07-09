import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ThemePref } from "../design/theme";

// -----------------------------------------------------------------------------
// Settings store.
//
// Backed by Tauri `get_setting` / `set_setting` commands. Those Rust commands do
// NOT exist yet — Task 4 wires persistence. Until then every invoke is wrapped in
// try/catch and we fall back to an in-memory map so the UI is fully usable in
// `npm run tauri dev` (and in plain `vite` in the browser) today.
// -----------------------------------------------------------------------------

export interface Settings {
  theme: ThemePref;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "auto",
};

// Process-lifetime fallback store used whenever the Tauri backend is unavailable.
const memoryStore = new Map<keyof Settings, string>();

async function readSetting<K extends keyof Settings>(
  key: K,
  fallback: Settings[K],
): Promise<Settings[K]> {
  try {
    // Task 4 wires persistence: `get_setting` returns the stored string or null.
    const value = await invoke<string | null>("get_setting", { key });
    if (value != null) return value as Settings[K];
  } catch {
    // Backend not present yet — use the in-memory value if we have one.
    const cached = memoryStore.get(key);
    if (cached != null) return cached as Settings[K];
  }
  return fallback;
}

async function writeSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  memoryStore.set(key, String(value));
  try {
    // Task 4 wires persistence: `set_setting` persists the string value.
    await invoke("set_setting", { key, value: String(value) });
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
      const theme = await readSetting("theme", DEFAULT_SETTINGS.theme);
      if (mounted.current) {
        setSettings({ theme });
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
