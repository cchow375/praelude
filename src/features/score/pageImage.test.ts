import { describe, expect, it, vi } from "vitest";
import type { PdfPageSize } from "./types";
import {
  MAX_PAGE_IMAGE_LONG_EDGE,
  PAGE_IMAGE_BUCKETS,
  coversPageBox,
  createPageImageSource,
  exceedsPageImageCeiling,
  neededLongEdge,
  pageImageBucket,
} from "./pageImage";

const LETTER = { width: 612, height: 792 };

describe("neededLongEdge", () => {
  it("counts device pixels on the long edge, with the viewer's DPR cap", () => {
    expect(neededLongEdge(LETTER, 1, 2)).toBe(1584);
    // devicePixelRatio is capped at 2 by the viewer, so a 3x display asks for
    // the same bitmap as a 2x one rather than a 50% bigger bucket.
    expect(neededLongEdge(LETTER, 1, 3)).toBe(1584);
    expect(neededLongEdge(LETTER, 1, 1)).toBe(792);
  });

  it("uses the long edge whichever way the page is oriented", () => {
    expect(neededLongEdge({ width: 1000, height: 400 }, 1, 1)).toBe(1000);
  });

  it("never returns a negative or non-finite request", () => {
    expect(neededLongEdge(LETTER, Number.NaN, 2)).toBe(0);
    expect(neededLongEdge(LETTER, -3, 2)).toBe(0);
  });
});

describe("pageImageBucket", () => {
  it("mirrors the Rust buckets: smallest one that covers the request", () => {
    expect(pageImageBucket(1)).toBe(1024);
    expect(pageImageBucket(1024)).toBe(1024);
    expect(pageImageBucket(1025)).toBe(1280);
    expect(pageImageBucket(1584)).toBe(2048);
    expect(pageImageBucket(3200)).toBe(3200);
  });

  it("saturates at the ceiling rather than inventing a bucket", () => {
    expect(pageImageBucket(9999)).toBe(MAX_PAGE_IMAGE_LONG_EDGE);
    expect(PAGE_IMAGE_BUCKETS.at(-1)).toBe(MAX_PAGE_IMAGE_LONG_EDGE);
  });

  it("falls back to the screen default when there is no measurement", () => {
    expect(pageImageBucket(0)).toBe(2048);
    expect(pageImageBucket(Number.NaN)).toBe(2048);
  });
});

describe("exceedsPageImageCeiling", () => {
  it("draws the deep-zoom line exactly at the ceiling", () => {
    expect(exceedsPageImageCeiling(3200)).toBe(false);
    expect(exceedsPageImageCeiling(3201)).toBe(true);
  });

  it("puts a US-Letter page over the line just above 200% at DPR 2", () => {
    expect(exceedsPageImageCeiling(neededLongEdge(LETTER, 2.0, 2))).toBe(false);
    expect(exceedsPageImageCeiling(neededLongEdge(LETTER, 2.1, 2))).toBe(true);
  });
});

