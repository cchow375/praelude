import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
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
});
