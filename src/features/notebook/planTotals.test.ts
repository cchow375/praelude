import { describe, expect, it } from "vitest";
import type { NotebookLine } from "./lines";
import { formatPlanTotals, planTotals } from "./planTotals";

describe("planTotals (spec A9)", () => {
  it("sums a mixed sheet correctly", () => {
    const lines: NotebookLine[] = [
      { type: "text", text: "warm up" },
      { type: "block", minutes: 25 },
      { type: "block", minutes: 50 },
      { type: "item", text: "measure 12 run", checked: false },
      { type: "item", text: "scales", checked: true },
      { type: "item", text: "sight read", checked: false },
      { type: "piece", piece_id: 1 },
    ];
    expect(planTotals(lines)).toEqual({
      minutes: 75,
      timedLines: 2,
      untimedActionLines: 2,
    });
  });

  it("counts a zero-minute block as timed, not unestimated", () => {
    const lines: NotebookLine[] = [{ type: "block", minutes: 0 }];
    expect(planTotals(lines)).toEqual({
      minutes: 0,
      timedLines: 1,
      untimedActionLines: 0,
    });
  });

  it("excludes checked items from the unestimated count", () => {
    const lines: NotebookLine[] = [
      { type: "item", text: "done", checked: true },
    ];
    expect(planTotals(lines)).toEqual({
      minutes: 0,
      timedLines: 0,
      untimedActionLines: 0,
    });
  });

  it("empty sheet totals to zero", () => {
    expect(planTotals([])).toEqual({
      minutes: 0,
      timedLines: 0,
      untimedActionLines: 0,
    });
  });
});

describe("formatPlanTotals (spec A9)", () => {
  it("renders both clauses when there is time and unestimated work", () => {
    expect(
      formatPlanTotals({ minutes: 75, timedLines: 2, untimedActionLines: 3 }),
    ).toBe("Σ 75 min planned · 3 lines unestimated");
  });

  it("uses the singular 'line' when exactly one is unestimated (fix wave item 1)", () => {
    expect(
      formatPlanTotals({ minutes: 4, timedLines: 1, untimedActionLines: 1 }),
    ).toBe("Σ 4 min planned · 1 line unestimated");
  });

  it("omits the second clause when nothing is unestimated", () => {
    expect(
      formatPlanTotals({ minutes: 75, timedLines: 2, untimedActionLines: 0 }),
    ).toBe("Σ 75 min planned");
  });

  it("renders nothing at all for an empty/total-zero sheet", () => {
    expect(
      formatPlanTotals({ minutes: 0, timedLines: 0, untimedActionLines: 0 }),
    ).toBeNull();
  });
});
