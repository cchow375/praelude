# v9.1.0 Windows x64 QA Ledger

> **SOURCE-CANDIDATE LEDGER — PACKAGE PENDING.** Created 2026-08-31. Version 9.1.0, schema 21.
> Installed Mac remains v8.2.1/schema 20. The Mac v9.0.0 DMG facts are unchanged.

## Current verdict

**NOT SHIPPABLE YET.** Frontend/TypeScript/build pass. Windows-native CI, exact installer,
artifact identity, share-clean package proof and clean Windows 10/11 acceptance are pending.

## Evidence matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Frontend tests | **PASS** | 205 files with 1 skipped; 2,540 tests with 1 skipped |
| TypeScript | **PASS** | source-candidate run |
| Production frontend build | **PASS** | source-candidate run |
| Rust format on Windows | **PENDING** | — |
| Strict Clippy on Windows | **PENDING** | — |
| Native tests on Windows | **PENDING** | — |
| Tauri x64 NSIS build | **PENDING** | — |
| Share-clean installer scan | **PENDING** | — |
| Exact Setup EXE path/name | **PENDING** | — |
| Exact bytes | **PENDING** | — |
| SHA-256/sidecar | **PENDING** | — |
| Authenticode | **PENDING** | expected unsigned; must be measured |
| Workflow run/commit | **PENDING** | — |
| Tag/private push | **PENDING** | — |
| Windows 10 acceptance | **PENDING** | — |
| Windows 11 acceptance | **PENDING** | — |

## Required artifact audit

- Exactly one versioned x64 Setup EXE is staged.
- Filename/version/product identity agree with v9.1.0.
- SHA-256 sidecar names only the installer basename.
- Authenticode status is recorded without implying trust.
- Installer inventory contains no DB/SQLite, PDF/MusicXML, recordings/photos, devMock, personal
  path/name, quote/book/method/Knowledge payload or macOS `hear` executable.
- Notices required by the shipped dependencies remain present.

## Required clean-machine walkthrough

Run the exact hashed artifact independently on Windows 10 and Windows 11 x64:

1. Record SmartScreen and current-user installation; do not require administrator access.
2. Confirm the first launch is blank and share-clean.
3. Add a titled local PDF, reopen it in Score and restart the app.
4. Create folders/subfolders; move, complete, archive/restore and remove a test piece.
5. Run a keyboard/mouse practice set with metronome/chimes; confirm History/Calendar persistence.
6. Confirm Mic, hands-free commands and Listen Back are clearly unavailable.
7. Uninstall and reinstall; record what app data remains and whether the contract is understandable.

## Known boundary

This first Windows port is not voice/audio parity. It excludes `hear`; Mic/voice/Listen Back,
macOS `say` and system-volume boost are unavailable. No Windows signing certificate exists, so an
unsigned SmartScreen flow is expected. Neither limit is closed by a successful build.

## Next steps

1. Attach the complete Windows workflow results and exact artifact facts.
2. Run and record both clean-machine walkthroughs.
3. Update the draft version record and living docs, then commit/tag/push only if every required
   package gate passes. Keep recipient acceptance pending until both systems are exercised.
