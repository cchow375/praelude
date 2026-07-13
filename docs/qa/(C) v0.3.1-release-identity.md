# v0.3.1 Release Identity QA

> Date: 2026-07-12

- Installed bundle: `/Applications/CodaKiller.app`
- Reported bundle version: `0.3.1`
- Running executable: `/Applications/CodaKiller.app/Contents/MacOS/codakiller`
- Filesystem `CodaKiller.app` results: one
- Spotlight bundle-id results: one
- Visible dark-mode check: `v0.3.1` badge and `Foundation installed` marker both present
- Frontend: 24 files / 127 tests passed; production build passed
- Rust: 216 unit + 13 integration tests passed; 5 live/hardware ignored; strict clippy passed
- Real DB: schema 3; integrity OK; no foreign-key violations

## Next action

Confirm the same two visible markers in the native installed window, then run the real piano gate.
