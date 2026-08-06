import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarWorkspace, plannedVsDonePercent } from "./CalendarWorkspace";
import { dayLabel } from "./dates";
import type { CalendarApi, DailyWork, RecoveryPreview } from "./types";
import type { HistoryDaySummary } from "../ledger/historyDays";
import type { DaySheet } from "../notebook/lines";
import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";

const work: DailyWork = {
  id: 11,
  goal_id: 4,
  piece_id: 2,
  piece_title: "Scherzo No. 2",
  goal_text: "Secure the coda",
  parent_goal_text: "Performance ready",
  region_id: null,
  block_id: null,
  title: "Landing shapes",
  planned_minutes: 20,
  origin_date: "2026-07-13",
  scheduled_date: "2026-07-13",
  status: "planned",
  source: "manual",
  reschedule_count: 0,
  sort_order: 0,
  completed_ts: null,
  created_ts: "2026-07-12T10:00:00Z",
  updated_ts: "2026-07-12T10:00:00Z",
};

const noRecovery: RecoveryPreview = {
  today: "2026-07-15",
  capacity_minutes: 60,
  items: [],
  days: [],
};

function makeApi(overrides: Partial<CalendarApi> = {}): CalendarApi {
  return {
    list: vi.fn().mockResolvedValue([work]),
    create: vi.fn().mockResolvedValue(work),
    update: vi.fn().mockResolvedValue(work),
    delete: vi.fn().mockResolvedValue(undefined),
    recoveryPreview: vi.fn().mockResolvedValue(noRecovery),
    recoveryApply: vi.fn().mockResolvedValue({ applied_at: "now", items: [] }),
    setCapacity: vi.fn().mockResolvedValue(undefined),
    listPieces: vi.fn().mockResolvedValue([
      {
        id: 2,
        title: "Scherzo No. 2",
        composer: "Chopin",
        has_xml: true,
        has_pdf: true,
        intake_done: true,
      },
    ]),
    listGoals: vi.fn().mockResolvedValue([
      {
        id: 3,
        piece_id: 2,
        text: "Performance ready",
        kind: "big",
        parent_goal_id: null,
        done: false,
        order: 0,
        target_date: "2026-07-15",
        created_ts: "now",
      },
      {
        id: 4,
        piece_id: 2,
        text: "Secure the coda",
        kind: "sub",
        parent_goal_id: 3,
        done: false,
        order: 0,
        target_date: null,
        created_ts: "now",
      },
    ]),
    historyDays: vi.fn().mockResolvedValue([]),
    daySheetsRange: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

afterEach(cleanup);

describe("CalendarWorkspace", () => {
  it("shows loading, the seven-day strip, capacity, and empty days", async () => {
    let resolveList: (rows: DailyWork[]) => void = () => undefined;
    const api = makeApi({
      list: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveList = resolve;
        }),
      ),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);

    expect(screen.getByRole("status").textContent).toContain(
      "Loading this week",
    );
    resolveList([]);
    expect(await screen.findByLabelText("Week of 2026-07-13")).toBeTruthy();
    expect(
      within(screen.getByLabelText("Week of 2026-07-13")).getAllByText(
        "No work planned.",
      ),
    ).toHaveLength(6);
    expect(
      (screen.getByLabelText("Daily capacity") as HTMLInputElement).value,
    ).toBe("60");
  });

  it("saves an explicit daily capacity change", async () => {
    const api = makeApi();
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await screen.findByText("Landing shapes");

    fireEvent.change(screen.getByLabelText("Daily capacity"), {
      target: { value: "90" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save daily capacity" }),
    );

    await waitFor(() => expect(api.setCapacity).toHaveBeenCalledWith(90));
  });

  it("shows a big Goal on its live target date without duplicating its text into daily work", async () => {
    const api = makeApi({ list: vi.fn().mockResolvedValue([]) });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    const milestone = await screen.findByLabelText(
      "Big goal deadlines on 2026-07-15",
    );
    expect(within(milestone).getByText("Performance ready")).toBeTruthy();
    expect(within(milestone).getByText("Scherzo No. 2")).toBeTruthy();
    expect(screen.queryByText("Landing shapes")).toBeNull();
  });

  it("navigates weeks and creates work from a keyboard-submitted form", async () => {
    const api = makeApi();
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await screen.findByText("Landing shapes");

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({
        from: "2026-07-20",
        to: "2026-07-26",
        pieceId: null,
      }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "+ Add work" })[0]);
    const title = screen.getByLabelText("Work title");
    fireEvent.change(title, { target: { value: "Slow coda rebuild" } });
    fireEvent.change(screen.getByLabelText("Planned minutes"), {
      target: { value: "25" },
    });
    fireEvent.keyDown(title, { key: "Enter", code: "Enter" });
    fireEvent.submit(title.closest("form")!);

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        goal_id: 3,
        region_id: null,
        block_id: null,
        title: "Slow coda rebuild",
        minutes: 25,
        date: "2026-07-20",
        source: "manual",
      }),
    );
  });

  it("lets only the latest out-of-order week request update work, errors, and loading", async () => {
    const requests: Array<{
      resolve: (rows: DailyWork[]) => void;
      reject: (reason: unknown) => void;
    }> = [];
    const api = makeApi({
      list: vi.fn().mockImplementation(
        () =>
          new Promise<DailyWork[]>((resolve, reject) => {
            requests.push({ resolve, reject });
          }),
      ),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);

    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(requests).toHaveLength(3));

    const latestWork = {
      ...work,
      id: 33,
      title: "Latest week result",
      origin_date: "2026-07-27",
      scheduled_date: "2026-07-27",
    };
    await act(async () => {
      requests[2].resolve([latestWork]);
      await Promise.resolve();
    });

    expect(await screen.findByText("Latest week result")).toBeTruthy();
    expect(screen.getByLabelText("Week of 2026-07-27")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      requests[0].resolve([
        { ...latestWork, id: 31, title: "Stale initial result" },
      ]);
      await Promise.resolve();
    });
    await act(async () => {
      requests[1].reject(new Error("Stale request failed"));
      await Promise.resolve();
    });

    expect(screen.getByText("Latest week result")).toBeTruthy();
    expect(screen.queryByText("Stale initial result")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(api.list).toHaveBeenNthCalledWith(1, {
      from: "2026-07-13",
      to: "2026-07-19",
      pieceId: null,
    });
    expect(api.list).toHaveBeenNthCalledWith(2, {
      from: "2026-07-20",
      to: "2026-07-26",
      pieceId: null,
    });
    expect(api.list).toHaveBeenNthCalledWith(3, {
      from: "2026-07-27",
      to: "2026-08-02",
      pieceId: null,
    });
  });

  it("edits, moves, completes, and dismisses with optimistic timestamps", async () => {
    const api = makeApi();
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    const card = (await screen.findByText("Landing shapes")).closest(
      "article",
    )!;

    fireEvent.click(within(card).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(11, work.updated_ts, {
        status: "done",
      }),
    );
    fireEvent.click(
      within(
        (await screen.findByText("Landing shapes")).closest("article")!,
      ).getByRole("button", { name: "Dismiss" }),
    );
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(11, work.updated_ts, {
        status: "dismissed",
      }),
    );
    fireEvent.click(
      within(
        (await screen.findByText("Landing shapes")).closest("article")!,
      ).getByRole("button", { name: "Move" }),
    );
    fireEvent.change(screen.getByLabelText("Scheduled date"), {
      target: { value: "2026-07-16" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(11, work.updated_ts, {
        title: "Landing shapes",
        planned_minutes: 20,
        scheduled_date: "2026-07-16",
      }),
    );
  });

  it("keeps recovery Cancel write-free, then applies one edited batch", async () => {
    const missed = {
      ...work,
      scheduled_date: "2026-07-12",
      origin_date: "2026-07-12",
    };
    const recovery: RecoveryPreview = {
      today: "2026-07-15",
      capacity_minutes: 60,
      items: [
        {
          work: missed,
          proposed_date: "2026-07-16",
          reason: "Fits within Thursday capacity.",
          effective_deadline: null,
        },
      ],
      days: [
        {
          date: "2026-07-16",
          planned_minutes: 10,
          recovery_minutes: 20,
          capacity_minutes: 60,
        },
      ],
    };
    const api = makeApi({
      recoveryPreview: vi.fn().mockResolvedValue(recovery),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Review missed work" }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Decide what happens to missed work",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(api.recoveryApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Review missed work" }));
    fireEvent.change(screen.getByLabelText("Move Landing shapes to"), {
      target: { value: "2026-07-17" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply decisions" }));
    await waitFor(() =>
      expect(api.recoveryApply).toHaveBeenCalledWith([
        {
          id: 11,
          expected_updated_ts: work.updated_ts,
          action: "move",
          date: "2026-07-17",
        },
      ]),
    );
  });

  it("surfaces backend error strings without hiding the week controls", async () => {
    const api = makeApi({
      list: vi.fn().mockRejectedValue("Calendar is stale. Refresh."),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Calendar is stale",
    );
    expect(screen.getByRole("button", { name: "Previous week" })).toBeTruthy();
  });

  it("keeps a rejected create draft open for correction or retry", async () => {
    const api = makeApi({
      create: vi.fn().mockRejectedValue("Daily capacity exceeded."),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await screen.findByText("Landing shapes");

    fireEvent.click(screen.getAllByRole("button", { name: "+ Add work" })[0]);
    const title = screen.getByLabelText("Work title") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Keep this draft" } });
    fireEvent.submit(title.closest("form")!);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Daily capacity exceeded",
    );
    expect(
      (screen.getByLabelText("Work title") as HTMLInputElement).value,
    ).toBe("Keep this draft");
  });
});

describe("plannedVsDonePercent (fix round 1)", () => {
  it("pins the exact broken shape: 20 planned / 20 weekMax -> 100, 14 done / 20 weekMax -> 70", () => {
    expect(plannedVsDonePercent(20, 20)).toBe(100);
    expect(plannedVsDonePercent(14, 20)).toBe(70);
  });

  it("never exceeds 100 even if a value somehow exceeds weekMaxMinutes (defensive clamp)", () => {
    expect(plannedVsDonePercent(45, 20)).toBe(100);
  });

  it("returns 0 for a non-positive weekMaxMinutes instead of dividing by zero", () => {
    expect(plannedVsDonePercent(10, 0)).toBe(0);
  });
});

describe("CalendarWorkspace — planned-vs-done day cells (Task B3)", () => {
  function daySheet(date: string, minutes: number): DaySheet {
    return {
      date,
      body: [{ type: "block", minutes, piece_id: 1 }],
      updated_at: "2026-07-15T00:00:00Z",
    };
  }

  function daySummary(
    date: string,
    focusedSeconds: number,
    attempts: number,
  ): HistoryDaySummary {
    return {
      date,
      focused_seconds: focusedSeconds,
      session_count: 1,
      attempts,
      cleans: attempts,
      sets_touched: 1,
      mastered_sets: 0,
      pieces: [],
    };
  }

  it("issues exactly ONE history_days + ONE day_sheets_range call for the visible week, not per cell", async () => {
    const api = makeApi({
      historyDays: vi
        .fn()
        .mockResolvedValue([daySummary("2026-07-15", 38 * 60, 12)]),
      daySheetsRange: vi.fn().mockResolvedValue([daySheet("2026-07-15", 45)]),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await screen.findByText("45 planned · 38 done");

    expect(api.historyDays).toHaveBeenCalledTimes(1);
    expect(api.historyDays).toHaveBeenCalledWith("2026-07-13", "2026-07-19");
    expect(api.daySheetsRange).toHaveBeenCalledTimes(1);
    expect(api.daySheetsRange).toHaveBeenCalledWith("2026-07-13", "2026-07-19");
  });

  it("renders the merged planned/done numbers on the exact day, and today shows live data (S7)", async () => {
    const api = makeApi({
      historyDays: vi
        .fn()
        .mockResolvedValue([daySummary("2026-07-15", 38 * 60, 12)]),
      daySheetsRange: vi.fn().mockResolvedValue([daySheet("2026-07-15", 45)]),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);

    const todayCell = (await screen.findByText("45 planned · 38 done")).closest(
      "section",
    )!;
    expect(todayCell.className).toContain("is-today");
  });

  it("leaves a cell with neither planned nor done data exactly as before (no bar, no text)", async () => {
    const api = makeApi({
      historyDays: vi
        .fn()
        .mockResolvedValue([daySummary("2026-07-15", 38 * 60, 12)]),
      daySheetsRange: vi.fn().mockResolvedValue([daySheet("2026-07-15", 45)]),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await screen.findByText("45 planned · 38 done");

    // 2026-07-16 has neither a sheet nor practice evidence in this fixture set.
    const { weekday, date: monthDay } = dayLabel("2026-07-16");
    const cell = screen.getByLabelText(`${weekday} ${monthDay}`);
    expect(within(cell).queryByText(/planned ·/)).toBeNull();
    expect(cell.querySelector(".calendar-day-progress-bars")).toBeNull();
  });

  it("fix round 1: a day whose planned+done exceeds weekMaxMinutes still renders each track's own fill ≤100%, unshrunk (the exact fixture that broke as a single flex row: 20 planned + 14 done, week max 20)", async () => {
    const api = makeApi({
      // Only 2026-07-15 has data, so weekMaxMinutes = max(20, 14) = 20 — the
      // single-metric max, not the 34-minute sum. Under the old two-segment
      // flex row this made planned+done = 170% of the bar, which the browser
      // (not jsdom) proportionally shrank back to 100%, destroying the
      // cross-day scale. The stacked-track fix computes each metric against
      // weekMaxMinutes independently, so neither can exceed 100% by
      // construction — asserted directly on the rendered inline widths here.
      historyDays: vi
        .fn()
        .mockResolvedValue([daySummary("2026-07-15", 14 * 60, 3)]),
      daySheetsRange: vi.fn().mockResolvedValue([daySheet("2026-07-15", 20)]),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);

    const cell = (await screen.findByText("20 planned · 14 done")).closest(
      "section",
    )!;
    const plannedFill = cell.querySelector<HTMLElement>(
      ".calendar-day-progress-planned",
    )!;
    const doneFill = cell.querySelector<HTMLElement>(
      ".calendar-day-progress-done",
    )!;
    // Each track is its OWN bar (not two segments sharing one bar), so the
    // right assertion is per-bar <=100%, not sum<=100%.
    expect(plannedFill.style.width).toBe("100%"); // 20 / weekMax(20) * 100
    expect(doneFill.style.width).toBe("70%"); // 14 / weekMax(20) * 100
    const plannedPct = Number.parseFloat(plannedFill.style.width);
    const donePct = Number.parseFloat(doneFill.style.width);
    expect(plannedPct).toBeLessThanOrEqual(100);
    expect(donePct).toBeLessThanOrEqual(100);
    // The two tracks are separate elements, not siblings inside one flex row
    // that would renormalize their widths.
    expect(plannedFill.closest(".calendar-day-progress-track")).not.toBe(
      doneFill.closest(".calendar-day-progress-track"),
    );
  });

  it("renders a sheet-but-no-practice day and a practice-but-no-sheet day with exact numbers", async () => {
    const api = makeApi({
      historyDays: vi
        .fn()
        .mockResolvedValue([daySummary("2026-07-14", 25 * 60, 7)]),
      daySheetsRange: vi.fn().mockResolvedValue([daySheet("2026-07-17", 20)]),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);

    expect(await screen.findByText("0 planned · 25 done")).toBeTruthy();
    expect(await screen.findByText("20 planned · 0 done")).toBeTruthy();
  });

  it("does not let a stale planned-vs-done response overwrite a newer week's data", async () => {
    const requests: Array<{
      resolve: (rows: HistoryDaySummary[]) => void;
    }> = [];
    const api = makeApi({
      historyDays: vi.fn().mockImplementation(
        () =>
          new Promise<HistoryDaySummary[]>((resolve) => {
            requests.push({ resolve });
          }),
      ),
      daySheetsRange: vi.fn().mockResolvedValue([]),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await waitFor(() => expect(requests).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(requests).toHaveLength(2));

    // Resolve the newer (second) week's request first, then the stale first
    // request — the stale one must not clobber the newer merged data.
    await act(async () => {
      requests[1].resolve([daySummary("2026-07-20", 30 * 60, 4)]);
      await Promise.resolve();
    });
    await act(async () => {
      requests[0].resolve([daySummary("2026-07-15", 999 * 60, 999)]);
      await Promise.resolve();
    });

    expect(await screen.findByText("0 planned · 30 done")).toBeTruthy();
    expect(screen.queryByText(/999 done/)).toBeNull();
  });
});

describe("CalendarWorkspace — week navigation under same-tick clicks", () => {
  it("advances one week per click when five Next clicks land in the same tick", async () => {
    const api = makeApi({ list: vi.fn().mockResolvedValue([]) });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await screen.findByLabelText("Week of 2026-07-13");

    // Raw DOM clicks inside ONE act: React batches all five state updates
    // before re-rendering, so a closure-read `weekStart` would compute every
    // click from the SAME stale week and advance a single week in total.
    const next = screen.getByRole("button", { name: "Next week" });
    act(() => {
      for (let index = 0; index < 5; index += 1) {
        next.click();
      }
    });

    expect(await screen.findByLabelText("Week of 2026-08-17")).toBeTruthy();
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({
        from: "2026-08-17",
        to: "2026-08-23",
        pieceId: null,
      }),
    );
  });

  it("retreats one week per click when three Previous clicks land in the same tick", async () => {
    const api = makeApi({ list: vi.fn().mockResolvedValue([]) });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await screen.findByLabelText("Week of 2026-07-13");

    const previous = screen.getByRole("button", { name: "Previous week" });
    act(() => {
      for (let index = 0; index < 3; index += 1) {
        previous.click();
      }
    });

    expect(await screen.findByLabelText("Week of 2026-06-22")).toBeTruthy();
  });
});

describe("CalendarWorkspace — day sheet close refreshes planned-vs-done", () => {
  beforeEach(() => {
    installTauriDevMock();
  });
  afterEach(() => {
    cleanup();
    uninstallTauriDevMock();
  });

  it("refetches the week's sheets when the day sheet window closes", async () => {
    const summary: HistoryDaySummary = {
      date: "2026-07-15",
      focused_seconds: 38 * 60,
      session_count: 1,
      attempts: 12,
      cleans: 12,
      sets_touched: 1,
      mastered_sets: 0,
      pieces: [],
    };
    const sheetWith = (minutes: number): DaySheet => ({
      date: "2026-07-15",
      body: [{ type: "block", minutes, piece_id: 1 }],
      updated_at: "2026-07-15T00:00:00Z",
    });
    const api = makeApi({
      list: vi.fn().mockResolvedValue([]),
      historyDays: vi.fn().mockResolvedValue([summary]),
      // The sheet is edited while the window is open; the second read is what
      // the strip must pick up on close.
      daySheetsRange: vi
        .fn()
        .mockResolvedValueOnce([sheetWith(20)])
        .mockResolvedValue([sheetWith(45)]),
    });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    expect(await screen.findByText("20 planned · 38 done")).toBeTruthy();

    // Wednesday 2026-07-15 is the third opener in a Monday-start strip.
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Open day sheet for/ })[2],
    );
    const windowDialog = await screen.findByTestId("day-sheet-window");
    fireEvent.keyDown(windowDialog, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByTestId("day-sheet-window")).toBeNull(),
    );
    expect(await screen.findByText("45 planned · 38 done")).toBeTruthy();
  });
});

describe("CalendarWorkspace — past-day sheet (spec C1/C3, ledger 3/11)", () => {
  beforeEach(() => {
    installTauriDevMock();
  });
  afterEach(() => {
    cleanup();
    uninstallTauriDevMock();
  });

  function seam() {
    return (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
  }

  it("opens a past day's own sheet from a quiet Calendar entry, read and editable", async () => {
    await seam().invoke("day_sheet_save", {
      date: "2026-07-13",
      bodyJson: JSON.stringify([
        { type: "text", text: "Reviewed the coda landing" },
      ]),
    });

    const api = makeApi({ list: vi.fn().mockResolvedValue([]) });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await screen.findByLabelText("Week of 2026-07-13");

    expect(screen.queryByTestId("day-sheet-window")).toBeNull();

    // The week starts Monday 2026-07-13; its opener is first in the strip.
    const openers = screen.getAllByRole("button", {
      name: /^Open day sheet for/,
    });
    fireEvent.click(openers[0]);

    const windowDialog = await screen.findByTestId("day-sheet-window");
    expect(
      await within(windowDialog).findByDisplayValue(
        "Reviewed the coda landing",
      ),
    ).toBeTruthy();

    fireEvent.keyDown(windowDialog, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("day-sheet-window")).toBeNull(),
    );
  });
});
