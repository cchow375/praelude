import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Read the token file's text directly. (The plan's
// `readFileSync(new URL("./tokens.css", import.meta.url))` form throws
// "URL must be of scheme file" under this vitest/Vite harness because
// import.meta.url is not a file: URL, and a `?raw` import resolves empty —
// so we resolve from the repo root, which is vitest's cwd.)
const css = readFileSync(resolve("src/design/tokens.css"), "utf8");

/**
 * Every custom-property NAME that tokens.css defined before the paper rewrite.
 * Extracted verbatim from `git show HEAD:src/design/tokens.css` at the time of
 * the rewrite (v3 pure-monochrome dark, commit b06ffb6).
 *
 * These names MUST stay defined forever. v1/v2-era stylesheets (Popover,
 * FloatingPanel, the ck-* form kit, Pieces, Metronome) consume them from
 * :root; when an earlier pass scoped the aliases, every consumer that mounted
 * outside the scope rendered transparent/unstyled — an invisible metronome
 * popover and a raw, unstyled practice form. Change VALUES freely; never
 * delete a NAME.
 */
const LEGACY_TOKENS = [
  "--accent",
  "--accent-contrast",
  "--accent-hover",
  "--accent-invert-bg",
  "--accent-invert-ink",
  "--bg",
  "--bg-raised",
  "--bg-sunken",
  "--danger",
  "--dur-base",
  "--dur-fast",
  "--dur-slow",
  "--duration-base",
  "--duration-fast",
  "--duration-slow",
  "--ease-human",
  "--ease-out",
  "--ease-spring",
  "--ease-standard",
  "--font-display",
  "--font-mono",
  "--font-sans",
  "--hairline",
  "--hairline-strong",
  "--info",
  "--ink",
  "--ink-dim",
  "--ink-faint",
  "--ink-on-dark",
  "--ink-primary",
  "--ink-secondary",
  "--ink-tertiary",
  "--leading-normal",
  "--leading-tight",
  "--r-lg",
  "--r-md",
  "--r-sm",
  "--radius-lg",
  "--radius-md",
  "--radius-pill",
  "--radius-sm",
  "--radius-xs",
  "--region-color",
  "--s-1",
  "--s-2",
  "--s-3",
  "--s-4",
  "--s-5",
  "--s-6",
  "--shadow-card",
  "--shadow-popover",
  "--shadow-topbar",
  "--signal-error",
  "--signal-success",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--space-7",
  "--space-8",
  "--success",
  "--surface-active",
  "--surface-app",
  "--surface-hover",
  "--surface-ink",
  "--surface-popover",
  "--surface-raised",
  "--text-2xl",
  "--text-2xs",
  "--text-base",
  "--text-hero",
  "--text-lg",
  "--text-sm",
  "--text-xl",
  "--text-xs",
  "--tracking-label",
  "--tracking-tight",
  "--warning",
  "--weight-bold",
  "--weight-medium",
  "--weight-normal",
  "--weight-regular",
  "--weight-semibold",
] as const;

/** Names the paper system introduced; later lanes are expected to consume them. */
const PAPER_TOKENS = [
  "--paper",
  "--paper-raised",
  "--paper-sunken",
  "--paper-edge",
  "--paper-grain",
  "--paper-rule",
  "--paper-rule-strong",
  "--paper-rule-gap",
  "--paper-margin",
  "--ink-ghost",
  "--ink-inverse",
  "--pencil",
  "--pencil-dim",
  "--control-line",
  "--accent-wash",
  "--accent-line",
  "--signal-warning",
  "--focus-ring",
  "--focus-ring-width",
  "--focus-ring-offset",
  "--selection-bg",
  "--selection-ink",
  "--measure",
  "--text-read",
  "--leading-relaxed",
  // Orphans adopted by the token layer: consumed by feature stylesheets but
  // never defined, so their dark-era fallbacks were winning on paper (or, for
  // --topbar-height, an invalid calc() was dropping a fixed element's `top`).
  "--ck-line",
  "--ck-line-strong",
  "--ck-dim",
  "--topbar-height",
] as const;

