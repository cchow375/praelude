import { describe, expect, it, vi } from "vitest";
import {
  createRangeTransport,
  fetchRange,
  probeScoreSource,
  scoreEditionUrl,
  sliceCachedHead,
  totalFromContentRange,
  type PdfRangeTransport,
  type PdfRangeTransportCtor,
} from "./pdfSource";

/** A `Response` stand-in with only the surface `pdfSource` reads. */
function reply(
  status: number,
  body: Uint8Array,
  headers: Record<string, string> = {},
) {
  const lookup = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    status,
    headers: { get: (name: string) => lookup.get(name.toLowerCase()) ?? null },
    arrayBuffer: async () =>
      body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer,
  } as unknown as Response;
}

const FILE = Uint8Array.from({ length: 300 }, (_, index) => index % 256);

/** A fake protocol handler with the same range semantics as `score::serve`. */
function fakeServer(overrides: { truncateTo?: number } = {}) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(
    async (_url: string, init?: { headers?: Record<string, string> }) => {
      const header = init?.headers?.Range ?? "";
      calls.push(header);
      const match = /^bytes=(\d+)-(\d+)$/.exec(header);
      if (!match) return reply(200, FILE);
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), FILE.byteLength - 1);
      const full = FILE.subarray(start, end + 1);
      const body =
        overrides.truncateTo === undefined
          ? full
          : full.subarray(0, overrides.truncateTo);
      return reply(206, body, {
        "Content-Range": `bytes ${start}-${end}/${FILE.byteLength}`,
      });
    },
  );
  return { fetchImpl, calls };
}

describe("scoreEditionUrl", () => {
  it("percent-encodes a real edition id into a single path segment", () => {
    expect(scoreEditionUrl(7, "score/(C) Ekier_Draft.pdf")).toBe(
      "ckscore://localhost/7/score%2F(C)%20Ekier_Draft.pdf",
    );
  });

  it("never lets a traversal-looking id become real path segments", () => {
    const url = scoreEditionUrl(3, "../../etc/passwd");
    expect(url).toBe("ckscore://localhost/3/..%2F..%2Fetc%2Fpasswd");
    // Everything after the piece id stays one segment, so the Rust resolver
    // sees the literal id and fails to match it.
    expect(url.split("/").slice(4)).toEqual(["..%2F..%2Fetc%2Fpasswd"]);
  });
});

describe("totalFromContentRange", () => {
  it("reads the total off a well formed header", () => {
    expect(totalFromContentRange("bytes 0-65535/8638377")).toBe(8638377);
  });

  it("refuses anything it cannot trust", () => {
    for (const header of [
      null,
      "",
      "bytes */8638377",
      "bytes 0-10/*",
      "items 0-10/20",
      "bytes 0-10/0",
    ]) {
      expect(totalFromContentRange(header)).toBeNull();
    }
  });
});

describe("probeScoreSource", () => {
  it("turns a 206 into a range source carrying the opening chunk", async () => {
    const { fetchImpl, calls } = fakeServer();
    const source = await probeScoreSource("ckscore://localhost/1/a.pdf", {
      chunkSize: 64,
      fetchImpl,
    });
    expect(calls).toEqual(["bytes=0-63"]);
    expect(source.kind).toBe("range");
    if (source.kind !== "range") throw new Error("unreachable");
    expect(source.length).toBe(300);
    expect(new Uint8Array(source.head)).toEqual(FILE.subarray(0, 64));
  });

  it("treats a 200 as the whole edition, so small scores need no ranges", async () => {
    const fetchImpl = vi.fn(async () => reply(200, FILE));
    const source = await probeScoreSource("ckscore://localhost/1/a.pdf", {
      chunkSize: 64,
      fetchImpl,
    });
    expect(source.kind).toBe("whole");
    if (source.kind !== "whole") throw new Error("unreachable");
    expect(source.bytes.byteLength).toBe(300);
  });

  it("rejects when the protocol is unreachable so the caller can fall back", async () => {
    const fetchImpl = vi.fn(async () => reply(404, new Uint8Array()));
    await expect(
      probeScoreSource("ckscore://localhost/1/a.pdf", { fetchImpl }),
    ).rejects.toThrow("answered 404");
  });

  it("rejects a 206 with no usable Content-Range", async () => {
    const fetchImpl = vi.fn(async () => reply(206, FILE.subarray(0, 64)));
    await expect(
      probeScoreSource("ckscore://localhost/1/a.pdf", {
        chunkSize: 64,
        fetchImpl,
      }),
    ).rejects.toThrow("Content-Range");
  });

  it("rejects a 206 whose body is shorter than it claims", async () => {
    const { fetchImpl } = fakeServer({ truncateTo: 10 });
    await expect(
      probeScoreSource("ckscore://localhost/1/a.pdf", {
        chunkSize: 64,
        fetchImpl,
      }),
    ).rejects.toThrow("short 206");
  });
});

