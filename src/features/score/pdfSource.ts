/**
 * Range-loading a score edition from the native `ckscore://` protocol.
 *
 * Before this, opening a score shipped the whole edition across IPC — 8.6 MB
 * for Christian's Barber scan — and then copied it again into a JS `Uint8Array`
 * before PDF.js saw one byte. Here PDF.js is handed a transport that fetches
 * only the spans it asks for.
 *
 * Why a transport and not simply `getDocument({ url })`: PDF.js picks its
 * network stream with `isValidFetchUrl`, which requires `http(s):`. A macOS
 * WKWebView custom scheme is `ckscore://localhost/…`, so PDF.js would fall
 * through to its XHR stream and then refuse ranges outright
 * (`network_utils.js`: `if (disableRange || !isHttp) return`). Driving
 * `PDFDataRangeTransport` ourselves sidesteps the scheme sniffing entirely and
 * keeps the fetching where we can test it.
 */

/** Custom URI scheme registered by `score::serve` in the Rust process. */
export const SCORE_PDF_SCHEME = "ckscore";

/** What PDF.js is told to use as its chunk granularity, and our probe size. */
export const SCORE_RANGE_CHUNK_SIZE = 1 << 16;

/**
 * Address of one edition on the range-capable protocol.
 *
 * macOS and Linux expose a Tauri custom protocol as `<scheme>://localhost/<path>`
 * (Windows would be `http://<scheme>.localhost/<path>`; CodaKiller is a macOS
 * app). The edition id is percent-encoded as a single segment because real ids
 * contain `/`, spaces and parentheses — `score/(C) Ekier_Draft.pdf`.
 */
export function scoreEditionUrl(pieceId: number, editionId: string): string {
  return `${SCORE_PDF_SCHEME}://localhost/${pieceId}/${encodeURIComponent(editionId)}`;
}

/** `bytes 0-65535/8638377` → 8638377. */
export function totalFromContentRange(header: string | null): number | null {
  const match = /^bytes\s+\d+-\d+\/(\d+)$/.exec((header ?? "").trim());
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

export type ScoreSource =
  | {
      /** The edition is big enough to be worth range-loading. */
      kind: "range";
      url: string;
      length: number;
      /** The opening chunk, already in hand — reused instead of re-fetched. */
      head: ArrayBuffer;
    }
  | {
      /** Small edition: the probe already returned all of it. */
      kind: "whole";
      bytes: ArrayBuffer;
    };

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl;
  if (typeof fetch !== "function") {
    throw new Error("fetch is unavailable in this runtime");
  }
  return fetch as unknown as FetchLike;
}

/**
 * One request that both proves the protocol works and primes the first chunk.
 *
 * Doing this before handing anything to PDF.js is what makes the fallback safe:
 * if the webview cannot reach the scheme at all, we find out here — in a single
 * awaited promise — instead of inside PDF.js, where a stalled range request has
 * no error channel and would simply hang until the load deadline.
 */
export async function probeScoreSource(
  url: string,
  options: {
    chunkSize?: number;
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
  } = {},
): Promise<ScoreSource> {
  const chunkSize = options.chunkSize ?? SCORE_RANGE_CHUNK_SIZE;
  const response = await resolveFetch(options.fetchImpl)(url, {
    headers: { Range: `bytes=0-${chunkSize - 1}` },
    signal: options.signal,
  });
  if (response.status === 200) {
    return { kind: "whole", bytes: await response.arrayBuffer() };
  }
  if (response.status !== 206) {
    throw new Error(`score protocol answered ${response.status} for ${url}`);
  }
  const length = totalFromContentRange(response.headers.get("Content-Range"));
  if (length === null) {
    throw new Error("score protocol sent a 206 without a usable Content-Range");
  }
  const head = await response.arrayBuffer();
  // A 206 whose body is short of both the request and the file means the
  // handler is lying about what it sent; refuse rather than feed PDF.js a hole.
  if (head.byteLength < Math.min(chunkSize, length)) {
    throw new Error("score protocol sent a short 206 body");
  }
  return { kind: "range", url, length, head };
}

