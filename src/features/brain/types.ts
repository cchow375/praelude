export type BrainProvider = "claude" | "gemini" | "offline";
export type BrainQuestionSource = "typed" | "voice";

export interface BrainCitation {
  source_id: string;
  label: string;
  excerpt: string;
  url?: string;
  /** Safe book/chapter/page locator; raw filesystem paths never cross IPC. */
  locator?: string;
}

export interface BrainMethod {
  id: string;
  name: string;
  why: string;
  dose: string;
  watch_for: string;
}

export interface IntakeReviewField {
  field: string;
  label: string;
  current: string | null;
  proposed: string | null;
}

export interface BrainIntakeReview {
  piece_id: number;
  piece_title: string;
  summary: string;
  fields: IntakeReviewField[];
}

export interface BrainAnswer {
  id: string;
  answer: string;
  provider: BrainProvider;
  citations: BrainCitation[];
  methods: BrainMethod[];
  intake_review?: BrainIntakeReview | null;
  grounding?: BrainGroundingSummary;
}

export interface BrainGroundingSummary {
  piece_title: string | null;
  region_name: string | null;
  measure_range: [number, number] | null;
  recent_rep_count: number;
  active_block_included: boolean;
  knowledge_status: "ready" | "partial" | "unavailable" | string;
  knowledge_shared_with_provider: boolean;
  knowledge_sources: string[];
  musicxml_status: "ready" | "missing" | "not_requested" | "unsupported" | string;
  warnings: string[];
}

export interface BrainAskRequest {
  question: string;
  source: BrainQuestionSource;
  /** Kept explicit for the current backend context resolver. */
  piece_id: number | null;
  /** Bounded prior dialogue. The backend must not rely on client-only state. */
  history: BrainConversationTurn[];
  /** Exact visible practice state, or null when no piece is active in the UI. */
  context: PracticeBrainContext | null;
}

export interface BrainConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PracticeBrainRegionContext {
  id: number;
  name: string;
  notes: string | null;
  m_start: number;
  m_end: number;
}

export interface PracticeBrainContext {
  piece_id: number;
  piece_title: string;
  composer: string | null;
  surface: "details" | "score";
  region: PracticeBrainRegionContext | null;
  current_page: number | null;
  edition_id: string | null;
  edition_label: string | null;
  active_block?: {
    m_start: number;
    m_end: number;
    bpm: number;
    target_bpm: number | null;
    focus: string;
    reps_done: number;
    planned_reps: number;
  } | null;
}

export interface IntakeChange {
  field: string;
  value: string | null;
}

export interface BrainIntakeApplyRequest {
  answer_id: string;
  piece_id: number;
  changes: IntakeChange[];
}

export interface BrainIntakeApplyResult {
  piece_id: number;
  saved_at: string;
}

export interface WorkSuggestion {
  id: string;
  kind: "goal" | "open_block" | "revisit" | string;
  goal_id: number | null;
  title: string;
  m_start: number | null;
  m_end: number | null;
  score: number;
  reasons: string[];
}

export interface PlannerScheduleRequest {
  goal_id: number;
  title: string;
  minutes: number;
  date: string;
}

export interface BrainApi {
  ask: (request: BrainAskRequest) => Promise<BrainAnswer>;
  applyIntakeReview: (request: BrainIntakeApplyRequest) => Promise<BrainIntakeApplyResult>;
  planPreview: (pieceId: number | null) => Promise<WorkSuggestion[]>;
  schedule: (request: PlannerScheduleRequest) => Promise<void>;
}

export interface WakeQuestion {
  /** Monotonically changes for each voice event, even for repeated wording. */
  id: number;
  text: string;
}
