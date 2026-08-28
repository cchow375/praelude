import type { VerdictCounts } from "../rep/useRep";

// ---------------------------------------------------------------------------
// Piece-domain serde types (defined by Task 15/17, consumed by the frontend).
// All field names are snake_case to match the serde payloads exactly.
// ---------------------------------------------------------------------------

export interface PieceSummary {
  id: number;
  title: string;
  composer: string | null;
  has_xml: boolean;
  has_pdf: boolean;
  intake_done: boolean;
  /** Unix seconds; absent on legacy/dev fixtures and null for active pieces. */
  archived_at?: number | null;
  /** ISO timestamp of the most recent recorded attempt. */
  last_practiced?: string | null;
}

export interface PieceMovement {
  id: number;
  piece_id: number;
  title: string;
  start_page: number;
  display_order: number;
}

export interface HardSpot {
  measures: string;
  note: string;
}

export interface PieceDetailData extends PieceSummary {
  folder_path: string;
  xml_path: string | null;
  pdf_path: string | null;
  goals: string[];
  deadline: string | null;
  target_tempo: number | null;
  hard_spots: HardSpot[];
  current_state: string | null;
  notes: string | null;
  /** The one goal sentence pinned over this piece's score (schema v14 / A11). */
  banner_text: string | null;
}

export interface Intake {
  goals: string[];
  deadline: string | null;
  target_tempo: number | null;
  hard_spots: HardSpot[];
  current_state: string | null;
}

/**
 * One row of a piece's block history (`rep_blocks_for_piece`). The contract
 * pins this loosely ("block + rep counts by verdict"); fields are read
 * defensively in the UI so integration-time drift is tolerable.
 */
export interface BlockHistory {
  block_id: number;
  m_start: number;
  m_end: number;
  label: string | null;
  start_bpm: number | null;
  bpm: number | null;
  target_bpm: number | null;
  planned_reps: number;
  reps_done: number;
  status: string;
  verdicts: VerdictCounts;
  region_id: number | null;
  focus: string;
  use_metronome: boolean;
  attempts_recorded?: number;
  tries?: number;
  voided_attempts?: number;
  current_clean_streak?: number;
  mastery_progress_streak?: number;
  best_clean_streak?: number;
  reset_count?: number;
  accuracy?: number | null;
  required_clean_streak?: number | null;
  effective_required_clean_streak?: number | null;
  /** Persisted completion contract. Total attempts is volume, not mastery. */
  mastery_basis?:
    | "consecutive_clean"
    | "total_attempts"
    | "total_clean"
    | "timed_exposure"
    | "exploratory"
    | "legacy_attempt_count";
  attempt_target?: number | null;
  recovery_remaining?: number;
  mastery_status?:
    "satisfied" | "not_satisfied" | "not_applicable" | "unverified_legacy";
  mastery_verified?: boolean;
  set_state?: string;
  /** Optional review prompt; reaching it never proves mastery. */
  attempt_ceiling?: number | null;
  /** Captured origin of the practice contract, when supplied by v2. */
  contract_source?: string;
}

export interface Rep {
  id: number;
  block_id: number;
  ts: string;
  bpm: number | null;
  variant: string | null;
  verdict: "clean" | "flawed" | "failed";
  note: string | null;
  original_verdict?: "clean" | "flawed" | "failed";
  voided?: boolean;
  source?: string;
  active_adjustment_ids?: number[];
}

export interface Region {
  id: number;
  piece_id: number;
  name: string;
  notes: string | null;
  m_start: number;
  m_end: number;
  kind: string;
  /** Task C5: the parent region, when this is a one-level sub-section
   * (`target_meta.parent_region_id`). `null` for every top-level region. */
  parent_region_id: number | null;
  order: number;
  color: string | null;
  pdf_anchor: unknown | null;
}

export interface Goal {
  id: number;
  piece_id: number;
  text: string;
  kind: "big" | "sub";
  parent_goal_id: number | null;
  done: boolean;
  order: number;
  target_date: string | null;
  created_ts: string;
}

export interface RegionMastery {
  region_id: number;
  name: string;
  blocks: number;
  reps: number;
  clean_ratio: number;
  best_bpm: number | null;
  last_practiced: string | null;
}

export interface ProgressSummary {
  piece_id: number;
  focused_seconds: number;
  per_region_mastery: RegionMastery[];
  streak: number;
  best_tempo_reached: number | null;
  time_by_focus: { focus: string; seconds: number }[];
}
