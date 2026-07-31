#!/usr/bin/env node
// Measures the two PDF.js loading strategies for a real score, end to end:
//
//   whole-buffer : read the entire file, hand PDF.js the bytes (what CodaKiller
//                  shipped before the `ckscore://` range protocol)
//   range        : hand PDF.js a URL with `disableAutoFetch`, so it pulls the
//                  xref + only the objects page 1 needs
//   fast-path    : what the viewer does NOW — open the document and resolve the
//                  page box through PDF.js, but get the PIXELS from the Rust
//                  `score_page_image` decoder and blit that image instead of
//                  rasterizing the page. Only measurable when a build of that
//                  decoder is pointed at by SCORE_FASTPATH_BIN (see below).
//
// Each strategy runs in a FRESH child process (PDF.js caches aggressively at
// module scope) and reports the wall clock to: document open, getPage(1),
// operator list (this is where a scanned page's image is actually decoded), and
// a real raster render through @napi-rs/canvas. Bytes read off disk are counted
// by wrapping `fs.createReadStream` / `fs.promises.readFile`.
//
//   node scripts/bench-pdf-open.mjs <file.pdf> [repeats]
//
// Prints one JSON line per run plus a summary table.
//
// ---------------------------------------------------------------------------
// Measuring the fast path honestly
// ---------------------------------------------------------------------------
// The decoder lives in Rust, inside a PRIVATE module of the Tauri crate
// (`mod score;`), so this harness cannot link it and must not reimplement it —
// a reimplementation would be a model of the pipeline, not a measurement of it.
// Point SCORE_FASTPATH_BIN at a binary that compiles the REAL
// `src-tauri/src/score/page_image.rs` + `scanned_page.rs` (via `#[path]`, not a
// copy) and exposes:
//
//   <bin> <file.pdf> <page> <target-long-edge> <repeats>
//     -> one JSON line: {"ok":true,"bestMs":..,"width":..,"height":..,
//                        "jpegBytes":..,"sourcePixels":..}
//     -> or {"ok":false,"error":"page paints with operator 'BT'"} for a REFUSAL,
//        which is a routine answer (vector pages) and not a failure.
//   FASTPATH_DUMP_JPEG=<path> writes the encoded page image there.
//
// Without it this mode reports `unavailable` rather than inventing a number.
//
// The `rustMs` column is the decoder's own clock; `rustWallMs` additionally
// includes process spawn, which stands in for the Tauri IPC round trip and is
// pessimistic compared to it. `cold` spawns the decoder; `warm` reads the JPEG
// the cold run already produced, which is exactly what
// `score::page_image_bytes` does on a cache hit.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const MODE = process.env.BENCH_MODE ?? null;

/** The buckets Rust will produce, mirroring `page_image::TARGET_BUCKETS`. */
const TARGET_BUCKETS = [1024, 1280, 1536, 2048, 2560, 3200];
const bucketFor = (needed) =>
  TARGET_BUCKETS.find((bucket) => bucket >= needed) ?? 3200;

/**
 * Serve `public/pdfjs` over loopback HTTP for the duration of the run.
 *
 * PDF.js resolves `wasmUrl`/`cMapUrl`/`iccUrl`/`standardFontDataUrl` with
 * `fetch`, and Node's fetch refuses `file:`. Pointed at a `file:` root the JBIG2
 * wasm silently fails to instantiate and PDF.js drops to its slower pure-JS
 * fallback — which is NOT what the app runs, so any timing taken that way is a
 * different pipeline. A loopback server makes the child resolve exactly the same
 * assets the WKWebView build does.
 */
const MIME = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".icc": "application/octet-stream",
};

