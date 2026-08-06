import { describe, expect, it } from "vitest";
import { estimateSetSeconds, formatSetEstimate } from "./estimate";

describe("estimateSetSeconds", () => {
  it("matches the worked example exactly: pass=30s, entry 60bpm, [{60,3},{72,3}]", () => {
    // low = 3·30·(60/60) + 3·30·(60/72) + (3+3)·3 = 90 + 75 + 18 = 183
    const estimate = estimateSetSeconds(
      30,
      [
        { bpm: 60, reps: 3 },
        { bpm: 72, reps: 3 },
      ],
      60,
    );
    expect(estimate.lowSeconds).toBeCloseTo(183, 6);
    expect(estimate.highSeconds).toBeCloseTo(274.5, 6);
    expect(formatSetEstimate(estimate)).toBe("≈ 4–5 min");
  });

  it("scales a rung SLOWER than entry above 1x (more seconds per pass)", () => {
    // A single rung at 30 bpm with a 60 bpm entry: each pass takes twice as
    // long as one pass at entry tempo, so the per-rung factor is > 1.
    const atEntry = estimateSetSeconds(20, [{ bpm: 60, reps: 1 }], 60);
    const slowerRung = estimateSetSeconds(20, [{ bpm: 30, reps: 1 }], 60);
    expect(slowerRung.lowSeconds).toBeGreaterThan(atEntry.lowSeconds);
    // Explicitly: 1·20·(60/30) + 1·3 = 40 + 3 = 43
    expect(slowerRung.lowSeconds).toBeCloseTo(43, 6);
  });

  it("with passSeconds=0 only the reset allowance remains", () => {
    // The "no estimate" UI state lives in the caller (no field entered, no
    // call made) — this pure function always accepts a numeric passSeconds.
    const estimate = estimateSetSeconds(0, [{ bpm: 60, reps: 3 }], 60);
    expect(estimate.lowSeconds).toBe(9); // only the 3s/rep reset allowance
    expect(estimate.highSeconds).toBe(13.5);
  });
});

describe("formatSetEstimate", () => {
  it("rounds both bounds up to whole minutes", () => {
    expect(formatSetEstimate({ lowSeconds: 61, highSeconds: 121 })).toBe(
      "≈ 2–3 min",
    );
    expect(formatSetEstimate({ lowSeconds: 0, highSeconds: 0 })).toBe(
      "≈ 0–0 min",
    );
  });
});
