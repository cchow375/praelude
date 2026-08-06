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
import { TodaySheetProvider } from "../notebook/DaySheetStore";

/** A command router covering only what the day-sheet-first window touches: the
 *  notebook load/save seam, the composer candidate reads (all empty here), the
 *  metronome quick bar, and the excerpt reader. */
function installRouter() {
  invokeMock.mockImplementation((command: string, args?: unknown) => {
    switch (command) {
      case "pieces_list":
        return Promise.resolve([]);
      case "region_list":
      case "rep_blocks_for_piece":
      case "retention_due":
      case "daily_work_list":
        return Promise.resolve([]);
      case "day_sheet_get":
        return Promise.resolve(null);
      case "day_sheet_save": {
        const record = (args ?? {}) as { date?: string; bodyJson?: string };
        return Promise.resolve({
          date: record.date ?? "2026-07-15",
          body: JSON.parse(record.bodyJson ?? "[]"),
          updated_at: "2026-07-15T12:00:00Z",
        });
      }
      case "metro_state":
        return Promise.resolve({ running: false, bpm: 84 });
      case "book_excerpt": {
        const contains = String(
          (args as { contains?: unknown })?.contains ?? "the quote",
        );
        return Promise.resolve({
          source_id: "roskell-complete-pianist",
          title: "The Complete Pianist",
          author: "Penelope Roskell",
          heading: "Practising: healthy, effective and inspired",
          text: `A practice paragraph.\n\n${contains}\n\nA closing line.`,
        });
      }
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
      <TodaySheetProvider>
        <TodayWorkspace
          onOpenAtlas={vi.fn()}
          onOpenCalendar={vi.fn()}
          onOpenPiecePlan={vi.fn()}
          onOpenBrain={vi.fn()}
          onOpenLedger={vi.fn()}
          onOpenUniverse={vi.fn()}
          onOpenSettings={vi.fn()}
          {...props}
        />
      </TodaySheetProvider>
    </ReceiptCenterProvider>,
  );
}

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
  it("shows a quiet menu and opens the day-sheet-first practice window", async () => {
    renderToday();

    // App mark, the date, the single-line context-picked quote, and quiet
    // entries. The quote waits for the practice signals, so it is awaited.
    expect(screen.getByText("CodaKiller")).toBeTruthy();
    const quote = await screen.findByTestId("today-menu-quote");
    expect(quote.textContent).toMatch(/—\s+\S/);
    for (const label of [
      "Today's Practice",
      "Score",
      "Assistant",
      "History",
      "Universe",
      "Settings",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }

    // The day surfaces are NOT on the menu; the window is closed.
    expect(
      screen.queryByRole("region", { name: "Today's Practice" }),
    ).toBeNull();
    expect(screen.queryByTestId("day-sheet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Today's Practice" }));

    // The window opens and the day sheet is the surface (spec C5).
    const dialog = await screen.findByRole("region", {
      name: "Today's Practice",
    });
    expect(within(dialog).getByTestId("day-sheet")).toBeTruthy();
  });

  it("opens the excerpt reader when the quote line is clicked (D2)", async () => {
    renderToday();

    expect(screen.queryByRole("dialog", { name: "Reader" })).toBeNull();
    fireEvent.click(await screen.findByTestId("today-menu-quote"));

    const reader = await screen.findByRole("dialog", { name: "Reader" });
    expect(reader).toBeTruthy();
    await screen.findByTestId("reader-quote-anchor");
    expect(screen.getByTestId("reader-attribution").textContent).toContain(
      "Penelope Roskell",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close reader" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Reader" })).toBeNull(),
    );
  });

  it("says why the quote surfaced, using only facts it actually read", async () => {
    // The router serves a blank sheet for today AND yesterday and no open set,
    // so the honest connector is one of those two — never an invented one.
    renderToday();

    const why = await screen.findByTestId("today-menu-quote-why");
    expect([
      "before you write today's page",
      "with yesterday's page blank",
    ]).toContain(why.textContent);
    // It reads as marginalia above the quote, not as a second quote.
    expect(why.tagName).toBe("P");
  });

  it("stays silent about the reason when it could not read any signal", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "metro_state")
        return Promise.resolve({ running: false, bpm: 84 });
      return Promise.reject(new Error("no backend"));
    });
    // Mid-afternoon: outside both the early and the late hour cue, so a failed
    // read really does leave nothing honest to say.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 30, 14, 30));
    try {
      renderToday();
      await screen.findByTestId("today-menu-quote");
      expect(screen.queryByTestId("today-menu-quote-why")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(screen.getByRole("button", { name: "Universe" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onOpenAtlas).toHaveBeenCalledOnce();
    expect(onOpenBrain).toHaveBeenCalledOnce();
    expect(onOpenLedger).toHaveBeenCalledOnce();
    expect(onOpenUniverse).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});

describe("TodayWorkspace practice window", () => {
  it("closes the practice window with the × control", async () => {
    openPractice();
    await screen.findByRole("region", { name: "Today's Practice" });

    fireEvent.click(
      screen.getByRole("button", { name: "Close Today's Practice" }),
    );

    expect(
      screen.queryByRole("region", { name: "Today's Practice" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Today's Practice" }),
    ).toBeTruthy();
  });

  it("closes the practice window on Escape", async () => {
    openPractice();
    const dialog = await screen.findByRole("region", {
      name: "Today's Practice",
    });

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(
      screen.queryByRole("region", { name: "Today's Practice" }),
    ).toBeNull();
  });

  it("no longer threads an active-set HUD into the practice window (Task A3: shell-level Practice Dock)", async () => {
    // TodayWorkspaceProps dropped `activeSetHud`/`onPracticeOpenChange`
    // entirely — the rep HUD now lives in a shell-level dock panel that
    // persists across every workspace tab, so this window has nothing left
    // to dock and nothing to report back to the shell.
    openPractice();

    const dialog = await screen.findByRole("region", {
      name: "Today's Practice",
    });
    expect(within(dialog).queryByTestId("today-practice-hud")).toBeNull();
  });

  it("routes the window's Calendar and Score entry points", async () => {
    const onOpenCalendar = vi.fn();
    const onOpenAtlas = vi.fn();
    openPractice({ onOpenCalendar, onOpenAtlas });
    await screen.findByRole("region", { name: "Today's Practice" });

    fireEvent.click(screen.getByRole("button", { name: "Open the Calendar" }));
    expect(onOpenCalendar).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Open Score" }));
    expect(onOpenAtlas).toHaveBeenCalledOnce();
  });

  it("has deterministic time and date formatting", () => {
    expect(compactDuration(0)).toBe("0m");
    expect(compactDuration(59)).toBe("1m");
    expect(compactDuration(3600)).toBe("1h");
    expect(compactDuration(7320)).toBe("2h 2m");
    expect(todayLabel(new Date(2026, 6, 15))).toMatch(/Wednesday/);
  });
});
