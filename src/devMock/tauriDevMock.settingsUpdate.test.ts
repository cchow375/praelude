import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

// `settings_update` has zero coverage anywhere in src/: SettingsPanel.tsx's
// default `api.update` (which calls `invoke("settings_update", ...)`) is
// never exercised because every SettingsPanel.test.tsx render injects a
// fully mocked `api` prop, and state/settings.test.ts — the other caller —
// stubs `@tauri-apps/api/core` directly with `vi.mock`. That leaves this
// file's own patch-merge branch unexercised — including, until v7.1.0
// Task 7, the fact that the merge was NOT persisted, so a later
// `settings_snapshot` read forgot a prior `settings_update`. It now
// persists (per install), and these pin that.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

interface MockSettingsSnapshot {
  theme: "auto" | "dark" | "light";
  interface_scale: number;
  wake_word: string;
  [key: string]: unknown;
}

describe("dev-mock settings_update handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("merges the patch onto the current snapshot and returns the merged result", async () => {
    const updated = await seamInvoke<MockSettingsSnapshot>("settings_update", {
      patch: { theme: "light", interface_scale: 110 },
    });
    expect(updated.theme).toBe("light");
    expect(updated.interface_scale).toBe(110);
    // Untouched fields still come through from the base snapshot.
    expect(updated.wake_word).toBe("coda");
  });

  it("persists the update: a later settings_snapshot reflects it", async () => {
    await seamInvoke("settings_update", { patch: { theme: "light" } });
    const snapshot =
      await seamInvoke<MockSettingsSnapshot>("settings_snapshot");
    // Deliberate contract change (v7.1.0 Task 7). The merge used to be
    // discarded, so every write silently reverted on the next read — a
    // remapped verdict hotkey or a theme change looked like it had failed in
    // `dev:mock`. `installTauriDevMock()` still rebuilds the snapshot, so no
    // suite inherits another suite's writes.
    expect(snapshot.theme).toBe("light");
  });
});

// Christian's 2026-08-24 request flipped the REAL backend's assistant_enabled
// default to off. The dev-mock harness deliberately keeps exercising the
// Assistant surfaces by default (installTauriDevMock() with no options), but
// the field must be present and honored so a test can opt into the disabled
// path through the real invoke seam (see PassageHelper.test.tsx's
// "hidden when the Assistant is disabled" suite for a full sibling example).
describe("dev-mock settings_snapshot assistant_enabled field", () => {
  afterEach(() => uninstallTauriDevMock());

  it("defaults to true (the dev-mock harness's own default, not the real backend's)", async () => {
    installTauriDevMock();
    const snapshot =
      await seamInvoke<MockSettingsSnapshot>("settings_snapshot");
    expect(snapshot.assistant_enabled).toBe(true);
  });

  it("honors installTauriDevMock({ assistantEnabled: false }) through the real invoke seam", async () => {
    installTauriDevMock({ assistantEnabled: false });
    const snapshot =
      await seamInvoke<MockSettingsSnapshot>("settings_snapshot");
    expect(snapshot.assistant_enabled).toBe(false);
  });

  it("settings_update can also flip it, same as any other field", async () => {
    installTauriDevMock({ assistantEnabled: false });
    const updated = await seamInvoke<MockSettingsSnapshot>("settings_update", {
      patch: { assistant_enabled: true },
    });
    expect(updated.assistant_enabled).toBe(true);
  });
});