/**
 * Fetch exactly `[begin, end)`, following up if the server answers short. Our
 * own handler never truncates, but `PDFDataTransportStreamRangeReader` treats
 * the first chunk it receives as the whole answer, so a short read would be
 * silent corruption rather than an error.
 */
export async function fetchRange(
  url: string,
  begin: number,
  end: number,
  options: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const doFetch = resolveFetch(options.fetchImpl);
  const want = end - begin;
  if (want <= 0) return new Uint8Array(0);
  const out = new Uint8Array(want);
  let filled = 0;
  while (filled < want) {
    const response = await doFetch(url, {
      headers: { Range: `bytes=${begin + filled}-${end - 1}` },
      signal: options.signal,
    });
    if (response.status !== 206 && response.status !== 200) {
      throw new Error(`score protocol answered ${response.status} for a range`);
    }
    const chunk = new Uint8Array(await response.arrayBuffer());
    if (chunk.byteLength === 0) {
      throw new Error("score protocol sent an empty range body");
    }
    // A 200 means the whole file came back; take the slice we wanted from it.
    const slice =
      response.status === 200
        ? chunk.subarray(begin + filled, end)
        : chunk.subarray(0, want - filled);
    out.set(slice, filled);
    filled += slice.byteLength;
    if (response.status === 200) break;
  }
  if (filled < want)
    throw new Error("score protocol ran out of bytes mid-range");
  return out;
}

/** The shape of PDF.js's `PDFDataRangeTransport` that we actually depend on. */
export interface PdfRangeTransport {
  length: number;
  onDataRange(begin: number, chunk: Uint8Array): void;
  abort(): void;
}

export type PdfRangeTransportCtor = new (
  length: number,
  initialData: Uint8Array | null,
  progressiveDone?: boolean,
) => PdfRangeTransport;

export interface RangeTransportOptions {
  /** Called when a range fetch fails — PDF.js itself has no channel for this. */
  onError: (error: unknown) => void;
  fetchImpl?: FetchLike;
}

/**
 * Build the transport PDF.js drives.
 *
 * `initialData` is deliberately `null` and `progressiveDone` `false`: that
 * leaves the full reader permanently pending, which forces the worker to build
 * its `NetworkPdfManager` from the `headersReady` branch instead of racing the
 * read loop into a `LocalPdfManager` over a truncated buffer
 * (`pdf.worker.mjs`, `getPdfManager`). Every byte therefore arrives through
 * `requestDataRange`, and the probe's head chunk is replayed from memory so
 * that determinism costs no extra round trip.
 */
export function createRangeTransport(
  Base: PdfRangeTransportCtor,
  source: Extract<ScoreSource, { kind: "range" }>,
  options: RangeTransportOptions,
): PdfRangeTransport {
  const head = new Uint8Array(source.head);
  const controller = new AbortController();

  class ScoreRangeTransport extends Base {
    private aborted = false;

    constructor() {
      super(source.length, null, false);
    }

    requestDataRange(begin: number, end: number) {
      void this.serve(begin, end);
    }

    override abort() {
      this.aborted = true;
      controller.abort();
      super.abort();
    }

    private async serve(begin: number, end: number) {
      try {
        const cached = sliceCachedHead(head, begin, end);
        const chunk =
          cached ??
          (await fetchRange(source.url, begin, end, {
            fetchImpl: options.fetchImpl,
            signal: controller.signal,
          }));
        if (this.aborted) return;
        this.onDataRange(begin, chunk);
      } catch (error) {
        if (this.aborted) return;
        options.onError(error);
      }
    }
  }

  return new ScoreRangeTransport();
}

/** Serve `[begin, end)` from the probe's head chunk when it is fully covered. */
export function sliceCachedHead(
  head: Uint8Array,
  begin: number,
  end: number,
): Uint8Array | null {
  if (begin < 0 || end > head.byteLength || end <= begin) return null;
  return head.slice(begin, end);
}
