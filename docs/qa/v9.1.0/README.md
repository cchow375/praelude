# v9.1.0 Windows x64 QA Ledger

> **PACKAGED CANDIDATE LEDGER — NATIVE WINDOWS ACCEPTANCE PENDING.** Created 2026-08-31.
> Version 9.1.0, schema 21.
> Installed Mac remains v8.2.1/schema 20. The Mac v9.0.0 DMG facts are unchanged.

## Current verdict

**PACKAGE COMPLETE; NATIVE WINDOWS/RECIPIENT ACCEPTANCE PENDING.** The exact unsigned installer,
hash, cross-target gates, PE32+ x86-64 identity and recursive blank/share-clean audit pass. Native
Windows cargo tests were not run, and the artifact has not yet been installed or exercised on a
real Windows 10/11 system.

## Evidence matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Frontend tests | **PASS** | 205 files with 1 skipped; 2,540 tests with 1 skipped |
| TypeScript | **PASS** | `tsc` gate |
| Production frontend build | **PASS** | Vite production build |
| Native tests on Mac host | **PASS** | 1,111 passed; 19 ignored; 0 failed |
| Rust format on Mac | **PASS** | final source |
| Strict Clippy on Mac | **PASS** | final source |
| Windows-target check | **PASS** | `cargo-xwin check`, `x86_64-pc-windows-msvc` |
| Strict all-target Windows Clippy | **PASS** | cross-target gate |
| Native tests on Windows | **NOT RUN** | no Windows host was used |
| Official Tauri macOS cross-build | **PASS** | current-user x64 NSIS |
| Share-clean installer scan | **PASS** | frontend plus recursively extracted NSIS payload |
| Embedded application | **PASS** | PE32+ x86-64 |
| Package source commit | **PASS** | `2d33004888a97c3ebcb4b7799bf54029efd15626` |
| Exact Setup EXE path/name | **PASS** | `releases/v9.1.0/windows/CodaKiller-9.1.0-Windows-x64-Setup.exe` |
| Build time | **PASS** | `2026-08-31T19:31:59Z` |
| Exact bytes | **PASS** | 7,654,002 |
| SHA-256/sidecar | **PASS** | `e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4` |
| Signing | **UNSIGNED** | no certificate/signing step; SmartScreen warning expected |
| Authenticode/SmartScreen observation | **PENDING** | must be recorded on Windows |
| GitHub workflow | **REMOVED** | OAuth token lacked workflow scope; permission was not bypassed |
| Canonical package path | **PASS** | local `scripts/package-windows-cross.sh` |
| Windows 10 acceptance | **PENDING** | — |
| Windows 11 acceptance | **PENDING** | — |

## Completed artifact audit

- Exactly one versioned x64 Setup EXE is staged with a basename-only checksum sidecar.
- Filename/version/product target agree with v9.1.0 x64.
- The recursively extracted inventory contains no personal files, DB/SQLite, scores/PDF/MusicXML,
  Pieces Library, practice history, recordings/photos, copyrighted quote/book/method/Knowledge
  payload or macOS `hear` executable. It contains no personal or unremapped host paths; remapped
  `/build-user` paths intentionally remain.
- Required third-party notices remain present.
- Inert historical schema/migration metadata and `com.christian.codakiller` remain for compatible
  upgrades; neither is represented as personal user content. Windows upgrade and data
  preservation have **not** been exercised.

## Cross-build record

The package used Tauri's documented macOS→Windows build route rather than a Windows runner. The
GitHub workflow was removed because the current OAuth token lacked workflow scope. The first NSIS
attempt inherited `LC_ALL=C` and ended in a misleading `makensis` `std::bad_alloc`; the same
package step succeeded under `C.UTF-8`. `scripts/package-windows-cross.sh` is now the canonical
non-installing local path. It validates its stable Rust/cargo-xwin/LLVM/NSIS/7-Zip inputs and does
not install dependencies or mutate the Rust toolchain.

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
system TTS and automatic system-volume boost are unavailable. No Windows signing certificate
exists, so an unsigned SmartScreen flow is expected. Native Windows install/relaunch,
picker/PDF, audio, persistence, Authenticode/SmartScreen and uninstall evidence are all pending.
Neither that evidence nor native Windows cargo tests can be inferred from the successful
cross-build. Installed Mac truth remains v8.2.1/schema 20.

## Next steps

1. Run the exact hashed installer on clean Windows 10 and Windows 11 x64 systems.
2. Record both clean-machine walkthroughs, including Authenticode/SmartScreen and audio behavior.
3. Keep native Windows and recipient acceptance pending until both systems are exercised; then
   update the draft version record and living docs with measured results only.
