import { describe, expect, it } from "vitest";
import {
  fitContextBucket,
  firstPageCacheKey,
  isCacheableScaleMode,
  LruMap,
  sniffImageMime,
} from "./firstPageCache";

describe("fitContextBucket", () => {
  it("quantizes viewport size so a small resize keeps the same bucket", () => {
    // 900x700 and 901x699 both round into the same 48px quantum.
    expect(fitContextBucket("page", 900, 700)).toBe(
      fitContextBucket("page", 901, 699),
    );
  });

  it("separates buckets when the layout genuinely changes", () => {
    expect(fitContextBucket("page", 900, 700)).not.toBe(
      fitContextBucket("page", 1400, 700),
    );
  });

  it("keys the mode into the bucket so page and width fits never collide", () => {
    expect(fitContextBucket("page", 900, 700)).not.toBe(
      fitContextBucket("width", 900, 700),
    );
  });

  it("degrades non-finite dimensions to zero instead of NaN", () => {
    expect(fitContextBucket("page", Number.NaN, Infinity)).toBe("page-0x0");
  });
});

describe("firstPageCacheKey", () => {
  it("is stable and includes every distinguishing component", () => {
    expect(firstPageCacheKey(7, "abc", 1, "page-19x15")).toBe(
      "7::abc::p1::page-19x15",
    );
  });

  it("changes when the edition fingerprint changes (a re-scanned edition)", () => {
    expect(firstPageCacheKey(7, "abc", 1, "page-19x15")).not.toBe(
      firstPageCacheKey(7, "def", 1, "page-19x15"),
    );
  });

  it("changes when the fit bucket changes (a resized window)", () => {
    expect(firstPageCacheKey(7, "abc", 1, "page-19x15")).not.toBe(
      firstPageCacheKey(7, "abc", 1, "page-29x15"),
    );
  });
});

describe("isCacheableScaleMode", () => {
  it("accepts only the two true fit modes", () => {
    expect(isCacheableScaleMode("page")).toBe(true);
    expect(isCacheableScaleMode("width")).toBe(true);
    expect(isCacheableScaleMode("manual")).toBe(false);
    expect(isCacheableScaleMode("overview")).toBe(false);
  });
});

describe("sniffImageMime", () => {
  it("recognizes JPEG", () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe(
      "image/jpeg",
    );
  });

  it("recognizes WebP via the RIFF/WEBP container", () => {
    const bytes = new Uint8Array(12);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    expect(sniffImageMime(bytes)).toBe("image/webp");
  });

  it("recognizes PNG", () => {
    expect(
      sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])),
    ).toBe("image/png");
  });

  it("falls back for unrecognized bytes without throwing", () => {
    expect(sniffImageMime(new Uint8Array([1, 2, 3]))).toBe(
      "application/octet-stream",
    );
  });
});

describe("LruMap", () => {
  it("rejects a non-positive capacity", () => {
    expect(() => new LruMap<number>(0)).toThrow();
    expect(() => new LruMap<number>(-1)).toThrow();
    expect(() => new LruMap<number>(1.5)).toThrow();
  });

  it("stores and retrieves values", () => {
    const lru = new LruMap<number>(3);
    lru.set("a", 1);
    expect(lru.get("a")).toBe(1);
    expect(lru.has("a")).toBe(true);
    expect(lru.size).toBe(1);
    expect(lru.get("missing")).toBeUndefined();
  });

  it("evicts the least-recently-used entry past capacity and returns it", () => {
    const lru = new LruMap<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    const evicted = lru.set("c", 3);
    expect(evicted).toEqual([["a", 1]]);
    expect(lru.has("a")).toBe(false);
    expect(lru.keys()).toEqual(["b", "c"]);
  });

  it("get() bumps recency so a touched entry survives eviction", () => {
    const lru = new LruMap<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    // Touch "a" — now "b" is the least-recently used.
    expect(lru.get("a")).toBe(1);
    const evicted = lru.set("c", 3);
    expect(evicted).toEqual([["b", 2]]);
    expect(lru.has("a")).toBe(true);
    expect(lru.has("b")).toBe(false);
  });

  it("peek() reads without changing recency", () => {
    const lru = new LruMap<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.peek("a")).toBe(1);
    // "a" is still the LRU because peek did not bump it.
    lru.set("c", 3);
    expect(lru.has("a")).toBe(false);
  });

  it("overwriting an existing key refreshes it without growing or evicting", () => {
    const lru = new LruMap<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    const evicted = lru.set("a", 10);
    expect(evicted).toEqual([]);
    expect(lru.size).toBe(2);
    expect(lru.peek("a")).toBe(10);
    // "a" is now most-recent, so "b" is evicted next.
    lru.set("c", 3);
    expect(lru.has("b")).toBe(false);
    expect(lru.has("a")).toBe(true);
  });

  it("delete() and clear() drop entries", () => {
    const lru = new LruMap<number>(3);
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.delete("a")).toBe(true);
    expect(lru.delete("a")).toBe(false);
    expect(lru.size).toBe(1);
    lru.clear();
    expect(lru.size).toBe(0);
  });
});