async function serveAssets() {
  const root = new URL("../public/pdfjs/", import.meta.url);
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").replace(/^\/+/, ""));
    readFile(new URL(path, root)).then(
      (bytes) => {
        response.writeHead(200, {
          "content-type": MIME[extname(path)] ?? "application/octet-stream",
          "content-length": bytes.length,
        });
        response.end(bytes);
      },
      () => {
        response.writeHead(404).end();
      },
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
}

async function child(mode, file) {
  // PDF.js reaches for `process.getBuiltinModule("fs")`, not an ESM import, so
  // patch that object (ESM namespaces are frozen).
  const fs = process.getBuiltinModule("fs");
  const fsp = process.getBuiltinModule("fs/promises");

  // ---- byte accounting -----------------------------------------------------
  let bytesRead = 0;
  const realCreateReadStream = fs.createReadStream.bind(fs);
  fs.createReadStream = (path, options) => {
    const stream = realCreateReadStream(path, options);
    stream.on("data", (chunk) => {
      bytesRead += chunk.length;
    });
    return stream;
  };
  const realReadFile = fsp.readFile.bind(fsp);

  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // EXACTLY the decoder options `createPdfJsAdapter` ships (ScoreView.tsx
  // `decoderOptions`). Without `wasmUrl` the JBIG2 decoder never initializes and
  // every bilevel scan — including the 38 MP Henle, the worst file in the vault —
  // silently renders blank in ~14 ms. Benchmarking that would be measuring a
  // failure, not the pipeline. The assets come off the parent's loopback server
  // because Node's fetch refuses `file:` (see `serveAssets`).
  const assetRoot = process.env.BENCH_ASSET_ROOT;
  const decoderOptions = {
    cMapUrl: `${assetRoot}cmaps/`,
    cMapPacked: true,
    iccUrl: `${assetRoot}iccs/`,
    standardFontDataUrl: `${assetRoot}standard_fonts/`,
    wasmUrl: `${assetRoot}wasm/`,
    useWorkerFetch: true,
    useWasm: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
  };

  /** Count the ink on a rendered page. See the blank-page note further down. */
  const inkPctOf = (canvas) => {
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sampled = 0;
    let inked = 0;
    for (let y = 0; y < canvas.height; y += 4) {
      for (let x = 0; x < canvas.width; x += 4) {
        const i = (y * canvas.width + x) * 4;
        sampled += 1;
        if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) inked += 1;
      }
    }
    return +((100 * inked) / Math.max(1, sampled)).toFixed(2);
  };

  if (mode === "fast-path") {
    const bin = process.env.SCORE_FASTPATH_BIN;
    const jpegPath = join(tmpdir(), `ck-fastpath-${process.pid}.jpg`);
    const t0 = performance.now();

    // The fast path replaces the RASTER, not the parse: the viewer still opens
    // the document and asks PDF.js for the page box, because every overlay is
    // positioned against that box. This is the same range strategy the app uses.
    const task = getDocument({
      url: pathToFileURL(file).href,
      rangeChunkSize: 1 << 16,
      disableAutoFetch: true,
      disableStream: false,
      ...decoderOptions,
    });
    const doc = await task.promise;
    const openMs = performance.now() - t0;
    const page = await doc.getPage(1);
    const pageMs = performance.now() - t0;
    const base = page.getViewport({ scale: 1 });

    // Exactly what `PdfPage` asks for: fit-page inside a 1100x760 score pane at
    // devicePixelRatio 2, quantized to a bucket so the disk cache can hit.
    const fit = Math.min(1100 / base.width, 760 / base.height);
    const bucket = bucketFor(
      Math.ceil(Math.max(base.width, base.height) * fit * 2),
    );

    if (!bin) {
      process.stdout.write(
        `${JSON.stringify({ mode, unavailable: "set SCORE_FASTPATH_BIN", bucket, openMs: +openMs.toFixed(1), pageMs: +pageMs.toFixed(1) })}\n`,
      );
      await task.destroy();
      return;
    }

    const t1 = performance.now();
    const spawned = spawnSync(bin, [file, "1", String(bucket), "1"], {
      env: { ...process.env, FASTPATH_DUMP_JPEG: jpegPath },
      encoding: "utf8",
    });
    const rustWallMs = performance.now() - t1;
    const decoded = JSON.parse(spawned.stdout.trim().split("\n").at(-1));

    if (!decoded.ok) {
      // A REFUSAL. The viewer falls back to PDF.js here, so the honest number
      // for this file is the `range` row plus the cost of having asked.
      process.stdout.write(
        `${JSON.stringify({
          mode,
          refused: decoded.error,
          bucket,
          openMs: +openMs.toFixed(1),
          pageMs: +pageMs.toFixed(1),
          rustWallMs: +rustWallMs.toFixed(1),
        })}\n`,
      );
      await task.destroy();
      return;
    }

    const imageMs = performance.now() - t0;

    // The webview's half: decode the JPEG and blit it into the page's canvas.
    const image = await loadImage(jpegPath);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    const renderMs = performance.now() - t0;

    // Warm cache: `score::page_image_bytes` answers a second open by reading
    // the cached JPEG off disk, so that is what the warm number measures.
    const t2 = performance.now();
    const cachedBytes = await realReadFile(jpegPath);
    const warmImage = await loadImage(cachedBytes);
    const warmCanvas = createCanvas(warmImage.width, warmImage.height);
    warmCanvas.getContext("2d").drawImage(warmImage, 0, 0);
    const warmPixelsMs = performance.now() - t2;

    process.stdout.write(
      `${JSON.stringify({
        mode,
        pages: doc.numPages,
        bucket,
        readMs: 0,
        openMs: +openMs.toFixed(1),
        pageMs: +pageMs.toFixed(1),
        // "the image bytes are in hand" — the analogue of operatorList.
        opsMs: +imageMs.toFixed(1),
        renderMs: +renderMs.toFixed(1),
        rustMs: decoded.bestMs,
        rustWallMs: +rustWallMs.toFixed(1),
        // Cold is everything above; warm re-opens with the JPEG already cached.
        warmRenderMs: +(pageMs + warmPixelsMs).toFixed(1),
        bytesRead,
        canvasPx: canvas.width * canvas.height,
        imageSize: `${decoded.width}x${decoded.height}`,
        jpegBytes: decoded.jpegBytes,
        sourceMp: +(decoded.sourcePixels / 1e6).toFixed(1),
        inkPct: inkPctOf(canvas),
        peakRssMb: +(process.memoryUsage().rss / (1024 * 1024)).toFixed(1),
      })}\n`,
    );
    await task.destroy();
    return;
  }

  const t0 = performance.now();
  let readMs = 0;
  let task;
  if (mode === "whole-buffer") {
    const bytes = await realReadFile(file);
    bytesRead += bytes.length;
    readMs = performance.now() - t0;
    task = getDocument({
      data: new Uint8Array(bytes).slice(),
      ...decoderOptions,
    });
  } else {
    task = getDocument({
      url: pathToFileURL(file).href,
      rangeChunkSize: 1 << 16,
      disableAutoFetch: true,
      disableStream: false,
      ...decoderOptions,
    });
  }

  const doc = await task.promise;
  const openMs = performance.now() - t0;
  const page = await doc.getPage(1);
  const pageMs = performance.now() - t0;
  await page.getOperatorList();
  const opsMs = performance.now() - t0;

  // Render at the scale the app really uses: fit-page inside a 1100x760 score
  // pane on a 2x display (ScoreView `fitPageScale` * devicePixelRatio).
  const base = page.getViewport({ scale: 1 });
  const fit = Math.min(1100 / base.width, 760 / base.height);
  const viewport = page.getViewport({ scale: fit * 2 });
  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  await page.render({ canvas, viewport }).promise;
  const renderMs = performance.now() - t0;

  // Ink check. A JBIG2/CCITT page whose decoder failed to initialize paints pure
  // white in a few ms, which would otherwise read as a spectacular benchmark
  // result. Sample a grid and count non-white pixels; a real engraving is a few
  // percent ink, a blank page is exactly 0.
  const out = {
    mode,
    pages: doc.numPages,
    readMs: +readMs.toFixed(1),
    openMs: +openMs.toFixed(1),
    pageMs: +pageMs.toFixed(1),
    opsMs: +opsMs.toFixed(1),
    renderMs: +renderMs.toFixed(1),
    bytesRead,
    canvasPx: canvas.width * canvas.height,
    inkPct: inkPctOf(canvas),
    peakRssMb: +(process.memoryUsage().rss / (1024 * 1024)).toFixed(1),
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  await task.destroy();
}

function run(mode, file, assetRoot) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), file],
      {
        env: {
          ...process.env,
          BENCH_MODE: mode,
          BENCH_ASSET_ROOT: assetRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let buf = "";
    let errors = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk;
    });
    proc.stderr.on("data", (chunk) => {
      errors += chunk;
      process.stderr.write(chunk);
    });
    proc.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`${mode} exited ${code}`));
      const line = buf.trim().split("\n").at(-1);
      process.stdout.write(`${line}\n`);
      // Node has no XMLHttpRequest, so PDF.js cannot fetch an embedded ICC
      // profile here and quietly skips the colour transform. In WKWebView it
      // does not skip it, and on Christian's vault that transform is a ~15x
      // multiplier (Barber 43.1 s against Prokofiev 2.8 s at near-identical
      // pixel counts). A PDF.js timing taken here for such a file is therefore a
      // FLOOR on what the app pays, and must never be quoted as the app's cost.
      resolve({
        ...JSON.parse(line),
        iccSkipped: /ICCBased color space/.test(errors),
      });
    });
  });
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error(
      "usage: node scripts/bench-pdf-open.mjs <file.pdf> [repeats]",
    );
    process.exit(2);
  }
  if (MODE) return child(MODE, file);

  const repeats = Number(process.argv[3] ?? 5);
  const modes = ["whole-buffer", "range", "fast-path"];
  const results = { "whole-buffer": [], range: [], "fast-path": [] };
  const assets = await serveAssets();
  try {
    // One discarded warm-up per mode so the OS page cache is hot for all three —
    // this measures the loading STRATEGY, not disk cold-start luck.
    for (const mode of modes) await run(mode, file, assets.url);
    for (let i = 0; i < repeats; i += 1) {
      for (const mode of modes) {
        results[mode].push(await run(mode, file, assets.url));
      }
    }
  } finally {
    assets.close();
  }

  // Report the MINIMUM, not the mean: this box runs other work, and the fastest
  // observed run is the one least polluted by it. Medians on a loaded machine
  // swing 3x and would make the comparison meaningless.
  const best = (values) => Math.min(...values).toFixed(1);
  console.log(`\nbest of ${repeats} (ms, cumulative from t0)`);
  console.log(
    "mode          open   getPage(1)  operatorList  render   peakRssMB  ink%   bytesRead",
  );
  for (const mode of modes) {
    const runs = results[mode];
    // The fast path can legitimately be unmeasurable (no decoder binary) or
    // decline the file (a vector edition). Both are reported, never guessed at.
    if (runs[0]?.unavailable) {
      console.log(
        `${mode.padEnd(13)}  fast path not measured: ${runs[0].unavailable}`,
      );
      continue;
    }
    if (runs[0]?.refused) {
      console.log(
        `${mode.padEnd(13)}  REFUSED by the decoder (${runs[0].refused}) — this file renders through the 'range' row above, which is the fallback`,
      );
      continue;
    }
    console.log(
      `${mode.padEnd(13)} ${best(runs.map((r) => r.openMs)).padStart(6)} ${best(
        runs.map((r) => r.pageMs),
      ).padStart(11)} ${best(runs.map((r) => r.opsMs)).padStart(13)} ${best(
        runs.map((r) => r.renderMs),
      ).padStart(8)} ${Math.max(...runs.map((r) => r.peakRssMb))
        .toFixed(1)
        .padStart(10)} ${runs[0].inkPct.toFixed(2).padStart(6)}   ${Math.min(
        ...runs.map((r) => r.bytesRead),
      )}`,
    );
    if (runs.some((r) => r.inkPct === 0)) {
      console.log(
        `  !! ${mode}: rendered page 1 is BLANK — this timing measures a decoder failure, not the pipeline`,
      );
    }
    if (mode !== "fast-path" && runs.some((r) => r.iccSkipped)) {
      console.log(
        `  !! ${mode}: this page has an embedded ICC profile that PDF.js could NOT apply here (Node has no XMLHttpRequest). The app DOES apply it, at roughly 15x. Treat this row as a floor, not the app's cost.`,
      );
    }
    if (mode === "fast-path") {
      console.log(
        `               image ${runs[0].imageSize} from ${runs[0].sourceMp} MP source, ${runs[0].jpegBytes} JPEG bytes, bucket ${runs[0].bucket}`,
      );
      console.log(
        `               rust decode ${best(runs.map((r) => r.rustMs))} ms (${best(runs.map((r) => r.rustWallMs))} ms incl. process spawn, standing in for the IPC hop)`,
      );
      console.log(
        `               WARM cache (JPEG already on disk): ${best(runs.map((r) => r.warmRenderMs))} ms to first page visible`,
      );
    }
  }
}

await main();
