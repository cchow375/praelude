import { describe, expect, it } from "vitest";
import { actionDraftSpeech } from "./actionDraftSpeech";

describe("actionDraftSpeech", () => {
  it("reads back a grounded set in one short confirmation prompt", () => {
    expect(actionDraftSpeech({
      kind: "start_practice_set",
      source_text: "dotted rhythms five times right hand at 80",
      piece_id: 7,
      piece_title: "Beethoven Opus 90",
      target: {
        m_start: 41,
        m_end: 48,
        region_id: 3,
        label: "Coda landing",
        page: 4,
      },
      contract: {
        start_bpm: 80,
        target_bpm: null,
        planned_attempts: 5,
        required_clean_streak: 5,
        hands: "right",
        method: "rhythmic variants",
        intention: null,
        use_metronome: true,
      },
      confirmation_required: true,
      issues: [],
      status: "ready_to_confirm",
    })).toBe(
      "Start Beethoven Opus 90, Coda landing, right hand, rhythmic variants, 5 attempts, at 80 beats per minute? Say confirm or cancel.",
    );
  });

  it("asks for the missing score target instead of inventing one", () => {
    expect(actionDraftSpeech({
      kind: "start_practice_set",
      source_text: "practice page four",
      piece_id: 7,
      piece_title: "Beethoven Opus 90",
      target: { m_start: null, m_end: null },
      contract: {
        start_bpm: null,
        target_bpm: null,
        planned_attempts: null,
        required_clean_streak: 5,
        hands: null,
        method: null,
        intention: null,
        use_metronome: false,
      },
      confirmation_required: true,
      issues: [{ code: "missing_score_range", message: "Pick a target." }],
      status: "needs_input",
    })).toMatch(/need the exact score section/i);
  });

  it("uses the deterministic summary for Brain proposals", () => {
    expect(actionDraftSpeech({
      kind: "tempo",
      summary: "Set the metronome to 72",
      bpm: 72,
    })).toBe("Set the metronome to 72. Say confirm or cancel.");
  });
});
