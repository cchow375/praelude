import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { DayTimeline, formatDayHeader } from "./DayTimeline";
import { addDays, dayLabel, todayLocal } from "../calendar/dates";
import type { HistoryDayDetail, HistoryDaySummary } from "./historyDays";

const TODAY = todayLocal();

function day(overrides: Partial<HistoryDaySummary>): HistoryDaySummary {
  return {
    date: TODAY,
    focused_seconds: 0,
    session_count: 0,
    attempts: 0,
    cleans: 0,
    sets_touched: 0,
    mastered_sets: 0,
    pieces: [],
    ...overrides,
  };
}

const RECENT_DAY = day({
  date: addDays(TODAY, -1),
  focused_seconds: 42 * 60,
  session_count: 1,
  attempts: 5,
  cleans: 4,
  sets_touched: 3,
  mastered_sets: 2,
  pieces: [{ piece_id: 1, title: "Scherzo No. 2", attempts: 5 }],
});

const MULTI_PIECE_DAY = day({
  date: addDays(TODAY, -3),
  focused_seconds: 30 * 60,
  session_count: 1,
  attempts: 6,
  cleans: 3,
  sets_touched: 2,
  mastered_sets: 0,
  pieces: [
    { piece_id: 1, title: "Scherzo No. 2", attempts: 3 },
    { piece_id: 2, title: "The White Peacock", attempts: 2 },
    {
      piece_id: 3,
      title:
        "Prélude, Choral et Fugue in the style of an extremely long Romantic-era programmatic title",
      attempts: 1,
    },
  ],
});

function detailFor(d: HistoryDaySummary): HistoryDayDetail {
  return {
    date: d.date,
    sessions: [
      {
        session_id: 900,
        started_at: `${d.date}T09:00:00Z`,
        ended_at: `${d.date}T09:42:00Z`,
        focused_seconds: d.focused_seconds,
      },
    ],
    sets: [
      {
        block_id: 1,
        piece_id: 1,
        piece_title: "Scherzo No. 2",
        region_name: "Development",
        m_start: 65,
        m_end: 96,
        attempts: 5,
        cleans: 4,
        flawed: 1,
        failed: 0,
        start_bpm: 72,
        end_bpm: 96,
        mastery_status: "not_satisfied",
        mastery_basis: "consecutive_clean",
        attempt_target: null,
        first_ts: `${d.date}T09:00:00Z`,
        last_ts: `${d.date}T09:30:00Z`,
      },
    ],
  };
}

function denseDetail(dateValue: string): HistoryDayDetail {
  return {
    date: dateValue,
    sessions: [
      {
        session_id: 901,
        started_at: `${dateValue}T09:00:00Z`,
        ended_at: `${dateValue}T12:00:00Z`,
        focused_seconds: 180 * 60,
      },
    ],
    sets: Array.from({ length: 50 }, (_, index) => ({
      block_id: 2000 + index,
      piece_id: index % 2 === 0 ? 1 : 2,
      piece_title: index % 2 === 0 ? "Scherzo No. 2" : "The White Peacock",
      region_name: `Section ${index + 1}`,
      m_start: index * 4 + 1,
      m_end: index * 4 + 8,
      attempts: 8,
      cleans: 5,
      flawed: 2,
      failed: 1,
      start_bpm: 72,
      end_bpm: 96,
      mastery_status: "not_satisfied",
      mastery_basis: "consecutive_clean",
      attempt_target: null,
      first_ts: `${dateValue}T09:00:00Z`,
      last_ts: `${dateValue}T09:30:00Z`,
    })),
  };
}

afterEach(cleanup);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("formatDayHeader", () => {
  it("matches the exact contract format", () => {
    const { weekday, date } = dayLabel(RECENT_DAY.date);
    expect(formatDayHeader(RECENT_DAY)).toBe(
      `${weekday} · ${date} — 42 min · Scherzo No. 2 · 3 sets · 2 mastered`,
    );
  });

  it("truncates a piece list beyond 2 titles to '+N'", () => {
    const { weekday, date } = dayLabel(MULTI_PIECE_DAY.date);
    expect(formatDayHeader(MULTI_PIECE_DAY)).toBe(
      `${weekday} · ${date} — 30 min · Scherzo No. 2, The White Peacock +1 · 2 sets · 0 mastered`,
    );
  });
});

