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

    // App mark, the date, the single-line rotating quote, and quiet entries.
    expect(screen.getByText("CodaKiller")).toBeTruthy();
    const quote = screen.getByTestId("today-menu-quote");
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
      screen.queryByRole("dialog", { name: "Today's Practice" }),
    ).toBeNull();
    expect(screen.queryByTestId("day-sheet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Today's Practice" }));

    // The window opens and the day sheet is the surface (spec C5).
    const dialog = await screen.findByRole("dialog", {
      name: "Today's Practice",
    });
    expect(within(dialog).getByTestId("day-sheet")).toBeTruthy();
  });

  it("opens the excerpt reader when the quote line is clicked (D2)", async () => {
    renderToday();

    expect(screen.queryByRole("dialog", { name: "Reader" })).toBeNull();
    fireEvent.click(screen.getByTestId("today-menu-quote"));

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
    await screen.findByRole("dialog", { name: "Today's Practice" });

    fireEvent.click(
      screen.getByRole("button", { name: "Close Today's Practice" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Today's Practice" }),
    ).toBeNull();
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

  it("docks the shell-owned active-set HUD in the window and reports open state", async () => {
    const onPracticeOpenChange = vi.fn();
    openPractice({
      activeSetHud: <div data-testid="active-hud">Active set</div>,
      onPracticeOpenChange,
    });

    const dialog = await screen.findByRole("dialog", {
      name: "Today's Practice",
    });
    // The HUD is reachable inside the window (requirement 2).
    expect(within(dialog).getByTestId("active-hud")).toBeTruthy();
    // The shell is told the window is open (so it can hand off its stage dock).
    expect(onPracticeOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Close Today's Practice" }),
    );
    await waitFor(() =>
      expect(onPracticeOpenChange).toHaveBeenLastCalledWith(false),
    );
  });

  it("routes the window's Calendar and Score entry points", async () => {
    const onOpenCalendar = vi.fn();
    const onOpenAtlas = vi.fn();
    openPractice({ onOpenCalendar, onOpenAtlas });
    await screen.findByRole("dialog", { name: "Today's Practice" });

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
