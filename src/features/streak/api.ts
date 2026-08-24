import { invoke } from "@tauri-apps/api/core";

// TypeScript mirror of `src-tauri/src/store/streaks.rs::StreakSummary`, field
// for field. Nothing here re-derives a streak; it only carries the already
// event-derived numbers across the wire.
export interface StreakSummary {
  current_days: number;
  best_days: number;
  threshold_minutes: number;
  today_focused_seconds: number;
}

export function streakSummary(): Promise<StreakSummary> {
  return invoke<StreakSummary>("streak_summary");
}
