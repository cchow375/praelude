import type {
  TierAContext,
  TierAIgnoredReason,
  TierAIntent,
  TierARejectionReason,
} from "../domain/tierAIntent";

export interface TierAReplayFixture {
  readonly id: string;
  readonly source: "curated" | "ambient" | "asr_corruption";
  readonly at_ms: number;
  readonly raw_text: string;
  readonly state_before: TierAContext;
  readonly expected:
    | {
        readonly classification: "matched";
        readonly intent: TierAIntent;
      }
    | {
        readonly classification: "rejected";
        readonly reason: TierARejectionReason;
      }
    | {
        readonly classification: "ignored";
        readonly reason: TierAIgnoredReason;
      };
}

const ACTIVE: TierAContext = {
  practice_state: "active",
  metronome_running: true,
  last_attempt_available: true,
  pending_duplicate_attempt: false,
  retention_due: false,
};

const IDLE: TierAContext = {
  practice_state: "idle",
  metronome_running: false,
  last_attempt_available: false,
  pending_duplicate_attempt: false,
  retention_due: false,
};

export const TIER_A_REPLAY_FIXTURES: readonly TierAReplayFixture[] = [
  {
    id: "done-clean",
    source: "curated",
    at_ms: 0,
    raw_text: "Done.",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "record_attempt", verdict: "clean" },
    },
  },
  {
    id: "again-miss",
    source: "curated",
    at_ms: 10,
    raw_text: "Again.",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "record_attempt", verdict: "miss" },
    },
  },
  {
    id: "clean-punctuation",
    source: "curated",
    at_ms: 0,
    raw_text: "  GOT IT! ",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "record_attempt", verdict: "clean" },
    },
  },
  {
    id: "miss-exact",
    source: "curated",
    at_ms: 100,
    raw_text: "Missed.",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "record_attempt", verdict: "miss" },
    },
  },
  {
    id: "flawed-exact",
    source: "curated",
    at_ms: 200,
    raw_text: "Sloppy",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "record_attempt", verdict: "flawed" },
    },
  },
  {
    id: "batch-spoken-number",
    source: "curated",
    at_ms: 300,
    raw_text: "Count that as four.",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "report_attempt_count", count: 4 },
    },
  },
  {
    id: "batch-did",
    source: "curated",
    at_ms: 400,
    raw_text: "did 12",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "report_attempt_count", count: 12 },
    },
  },
  {
    id: "undo",
    source: "curated",
    at_ms: 500,
    raw_text: "Undo last rep",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "undo_last_attempt" },
    },
  },
  {
    id: "correct-verdict",
    source: "curated",
    at_ms: 600,
    raw_text: "Correct last to clean",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "correct_last_attempt", verdict: "clean" },
    },
  },
  {
    id: "restart",
    source: "curated",
    at_ms: 700,
    raw_text: "Restart the set",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "restart_set" },
    },
  },
  {
    id: "restart-streak",
    source: "curated",
    at_ms: 710,
    raw_text: "Restart the streak",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "reset_clean_streak" },
    },
  },
  {
    id: "close-set",
    source: "curated",
    at_ms: 720,
    raw_text: "Close set",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "close_set" },
    },
  },
  {
    id: "pause",
    source: "curated",
    at_ms: 800,
    raw_text: "Pause practice",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "pause_practice" },
    },
  },
  {
    id: "resume",
    source: "curated",
    at_ms: 900,
    raw_text: "Resume practice",
    state_before: { ...ACTIVE, practice_state: "paused" },
    expected: {
      classification: "matched",
      intent: { kind: "resume_practice" },
    },
  },
  {
    id: "metro-on",
    source: "curated",
    at_ms: 1000,
    raw_text: "Metronome on.",
    state_before: IDLE,
    expected: {
      classification: "matched",
      intent: { kind: "metronome_on" },
    },
  },
  {
    id: "metro-off",
    source: "curated",
    at_ms: 1100,
    raw_text: "Turn the metronome off",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "metronome_off" },
    },
  },
  {
    id: "faster",
    source: "curated",
    at_ms: 1200,
    raw_text: "Faster!",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "adjust_tempo", direction: "faster" },
    },
  },
  {
    id: "tempo-spoken",
    source: "curated",
    at_ms: 1300,
    raw_text: "Set tempo to ninety-six",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "set_tempo", bpm: 96 },
    },
  },
  {
    id: "tempo-correction",
    source: "curated",
    at_ms: 1400,
    raw_text: "Correct last tempo to 60",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "correct_tempo", bpm: 60 },
    },
  },
  {
    id: "safety",
    source: "curated",
    at_ms: 1500,
    raw_text: "Safety stop",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "safety_stop" },
    },
  },
  {
    id: "narrated-pain-safety",
    source: "curated",
    at_ms: 1510,
    raw_text: "It's kind of hurt now",
    state_before: ACTIVE,
    expected: {
      classification: "matched",
      intent: { kind: "safety_stop" },
    },
  },
  {
    id: "retention-confirm",
    source: "curated",
    at_ms: 1600,
    raw_text: "Confirm retention",
    state_before: { ...IDLE, retention_due: true },
    expected: {
      classification: "matched",
      intent: { kind: "retention", action: "confirm" },
    },
  },
  {
    id: "ambient-no-thanks",
    source: "ambient",
    at_ms: 1700,
    raw_text: "No, thanks.",
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "not_exact_command" },
  },
  {
    id: "ambient-miss-clause",
    source: "ambient",
    at_ms: 1800,
    raw_text: "I missed the E",
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "not_exact_command" },
  },
  {
    id: "ambient-command-token",
    source: "ambient",
    at_ms: 1900,
    raw_text: "Again, just to double check, the metronome is off today",
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "not_exact_command" },
  },
  {
    id: "ambient-broad-stop",
    source: "ambient",
    at_ms: 2000,
    raw_text: "Please stop the store",
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "not_exact_command" },
  },
  {
    id: "ambient-verdict-idle",
    source: "ambient",
    at_ms: 2100,
    raw_text: "no",
    state_before: IDLE,
    expected: { classification: "ignored", reason: "state_mismatch" },
  },
  {
    id: "homophone-four",
    source: "asr_corruption",
    at_ms: 2200,
    raw_text: "count for",
    state_before: ACTIVE,
    expected: { classification: "rejected", reason: "invalid_count" },
  },
  {
    id: "numeric-colon",
    source: "asr_corruption",
    at_ms: 2300,
    raw_text: "set tempo 5:16",
    state_before: ACTIVE,
    expected: {
      classification: "rejected",
      reason: "unsafe_numeric_punctuation",
    },
  },
  {
    id: "batch-too-large",
    source: "asr_corruption",
    at_ms: 2400,
    raw_text: "count 101",
    state_before: ACTIVE,
    expected: { classification: "rejected", reason: "count_out_of_range" },
  },
] as const;
