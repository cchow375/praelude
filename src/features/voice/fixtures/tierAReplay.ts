import type {
  TierAContext,
  TierAIgnoredReason,
  TierAIntent,
  TierARejectionReason,
} from "../domain/tierAIntent";

export interface TierAReplayFixture {
  readonly id: string;
  readonly source:
    "curated" | "ambient" | "asr_corruption" | "complaint_2026_07_31";
  readonly at_ms: number;
  readonly raw_text: string;
  /**
   * Defaults to `true`. Set `false` to replay a PARTIAL hypothesis: the Rust
   * loop may act on one for a short allowlist (v6 S9 fast path), but this
   * parser never does — a partial is `ignored: non_final`, full stop. Pinning
   * that is what keeps the fast path from ever double-firing through the
   * frontend.
   */
  readonly is_final?: boolean;
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
  // -------------------------------------------------------------------------
  // Christian's July 31 complaints (v6 S9). Each phrase below is one he
  // reported broken, or one that must stay broken so the others can be fixed.
  // The Rust mirror of this table is
  // `src-tauri/tests/voice_complaint_fixtures.rs`; the two must not diverge.
  // -------------------------------------------------------------------------

  // "metronome on is like delayed by 5 seconds" — the fast-path phrases. The
  // Rust loop acts on these as PARTIALS; this parser must never do so, which is
  // exactly what stops the same utterance firing twice.
  {
    id: "complaint-fastpath-partial-metronome-off",
    source: "complaint_2026_07_31",
    at_ms: 3000,
    raw_text: "metronome off",
    is_final: false,
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "non_final" },
  },
  {
    id: "complaint-fastpath-partial-metronome-on",
    source: "complaint_2026_07_31",
    at_ms: 3010,
    raw_text: "metronome on",
    is_final: false,
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "non_final" },
  },
  {
    id: "complaint-fastpath-partial-stop",
    source: "complaint_2026_07_31",
    at_ms: 3020,
    raw_text: "stop",
    is_final: false,
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "non_final" },
  },
  {
    id: "complaint-fastpath-partial-done",
    source: "complaint_2026_07_31",
    at_ms: 3030,
    raw_text: "done",
    is_final: false,
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "non_final" },
  },
  // ...and as finals, where they do route.
  {
    id: "complaint-fastpath-final-metronome-off",
    source: "complaint_2026_07_31",
    at_ms: 3040,
    raw_text: "metronome off",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_off" } },
  },
  {
    id: "complaint-fastpath-final-metronome-on",
    source: "complaint_2026_07_31",
    at_ms: 3050,
    raw_text: "metronome on",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_on" } },
  },

  // "'metronome off' barely works" — every ASR mangling of the word.
  {
    id: "complaint-mangle-metranome-off",
    source: "complaint_2026_07_31",
    at_ms: 3100,
    raw_text: "metranome off",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_off" } },
  },
  {
    id: "complaint-mangle-metrodome-off",
    source: "complaint_2026_07_31",
    at_ms: 3110,
    raw_text: "metrodome off",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_off" } },
  },
  {
    id: "complaint-mangle-metro-gnome-off",
    source: "complaint_2026_07_31",
    at_ms: 3120,
    raw_text: "metro gnome off",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_off" } },
  },
  {
    id: "complaint-mangle-metro-nome-off",
    source: "complaint_2026_07_31",
    at_ms: 3130,
    raw_text: "metro nome off",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_off" } },
  },
  {
    id: "complaint-mangle-punctuated",
    source: "complaint_2026_07_31",
    at_ms: 3140,
    raw_text: "Metro-Gnome, off!",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_off" } },
  },
  {
    id: "complaint-mangle-metranome-on",
    source: "complaint_2026_07_31",
    at_ms: 3150,
    raw_text: "metranome on",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_on" } },
  },
  {
    id: "complaint-mangle-metro-nome-on",
    source: "complaint_2026_07_31",
    at_ms: 3160,
    raw_text: "metro nome on",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_on" } },
  },

  // "it's like Siri 2015" — the natural forms.
  {
    id: "complaint-natural-turn-the-metronome-off",
    source: "complaint_2026_07_31",
    at_ms: 3200,
    raw_text: "turn the metronome off",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_off" } },
  },
  {
    id: "complaint-natural-can-you-stop-the-metronome",
    source: "complaint_2026_07_31",
    at_ms: 3210,
    raw_text: "can you stop the metronome",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_off" } },
  },
  {
    id: "complaint-natural-could-you-turn-off",
    source: "complaint_2026_07_31",
    at_ms: 3220,
    raw_text: "could you turn the metronome off",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_off" } },
  },
  {
    id: "complaint-natural-hey-can-you-stop",
    source: "complaint_2026_07_31",
    at_ms: 3230,
    raw_text: "hey can you stop the metronome",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_off" } },
  },
  {
    id: "complaint-natural-metronome-please-stop",
    source: "complaint_2026_07_31",
    at_ms: 3240,
    raw_text: "metronome please stop",
    state_before: ACTIVE,
    expected: { classification: "matched", intent: { kind: "metronome_off" } },
  },
  {
    id: "complaint-natural-start-the-metronome",
    source: "complaint_2026_07_31",
    at_ms: 3250,
    raw_text: "start the metronome",
    state_before: IDLE,
    expected: { classification: "matched", intent: { kind: "metronome_on" } },
  },
  {
    id: "complaint-natural-turn-the-metronome-on",
    source: "complaint_2026_07_31",
    at_ms: 3260,
    raw_text: "turn the metronome on",
    state_before: IDLE,
    expected: { classification: "matched", intent: { kind: "metronome_on" } },
  },

  // The firewall. Every loosening above is only acceptable because these hold.
  {
    id: "complaint-adversarial-metronome-off-days",
    source: "complaint_2026_07_31",
    at_ms: 3300,
    raw_text: "I think the metronome off days are behind me",
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "not_exact_command" },
  },
  {
    id: "complaint-adversarial-done-with-the-slow-section",
    source: "complaint_2026_07_31",
    at_ms: 3310,
    raw_text: "we're done with the slow section, again from the top",
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "not_exact_command" },
  },
  {
    id: "complaint-adversarial-believe-the-metronome-on",
    source: "complaint_2026_07_31",
    at_ms: 3320,
    raw_text: "can you believe the metronome on that recording",
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "not_exact_command" },
  },
  {
    id: "complaint-adversarial-mangle-in-ambient-speech",
    source: "complaint_2026_07_31",
    at_ms: 3330,
    raw_text: "the metranome was off the whole time and I never noticed",
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "not_exact_command" },
  },
  {
    id: "complaint-adversarial-reported-speech",
    source: "complaint_2026_07_31",
    at_ms: 3340,
    raw_text: "I asked if you could stop the metronome",
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "not_exact_command" },
  },
  {
    id: "complaint-adversarial-no-context-memory",
    source: "complaint_2026_07_31",
    at_ms: 3350,
    raw_text: "turn it off",
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "not_exact_command" },
  },
  {
    id: "complaint-adversarial-bare-courtesy",
    source: "complaint_2026_07_31",
    at_ms: 3360,
    raw_text: "hey can you",
    state_before: ACTIVE,
    expected: { classification: "ignored", reason: "not_exact_command" },
  },
] as const;
