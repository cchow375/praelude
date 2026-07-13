import { invoke } from "@tauri-apps/api/core";
import type { UniverseSnapshot } from "./types";

export function universeSnapshot(): Promise<UniverseSnapshot> {
  return invoke<UniverseSnapshot>("universe_snapshot");
}
