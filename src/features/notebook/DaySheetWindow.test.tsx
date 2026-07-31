import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

// DaySheetWindow composes the REAL <DaySheet> (its own standalone store), so —
// like DaySheet.test.tsx and useDaySheet.test.ts — this suite drives it through
// the real invoke path against the dev-mock's stateful notebook backend rather
// than stubbing DaySheet out. That is the only way to prove the window actually
// wires `date` and `onOpenPiece` through to a live child, not just its own chrome.
import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { dayLabel } from "../calendar/dates";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { DaySheetWindow } from "./DaySheetWindow";
import type { NotebookLine } from "./lines";

const DATE = "2026-03-10"; // never "today", so the legacy migration never fires
// A date whose previous day is also empty — the DaySheet blank state, with no
// "copy yesterday" affordance to complicate the composed-body assertion.
const LONELY_DATE = "2026-05-20";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ReceiptCenterProvider, null, children);
}

function renderWindow(
  date = LONELY_DATE,
  onClose = vi.fn(),
  onOpenPiece?: (id: number) => void,
) {
  const view = render(
    <DaySheetWindow date={date} onClose={onClose} onOpenPiece={onOpenPiece} />,
    { wrapper },
  );
  return { ...view, onClose };
}

interface Internals {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
}
function internals(): Internals {
  return (window as unknown as { __TAURI_INTERNALS__: Internals })
    .__TAURI_INTERNALS__;
}

/** Pre-store a sheet so a render loads it (the backend already has the row). */
async function seedSheet(date: string, lines: NotebookLine[]) {
  await internals().invoke("day_sheet_save", {
    date,
    bodyJson: JSON.stringify(lines),
  });
}

/** Flush the rAF the window uses to focus its close button on mount. */
async function flushFocusFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

beforeEach(() => {
  installTauriDevMock();
});

afterEach(() => {
  cleanup();
  uninstallTauriDevMock();
  vi.useRealTimers();
});

describe("DaySheetWindow — chrome", () => {
  it("renders a labeled dialog for the given date and composes the DaySheet body", async () => {
    renderWindow(LONELY_DATE);
    const label = dayLabel(LONELY_DATE);

    const dialog = screen.getByTestId("day-sheet-window");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe(
      `Day sheet — ${label.weekday} ${label.date}`,
    );
    expect(screen.getByRole("heading", { name: "Day sheet" })).toBeTruthy();
    expect(screen.getByText(`${label.weekday} · ${label.date}`)).toBeTruthy();

    // Proves the STANDALONE DaySheet for `date` is actually mounted inside,
    // not just the window's own chrome.
    await screen.findByTestId("day-sheet-blank");
  });

  it("focuses the close button on mount", async () => {
    renderWindow(LONELY_DATE);
    const close = screen.getByRole("button", { name: "Close day sheet" });
    await flushFocusFrame();
    expect(document.activeElement).toBe(close);
  });
});

describe("DaySheetWindow — closing", () => {
  it("calls onClose when the × is clicked", async () => {
    const { onClose } = renderWindow(LONELY_DATE);
    await screen.findByTestId("day-sheet-blank");
    fireEvent.click(screen.getByRole("button", { name: "Close day sheet" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape within the dialog", async () => {
    const { onClose } = renderWindow(LONELY_DATE);
    await screen.findByTestId("day-sheet-blank");
    fireEvent.keyDown(screen.getByTestId("day-sheet-window"), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose for a non-Escape key", async () => {
    const { onClose } = renderWindow(LONELY_DATE);
    await screen.findByTestId("day-sheet-blank");
    fireEvent.keyDown(screen.getByTestId("day-sheet-window"), {
      key: "Enter",
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("DaySheetWindow — onOpenPiece wiring", () => {
  it("forwards a piece-heading click from the composed DaySheet to onOpenPiece", async () => {
    await seedSheet(DATE, [{ type: "piece", piece_id: 1 }]);
    const onOpenPiece = vi.fn();
    renderWindow(DATE, vi.fn(), onOpenPiece);

    const heading = await screen.findByRole("button", {
      name: "Scherzo No. 2",
    });
    fireEvent.click(heading);
    expect(onOpenPiece).toHaveBeenCalledWith(1);
  });

  it("renders without error when onOpenPiece is omitted (optional prop)", async () => {
    await seedSheet(DATE, [{ type: "piece", piece_id: 1 }]);
    renderWindow(DATE, vi.fn(), undefined);

    const heading = await screen.findByRole("button", {
      name: "Scherzo No. 2",
    });
    // TODO: assert this doesn't throw when clicked with no onOpenPiece wired.
    fireEvent.click(heading);
  });
});

describe("DaySheetWindow — standalone store (not today's shared sheet)", () => {
  it("loads and edits the given date's own sheet independent of another date", async () => {
    // TODO: seed DATE and a different date with distinct lines, render each,
    // and assert edits to one never leak into the other (spec C1/C3 contract:
    // "a past day is a different document from today's shared sheet").
  });
});
