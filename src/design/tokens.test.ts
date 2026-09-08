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
  "--paper-rule-baseline",
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

/**
 * Drop `/* … *​/` comments.
 *
 * Without this the guard counted a name that existed ONLY in prose: deleting
 * the real `--topbar-height: 0px;` declaration while leaving the comment that
 * mentions it kept every test green with the variable undefined at runtime.
 * Commenting a declaration out in place is the commonest way CSS gets deleted,
 * so every check below runs on declarations only.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Source with comments removed — what the browser actually parses. */
const decls = stripComments(css);

/** All names this source DEFINES (`--name: value`), deduped. */
function definedNames(source: string): Set<string> {
  const out = new Set<string>();
  // Split on statement/block boundaries so a name only counts when it opens a
  // declaration — `var(--x)` inside a value can never look like one.
  for (const statement of stripComments(source).split(/[;{}]/)) {
    const m = /^\s*(--[a-zA-Z0-9-]+)\s*:/.exec(statement);
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * Bodies of the top-level rules whose selector list contains a BARE `:root`.
 *
 * `:root[data-theme="dark"]` is not a bare root: the app pins
 * `data-theme="paper"` (src/design/theme.ts), so a token defined only under
 * that attribute is undefined at runtime. An earlier block regex
 * (`/:root[^{]*\{…/`) accepted it and let `--hairline` be moved into that
 * never-matching scope with the suite still green.
 */
function bareRootBlocks(source: string): string[] {
  const blocks: string[] = [];
  const text = stripComments(source);
  let depth = 0;
  let selectorStart = 0;
  let bodyStart = 0;
  let selector = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) {
        selector = text.slice(selectorStart, i);
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        // A nested rule (inside @media, @supports, …) is conditional, so it
        // never counts as an unconditional root definition.
        if (selector.split(",").some((s) => s.trim() === ":root")) {
          blocks.push(text.slice(bodyStart, i));
        }
        selectorStart = i + 1;
      }
    }
  }
  return blocks;
}

/** Names defined at a bare, unconditional `:root`. */
function bareRootNames(source: string): Set<string> {
  const out = new Set<string>();
  for (const block of bareRootBlocks(source))
    for (const name of definedNames(block)) out.add(name);
  return out;
}

/** Literal hex value of a token, or undefined if it is not a plain hex. */
function hexOf(name: string): string | undefined {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(decls);
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

  it("defines every legacy token at a bare :root, not only inside a scope", () => {
    // A per-scope alias block leaves consumers mounted outside it unstyled, and
    // an attribute-scoped root (:root[data-theme="dark"]) never matches at all.
    // Everything must be reachable from the bare document root.
    const atRoot = bareRootNames(css);
    expect(LEGACY_TOKENS.filter((n) => !atRoot.has(n))).toEqual([]);
  });

  it("defines the new paper vocabulary", () => {
    expect(PAPER_TOKENS.filter((n) => !defined.has(n))).toEqual([]);
  });

  it("defines the new paper vocabulary at a bare :root too", () => {
    const atRoot = bareRootNames(css);
    expect(PAPER_TOKENS.filter((n) => !atRoot.has(n))).toEqual([]);
  });
});

/**
 * The guard's own guard. Both holes below were live: a verifier deleted a real
 * declaration / moved one into a never-matching scope and all 103 tests stayed
 * green while the variable was undefined in the browser.
 */
