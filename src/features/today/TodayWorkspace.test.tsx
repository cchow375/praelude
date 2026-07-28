import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { TodayWorkspace, compactDuration, todayLabel } from "./TodayWorkspace";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";

const SNAPSHOT = {
  generated_at: "2026-07-15T12:00:00Z",
  definitions: [],
  traces: {
    source: "canonical ledger",
    practice_event_kinds: [],
    idle_threshold_seconds: 300,
    active_window_start: "2026-06-18",
    active_window_end: "2026-07-15",
    quality_formula: "bounded",
  },
  totals: {
    focused_seconds: 7320,
    active_days_28: 8,
    regions_practiced: 12,
    regions_revisited: 5,
  },
  pieces: [
    {
      piece_id: 1,
      title: "Older Piece",
      composer: null,
      focused_seconds: 120,
      active_days_28: 1,
      regions_total: 1,
      regions_practiced: 1,
      regions_revisited: 0,
      quality_brightness: 1,
      last_practiced: "2026-07-10T12:00:00Z",
      region_signals: [],
    },
    {
      piece_id: 7,
      title: "Scherzo No. 2",
      composer: "Chopin",
      focused_seconds: 7200,
      active_days_28: 7,
      regions_total: 14,
      regions_practiced: 11,
      regions_revisited: 5,
      quality_brightness: 1,
      last_practiced: "2026-07-14T12:00:00Z",
      region_signals: [],
    },
  ],
};

const PIECE = { id: 7, title: "Scherzo No. 2", composer: "Chopin" };

function region(id: number, name: string) {
  return {
    id,
    piece_id: 7,
    name,
    notes: null,
    m_start: 120,
    m_end: 132,
    kind: "hard_spot",
    order: 0,
    color: null,
    pdf_anchor: null,
  };
}

function retentionCheck(id: number, regionId: number) {
  return {
    id,
    region_id: regionId,
    source_set_id: null,
    due_date: "2026-07-16",
    original_due_date: "2026-07-16",
    condition: {},
    state: "due",
    result: null,
    completed_ts: null,
    created_ts: "2026-07-16T00:00:00Z",
    updated_ts: "2026-07-16T00:00:00Z",
  };
}

const COMMITTED_RECEIPT = {
  receipt_id: "receipt:session-plan-start:ui:session-plan:x:1",
  command_id: "session-plan-start:ui:session-plan:x:1",
  status: "committed" as const,
  summary: "Session plan started: item 1 of 2 — Coda landing.",
  value: {
    plan: { mode: "reviewed_session_draft", sequence: [] },
    started_sequence: 1,
    started_candidate_id: "retention:41",
    block_id: 1,
    snapshot: {
      block_id: 1,
      piece_id: 7,
      m_start: 120,
      m_end: 132,
      set_state: "active",
    },
  },
  entity_refs: [{ entity_type: "set", entity_id: 1 }],
  event_ids: [1],
  undo_action: null,
  replayed: false,
  committed_ts: "2026-07-16T12:00:00Z",
};

interface RouteOptions {
  regions?: ReturnType<typeof region>[];
  retention?: ReturnType<typeof retentionCheck>[];
  planStart?: () => Promise<unknown>;
}

/** A command-aware invoke so effect ordering between the workspace and the
 *  mounted composer never changes what a given command returns. */
function installRouter(options: RouteOptions = {}) {
  const regions = options.regions ?? [];
  const retention = options.retention ?? [];
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case "universe_snapshot":
        return Promise.resolve(SNAPSHOT);
      case "pieces_list":
        return Promise.resolve(regions.length > 0 ? [PIECE] : []);
      case "region_list":
        return Promise.resolve(regions);
      case "rep_blocks_for_piece":
        return Promise.resolve([]);
      case "retention_due":
        return Promise.resolve(retention);
      case "daily_work_list":
        return Promise.resolve([]);
      case "session_plan_start":
        return options.planStart
          ? options.planStart()
          : Promise.resolve(COMMITTED_RECEIPT);
      default:
        return Promise.resolve(null);
    }
  });
}

function renderToday(
  props: Partial<Parameters<typeof TodayWorkspace>[0]> = {},
) {
  return render(
    <ReceiptCenterProvider>
      <TodayWorkspace
        onOpenAtlas={vi.fn()}
        onOpenCalendar={vi.fn()}
        onOpenPiece={vi.fn()}
        onOpenBrain={vi.fn()}
        onOpenLedger={vi.fn()}
        onOpenUniverse={vi.fn()}
        onOpenSettings={vi.fn()}
        {...props}
      />
    </ReceiptCenterProvider>,
  );
}

/** Render the menu, then open the "Today's Practice" window that now houses the
 *  day surfaces (composer, plan, retention, launch board). */
