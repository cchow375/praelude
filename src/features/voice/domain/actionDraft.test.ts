import { describe, expect, it } from "vitest";
import { parseNaturalPracticeActionDraft } from "./actionDraft";

const CONTEXT = {
  piece_id: 9,
  piece_title: "Scherzo No. 2",
  default_clean_streak: 5,
} as const;

describe("parseNaturalPracticeActionDraft", () => {
  it("turns Christian's example into a confirmation-only typed preview", () => {
    const draft = parseNaturalPracticeActionDraft(
      "I want to play measure 492-512 starting at tempo 50 and get to 64 ish and I'm gonna play it 15 times and speed it up",
      CONTEXT,
    );

    expect(draft).toMatchObject({
      kind: "start_practice_set",
      piece_id: 9,
      target: { m_start: 492, m_end: 512 },
      contract: {
        start_bpm: 50,
        target_bpm: 64,
        planned_attempts: 15,
        required_clean_streak: 5,
        method: "tempo ladder",
        use_metronome: true,
      },
      confirmation_required: true,
      status: "ready_to_confirm",
      issues: [],
    });
  });

  it("extracts hands, spoken numbers, and a single-measure target", () => {
    const draft = parseNaturalPracticeActionDraft(
      "Practice measure ninety six with left hand for eight reps starting at forty two",
      CONTEXT,
    );

    expect(draft?.target).toEqual({ m_start: 96, m_end: 96 });
    expect(draft?.contract).toMatchObject({
      start_bpm: 42,
      planned_attempts: 8,
      hands: "left",
      use_metronome: true,
    });
    expect(draft?.status).toBe("ready_to_confirm");
  });

  it("never guesses a missing piece or score location", () => {
    const draft = parseNaturalPracticeActionDraft(
      "Start practicing this section at tempo 60",
      { ...CONTEXT, piece_id: null, piece_title: null },
    );

    expect(draft?.target).toEqual({ m_start: null, m_end: null });
    expect(draft?.issues.map((entry) => entry.code)).toEqual([
      "missing_piece",
      "missing_score_range",
    ]);
    expect(draft?.status).toBe("needs_input");
    expect(draft?.confirmation_required).toBe(true);
  });

  it("rejects reversed ranges and impossible counts instead of repairing them silently", () => {
    const draft = parseNaturalPracticeActionDraft(
      "Practice measures 512 to 492 for 101 reps",
      CONTEXT,
    );

    expect(draft?.issues.map((entry) => entry.code)).toEqual([
      "invalid_score_range",
      "invalid_attempt_count",
    ]);
  });

  it("flags a contradictory upward ladder", () => {
    const draft = parseNaturalPracticeActionDraft(
      "Practice measures 4 through 8 starting at tempo 80 and get to 60 and speed it up",
      CONTEXT,
    );

    expect(draft?.issues.some((entry) => entry.code === "target_below_start")).toBe(true);
  });

  it("does not reclassify a general Brain question as an app action", () => {
    expect(parseNaturalPracticeActionDraft(
      "Why does this passage fall apart when I speed it up?",
      CONTEXT,
    )).toBeNull();
  });
});
