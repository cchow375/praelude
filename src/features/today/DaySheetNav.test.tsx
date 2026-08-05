import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { TodaySheetProvider } from "../notebook/DaySheetStore";
import { addDays, dayLabel, todayLocal } from "../calendar/dates";
import { DaySheetNav } from "./DaySheetNav";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    ReceiptCenterProvider,
    null,
    createElement(TodaySheetProvider, null, children),
  );
}

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

describe("DaySheetNav carry-forward (spec A8)", () => {
  const PAST_DAY = addDays(todayLocal(), -1);

  async function seedPastDay() {
    await internals().invoke("day_sheet_save", {
      date: PAST_DAY,
      bodyJson: JSON.stringify([
        { type: "item", text: "measure 12 run", checked: false },
        { type: "item", text: "scales", checked: true },
        { type: "block", minutes: 20 },
      ]),
    });
  }

  it('shows "→ today" only on unchecked items and on blocks, never on a checked item', async () => {
    await seedPastDay();
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByTestId("read-only-day-sheet");

    const carryButtons = screen.getAllByTestId("carry-to-today");
    // One for the unchecked item, one for the block — none for the checked item.
    expect(carryButtons).toHaveLength(2);
  });

  it("carrying an unchecked item appends it unchecked, suffixed, to TODAY's sheet — and only today's date is ever saved", async () => {
    await seedPastDay();
    const spy = spyInvoke();
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByTestId("read-only-day-sheet");

    const [carryButton] = screen.getAllByTestId("carry-to-today");
    fireEvent.click(carryButton);
    await waitFor(() => expect(carryButton.textContent).toMatch(/added/i));

    // Only TODAY's date is ever the target of a day_sheet_save — the past
    // sheet itself is never written.
    await waitFor(() => {
      const saveCalls = spy.mock.calls.filter(
        ([cmd]) => cmd === "day_sheet_save",
      );
      expect(saveCalls.length).toBeGreaterThan(0);
      for (const [, args] of saveCalls) {
        expect((args as { date: string }).date).toBe(todayLocal());
      }
    });

    const today = await internals().invoke("day_sheet_get", {
      date: todayLocal(),
    });
    const body = (today as { body: Array<Record<string, unknown>> }).body;
    const carried = body.find(
      (line) =>
        line.type === "item" &&
        typeof line.text === "string" &&
        (line.text as string).startsWith("measure 12 run"),
    );
    expect(carried).toEqual({
      type: "item",
      text: `measure 12 run · from ${dayLabel(PAST_DAY).date}`,
      checked: false,
    });
  });

  it("the past sheet is byte-identical after a carry", async () => {
    await seedPastDay();
    const before = await internals().invoke("day_sheet_get", {
      date: PAST_DAY,
    });

    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByTestId("read-only-day-sheet");
    const [carryButton] = screen.getAllByTestId("carry-to-today");
    fireEvent.click(carryButton);
    await waitFor(() => expect(carryButton.textContent).toMatch(/added/i));

    const after = await internals().invoke("day_sheet_get", { date: PAST_DAY });
    expect((after as { body: unknown }).body).toEqual(
      (before as { body: unknown }).body,
    );
  });

  it("carrying the same source line twice appends it twice — no dedup", async () => {
    await seedPastDay();
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByTestId("read-only-day-sheet");

    const [carryButton] = screen.getAllByTestId("carry-to-today");
    fireEvent.click(carryButton);
    await waitFor(() => expect(carryButton.textContent).toMatch(/added/i));

    // Leave and re-enter the past day: a fresh mount of the read-only sheet
    // (keyed on viewDate), so the affordance is not stuck "added" forever.
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await screen.findByTestId("day-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByTestId("read-only-day-sheet");
    const [secondCarryButton] = screen.getAllByTestId("carry-to-today");
    fireEvent.click(secondCarryButton);
    await waitFor(() =>
      expect(secondCarryButton.textContent).toMatch(/added/i),
    );

    await waitFor(async () => {
      const today = await internals().invoke("day_sheet_get", {
        date: todayLocal(),
      });
      const body = (today as { body: Array<Record<string, unknown>> }).body;
      const carriedCopies = body.filter(
        (line) =>
          line.type === "item" &&
          typeof line.text === "string" &&
          (line.text as string).startsWith("measure 12 run"),
      );
      expect(carriedCopies).toHaveLength(2);
    });
  });

  it("two rapid carries (no wait between clicks) both persist — a flush racing an in-flight save must not drop the second edit", async () => {
    await internals().invoke("day_sheet_save", {
      date: PAST_DAY,
      bodyJson: JSON.stringify([
        { type: "item", text: "alpha task", checked: false },
        { type: "item", text: "beta task", checked: false },
      ]),
    });
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByTestId("read-only-day-sheet");

    const [alphaButton, betaButton] = screen.getAllByTestId("carry-to-today");
    // No waitFor between these two clicks: the second carry's flush() can
    // land while the first carry's save is still in flight.
    fireEvent.click(alphaButton);
    fireEvent.click(betaButton);

    await waitFor(async () => {
      const today = await internals().invoke("day_sheet_get", {
        date: todayLocal(),
      });
      const body = (today as { body: Array<Record<string, unknown>> }).body;
      const texts = body
        .filter((line) => line.type === "item")
        .map((line) => line.text);
      expect(texts).toContain(`alpha task · from ${dayLabel(PAST_DAY).date}`);
      expect(texts).toContain(`beta task · from ${dayLabel(PAST_DAY).date}`);
    });
  });

  it("carrying a block line appends it verbatim, with minutes unchanged", async () => {
    await seedPastDay();
    render(<DaySheetNav />, { wrapper });
    await screen.findByTestId("day-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByTestId("read-only-day-sheet");

    const carryButtons = screen.getAllByTestId("carry-to-today");
    // Second carry button belongs to the block line (item, then block).
    fireEvent.click(carryButtons[1]);
    await waitFor(() => expect(carryButtons[1].textContent).toMatch(/added/i));

    await waitFor(async () => {
      const today = await internals().invoke("day_sheet_get", {
        date: todayLocal(),
      });
      const body = (today as { body: Array<Record<string, unknown>> }).body;
      expect(body).toContainEqual({ type: "block", minutes: 20 });
    });
  });
});
