import { describe, expect, it } from "vitest";
import { formatDate, formatDuration, formatSince } from "./format";

describe("formatDuration", () => {
  it("formats zero seconds as 0m", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("formats a positive sub-minute duration as <1m", () => {
    expect(formatDuration(1)).toBe("<1m");
    expect(formatDuration(59)).toBe("<1m");
  });

  it("formats whole minutes below an hour", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(3599)).toBe("59m");
  });

  it("formats hours plus remaining minutes", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(3660)).toBe("1h 1m");
    expect(formatDuration(7325)).toBe("2h 2m");
  });

  it("handles very large durations without overflow", () => {
    expect(formatDuration(100 * 3600 + 30 * 60)).toBe("100h 30m");
  });

  it("rounds fractional seconds before bucketing into minutes", () => {
    // 59.5 rounds up to 60s -> crosses into the next minute bucket.
    expect(formatDuration(59.5)).toBe("1m");
    // 59.4 rounds down to 59s -> stays under a minute.
    expect(formatDuration(59.4)).toBe("<1m");
    // 119.5 rounds up to 120s -> 2m, while 119.4 rounds down to 119s -> 1m.
    expect(formatDuration(119.5)).toBe("2m");
    expect(formatDuration(119.4)).toBe("1m");
  });

  it("clamps negative durations to 0m instead of surfacing the bad value", () => {
    expect(formatDuration(-45)).toBe("0m");
    expect(formatDuration(-3600)).toBe("0m");
    expect(formatDuration(-0.4)).toBe("0m");
  });

  it("treats NaN as 0 seconds via the finite guard", () => {
    expect(formatDuration(NaN)).toBe("0m");
  });

  it("treats +/-Infinity as 0 seconds via the finite guard", () => {
    expect(formatDuration(Infinity)).toBe("0m");
    expect(formatDuration(-Infinity)).toBe("0m");
  });

  it("silently coerces a non-numeric runtime value (IPC boundary drift) to 0m instead of throwing", () => {
    // TS types promise `number`, but a malformed IPC payload could hand us
    // a string, null, or undefined at runtime. Number.isFinite rejects all
    // of these, so they should degrade to "0m" rather than rendering
    // "NaNh NaNm" or throwing.
    expect(formatDuration("120" as unknown as number)).toBe("0m");
    expect(formatDuration(null as unknown as number)).toBe("0m");
    expect(formatDuration(undefined as unknown as number)).toBe("0m");
  });
});

describe("formatDate", () => {
  it("returns a placeholder for null", () => {
    expect(formatDate(null)).toBe("Not practiced yet");
  });

  it("returns a placeholder for an empty string", () => {
    expect(formatDate("")).toBe("Not practiced yet");
  });

  it("returns a placeholder for a runtime undefined value despite the string | null type", () => {
    // Guards against an IPC payload that omits the field entirely rather
    // than sending null.
    expect(formatDate(undefined as unknown as string | null)).toBe(
      "Not practiced yet",
    );
  });

  it("falls back to the raw string for an unparsable value instead of throwing or rendering 'Invalid Date'", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatDate("banana")).toBe("banana");
  });

  it("falls back to the raw value for a whitespace-only string", () => {
    // " " is truthy, so it reaches `new Date(" ")`, which is invalid;
    // the function should pass the original (visually odd) string through
    // rather than throwing.
    expect(formatDate(" ")).toBe(" ");
  });

  it("formats a valid full ISO timestamp as a short month/day/year label", () => {
    // Anchored at midday UTC so the assertion is stable across reasonable
    // local timezones, matching the last_practiced contract (full
    // RFC3339 timestamps via `Date.toISOString()`, never bare dates).
    expect(formatDate("2026-07-15T12:00:00Z")).toBe("Jul 15, 2026");
  });

  it("does not throw for any of the malformed inputs", () => {
    expect(() => formatDate("not-a-date")).not.toThrow();
    expect(() => formatDate("")).not.toThrow();
    expect(() => formatDate(" ")).not.toThrow();
    expect(() => formatDate(null)).not.toThrow();
  });
});

describe("formatSince", () => {
  const NOW = "2026-07-31T12:00:00Z";
  const ago = (days: number) =>
    new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

  it("says so plainly when a piece has never been practised", () => {
    expect(formatSince(null, NOW)).toBe("Never practiced");
    expect(formatSince("", NOW)).toBe("Never practiced");
  });

  it("uses today / yesterday before switching to a day count", () => {
    expect(formatSince(ago(0), NOW)).toBe("Practiced today");
    expect(formatSince(ago(1), NOW)).toBe("Practiced yesterday");
    expect(formatSince(ago(2), NOW)).toBe("Practiced 2 days ago");
    expect(formatSince(ago(365), NOW)).toBe("Practiced 365 days ago");
  });

  it("measures against the given reference, not the wall clock", () => {
    // The same stamp reads differently against two snapshots — which is the
    // point: a stored snapshot always renders the way it was generated.
    expect(formatSince("2026-07-01T12:00:00Z", "2026-07-02T12:00:00Z")).toBe(
      "Practiced yesterday",
    );
    expect(formatSince("2026-07-01T12:00:00Z", "2026-07-11T12:00:00Z")).toBe(
      "Practiced 10 days ago",
    );
  });

  it("falls back to the absolute date rather than inventing a duration", () => {
    expect(formatSince("2026-07-15T12:00:00Z", null)).toBe(
      "Practiced Jul 15, 2026",
    );
    expect(formatSince("2026-07-15T12:00:00Z", "not-a-date")).toBe(
      "Practiced Jul 15, 2026",
    );
    expect(formatSince("not-a-date", NOW)).toBe("Practiced not-a-date");
  });

  it("does not report a negative age for a stamp ahead of the reference", () => {
    expect(formatSince("2026-08-05T12:00:00Z", NOW)).toBe("Practiced today");
  });
});
