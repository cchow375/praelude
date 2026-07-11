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
  start_bpm: number;
  bpm: number;
  target_bpm: number | null;
  planned_reps: number;
  reps_done: number;
  status: string;
  verdicts: VerdictCounts;
}
