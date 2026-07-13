# CodaKiller v0.6.0 — Release Gate

> **Date:** 2026-07-12 · **Phase:** P5.5 · **Result:** PASS

## ✅ Automated gate

- Frontend: 31 files / 165 tests passed; TypeScript + Vite production build passed.
- Rust: 285 unit tests passed, 5 hardware/live ignored; 22 integration tests passed.
- Strict clippy passed with warnings denied.
- Two adversarial rounds found and closed deadline, half-capacity, Goal-summary, draft-loss,
  and move-provenance defects. Final focused re-review: **APPROVED**.

## 🗃️ Migration gate

- Rehearsed the real v4 database through the production Store migration on a disposable backup.
- Reached schema 5 twice idempotently; `integrity_check=ok`; `foreign_key_check=0`.
- Preserved 5 pieces, 24 Regions, 20 blocks, 165 reps, 4 Goals, 3 canonical events, and 249
  session events. Added an empty `daily_work` table without rewriting historical practice.

## 🔒 Recovery gate

- Preview is read-only. Apply is explicit, optimistic, and atomic.
- Move / Done / Dismiss / Leave, stale rollback, origin immutability, exact move counts, strict
  dates, earliest parent/subgoal deadline, seven-day horizon, total capacity, and exact half-
  capacity recovery ceiling are covered by integration tests.
- Calendar and recovery events do not create practice time, active days, reps, verdicts, or Goal
  completion.

## 📦 Installed gate

- `/Applications/CodaKiller.app` reports 0.6.0 and identifier `com.christian.codakiller`.
- Ad-hoc bundle seal passes `codesign --verify --deep --strict`.
- Quit/relaunch leaves exactly one process and schema 5 with integrity/FKs clean.
- Generated build bundle was unregistered and removed. Filesystem and Spotlight each return only
  `/Applications/CodaKiller.app`.

## ⚠️ Honest boundary

The complete Steinway at-piano acceptance run remains human work. Accessibility permission was
not granted to terminal automation, so native UI clicking was not faked; component/integration
tests cover the full Calendar/recovery decisions and Christian reported the installed UI working.