describe("DayTimeline", () => {
  it("renders collapsed day cards newest-first with exact header text", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "history_days")
        return Promise.resolve([RECENT_DAY, MULTI_PIECE_DAY]);
      return Promise.resolve(null);
    });
    render(<DayTimeline />);

    expect(await screen.findByText(formatDayHeader(RECENT_DAY))).toBeTruthy();
    expect(screen.getByText(formatDayHeader(MULTI_PIECE_DAY))).toBeTruthy();

    const cards = screen.getAllByRole("button", { expanded: false });
    expect(cards[0].textContent).toContain("Scherzo No. 2");
    expect(cards.length).toBe(2);
  });

  it("fetches history_day_detail exactly once on first expand; collapse/re-expand never refetches", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "history_days") return Promise.resolve([RECENT_DAY]);
      if (command === "history_day_detail")
        return Promise.resolve(detailFor(RECENT_DAY));
      return Promise.resolve(null);
    });
    render(<DayTimeline />);

    const toggle = await screen.findByRole("button", {
      name: formatDayHeader(RECENT_DAY),
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "history_day_detail",
      expect.anything(),
    );

    // Expand: fetches once.
    fireEvent.click(toggle);
    expect(await screen.findByText(/Development/)).toBeTruthy();
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "history_day_detail")
        .length,
    ).toBe(1);

    // Collapse: detail unmounts, no new fetch.
    fireEvent.click(toggle);
    expect(screen.queryByText(/Development/)).toBeNull();

    // Re-expand: cached, still exactly one fetch total.
    fireEvent.click(toggle);
    expect(await screen.findByText(/Development/)).toBeTruthy();
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "history_day_detail")
        .length,
    ).toBe(1);
  });

  it("labels a satisfied total-play set as complete, never mastered", async () => {
    const volumeDay = day({
      ...RECENT_DAY,
      mastered_sets: 0,
    });
    const volumeDetail = detailFor(volumeDay);
    volumeDetail.sets[0] = {
      ...volumeDetail.sets[0],
      attempts: 5,
      cleans: 1,
      mastery_status: "satisfied",
      mastery_basis: "total_attempts",
      attempt_target: 5,
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === "history_days") return Promise.resolve([volumeDay]);
      if (command === "history_day_detail")
        return Promise.resolve(volumeDetail);
      return Promise.resolve(null);
    });
    render(<DayTimeline />);

    fireEvent.click(
      await screen.findByRole("button", { name: formatDayHeader(volumeDay) }),
    );
    expect(await screen.findByText(/total plays complete/)).toBeTruthy();
    expect(screen.queryByText(/mastery verified/i)).toBeNull();
  });

  it("fetches history_day_detail exactly once under a same-tick double toggle", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "history_days") return Promise.resolve([RECENT_DAY]);
      if (command === "history_day_detail")
        return Promise.resolve(detailFor(RECENT_DAY));
      return Promise.resolve(null);
    });
    render(<DayTimeline />);

    const toggle = await screen.findByRole("button", {
      name: formatDayHeader(RECENT_DAY),
    });

    // Raw DOM clicks inside ONE act: expand + collapse batch together, so the
    // render-time `details`/`detailLoading` guard sees the SAME empty
    // snapshot for both and fires two fetches for one day.
    act(() => {
      toggle.click();
      toggle.click();
    });
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter((call) => call[0] === "history_day_detail")
          .length,
      ).toBe(1),
    );

    // The card ends collapsed; re-expanding still serves the cached detail.
    expect(screen.queryByText(/Development/)).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByText(/Development/)).toBeTruthy();
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "history_day_detail")
        .length,
    ).toBe(1);
  });

  it("retries a failed day detail on a later expand", async () => {
    let attempts = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === "history_days") return Promise.resolve([RECENT_DAY]);
      if (command === "history_day_detail") {
        attempts += 1;
        if (attempts === 1) return Promise.reject("day is unreadable");
        return Promise.resolve(detailFor(RECENT_DAY));
      }
      return Promise.resolve(null);
    });
    render(<DayTimeline />);

    const toggle = await screen.findByRole("button", {
      name: formatDayHeader(RECENT_DAY),
    });
    fireEvent.click(toggle);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "day is unreadable",
    );

    // Collapse, then expand again: a failure is not cached as a result.
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(await screen.findByText(/Development/)).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("'Earlier days' first reveals already-fetched days before requesting more", async () => {
    const extraDays = Array.from({ length: 5 }, (_, index) =>
      day({
        date: addDays(TODAY, -(10 + index)),
        focused_seconds: 60,
        sets_touched: 1,
        pieces: [{ piece_id: 1, title: "Scherzo No. 2", attempts: 1 }],
      }),
    );
    const allDays = [...extraDays].sort((a, b) => (a.date < b.date ? 1 : -1));
    // 25 fetched evidence-days: only the first 21 render initially.
    const twentyFiveDays = [
      ...allDays,
      ...Array.from({ length: 20 }, (_, index) =>
        day({
          date: addDays(TODAY, -(50 + index)),
          focused_seconds: 60,
          sets_touched: 1,
          pieces: [{ piece_id: 1, title: "Scherzo No. 2", attempts: 1 }],
        }),
      ),
    ];
    invokeMock.mockImplementation((command: string) => {
      if (command === "history_days") return Promise.resolve(twentyFiveDays);
      return Promise.resolve(null);
    });
    render(<DayTimeline />);
    await screen.findByText(formatDayHeader(twentyFiveDays[0]));
    expect(screen.queryByText(formatDayHeader(twentyFiveDays[24]))).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Earlier days" }));

    await waitFor(() =>
      expect(
        screen.getByText(formatDayHeader(twentyFiveDays[24])),
      ).toBeTruthy(),
    );
    // Revealing already-fetched days must not trigger a second history_days call.
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "history_days").length,
    ).toBe(1);
  });

  it("extends the fetch window once already-fetched days are exhausted", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "history_days") {
        const { from } = (args ?? {}) as { from?: string; to?: string };
        // The second call (window extension) reaches further back than the
        // first — assert on the actual `from` argument, not call order alone.
        if (from === addDays(TODAY, -239)) {
          return Promise.resolve([RECENT_DAY, MULTI_PIECE_DAY]);
        }
        return Promise.resolve([RECENT_DAY]);
      }
      return Promise.resolve(null);
    });
    render(<DayTimeline />);
    await screen.findByText(formatDayHeader(RECENT_DAY));
    expect(screen.queryByText(formatDayHeader(MULTI_PIECE_DAY))).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Earlier days" }));

    expect(
      await screen.findByText(formatDayHeader(MULTI_PIECE_DAY)),
    ).toBeTruthy();
    const historyDaysCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === "history_days",
    );
    expect(historyDaysCalls.length).toBe(2);
    expect(historyDaysCalls[1][1]).toMatchObject({
      from: addDays(TODAY, -239),
    });
  });

  it("states the 400-day reach ceiling honestly once the window is maxed out", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "history_days") return Promise.resolve([RECENT_DAY]);
      return Promise.resolve(null);
    });
    render(<DayTimeline />);
    await screen.findByText(formatDayHeader(RECENT_DAY));

    // 120 → 240 → 360 → 400 days: three extensions exhaust the backend's
    // MAX_RANGE_DAYS window.
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Earlier days" }));
      await waitFor(() =>
        expect(
          invokeMock.mock.calls.filter((call) => call[0] === "history_days")
            .length,
        ).toBe(index + 2),
      );
    }

    // Not "the end of history" — the record may go further back than the
    // window reaches.
    expect(await screen.findByText("Showing the last 400 days.")).toBeTruthy();
    expect(screen.queryByText(/end of history/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Earlier days" })).toBeNull();
  });

  it("shows a calm empty state when there is no practice evidence", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "history_days") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(<DayTimeline />);
    expect(
      await screen.findByText("No practice evidence recorded yet."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a dense 50-set day at 720×520 without crashing, sets scoped to a bounded scroll region", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 720,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 520,
    });
    const denseDay = day({
      date: addDays(TODAY, -150),
      focused_seconds: 180 * 60,
      session_count: 4,
      attempts: 400,
      cleans: 250,
      sets_touched: 50,
      mastered_sets: 3,
      pieces: [
        { piece_id: 1, title: "Scherzo No. 2", attempts: 250 },
        { piece_id: 2, title: "The White Peacock", attempts: 150 },
      ],
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "history_days") return Promise.resolve([denseDay]);
      if (command === "history_day_detail")
        return Promise.resolve(denseDetail(denseDay.date));
      return Promise.resolve(null);
    });
    render(<DayTimeline />);

    const toggle = await screen.findByRole("button", {
      name: formatDayHeader(denseDay),
    });
    // The collapsed header stays a single truncating span — no wrapping.
    const header = toggle.querySelector(".day-card-header");
    expect(header?.className).toContain("day-card-header");

    fireEvent.click(toggle);

    // All 50 sets render inside the bounded, scrollable detail region
    // (`.day-card-detail` — `max-height` + `overflow-y: auto` in
    // dayTimeline.css) without throwing at the 720×520 dense floor.
    await waitFor(() => {
      expect(document.querySelectorAll(".day-card-set").length).toBe(50);
    });
    const detailRegion = document.querySelector(".day-card-detail");
    expect(detailRegion).not.toBeNull();
    expect(detailRegion?.querySelectorAll(".day-card-set").length).toBe(50);
  });
});
