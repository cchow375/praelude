import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Read the token file's text directly. (The plan's
// `readFileSync(new URL("./tokens.css", import.meta.url))` form throws
// "URL must be of scheme file" under this vitest/Vite harness because
// import.meta.url is not a file: URL, and a `?raw` import resolves empty —
// so we resolve from the repo root, which is vitest's cwd. Assertions
// are identical to the plan.)
const css = readFileSync(resolve("src/design/tokens.css"), "utf8");

describe("monochrome token discipline", () => {
  it("has no serif font stacks", () => {
    expect(css).not.toMatch(
      /New York|Iowan|Palatino|Baskerville|Georgia|serif/i,
    );
  });
  it("has no terracotta/brown accent hexes", () => {
    expect(css).not.toMatch(/#9f4937|#cf7862|#ead8d0|#fbf8f2|#2e2924|#4c2d25/i);
  });
  it("defines the required monochrome tokens", () => {
    for (const t of [
      "--bg",
      "--ink",
      "--ink-dim",
      "--hairline",
      "--accent-invert-bg",
      "--font-sans",
      "--font-mono",
    ]) {
      expect(css).toContain(t);
    }
  });
});
