import { describe, expect, it } from "vitest";
import { parseProposedAction } from "./proposedAction";

describe("parseProposedAction", () => {
  describe("top-level shape guards", () => {
    it("drops a null payload", () => {
      expect(parseProposedAction(null)).toBeNull();
    });

    it("drops an undefined payload", () => {
      expect(parseProposedAction(undefined)).toBeNull();
    });

    it("drops a primitive payload", () => {
      expect(parseProposedAction("verdict")).toBeNull();
      expect(parseProposedAction(42)).toBeNull();
      expect(parseProposedAction(true)).toBeNull();
    });

    it("drops an array payload even though typeof is object", () => {
      expect(parseProposedAction(["verdict"])).toBeNull();
    });

    it("drops a payload missing summary", () => {
      expect(parseProposedAction({ kind: "undo" })).toBeNull();
    });

    it("drops a payload whose summary is empty after trimming", () => {
      expect(parseProposedAction({ kind: "undo", summary: "   " })).toBeNull();
    });

    it("drops a payload whose summary exceeds 400 characters", () => {
      const summary = "a".repeat(401);
      expect(parseProposedAction({ kind: "undo", summary })).toBeNull();
    });

    it("accepts a summary at exactly the 400-character boundary", () => {
      const summary = "a".repeat(400);
      expect(parseProposedAction({ kind: "undo", summary })).toEqual({
        kind: "undo",
        summary,
      });
    });

    it("trims surrounding whitespace from summary", () => {
      const draft = parseProposedAction({
        kind: "undo",
        summary: "  Undo the last rep  ",
      });
      expect(draft?.summary).toBe("Undo the last rep");
    });

    it("drops a non-string summary", () => {
      expect(parseProposedAction({ kind: "undo", summary: 123 })).toBeNull();
      expect(parseProposedAction({ kind: "undo", summary: null })).toBeNull();
    });

    it("drops an unrecognized kind", () => {
      expect(
        parseProposedAction({ kind: "reboot", summary: "Reboot" }),
      ).toBeNull();
    });

    it("drops a missing kind", () => {
      expect(parseProposedAction({ summary: "No kind here" })).toBeNull();
    });

    it("is case-sensitive on kind and drops near-miss casing", () => {
      expect(parseProposedAction({ kind: "Undo", summary: "Undo" })).toBeNull();
      expect(parseProposedAction({ kind: "UNDO", summary: "Undo" })).toBeNull();
    });
  });

  describe("verdict actions", () => {
    it("parses a clean verdict with a note", () => {
      expect(
        parseProposedAction({
          kind: "verdict",
          summary: "Mark this attempt clean",
          verdict: "clean",
          note: "Nice and even tempo",
        }),
      ).toEqual({
        kind: "verdict",
        summary: "Mark this attempt clean",
        verdict: "clean",
        note: "Nice and even tempo",
      });
    });

    it("parses flawed and failed verdicts", () => {
      expect(
        parseProposedAction({
          kind: "verdict",
          summary: "Mark flawed",
          verdict: "flawed",
          note: null,
        })?.verdict,
      ).toBe("flawed");
      expect(
        parseProposedAction({
          kind: "verdict",
          summary: "Mark failed",
          verdict: "failed",
          note: null,
        })?.verdict,
      ).toBe("failed");
    });

    it("defaults note to null when omitted", () => {
      const draft = parseProposedAction({
        kind: "verdict",
        summary: "No note supplied",
        verdict: "clean",
      });
      expect(draft).toEqual({
        kind: "verdict",
        summary: "No note supplied",
        verdict: "clean",
        note: null,
      });
    });

    it("treats an explicit null note as valid (distinct from an empty string)", () => {
      const draft = parseProposedAction({
        kind: "verdict",
        summary: "Explicit null note",
        verdict: "clean",
        note: null,
      });
      expect(draft?.note).toBeNull();
    });

    it("drops an invalid verdict enum value", () => {
      expect(
        parseProposedAction({
          kind: "verdict",
          summary: "Bad verdict",
          verdict: "great",
          note: null,
        }),
      ).toBeNull();
    });

    it("drops a numeric verdict", () => {
      expect(
        parseProposedAction({
          kind: "verdict",
          summary: "Numeric verdict",
          verdict: 1,
          note: null,
        }),
      ).toBeNull();
    });

    it("drops a note exceeding 200 characters", () => {
      const note = "n".repeat(201);
      expect(
        parseProposedAction({
          kind: "verdict",
          summary: "Too long a note",
          verdict: "clean",
          note,
        }),
      ).toBeNull();
    });

    it("accepts a note at exactly the 200-character boundary", () => {
      const note = "n".repeat(200);
      const draft = parseProposedAction({
        kind: "verdict",
        summary: "Boundary note",
        verdict: "clean",
        note,
      });
      expect(draft?.note).toBe(note);
    });

    it("drops a note that is empty after trimming (whitespace-only)", () => {
      expect(
        parseProposedAction({
          kind: "verdict",
          summary: "Whitespace note",
          verdict: "clean",
          note: "   ",
        }),
      ).toBeNull();
    });

    it("drops a non-string, non-null note", () => {
      expect(
        parseProposedAction({
          kind: "verdict",
          summary: "Numeric note",
          verdict: "clean",
          note: 5,
        }),
      ).toBeNull();
    });
  });

  describe("tempo actions", () => {
    it("parses a valid bpm within range", () => {
      expect(
        parseProposedAction({
          kind: "tempo",
          summary: "Set tempo to 120",
          bpm: 120,
        }),
      ).toEqual({
        kind: "tempo",
        summary: "Set tempo to 120",
        bpm: 120,
      });
    });

    it("accepts the minimum bpm boundary (1)", () => {
      const draft = parseProposedAction({
        kind: "tempo",
        summary: "Slowest",
        bpm: 1,
      });
      expect(draft?.kind).toBe("tempo");
      expect((draft as { bpm: number }).bpm).toBe(1);
    });

    it("accepts the maximum bpm boundary (1000)", () => {
      const draft = parseProposedAction({
        kind: "tempo",
        summary: "Fastest",
        bpm: 1000,
      });
      expect((draft as { bpm: number }).bpm).toBe(1000);
    });

    it("drops a bpm below the minimum", () => {
      expect(
        parseProposedAction({ kind: "tempo", summary: "Too slow", bpm: 0 }),
      ).toBeNull();
      expect(
        parseProposedAction({ kind: "tempo", summary: "Negative", bpm: -10 }),
      ).toBeNull();
    });

    it("drops a bpm above the maximum", () => {
      expect(
        parseProposedAction({ kind: "tempo", summary: "Too fast", bpm: 1001 }),
      ).toBeNull();
    });

    it("drops non-finite bpm values (NaN, Infinity)", () => {
      expect(
        parseProposedAction({
          kind: "tempo",
          summary: "NaN bpm",
          bpm: Number.NaN,
        }),
      ).toBeNull();
      expect(
        parseProposedAction({
          kind: "tempo",
          summary: "Infinite bpm",
          bpm: Number.POSITIVE_INFINITY,
        }),
      ).toBeNull();
    });

    it("drops a stringly-typed bpm even if numeric-looking", () => {
      expect(
        parseProposedAction({
          kind: "tempo",
          summary: "String bpm",
          bpm: "120",
        }),
      ).toBeNull();
    });

    it("drops a missing bpm", () => {
      expect(
        parseProposedAction({ kind: "tempo", summary: "Missing bpm" }),
      ).toBeNull();
    });
  });

  describe("undo actions", () => {
    it("parses a bare undo action with only a summary", () => {
      expect(
        parseProposedAction({ kind: "undo", summary: "Undo the last rep" }),
      ).toEqual({
        kind: "undo",
        summary: "Undo the last rep",
      });
    });

    it("ignores extraneous fields on an undo payload", () => {
      const draft = parseProposedAction({
        kind: "undo",
        summary: "Undo with junk",
        bpm: 999,
        verdict: "clean",
      });
      expect(draft).toEqual({ kind: "undo", summary: "Undo with junk" });
    });
  });

  describe("restart actions", () => {
    it("parses a restart with an explicit required_clean_streak", () => {
      expect(
        parseProposedAction({
          kind: "restart",
          summary: "Restart the set",
          required_clean_streak: 5,
        }),
      ).toEqual({
        kind: "restart",
        summary: "Restart the set",
        required_clean_streak: 5,
      });
    });

    it("defaults required_clean_streak to null when omitted", () => {
      const draft = parseProposedAction({
        kind: "restart",
        summary: "Restart, no streak",
      });
      expect(draft).toEqual({
        kind: "restart",
        summary: "Restart, no streak",
        required_clean_streak: null,
      });
    });

    it("treats an explicit null required_clean_streak as valid", () => {
      const draft = parseProposedAction({
        kind: "restart",
        summary: "Explicit null streak",
        required_clean_streak: null,
      });
      expect(draft).toEqual({
        kind: "restart",
        summary: "Explicit null streak",
        required_clean_streak: null,
      });
    });

    it("accepts the minimum streak boundary (1)", () => {
      const draft = parseProposedAction({
        kind: "restart",
        summary: "Min streak",
        required_clean_streak: 1,
      });
      expect(
        (draft as { required_clean_streak: number | null })
          .required_clean_streak,
      ).toBe(1);
    });

    it("accepts the maximum streak boundary (100)", () => {
      const draft = parseProposedAction({
        kind: "restart",
        summary: "Max streak",
        required_clean_streak: 100,
      });
      expect(
        (draft as { required_clean_streak: number | null })
          .required_clean_streak,
      ).toBe(100);
    });

    it("drops a streak below the minimum", () => {
      expect(
        parseProposedAction({
          kind: "restart",
          summary: "Zero streak",
          required_clean_streak: 0,
        }),
      ).toBeNull();
    });

    it("drops a streak above the maximum", () => {
      expect(
        parseProposedAction({
          kind: "restart",
          summary: "Streak too high",
          required_clean_streak: 101,
        }),
      ).toBeNull();
    });

    it("drops a non-integer streak", () => {
      expect(
        parseProposedAction({
          kind: "restart",
          summary: "Fractional streak",
          required_clean_streak: 3.5,
        }),
      ).toBeNull();
    });

    it("drops a streak that is not a safe integer", () => {
      expect(
        parseProposedAction({
          kind: "restart",
          summary: "Unsafe streak",
          required_clean_streak: Number.MAX_SAFE_INTEGER + 10,
        }),
      ).toBeNull();
    });

    it("drops a stringly-typed streak", () => {
      expect(
        parseProposedAction({
          kind: "restart",
          summary: "String streak",
          required_clean_streak: "5",
        }),
      ).toBeNull();
    });
  });

  describe("malformed IPC payload shapes crossing the boundary", () => {
    it("drops a deeply malformed object with no recognizable fields", () => {
      expect(parseProposedAction({ foo: "bar", baz: 1 })).toBeNull();
    });

    it("does not throw on a payload with prototype pollution style keys", () => {
      expect(() =>
        parseProposedAction(
          JSON.parse(
            '{"kind":"undo","summary":"ok","__proto__":{"polluted":true}}',
          ),
        ),
      ).not.toThrow();
    });

    it("does not throw when given a circular-looking payload guarded by JSON round trip", () => {
      const payload: Record<string, unknown> = {
        kind: "tempo",
        summary: "circular",
        bpm: 90,
      };
      payload.self = payload;
      expect(() => parseProposedAction(payload)).not.toThrow();
      expect(parseProposedAction(payload)).toEqual({
        kind: "tempo",
        summary: "circular",
        bpm: 90,
      });
    });
  });
});
