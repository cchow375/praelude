import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

const calls: string[] = [];
const invokeArgs: [string, unknown][] = [];
const listeners = new Map<string, (e: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    calls.push(cmd);
    invokeArgs.push([cmd, args]);
    if (cmd === "dynamics_meter_state")
      return { running: true, has_input_device: true };
    if (cmd === "dynamics_meter_start")
      return { running: true, has_input_device: true };
    if (cmd === "dynamics_meter_stop")
      return { running: false, has_input_device: true };
    if (cmd === "dynamics_profile_list") return [];
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    calls.push(`listen:${name}`);
    listeners.set(name, cb);
    return () => listeners.delete(name);
  }),
}));

import { useDynamics } from "./useDynamics";

describe("useDynamics", () => {
  beforeEach(() => {
    calls.length = 0;
    invokeArgs.length = 0;
    listeners.clear();
  });
  afterEach(() => cleanup());

  it("listens BEFORE it fetches state (useMetronome.ts:194-221 idiom)", async () => {
    renderHook(() => useDynamics(true));
    await waitFor(() => expect(calls).toContain("dynamics_meter_state"));
    expect(calls.indexOf("listen:dynamics://level")).toBeLessThan(
      calls.indexOf("dynamics_meter_state"),
    );
  });

  it("never polls — exactly one meter_state invoke for the whole mount", async () => {
    vi.useFakeTimers();
    renderHook(() => useDynamics(true));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.filter((c) => c === "dynamics_meter_state")).toHaveLength(1);
    vi.useRealTimers();
  });

  it("starts the meter when enabled and stops it on unmount", async () => {
    const { unmount } = renderHook(() => useDynamics(true));
    await waitFor(() => expect(calls).toContain("dynamics_meter_start"));
    unmount();
    await waitFor(() => expect(calls).toContain("dynamics_meter_stop"));
  });

  it("stops the meter when the panel closes, without unmounting", async () => {
    const { rerender } = renderHook(({ on }) => useDynamics(on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(calls).toContain("dynamics_meter_start"));
    rerender({ on: false });
    await waitFor(() => expect(calls).toContain("dynamics_meter_stop"));
  });

  it("does not open the mic while the panel is closed", async () => {
    renderHook(() => useDynamics(false));
    await waitFor(() => expect(calls).toContain("dynamics_profile_list"));
    expect(calls).not.toContain("dynamics_meter_start");
  });

  it("surfaces the streamed level", async () => {
    const { result } = renderHook(() => useDynamics(true));
    await waitFor(() => expect(listeners.has("dynamics://level")).toBe(true));
    act(() =>
      listeners.get("dynamics://level")!({
        payload: { rms_db: -28.4, peak_db: -19.2, ts_ms: 1 },
      }),
    );
    await waitFor(() => expect(result.current.level?.rms_db).toBe(-28.4));
  });

  it("feeds raw rms_db to subscribeLevel subscribers", async () => {
    const { result } = renderHook(() => useDynamics(true));
    await waitFor(() => expect(listeners.has("dynamics://level")).toBe(true));
    const seen: number[] = [];
    const unsubscribe = result.current.subscribeLevel((db) => seen.push(db));
    act(() =>
      listeners.get("dynamics://level")!({
        payload: { rms_db: -31.5, peak_db: -20, ts_ms: 2 },
      }),
    );
    await waitFor(() => expect(seen).toEqual([-31.5]));
    unsubscribe();
    act(() =>
      listeners.get("dynamics://level")!({
        payload: { rms_db: -10, peak_db: -5, ts_ms: 3 },
      }),
    );
    expect(seen).toEqual([-31.5]);
  });

  it("reports the active profile out of the list", async () => {
    const { result } = renderHook(() => useDynamics(false));
    await waitFor(() => expect(calls).toContain("dynamics_profile_list"));
    expect(result.current.profile).toBeNull();
  });

  it("sends camelCase deviceId when saving, matching the tauri arg convention", async () => {
    const { result } = renderHook(() => useDynamics(false));
    await waitFor(() => expect(calls).toContain("dynamics_profile_list"));
    await act(async () => {
      await result.current.saveProfile("Steinway", []);
    });
    const save = invokeArgs.find(([cmd]) => cmd === "dynamics_profile_save");
    expect(save).toBeTruthy();
    expect((save![1] as { deviceId: string }).deviceId).toBe("default-input");
  });
});
