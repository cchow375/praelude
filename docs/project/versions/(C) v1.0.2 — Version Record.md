# CodaKiller v1.0.2 — Version Record

> **Shipped:** 2026-07-13 · **Tag:** `v1.0.2` · **Schema:** 6 (unchanged)  
> **Purpose:** make the real scanned score pages paint instead of appearing completely white.

## 🧭 Quick nav

[Snapshot](#-snapshot) · [Failure](#-what-v101-missed) · [Cause](#-root-cause) ·
[Changes](#-what-shipped) · [Proof](#-what-was-proved) · [Data](#-data-safety) ·
[Artifacts](#-artifacts) · [Limits](#-honest-limits) · [Next](#-next-steps)

## 📍 Snapshot

| Question | Answer |
|---|---|
| What is this? | A focused P6 scanned-PDF paint hotfix; no new product scope |
| What did Christian see? | Correct page count, but a completely white page |
| What works now? | Real CCITT, JBIG2, and JPEG/ICC pages visibly paint in packaged WKWebView |
| What changed in data? | Nothing; schema remains v6 |
| Installed app | `/Applications/CodaKiller.app` |

## 🔴 What v1.0.1 missed

v1.0.1 genuinely fixed the infinite renderer bootstrap, but its validation was too weak. It proved
that PDF.js could parse the Scherzo and render page 1—the vector cover. It did **not** prove that a
music page backed by a scanned image produced nonwhite pixels. Christian's screenshot exposed that
gap immediately: page 3 of 26 existed and the canvas had the right size, but the notation was gone.

That is recorded as a test-process failure, not explained away as a corrupt score or user mistake.
From this version onward, PDF acceptance means visible pixels from representative real encodings,
not merely page metadata or a resolved `render()` promise.

## 🔎 Root cause

The real score library is heterogeneous: Beethoven/Griffes contain CCITT scans, Scherzo music pages
use JBIG2, and Prokofiev includes JPEG + ICC content. PDF.js 6.1.200 expects version-matched external
WASM decoders, CMaps, standard fonts, and ICC resources for those paths. They were neither bundled
nor given to `getDocument()`, and the production CSP did not yet permit their same-origin fetches or
WebAssembly compilation. PDF.js could warn internally and leave a white canvas rather than reject.

## 🛠️ What shipped

- Bundled all 200 exact runtime files from `pdfjs-dist` 6.1.200 under `public/pdfjs/`.
- Wired same-origin CMap, ICC, standard-font, and WASM URLs from `document.baseURI`.
- Enabled WASM and worker-side resource fetching while forcing reliable WebKit canvas/decoder paths.
- Narrowly added same-origin resource reads and `'wasm-unsafe-eval'` to CSP—no general unsafe eval,
  network decoder dependency, or filesystem expansion.
- Added byte-for-byte asset/version drift tests, production-copy checks, CSP assertions, and exact
  ScoreView configuration coverage.
- Removed every temporary diagnostic hook before building the release.

## ✅ What was proved

| Check | Result |
|---|---|
| Packaged Scherzo page 2 | **JBIG2 PASS — 1,971 sampled ink pixels; music visible** |
| Packaged Prokofiev page 1 | **JPEG/ICC PASS — 10,726 ink pixels; cover visible** |
| Packaged Beethoven page 3 | **CCITT PASS — 2,078 ink pixels; music visible** |
| Focused decoder/ScoreView tests | **16 / 16 passed** |
| Full frontend | **35 files / 189 tests passed** |
| Runtime assets | **200 / 200 byte-identical to PDF.js 6.1.200; all copied into production** |
| Rust | **313 unit + 22 integration passed**; hardware/live ignores unchanged |
| Build/lint | TypeScript, Vite production build, strict Clippy all passed |
| Fresh adversarial review | **Approved; no P0–P2 findings** |
| Release | Installed/sealed v1.0.2, checksum verified, exact-one-app audit passed |

The decisive smoke ran inside a packaged native WKWebView through the production PDF adapter, real
Tauri byte IPC, the custom app protocol, release CSP, and release asset paths. A synthetic vector
canvas test also passed, but it was not accepted as sufficient evidence.

## 🔐 Data safety

- No migration, schema, Rust store, or native PDF API change.
- The native codec smoke used a copied database and isolated temporary data directory.
- Christian's live database was not opened by the diagnostic build.
- Schema remains 6; the final integrity check preserves **5 pieces / 24 Regions / 20 blocks /
  165 reps**.

## 📦 Artifacts

| Item | Value |
|---|---|
| App | `/Applications/CodaKiller.app` |
| DMG | `~/codakiller/releases/v1.0.2/CodaKiller-1.0.2.dmg` |
| SHA-256 | `f4b81f5f7224b9ec69e8cfe519ba7bebbb63261a6e2944ff52f0cefa154e0b86` |
| Git tag | `v1.0.2` |
| Signature | Ad-hoc local seal; not Developer ID signed or notarized |

## ⚠️ Honest limits

- Three representative real formats were pixel-tested, not every page of every score.
- PDF.js can theoretically produce a white page after future asset corruption; exact asset tests
  and the packaged multi-codec gate cover this shipped version.
- The complete real-piano session is still unrun. This patch proves the PDF image-decoder boundary;
  it does not prove the voice/metronome experience at the Steinway.

## ⟶ Next steps

1. Open Beethoven page 3 and Scherzo page 2 in v1.0.2; confirm notation is visible.
2. Run the standing full at-piano acceptance session and record every genuine friction point.
3. Add the private off-disk git remote after acceptance.
