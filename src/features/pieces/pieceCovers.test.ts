import { describe, expect, it } from "vitest";
import { coverCrop, normalizePieceSearch, preparePieceCover } from "./pieceCovers";

describe("piece cover import", () => {
  it("center crops wide and tall originals without upscaling small images", () => {
    expect(coverCrop(1600, 1000)).toEqual({ x: 300, y: 0, edge: 1000, output: 480 });
    expect(coverCrop(200, 320)).toEqual({ x: 0, y: 60, edge: 200, output: 200 });
    expect(() => coverCrop(0, 100)).toThrow();
    expect(() => coverCrop(Infinity, 100)).toThrow();
  });

  it("rejects documents and oversized input before allocating an image", async () => {
    await expect(preparePieceCover(new File(["<svg>"], "cover.svg", { type: "image/svg+xml" }))).rejects.toThrow("JPEG, PNG, or WebP");
    const oversized = new File([new Uint8Array(15 * 1024 * 1024 + 1)], "huge.jpg", { type: "image/jpeg" });
    await expect(preparePieceCover(oversized)).rejects.toThrow("smaller than 15 MB");
  });

  it("matches familiar composer and piece names without diacritics", () => {
    expect(normalizePieceSearch("  Frédéric Chopin  ")).toBe("frederic chopin");
    expect(normalizePieceSearch("Étude")).toBe("etude");
  });
});