describe("coversPageBox", () => {
  it("accepts a downsampled scan whose aspect matches the page box", () => {
    expect(coversPageBox({ width: 1584, height: 2050 }, LETTER)).toBe(true);
  });

  // The rows below are MEASURED, not assumed: page boxes from PDF.js
  // `getViewport({scale:1})`, image sizes from the real Rust decoder at the
  // 1536 bucket, placement coverage from `pdfimages -list`.
  it("accepts the real vault scans that really do cover their page box", () => {
    const real: Array<
      [string, { width: number; height: number }, PdfPageSize]
    > = [
      ["Barber", { width: 1121, height: 1536 }, { width: 2876, height: 3940 }],
      ["Copland", { width: 1088, height: 1422 }, { width: 2176, height: 2844 }],
      [
        "Beethoven Henle",
        { width: 1100, height: 1536 },
        { width: 626.76, height: 874.92 },
      ],
    ];
    for (const [name, image, box] of real) {
      expect(coversPageBox(image, box), name).toBe(true);
    }
  });

  it("refuses the real vault scans that do NOT cover their page box", () => {
    // These are the cases the Rust decoder happily serves but the renderer
    // clips or insets — painting them stretched would slide every region
    // overlay off the staff. Sweeping the whole vault, 0.1% is the loosest
    // tolerance that excludes all 19 such pages.
    const misplaced: Array<
      [string, { width: number; height: number }, PdfPageSize]
    > = [
      // Prokofiev Op.1 Jurgenson p2: a 3300x3900 scan placed at 792x936 pt on a
      // 756x909.12 pt page — 104.8% x 103.0% coverage, i.e. clipped.
      [
        "Prokofiev Jurgenson",
        { width: 3300, height: 3900 },
        { width: 756, height: 909.12 },
      ],
      // Beethoven Op.90 Schnabel p6: a 3200x4528 scan at 400 ppi, so placed at
      // 576x815 pt on a 595x840 pt page — inset to 96.8% x 97.0%.
      [
        "Beethoven Schnabel p6",
        { width: 3200, height: 4528 },
        { width: 595, height: 840 },
      ],
    ];
    for (const [name, image, box] of misplaced) {
      expect(coversPageBox(image, box), name).toBe(false);
    }
  });

  it("refuses an image that is not the shape of the page", () => {
    // A rotated page: PDF.js reports the box swapped, the image is not.
    expect(
      coversPageBox({ width: 1438, height: 1970 }, { width: 792, height: 612 }),
    ).toBe(false);
    // An image occupying only part of the page.
    expect(coversPageBox({ width: 1000, height: 500 }, LETTER)).toBe(false);
  });

  it("refuses degenerate sizes instead of dividing by zero", () => {
    expect(coversPageBox({ width: 0, height: 100 }, LETTER)).toBe(false);
    expect(
      coversPageBox({ width: 100, height: 100 }, { width: 0, height: 1 }),
    ).toBe(false);
  });
});

describe("createPageImageSource", () => {
  it("is absent when the host cannot serve page images at all", () => {
    expect(createPageImageSource({}, 1, "score/a.pdf")).toBeNull();
    expect(createPageImageSource({ pageImage: vi.fn() }, 1, null)).toBeNull();
  });

  it("passes the piece, edition, page and bucket straight through", async () => {
    const pageImage = vi
      .fn()
      .mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    const source = createPageImageSource({ pageImage }, 7, "score/a.pdf");
    const blob = await source?.load(3, 2048);
    expect(pageImage).toHaveBeenCalledWith(7, "score/a.pdf", 3, 2048);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe("image/jpeg");
  });

  it("reads an EMPTY answer as a refusal, not a failure", async () => {
    const pageImage = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const source = createPageImageSource({ pageImage }, 1, "score/a.pdf");
    await expect(source?.load(1, 2048)).resolves.toBeNull();
  });

  it("turns an IPC failure into a refusal rather than letting it escape", async () => {
    const pageImage = vi.fn().mockRejectedValue(new Error("host is gone"));
    const source = createPageImageSource({ pageImage }, 1, "score/a.pdf");
    await expect(source?.load(1, 2048)).resolves.toBeNull();
  });

  it("warms without awaiting, and swallows a warm failure", async () => {
    const warmPageImage = vi.fn().mockRejectedValue(new Error("busy"));
    const source = createPageImageSource(
      { pageImage: vi.fn(), warmPageImage },
      2,
      "score/b.pdf",
    );
    expect(source?.warm(5, 1536)).toBeUndefined();
    expect(warmPageImage).toHaveBeenCalledWith(2, "score/b.pdf", 5, 1536);
    await Promise.resolve();
  });

  it("is a no-op when the host has no warm command", () => {
    const source = createPageImageSource({ pageImage: vi.fn() }, 1, "a");
    expect(() => source?.warm(2, 2048)).not.toThrow();
  });
});
