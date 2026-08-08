import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import { BANNER_MAX_CHARS } from "../features/score/bannerText";
import type { PieceDetailData } from "../features/pieces/types";

// `piece_banner_set`'s own char-limit rejection and unknown-piece rejection
// (mirroring the real Rust command's bound) are NEVER exercised through the
// real dev mock: every UI test that calls piece_banner_set either (a) stubs
// `@tauri-apps/api/core` directly (Banner.test.tsx), bypassing this file
// entirely, or (b) truncates client-side to exactly BANNER_MAX_CHARS before
// ever calling the command (DaySheet.test.tsx's "pin a goal" flow), so the
// mock's OWN bound is never actually triggered. This calls the seam directly
// with a too-long banner to prove the mock's rejection path exists and
// matches the real command's error text shape.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock piece_banner_set rejection paths", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("rejects a banner longer than BANNER_MAX_CHARS with a plain string", async () => {
    const tooLong = "x".repeat(BANNER_MAX_CHARS + 1);
    await expect(
      seamInvoke("piece_banner_set", { pieceId: 1, text: tooLong }),
    ).rejects.toBe(
      `A score banner is limited to ${BANNER_MAX_CHARS} characters (that one is ${BANNER_MAX_CHARS + 1}).`,
    );

    // The piece's stored banner is unchanged by the rejected write.
    const detail = await seamInvoke<PieceDetailData>("piece_get", {
      id: 1,
    });
    expect(detail.banner_text).not.toBe(tooLong);
  });

  it("accepts a banner AT exactly BANNER_MAX_CHARS", async () => {
    const atLimit = "y".repeat(BANNER_MAX_CHARS);
    const result = await seamInvoke<PieceDetailData>("piece_banner_set", {
      pieceId: 1,
      text: atLimit,
    });
    expect(result.banner_text).toBe(atLimit);
  });

  it("rejects setting a banner on an unknown piece id", async () => {
    await expect(
      seamInvoke("piece_banner_set", { pieceId: 9_999, text: "hello" }),
    ).rejects.toBe("piece 9999 not found");
  });

  it("treats an empty/whitespace-only banner as clearing it to null", async () => {
    await seamInvoke("piece_banner_set", { pieceId: 1, text: "something" });
    const cleared = await seamInvoke<PieceDetailData>("piece_banner_set", {
      pieceId: 1,
      text: "   ",
    });
    expect(cleared.banner_text).toBeNull();
  });
});
