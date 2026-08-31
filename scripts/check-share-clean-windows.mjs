#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";

const [frontendArgument, installerArgument] = process.argv.slice(2);
if (!frontendArgument || !installerArgument) {
  throw new Error(
    "Usage: node scripts/check-share-clean-windows.mjs <frontend-dir> <installer.exe>",
  );
}

const frontendDirectory = resolve(frontendArgument);
const installerPath = resolve(installerArgument);

function fail(message) {
  throw new Error(`Share-clean check failed: ${message}`);
}

function requireDirectory(path, label) {
  try {
    if (!statSync(path).isDirectory()) fail(`${label} is not a directory: ${path}`);
  } catch {
    fail(`${label} is missing: ${path}`);
  }
}

function requireFile(path, label) {
  try {
    if (!statSync(path).isFile()) fail(`${label} is not a file: ${path}`);
  } catch {
    fail(`${label} is missing: ${path}`);
  }
}

function walkFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const directory = queue.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile()) files.push(path);
      else fail(`unexpected non-regular payload entry: ${path}`);
    }
  }
  return files;
}

function findSevenZip() {
  if (process.env.CODAKILLER_SEVEN_ZIP) return process.env.CODAKILLER_SEVEN_ZIP;
  for (const candidate of process.platform === "win32" ? ["7z"] : ["7zz", "7z"]) {
    const probe = spawnSync(candidate, ["i"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  fail("7-Zip is required to inspect the NSIS payload.");
}

requireDirectory(frontendDirectory, "frontend directory");
requireFile(installerPath, "installer");

const sevenZip = findSevenZip();
const scratch = mkdtempSync(join(tmpdir(), "codakiller-share-clean-"));

try {
  const listing = execFileSync(sevenZip, ["l", "-slt", "--", installerPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const extracted = join(scratch, "installer");
  execFileSync(sevenZip, ["x", "-y", `-o${extracted}`, "--", installerPath], {
    stdio: "ignore",
  });

  const archiveQueue = walkFiles(extracted).filter(
    (path) => extname(path).toLowerCase() === ".7z",
  );
  const processedArchives = new Set();
  let archiveCount = 0;
  while (archiveQueue.length > 0) {
    const archive = resolve(archiveQueue.shift());
    if (processedArchives.has(archive)) continue;
    processedArchives.add(archive);
    archiveCount += 1;
    if (archiveCount > 32) fail("installer contains an unreasonable nested-archive chain");
    const nested = join(scratch, `nested-${archiveCount}`);
    execFileSync(sevenZip, ["x", "-y", `-o${nested}`, "--", archive], {
      stdio: "ignore",
    });
    for (const path of walkFiles(nested)) {
      if (extname(path).toLowerCase() === ".7z") archiveQueue.push(path);
    }
  }

  const files = [
    ...walkFiles(frontendDirectory),
    ...walkFiles(extracted),
    ...Array.from({ length: archiveCount }, (_, index) =>
      walkFiles(join(scratch, `nested-${index + 1}`)),
    ).flat(),
  ];
  const forbiddenNames = new Set(["quotes.json", "books.json", "hear", "hear.exe"]);
  const forbiddenSuffixes = [
    ".db",
    ".sqlite",
    ".sqlite3",
    ".db-wal",
    ".db-shm",
    ".sqlite-wal",
    ".sqlite-shm",
    "-wal",
    "-shm",
    ".pdf",
    ".musicxml",
    ".mxl",
    ".webm",
    ".mp4",
    ".m4a",
    ".mov",
    ".jpg",
    ".jpeg",
    ".heic",
    ".heif",
  ];
  const forbiddenDirectories = new Set(["rep-replays", "day-photos"]);
  const markers = [
    "q-roskell-1",
    "codakiller.practice_methods",
    "codakiller.dev_mock.fixture",
    "roskell-complete-pianist",
    "gebrian-learn-faster",
    "breth-effective-practicing",
    "gieseking-leimer-technique",
    "Penelope Roskell",
    "The Complete Pianist",
    "Molly Gebrian",
    "Learn Faster, Perform Better",
    "Nancy O'Neill Breth",
    "The Piano Student's Guide to Effective Practicing",
    "Walter Gieseking and Karl Leimer",
    "Gebrian, Chapter 1: Pathways and practicing",
    "Christian Chow",
    "/Users/c3/",
    "Piano Practice/Knowledge and Resources",
    "Piano Practice/Pieces",
  ];
  const notices = [];

  for (const path of files) {
    const lowerName = basename(path).toLowerCase();
    const pathSegments = path.split(sep).map((segment) => segment.toLowerCase());
    if (forbiddenNames.has(lowerName)) fail(`forbidden payload found: ${path}`);
    if (forbiddenSuffixes.some((suffix) => lowerName.endsWith(suffix))) {
      fail(`private/content file found: ${path}`);
    }
    if (pathSegments.some((segment) => forbiddenDirectories.has(segment))) {
      fail(`private app-data directory found: ${path}`);
    }
    if (lowerName === "third_party_notices.txt") notices.push(path);

    const size = statSync(path).size;
    if (size > 200 * 1024 * 1024) continue;
    const bytes = readFileSync(path);
    if (bytes.subarray(0, 15).toString("ascii") === "SQLite format 3") {
      fail(`SQLite payload found under a disguised filename: ${path}`);
    }
    const magic = bytes.subarray(0, 4).toString("hex");
    if (
      [
        "feedface",
        "cefaedfe",
        "feedfacf",
        "cffaedfe",
        "cafebabe",
        "bebafeca",
        "cafebabf",
        "bfbafeca",
      ].includes(magic)
    ) {
      fail(`Mach-O payload found in the Windows bundle: ${path}`);
    }
    for (const marker of markers) {
      if (
        bytes.indexOf(Buffer.from(marker, "utf8")) !== -1 ||
        bytes.indexOf(Buffer.from(marker, "utf16le")) !== -1
      ) {
        fail(`removed/private marker remains in the bundle: ${marker} (${path})`);
      }
    }
  }

  if (notices.length !== 1) {
    fail(`expected exactly one THIRD_PARTY_NOTICES.txt, found ${notices.length}`);
  }
  const noticeText = readFileSync(notices[0], "utf8");
  for (const required of [
    "Copyright (c) 2022-2026 Sveinbjorn Thordarson",
    "Copyright Mozilla Foundation and contributors",
    "Copyright (c) Meta Platforms, Inc. and affiliates.",
    "Copyright (c) 2017 - Present Tauri Apps Contributors",
    "Apache License, Version 2.0",
  ]) {
    if (!noticeText.includes(required)) fail(`third-party notices are incomplete; missing: ${required}`);
  }

  for (const pattern of [
    /^Path = .*\\(?:hear|hear\.exe)$/imu,
    /^Path = .*\.(?:db|sqlite|sqlite3|pdf|musicxml|mxl|webm|mp4|m4a|mov|jpg|jpeg|heic|heif)$/imu,
    /^Path = .*\\(?:quotes|books)\.json$/imu,
    /^Path = .*\\(?:rep-replays|day-photos)(?:\\|$)/imu,
  ]) {
    const hit = listing.match(pattern)?.[0];
    if (hit) fail(`forbidden entry is present in the NSIS archive: ${hit}`);
  }

  console.log("PASS: Windows frontend and NSIS payload are blank/share-clean.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
