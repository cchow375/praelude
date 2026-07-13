# CodaKiller v1.0.1 — Release Gate

> **Result: PASS · 2026-07-13**  
> PDF reliability patch installed at `/Applications/CodaKiller.app`.

## 🧭 Quick nav

[Failure](#-failure-reproduced) · [Fix](#-fix-under-test) · [Evidence](#-evidence) ·
[Release](#-release-artifacts) · [Limits](#-honest-limit) · [Next](#-next-action)

## 🔴 Failure reproduced

- v1.0.0 could remain on **Loading PDF…** indefinitely in the installed WKWebView.
- The selected Scherzo PDF was valid: 25 pages, readable outside the app.
- The stuck boundary was PDF.js 6's modern ES-module worker startup through Tauri's custom app
  protocol. There was no deadline, so a missing worker handshake had no visible terminal state.

## 🛠️ Fix under test

- Matching PDF.js `legacy` display + worker modules.
- Worker handler registered in-process, letting PDF.js use its loopback worker inside WKWebView.
- 30-second deadlines around native byte read and renderer startup.
- Cross-realm-safe byte copying with `Uint8Array`.
- Fire-and-forget loading-task cleanup so a hung `destroy()` cannot delay the visible error.
- Retry refreshes editions and performs exactly one new PDF read/load.

## ✅ Evidence

| Gate | Result |
|---|---|
| Focused ScoreView suite | **10 / 10 passed** |
| Full frontend | **34 files / 183 tests passed** |
| TypeScript + Vite production build | **Passed** |
| Rust library | **313 passed / 5 hardware-live ignored** |
| Rust integration | **22 passed / 2 live TTS ignored** |
| Strict Clippy | **Passed** |
| Native real-score smoke | Actual Scherzo rendered **page 1 of 25 at 1664 × 2314** in installed WKWebView |
| Real-PDF compatibility sweep | All **9** score PDFs parsed through the legacy pair, including 11 MB Prokofiev and 85-page Cortot |
| Adversarial review | **Approved; no P0–P2 findings** after cleanup and retry races were fixed |
| User database | Integrity `ok`, schema **6**, 5 pieces / 24 Regions / 20 blocks / 165 reps |

Regression coverage explicitly proves:

1. a native byte read that never settles becomes a retryable error;
2. a real PDF parses through the production legacy loopback adapter;
3. the deadline rejects even when both PDF startup and `destroy()` never settle;
4. **Try again** causes one fresh read/load, not a duplicate parse.

## 📦 Release artifacts

| Item | Value |
|---|---|
| Installed app | `/Applications/CodaKiller.app` |
| Version | `1.0.1` |
| Bundle ID | `com.christian.codakiller` |
| DMG | `releases/v1.0.1/CodaKiller-1.0.1.dmg` |
| DMG bytes | `6,593,821` |
| SHA-256 | `1efcd96902f177204ac19b3d88829f26d5ddd75e3e82b50d261318f00a6178de` |
| Signature | Valid ad-hoc local seal; not Developer ID signed or notarized |
| Duplicate audit | Exactly one indexed bundle: `/Applications/CodaKiller.app` |

## ⚠️ Honest limit

The clean final app launched and showed the **v1.0.1** badge. macOS then presented its fresh
Desktop-folder privacy prompt, as expected after a new ad-hoc app build. That permission belongs to
Christian; the release process did not approve it silently. The isolated native smoke had already
rendered the real Scherzo through the same fixed renderer. Final real-room/at-piano acceptance is
still human work, not something an unattended test can claim.

## ⟶ Next action

Christian: press **Allow** on the Desktop-folder prompt, open the Scherzo score, and confirm page 1
appears. Then run the standing v1.0.1 at-piano acceptance session.