/** All names this file currently DEFINES (`  --name: value;`), deduped. */
function definedNames(source: string): Set<string> {
  const out = new Set<string>();
  for (const line of source.split("\n")) {
    const m = /^\s+(--[a-zA-Z0-9-]+)\s*:/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

/** Literal hex value of a token, or undefined if it is not a plain hex. */
function hexOf(name: string): string | undefined {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(css);
  return m?.[1];
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const h = hex.slice(1);
  return (
    0.2126 * chan(parseInt(h.slice(0, 2), 16)) +
    0.7152 * chan(parseInt(h.slice(2, 4), 16)) +
    0.0722 * chan(parseInt(h.slice(4, 6), 16))
  );
}

/** WCAG 2.1 contrast ratio between two opaque hex colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("token vocabulary preservation", () => {
  const defined = definedNames(css);

  it.each(LEGACY_TOKENS)("still defines the legacy token %s", (name) => {
    expect(defined.has(name)).toBe(true);
  });

  it("keeps the full legacy set (a name may never be deleted)", () => {
    const missing = LEGACY_TOKENS.filter((n) => !defined.has(n));
    expect(missing).toEqual([]);
    expect(LEGACY_TOKENS).toHaveLength(85);
  });

  it("defines every legacy token at :root, not only inside a scope", () => {
    // A per-scope alias block leaves consumers mounted outside it unstyled.
    // Everything must be reachable from the document root.
    const rootBlocks = [...css.matchAll(/:root[^{]*\{([\s\S]*?)\n\}/g)].map(
      (m) => m[1],
    );
    const atRoot = new Set<string>();
    for (const block of rootBlocks)
      for (const n of definedNames(block)) atRoot.add(n);
    expect(LEGACY_TOKENS.filter((n) => !atRoot.has(n))).toEqual([]);
  });

  it("defines the new paper vocabulary", () => {
    expect(PAPER_TOKENS.filter((n) => !defined.has(n))).toEqual([]);
  });
});

describe("paper token discipline", () => {
  it("uses a serif display stack for headings and titles", () => {
    const display = /--font-display:\s*([^;]+);/.exec(css)?.[1] ?? "";
    expect(display).toMatch(/New York|Iowan Old Style|Palatino|Georgia/);
    expect(display.trim()).toMatch(/serif$/);
  });

  it("keeps a generic fallback on the sans and mono stacks", () => {
    expect(/--font-sans:\s*([^;]+);/.exec(css)?.[1].trim()).toMatch(
      /sans-serif$/,
    );
    expect(/--font-mono:\s*([^;]+);/.exec(css)?.[1].trim()).toMatch(
      /monospace$/,
    );
  });

  it("declares a light color-scheme so native chrome matches paper", () => {
    expect(css).toMatch(/color-scheme:\s*light/);
    expect(css).not.toMatch(/color-scheme:\s*dark/);
  });

  it("renders paper surfaces, not the retired dark ones", () => {
    for (const deadHex of ["#0e0e10", "#161619", "#0a0a0b", "#2a2a30"]) {
      expect(css.toLowerCase()).not.toContain(deadHex);
    }
    expect(hexOf("--bg")?.toLowerCase()).toBe("#faf8f3");
    expect(hexOf("--ink")?.toLowerCase()).toBe("#1a1714");
  });

  it("ships a ruled-paper helper other surfaces can apply", () => {
    expect(css).toMatch(/\.paper-ruled\s*\{/);
    expect(css).toMatch(/repeating-linear-gradient/);
  });
});

describe("paper contrast (WCAG 2.1, computed from the token values)", () => {
  const paper = hexOf("--bg")!;
  const raised = hexOf("--bg-raised")!;
  const sunken = hexOf("--bg-sunken")!;

  // Text tiers that carry real content must clear AA (4.5:1) on every surface
  // a component may sit on.
  it.each(["--ink", "--ink-dim", "--ink-faint", "--accent", "--pencil"])(
    "%s clears AA on paper, raised and sunken surfaces",
    (name) => {
      const fg = hexOf(name);
      expect(fg, `${name} must be a literal hex`).toBeTruthy();
      for (const bg of [paper, raised, sunken]) {
        expect(contrast(fg!, bg)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(["--signal-error", "--signal-success", "--signal-warning"])(
    "%s clears AA on paper",
    (name) => {
      expect(contrast(hexOf(name)!, paper)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("keeps text legible on the inverted fills", () => {
    expect(
      contrast(hexOf("--accent-invert-ink")!, hexOf("--accent-invert-bg")!),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(hexOf("--accent-contrast")!, hexOf("--accent")!),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(hexOf("--ink-inverse")!, hexOf("--surface-ink")!),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("gives the focus ring a high-contrast, non-decorative colour", () => {
    // WCAG 1.4.11 wants >= 3:1 for a focus indicator; aim well past it.
    expect(contrast(hexOf("--focus-ring")!, paper)).toBeGreaterThanOrEqual(3);
    expect(contrast(hexOf("--focus-ring")!, raised)).toBeGreaterThanOrEqual(3);
  });
});
