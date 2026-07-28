import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  anchorsToPoints,
  defaultCalibrationApi,
  pointsToAnchors,
  type CalibrationPoint,
  type CalibrationView,
} from "./calibrationApi";
import type { LineAnchor } from "./anchors";
import type { EditionIdentity } from "../model";

const edition: EditionIdentity = {
  edition_id: "score/Ekier.pdf",
  edition_fingerprint: "fp-a",
};

describe("anchorsToPoints", () => {
  it("maps LineAnchor.yPct to CalibrationPoint.y (page/measure pass through)", () => {
    const anchors: LineAnchor[] = [
      { page: 1, yPct: 0.2, measure: 45 },
      { page: 2, yPct: 0.5, measure: 12 },
    ];
    expect(anchorsToPoints(anchors)).toEqual([
      { page: 1, y: 0.2, measure: 45 },
      { page: 2, y: 0.5, measure: 12 },
    ]);
  });

  it("returns an empty array for an empty anchor list", () => {
    expect(anchorsToPoints([])).toEqual([]);
  });
});

describe("pointsToAnchors", () => {
  it("maps CalibrationPoint.y back to LineAnchor.yPct (page/measure pass through)", () => {
    const points: CalibrationPoint[] = [
      { page: 1, y: 0.2, measure: 45 },
      { page: 2, y: 0.5, measure: 12 },
    ];
    expect(pointsToAnchors(points)).toEqual([
      { page: 1, yPct: 0.2, measure: 45 },
      { page: 2, yPct: 0.5, measure: 12 },
    ]);
  });

  it("round-trips through anchorsToPoints", () => {
    const anchors: LineAnchor[] = [{ page: 3, yPct: 0.34, measure: 52 }];
    expect(pointsToAnchors(anchorsToPoints(anchors))).toEqual(anchors);
  });

  it("returns an empty array for an empty points list", () => {
    expect(pointsToAnchors([])).toEqual([]);
  });
});

describe("defaultCalibrationApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("save() maps args to score_calibration_save with a JSON-stringified pointsJson and userVerified", async () => {
    const view: CalibrationView = {
      piece_id: 3,
      edition_id: edition.edition_id,
      edition_fingerprint: edition.edition_fingerprint,
      method: "user_confirmed",
      confidence: 1,
      points: [{ page: 1, y: 0.2, measure: 45 }],
      user_verified: true,
      updated_ts: "2026-07-24T00:00:00Z",
    };
    invokeMock.mockResolvedValueOnce(view);

    const anchors: LineAnchor[] = [{ page: 1, yPct: 0.2, measure: 45 }];
    const result = await defaultCalibrationApi.save({
      pieceId: 3,
      edition,
      anchors,
      userVerified: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("score_calibration_save", {
      pieceId: 3,
      editionId: edition.edition_id,
      editionFingerprint: edition.edition_fingerprint,
      pointsJson: JSON.stringify([{ page: 1, y: 0.2, measure: 45 }]),
      userVerified: true,
    });
    expect(result).toBe(view);
  });

  it("save() serializes an empty anchors array as '[]' and passes userVerified: false through", async () => {
    invokeMock.mockResolvedValueOnce({} as CalibrationView);

    await defaultCalibrationApi.save({
      pieceId: 3,
      edition,
      anchors: [],
      userVerified: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("score_calibration_save", {
      pieceId: 3,
      editionId: edition.edition_id,
      editionFingerprint: edition.edition_fingerprint,
      pointsJson: "[]",
      userVerified: false,
    });
  });

  it("get() maps pieceId/edition to score_calibration_get and returns the resolved view", async () => {
    const view: CalibrationView = {
      piece_id: 3,
      edition_id: edition.edition_id,
      edition_fingerprint: edition.edition_fingerprint,
      method: "user_confirmed",
      confidence: 0.8,
      points: [],
      user_verified: false,
      updated_ts: "2026-07-24T00:00:00Z",
    };
    invokeMock.mockResolvedValueOnce(view);

    const result = await defaultCalibrationApi.get(3, edition);

    expect(invokeMock).toHaveBeenCalledWith("score_calibration_get", {
      pieceId: 3,
      editionId: edition.edition_id,
      editionFingerprint: edition.edition_fingerprint,
    });
    expect(result).toEqual(view);
  });

  it("get() normalizes a resolved undefined payload to null (no stored calibration)", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const result = await defaultCalibrationApi.get(3, edition);
    expect(result).toBeNull();
  });

  it("get() passes through an explicit null payload as null", async () => {
    invokeMock.mockResolvedValueOnce(null);
    const result = await defaultCalibrationApi.get(3, edition);
    expect(result).toBeNull();
  });

  it("propagates a rejected invoke() call from save() without swallowing the error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend unavailable"));
    await expect(
      defaultCalibrationApi.save({
        pieceId: 3,
        edition,
        anchors: [],
        userVerified: true,
      }),
    ).rejects.toThrow("backend unavailable");
  });

  it("propagates a rejected invoke() call from get() without swallowing the error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("piece not found"));
    await expect(defaultCalibrationApi.get(999, edition)).rejects.toThrow(
      "piece not found",
    );
  });
});
