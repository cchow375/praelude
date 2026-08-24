import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

// Plan B (task B3): the dynamics dock panel. The Tauri seam is stubbed at
// `@tauri-apps/api` (the ClockPanel/useMetronome convention), so the panel is
// exercised against the real dock framework with a hand-driven level stream.

const calls: string[] = [];
const listeners = new Map<string, (e: { payload: unknown }) => void>();

const PROFILE = {
  id: 1,
  device_id: "default-input",
  label: "Steinway, living room, lid half",
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

let profiles: unknown[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    calls.push(cmd);
    if (cmd === "dynamics_meter_state")
      return { running: true, has_input_device: true };
    if (cmd === "dynamics_meter_start")
      return { running: true, has_input_device: true };
    if (cmd === "dynamics_meter_stop")
      return { running: false, has_input_device: true };
    if (cmd === "dynamics_profile_list") return profiles;
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    listeners.set(name, cb);
    return () => listeners.delete(name);
  }),
}));

import { DockProvider } from "./DockProvider";
import { DynamicsPanel } from "./DynamicsPanel";
import { DOCK_STORAGE_KEY } from "./dockState";

function seedDynamicsPanel(state: { open: boolean; minimized: boolean }) {
  window.localStorage.setItem(
    DOCK_STORAGE_KEY,
    JSON.stringify({
      dynamics: { x: 160, y: 108, z: 1, flashing: false, ...state },
    }),
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
  calls.length = 0;
  listeners.clear();
  profiles = [];
});

afterEach(() => cleanup());

function renderPanel() {
  return render(
    <DockProvider>
      <DynamicsPanel />
    </DockProvider>,
  );
}

function emitLevel(rms_db: number, peak_db: number) {
  act(() => {
    listeners.get("dynamics://level")?.({
      payload: { rms_db, peak_db, ts_ms: 1 },
    });
  });
}

describe("DynamicsPanel", () => {
  it("shows raw dBFS and a Calibrate call-to-action when uncalibrated", async () => {
    seedDynamicsPanel({ open: true, minimized: false });
    renderPanel();
    await waitFor(() => expect(listeners.has("dynamics://level")).toBe(true));
    emitLevel(-28.4, -19.2);

    await waitFor(() =>
      expect(screen.getByTestId("dynamics-readout").textContent).toBe(
        "-28.4 dB",
      ),
    );
    expect(screen.queryByTestId("dynamics-band")).toBeNull();
    expect(
      screen.getByRole("button", { name: /^calibrate$/i }),
    ).toBeTruthy();
    expect(screen.getByTestId("dynamics-profile").textContent).toBe(
      "Not calibrated",
    );
  });

  it("renders a pp..ff band scaled from the active profile's measured levels", async () => {
    profiles = [PROFILE];
    seedDynamicsPanel({ open: true, minimized: false });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("dynamics-band")).toBeTruthy());
    for (const [i, dynamic] of ["pp", "p", "mf", "f", "ff"].entries()) {
      const tick = screen.getByTestId(`dynamics-tick-${dynamic}`);
      expect(tick.getAttribute("data-fraction")).toBe((i / 4).toFixed(4));
    }
  });

  it("moves the needle to the position the active profile maps rms_db onto", async () => {
    profiles = [PROFILE];
    seedDynamicsPanel({ open: true, minimized: false });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("dynamics-band")).toBeTruthy());

    // Exactly mf -> the middle tick.
    emitLevel(-28, -22);
    await waitFor(() =>
      expect(
        screen.getByTestId("dynamics-needle").getAttribute("data-fraction"),
      ).toBe("0.5000"),
    );

    // Halfway between p (-38) and mf (-28) -> halfway between ticks 1 and 2.
    emitLevel(-33, -30);
    await waitFor(() =>
      expect(
        screen.getByTestId("dynamics-needle").getAttribute("data-fraction"),
      ).toBe("0.3750"),
    );
  });

  it("pins the needle to the band ends rather than erroring on out-of-range levels", async () => {
    profiles = [PROFILE];
    seedDynamicsPanel({ open: true, minimized: false });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("dynamics-band")).toBeTruthy());

    // Quieter than the calibrated pp.
    emitLevel(-90, -80);
    await waitFor(() =>
      expect(
        screen.getByTestId("dynamics-needle").getAttribute("data-fraction"),
      ).toBe("0.0000"),
    );

    // ABOVE full scale — Core Audio float input is not hard-clipped at 1.0,
    // and +0.28 dBFS was measured live. This must display, not throw.
    emitLevel(0.28, 1.1);
    await waitFor(() =>
      expect(
        screen.getByTestId("dynamics-needle").getAttribute("data-fraction"),
      ).toBe("1.0000"),
    );
    expect(screen.getByTestId("dynamics-readout").textContent).toBe("0.3 dB");
  });

  it("shows the active profile's free-text label so the piano being measured is visible", async () => {
    profiles = [PROFILE];
    seedDynamicsPanel({ open: true, minimized: false });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("dynamics-profile").textContent).toBe(
        "Steinway, living room, lid half",
      ),
    );
  });

  it("opens the calibration wizard inside the same panel", async () => {
    seedDynamicsPanel({ open: true, minimized: false });
    renderPanel();
    await waitFor(() => expect(listeners.has("dynamics://level")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /^calibrate$/i }));
    expect(screen.getByText(/play pp/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByTestId("dynamics-readout")).toBeTruthy();
  });

  it("never opens the mic while the panel is closed", async () => {
    seedDynamicsPanel({ open: false, minimized: false });
    renderPanel();
    await waitFor(() => expect(calls).toContain("dynamics_profile_list"));
    expect(calls).not.toContain("dynamics_meter_start");
  });

  it("minimizes to a pill and stops the meter while pilled", async () => {
    seedDynamicsPanel({ open: true, minimized: false });
    renderPanel();
    await waitFor(() => expect(calls).toContain("dynamics_meter_start"));

    fireEvent.click(screen.getByRole("button", { name: /minimize/i }));
    await waitFor(() => expect(calls).toContain("dynamics_meter_stop"));
    expect(screen.getByRole("button", { name: /restore dynamics/i })).toBeTruthy();
  });
});
