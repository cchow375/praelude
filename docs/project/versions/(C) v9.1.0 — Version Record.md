# CodaKiller v9.1.0 — Windows x64 Port

> **DRAFT PACKAGED-CANDIDATE RECORD — NOT IMMUTABLE.** Updated 2026-08-31. **v9.1.0 /
> schema 21 is a packaged, sendable Windows x64 candidate; it is not installed or accepted on a
> real Windows 10/11 system.** The exact installer, hash, recursive cleanliness and embedded x64
> application are proved. Windows-native cargo tests and all real Windows interaction evidence
> remain pending. Installed Mac remains v8.2.1/schema 20. The packaged, uninstalled Mac v9.0.0
> candidate is unchanged.

## Release identity

| Fact | Value |
| --- | --- |
| Product | CodaKiller |
| Packaged candidate | 9.1.0 |
| Database schema | 21 — unchanged from v9.0.0 |
| Target | Windows 10/11 x64 · current-user NSIS Setup EXE |
| Installed Mac version | 8.2.1 / schema 20 |
| Source/package implementation commit | `2d33004888a97c3ebcb4b7799bf54029efd15626` |
| Windows release/docs commit | `f296f3cb38ae5d29c1ae813493f5c37ea07ed9a6` |
| Tag | Lightweight `v9.1.0` → `f296f3cb38ae5d29c1ae813493f5c37ea07ed9a6` |
| Private remote publication | **PASS — `origin/main` and `v9.1.0` pushed; both currently resolve to `f296f3c`** |
| Setup EXE path | `/Users/c3/codakiller/releases/v9.1.0/windows/CodaKiller-9.1.0-Windows-x64-Setup.exe` |
| Setup EXE bytes | **7,654,002** |
| Setup EXE SHA-256 | `e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4` |
| Package timestamp | `2026-08-31T19:31:59Z` |
| Installer type | NSIS · current user |
| Embedded application | **PE32+ x86-64** |
| Authenticode | **Unsigned by construction; native Authenticode verification PENDING** |
| Windows-native cargo tests | **NOT RUN** |
| Windows 10 acceptance | **PENDING** |
| Windows 11 acceptance | **PENDING** |
| Release date | **PENDING — packaged candidate created 2026-08-31** |

## Why this version exists

Christian wants to send the same blank practice app to a pianist friend who uses Windows 10 or
11. v9.1 is not a friend-specific fork. It ports the generic v9 Pieces Library/share-clean product
to Windows and preserves the no-Christian-data/no-copyrighted-pedagogy package boundary.

## Candidate contract

- A fresh install is designed to start with a blank app-owned Pieces root and no user content.
- Pieces opens to **Library | History | Calendar**, with nested folders, Unfiled,
  Active/Completed/Archived and right-click/ellipsis actions.
- Add Piece accepts a title, optional composer/folder and a chosen or dropped local PDF.
- Score, keyboard/mouse practice, metronome/chimes, History, Calendar and local persistence are
  included in the first Windows core.
- NSIS installs for the current user. WebView2 downloads only when the machine does not already
  have it.
- The Windows bundle excludes the macOS-only `hear` executable and remains share-clean.

## Deliberate first-port limits

- **Mic and hands-free voice are unavailable.** No Windows STT runtime has been implemented.
- **Listen Back is unavailable.** Its native microphone-ownership/capture contract is not ported.
- **System TTS and automatic system-volume boost are unavailable.**
- There is no Windows code-signing certificate. The exact installer is unsigned, so SmartScreen
  friction is expected; its real behavior is not accepted yet.
- Windows on Arm, automatic updates, signed/warning-free distribution and voice parity are not
  candidate claims.

## Privacy and share-clean boundary

The recursive blank/share-clean artifact audit passes. It found no personal files, database,
scores, Pieces library/history, personal or unremapped host paths, or copyrighted pedagogy payload
in the distributable. Intentional `/build-user` remapped build paths remain. The inert historical
migration metadata/identifiers and existing bundle identifier remain to support compatible
upgrades, but Windows upgrade/data preservation has not been exercised. This is intentionally
narrower than claiming those inert identifiers or remapped paths never existed. No installed Mac
application or live database was touched.

## Evidence

| Gate | Result |
| --- | --- |
| Frontend tests | **PASS — 205 files with 1 skipped / 2,540 tests with 1 skipped** |
| TypeScript | **PASS** |
| Production frontend build | **PASS** |
| Mac native tests | **PASS — 1,111 passed / 19 ignored / 0 failed** |
| Mac strict Clippy | **PASS** |
| Rust format | **PASS** |
| Windows `cargo-xwin check` | **PASS** |
| Windows cross-target strict Clippy | **PASS** |
| Windows-native cargo tests | **NOT RUN** |
| Windows Tauri/NSIS cross-build | **PASS** |
| Recursive share-clean EXE inspection | **PASS** |
| Embedded application architecture | **PASS — PE32+ x86-64** |
| Exact EXE identity/hash | **PASS — values recorded above** |
| Blank Windows first launch | **PENDING** |
| Native Add Piece/picker/PDF/Score | **PENDING** |
| Native metronome/audio | **PENDING** |
| Practice/history persistence and relaunch | **PENDING** |
| Authenticode/SmartScreen | **PENDING** |
| Uninstall/reinstall | **PENDING** |
| Clean Windows 10 recipient | **PENDING** |
| Clean Windows 11 recipient | **PENDING** |

Cross-compilation and artifact inspection prove that the package was produced and that its static
boundary is clean. They do not prove launch, WebView2 bootstrap, native picker, PDF rendering,
audio, persistence, Authenticode/SmartScreen or uninstall behavior on Windows.

## Packaging notes

- Tauri's documented local macOS cross-build is the canonical package path. A GitHub Windows
  workflow was removed because the available GitHub token lacks `workflow` scope; that permission
  boundary was not bypassed.
- An ASCII `C` locale made Unicode NSIS crash with a misleading `bad_alloc`. Running the packaging
  step under `C.UTF-8` fixed the environment and produced the exact artifact recorded above.
- CPAL 0.18.2 keeps its `windows` and `windows-core` dependencies aligned, resolving the original
  Windows cross-build trait mismatch. Strict Windows cross-target Clippy passes.

## Next steps

1. Run Windows-native cargo tests.
2. Install this exact hashed EXE on clean Windows 10 and Windows 11 systems. Record
   Authenticode/SmartScreen, first launch and WebView2 behavior.
3. Verify blank Library, Add Piece/native picker, PDF/Score, folders/states/context actions,
   keyboard/mouse practice, metronome/audio, History/Calendar persistence, relaunch and
   uninstall/reinstall.
4. Keep this record draft until those native-recipient gates pass. Voice, Listen Back, system TTS
   and volume boost remain a separate future Windows-audio project unless actually implemented and
   native-tested.