function openPractice(
  props: Partial<Parameters<typeof TodayWorkspace>[0]> = {},
) {
  const result = renderToday(props);
  fireEvent.click(screen.getByRole("button", { name: "Today's Practice" }));
  return result;
}

beforeEach(() => {
  invokeMock.mockReset();
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
  installRouter();
});
afterEach(cleanup);

describe("TodayWorkspace main menu", () => {
  it("shows a quiet menu and hides the day surfaces until Today's Practice opens", () => {
    renderToday();

    // App mark, the date, the single-line practice quote, and quiet entries.
    expect(screen.getByText("CodaKiller")).toBeTruthy();
    expect(screen.getByText("Slow practice is fast learning.")).toBeTruthy();
    for (const label of [
      "Today's Practice",
      "Score",
      "Brain",
      "Ledger",
      "Universe",
      "Settings",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }

    // The re-housed day surfaces are NOT rendered on the menu (pre-rebuild the
    // plan textarea and the composer were always mounted here — this bites).
    expect(
      screen.queryByRole("textbox", { name: "Today's plan and intention" }),
    ).toBeNull();
    expect(
      screen.queryByRole("dialog", { name: "Today's Practice" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Today's Practice" }));

    expect(
      screen.getByRole("dialog", { name: "Today's Practice" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Today's plan and intention" }),
    ).toBeTruthy();
  });

  it("routes each quiet menu entry to its workspace", () => {
    const onOpenAtlas = vi.fn();
    const onOpenBrain = vi.fn();
    const onOpenLedger = vi.fn();
    const onOpenUniverse = vi.fn();
    const onOpenSettings = vi.fn();
    renderToday({
      onOpenAtlas,
      onOpenBrain,
      onOpenLedger,
      onOpenUniverse,
      onOpenSettings,
    });

    fireEvent.click(screen.getByRole("button", { name: "Score" }));
    fireEvent.click(screen.getByRole("button", { name: "Brain" }));
    fireEvent.click(screen.getByRole("button", { name: "Ledger" }));
    fireEvent.click(screen.getByRole("button", { name: "Universe" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onOpenAtlas).toHaveBeenCalledOnce();
    expect(onOpenBrain).toHaveBeenCalledOnce();
    expect(onOpenLedger).toHaveBeenCalledOnce();
    expect(onOpenUniverse).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("closes the practice window with the × control", async () => {
    openPractice();
    expect(
      await screen.findByRole("heading", { name: "Scherzo No. 2" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Close Today's Practice" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Today's Practice" }),
    ).toBeNull();
    // Back to the menu.
    expect(
      screen.getByRole("button", { name: "Today's Practice" }),
    ).toBeTruthy();
  });

  it("closes the practice window on Escape", async () => {
    openPractice();
    const dialog = await screen.findByRole("dialog", {
      name: "Today's Practice",
    });

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", { name: "Today's Practice" }),
    ).toBeNull();
  });
});

describe("TodayWorkspace practice window", () => {
  it("launches the most recent canonical piece and exposes sourced totals", async () => {
    const onOpenPiece = vi.fn();
    openPractice({ onOpenPiece });

    expect(
      await screen.findByRole("heading", { name: "Scherzo No. 2" }),
    ).toBeTruthy();
    expect(screen.getByText("2h 2m")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(
      screen.getByText("Targets revisited").parentElement?.textContent,
    ).toBe("Targets revisited5");

    fireEvent.click(screen.getByRole("button", { name: /Continue in Atlas/ }));
    expect(onOpenPiece).toHaveBeenCalledWith({
      piece_id: 7,
      title: "Scherzo No. 2",
    });
  });

  it("routes the day action and keeps ledger failures explicit/retryable", async () => {
    let ledgerCalls = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === "universe_snapshot") {
        ledgerCalls += 1;
        return ledgerCalls === 1
          ? Promise.reject(new Error("Ledger unavailable"))
          : Promise.resolve(SNAPSHOT);
      }
      if (command === "pieces_list") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const onOpenCalendar = vi.fn();
    openPractice({ onOpenCalendar });

    expect(await screen.findByText("Ledger unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Scherzo No. 2" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Shape the day/ }));
    expect(onOpenCalendar).toHaveBeenCalledOnce();
  });

  it("shows the configured default contract instead of claiming a fixed five", async () => {
    openPractice({ defaultCleanStreak: 7 });

    await screen.findByRole("heading", { name: "Scherzo No. 2" });
    expect(
      screen.getByLabelText("Default contract: 7 clean attempts in a row"),
    ).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("makes today's plain-language plan obvious and restores it for the same date", async () => {
    const first = openPractice();
    const plan = screen.getByRole("textbox", {
      name: "Today's plan and intention",
    });

    fireEvent.change(plan, {
      target: {
        value: "20 minutes: diagnose page 4, then dotted rhythms at 72.",
      },
    });
    expect(screen.getByText("Saved for today on this Mac.")).toBeTruthy();

    first.unmount();
    openPractice();
    expect(
      (
        screen.getByRole("textbox", {
          name: "Today's plan and intention",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("20 minutes: diagnose page 4, then dotted rhythms at 72.");
  });

  it("mounts the session composer and loads explicit candidates", async () => {
    installRouter({
      regions: [region(14, "Coda landing")],
      retention: [retentionCheck(41, 14)],
    });
    openPractice();

    expect(await screen.findByText("Session composer")).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "Coda landing" }),
    ).toBeTruthy();
    // No plan-start write happens on mount.
    expect(
      invokeMock.mock.calls.some(
        ([command]) => command === "session_plan_start",
      ),
    ).toBe(false);
  });

  it("starts the plan's first item with the exact reviewed payload and a stable command id", async () => {
    installRouter({
      regions: [region(14, "Coda landing")],
      retention: [retentionCheck(41, 14)],
    });
    openPractice();

    await screen.findByRole("heading", { name: "Coda landing" });
    expect(
      invokeMock.mock.calls.some(
        ([command]) => command === "session_plan_start",
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));

    await waitFor(() =>
      expect(
        invokeMock.mock.calls.some(
          ([command]) => command === "session_plan_start",
        ),
      ).toBe(true),
    );
    const call = invokeMock.mock.calls.find(
      ([command]) => command === "session_plan_start",
    );
    const payload = (call?.[1] as { payload: Record<string, unknown> }).payload;
    expect(payload.start_sequence).toBe(1);
    expect(payload.command_id).toMatch(/^ui:session-plan:.+:1$/);
    const plan = payload.plan as {
      mode: string;
      sequence: Array<Record<string, unknown>>;
    };
    expect(plan.mode).toBe("reviewed_session_draft");
    expect(plan.sequence[0].target_ref).toBe("14");
    expect(plan.sequence[0].candidate_id).toBe("retention:41");
  });

  it("renders the active plan's remaining items with an explicit per-item start", async () => {
    installRouter({
      regions: [region(14, "Coda landing"), region(15, "Development leap")],
      retention: [retentionCheck(41, 14), retentionCheck(42, 15)],
    });
    openPractice();

    await screen.findByRole("heading", { name: "Coda landing" });
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));

    const activePlan = await screen.findByRole("region", {
      name: "Active session plan",
    });
    // The first item is recorded as started; the second is startable explicitly.
    expect(within(activePlan).getByText("Started")).toBeTruthy();
    const remaining = within(activePlan).getByRole("button", {
      name: "Start item",
    });
    expect(remaining).toBeTruthy();
    expect((remaining as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables per-item start while a set is already live", async () => {
    installRouter({
      regions: [region(14, "Coda landing"), region(15, "Development leap")],
      retention: [retentionCheck(41, 14), retentionCheck(42, 15)],
    });
    openPractice({ activeBlock: { block_id: 1 } as never });

    await screen.findByRole("heading", { name: "Coda landing" });
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));

    const activePlan = await screen.findByRole("region", {
      name: "Active session plan",
    });
    expect(
      (
        within(activePlan).getByRole("button", {
          name: "Start item",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      within(activePlan).getByText(/Finish or close the current set/),
    ).toBeTruthy();
  });

  it("surfaces a backend rejection without claiming a write and preserves the draft", async () => {
    installRouter({
      regions: [region(14, "Coda landing")],
      retention: [retentionCheck(41, 14)],
      planStart: () =>
        Promise.resolve({
          receipt_id: "rejected:session-plan-start",
          command_id: "session-plan-start:ui:session-plan:x:1",
          status: "rejected",
          summary: "close the current block first",
          value: null,
          entity_refs: [],
          event_ids: [],
          undo_action: null,
          error_code: "session_plan_rejected",
          error_detail: "close the current block first",
          replayed: false,
          committed_ts: null,
        }),
    });
    openPractice();

    await screen.findByRole("heading", { name: "Coda landing" });
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));

    // The composer reports the rejection and no active plan panel appears.
    expect(
      await screen.findByText(
        "The session owner did not accept the start request. Nothing was written.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Active session plan" }),
    ).toBeNull();
    // The draft is preserved: the composer and its Start control remain.
    expect(screen.getByText("Session composer")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Start Session",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("has deterministic time and date formatting", () => {
    expect(compactDuration(0)).toBe("0m");
    expect(compactDuration(59)).toBe("1m");
    expect(compactDuration(3600)).toBe("1h");
    expect(compactDuration(7320)).toBe("2h 2m");
    expect(todayLabel(new Date(2026, 6, 15))).toMatch(/Wednesday/);
  });
});
