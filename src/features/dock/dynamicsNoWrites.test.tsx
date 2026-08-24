import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/**
 * THE zero-write proof for target mode (spec Plan B4: no verdict writes, no
 * streak effects).
 *
 * Every command the app can reach goes through this ONE spy. If any dynamics
 * code path ever calls a practice-mutating command — or ANY command outside
 * the dynamics six — this test fails loudly.
 */

// `vi.mock` factories are hoisted above every top-level binding, so the spy and
// the event hook are created inside `vi.hoisted` — otherwise the factory closes
// over a TDZ reference.
const { invokeSpy, emit } = vi.hoisted(() => {
  const profile = {
    id: 1,
    device_id: "default-input",
    label: "Steinway",
    active: true,
    created_at: "2026-08-23T10:00:00Z",
    points: [
      { dynamic_label: "pp", measured_db: -48 },
      { dynamic_label: "p", measured_db: -38 },
      { dynamic_label: "mf", measured_db: -28 },
      { dynamic_label: "f", measured_db: -18 },
      { dynamic_label: "ff", measured_db: -9 },
    ],
  };
  return {
    invokeSpy: vi.fn(async (cmd: string) => {
      if (cmd === "dynamics_meter_state" || cmd === "dynamics_meter_start")
        return { running: true, has_input_device: true };
      if (cmd === "dynamics_meter_stop")
        return { running: false, has_input_device: true };
      if (cmd === "dynamics_profile_list") return [profile];
      return null;
    }),
    emit: { fn: null as null | ((e: { payload: unknown }) => void) },
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeSpy }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_n: string, cb: (e: { payload: unknown }) => void) => {
    emit.fn = cb;
    return () => {
      emit.fn = null;
    };
  }),
}));

import { DockProvider } from "./DockProvider";
import { DynamicsPanel } from "./DynamicsPanel";
import { DOCK_STORAGE_KEY } from "./dockState";

/** Everything that appends practice truth or mutates a practice row. Sourced
 * from the real command surface (lib.rs generate_handler!). */
const FORBIDDEN = [
  "rep_check",
  "rep_undo",
  "rep_correct",
  "rep_restart",
  "rep_pause",
  "rep_resume",
  "rep_close",
  "rep_open",
  "rep_adjustment_reverse",
  "sets_paused_list",
  "session_current",
  "session_end",
  "goal_update",
  "day_sheet_save",
  "piece_intake_save",
  "calendar_capacity_set",
  "daily_work_create",
  "daily_work_update",
  "daily_work_delete",
  "recovery_apply",
];

/** The ONLY commands any dynamics code path may ever call. */
const ALLOWED = new Set([
  "dynamics_meter_start",
  "dynamics_meter_stop",
  "dynamics_meter_state",
  "dynamics_profile_list",
  "dynamics_profile_save",
  "dynamics_profile_activate",
]);

function DynamicsPanelHarness() {
  return (
    <DockProvider>
      <DynamicsPanel />
    </DockProvider>
  );
}

beforeEach(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    },
  });
  window.localStorage.setItem(
    DOCK_STORAGE_KEY,
    JSON.stringify({
      dynamics: { x: 160, y: 108, z: 1, flashing: false, open: true, minimized: false },
    }),
  );
  invokeSpy.mockClear();
  emit.fn = null;
});

afterEach(() => cleanup());

function feed(count: number, rms_db: number, peak_db: number, baseMs: number) {
  for (let i = 0; i < count; i += 1) {
    act(() =>
      emit.fn!({
        payload: { rms_db, peak_db, ts_ms: baseMs + i * 125 },
      }),
    );
  }
}

describe("dynamics target mode writes NOTHING (spec Plan B4: no verdict writes, no streak effects)", () => {
  it("appends zero events and mutates zero practice rows across the whole target-mode flow", async () => {
    render(<DynamicsPanelHarness />);
    await waitFor(() => expect(emit.fn).not.toBeNull());
    await waitFor(() =>
      expect(screen.getByTestId("dynamics-band")).toBeTruthy(),
    );

    // Open target mode, pick a single dynamic, run three full traces.
    fireEvent.click(screen.getByRole("button", { name: /target mode/i }));
    fireEvent.click(screen.getByRole("button", { name: /^mf$/ }));
    for (let t = 0; t < 3; t++) feed(24, -28, -20, t * 3000);
    await waitFor(() =>
      expect(screen.getAllByTestId("landed-marker").length).toBe(3),
    );

    // Then a crescendo range, and turning target mode back off.
    fireEvent.click(screen.getByRole("button", { name: /crescendo/i }));
    fireEvent.click(screen.getByRole("button", { name: /^p$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^f$/ }));
    feed(24, -20, -14, 9000);
    await waitFor(() =>
      expect(screen.getAllByTestId("landed-marker").length).toBe(1),
    );
    fireEvent.click(screen.getByRole("button", { name: /target mode/i }));
    expect(screen.queryAllByTestId("landed-marker")).toHaveLength(0);

    const called = invokeSpy.mock.calls.map(([cmd]) => cmd as string);
    for (const forbidden of FORBIDDEN) {
      expect(
        called,
        `target mode must never invoke ${forbidden}`,
      ).not.toContain(forbidden);
    }
    // Stronger: the ONLY commands the panel may ever call are the dynamics six.
    for (const cmd of called) {
      expect(
        ALLOWED.has(cmd),
        `unexpected command from dynamics code: ${cmd}`,
      ).toBe(true);
    }
    // And target mode itself invokes NOTHING beyond the mount-time calls.
    expect(called.filter((c) => c === "dynamics_profile_save")).toHaveLength(0);
    expect(called.filter((c) => c === "dynamics_profile_activate")).toHaveLength(
      0,
    );
  });

  it("touches no persistent storage other than the dock's own panel geometry", async () => {
    const written: string[] = [];
    const realSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = (key: string, value: string) => {
      written.push(key);
      realSetItem(key, value);
    };

    render(<DynamicsPanelHarness />);
    await waitFor(() => expect(emit.fn).not.toBeNull());
    await waitFor(() =>
      expect(screen.getByTestId("dynamics-band")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /target mode/i }));
    fireEvent.click(screen.getByRole("button", { name: /^mf$/ }));
    feed(24, -28, -20, 0);
    await waitFor(() =>
      expect(screen.getAllByTestId("landed-marker").length).toBe(1),
    );

    for (const key of written) {
      expect(key, `unexpected storage write: ${key}`).toBe(DOCK_STORAGE_KEY);
    }
  });
});
