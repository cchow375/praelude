import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";

// This suite deliberately does NOT mock "@tauri-apps/api/*": it drives the hook
// through the REAL invoke path against the dev-mock's stateful notebook backend,
// so load/save/reconcile/migration are exercised end-to-end.
import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { todayLocal } from "../calendar/dates";
import { readTodayPlan, writeTodayPlan } from "../today/todayPlan";
import { useDaySheet } from "./useDaySheet";
import type { NotebookLine } from "./lines";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ReceiptCenterProvider, null, children);
}

const OTHER_DAY = "2026-01-15"; // never "today", so migration never fires here

beforeEach(() => {
  installTauriDevMock();
  // A fresh Map-backed localStorage each test (this env has no built-in one),
  // matching the shim the Today workspace tests use, so the migration path is
  // exercised deterministically.
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
});

afterEach(() => {
  cleanup();
  uninstallTauriDevMock();
  vi.useRealTimers();
});

describe("useDaySheet — load / reconcile / migration", () => {
  it("renders a blank sheet for a date the backend has no row for", async () => {
    const { result } = renderHook(() => useDaySheet(OTHER_DAY), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.body).toEqual([]);
    expect(result.current.updatedAt).toBeNull();
  });

  // Bite: the caller sent an item with NO `checked`; the backend canonicalizes
  // it to `checked:false`; the editor must reconcile to that canonical body. If
  // the returned-body reconcile were dropped, `body[0]` would lack `checked`.
  it("reconciles editor state from the canonical body the save returns", async () => {
    const { result } = renderHook(() => useDaySheet(OTHER_DAY), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.setBody([
        { type: "item", text: "octave run" } as unknown as NotebookLine,
      ]);
    });
    await waitFor(() => expect(result.current.updatedAt).not.toBeNull());

    expect(result.current.body).toEqual([
      { type: "item", text: "octave run", checked: false },
    ]);
    expect(result.current.error).toBeNull();
  });

  it("persists across a fresh mount for the same date", async () => {
    const first = renderHook(() => useDaySheet(OTHER_DAY), { wrapper });
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    act(() => {
      first.result.current.setBody([{ type: "text", text: "scales first" }]);
    });
    await waitFor(() => expect(first.result.current.updatedAt).not.toBeNull());
    first.unmount();

    const second = renderHook(() => useDaySheet(OTHER_DAY), { wrapper });
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(second.result.current.body).toEqual([
      { type: "text", text: "scales first" },
    ]);
  });

  it("flushes a pending edit on unmount", async () => {
    const first = renderHook(() => useDaySheet(OTHER_DAY), { wrapper });
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    act(() => {
      first.result.current.setBody([
        { type: "text", text: "unsaved keystroke" },
      ]);
    });
    // Unmount BEFORE the ~600ms debounce would have fired.
    first.unmount();

    const second = renderHook(() => useDaySheet(OTHER_DAY), { wrapper });
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(second.result.current.body).toEqual([
      { type: "text", text: "unsaved keystroke" },
    ]);
  });

  it("migrates the legacy todayPlan into today's sheet exactly once", async () => {
    const today = todayLocal();
    writeTodayPlan(today, "carried practice note");

    const first = renderHook(() => useDaySheet(today), { wrapper });
    await waitFor(() => expect(first.result.current.status).toBe("ready"));

    // Seeded as a single text line, and the legacy key is retired.
    expect(first.result.current.body).toEqual([
      { type: "text", text: "carried practice note" },
    ]);
    expect(first.result.current.updatedAt).not.toBeNull();
    expect(readTodayPlan(today)).toBe("");
    first.unmount();

    // A stray new legacy value must NOT overwrite the existing sheet: the sheet
    // now exists, so migration is skipped on the next open.
    writeTodayPlan(today, "SHOULD NOT APPEAR");
    const second = renderHook(() => useDaySheet(today), { wrapper });
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(second.result.current.body).toEqual([
      { type: "text", text: "carried practice note" },
    ]);
  });

  it("does not migrate when there is no legacy value", async () => {
    const today = todayLocal();
    const { result } = renderHook(() => useDaySheet(today), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.body).toEqual([]);
    expect(result.current.updatedAt).toBeNull();
  });

  it("surfaces a malformed-body rejection as an honest error state + receipt", async () => {
    const { result } = renderHook(() => useDaySheet(OTHER_DAY), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.setBody([{ type: "bogus" } as unknown as NotebookLine]);
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/unknown notebook line type: bogus/);
    // The failure is announced assertively, not swallowed.
    expect(screen.getByRole("alert").textContent).toMatch(
      /unknown notebook line type: bogus/,
    );
  });
});

