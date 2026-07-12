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
}

export interface Rep {
  id: number;
  block_id: number;
  ts: string;
  bpm: number;
  variant: string | null;
  verdict: "clean" | "flawed" | "failed";
  note: string | null;
}

export interface Region {
  id: number;
  piece_id: number;
  name: string;
  m_start: number;
  m_end: number;
  kind: string;
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
