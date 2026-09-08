import { useCallback, useEffect, useRef, useState } from "react";
import { commandErrorMessage, defineCommand, executeCommand } from "../../services/command";

export interface RoutineStage { name: string; clean_streak: number }
export interface VariantRoutine { id: string; name: string; stages: RoutineStage[] }
export interface VariantLibrary {
  revision: number;
  custom_variants: string[];
  hidden_variants: string[];
  routines: VariantRoutine[];
}
export const VARIANT_PRESETS = [
  { label: "Slow", name: "slow" }, { label: "Dotted", name: "dotted" },
  { label: "Reverse dotted", name: "reverse dotted" }, { label: "Staccato", name: "staccato" },
  { label: "Tenuto", name: "tenuto" }, { label: "Legato", name: "legato" },
  { label: "Left hand only", name: "left hand only" }, { label: "Right hand only", name: "right hand only" },
  { label: "Hands separate", name: "hands separate" }, { label: "Blocked chords", name: "blocked chords" },
];
const GET = defineCommand<undefined, VariantLibrary>("variant_library_get", "Could not load your variant library.");
const SAVE = defineCommand<{ library: VariantLibrary }, VariantLibrary>("variant_library_save", "Could not save your variant library.");
const CHANGED = "praelude:variant-library-changed";
export const normalizeVariantName = (name: string) => name.trim().replace(/\s+/g, " ");
export const variantNameKey = (name: string) => normalizeVariantName(name).toLowerCase();

/** Durable native library; successful writes notify other mounted composers. */
export function useVariantLibrary() {
  const [library, setLibrary] = useState<VariantLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const adopt = useCallback((next: VariantLibrary) => {
    setLibrary((current) => !current || next.revision >= current.revision ? next : current);
  }, []);
  const reload = useCallback(async () => {
    setError(null); setSaved(false);
    try {
      const next = await executeCommand(GET, undefined);
      if (!next || !Number.isSafeInteger(next.revision) || !Array.isArray(next.custom_variants) || !Array.isArray(next.hidden_variants) || !Array.isArray(next.routines)) throw new Error("Could not read the variant library. Reload to try again.");
      if (alive.current) adopt(next);
    } catch (cause) {
      if (alive.current) setError(commandErrorMessage(cause));
    }
  }, [adopt]);
  useEffect(() => {
    alive.current = true;
    const changed = (event: Event) => adopt((event as CustomEvent<VariantLibrary>).detail);
    window.addEventListener(CHANGED, changed);
    void reload();
    return () => { alive.current = false; window.removeEventListener(CHANGED, changed); };
  }, [adopt, reload]);
  const save = async (next: VariantLibrary): Promise<boolean> => {
    if (!library || lock.current) return false;
    lock.current = true; setBusy(true); setError(null); setSaved(false);
    try {
      const result = await executeCommand(SAVE, { library: next });
      window.dispatchEvent(new CustomEvent(CHANGED, { detail: result }));
      if (alive.current) setSaved(true);
      return true;
    } catch (cause) {
      if (alive.current) setError(commandErrorMessage(cause));
      return false;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { library, error, busy, saved, save, reload };
}