describe("the token guard itself", () => {
  it("ignores a name that survives only in a comment", () => {
    const commentedOut =
      ":root {\n  /* --topbar-height: 0px; */\n  --bg: #fff;\n}\n";
    expect(definedNames(commentedOut).has("--topbar-height")).toBe(false);
    expect(definedNames(commentedOut).has("--bg")).toBe(true);
  });

  it("ignores a name that survives only in a block comment spanning lines", () => {
    const source = ":root {\n  /*\n  --hairline: red;\n  */\n}\n";
    expect(definedNames(source).has("--hairline")).toBe(false);
    expect(bareRootNames(source).has("--hairline")).toBe(false);
  });

  it("does not mistake a var() reference for a definition", () => {
    expect(definedNames(":root {\n  --a: var(--b);\n}\n")).toEqual(
      new Set(["--a"]),
    );
  });

  it("rejects a token defined only under an attribute-scoped :root", () => {
    const scoped = ':root[data-theme="dark"] {\n  --hairline: red;\n}\n';
    expect(definedNames(scoped).has("--hairline")).toBe(true); // defined…
    expect(bareRootNames(scoped).has("--hairline")).toBe(false); // …but not at :root
  });

  it("accepts a bare :root inside a selector list", () => {
    const listed =
      ':root,\n:root[data-theme="paper"] {\n  --hairline: red;\n}\n';
    expect(bareRootNames(listed).has("--hairline")).toBe(true);
  });

  it("rejects a bare :root nested inside an at-rule", () => {
    const nested =
      "@media (min-width: 40em) {\n  :root {\n    --hairline: red;\n  }\n}\n";
    expect(bareRootNames(nested).has("--hairline")).toBe(false);
  });

  it("reads the real token file, not an empty string", () => {
    // A silently-empty read would make every "still defines …" assertion above
    // vacuous in the other direction (they would fail), but keep the negative
    // assertions (no dead hexes) vacuously true.
    expect(css.length).toBeGreaterThan(2000);
    expect(decls).toContain("--ink:");
  });
});

describe("Praelude dark token discipline", () => {
  it("uses a modern sans display stack for headings and titles", () => {
    const display = /--font-display:\s*([^;]+);/.exec(css)?.[1] ?? "";
    expect(display).toMatch(/SF Pro Display|SF Pro Text/);
    expect(display.trim()).toMatch(/sans-serif$/);
  });

  it("keeps a generic fallback on the sans and mono stacks", () => {
    expect(/--font-sans:\s*([^;]+);/.exec(css)?.[1].trim()).toMatch(
      /sans-serif$/,
    );
    expect(/--font-mono:\s*([^;]+);/.exec(css)?.[1].trim()).toMatch(
      /monospace$/,
    );
  });

  it("declares a dark color-scheme so native chrome matches the app", () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
  });

  it("renders near-black surfaces with high-contrast light type", () => {
    expect(hexOf("--bg")?.toLowerCase()).toBe("#101216");
    expect(hexOf("--ink")?.toLowerCase()).toBe("#f5f7fa");
  });

  it("ships a ruled-paper helper other surfaces can apply", () => {
    expect(css).toMatch(/\.paper-ruled\s*\{/);
    expect(css).toMatch(/repeating-linear-gradient/);
  });

  it("paints the writing line on the text baseline, not the band floor", () => {
    // The stroke used to be pinned to `--paper-rule-gap - 1px` — the BOTTOM of
    // each band — so text with line-height: var(--leading-rule) floated 6.5px
    // above every rule while the comment claimed it sat on them.
    expect(decls).toMatch(
      /--paper-rule-baseline:\s*calc\(\s*var\(--paper-rule-gap\)\s*\/\s*2\s*\+\s*[\d.]+em\s*\)/,
    );
    for (const cls of [".paper-ruled", ".paper-ruled-margin"]) {
      const body =
        new RegExp(`\\${cls}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(decls)?.[1] ?? "";
      expect(body, `${cls} must exist`).not.toBe("");
      expect(body).toContain("var(--paper-rule-baseline)");
      expect(body).not.toMatch(/var\(--paper-rule-gap\)\s*-\s*1px/);
    }
  });

  it("uses a restrained modern radius scale", () => {
    expect(css).toMatch(/--r-sm:\s*8px/);
    expect(css).toMatch(/--r-md:\s*12px/);
    expect(css).toMatch(/--r-lg:\s*22px/);
  });
});

describe("dark contrast (WCAG 2.1, computed from the token values)", () => {
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


describe("daylight appearance contrast", () => {
  const light = /:root\[data-theme="light"\]\s*\{([^}]+)\}/.exec(decls)?.[1] ?? "";
  const value = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(light)?.[1];
  it.each(["--ink", "--ink-dim", "--ink-faint", "--accent", "--signal-error", "--signal-success", "--signal-warning"])(
    "%s remains readable on daylight content surfaces", (name) => {
      expect(value(name)).toBeDefined();
      for (const surface of ["--bg", "--bg-raised", "--bg-sunken"]) {
        expect(contrast(value(name)!, value(surface)!)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
