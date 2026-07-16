import { describe, expect, it } from "vitest";
import { describeTierAResult } from "./resultDescriptor";

describe("Tier A result descriptors", () => {
  it("states the exact attempt and streak for a clean self-report", () => {
    expect(describeTierAResult({
      kind: "attempt_recorded",
      attempt_number: 12,
      verdict: "clean",
      streak: 3,
      target_streak: 5,
    })).toEqual({
      visible_text: "Attempt 12: clean. Streak 3 of 5.",
      spoken_text: "Attempt 12: clean. Streak 3 of 5.",
      aria_label: "Attempt 12: clean. Streak 3 of 5.",
      aria_live: "polite",
      tone: "success",
    });
  });

  it("makes a miss reset explicit", () => {
    expect(describeTierAResult({
      kind: "attempt_recorded",
      attempt_number: 13,
      verdict: "miss",
      streak: 0,
      target_streak: 5,
    }).spoken_text).toBe("Attempt 13: miss. Streak reset to 0 of 5.");
  });

  it("narrates a correction in full rather than only saying saved", () => {
    const result = describeTierAResult({
      kind: "attempt_corrected",
      attempt_number: 13,
      from: "miss",
      to: "clean",
      streak: 4,
      target_streak: 5,
    });
    expect(result.visible_text).toBe(
      "Corrected attempt 13 from miss to clean. Streak 4 of 5.",
    );
    expect(result.spoken_text).toBe(result.visible_text);
  });

  it("does not turn a batch count into implied quality", () => {
    expect(describeTierAResult({
      kind: "attempt_count_reported",
      count: 4,
    }).visible_text).toBe(
      "Recorded your report of 4 attempts. Quality was not inferred.",
    );
  });

  it("explains append-only restart semantics", () => {
    expect(describeTierAResult({
      kind: "set_restarted",
      preserved_attempts: 9,
      target_streak: 5,
    }).visible_text).toContain("9 prior attempts remain in history");
  });

  it("keeps same-set streak reset wording distinct from restarting the set", () => {
    expect(describeTierAResult({
      kind: "streak_reset",
      preserved_attempts: 9,
      target_streak: 5,
    }).visible_text).toBe(
      "Reset the clean streak to 0 of 5. 9 attempts remain in this set's history.",
    );
  });

  it("makes a safety stop assertive and explicitly does not create a failed attempt", () => {
    expect(describeTierAResult({ kind: "safety_stopped" })).toMatchObject({
      visible_text: "Practice stopped for safety. No failed attempt was recorded.",
      aria_live: "assertive",
      tone: "warning",
    });
  });

  it.each([
    ["count_out_of_range", "Attempt count must be between 1 and 100. Nothing was recorded."],
    ["tempo_out_of_range", "Tempo must be between 20 and 300 BPM. The tempo was not changed."],
    ["practice_paused", "Practice is paused. Resume practice before recording an attempt."],
    ["no_last_attempt", "There is no last attempt to change. Nothing was changed."],
    ["duplicate_delivery", "That exact voice delivery was already handled. Nothing new was recorded."],
    ["persistence_failed", "The action could not be saved. Nothing was claimed as recorded."],
  ] as const)("gives %s a complete assertive error", (code, text) => {
    expect(describeTierAResult({ kind: "rejected", code })).toEqual({
      visible_text: text,
      spoken_text: text,
      aria_label: text,
      aria_live: "assertive",
      tone: "error",
    });
  });

  it("keeps retention snooze neutral and preserves the original due-date fact", () => {
    expect(describeTierAResult({
      kind: "retention_updated",
      action: "snooze",
    }).visible_text).toBe(
      "Retention snoozed. This is neutral; the original due date remains in history.",
    );
  });
});
