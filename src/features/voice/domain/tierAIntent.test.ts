import { describe, expect, it } from "vitest";
import { TIER_A_REPLAY_FIXTURES } from "../fixtures/tierAReplay";
import type { VoiceTranscriptDelivery } from "./delivery";
import {
  normalizeTierATranscript,
  parseTierAIntent,
  TIER_A_COUNT_MAX,
  TIER_A_COUNT_MIN,
  TIER_A_TEMPO_MAX,
  TIER_A_TEMPO_MIN,
  type TierAContext,
} from "./tierAIntent";

const ACTIVE: TierAContext = {
  practice_state: "active",
  metronome_running: true,
  last_attempt_available: true,
  pending_duplicate_attempt: false,
  retention_due: false,
};

function delivery(
  text: string,
  overrides: Partial<VoiceTranscriptDelivery> = {},
): VoiceTranscriptDelivery {
  return {
    delivery_id: "fixture-delivery",
    revision: 0,
    text,
    is_final: true,
    recognition: { source: "narrated_replay", confidence: 0.88 },
    ...overrides,
  };
}

describe("Tier A curated replay fixtures", () => {
  for (const fixture of TIER_A_REPLAY_FIXTURES) {
    it(`${fixture.id}: ${fixture.raw_text}`, () => {
      const result = parseTierAIntent(
        delivery(fixture.raw_text, { delivery_id: fixture.id }),
        fixture.state_before,
      );

      expect(result.classification).toBe(fixture.expected.classification);
      if (
        result.classification === "matched"
        && fixture.expected.classification === "matched"
      ) {
        expect(result.intent).toEqual(fixture.expected.intent);
      } else if (
        result.classification !== "matched"
        && fixture.expected.classification !== "matched"
      ) {
        expect(result.reason).toBe(fixture.expected.reason);
      }
    });
  }
});

