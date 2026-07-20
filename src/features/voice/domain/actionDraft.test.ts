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

  it("grounds 'this section' in the exact selected Score Region", () => {
    const draft = parseNaturalPracticeActionDraft(
      "I want to do dotted rhythms five times on the right hand at 80",
      {
        ...CONTEXT,
        target: {
          region_id: 44,
          label: "Coda landing",
          m_start: 720,
          m_end: 732,
        },
        current_page: 18,
      },
    );

    expect(draft).toMatchObject({
      piece_id: 9,
      target: {
        region_id: 44,
        label: "Coda landing",
        m_start: 720,
        m_end: 732,
        page: 18,
      },
      contract: {
        start_bpm: 80,
        planned_attempts: 5,
        hands: "right",
        method: "rhythmic variants",
        use_metronome: true,
      },
      status: "ready_to_confirm",
      issues: [],
    });
  });

  it("keeps a page-only reference as a reviewable draft instead of inventing measures", () => {
    const draft = parseNaturalPracticeActionDraft(
      "Practice this section at 60",
      { ...CONTEXT, target: null, current_page: 18 },
    );

    expect(draft?.target).toEqual({ m_start: null, m_end: null });
    expect(draft?.issues.map((entry) => entry.code)).toContain(
      "missing_score_range",
    );
    expect(draft?.status).toBe("needs_input");
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

  it.each([
    "How should I practice this section?",
    "I'm having trouble when I practice this section",
    "I can't do dotted rhythms in this section",
    "Do you think I should practice this passage slowly?",
  ])("does not turn advice or failure narration into a set: %s", (text) => {
    expect(parseNaturalPracticeActionDraft(text, {
      ...CONTEXT,
      target: {
        region_id: 44,
        label: "Coda landing",
        m_start: 720,
        m_end: 732,
      },
    })).toBeNull();
  });

  it.each([
    "Okay, I'm gonna play this five times",
    "Can you start measures 720 to 732 for five reps?",
    "Could you do dotted rhythms five times?",
  ])("accepts an explicitly framed practice action: %s", (text) => {
    const draft = parseNaturalPracticeActionDraft(text, {
      ...CONTEXT,
      target: {
        region_id: 44,
        label: "Coda landing",
        m_start: 720,
        m_end: 732,
      },
    });
    expect(draft?.status).toBe("ready_to_confirm");
    expect(draft?.target).toMatchObject({ m_start: 720, m_end: 732 });
    expect(draft?.contract.planned_attempts).toBe(5);
  });
});
