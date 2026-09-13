# CodaKiller v1.0.0 — Version Record

> **Shipped:** 2026-07-12 · **Phase:** P6 · **Tag:** `v1.0.0` · **Schema:** 6
> **Artifact:** `/Applications/CodaKiller.app` + `CodaKiller-1.0.0.dmg`
> **DMG SHA-256:** `4c8aeec440dfc5fb96a1d75b987e8b324f7ea4cfbca8c2e681fff185237a1e73`

## 🧭 Quick nav

[What shipped](#-what-shipped) · [History proof](#-history-proof) ·
[Verification](#-verification) · [Honest limits](#-honest-limits) · [Next](#-next-steps)

## ✨ What shipped

- **Home + Practice Universe:** focused-time stars, inclusive 28-day continuity orbits, practiced
  Region planets, 2+ date revisit halos, and a deliberately narrow quality brightness tint that is
  repeated as text and explicitly not a grade.
- **Accessible product shell:** Home/Practice/Calendar/Brain remain one click away; Metronome stays
  a top-right tool. Keyboard star selection, arrow navigation, text parity, reduced-motion,
  light/dark, responsive, loading/error/empty states all ship.
- **Deep Settings:** theme; TTS/voice/wake word; Brain provider; custom verdict aliases; click/
  boost/ladder defaults; Calendar capacity; Pieces folder; native Claude/Gemini Keychain status,
  write-only save, and clear.
- **References:** explicit fixed-origin encoded Spotify/YouTube searches from each piece. No broad
  URL opener, scraping, downloading, autoplay, or shell interpolation.
- **Finish:** final C-orbit/piano icon, restrictive CSP, and one rollback-safe release script that
  tests, builds, stages, seals, verifies, installs, packages, hashes, cleans, and rejects duplicates.

## 🧬 History proof

A fresh backup of the real v0.6/schema-5 database migrated to schema 6:

| Check | Result |
|---|---:|
| Pieces / Regions / blocks / reps / Goals | 5 / 24 / 20 / 165 / 4 preserved |
| Legacy `session_event` rows | 249 |
| Exact practice rows mapped | 190 |
| Unsupported rows explicitly skipped | 59 |
| Deleted-block rows preserved at piece level | 5 |
| Canonical events after migration | 193 |
| Second-open additions | 0 |
| Integrity / foreign keys | `ok` / 0 |

New block-open and rep activity is stronger than the backfill bridge: the source `rep_block`/`rep`
row, live feed, canonical event, ledger mapping, and simultaneous tempo step share one SQLite
transaction. Injected ledger failures roll every row back and do not mutate the in-memory tracker.

## ✅ Verification

- Frontend: **34 files / 179 tests passed**; TypeScript + Vite production build passed.
- Rust: **313 unit + 22 integration passed**; 5 hardware/live tests honestly ignored.
- Strict `clippy --all-targets --all-features -D warnings` passed.
- Fresh real DB-copy migration, timestamp/link preservation, idempotence, integrity, and FK gates.
- Rendered 1280px and 760px no-horizontal-overflow UI checks; Settings bounds measured after its
  entrance transform; accessible text/contrast/keyboard review approved.
- Fresh data-integrity, security/release, and UI/accessibility adversarial reviews: no P0–P2.
- Installed bundle identifier/version/signature, schema/data, DMG contents, SHA-256, relaunch, and
  exact-one-copy/Spotlight checks passed.

## ⚠️ Honest limits

- Christian has not yet completed the real Steinway acceptance session. That remains the main
  product risk; automation cannot prove room acoustics or hands-free flow.
- The Mac artifact is **ad-hoc locally signed**, not Developer ID signed or notarized. It is a
  truthful single-machine v1 release, not a public distribution claim.
- The repo still has no off-disk remote. Disk failure remains unacceptable infrastructure risk.
- Gemini TTS uses a preview API/model and falls back to the Mac system voice when unavailable.

## ⏭️ Next steps

1. Open Home and select the Scherzo star.
2. Run the full at-piano checklist: score map/jump → block → hands-free reps → edit one rep →
   non-tempo block → end/export → inspect Universe change.
3. Write down friction immediately; tune only what this real session proves.
4. Create and push a private off-disk git remote.
