/**
 * F4 fix wave: the Shell-level wiring around the non-destructive
 * day_photo_prompt PEEK + explicit day_photo_prompt_dismiss. The store-level
 * pending-queue semantics (two rollovers offer both days in order; a peek
 * that is never acted on still offers the day next launch; skip/photograph
 * each clear exactly one day) are covered exhaustively in
 * src-tauri/src/store/day_photos.rs; this file covers only the thin glue —
 * that Shell calls dismiss with the RIGHT day once the capture card's onDone
 * fires, and never before.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { Shell } from "./Shell";

const PENDING_DAY = "2026-08-21";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "day_photo_prompt") return Promise.resolve(PENDING_DAY);
    if (cmd === "day_photo_prompt_dismiss") return Promise.resolve(null);
    // Every other command: same as an unmocked Shell test — no backend, so
    // reject and let each hook's best-effort fallback handle it.
    return Promise.reject("no backend in this test");
  });
  // jsdom has no camera; DayPhotoCapture's production path calls
  // navigator.mediaDevices.getUserMedia directly (no getMedia prop from
  // Shell), so stub it to behave like a denied/absent camera — the same
  // graceful-fallback path DayPhotoCapture.test.tsx exercises explicitly.
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockRejectedValue(new Error("no camera in jsdom")),
    },
  });
});
afterEach(cleanup);

describe("Shell — day_photo_prompt / dismiss wiring (F4 fix wave)", () => {
  it("offers the peeked pending day, and dismisses exactly that day on Skip — never before", async () => {
    render(<Shell />);

    // The capture card appears for the day the peek returned.
    await screen.findByRole("dialog", { name: "Today's practice photo" });

    // Not dismissed yet — the user hasn't acted on it.
    expect(invokeMock).not.toHaveBeenCalledWith("day_photo_prompt_dismiss", {
      day: PENDING_DAY,
    });

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("day_photo_prompt_dismiss", {
        day: PENDING_DAY,
      }),
    );
    // Dismissed with the SAME day it was offered for, not "today" or any
    // other value.
    const dismissCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "day_photo_prompt_dismiss",
    );
    expect(dismissCall?.[1]).toEqual({ day: PENDING_DAY });

    // The card is gone.
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Today's practice photo" }),
      ).toBeNull(),
    );
  });
});
