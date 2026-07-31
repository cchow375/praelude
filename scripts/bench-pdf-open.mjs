#!/usr/bin/env node
// Measures the two PDF.js loading strategies for a real score, end to end:
//
//   whole-buffer : read the entire file, hand PDF.js the bytes (what CodaKiller
//                  shipped before the `ckscore://` range protocol)
//   range        : hand PDF.js a URL with `disableAutoFetch`, so it pulls the
//                  xref + only the objects page 1 needs
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

import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const MODE = process.env.BENCH_MODE ?? null;

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

  const { createCanvas } = await import("@napi-rs/canvas");
  await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const t0 = performance.now();
  let readMs = 0;
  let task;
  if (mode === "whole-buffer") {
    const bytes = await realReadFile(file);
    bytesRead += bytes.length;
    readMs = performance.now() - t0;
    task = getDocument({
      data: new Uint8Array(bytes).slice(),
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
    });
  } else {
    task = getDocument({
      url: pathToFileURL(file).href,
      rangeChunkSize: 1 << 16,
      disableAutoFetch: true,
      disableStream: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
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

  const out = {
    mode,
    pages: doc.numPages,
    readMs: +readMs.toFixed(1),
    openMs: +openMs.toFixed(1),
    pageMs: +pageMs.toFixed(1),
    opsMs: +opsMs.toFixed(1),
    renderMs: +renderMs.toFixed(1),
    bytesRead,
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  await task.destroy();
}

function run(mode, file) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), file],
      {
        env: { ...process.env, BENCH_MODE: mode },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let buf = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk;
    });
    proc.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`${mode} exited ${code}`));
      const line = buf.trim().split("\n").at(-1);
      process.stdout.write(`${line}\n`);
      resolve(JSON.parse(line));
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
  const results = { "whole-buffer": [], range: [] };
  // One discarded warm-up per mode so the OS page cache is hot for both — this
  // measures the loading STRATEGY, not disk cold-start luck.
  for (const mode of ["whole-buffer", "range"]) await run(mode, file);
  for (let i = 0; i < repeats; i += 1) {
    for (const mode of ["whole-buffer", "range"]) {
      results[mode].push(await run(mode, file));
    }
  }

  // Report the MINIMUM, not the mean: this box runs other work, and the fastest
  // observed run is the one least polluted by it. Medians on a loaded machine
  // swing 3x and would make the comparison meaningless.
  const best = (values) => Math.min(...values).toFixed(1);
  console.log(`\nbest of ${repeats} (ms, cumulative from t0)`);
  console.log(
    "mode          open   getPage(1)  operatorList  render   bytesRead",
  );
  for (const mode of ["whole-buffer", "range"]) {
    const runs = results[mode];
    console.log(
      `${mode.padEnd(13)} ${best(runs.map((r) => r.openMs)).padStart(6)} ${best(
        runs.map((r) => r.pageMs),
      ).padStart(11)} ${best(runs.map((r) => r.opsMs)).padStart(13)} ${best(
        runs.map((r) => r.renderMs),
      ).padStart(8)}   ${Math.min(...runs.map((r) => r.bytesRead))}`,
    );
  }
}

await main();
