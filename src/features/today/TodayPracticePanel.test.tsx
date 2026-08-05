import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

// The re-housed Today's-Practice window is day-sheet-first (spec C5). These tests
// drive it through the REAL invoke seam against the dev-mock's stateful notebook
// + retention backend, so the "suggested from retention" insert lands as real
// plan lines on the same sheet, and the shell-owned HUD stays reachable.
import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { TodaySheetProvider } from "../notebook/DaySheetStore";
import { TodayPracticePanel } from "./TodayPracticePanel";

interface Internals {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
}
function internals(): Internals {
  return (window as unknown as { __TAURI_INTERNALS__: Internals })
    .__TAURI_INTERNALS__;
}

function spyInvoke() {
  const seam = internals();
  const original = seam.invoke.bind(seam);
  const spy = vi.fn((cmd: string, args?: unknown) => original(cmd, args));
  seam.invoke = spy;
  return spy;
}

function renderPanel(
  props: Partial<Parameters<typeof TodayPracticePanel>[0]> = {},
) {
  function Harness({ children }: { children: ReactNode }) {
    return createElement(
      ReceiptCenterProvider,
      null,
      createElement(TodaySheetProvider, null, children),
    );
  }
  return render(
    <TodayPracticePanel
      onOpenAtlas={vi.fn()}
      onOpenCalendar={vi.fn()}
      onOpenPiecePlan={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
    { wrapper: Harness },
  );
}

beforeEach(() => {
  installTauriDevMock();
});
afterEach(() => {
  cleanup();
  uninstallTauriDevMock();
  vi.useRealTimers();
});

describe("TodayPracticePanel — day-sheet-first window (spec C5)", () => {
  it("puts the day sheet first and mounts the metronome quick bar in the header", async () => {
    renderPanel();

    const dialog = await screen.findByRole("region", {
      name: "Today's Practice",
    });
    // The day sheet is the surface.
    expect(within(dialog).getByTestId("day-sheet")).toBeTruthy();
    // The metronome quick bar is mounted in the window (requirement 3).
    expect(
      within(dialog).getByRole("group", { name: "Metronome quick controls" }),
    ).toBeTruthy();
  });

  it("no longer hosts the active-set HUD (Task A3: it moved to the shell-level Practice Dock)", async () => {
    // The old docked strip (TodayPracticePanel.tsx ~136-143) is gone entirely —
    // no legacy fallback rendering. TodayPracticePanelProps no longer even
    // accepts an `activeSetHud` prop to render one through.
    renderPanel();
    await screen.findByRole("region", { name: "Today's Practice" });
    expect(screen.queryByTestId("today-practice-hud")).toBeNull();
  });

  it("does not fetch composer candidates until the suggested fold is opened", async () => {
    const spy = spyInvoke();
    renderPanel();
    await screen.findByRole("region", {
      name: "Today's Practice",
    });

    // Collapsed fold = static summary text only; the 1+2N candidate fetch
    // (pieces_list per piece: region_list + rep_blocks_for_piece) must not fire.
    const candidateCalls = () =>
      spy.mock.calls.filter(([cmd]) =>
        ["region_list", "rep_blocks_for_piece"].includes(cmd as string),
      ).length;
    expect(candidateCalls()).toBe(0);

    const details = screen
      .getByText("Suggested from retention")
      .closest("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));

    // Opening the fold is what triggers the fetch.
    await waitFor(() => expect(candidateCalls()).toBeGreaterThan(0));
  });

  it("inserts a retention suggestion as real plan lines on the same sheet (spec C5)", async () => {
    const spy = spyInvoke();
    renderPanel();

    await screen.findByRole("region", {
      name: "Today's Practice",
    });

    // Open the single quiet "suggested from retention" fold. jsdom does not run
    // the native <details> click→toggle, so open it explicitly and dispatch the
    // toggle the component listens for.
    const details = screen
      .getByText("Suggested from retention")
      .closest("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));

    // The dev-mock surfaces the due retention check for "Opening theme" (4 min)
    // first; add that one.
    const add = (
      await screen.findAllByRole("button", {
        name: "Add to today",
      })
    )[0];
    spy.mockClear();
    fireEvent.click(add);

    // The suggestion becomes an editable checkbox item + a timed block whose
    // minutes re-total the sheet header (the dev-mock due check is 4 minutes).
    await waitFor(() =>
      expect(screen.getByLabelText("4 minutes planned")).toBeTruthy(),
    );
    expect(screen.getByDisplayValue("Opening theme")).toBeTruthy();

    // The insert is a plain sheet edit — it never writes practice truth.
    await waitFor(() =>
      expect(spy.mock.calls.some(([cmd]) => cmd === "day_sheet_save")).toBe(
        true,
      ),
    );
    const forbidden = spy.mock.calls
      .map(([cmd]) => String(cmd))
      .filter((cmd) =>
        /^(rep_|attempt|set_|retention_(confirm|record)|block_)/.test(cmd),
      );
    expect(forbidden).toEqual([]);
  });

  it("closes on Escape and on the × control", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    const dialog = await screen.findByRole("region", {
      name: "Today's Practice",
    });

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Close Today's Practice" }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
