import { invoke } from "@tauri-apps/api/core";
import type { DaySheet } from "../notebook/lines";

// ---------------------------------------------------------------------------
// Task B2: TypeScript mirrors of task B1's three read-only Tauri commands.
// Field names and shapes match `src-tauri/src/store/history_days.rs` VERBATIM
// — this file is the frontend half of that contract. Every day boundary is a
// LOCAL calendar day (see the Rust module doc); nothing here re-derives that
// bucketing, it only carries the already-bucketed evidence across the wire.
// ---------------------------------------------------------------------------

/** One piece's slice of a day's attempts, inside {@link HistoryDaySummary}. */
export interface HistoryDayPiece {
  piece_id: number;
  title: string;
  attempts: number;
}

/** One row of the History day timeline: a LOCAL calendar day with any
 * practice evidence, rolled up across every session/set touched that day. */
export interface HistoryDaySummary {
  /** `YYYY-MM-DD`, local. */
  date: string;
  focused_seconds: number;
  session_count: number;
  attempts: number;
  cleans: number;
  sets_touched: number;
  mastered_sets: number;
  pieces: HistoryDayPiece[];
}

/** One session's slice of a {@link HistoryDayDetail}. */
export interface HistoryDaySession {
  session_id: number;
  started_at: string;
  ended_at: string | null;
  focused_seconds: number;
}

/** One set's slice of a {@link HistoryDayDetail} — that day's attempts on a
 * block, joined out to its piece/region names. `mastery_status` is the set's
 * CURRENT live projection, not a day-specific snapshot — the day-specific
 * numbers are `attempts`/`cleans`/`flawed`/`failed`. */
export interface HistoryDaySet {
  block_id: number;
  piece_id: number;
  piece_title: string;
  region_name: string | null;
  m_start: number;
  m_end: number;
  attempts: number;
  cleans: number;
  flawed: number;
  failed: number;
  start_bpm: number;
  end_bpm: number;
  mastery_status: string;
  mastery_basis: string;
  attempt_target: number | null;
  first_ts: string;
  last_ts: string;
}

/** One LOCAL calendar day's full detail: every session and every set touched
 * that day. */
export interface HistoryDayDetail {
  date: string;
  sessions: HistoryDaySession[];
  sets: HistoryDaySet[];
}

/** One row per LOCAL day in `[from,to]` with any practice evidence, newest
 * first — the History timeline's top-level list. */
export async function historyDays(
  from: string,
  to: string,
): Promise<HistoryDaySummary[]> {
  const result = await invoke<HistoryDaySummary[]>("history_days", {
    from,
    to,
  });
  return result ?? [];
}

/** One LOCAL day's full detail: every session and every set touched that
 * day. An empty day returns an empty detail, never an error. */
export async function historyDayDetail(
  date: string,
): Promise<HistoryDayDetail> {
  return invoke<HistoryDayDetail>("history_day_detail", { date });
}

/** Existing day sheets whose `date` falls in `[from,to]`, ascending —
 * read-only, never creates a row for a date that has none. */
export async function daySheetsRange(
  from: string,
  to: string,
): Promise<DaySheet[]> {
  const result = await invoke<DaySheet[]>("day_sheets_range", { from, to });
  return result ?? [];
}
