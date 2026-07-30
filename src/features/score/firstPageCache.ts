// Fitted first-page bitmap cache — the piece-switch accelerator.
//
// When a piece's first page has rendered at a fit scale we keep a compressed
// snapshot of it (canvas.toBlob → WebP/JPEG). On the next switch back to that
// piece/edition we paint the snapshot instantly, CSS-fit, while the real PDF
// re-parses and re-decodes in the background and swaps in without flicker.
//
// This module is pure and display-only: a key builder, a fit-context bucket,
// an image-MIME sniffer, and an in-memory LRU. On-disk persistence lives behind
// the `score_page_cache_load/save` Tauri commands; this file never touches IO.

/** Container-size quantum for the fit bucket (px). Coarse enough that a stray
 * one-pixel resize never invalidates a snapshot, fine enough that a genuinely
 * different window layout gets its own entry. */
export const FIT_BUCKET_PX = 48;

/** Only true fit modes are cached: a manual/overview zoom is not "the fitted
 * first page", and its displayed size is not derivable before the doc loads. */
export type CacheableScaleMode = "page" | "width";

export function isCacheableScaleMode(mode: string): mode is CacheableScaleMode {
  return mode === "page" || mode === "width";
}

/**
 * A stable label for the fit context a snapshot was captured in. It is derived
 * only from values known *before* the target document loads — the scale mode
 * and the current viewport size — so the switch path can compute the exact key
 * to look up without first knowing the (still-unparsed) page's dimensions.
 * A different window layout lands in a different bucket, so a stale snapshot is
 * a natural cache miss rather than a wrong-sized paint.
 */
export function fitContextBucket(
  mode: string,
  width: number,
  height: number,
): string {
  const safeW = Number.isFinite(width)
    ? Math.max(0, Math.round(width / FIT_BUCKET_PX))
    : 0;
  const safeH = Number.isFinite(height)
    ? Math.max(0, Math.round(height / FIT_BUCKET_PX))
    : 0;
  return `${mode}-${safeW}x${safeH}`;
}

/** The full cache key: piece + edition fingerprint + page + fit bucket. Any
 * component change (a re-scan changing the fingerprint, a different bucket)
 * yields a different key, so a mismatch is simply a miss. */
export function firstPageCacheKey(
  pieceId: number,
  fingerprint: string,
  page: number,
  bucket: string,
): string {
  return `${pieceId}::${fingerprint}::p${page}::${bucket}`;
}

/** Content-sniff the bytes returned by the disk cache so the Blob carries the
 * right MIME for <img>. We only ever persist WebP/JPEG/PNG, so a match is
 * guaranteed in practice; the fallback keeps a corrupt read from throwing. */
export function sniffImageMime(bytes: Uint8Array): string {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  return "application/octet-stream";
}

/**
 * A tiny string-keyed LRU. `get` bumps recency; `set` evicts the least-recently
 * used entries past capacity and returns them so the caller can release any
 * resources they hold (e.g. revoke object URLs). Insertion order in a JS Map is
 * the recency order we rely on.
 */
export class LruMap<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("LruMap capacity must be a positive integer");
    }
  }

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  /** Read without affecting recency. */
  peek(key: string): V | undefined {
    return this.map.get(key);
  }

  /** Read and mark as most-recently used. */
  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** Insert/refresh, evicting LRU entries past capacity. Returns evicted pairs. */
  set(key: string, value: V): Array<[string, V]> {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    const evicted: Array<[string, V]> = [];
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as string;
      const oldestValue = this.map.get(oldest) as V;
      this.map.delete(oldest);
      evicted.push([oldest, oldestValue]);
    }
    return evicted;
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
