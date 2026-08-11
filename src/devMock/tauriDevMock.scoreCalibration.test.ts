import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

// `score_calibration_save`'s malformed-`pointsJson` try/catch fallback (to an
// empty points array, rather than throwing) is untested through the real dev
// mock — calibrationApi.test.ts stubs `@tauri-apps/api/core` with `vi.mock`
// instead, so this file's own JSON.parse/catch branch never runs there. This
// also pins the happy-path round-trip and the piece-unmapped -> null default
// for `score_calibration_get`.

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

interface MockCalibration {
  piece_id: number;
  edition_id: string;
  points: unknown[];
  user_verified: boolean;
}

describe("dev-mock score_calibration_save / score_calibration_get handlers", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("piece 3 (unmapped) has no seeded calibration", async () => {
    const cal = await seamInvoke<MockCalibration | null>(
      "score_calibration_get",
      { pieceId: 3 },
    );
    expect(cal).toBeNull();
  });

  it("falls back to an empty points array for malformed pointsJson, instead of throwing", async () => {
    const saved = await seamInvoke<MockCalibration>("score_calibration_save", {
      pieceId: 3,
      editionId: "score/score.pdf",
      editionFingerprint: "fp-3",
      pointsJson: "{not valid json",
      userVerified: false,
    });
    expect(saved.points).toEqual([]);
  });

  it("round-trips well-formed points and userVerified", async () => {
    const points = [{ page: 1, y: 0.25, measure: 1 }];
    const saved = await seamInvoke<MockCalibration>("score_calibration_save", {
      pieceId: 3,
      editionId: "score/score.pdf",
      editionFingerprint: "fp-3",
      pointsJson: JSON.stringify(points),
      userVerified: true,
    });
    expect(saved.points).toEqual(points);
    expect(saved.user_verified).toBe(true);
    expect(saved.piece_id).toBe(3);
  });
});
