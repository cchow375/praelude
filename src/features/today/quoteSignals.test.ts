import { describe, expect, it, vi } from "vitest";
import {
  gatherQuoteSignals,
  recentVerdicts,
  sheetHasContent,
  type QuoteSignalApi,
  type RepRow,
} from "./quoteSignals";
import type { NotebookLine } from "../notebook/lines";
import type { RepSnapshot } from "../rep/useRep";

function rep(id: number, verdict: string, voided = false): RepRow {
  return { id, ts: `2026-07-30T0${id}:00:00Z`, verdict, voided };
}

/** Only the fields the gatherer reads; the rest never leaves the backend. */
function snapshot(blockId: number): RepSnapshot {
  return { block_id: blockId } as RepSnapshot;
}

function api(overrides: Partial<QuoteSignalApi> = {}): QuoteSignalApi {
  return {
    daySheet: async () => null,
    repState: async () => null,
    repsForBlock: async () => [],
    ...overrides,
  };
}

describe("sheetHasContent", () => {
  it("treats an empty body and whitespace-only lines as unwritten", () => {
    expect(sheetHasContent([])).toBe(false);
    expect(sheetHasContent([{ type: "text", text: "   " }])).toBe(false);
    expect(sheetHasContent([{ type: "item", text: "", checked: false }])).toBe(
      false,
    );
    expect(
      sheetHasContent([{ type: "lesson_prep", bring: [], want: " " }]),
    ).toBe(false);
  });

  it("counts any real line as written", () => {
    const written: NotebookLine[][] = [
      [{ type: "text", text: "Chopin op. 25/1" }],
      [{ type: "item", text: "mm. 1-8 slow", checked: false }],
      [{ type: "block", minutes: 20 }],
      [{ type: "piece", piece_id: 3 }],
      [{ type: "lesson_prep", bring: [4], want: "" }],
    ];
    for (const body of written) expect(sheetHasContent(body)).toBe(true);
  });
});

describe("recentVerdicts", () => {
  it("returns the newest attempts first, capped at three", () => {
    expect(
      recentVerdicts([
        rep(1, "clean"),
        rep(2, "flawed"),
        rep(3, "failed"),
        rep(4, "clean"),
      ]),
    ).toEqual(["clean", "failed", "flawed"]);
  });

  it("ignores voided attempts — a taken-back rep is not evidence", () => {
    expect(recentVerdicts([rep(1, "clean"), rep(2, "failed", true)])).toEqual([
      "clean",
    ]);
  });

  it("ignores verdict strings it does not recognize", () => {
    expect(recentVerdicts([rep(1, "clean"), rep(2, "skipped")])).toEqual([
      "clean",
    ]);
  });
});

describe("gatherQuoteSignals", () => {
  const now = new Date(2026, 6, 30, 22, 15);

  it("reads the date, hour, both day sheets, and the open set's attempts", async () => {
    const daySheet = vi.fn(async () => ({
      date: "2026-07-29",
      body: [{ type: "text", text: "worked mm. 40-56" }] as NotebookLine[],
      updated_at: null,
    }));
    const repsForBlock = vi.fn(async () => [
      rep(1, "flawed"),
      rep(2, "failed"),
    ]);

    const signals = await gatherQuoteSignals({
      todaySheet: [],
      now,
      api: api({
        daySheet,
        repState: async () => snapshot(17),
        repsForBlock,
      }),
    });

    expect(daySheet).toHaveBeenCalledWith("2026-07-29");
    expect(repsForBlock).toHaveBeenCalledWith(17);
    expect(signals).toEqual({
      date: "2026-07-30",
      hour: 22,
      daySheetWritten: false,
      yesterdaySheetWritten: true,
      setOpen: true,
      recentVerdicts: ["failed", "flawed"],
    });
  });

  it("does not query attempts when no set is open", async () => {
    const repsForBlock = vi.fn(async () => []);
    const signals = await gatherQuoteSignals({
      todaySheet: [{ type: "text", text: "today" }],
      now,
      api: api({ repsForBlock }),
    });
    expect(repsForBlock).not.toHaveBeenCalled();
    expect(signals.setOpen).toBe(false);
    expect(signals.daySheetWritten).toBe(true);
    expect(signals.recentVerdicts).toEqual([]);
  });

  it("reports a missing yesterday row as blank, not unknown", async () => {
    const signals = await gatherQuoteSignals({
      todaySheet: [],
      now,
      api: api({ daySheet: async () => null }),
    });
    expect(signals.yesterdaySheetWritten).toBe(false);
  });

  it("leaves a signal null when its read fails, rather than guessing", async () => {
    const signals = await gatherQuoteSignals({
      todaySheet: null,
      now,
      api: api({
        daySheet: async () => {
          throw new Error("no backend");
        },
        repState: async () => {
          throw new Error("no backend");
        },
      }),
    });
    expect(signals).toEqual({
      date: "2026-07-30",
      hour: 22,
      daySheetWritten: null,
      yesterdaySheetWritten: null,
      setOpen: null,
      recentVerdicts: [],
    });
  });

  it("keeps the open-set signal when only the attempt read fails", async () => {
    const signals = await gatherQuoteSignals({
      todaySheet: [],
      now,
      api: api({
        repState: async () => snapshot(4),
        repsForBlock: async () => {
          throw new Error("query failed");
        },
      }),
    });
    expect(signals.setOpen).toBe(true);
    expect(signals.recentVerdicts).toEqual([]);
  });
});
