/**
 * Opt-in A/B against a REAL edition from Christian's vault. Skipped unless
 * `SCORE_BENCH_PDF` points at one, so the committed suite stays machine
 * independent:
 *
 * ```sh
 * SCORE_BENCH_PDF="$HOME/Desktop/christian's universe/Piano Practice/Pieces/Chamber Pieces Tanglewood/Christian_C_Barber_Pas_de_Deux_Primo.pdf" \
 *   npx vitest run src/features/score/pdfSource.realfile.test.ts --reporter=verbose
 * ```
 *
 * `fetch` is stubbed with a file-backed server implementing exactly the
 * semantics `score::serve` implements in Rust (206 + Content-Range, 200 with no
 * Range, clamping past EOF), so everything downstream — `probeScoreSource`,
 * `createRangeTransport`, `pdfJsAdapter.loadUrl`, PDF.js itself — is the real
 * production code. The one link this cannot cover is whether WKWebView routes
 * `ckscore://` fetches to the Rust handler at all; that needs the built app.
 */
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createPdfJsAdapter } from "./ScoreView";

const REAL_PDF = process.env.SCORE_BENCH_PDF;
const describeReal = REAL_PDF ? describe : describe.skip;

/** Byte accounting plus the exact status/header contract of `score::serve`. */
function fileBackedProtocol(path: string) {
  const file = readFileSync(path);
  const total = statSync(path).size;
  let served = 0;
  let requests = 0;
  const impl = async (
    _url: string,
    init?: { headers?: Record<string, string> },
  ) => {
    requests += 1;
    const header = init?.headers?.Range ?? "";
    const match = /^bytes=(\d+)-(\d*)$/.exec(header);
    if (!match) {
      served += total;
      return new Response(new Uint8Array(file), {
        status: 200,
        headers: { "Accept-Ranges": "bytes", "Content-Length": String(total) },
      });
    }
    const start = Number(match[1]);
    const end =
      match[2] === "" ? total - 1 : Math.min(Number(match[2]), total - 1);
    const body = new Uint8Array(file.subarray(start, end + 1));
    served += body.byteLength;
    return new Response(body, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(body.byteLength),
        "Content-Range": `bytes ${start}-${end}/${total}`,
      },
    });
  };
  return {
    impl,
    total,
    bytes: () => served,
    requests: () => requests,
    reset: () => {
      served = 0;
      requests = 0;
    },
    whole: () =>
      file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength,
      ) as ArrayBuffer,
  };
}

describeReal("range-loading a real edition", () => {
  it("parses the same document from ranges as from the whole buffer, reading far less", async () => {
    const server = fileBackedProtocol(REAL_PDF!);
    const adapter = createPdfJsAdapter();

    // --- cold: what the very first score open of a session pays -------------
    // The ~1.7 MB PDF.js runtime import is in here; every later measurement
    // below is warm, so the difference is exactly what `prefetch()` moves off
    // the serial open path.
    const coldStart = performance.now();
    const coldDoc = await adapter.load(server.whole(), { timeoutMs: 60_000 });
    const cold = performance.now() - coldStart;
    await coldDoc.destroy();

    // --- today's path, warm: the whole file arrives, then PDF.js parses it ---
    const wholeStart = performance.now();
    const wholeDoc = await adapter.load(server.whole(), { timeoutMs: 60_000 });
    const wholeOpen = performance.now() - wholeStart;
    const wholePage = await wholeDoc.getPage(1);
    const wholeFirstPage = performance.now() - wholeStart;
    const size = { width: wholePage.width, height: wholePage.height };
    const pages = wholeDoc.numPages;
    wholePage.cleanup();
    await wholeDoc.destroy();
    server.reset();

    // --- the ckscore path: only the spans PDF.js asks for -------------------
    vi.stubGlobal("fetch", vi.fn(server.impl));
    try {
      const rangeStart = performance.now();
      const rangeDoc = await adapter.loadUrl!(
        "ckscore://localhost/1/real.pdf",
        {
          timeoutMs: 60_000,
        },
      );
      const rangeOpen = performance.now() - rangeStart;
      const rangePage = await rangeDoc.getPage(1);
      const rangeFirstPage = performance.now() - rangeStart;

      expect(rangeDoc.numPages).toBe(pages);
      expect({ width: rangePage.width, height: rangePage.height }).toEqual(
        size,
      );
      // The whole point: page 1 is usable without having read the file.
      expect(server.bytes()).toBeLessThan(server.total);
      const firstPageBytes = server.bytes();
      const firstPageRequests = server.requests();

      console.log(
        [
          "",
          `file                ${REAL_PDF}`,
          `size                ${server.total} bytes, ${pages} pages`,
          `whole buffer COLD   getDocument ${cold.toFixed(1)} ms (includes the one-time PDF.js runtime import)`,
          `whole buffer warm   getDocument ${wholeOpen.toFixed(1)} ms   +getPage(1) ${wholeFirstPage.toFixed(1)} ms   read ${server.total} bytes`,
          `ckscore warm        getDocument ${rangeOpen.toFixed(1)} ms   +getPage(1) ${rangeFirstPage.toFixed(1)} ms   read ${firstPageBytes} bytes in ${firstPageRequests} requests`,
          "",
        ].join("\n"),
      );

      // `disableAutoFetch` means the last page's content stream was never
      // fetched, so paging to it has to keep working through fresh ranges.
      const lastPage = await rangeDoc.getPage(pages);
      expect(lastPage.width).toBeGreaterThan(0);
      expect(lastPage.height).toBeGreaterThan(0);
      await lastPage.textItems!();
      expect(server.requests()).toBeGreaterThan(firstPageRequests);
      expect(server.bytes()).toBeGreaterThan(firstPageBytes);
      console.log(
        `ckscore page ${pages}      +${server.requests() - firstPageRequests} requests, +${server.bytes() - firstPageBytes} bytes\n`,
      );
      lastPage.cleanup();

      rangePage.cleanup();
      await rangeDoc.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 120_000);
});
