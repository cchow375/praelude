import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { ReadOnlyDaySheet } from "./ReadOnlyDaySheet";

const PAST_DAY = "2026-01-15";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ReceiptCenterProvider, null, children);
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

describe("ReadOnlyDaySheet (spec A7)", () => {
  it("renders a quiet read-only caption with the browsed date", async () => {
    render(<ReadOnlyDaySheet date={PAST_DAY} />, { wrapper });
    await screen.findByTestId("read-only-day-sheet");
    expect(screen.getByTestId("read-only-caption").textContent).toMatch(
      /read-only/i,
    );
  });

  it("renders an empty page for a date the backend has no row for — never seeds one", async () => {
    const spy = spyInvoke();
    render(<ReadOnlyDaySheet date={PAST_DAY} />, { wrapper });
    await screen.findByTestId("read-only-empty");
    expect(spy.mock.calls.some(([cmd]) => cmd === "day_sheet_save")).toBe(
      false,
    );
  });

  it("renders saved lines as inert text — no editable controls", async () => {
    await internals().invoke("day_sheet_save", {
      date: PAST_DAY,
      bodyJson: JSON.stringify([
        { type: "text", text: "scales and arpeggios" },
        { type: "item", text: "measure 12 run", checked: true },
      ]),
    });

    render(<ReadOnlyDaySheet date={PAST_DAY} />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText("scales and arpeggios")).toBeTruthy(),
    );
    expect(screen.getByText("measure 12 run")).toBeTruthy();

    // Nothing on the read-only page is a text input / textarea / editable
    // checkbox — the whole surface is inert.
    expect(document.querySelectorAll("textarea, input").length).toBe(0);
  });

  it("never invokes day_sheet_save no matter how it is rendered", async () => {
    const spy = spyInvoke();
    render(<ReadOnlyDaySheet date={PAST_DAY} />, { wrapper });
    await screen.findByTestId("read-only-day-sheet");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(spy.mock.calls.some(([cmd]) => cmd === "day_sheet_save")).toBe(
      false,
    );
  });
});

describe("ReadOnlyDaySheet plan total (spec A9)", () => {
  it("shows the static sum of block minutes plus unchecked item count", async () => {
    await internals().invoke("day_sheet_save", {
      date: PAST_DAY,
      bodyJson: JSON.stringify([
        { type: "block", minutes: 25 },
        { type: "block", minutes: 50 },
        { type: "item", text: "measure 12 run", checked: false },
        { type: "item", text: "scales", checked: true },
        { type: "item", text: "sight read", checked: false },
      ]),
    });
    render(<ReadOnlyDaySheet date={PAST_DAY} />, { wrapper });
    await waitFor(() =>
      expect(
        screen.getByText("Σ 75 min planned · 2 lines unestimated"),
      ).toBeTruthy(),
    );
  });

  it("excludes checked items from the unestimated count", async () => {
    await internals().invoke("day_sheet_save", {
      date: PAST_DAY,
      bodyJson: JSON.stringify([
        { type: "block", minutes: 10 },
        { type: "item", text: "scales", checked: true },
      ]),
    });
    render(<ReadOnlyDaySheet date={PAST_DAY} />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText("Σ 10 min planned")).toBeTruthy(),
    );
    expect(screen.queryByText(/unestimated/)).toBeNull();
  });

  it("renders no total at all for an empty sheet", async () => {
    render(<ReadOnlyDaySheet date={PAST_DAY} />, { wrapper });
    await screen.findByTestId("read-only-empty");
    expect(screen.queryByText(/planned/)).toBeNull();
  });
});
