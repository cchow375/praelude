import { invoke } from "@tauri-apps/api/core";
import type { HistoryDaySummary } from "../ledger/historyDays";
import type { UniverseSnapshot } from "./types";

export function universeSnapshot(): Promise<UniverseSnapshot> {
  return invoke<UniverseSnapshot>("universe_snapshot");
}

/** Read-only cadence evidence, bucketed by the native local-day ledger. */
export async function universeHistoryDays(
  from: string,
  to: string,
): Promise<HistoryDaySummary[]> {
  const rows = await invoke<HistoryDaySummary[]>("history_days", { from, to });
  return rows ?? [];
}
