# CodaKiller v1.0.0 — Release Gate

> **Date:** 2026-07-12 · **Branch:** `p6-universe` · **Schema:** 6
> **Result:** PASS · local ad-hoc signed, not Developer ID signed/notarized

## Automated gate

- Frontend: 34 files / 179 tests passed; TypeScript + Vite production build passed.
- Rust: 313 unit tests passed, 5 hardware/live ignored; 22 integration tests passed.
- Strict all-target/all-feature clippy with `-D warnings` passed.
- Native Tauri app built at version 1.0.0 / identifier `com.christian.codakiller`.
- Staged bundle was sealed and strictly verified before rollback-safe canonical replacement.
- DMG contained only `CodaKiller.app` and the `Applications` link.
- SHA-256 verified: `4c8aeec440dfc5fb96a1d75b987e8b324f7ea4cfbca8c2e681fff185237a1e73`.
- Bundle-ID scan across `/Applications`, the full user home, `/Users/Shared`, and Spotlight found
  exactly `/Applications/CodaKiller.app` after build-bundle cleanup.

## Real database gate

The preserved live schema-5 database was backed up, rehearsed on a copy, then migrated by the
installed v1 app. Relaunch added no rows.

| Check | Result |
|---|---:|
| Schema | 6 |
| Piece / Region / block / rep / Goal | 5 / 24 / 20 / 165 / 4 |
| Legacy feed / ledger | 249 / 249 |
| Exact mapped / explicit skipped | 190 / 59 |
| Deleted-block piece history retained | 5 |
| Canonical events | 193 |
| Integrity / FK violations | `ok` / 0 |
| Relaunch canonical / ledger | 193 / 249 |

## Adversarial gate

Fresh data, security/release, and UI/accessibility reviews each reached explicit approval with no
remaining P0–P2. The reviews forced fixes for schema-v6 reconciliation, deleted-block history,
strict timestamps, atomic source+history writes, stale replacement-session tempo links, broad URL
capabilities, rollback-safe install, bundle-ID duplicates, Keychain status reads, Settings width/
submit behavior, Universe contrast, and brightness text parity.

## Honest residuals

- Christian's real Steinway acceptance session remains pending.
- Signature is ad-hoc; no Developer ID certificate or notarization exists.
- No off-disk git remote exists.
