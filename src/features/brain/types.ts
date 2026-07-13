export type BrainProvider = "claude" | "gemini" | "offline";
export type BrainQuestionSource = "typed" | "voice";

export interface BrainCitation {
  source_id: string;
  label: string;
  excerpt: string;
  url?: string;
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
}

export interface BrainAskRequest {
  question: string;
  source: BrainQuestionSource;
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
  title: string;
  m_start: number | null;
  m_end: number | null;
  score: number;
  reasons: string[];
}

export interface BrainApi {
  ask: (request: BrainAskRequest) => Promise<BrainAnswer>;
  applyIntakeReview: (request: BrainIntakeApplyRequest) => Promise<BrainIntakeApplyResult>;
  planPreview: () => Promise<WorkSuggestion[]>;
}

export interface WakeQuestion {
  /** Monotonically changes for each voice event, even for repeated wording. */
  id: number;
  text: string;
}
