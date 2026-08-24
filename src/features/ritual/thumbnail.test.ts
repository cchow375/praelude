import { describe, expect, it } from "vitest";
import { toThumbnailBase64, THUMB_MAX_EDGE } from "./thumbnail";

function fakeVideo(width: number, height: number) {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

describe("thumbnail", () => {
  it("never exceeds 320px on the long edge and preserves aspect ratio", async () => {
    const drawn: { w: number; h: number }[] = [];
    // jsdom has no canvas backend; the module exposes its sizing as a pure step.
    const { thumbnailSize } = await import("./thumbnail");
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [640, 480],
      [200, 100],
    ] as const) {
      const size = thumbnailSize(w, h, THUMB_MAX_EDGE);
      drawn.push({ w: size.width, h: size.height });
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(
        THUMB_MAX_EDGE,
      );
      expect(size.width / size.height).toBeCloseTo(w / h, 2);
    }
    // A source already under the cap is not upscaled.
    expect(drawn[3]).toEqual({ w: 200, h: 100 });
  });

  it("rejects a source with no dimensions rather than writing a blank frame", async () => {
    await expect(toThumbnailBase64(fakeVideo(0, 0))).rejects.toThrow(
      /no frame/i,
    );
  });
});
