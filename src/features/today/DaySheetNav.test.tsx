import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { TodaySheetProvider } from "../notebook/DaySheetStore";
import { todayLocal } from "../calendar/dates";
import { DaySheetNav } from "./DaySheetNav";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    ReceiptCenterProvider,
    null,
    createElement(TodaySheetProvider, null, children),
  );
}

beforeEach(() => {
  installTauriDevMock();
});
afterEach(() => {
  cleanup();
  uninstallTauriDevMock();
});

describe("DaySheetNav (spec A7)", () => {
  it("opens on today's LIVE sheet, with the next-day arrow disabled", async () => {
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");
    expect(screen.queryByTestId("read-only-day-sheet")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Next day" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    // No "Today" jump control while already viewing today.
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
  });

  it("navigates back a day to a read-only sheet, forward is re-enabled", async () => {
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");

    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));

    await screen.findByTestId("read-only-day-sheet");
    expect(screen.queryByTestId("day-sheet")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Next day" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
  });

  it('the "Today" jump returns to the live sheet and hides itself again', async () => {
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");

    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByTestId("read-only-day-sheet");

    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    await screen.findByTestId("day-sheet");
    expect(screen.queryByTestId("read-only-day-sheet")).toBeNull();
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Next day" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("never navigates into the future — the next-day arrow stays disabled at today", async () => {
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");
    // Clicking a disabled button fires no click handler in the DOM; assert it
    // stays on today's live sheet regardless.
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByTestId("day-sheet")).toBeTruthy();
  });

  it("the date label reflects the browsed date, not always today", async () => {
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");
    const todayText = screen.getByTestId("day-sheet-nav-label").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByTestId("read-only-day-sheet");
    const yesterdayText = screen.getByTestId("day-sheet-nav-label").textContent;

    expect(yesterdayText).not.toBe(todayText);
  });

  it("every nav control is a real, keyboard-reachable <button>", async () => {
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");
    for (const name of ["Previous day", "Next day"]) {
      const el = screen.getByRole("button", { name });
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("type")).toBe("button");
    }
  });

  it("keeps a caption with the browsed date on the read-only sheet, never on today", async () => {
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");
    expect(screen.queryByTestId("read-only-caption")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByTestId("read-only-day-sheet");
    expect(screen.getByTestId("read-only-caption").textContent).toMatch(
      /read-only/i,
    );
    expect(screen.getByTestId("read-only-caption").textContent).not.toMatch(
      new RegExp(todayLocal()),
    );
  });
});