describe("fetchRange", () => {
  it("returns exactly the requested span", async () => {
    const { fetchImpl, calls } = fakeServer();
    const chunk = await fetchRange("u", 100, 140, { fetchImpl });
    expect(calls).toEqual(["bytes=100-139"]);
    expect(chunk).toEqual(FILE.subarray(100, 140));
  });

  it("follows up until a truncating server has delivered the whole span", async () => {
    const { fetchImpl, calls } = fakeServer({ truncateTo: 10 });
    const chunk = await fetchRange("u", 100, 130, { fetchImpl });
    // A short first chunk must never be handed to PDF.js as the whole answer —
    // `PDFDataTransportStreamRangeReader` closes after the first chunk it sees.
    expect(calls).toEqual(["bytes=100-129", "bytes=110-129", "bytes=120-129"]);
    expect(chunk).toEqual(FILE.subarray(100, 130));
  });

  it("slices the span out of a server that ignored the Range header", async () => {
    const fetchImpl = vi.fn(async () => reply(200, FILE));
    expect(await fetchRange("u", 20, 30, { fetchImpl })).toEqual(
      FILE.subarray(20, 30),
    );
  });

  it("throws on an error status and on an empty body", async () => {
    await expect(
      fetchRange("u", 0, 10, {
        fetchImpl: vi.fn(async () => reply(500, new Uint8Array())),
      }),
    ).rejects.toThrow("answered 500");
    await expect(
      fetchRange("u", 0, 10, {
        fetchImpl: vi.fn(async () =>
          reply(206, new Uint8Array(), { "Content-Range": "bytes 0-9/300" }),
        ),
      }),
    ).rejects.toThrow("empty range body");
  });

  it("is a no-op for an empty span", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchRange("u", 5, 5, { fetchImpl })).toEqual(
      new Uint8Array(),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("sliceCachedHead", () => {
  const head = FILE.subarray(0, 64);

  it("serves a span the head fully covers", () => {
    expect(sliceCachedHead(head, 0, 64)).toEqual(FILE.subarray(0, 64));
    expect(sliceCachedHead(head, 8, 16)).toEqual(FILE.subarray(8, 16));
  });

  it("declines anything the head does not fully cover", () => {
    expect(sliceCachedHead(head, 0, 65)).toBeNull();
    expect(sliceCachedHead(head, -1, 10)).toBeNull();
    expect(sliceCachedHead(head, 10, 10)).toBeNull();
  });
});

/** Records what PDF.js's real `PDFDataRangeTransport` would have been told. */
function fakeTransportBase() {
  const ranges: { begin: number; chunk: Uint8Array }[] = [];
  const constructed: unknown[][] = [];
  let aborted = 0;
  class Base implements PdfRangeTransport {
    length: number;
    constructor(
      length: number,
      initialData: Uint8Array | null,
      progressiveDone?: boolean,
    ) {
      this.length = length;
      constructed.push([length, initialData, progressiveDone]);
    }
    onDataRange(begin: number, chunk: Uint8Array) {
      ranges.push({ begin, chunk });
    }
    abort() {
      aborted += 1;
    }
  }
  return {
    Base: Base as unknown as PdfRangeTransportCtor,
    ranges,
    constructed,
    aborts: () => aborted,
  };
}

function rangeSource(head: Uint8Array) {
  return {
    kind: "range" as const,
    url: "ckscore://localhost/1/a.pdf",
    length: FILE.byteLength,
    head: head.buffer.slice(
      head.byteOffset,
      head.byteOffset + head.byteLength,
    ) as ArrayBuffer,
  };
}

describe("createRangeTransport", () => {
  it("leaves the full reader pending so the worker takes the range path", () => {
    const base = fakeTransportBase();
    createRangeTransport(base.Base, rangeSource(FILE.subarray(0, 64)), {
      onError: vi.fn(),
    });
    // initialData null + progressiveDone false: the worker can only build a
    // NetworkPdfManager from `headersReady`, never race the read loop into a
    // LocalPdfManager over a truncated buffer.
    expect(base.constructed).toEqual([[300, null, false]]);
  });

  it("serves a span covered by the probe chunk without touching the network", async () => {
    const base = fakeTransportBase();
    const fetchImpl = vi.fn();
    const transport = createRangeTransport(
      base.Base,
      rangeSource(FILE.subarray(0, 64)),
      { onError: vi.fn(), fetchImpl },
    );
    (
      transport as unknown as {
        requestDataRange: (a: number, b: number) => void;
      }
    ).requestDataRange(0, 64);
    await vi.waitFor(() => expect(base.ranges).toHaveLength(1));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(base.ranges[0]).toEqual({ begin: 0, chunk: FILE.subarray(0, 64) });
  });

  it("fetches a span beyond the probe chunk and hands it back at the right offset", async () => {
    const base = fakeTransportBase();
    const { fetchImpl, calls } = fakeServer();
    const transport = createRangeTransport(
      base.Base,
      rangeSource(FILE.subarray(0, 64)),
      { onError: vi.fn(), fetchImpl },
    );
    (
      transport as unknown as {
        requestDataRange: (a: number, b: number) => void;
      }
    ).requestDataRange(128, 192);
    await vi.waitFor(() => expect(base.ranges).toHaveLength(1));
    expect(calls).toEqual(["bytes=128-191"]);
    expect(base.ranges[0]).toEqual({
      begin: 128,
      chunk: FILE.subarray(128, 192),
    });
  });

  it("reports a failed range instead of leaving PDF.js waiting forever", async () => {
    const base = fakeTransportBase();
    const onError = vi.fn();
    const transport = createRangeTransport(
      base.Base,
      rangeSource(FILE.subarray(0, 64)),
      {
        onError,
        fetchImpl: vi.fn(async () => reply(500, new Uint8Array())),
      },
    );
    (
      transport as unknown as {
        requestDataRange: (a: number, b: number) => void;
      }
    ).requestDataRange(128, 192);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(base.ranges).toHaveLength(0);
  });

  it("delivers nothing once aborted", async () => {
    const base = fakeTransportBase();
    const onError = vi.fn();
    const transport = createRangeTransport(
      base.Base,
      rangeSource(FILE.subarray(0, 64)),
      {
        onError,
        fetchImpl: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          return reply(500, new Uint8Array());
        }),
      },
    );
    (
      transport as unknown as {
        requestDataRange: (a: number, b: number) => void;
      }
    ).requestDataRange(128, 192);
    transport.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(base.ranges).toHaveLength(0);
    expect(onError).not.toHaveBeenCalled();
    expect(base.aborts()).toBe(1);
  });
});