describe("Tier A parser boundaries", () => {
  it("normalizes case, punctuation, smart apostrophes, hyphens, and whitespace deliberately", () => {
    expect(normalizeTierATranscript("  SET—TEMPO to Ninety-Six!  ")).toEqual({
      text: "set tempo to ninety six",
      has_numeric_colon: false,
      has_unsafe_characters: false,
    });
    expect(normalizeTierATranscript("That’s clean").text).toBe("thats clean");
  });

  it("does not act on an interim recognition hypothesis", () => {
    const result = parseTierAIntent(
      delivery("clean", { is_final: false }),
      ACTIVE,
    );
    expect(result).toMatchObject({
      classification: "ignored",
      reason: "non_final",
    });
  });

  it("propagates delivery, source, confidence, raw text, and normalized text as evidence", () => {
    const result = parseTierAIntent(delivery(" CLEAN! ", {
      delivery_id: "speech-77",
      revision: 4,
      recognition: { source: "macos_speech", confidence: 0.61 },
    }), ACTIVE);

    expect(result).toMatchObject({
      classification: "matched",
      evidence: {
        delivery_id: "speech-77",
        revision: 4,
        raw_text: " CLEAN! ",
        normalized_text: "clean",
        recognition: { source: "macos_speech", confidence: 0.61 },
      },
    });
  });

  it.each([
    "mist",
    "missed it",
    "that was clean",
    "not clean",
    "got it eventually",
    "no thank you",
    "again like you have to recognize that",
    "faster because this is dragging",
    "please turn off the metronome",
    "stop",
    "did you count four",
    "discount 4",
    "help me practice this",
  ])("keeps the near-miss or ambient sentence inert: %s", (text) => {
    expect(parseTierAIntent(delivery(text), ACTIVE).classification).toBe("ignored");
  });

  it("keeps the pianist's established exact done/again vocabulary while rejecting clauses", () => {
    expect(parseTierAIntent(delivery("done"), ACTIVE)).toMatchObject({
      classification: "matched",
      intent: { kind: "record_attempt", verdict: "clean" },
    });
    expect(parseTierAIntent(delivery("again"), ACTIVE)).toMatchObject({
      classification: "matched",
      intent: { kind: "record_attempt", verdict: "miss" },
    });
    expect(parseTierAIntent(delivery("done for today"), ACTIVE).classification).toBe("ignored");
    expect(parseTierAIntent(delivery("again after this phrase"), ACTIVE).classification).toBe("ignored");
  });

  it("distinguishes a same-set streak reset from a terminal set restart", () => {
    expect(parseTierAIntent(delivery("restart streak"), ACTIVE)).toMatchObject({
      classification: "matched",
      intent: { kind: "reset_clean_streak" },
    });
    expect(parseTierAIntent(delivery("restart set"), ACTIVE)).toMatchObject({
      classification: "matched",
      intent: { kind: "restart_set" },
    });
  });

  it.each(["metronome stop", "stop the metronome", "metronome off"])(
    "routes the explicit stop form without interpreting it as a tempo: %s",
    (text) => {
      expect(parseTierAIntent(delivery(text), ACTIVE)).toMatchObject({
        classification: "matched",
        intent: { kind: "metronome_off" },
      });
    },
  );

  it.each([
    [`count ${TIER_A_COUNT_MIN}`, TIER_A_COUNT_MIN],
    [`count ${TIER_A_COUNT_MAX}`, TIER_A_COUNT_MAX],
    ["count twenty one", 21],
    ["did nine", 9],
  ])("accepts the bounded count %s", (text, count) => {
    expect(parseTierAIntent(delivery(text), ACTIVE)).toMatchObject({
      classification: "matched",
      intent: { kind: "report_attempt_count", count },
    });
  });

  it.each([
    ["count 0", "count_out_of_range"],
    ["count 101", "count_out_of_range"],
    ["count -1", "invalid_count"],
    ["count two reps", "invalid_count"],
    ["count too", "invalid_count"],
    ["count one two", "invalid_count"],
    ["count 5:16", "unsafe_numeric_punctuation"],
  ])("rejects the unsafe count %s without an intent", (text, reason) => {
    expect(parseTierAIntent(delivery(text), ACTIVE)).toMatchObject({
      classification: "rejected",
      reason,
    });
  });

  it.each([
    [`set tempo ${TIER_A_TEMPO_MIN}`, TIER_A_TEMPO_MIN],
    [`set tempo ${TIER_A_TEMPO_MAX}`, TIER_A_TEMPO_MAX],
    ["set tempo one twenty", 120],
    ["correct tempo to forty", 40],
  ])("accepts the bounded tempo command %s", (text, bpm) => {
    expect(parseTierAIntent(delivery(text), ACTIVE)).toMatchObject({
      classification: "matched",
      intent: { bpm },
    });
  });

  it.each([
    ["set tempo 19", "tempo_out_of_range"],
    ["set tempo 301", "tempo_out_of_range"],
    ["set tempo for", "invalid_tempo"],
    ["set tempo 5:16", "unsafe_numeric_punctuation"],
  ])("rejects the unsafe tempo %s", (text, reason) => {
    expect(parseTierAIntent(delivery(text), ACTIVE)).toMatchObject({
      classification: "rejected",
      reason,
    });
  });

  it("gates duplicate confirmation, correction, and retention on explicit state", () => {
    expect(parseTierAIntent(delivery("count that"), ACTIVE)).toMatchObject({
      classification: "rejected",
      reason: "no_pending_attempt",
    });
    expect(parseTierAIntent(delivery("count that"), {
      ...ACTIVE,
      pending_duplicate_attempt: true,
    })).toMatchObject({
      classification: "matched",
      intent: { kind: "confirm_pending_attempt" },
    });
    expect(parseTierAIntent(delivery("correct last to miss"), {
      ...ACTIVE,
      last_attempt_available: false,
    })).toMatchObject({
      classification: "rejected",
      reason: "no_last_attempt",
    });
    expect(parseTierAIntent(delivery("reopen target"), ACTIVE)).toMatchObject({
      classification: "rejected",
      reason: "retention_not_due",
    });
  });

  it.each([
    ["confirm retention", "confirm"],
    ["lower retention", "lower"],
    ["reopen target", "reopen"],
    ["snooze retention", "snooze"],
  ] as const)("routes the explicit due action %s", (text, action) => {
    expect(parseTierAIntent(delivery(text), {
      ...ACTIVE,
      retention_due: true,
    })).toMatchObject({
      classification: "matched",
      intent: { kind: "retention", action },
    });
  });

  it("keeps an unsupported-symbol transcript inert", () => {
    expect(parseTierAIntent(delivery("clean 🎹"), ACTIVE)).toMatchObject({
      classification: "ignored",
      reason: "unsafe_characters",
    });
  });

  it("rejects invalid delivery metadata before returning an action", () => {
    expect(parseTierAIntent(delivery("clean", { delivery_id: "" }), ACTIVE)).toMatchObject({
      classification: "rejected",
      reason: "empty_delivery_id",
    });
    expect(parseTierAIntent(delivery("clean", {
      recognition: { source: "macos_speech", confidence: Number.NaN },
    }), ACTIVE)).toMatchObject({
      classification: "rejected",
      reason: "invalid_confidence",
    });
  });
});
