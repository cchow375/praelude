# v8.2.1 — compact composer + safe day-close/camera correction QA

> **Status: SHIPPED + INSTALLED 2026-08-28; release tag/publication pending.** B94 source commit
> `d1e7ac6d09528f22d8becb378f26c66d751ac297`; B95/runtime commit
> `496033e677919757ef1f2a78cee32d3abedb4805`. This record covers the compact-composer correction
> and the installed end-session camera/TCC crash. Package, install, privacy strings, artifact,
> before/after data and fresh launch now pass. Native Score feel, real microphone/Steinway use and
> provider mapping remain separate acceptance gates. Schema remains 20.

## Installed incident evidence — B95

- Installed v8.2.0 closed session **48** and preserved its data, then exited less than one second
  later.
- `DayPhotoCapture` mounted after the ordinary **End session** path and requested camera access
  automatically. The packaged Info.plist did not contain `NSCameraUsageDescription`; macOS TCC
  terminated the process with `SIGABRT` before JavaScript could recover.
- Six retained crash reports spanning v7.0–v8.2 carry the same signature.
- The orphan `hear` PID left behind by the fatal abort was cleaned up.

This is the incident diagnosis. The installed v8.2.1 bundle now includes the required camera
description, and source/packaged release gates below close B95 without rewriting its history.

## Accepted 720x520 interaction

- The measure range is one two-column row: **From measure / To measure**.
- Tempo is one two-column row: **Start BPM / Target BPM**.
- **Practice focus** and the compact **Metronome** toggle share one row.
- **Set target** keeps target mode and count on one row at the supported rail width.
- **Start set** lives in the composer header, remains immediately visible, and stays pinned while
  optional composer controls move beneath it.
- Variant presets remain a single horizontal chip line; the custom text field is absent until
  **+ Custom** is pressed, then receives focus.
- Tricky Sections remains the sole vertical scroll owner. The composer introduces no nested
  scrollbar and the narrow rail has no horizontal overflow.

This evidence verifies the browser source layout at the stated viewport. It does not upgrade the
still-open packaged-native Score feel gate.

## Source-resolved day-close contract

- Plain **End session** closes only the session and cannot open the photo card or request a camera.
- **End my day** still requires inline confirmation. Only the confirmed end-of-day path offers the
  optional photo card.
- Merely showing the card requests no privacy-sensitive device. Camera acquisition starts only
  after explicit **Use camera**.
- A synchronous API failure and an asynchronous permission rejection both land in the existing
  drop/choose-file path. Skip and Escape remain immediate; acquired tracks are stopped on finish
  or unmount.
- `src-tauri/Info.plist` now contains a truthful `NSCameraUsageDescription` saying camera use is
  only for a user-chosen practice-day photo.
- The release script now fails a built bundle missing any of `NSCameraUsageDescription`,
  `NSMicrophoneUsageDescription`, or `NSSpeechRecognitionUsageDescription`.

## Automated gates

- Full frontend: **2,684 passed / 1 skipped / 0 failed** (**212 files passed / 1 skipped**).
- Native: **1,109 passed / 19 ignored / 0 failed**.
- B95 focused crash-path regressions: **67/67 passed**.
- TypeScript, strict Clippy, production build and native build: **PASS**.
- Source Info.plist validation, release-script shell syntax and diff checks: **PASS**.
- Five narrated corpora: **zero false mutations**.
- Release pipeline: **all eight gates PASS**.
- Runtime persistence/schema: unchanged; schema remains 20.

## Release evidence

- [x] Source version metadata agrees on 8.2.1 across package/package-lock, Cargo/Cargo.lock and
      Tauri configuration.
- [x] Pre-install backup:
      `/Users/c3/Desktop/christian's universe/Piano Practice/CodaKiller/(C) pre-v8.2.1-install-2026-08-28-132046.db`,
      **23,449,600 bytes**, SHA-256
      `2c99dec1c3bc14f595e69c92a9415076299752d46930eea0fa3c9f5a793379c7`.
- [x] Read-only backup audit: schema 20, integrity OK/FK0; 11 pieces, 246 blocks/contracts,
      2,207 reps, 48 sessions, 8,391 events, zero open sessions/blocks.
- [x] Full frontend/native/build/release-script candidate gates.
- [x] Installed `/Applications/CodaKiller.app`: plist short/build **8.2.1**, bundle
      `com.christian.codakiller`; strict ad-hoc signature PASS; CDHash
      `f0460dcb3b62825ea29328a32489987364b19828`.
- [x] Installed plist contains exact non-empty Camera, Microphone and Speech Recognition usage
      descriptions.
- [x] DMG `/Users/c3/codakiller/releases/v8.2.1/CodaKiller-8.2.1.dmg`:
      **10,907,287 bytes**, SHA-256
      `6ce58b77b32642c644df1c0b42d2c89ea745a75e28c7891a484190ad111c61dd`.
- [x] v8.2 rollback archive
      `/Users/c3/Library/CodaKiller-rollbacks/CodaKiller-v8.2.0-rollback.app.tar.gz`:
      **10,057,883 bytes**, SHA-256
      `da29be1e96c120f2c27994fc2d83c26a5c8bc9a40c08b2f87097b0e82a117b71`.
- [x] Before/after live database audit: schema 20, integrity OK/FK0; exact 11 pieces,
      246 blocks/contracts, 2,207 reps, 48 sessions, 8,391 events and zero open sessions/blocks.
- [x] Fresh installed launch: app PID **46013** remained live with its owned `hear` child; no new
      crash report appeared. The latest report remained the prior 13:09 v8.2.0 TCC abort.
- [ ] Pushed release tag/publication.
- [ ] Installed-native 720x520 Score/composer interaction verdict (tracked separately as B91).

## Next steps

Publish the release tag without changing the installed runtime identity. Then deliberately handle
Desktop access and repeat the exact composer/continuous-Score walk in the installed app. Keep
microphone/Steinway, authorized provider mapping and sustained motivation as separate evidence
gates.