describe("useDaySheet — readOnly (spec A7)", () => {
  function seamInvoke(): {
    invoke: (cmd: string, args?: unknown) => Promise<unknown>;
  } {
    return (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
  }

  function spyInvoke() {
    const internals = seamInvoke();
    const original = internals.invoke.bind(internals);
    const spy = vi.fn((cmd: string, args?: unknown) => original(cmd, args));
    internals.invoke = spy;
    return spy;
  }

  it("renders an existing sheet read-only, with no autosave mounted", async () => {
    // Seed the backend directly (bypassing the hook) so this proves the
    // read-only path only READS — it must never itself have written this.
    await seamInvoke().invoke("day_sheet_save", {
      date: OTHER_DAY,
      bodyJson: JSON.stringify([
        { type: "text", text: "yesterday's practice" },
      ]),
    });

    const spy = spyInvoke();
    const { result } = renderHook(
      () => useDaySheet(OTHER_DAY, { readOnly: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.body).toEqual([
      { type: "text", text: "yesterday's practice" },
    ]);

    // An attempted edit is a no-op — read-only never writes.
    act(() => {
      result.current.setBody([{ type: "text", text: "tampered" }]);
    });
    result.current.flush();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(spy.mock.calls.some(([cmd]) => cmd === "day_sheet_save")).toBe(
      false,
    );
  });

  it("renders an empty read-only sheet for a date with no row — never seeds one", async () => {
    const spy = spyInvoke();
    const { result } = renderHook(
      () => useDaySheet("2026-02-02", { readOnly: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.body).toEqual([]);
    expect(result.current.updatedAt).toBeNull();

    expect(spy.mock.calls.some(([cmd]) => cmd === "day_sheet_save")).toBe(
      false,
    );
  });

  it("never runs the legacy todayPlan migration in read-only mode, even for today's date", async () => {
    const today = todayLocal();
    writeTodayPlan(today, "should never be seeded read-only");

    const spy = spyInvoke();
    const { result } = renderHook(
      () => useDaySheet(today, { readOnly: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // A blank read-only page, NOT a seeded migration — and the legacy value
    // is left untouched (retiring it is a live-path-only side effect).
    expect(result.current.body).toEqual([]);
    expect(readTodayPlan(today)).toBe("should never be seeded read-only");
    expect(spy.mock.calls.some(([cmd]) => cmd === "day_sheet_save")).toBe(
      false,
    );
  });

  it("does not migrate a legacy value stored under a non-today date, even in live mode", async () => {
    // Regression (spec A7): migration must fire ONLY when viewing today —
    // a legacy value that happens to be keyed under a past date must never
    // seed that past date's sheet, live or read-only.
    writeTodayPlan(OTHER_DAY, "stray legacy value for a past date");

    const { result } = renderHook(() => useDaySheet(OTHER_DAY), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.body).toEqual([]);
    expect(result.current.updatedAt).toBeNull();
    // The legacy value is left alone — only a TODAY migration retires it.
    expect(readTodayPlan(OTHER_DAY)).toBe("stray legacy value for a past date");
  });
});

describe("useDaySheet — debounce + flush timing", () => {
  it("waits ~600ms to save, and flush() persists immediately", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDaySheet(OTHER_DAY), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.updatedAt).toBeNull();

    // Debounced: no save before the window elapses.
    act(() => {
      result.current.setBody([{ type: "text", text: "x" }]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(result.current.updatedAt).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.updatedAt).not.toBeNull();
    const firstSavedAt = result.current.updatedAt;

    // A new edit + flush persists at once, without waiting out the 600ms.
    act(() => {
      result.current.setBody([{ type: "text", text: "y" }]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10); // move the clock; still < 600ms
    });
    expect(result.current.updatedAt).toBe(firstSavedAt); // debounce hasn't fired
    act(() => {
      result.current.flush();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.body).toEqual([{ type: "text", text: "y" }]);
    expect(result.current.updatedAt).not.toBe(firstSavedAt);
  });
});
