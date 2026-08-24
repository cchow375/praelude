import type { Goal, PieceSummary } from "../pieces/types";
import type { HistoryDaySummary } from "../ledger/historyDays";
import type { DaySheet } from "../notebook/lines";

export type DailyWorkStatus = "planned" | "done" | "dismissed";
export type DailyWorkSource = "manual" | "planner" | "recovery";

export interface DailyWork {
  id: number;
  goal_id: number;
  region_id: number | null;
  block_id: number | null;
  title: string;
  planned_minutes: number;
  origin_date: string;
  scheduled_date: string;
  status: DailyWorkStatus;
  source: DailyWorkSource;
  reschedule_count: number;
  sort_order: number;
  completed_ts: string | null;
  created_ts: string;
  updated_ts: string;
  /** Display enrichment. Canonical ownership still comes from Goal. */
  piece_id: number;
  piece_title: string;
  goal_text: string;
  parent_goal_text: string | null;
}

export interface DailyWorkCreateArgs {
  goal_id: number;
  region_id: number | null;
  block_id: number | null;
  title: string;
  minutes: number;
  date: string;
  source: DailyWorkSource;
}

export interface DailyWorkPatch {
  title?: string;
  planned_minutes?: number;
  scheduled_date?: string;
  status?: DailyWorkStatus;
}

export type RecoveryAction = "move" | "done" | "dismiss" | "leave";

export interface RecoveryPreviewItem {
  work: DailyWork;
  proposed_date: string | null;
  reason: string;
  effective_deadline: string | null;
}

export interface RecoveryDay {
  date: string;
  planned_minutes: number;
  recovery_minutes: number;
  capacity_minutes: number;
}

export interface RecoveryPreview {
  today: string;
  capacity_minutes: number;
  items: RecoveryPreviewItem[];
  days: RecoveryDay[];
}

export interface RecoveryDecision {
  id: number;
  expected_updated_ts: string;
  action: RecoveryAction;
  date?: string;
}

export interface RecoveryApplyResult {
  applied_at: string;
  items: DailyWork[];
}

export interface CalendarApi {
  list: (request: {
    from: string;
    to: string;
    pieceId: number | null;
  }) => Promise<DailyWork[]>;
  create: (args: DailyWorkCreateArgs) => Promise<DailyWork>;
  update: (
    id: number,
    expectedUpdatedTs: string,
    patch: DailyWorkPatch,
  ) => Promise<DailyWork>;
  delete: (id: number, expectedUpdatedTs: string) => Promise<void>;
  recoveryPreview: () => Promise<RecoveryPreview>;
  recoveryApply: (
    decisions: RecoveryDecision[],
  ) => Promise<RecoveryApplyResult>;
  setCapacity: (minutes: number) => Promise<void>;
  listPieces: () => Promise<PieceSummary[]>;
  listGoals: (pieceId: number) => Promise<Goal[]>;
  /** Task B3: one call per visible week — the History read model's day
   * summaries, reused here to render the "done" side of each day cell. */
  historyDays: (from: string, to: string) => Promise<HistoryDaySummary[]>;
  /** Task B3: one call per visible week — existing day sheets in range, the
   * "planned" side of each day cell. */
  daySheetsRange: (from: string, to: string) => Promise<DaySheet[]>;
  /** Task A3: one call per visible week — every photographed day's thumbnail
   * in range, Liftoff-style background for its cell. */
  dayPhotoThumbs: (from: string, to: string) => Promise<DayPhotoThumb[]>;
}

/** Task A3: one photographed day's thumbnail, base64 JPEG, no data: prefix. */
export interface DayPhotoThumb {
  day: string;
  thumb_base64: string;
}
