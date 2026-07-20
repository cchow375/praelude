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
  /**
   * Confirm-gated spoken-request action. Backend emits it only for voice
   * questions and only when well-formed; the frontend re-narrows it before use.
   */
  proposed_action?: unknown;
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
  /** Durable per-piece thread to append this exchange to, or null. */
  thread_id: number | null;
  /** Bounded prior dialogue. The backend must not rely on client-only state. */
  history: BrainConversationTurn[];
  /** Exact visible practice state, or null when no piece is active in the UI. */
  context: PracticeBrainContext | null;
}

export interface BrainConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/** One durable turn loaded when a piece's Brain thread resumes on open. */
export interface BrainTurnRow {
  role: "user" | "assistant";
  content: string;
  provider: BrainProvider | null;
  citations: BrainCitation[];
  created_ts: string;
}

/** The active thread for a piece plus its bounded recent turns. */
export interface BrainThreadResume {
  thread_id: number;
  turns: BrainTurnRow[];
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
  /** Date-scoped plain-English intention from Today's visible plan box. */
  today_plan?: string | null;
  active_block?: {
    /** Stable native set identity, used only to keep a delayed proposal bound
     *  to the set that was active when the question was asked. */
    block_id?: number;
    m_start: number;
    m_end: number;
    bpm: number | null;
    target_bpm: number | null;
    focus: string;
    use_metronome: boolean;
    reps_done: number;
    planned_reps: number;
    attempts_recorded: number;
    tries: number;
    current_clean_streak: number | null;
    mastery_progress_streak: number | null;
    required_clean_streak: number | null;
    mastery_status: "satisfied" | "not_satisfied" | "not_applicable" | "unverified_legacy";
    mastery_verified: boolean;
    set_state: string;
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
  /** Resume (or create) the piece's active durable Brain thread. */
  resumeThread: (pieceId: number) => Promise<BrainThreadResume>;
  /** Clear the piece's active thread so the next resume starts fresh. */
  clearThread: (pieceId: number) => Promise<void>;
}

export interface WakeQuestion {
  /** Monotonically changes for each voice event, even for repeated wording. */
  id: number;
  text: string;
}
