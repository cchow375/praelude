import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = join(ROOT, "node_modules", "pdfjs-dist");
const PUBLIC = join(ROOT, "public", "pdfjs");
const DIRECTORIES = ["cmaps", "iccs", "standard_fonts", "wasm"];

function filesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe("vendored PDF.js runtime assets", () => {
  it.each(DIRECTORIES)(
    "matches pdfjs-dist/%s byte-for-byte",
    (directory) => {
      const sourceRoot = join(SOURCE, directory);
      const publicRoot = join(PUBLIC, directory);
      const sourceFiles = filesUnder(sourceRoot)
        .map((path) => relative(sourceRoot, path))
        .sort();
      const publicFiles = filesUnder(publicRoot)
        .map((path) => relative(publicRoot, path))
        .sort();
      expect(publicFiles).toEqual(sourceFiles);
      for (const file of sourceFiles) {
        expect(readFileSync(join(publicRoot, file))).toEqual(
          readFileSync(join(sourceRoot, file)),
        );
      }
    },
    20_000,
  );

  it("keeps same-origin asset fetches and WebAssembly decoding inside the production CSP", () => {
    const config = JSON.parse(
      readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"),
    );
    const csp = String(config.app.security.csp);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  });
});
