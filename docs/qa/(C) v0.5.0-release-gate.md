# CodaKiller v0.5.0 — Release Gate

> **Date:** 2026-07-12 · **Phase:** P5 · **Result:** PASS

## Automated gate

- Frontend: 30 files / 152 tests passed.
- Rust: 260 unit tests passed, 4 live/hardware ignored.
- Rust integration: knowledge 9, STT supervisor 9, TTS gate 4; all passed.
- `cargo clippy --all-targets -- -D warnings`: passed.
- TypeScript + Vite production build: passed.
- Real configured Gemini provider: non-offline, non-empty, cited answer passed after final policy
  hardening; key and answer were not printed.
- Three fresh adversarial reviews: final verdict APPROVED.

## Installed-app gate

- Installed bundle: `/Applications/CodaKiller.app`.
- Info.plist version: `0.5.0`.
- Bundle identifier: `com.christian.codakiller`.
- Signature: ad-hoc, bundle-sealed; `codesign --verify --deep --strict` passed.
- Launch: executable observed at `/Applications/CodaKiller.app/Contents/MacOS/codakiller`.
- Graceful quit: no app or `hear` process remained.
- Filesystem search: exactly one `CodaKiller.app` under `/Applications` + the user home.
- Spotlight: exactly `/Applications/CodaKiller.app` for the bundle identifier.
- Generated build bundle: unregistered and deleted after install.

## Real data gate

- Database: `~/Library/Application Support/com.christian.codakiller/codakiller.db`.
- `PRAGMA integrity_check`: `ok`; `PRAGMA foreign_key_check`: no rows.
- Schema remains v4; P5 is migration-free.
- Preserved graph: 5 pieces, 24 Regions, 20 blocks, 165 reps, 4 Goals.
- Historical limitation recorded: canonical `event` has only 3 old administrative rows; P6 must
  backfill reconstructable `session_event` history before rendering time/consistency.

## Human boundary

Christian reported the Brain build appeared to work before the final hardening. The complete
Steinway session—including wake-word Q&A spoken over the real room—remains the standing human gate.
