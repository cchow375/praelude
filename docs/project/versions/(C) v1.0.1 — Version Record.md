# CodaKiller v1.0.1 — Version Record

> **Shipped:** 2026-07-13 · **Tag:** `v1.0.1` · **Schema:** 6 (unchanged)  
> **Purpose:** eliminate the installed app's permanent **Loading PDF…** failure.

## 🧭 Quick nav

[Snapshot](#-snapshot) · [Root cause](#-root-cause) · [Changes](#-what-shipped) ·
[Proof](#-what-was-proved) · [Data](#-data-safety) · [Artifacts](#-artifacts) ·
[Limits](#-honest-limits) · [Next](#-next-steps)

## 📍 Snapshot

| Question | Answer |
|---|---|
| What is this? | A focused P6 reliability patch; no new product scope |
| What did the user see? | A valid score stayed on **Loading PDF…** forever |
| What works now? | The real 25-page Scherzo renders in the native WKWebView |
| What changed in data? | Nothing; schema remains v6 |
| Installed app | `/Applications/CodaKiller.app` |

## 🔎 Root cause

The score file and database were not broken. v1.0.0 paired PDF.js 6's modern display build with an
ES-module worker URL. On this Mac's WKWebView, the worker launched through Tauri's custom app
protocol never completed its startup handshake. Because the UI had no deadline, it could not leave
the loading state.

This distinction matters: swapping PDFs, rescanning the vault, or deleting app data would not have
fixed the renderer bootstrap—and would have risked Christian's real practice history for no reason.

## 🛠️ What shipped

- Switched the display and worker handler to PDF.js's matching **legacy** build.
- Registered the worker handler in-process, so PDF.js uses its loopback worker and does not depend
  on a custom-protocol module-worker handshake.
- Added bounded native-byte and renderer startup waits with a visible **Try again** state.
- Replaced cross-realm-fragile `ArrayBuffer` identity checks with a safe `Uint8Array` copy.
- Made failed-task cleanup best-effort and non-blocking; a hung `destroy()` cannot hide the error.
- Destroyed a parser created after a dynamic-import deadline.
- Removed the retry dependency race that could parse a large PDF twice.

## ✅ What was proved

| Check | Result |
|---|---|
| Native real Scherzo | **Page 1 of 25**, rendered at **1664 × 2314** |
| All real editions | **9 / 9 parsed**, including 11 MB Prokofiev and 85-page Cortot |
| ScoreView tests | **10 / 10 passed** |
| Full frontend | **34 files / 183 tests passed** |
| Rust | **313 unit + 22 integration passed**; hardware/live ignores unchanged |
| Build/lint | TypeScript, Vite production build, strict Clippy all passed |
| Fresh adversarial review | Approved after finding and closing cleanup + duplicate-retry races |
| Release | Installed, sealed, checksum verified, relaunched, exactly one app copy |

The regression battery contains the failure modes that matter, not just the happy path: a native
read that never resolves; a real parsed PDF; a parser and cleanup that both never resolve; and a
retry that must perform exactly one new read/load.

## 🔐 Data safety

- No migration and no schema change.
- Native smoke used isolated temporary app data and fixtures, then removed them.
- Christian's database remains integrity-clean at schema 6 with **5 pieces / 24 Regions / 20 blocks
  / 165 reps**.
- The final release did not rewrite or delete practice history.

## 📦 Artifacts

| Item | Value |
|---|---|
| App | `/Applications/CodaKiller.app` |
| DMG | `~/codakiller/releases/v1.0.1/CodaKiller-1.0.1.dmg` |
| SHA-256 | `1efcd96902f177204ac19b3d88829f26d5ddd75e3e82b50d261318f00a6178de` |
| Git tag | `v1.0.1` |
| Signature | Ad-hoc local seal; not Developer ID signed or notarized |

## ⚠️ Honest limits

- The clean final app relaunch reached the v1.0.1 Home screen, then macOS displayed its expected
  fresh Desktop-folder permission prompt. Codex did not approve Christian's privacy permission.
- The actual Scherzo native render used an isolated diagnostic launch through the same fixed
  renderer; the 11 MB Prokofiev and 85-page Cortot passed the adapter compatibility sweep but were
  not both clicked through in the final privacy-blocked window.
- The complete real-piano session is still unrun. This patch proves the PDF boundary; it does not
  prove the voice/metronome experience at the Steinway.

## ⟶ Next steps

1. Christian presses **Allow** on the Desktop-folder prompt.
2. Open Scherzo → **Score** and confirm page 1 appears instead of **Loading PDF…**.
3. Run the standing v1.0.1 at-piano acceptance session and log only real friction.
4. Add the private off-disk git remote after acceptance.
