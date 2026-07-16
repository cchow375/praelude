import { parseSpokenInteger } from "./spokenNumber";

export type PracticeHands = "left" | "right" | "together" | "separate";

export interface NaturalPracticeDraftContext {
  readonly piece_id: number | null;
  readonly piece_title: string | null;
  readonly default_clean_streak: number;
}

export interface PracticeTargetDraft {
  readonly m_start: number | null;
  readonly m_end: number | null;
}

export interface PracticeContractDraft {
  readonly start_bpm: number | null;
  readonly target_bpm: number | null;
  readonly planned_attempts: number | null;
  readonly required_clean_streak: number;
  readonly hands: PracticeHands | null;
  readonly method: string | null;
  readonly intention: string | null;
  readonly use_metronome: boolean;
}

export type ActionDraftIssueCode =
  | "missing_piece"
  | "missing_score_range"
  | "invalid_score_range"
  | "invalid_start_tempo"
  | "invalid_target_tempo"
  | "target_below_start"
  | "invalid_attempt_count";

export interface ActionDraftIssue {
  readonly code: ActionDraftIssueCode;
  readonly field: string;
  readonly message: string;
}

export interface NaturalPracticeActionDraft {
  readonly kind: "start_practice_set";
  readonly source_text: string;
  readonly piece_id: number | null;
  readonly piece_title: string | null;
  readonly target: PracticeTargetDraft;
  readonly contract: PracticeContractDraft;
  /** Every Lane-B mutation is a preview. `true` is intentionally invariant. */
  readonly confirmation_required: true;
  readonly issues: readonly ActionDraftIssue[];
  readonly status: "ready_to_confirm" | "needs_input";
}

const MIN_MEASURE = 1;
const MAX_MEASURE = 20_000;
const MIN_BPM = 20;
const MAX_BPM = 300;
const MIN_ATTEMPTS = 1;
const MAX_ATTEMPTS = 100;

