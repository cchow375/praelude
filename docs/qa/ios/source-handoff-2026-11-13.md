# iOS source handoff — November 13, 2026

Christian requests the complete iPhone/iPad source on GitHub to continue development on another
computer, then explicitly chooses to keep the existing `cchow375/praelude` repository public.
The repository stays together: `ios/` is the native app, `supabase/` holds its backend contracts
and migrations, and `docs/project/` supplies the project manual on a Mac without the vault.

## Source and publication boundary

- Starting local commit: `2e65a7f61ea947c2c26aaea4395f94962391453c`; remote `main`:
  `6447c65b8e295e18d9f1c6aa7085e46745a53dee`, 177 commits behind.
- Initial audit finds all 347 existing iOS files tracked, including 303 `.swift` files (302
  excluding `Package.swift`), and all 42 Supabase files. No missing source/assets, submodules,
  or absolute Xcode source paths; all 261 Xcode file references exist.
- Ignored native files are expected build/package caches, editor state and local signing config.
  A limited scan of the 2,421 unique blobs in unpushed history finds no credential-pattern matches
  or excluded database, local signing/profile/key paths.
- New handoff entry: `ios/docs/NEW_MAC_SETUP.md`; root/iOS entry points link it. Root Mac setup
  corrects the native schema/QA references and no longer calls the public repository private.
- No application logic, data schema, backend contract, signing identity or installed app changes.
  Version stays native 2.0.0/build21/schema5. Existing candidate tags keep their original identities.

## Clean checkout and retained failures

A clone into a separate temporary directory contains no original DerivedData, local signing file
or private practice files. Regeneration initially matches the committed Xcode project exactly.
Verification uses Xcode 26.6 (17F113), iOS Simulator SDK 26.5, and the committed SwiftPM lock.

1. Initial generic Debug simulator build fails: `ld: framework 'Helpers' not found`. The project
   manually links Supabase's internal Helpers framework, while a fresh build creates Helpers.o.
2. A diagnostic `OTHER_LDFLAGS=$(inherited)` retains the inherited flag and fails identically.
3. Removing the manual framework flag alone leaves a test build that still
   fails with undefined Helpers symbols. Xcode wraps the four overlapping products when both the
   app and hosted tests link them independently.
4. An isolated umbrella-Supabase-product diagnostic passes `build-for-testing`; it is not the final
   configuration because the existing app's four-product dependency set can be preserved.
5. Final configuration removes the manual framework flag and duplicate package links from the
   hosted test target. The tests retain their app dependency, `TEST_HOST` and `BUNDLE_LOADER`.
   Generator and generated project carry the same change; package pins and app products stay exact.

The initial concurrent core run executes 556 cases with one optional private-library timing skip
and one failure: `ScoreAsyncPracticePersistenceTests.testLargeInkRecordAndBookmarkPreparationAllowMainActorHeartbeat`
observes one heartbeat where two are required. A serial full rerun passes 556 cases, one skip,
zero failures, plus 2,340 deterministic service assertions. Scheduling contention is plausible,
but no root cause or physical responsiveness fix is claimed. Device-helper tests pass 57/57.

## Final verification

Final simulator build and independent hosted runtime verification are pending.
Project portability and the Markdown mirror checks pass. Final publication requires matching
local/remote `main` and an independent GitHub clone readback.

## Next steps

On the second Mac, clone or pull `main`, read `ios/docs/NEW_MAC_SETUP.md`, open the Xcode project
and run simulator checks. Git does not transfer personal practice files, private media, sessions,
certificates, provisioning or backups. No physical device is operated by this handoff, and no
new camera/audio/Pencil/gesture/sync acceptance is claimed.
