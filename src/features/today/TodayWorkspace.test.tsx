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
 *  notebook load/save seam, the composer candidate reads (all empty here), and
 *  the metronome quick bar. */
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
          onOpenWarmups={vi.fn()}
          onOpenCalendar={vi.fn()}
          onOpenPiecePlan={vi.fn()}
          onOpenBrain={vi.fn()}
          onOpenLedger={vi.fn()}
          onOpenUniverse={vi.fn()}
          onOpenSettings={vi.fn()}
          // This suite exercises the full main menu, including the Assistant
          // entry; Christian's 2026-08-24 request flipped its real default
          // to off, so tests that need it explicitly opt back in.
          assistantEnabled
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

    // App mark, date, and quiet entries. The former bundled-book quote and
    // reader surfaces are deliberately absent.
    expect(screen.getByText("Praelude")).toBeTruthy();
    expect(screen.queryByTestId("today-menu-quote")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Reader" })).toBeNull();
    for (const label of [
      "Today's Practice",
      "Score",
      "Warmups",
      "Assistant",
      "Pieces",
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
    fireEvent.click(screen.getByRole("button", { name: "Pieces" }));
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
