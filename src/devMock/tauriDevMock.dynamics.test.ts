import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

// Plan B (dynamics): the six `dynamics_*` commands and the mock level ticker
// had zero seam coverage — every panel/hook test stubs `@tauri-apps/api/core`
// with `vi.mock`, which never executes this file's code at all. This proves the
// mock's OWN logic matches the native contract: monotonic validation rejects
// with a plain string naming the step, a save leaves exactly one active
// profile, activate moves the flag without adding rows, and the ticker really
// delivers `dynamics://level` payloads to a `listen()` subscriber and stops
// when the meter stops.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

function seamTransformCallback(fn: (payload: unknown) => void): number {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: {
        transformCallback: (f: unknown, once?: boolean) => number;
      };
    }
  ).__TAURI_INTERNALS__;
  return internals.transformCallback(fn);
}

/** The exact two-call shape `@tauri-apps/api`'s `listen()` bottoms out in. */
async function seamListen(
  event: string,
  fn: (payload: unknown) => void,
): Promise<() => Promise<void>> {
  const handler = seamTransformCallback(fn);
  const id = await seamInvoke<number>("plugin:event|listen", {
    event,
    target: { kind: "Any" },
    handler,
  });
  return async () => {
    await seamInvoke("plugin:event|unlisten", { event, eventId: id });
  };
}

interface MeterState {
  running: boolean;
  has_input_device: boolean;
}
interface Profile {
  id: number;
  device_id: string;
  label: string;
  active: boolean;
  created_at: string;
  points: { dynamic_label: string; measured_db: number }[];
}

const pts = (v: number[]) =>
  ["pp", "p", "mf", "f", "ff"].map((l, i) => ({
    dynamic_label: l,
    measured_db: v[i],
  }));

describe("dev-mock dynamics meter + calibration profiles", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => {
    uninstallTauriDevMock();
    vi.useRealTimers();
  });

  it("starts stopped and flips running with start/stop", async () => {
    expect((await seamInvoke<MeterState>("dynamics_meter_state")).running).toBe(
      false,
    );
    expect((await seamInvoke<MeterState>("dynamics_meter_start")).running).toBe(
      true,
    );
    expect((await seamInvoke<MeterState>("dynamics_meter_state")).running).toBe(
      true,
    );
    expect((await seamInvoke<MeterState>("dynamics_meter_stop")).running).toBe(
      false,
    );
  });

  it("has no profiles until one is saved", async () => {
    expect(await seamInvoke<Profile[]>("dynamics_profile_list")).toEqual([]);
  });

  it("rejects a non-increasing curve with a plain string naming the step", async () => {
    await expect(
      seamInvoke("dynamics_profile_save", {
        deviceId: "default-input",
        label: "Steinway",
        points: pts([-48, -29.8, -31.4, -18, -9]),
      }),
    ).rejects.toContain("mf");
  });

  it("rejects an unnamed profile with a plain string", async () => {
    await expect(
      seamInvoke("dynamics_profile_save", {
        deviceId: "default-input",
        label: "   ",
        points: pts([-48, -38, -28, -18, -9]),
      }),
    ).rejects.toContain("name");
    expect(await seamInvoke<Profile[]>("dynamics_profile_list")).toEqual([]);
  });

  it("leaves exactly one active profile after a successful save", async () => {
    const a = await seamInvoke<Profile>("dynamics_profile_save", {
      deviceId: "default-input",
      label: "Steinway, lid closed",
      points: pts([-50, -40, -30, -20, -10]),
    });
    expect(a.active).toBe(true);
    const b = await seamInvoke<Profile>("dynamics_profile_save", {
      deviceId: "default-input",
      label: "Steinway, lid half",
      points: pts([-48, -38, -28, -18, -9]),
    });
    const list = await seamInvoke<Profile[]>("dynamics_profile_list");
    expect(list).toHaveLength(2);
    expect(list.filter((p) => p.active).map((p) => p.id)).toEqual([b.id]);
  });

  it("moves the active flag on activate without adding rows", async () => {
    const a = await seamInvoke<Profile>("dynamics_profile_save", {
      deviceId: "default-input",
      label: "A",
      points: pts([-50, -40, -30, -20, -10]),
    });
    await seamInvoke<Profile>("dynamics_profile_save", {
      deviceId: "default-input",
      label: "B",
      points: pts([-48, -38, -28, -18, -9]),
    });
    const back = await seamInvoke<Profile>("dynamics_profile_activate", {
      id: a.id,
    });
    expect(back.active).toBe(true);
    const list = await seamInvoke<Profile[]>("dynamics_profile_list");
    expect(list).toHaveLength(2);
    expect(list.filter((p) => p.active).map((p) => p.id)).toEqual([a.id]);
  });

  it("rejects activating an unknown profile", async () => {
    await expect(
      seamInvoke("dynamics_profile_activate", { id: 4242 }),
    ).rejects.toContain("4242");
  });

  it("fires dynamics://level to a real listen() subscriber while running, and stops on meter_stop", async () => {
    vi.useFakeTimers();
    const seen: { rms_db: number }[] = [];
    await seamListen("dynamics://level", (e) => {
      seen.push((e as { payload: { rms_db: number } }).payload);
    });

    // Nothing fires before the meter starts — the seam change is additive.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen).toHaveLength(0);

    await seamInvoke("dynamics_meter_start");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen.length).toBeGreaterThanOrEqual(7);
    for (const level of seen) {
      expect(level.rms_db).toBeGreaterThanOrEqual(-55);
      expect(level.rms_db).toBeLessThanOrEqual(-8);
    }

    await seamInvoke("dynamics_meter_stop");
    const after = seen.length;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen).toHaveLength(after);
  });

  it("is deterministic — two installs produce the same opening sweep", async () => {
    const run = async () => {
      const seen: number[] = [];
      await seamListen("dynamics://level", (e) => {
        seen.push((e as { payload: { rms_db: number } }).payload.rms_db);
      });
      await seamInvoke("dynamics_meter_start");
      await vi.advanceTimersByTimeAsync(1_000);
      await seamInvoke("dynamics_meter_stop");
      return seen;
    };
    vi.useFakeTimers();
    const first = await run();
    uninstallTauriDevMock();
    installTauriDevMock();
    const second = await run();
    expect(second).toEqual(first);
  });

  it("unlisten stops delivery to that subscriber", async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const unlisten = await seamListen("dynamics://level", (e) => {
      seen.push((e as { payload: { rms_db: number } }).payload.rms_db);
    });
    await seamInvoke("dynamics_meter_start");
    await vi.advanceTimersByTimeAsync(500);
    expect(seen.length).toBeGreaterThan(0);
    await unlisten();
    const after = seen.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen).toHaveLength(after);
  });
});
