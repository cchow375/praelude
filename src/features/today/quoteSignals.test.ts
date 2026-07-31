import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  gatherQuoteSignals,
  recentVerdicts,
  sheetHasContent,
  sheetHasLessonPrep,
  useHomeQuote,
  useQuoteSignals,
  type LiveQuoteSignals,
  type QuoteSignalApi,
  type RepRow,
} from "./quoteSignals";
import {
  NO_SIGNALS,
  type QuoteSignals,
  type QuoteStore,
} from "./quoteRotation";
import { TodaySheetProvider, useTodaySheet } from "../notebook/DaySheetStore";
import type { NotebookLine } from "../notebook/lines";
import type { RepSnapshot } from "../rep/useRep";
import type { Quote } from "../../content/quotes";

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

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

describe("sheetHasLessonPrep", () => {
  it("needs a prep line with something actually in it", () => {
    expect(sheetHasLessonPrep([])).toBe(false);
    expect(sheetHasLessonPrep([{ type: "text", text: "lesson" }])).toBe(false);
    // An empty prep line is a heading he has not filled in — not a lesson.
    expect(
      sheetHasLessonPrep([{ type: "lesson_prep", bring: [], want: "  " }]),
    ).toBe(false);
    expect(
      sheetHasLessonPrep([{ type: "lesson_prep", bring: [7], want: "" }]),
    ).toBe(true);
    expect(
      sheetHasLessonPrep([
        { type: "lesson_prep", bring: [], want: "the Ballade" },
      ]),
    ).toBe(true);
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
      lessonPrep: false,
      yesterdaySheetWritten: true,
      recentVerdicts: ["failed", "flawed"],
    });
  });

  it("reports a filled-in lesson-prep line on today's page", async () => {
    const signals = await gatherQuoteSignals({
      todaySheet: [{ type: "lesson_prep", bring: [2], want: "the Ballade" }],
      now,
      api: api(),
    });
    expect(signals.lessonPrep).toBe(true);
    expect(signals.daySheetWritten).toBe(true);
  });

  it("does not query attempts when no set is open", async () => {
    const repsForBlock = vi.fn(async () => []);
    const signals = await gatherQuoteSignals({
      todaySheet: [{ type: "text", text: "today" }],
      now,
      api: api({ repsForBlock }),
    });
    expect(repsForBlock).not.toHaveBeenCalled();
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
      lessonPrep: null,
      yesterdaySheetWritten: null,
      recentVerdicts: [],
    });
  });

  it("keeps reading attempts when only the attempt query fails", async () => {
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
    expect(signals.recentVerdicts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D1: the facts behind the connector have to still be facts
// ---------------------------------------------------------------------------

/** The day-sheet seam: today's page loads blank, saves echo back. */
function installSheetRouter(): void {
  invokeMock.mockImplementation((command: string, args?: unknown) => {
    if (command === "day_sheet_save") {
      const record = (args ?? {}) as { date?: string; bodyJson?: string };
      return Promise.resolve({
        date: record.date ?? "2026-07-30",
        body: JSON.parse(record.bodyJson ?? "[]"),
        updated_at: "2026-07-30T12:00:00Z",
      });
    }
    return Promise.resolve(null);
  });
}

const sheetWrapper = ({ children }: { children: ReactNode }) =>
  createElement(TodaySheetProvider, null, children);

describe("useQuoteSignals", () => {
  it("tracks today's page live, so 'before you write today's page' cannot outlive the writing", async () => {
    // THE common flow, and the one the pre-fix code got wrong: the menu is
    // mounted, the page is blank, then Christian writes a line. Nothing
    // remounts and no IPC read happens in between — the fact has to come from
    // the shared store on the next render or the claim goes stale.
    installSheetRouter();
    const reads = api();
    const { result } = renderHook(
      () => ({
        sheet: useTodaySheet(),
        live: useQuoteSignals(reads, 10 * 60_000),
      }),
      { wrapper: sheetWrapper },
    );

    await waitFor(() => expect(result.current.live.ready).toBe(true));
    expect(result.current.live.signals.daySheetWritten).toBe(false);
    const readAt = result.current.live.readAt;

    act(() => {
      result.current.sheet.setBody([{ type: "text", text: "Chopin op. 25/1" }]);
    });

    expect(result.current.live.signals.daySheetWritten).toBe(true);
    // …and it did NOT need a fresh backend read to notice.
    expect(result.current.live.readAt).toBe(readAt);
  });

  it("notices lesson prep appearing on the page without a remount", async () => {
    installSheetRouter();
    const reads = api();
    const { result } = renderHook(
      () => ({
        sheet: useTodaySheet(),
        live: useQuoteSignals(reads, 10 * 60_000),
      }),
      { wrapper: sheetWrapper },
    );
    await waitFor(() => expect(result.current.live.ready).toBe(true));
    expect(result.current.live.signals.lessonPrep).toBe(false);

    act(() => {
      result.current.sheet.setBody([
        { type: "lesson_prep", bring: [3], want: "the Ballade" },
      ]);
    });
    expect(result.current.live.signals.lessonPrep).toBe(true);
  });

  it("re-reads the backend on a timer, so verdicts logged elsewhere land", async () => {
    installSheetRouter();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let rows: RepRow[] = [];
      const live = api({
        repState: async () => snapshot(9),
        repsForBlock: async () => rows,
      });
      const { result } = renderHook(() => useQuoteSignals(live, 1_000), {
        wrapper: sheetWrapper,
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.signals.recentVerdicts).toEqual([]);

      // Three reps happen in the practice window over this menu.
      rows = [rep(1, "flawed"), rep(2, "failed"), rep(3, "flawed")];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });
      await waitFor(() =>
        expect(result.current.signals.recentVerdicts).toEqual([
          "flawed",
          "failed",
          "flawed",
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an unreadable page as unknown, never as a blank one", async () => {
    invokeMock.mockImplementation(() =>
      Promise.reject(new Error("no backend")),
    );
    const { result } = renderHook(() => useQuoteSignals(api(), 10 * 60_000), {
      wrapper: sheetWrapper,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.signals.daySheetWritten).toBeNull();
    expect(result.current.signals.lessonPrep).toBeNull();
  });
});

describe("useHomeQuote", () => {
  function store(): QuoteStore & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
    };
  }

  function corpus(themes: readonly string[]): Quote[] {
    return Array.from({ length: 40 }, (_, i) => ({
      id: `q${i}`,
      text: `text ${i}`,
      source_id: "roskell-complete-pianist",
      author: `Author ${i}`,
      book: "Book",
      heading: "",
      themes,
    }));
  }

  const signals = (o: Partial<QuoteSignals>): QuoteSignals => ({
    ...NO_SIGNALS,
    date: "2026-07-30",
    ...o,
  });
  const live = (s: QuoteSignals, readAt = 1): LiveQuoteSignals => ({
    signals: s,
    ready: true,
    readAt,
  });

  it("re-derives the connector from the CURRENT signals, never the pick's", () => {
    // The D1 counterexample, at the boundary the strip actually renders from.
    // The quote is deliberately HELD across the change (churn damping), so the
    // only thing that can keep the line honest is deriving it again here.
    const quotes = corpus(["session-plan"]);
    const clock = { ms: 0 };
    const shared = store();
    const { result, rerender } = renderHook(
      ({ l }: { l: LiveQuoteSignals }) =>
        useHomeQuote(l, { store: shared, quotes, now: () => clock.ms }),
      { initialProps: { l: live(signals({ daySheetWritten: false })) } },
    );

    const first = result.current.quote;
    expect(first).toBeTruthy();
    expect(result.current.connector?.connector).toBe(
      "before you write today's page",
    );

    // He writes the page. Same quote, one minute later.
    clock.ms = 60_000;
    rerender({ l: live(signals({ daySheetWritten: true }), 2) });

    expect(result.current.quote?.id).toBe(first?.id);
    expect(result.current.connector).toBeNull();
  });

  it("relabels a held quote when a different current fact explains it", () => {
    const quotes = corpus(["session-plan", "rest"]);
    const clock = { ms: 0 };
    const shared = store();
    const { result, rerender } = renderHook(
      ({ l }: { l: LiveQuoteSignals }) =>
        useHomeQuote(l, { store: shared, quotes, now: () => clock.ms }),
      { initialProps: { l: live(signals({ daySheetWritten: false })) } },
    );
    const first = result.current.quote;
    expect(result.current.connector?.id).toBe("blank-page");

    clock.ms = 60_000;
    rerender({ l: live(signals({ daySheetWritten: true, hour: 23 }), 2) });
    expect(result.current.quote?.id).toBe(first?.id);
    expect(result.current.connector?.connector).toBe("this late in the day");
  });

  it("waits for the signals rather than picking on half-read state", () => {
    const quotes = corpus(["session-plan"]);
    const shared = store();
    const { result } = renderHook(() =>
      useHomeQuote(
        { signals: NO_SIGNALS, ready: false, readAt: 0 },
        { store: shared, quotes },
      ),
    );
    expect(result.current.quote).toBeNull();
    expect(result.current.connector).toBeNull();
  });

  it("does not burn a new quote every time a render happens", () => {
    const quotes = corpus(["session-plan"]);
    const shared = store();
    const s = signals({ daySheetWritten: false });
    const { result, rerender } = renderHook(
      ({ l }: { l: LiveQuoteSignals }) =>
        useHomeQuote(l, { store: shared, quotes, now: () => 5_000 }),
      { initialProps: { l: live(s) } },
    );
    const first = result.current.quote?.id;
    for (let i = 0; i < 5; i += 1) rerender({ l: live({ ...s }) });
    expect(result.current.quote?.id).toBe(first);
    expect(shared.map.get("ck.homeQuote.cursor")).toBe("1");
  });

  it("leaves the slot empty rather than throwing when storage is unavailable", () => {
    const quotes = corpus(["session-plan"]);
    const broken: QuoteStore = {
      getItem: () => {
        throw new Error("localStorage is disabled");
      },
      setItem: () => {},
    };
    const { result } = renderHook(() =>
      useHomeQuote(live(signals({ daySheetWritten: false })), {
        store: broken,
        quotes,
      }),
    );
    expect(result.current.quote).toBeNull();
    expect(result.current.connector).toBeNull();
  });
});