function normalizeSpeech(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’']/gu, "")
    .replace(/[–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

function parseNumberFragment(fragment: string): number | null {
  const cleaned = fragment
    .replace(/\b(?:ish|approximately|about|around)\b/gu, "")
    .replace(/[,.!?;:]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return parseSpokenInteger(cleaned);
}

function captureNumber(text: string, expressions: readonly RegExp[]): number | null {
  for (const expression of expressions) {
    const match = expression.exec(text);
    if (!match?.[1]) continue;
    const value = parseNumberFragment(match[1]);
    if (value !== null) return value;
  }
  return null;
}

function extractRange(text: string): PracticeTargetDraft {
  const range = /\b(?:measures?|mm?)\.?\s+([a-z\d\s-]+?)\s*(?:-|\bto\b|\bthrough\b)\s*([a-z\d\s]+?)(?=\s+(?:starting|start|at|from|around|aim|target|get|for|and|with|using|left|right|hands?|play|practice)\b|[,.;!?]|$)/u.exec(text);
  if (range) {
    return {
      m_start: parseNumberFragment(range[1]),
      m_end: parseNumberFragment(range[2]),
    };
  }

  const single = /\b(?:measure|m)\.?\s+([a-z\d\s]+?)(?=\s+(?:starting|start|at|from|around|aim|target|get|for|and|with|using|left|right|hands?|play|practice)\b|[,.;!?]|$)/u.exec(text);
  const measure = single?.[1] ? parseNumberFragment(single[1]) : null;
  return { m_start: measure, m_end: measure };
}

function extractHands(text: string): PracticeHands | null {
  if (/\b(?:hands separate|separate hands|one hand at a time)\b/u.test(text)) return "separate";
  if (/\b(?:hands together|both hands|together)\b/u.test(text)) return "together";
  if (/\b(?:left hand|lh)\b/u.test(text)) return "left";
  if (/\b(?:right hand|rh)\b/u.test(text)) return "right";
  return null;
}

function extractMethod(text: string): string | null {
  const methods: ReadonlyArray<readonly [RegExp, string]> = [
    [/\b(?:rhythmic variants?|rhythm variants?|dotted rhythms?)\b/u, "rhythmic variants"],
    [/\b(?:blocked practice|block the chords?|blocked chords?)\b/u, "blocked practice"],
    [/\b(?:metronome ladder|tempo ladder|speed it up|build(?:ing)? tempo)\b/u, "tempo ladder"],
    [/\b(?:silent fingering|shadow practice)\b/u, "silent fingering"],
    [/\b(?:backward chaining|chain backwards?)\b/u, "backward chaining"],
  ];
  return methods.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function issue(
  code: ActionDraftIssueCode,
  field: string,
  message: string,
): ActionDraftIssue {
  return { code, field, message };
}

function validInteger(value: number | null, min: number, max: number): boolean {
  return value !== null && Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Revalidate an edited preview without reparsing or consulting a model. */
export function validateNaturalPracticeActionDraft(
  draft: Pick<
    NaturalPracticeActionDraft,
    "piece_id" | "target" | "contract"
  >,
): ActionDraftIssue[] {
  const issues: ActionDraftIssue[] = [];
  if (draft.piece_id === null) {
    issues.push(issue("missing_piece", "piece_id", "Choose the piece before this set can start."));
  }
  if (draft.target.m_start === null || draft.target.m_end === null) {
    issues.push(issue("missing_score_range", "target", "Confirm the score range before this set can start."));
  } else if (
    !validInteger(draft.target.m_start, MIN_MEASURE, MAX_MEASURE)
    || !validInteger(draft.target.m_end, MIN_MEASURE, MAX_MEASURE)
    || draft.target.m_start > draft.target.m_end
  ) {
    issues.push(issue("invalid_score_range", "target", "The measure range must run forward and use valid score numbers."));
  }
  if (
    draft.contract.start_bpm !== null
    && !validInteger(draft.contract.start_bpm, MIN_BPM, MAX_BPM)
  ) {
    issues.push(issue("invalid_start_tempo", "start_bpm", `Start tempo must be ${MIN_BPM}–${MAX_BPM} BPM.`));
  }
  if (
    draft.contract.target_bpm !== null
    && !validInteger(draft.contract.target_bpm, MIN_BPM, MAX_BPM)
  ) {
    issues.push(issue("invalid_target_tempo", "target_bpm", `Target tempo must be ${MIN_BPM}–${MAX_BPM} BPM.`));
  }
  if (
    draft.contract.start_bpm !== null
    && draft.contract.target_bpm !== null
    && validInteger(draft.contract.start_bpm, MIN_BPM, MAX_BPM)
    && validInteger(draft.contract.target_bpm, MIN_BPM, MAX_BPM)
    && draft.contract.target_bpm < draft.contract.start_bpm
    && draft.contract.method === "tempo ladder"
  ) {
    issues.push(issue("target_below_start", "target_bpm", "A tempo-ladder target cannot be below its start tempo."));
  }
  if (
    draft.contract.planned_attempts !== null
    && !validInteger(draft.contract.planned_attempts, MIN_ATTEMPTS, MAX_ATTEMPTS)
  ) {
    issues.push(issue("invalid_attempt_count", "planned_attempts", `Attempt count must be ${MIN_ATTEMPTS}–${MAX_ATTEMPTS}.`));
  }
  return issues;
}

/**
 * Parse the bounded, high-value subset of a natural start-set request.
 *
 * This function is deliberately a draft builder, not an intent executor. It
 * never resolves an unknown score location, never invents omitted fields, and
 * always requires confirmation before any native write.
 */
export function parseNaturalPracticeActionDraft(
  sourceText: string,
  context: NaturalPracticeDraftContext,
): NaturalPracticeActionDraft | null {
  const text = normalizeSpeech(sourceText);
  const practiceRequest = /\b(?:play|practice|work on|start|begin|restart)\b/u.test(text);
  const scoreCue = /\b(?:measure|measures|mm|section|passage)\b/u.test(text);
  if (!practiceRequest || !scoreCue) return null;

  const target = extractRange(text);
  const startBpm = captureNumber(text, [
    /\b(?:starting|start|begin)(?:\s+at)?(?:\s+(?:tempo|bpm))?\s+([a-z\d\s-]+?)(?=\s+(?:and|then|to|get|aim|target|for|with|using|left|right|hands?|speed)\b|[,.;!?]|$)/u,
    /\b(?:at|from)\s+(?:tempo|bpm)\s+([a-z\d\s-]+?)(?=\s+(?:and|then|to|get|aim|target|for|with|using|left|right|hands?|speed)\b|[,.;!?]|$)/u,
  ]);
  const targetBpm = captureNumber(text, [
    /\b(?:get|build|work|go|up)\s+to\s+(?:tempo\s+|bpm\s+)?([a-z\d\s-]+?)(?=\s+(?:ish|and|then|for|with|using|left|right|hands?|speed)\b|[,.;!?]|$)/u,
    /\b(?:aim|target)(?:\s+for|\s+at|\s+tempo|\s+bpm)?\s+([a-z\d\s-]+?)(?=\s+(?:ish|and|then|for|with|using|left|right|hands?|speed)\b|[,.;!?]|$)/u,
  ]);
  const plannedAttempts = captureNumber(text, [
    /\b(?:for|do|complete|play(?:\s+it|\s+that|\s+the passage)?)\s+([a-z\d\s-]+?)\s+(?:reps?|repetitions?|times|attempts?)\b/u,
    /\b(\d{1,4})\s+(?:reps?|repetitions?|times|attempts?)\b/u,
  ]);
  const hands = extractHands(text);
  const method = extractMethod(text);
  const useMetronome = startBpm !== null
    || targetBpm !== null
    || method === "tempo ladder"
    || /\bmetronome\b/u.test(text);

  const cleanTarget = Number.isSafeInteger(context.default_clean_streak)
    && context.default_clean_streak >= 1
    && context.default_clean_streak <= 100
    ? context.default_clean_streak
    : 5;

  const base = {
    kind: "start_practice_set",
    source_text: sourceText,
    piece_id: context.piece_id,
    piece_title: context.piece_title,
    target,
    contract: {
      start_bpm: startBpm,
      target_bpm: targetBpm,
      planned_attempts: plannedAttempts,
      required_clean_streak: cleanTarget,
      hands,
      method,
      intention: null,
      use_metronome: useMetronome,
    },
    confirmation_required: true as const,
  } satisfies Omit<NaturalPracticeActionDraft, "issues" | "status">;
  const issues = validateNaturalPracticeActionDraft(base);
  return {
    ...base,
    issues,
    status: issues.length === 0 ? "ready_to_confirm" : "needs_input",
  };
}
