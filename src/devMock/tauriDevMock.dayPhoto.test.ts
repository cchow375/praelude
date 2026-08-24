import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installTauriDevMock,
  setMockPendingRolloverDays,
  uninstallTauriDevMock,
} from "./tauriDevMock";
import { todayLocal, addDays } from "../features/calendar/dates";

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

const JPEG = "/9j/4AAQSkZJRg==";
const THUMB = "/9j/4AAQSkZJRh==";

describe("dev-mock day_photo handlers", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("saves, lists by range, reads back, and deletes", async () => {
    const today = todayLocal();
    await seamInvoke("day_photo_save", {
      day: today,
      jpegBase64: JPEG,
      thumbBase64: THUMB,
    });

    const thumbs = await seamInvoke<{ day: string; thumb_base64: string }[]>(
      "day_photo_thumbs",
      { from: addDays(today, -6), to: today },
    );
    expect(thumbs.map((t) => t.day)).toContain(today);
    expect(thumbs.find((t) => t.day === today)!.thumb_base64).toBe(THUMB);

    expect(await seamInvoke<string>("day_photo_read", { day: today })).toBe(
      JPEG,
    );

    await seamInvoke("day_photo_delete", { day: today });
    const after = await seamInvoke<{ day: string }[]>("day_photo_thumbs", {
      from: addDays(today, -6),
      to: today,
    });
    expect(after.map((t) => t.day)).not.toContain(today);
  });

  it("returns nothing for a range with no photos, and rejects an unphotographed read", async () => {
    expect(
      await seamInvoke("day_photo_thumbs", {
        from: "1999-01-01",
        to: "1999-01-31",
      }),
    ).toEqual([]);
    await expect(
      seamInvoke("day_photo_read", { day: "1999-01-01" }),
    ).rejects.toBe("no photo recorded for 1999-01-01");
  });

  it("clears saved photos between installs", async () => {
    const today = todayLocal();
    await seamInvoke("day_photo_save", {
      day: today,
      jpegBase64: JPEG,
      thumbBase64: THUMB,
    });
    uninstallTauriDevMock();
    installTauriDevMock();
    expect(
      await seamInvoke("day_photo_thumbs", { from: today, to: today }),
    ).toEqual([]);
  });

  it("never offers a rollover prompt with an empty queue — the mock harness never simulates an unattended midnight close on its own", async () => {
    expect(await seamInvoke("day_photo_prompt")).toBeNull();
  });

  it("rejects an invalid day the same way the real command does", async () => {
    await expect(
      seamInvoke("day_photo_save", {
        day: "not-a-date",
        jpegBase64: JPEG,
        thumbBase64: THUMB,
      }),
    ).rejects.toBe("day must be a valid YYYY-MM-DD local date");
    await expect(
      seamInvoke("day_photo_save", {
        day: "2026-13-99",
        jpegBase64: JPEG,
        thumbBase64: THUMB,
      }),
    ).rejects.toBe("day must be a valid YYYY-MM-DD local date");
  });

  it("F7: day_photo_prompt is a non-destructive peek, and dismiss consumes exactly one day", async () => {
    setMockPendingRolloverDays(["2026-08-21", "2026-08-22"]);

    // Peeking repeatedly never mutates or advances the queue.
    expect(await seamInvoke("day_photo_prompt")).toBe("2026-08-21");
    expect(await seamInvoke("day_photo_prompt")).toBe("2026-08-21");

    await seamInvoke("day_photo_prompt_dismiss", { day: "2026-08-21" });
    expect(await seamInvoke("day_photo_prompt")).toBe("2026-08-22");

    // Dismissing a day that was never pending is a harmless no-op.
    await seamInvoke("day_photo_prompt_dismiss", { day: "1999-01-01" });
    expect(await seamInvoke("day_photo_prompt")).toBe("2026-08-22");

    await seamInvoke("day_photo_prompt_dismiss", { day: "2026-08-22" });
    expect(await seamInvoke("day_photo_prompt")).toBeNull();
  });

  it("F7: a day already photographed through the normal flow is skipped by the peek", async () => {
    setMockPendingRolloverDays(["2026-08-22"]);
    await seamInvoke("day_photo_save", {
      day: "2026-08-22",
      jpegBase64: JPEG,
      thumbBase64: THUMB,
    });
    expect(await seamInvoke("day_photo_prompt")).toBeNull();
  });

  it("clears the pending-rollover queue between installs", async () => {
    setMockPendingRolloverDays(["2026-08-22"]);
    uninstallTauriDevMock();
    installTauriDevMock();
    expect(await seamInvoke("day_photo_prompt")).toBeNull();
  });
});
