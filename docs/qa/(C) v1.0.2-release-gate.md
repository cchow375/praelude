# CodaKiller v1.0.2 — Release Gate

> **Result: PASS · 2026-07-13**  
> Scanned-PDF paint hotfix installed at `/Applications/CodaKiller.app`.

## 🧭 Quick nav

[Failure](#-failure-reproduced) · [Cause](#-root-cause) · [Fix](#-fix-under-test) ·
[Pixels](#-native-pixel-evidence) · [Gates](#-release-gates) · [Artifacts](#-release-artifacts) ·
[Limits](#-honest-limit) · [Next](#-next-action)

## 🔴 Failure reproduced

- v1.0.1 escaped the permanent loading state and reported the correct page count, but Christian's
  screenshot showed completely white score pages.
- The white sheet was the PDF canvas itself: the small page number at bottom right belonged to
  CodaKiller's overlay, not the PDF.
- A synthetic vector PDF painted correctly. `pdfimages -list` then exposed the real distinction:
  Beethoven and Griffes use 1-bit CCITT scans, Scherzo music pages use JBIG2, and Prokofiev uses
  JPEG with ICC color data.

## 🔎 Root cause

PDF.js 6.1.200 can parse a document and resolve a page render while an optional image decoder fails
behind a warning. v1.0.1 did not package or configure the release-matched `wasm/`, `cmaps/`,
`standard_fonts/`, and `iccs/` trees. Its restrictive CSP also lacked the same-origin fetch and
WebAssembly permissions those resources need. The prior smoke used Scherzo page 1, a vector cover,
so it never exercised the failing codecs.

## 🛠️ Fix under test

- Vendored the exact 200 runtime files from installed `pdfjs-dist` **6.1.200**.
- Configured `cMapUrl`, `iccUrl`, `standardFontDataUrl`, and `wasmUrl` from `document.baseURI`,
  keeping development and Tauri's packaged custom origin on the same path.
- Enabled worker-side resource fetching and WASM; disabled WebKit's less-reliable OffscreenCanvas
  and native ImageDecoder paths.
- Added only `connect-src 'self'` and `script-src 'self' 'wasm-unsafe-eval'` to CSP. No general
  `'unsafe-eval'`, remote decoder fetch, or broad filesystem capability.
- Added byte-for-byte asset drift, production-copy, CSP, and renderer-option regression coverage.

## 🖼️ Native pixel evidence

An isolated packaged WKWebView used the production ScoreView adapter, real Tauri `score_read_pdf`
bytes, the packaged custom protocol, CSP, and bundled decoder assets. It did not use Christian's
database.

| Real score page | Encoding exercised | Sampled ink pixels | Result |
|---|---:|---:|---|
| Scherzo page 2 | JBIG2 | **1,971** | **PASS — music visible** |
| Prokofiev page 1 | JPEG + ICC | **10,726** | **PASS — cover visible** |
| Beethoven page 3 | CCITT | **2,078** | **PASS — music visible** |

The temporary diagnostic route and data-directory override were removed before the release build.
A source search is empty and `src-tauri/src/lib.rs` has no diagnostic diff.

## ✅ Release gates

| Gate | Result |
|---|---|
| Focused decoder + ScoreView suite | **16 / 16 passed** |
| Full frontend | **35 files / 189 tests passed** |
| TypeScript + Vite production build | **Passed; all 201 `dist/pdfjs` files present** |
| Rust library | **313 passed / 5 hardware-live ignored** |
| Rust integration | **22 passed / 2 live TTS ignored** |
| Strict Clippy | **Passed** |
| Asset integrity | **200 / 200 version-matched runtime files byte-identical** |
| Adversarial review | **Approved; no P0–P2 findings** |
| Schema/data boundary | **No Rust store/API change; schema remains 6** |
| Native multi-codec paint gate | **3 / 3 representative real pages visibly painted** |

## 📦 Release artifacts

| Item | Value |
|---|---|
| Installed app | `/Applications/CodaKiller.app` |
| Version | `1.0.2` |
| Bundle ID | `com.christian.codakiller` |
| DMG | `releases/v1.0.2/CodaKiller-1.0.2.dmg` |
| DMG bytes | `8,583,646` |
| SHA-256 | `f4b81f5f7224b9ec69e8cfe519ba7bebbb63261a6e2944ff52f0cefa154e0b86` |
| Signature | Valid ad-hoc local seal; not Developer ID signed or notarized |
| Duplicate audit | Exactly one bundle expected: `/Applications/CodaKiller.app` |

## ⚠️ Honest limit

This gate proves representative decoder paths and actual painted pixels, not every page of every
edition. An automatic “blank page” rejection would be wrong because intentional blank pages exist;
the lasting guard is exact asset integrity plus representative real-codec pixel smokes. Christian's
complete voice/metronome/score workflow at the Steinway remains the human acceptance run.

## ⟶ Next action

Christian: open Beethoven page 3 and Scherzo page 2 in **v1.0.2**. Both should show notation. Then
run the standing at-piano acceptance session and record only real friction.
