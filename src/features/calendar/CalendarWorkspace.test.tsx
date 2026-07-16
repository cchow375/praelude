import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarWorkspace } from "./CalendarWorkspace";
import type { CalendarApi, DailyWork, RecoveryPreview } from "./types";

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
    listPieces: vi.fn().mockResolvedValue([{ id: 2, title: "Scherzo No. 2", composer: "Chopin", has_xml: true, has_pdf: true, intake_done: true }]),
    listGoals: vi.fn().mockResolvedValue([
      { id: 3, piece_id: 2, text: "Performance ready", kind: "big", parent_goal_id: null, done: false, order: 0, target_date: "2026-07-15", created_ts: "now" },
      { id: 4, piece_id: 2, text: "Secure the coda", kind: "sub", parent_goal_id: 3, done: false, order: 0, target_date: null, created_ts: "now" },
    ]),
    ...overrides,
  };
}

afterEach(cleanup);

describe("CalendarWorkspace", () => {
  it("shows loading, the seven-day strip, capacity, and empty days", async () => {
    let resolveList: (rows: DailyWork[]) => void = () => undefined;
    const api = makeApi({ list: vi.fn().mockReturnValue(new Promise((resolve) => { resolveList = resolve; })) });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);

    expect(screen.getByRole("status").textContent).toContain("Loading this week");
    resolveList([]);
    expect(await screen.findByLabelText("Week of 2026-07-13")).toBeTruthy();
    expect(within(screen.getByLabelText("Week of 2026-07-13")).getAllByText("No work planned.")).toHaveLength(6);
    expect((screen.getByLabelText("Daily capacity") as HTMLInputElement).value).toBe("60");
  });

  it("saves an explicit daily capacity change", async () => {
    const api = makeApi();
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await screen.findByText("Landing shapes");

    fireEvent.change(screen.getByLabelText("Daily capacity"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Save daily capacity" }));

    await waitFor(() => expect(api.setCapacity).toHaveBeenCalledWith(90));
  });

  it("shows a big Goal on its live target date without duplicating its text into daily work", async () => {
    const api = makeApi({ list: vi.fn().mockResolvedValue([]) });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    const milestone = await screen.findByLabelText("Big goal deadlines on 2026-07-15");
    expect(within(milestone).getByText("Performance ready")).toBeTruthy();
    expect(within(milestone).getByText("Scherzo No. 2")).toBeTruthy();
    expect(screen.queryByText("Landing shapes")).toBeNull();
  });

  it("navigates weeks and creates work from a keyboard-submitted form", async () => {
    const api = makeApi();
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await screen.findByText("Landing shapes");

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ from: "2026-07-20", to: "2026-07-26", pieceId: null }));
    fireEvent.click(screen.getAllByRole("button", { name: "+ Add work" })[0]);
    const title = screen.getByLabelText("Work title");
    fireEvent.change(title, { target: { value: "Slow coda rebuild" } });
    fireEvent.change(screen.getByLabelText("Planned minutes"), { target: { value: "25" } });
    fireEvent.keyDown(title, { key: "Enter", code: "Enter" });
    fireEvent.submit(title.closest("form")!);

    await waitFor(() => expect(api.create).toHaveBeenCalledWith({
      goal_id: 3,
      region_id: null,
      block_id: null,
      title: "Slow coda rebuild",
      minutes: 25,
      date: "2026-07-20",
      source: "manual",
    }));
  });

  it("lets only the latest out-of-order week request update work, errors, and loading", async () => {
    const requests: Array<{
      resolve: (rows: DailyWork[]) => void;
      reject: (reason: unknown) => void;
    }> = [];
    const api = makeApi({
      list: vi.fn().mockImplementation(() => new Promise<DailyWork[]>((resolve, reject) => {
        requests.push({ resolve, reject });
      })),
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
      requests[0].resolve([{ ...latestWork, id: 31, title: "Stale initial result" }]);
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
    expect(api.list).toHaveBeenNthCalledWith(1, { from: "2026-07-13", to: "2026-07-19", pieceId: null });
    expect(api.list).toHaveBeenNthCalledWith(2, { from: "2026-07-20", to: "2026-07-26", pieceId: null });
    expect(api.list).toHaveBeenNthCalledWith(3, { from: "2026-07-27", to: "2026-08-02", pieceId: null });
  });

  it("edits, moves, completes, and dismisses with optimistic timestamps", async () => {
    const api = makeApi();
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    const card = (await screen.findByText("Landing shapes")).closest("article")!;

    fireEvent.click(within(card).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith(11, work.updated_ts, { status: "done" }));
    fireEvent.click(within((await screen.findByText("Landing shapes")).closest("article")!).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith(11, work.updated_ts, { status: "dismissed" }));
    fireEvent.click(within((await screen.findByText("Landing shapes")).closest("article")!).getByRole("button", { name: "Move" }));
    fireEvent.change(screen.getByLabelText("Scheduled date"), { target: { value: "2026-07-16" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith(11, work.updated_ts, {
      title: "Landing shapes",
      planned_minutes: 20,
      scheduled_date: "2026-07-16",
    }));
  });

  it("keeps recovery Cancel write-free, then applies one edited batch", async () => {
    const missed = { ...work, scheduled_date: "2026-07-12", origin_date: "2026-07-12" };
    const recovery: RecoveryPreview = {
      today: "2026-07-15",
      capacity_minutes: 60,
      items: [{ work: missed, proposed_date: "2026-07-16", reason: "Fits within Thursday capacity.", effective_deadline: null }],
      days: [{ date: "2026-07-16", planned_minutes: 10, recovery_minutes: 20, capacity_minutes: 60 }],
    };
    const api = makeApi({ recoveryPreview: vi.fn().mockResolvedValue(recovery) });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);

    fireEvent.click(await screen.findByRole("button", { name: "Review missed work" }));
    expect(screen.getByRole("heading", { name: "Decide what happens to missed work" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(api.recoveryApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Review missed work" }));
    fireEvent.change(screen.getByLabelText("Move Landing shapes to"), { target: { value: "2026-07-17" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply decisions" }));
    await waitFor(() => expect(api.recoveryApply).toHaveBeenCalledWith([{
      id: 11,
      expected_updated_ts: work.updated_ts,
      action: "move",
      date: "2026-07-17",
    }]));
  });

  it("surfaces backend error strings without hiding the week controls", async () => {
    const api = makeApi({ list: vi.fn().mockRejectedValue("Calendar is stale. Refresh." ) });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Calendar is stale");
    expect(screen.getByRole("button", { name: "Previous week" })).toBeTruthy();
  });

  it("keeps a rejected create draft open for correction or retry", async () => {
    const api = makeApi({ create: vi.fn().mockRejectedValue("Daily capacity exceeded.") });
    render(<CalendarWorkspace api={api} initialToday="2026-07-15" />);
    await screen.findByText("Landing shapes");

    fireEvent.click(screen.getAllByRole("button", { name: "+ Add work" })[0]);
    const title = screen.getByLabelText("Work title") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Keep this draft" } });
    fireEvent.submit(title.closest("form")!);

    expect((await screen.findByRole("alert")).textContent).toContain("Daily capacity exceeded");
    expect((screen.getByLabelText("Work title") as HTMLInputElement).value).toBe("Keep this draft");
  });
});
