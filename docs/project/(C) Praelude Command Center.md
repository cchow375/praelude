# Praelude — Command Center

**Last updated: 2026-11-13. This Mac:** canonical GitHub Mac source is checked out at `/Users/christian/praelude` (base `6447c65`, `main`). macOS 26.6.2/arm64, Xcode 26.6, Node 25.9.0/npm 11.12.1 and rustup-managed Rust/Cargo 1.100.0 are available; lockfile-exact JavaScript setup and the frontend build/suite pass. Native checks also pass: 1,106 unit tests/18 ignored plus 28 integration tests/2 ignored; the debug native executable compiles. Independent live mock navigation passes. No Praelude app is installed on this Mac. Its existing legacy app-data directory is kept outside all launch/tests. The mobile notes below are a retained September handoff: GitHub's current branches contain no `ios/`, and commit `124707d` cannot be resolved there. Recover that source before mobile work. The existing npm lockfile reports 10 audit advisories (3 moderate, 7 high); dependency remediation is pending. Current setup evidence: `docs/qa/setup-2026-11-13.md` in the code repository.

**Historical Mac release boundary (original Mac, last verified 2026-09-08): Praelude v11.1.0 / schema 21 — SHIPPED + INSTALLED.** Installed at `/Applications/Praelude.app` at 16:58 EDT on 2026-09-08; implementation `c411e7b`. Fresh native launch, real Score and Variants dialog pass. All 46 database tables and DB bytes are unchanged from the fresh backup.

**Native boundary:** v11.1.0 launches and renders the real Beethoven Op.90 movement 2 score, selected passage and Variants dialog. The earlier Desktop/Score permission blocker is cleared. Progressive rep/set/chain effects passed independent live browser review; native audible quality, voice/chime overlap and Christian’s motivation verdict remain open. Cover-picker selection/save (B109), microphone/Steinway, real mapping and Windows acceptance remain separate.

This is the live entry map. Historical release detail belongs in [[(C) Changelog]] and `versions/`; historical implementation phases remain in [[(C) Roadmap]]. Never restart an old lane from a stale snapshot.

## Current work

**Active task:** prepare the GitHub Mac checkout on this computer. Frontend/native checks and fresh-context live mock verification pass; the setup record is complete. The mobile material below is historical handoff context, not source present in this clone.

**Historical mobile work (source absent here) — 1.1.0/build2/schema2 DEVELOPMENT CANDIDATE, scoped verification complete:** visual passage boxes,
PencilKit ink, recorded-target history, annotated-PDF sharing/Print, metronome and reward controls
were described in the independent native target. Historical original-machine links (unavailable here pending B116 recovery): [mobile guide](/Users/c3/praelude/ios/README.md),
[task context](/Users/c3/praelude/ios/AGENTS.md), [development](/Users/c3/praelude/ios/docs/DEVELOPMENT.md),
[install/renewal](/Users/c3/praelude/ios/docs/INSTALL_ON_IPAD.md), [workflow guide](/Users/c3/praelude/ios/docs/USING_MOBILE.md)
and [mobile roadmap](/Users/c3/praelude/ios/docs/ROADMAP.md). The recorded mobile workspace is absent from this clone.

**Current QA:** 29 core tests, 2,166 service assertions, 28 fake-device helper tests and 36/36 native hosted tests
on each simulator pass. The final-toolbar iPad9 selected run passes 3/3: finger 59.497 s, meter 61.653 s,
Focus 23.719 s. iPad7 supplies box editing/relaunch and accessibility markup in both orientations;
five targeted iPad scenarios pass across runs. Phone3 passes 36 hosted plus 3 selected UI, and Phone2
supplies the other four UI passes: seven distinct phone scenarios pass across runs. Phone4 also passes its final-toolbar finger 91.652 s/meter 84.624 s recheck. Final exact-source signed Release verification passes. Earlier failed runs remain
failed; no all-green full-scheme or physical-feature claim is made.

Phone3 pre-Undo/after-Redo images verify visible ink after the PDF/PencilKit gesture correction.
The 44-point toolbar entry and corrected offscreen meter-test guards now pass on iPad9. The
historical phone backup UI gap is closed by Phone3 simulator evidence. This update's complete
file preservation passes; physical Pencil and in-app backup/restore acceptance remain open. See [current QA](/Users/c3/praelude/docs/qa/ios/1.1.0/README.md).

**Installed mobile candidate, launch pending:** the iPad now reports **1.1.0/build2**, installed
at 20:56 EDT on September 14 from source `124707d`. Complete private copies before and after
installation match all owned file names, byte counts and SHA-256. The preserved ledger is schema1;
first-launch schema2 migration has not been accepted. Automatic launch was denied with a generic
security/unlock error, with exact cause unproven. User unlock/open and conditional Developer App
trust are pending; this is not physical-feature acceptance. The signed candidate remains at ignored
`releases/ios-personal-1.1.0/Praelude.app`, with profile expiry September 21 at 21:24:58 UTC.

Earlier PDF-copy probes and the 20:50 refresh failed before installation. The 20:52 Xcode container
download failed on a SplashBoard snapshot cache with CoreDevice7000/POSIX1; only partial caches
were obtained. Complete copying succeeded after the user reported ready, clearing the former hold.
The helper retained both verified copies and used no deletion, reset, restore or explicit termination.

**Historical native baseline:** 1.0 installed at 17:51 EDT with Developer Mode enabled; the initial
launch request encountered developer trust. Later user activity does not replace a controlled
launch/feature verdict. Its app and QA remain unchanged: 22 core, 2,041 service, 13 hosted per
simulator, 8/8 distinct iPad and 7/8 phone UI across runs. Phone3 now closes the complete phone backup UI gap with simulator evidence; physical in-app backup/restore remains open.
B115 keeps physical/distribution, Mac-sync and unported feature limits open. Mac v11.1.0/schema21
and its personal data are untouched; Assistant stays off/on hold.

Project portability is now part of the canonical private repository. `docs/project/` mirrors the
living manual and every Markdown version record; `docs/NEW_MAC_SETUP.md` separates a safe developer
clone from an unverified transfer of personal practice state; `npm run doctor` checks prerequisites,
`npm run setup:mac` performs lockfile-exact JavaScript setup, and `npm run docs:check` prevents the
vault mirror from silently drifting. The old absolute-vault dependency and stale README/CLAUDE
entry points are removed. Personal databases, scores, media, secrets, app bundles and release
backups remain outside Git by design.

The Rep Counter now builds a luminous core, orbital arcs, a filling ring and progressively richer sparks as the current clean target fills. Sloppy/Again send falling fragments and deepen amber to coral on successive setbacks, capped at three. Set completion gets a larger radial bloom; a fully completed variant chain gets the largest gold finale. Original offline pluck/glass/air sounds rise and gain harmonics with progress, vary their ornaments, descend on setbacks and resolve into richer set/chain chords. Existing practice rules are unchanged: Total plays retains earned volume, and Again preserves variant-stage progress. No added XP penalty or automatic musical judgment.

Final frontend **2,614 passed / 1 skipped** (214 files passed / 1 skipped, four workers); native **1,106 passed / 18 ignored plus integrations**; TypeScript, production/native builds, strict Clippy and Rustfmt pass. Independent 1280×720 and 720×520 live review verifies clean/setback/undo, fifth-clean set completion and a Dotted 2 → Reverse dotted 3 chain. Audio-device failure, cleanup, gesture unlock and reduced-motion behavior have automated/source coverage. The sandboxed macOS speech probe and one concurrently loaded Listen Back assertion failed before authorized/native and four-worker full reruns passed; the QA ledger retains those limits.

Post-install comparison proves all **46 tables** and DB bytes exactly equal to the fresh backup: schema21, integrity OK/FK0, **11 pieces / 353 blocks / 3,242 reps / 64 sessions / 11,804 session events / zero open sessions or blocks**. DB SHA-256 `7aa93e4ef23834875e60b2c9a3946ddf2c522116044cf4cd54900bc6a71594b5`. No synthetic practice or preference changes were written for acceptance.

## Open threads

- [x] This Mac development verification: doctor, locked setup, frontend/native checks, debug compilation, fresh-context live mock review and unchanged personal-data hashes; evidence in repo `docs/qa/setup-2026-11-13.md`.
- [ ] Recover mobile `ios/` source/commit `124707d` missing from GitHub branches (B116).
- [ ] Review the 10 current npm audit advisories without treating setup as dependency remediation (B117).

- [x] Mobile 1.1.0 scoped simulator checks and final exact-source signed Release verification.
- [x] Device update: 1.1.0/build2 installed at 20:56 EDT; complete owned-library pre/post file comparison passes.
- [ ] Controlled device launch and first-launch schema2 migration; unlock/open and conditional trust pending.
- [x] Mobile developer handoff and helper28 fake-device safety checks; this update's real full-copy gate passes.
- [x] Historical iPad cable install: Developer Mode enabled, 1.0.0/build1 confirmed at 17:51 EDT.
- [ ] Physical Pencil/audio/voice, interruption, accessibility, sharing/Print and backup acceptance (B115).
- [x] Complete phone backup UI: Phone3 export/cancel/restore/cancel passes; physical in-app backup/restore remains open.
- [ ] Native parity: Mac schema21 migration/sync, Listen Back, cloud mapping, full Studio economy,
      desktop warmups/history repair and broader forScore tools remain separate scope.
- [x] v11.1 progressive practice feedback, independent review, package/install and exact preservation. Runtime `c411e7b`; `docs/qa/v11.1.0/` is the current evidence ledger.
- [x] Fresh-Mac development portability: current manual/version records are Git-backed; clone,
      toolchain, bootstrap, verification and local-only state boundaries are documented and checked.
- [ ] Moving Christian's actual practice environment between Mac usernames/paths remains separate:
      stored library/PDF paths are absolute and need a verified relocation workflow, not a raw DB copy.
- [x] Native Score/Variants permission boundary: fresh installed v11.1 renders the real nine-page Beethoven score, passage controls and Variants dialog.
- [ ] Christian’s audible/practice verdict, including native voice acknowledgement overlap and sustained motivation.
- [ ] Custom-cover picker selection/save/restart (B109).
- [ ] Accounts, sync and friends: no service configured; local profile only.
- [ ] Windows9.1 native Windows10/11 acceptance; current candidate unchanged.
- [ ] Microphone/Listen Back over the Steinway and real-provider measure mapping. Assistant remains off.
- [ ] Whole-home one-copy audit is incomplete. This release removes its temporary build/rollback app copies and keeps archive backups. Old CodaKiller9 mounted installer media were observed; no exhaustive scan claimed.

## Evidence already obtained for v11

- Native Studio tests cover formula/rank boundaries, real practice projection, stale and corrupt state, duplicate/invalid purchases, corrections and on-disk reopen.
- A verified disposable live-DB copy kept **46 tables exactly unchanged except `motivation.studio.v1`** after durable profile/purchase changes; integrity OK, FK0. Derived **204 XP / 198 qualifying completed sets / Prelude 3 / 50 coins before purchase**. This is a rehearsal, not a mutation of Christian's live profile.
- Independent Studio and library reviews found actionable defects in dialog error visibility, mutation refresh, menu focus/rename and shared modal behavior. Final independent dock/library recheck passes with no remaining source blockers; 222 dock/Shell checks pass. Ephemeral user-action provenance preserves manual panel choices through persisted/delayed loads. Flaws B104–B106 and the QA ledger retain the diagnoses.
- Frontend **2,595 passed / 1 skipped** across **212 passed files / 1 skipped**; native **1,106 passed / 18 ignored plus integrations** with four test workers; TypeScript, production/native builds, format and strict all-target/all-features Clippy pass. Final independent dock/library review found no remaining source blockers; broad dock/Shell checks passed 222, with the two additional policy cases included in the passing full suite. Native Studio shows the actual 204 XP / Prelude 3 / 50 coins; Practice record shows 198 completed sets / 21h 9m. Library shows 4 Active / 5 Resting. Fresh launch passed twice.
- DMG `releases/v11.0.0/Praelude-11.0.0.dmg`: **10,691,711 bytes**, SHA-256 `dc51618396ecf532efa0a058a86f77a7451e186cac610c9d745f28da2d610417`. Runtime implementation `a33858139430b99bd22c8a2d0fa06fa6b1b2f4f1`; the app was built from the same unchanged production files immediately before that commit. Installed arm64 CDHash `eb19805326b4008e3a5cac1ed6bfcf472c870e98`; ad-hoc signed, not notarized; privacy strings verified. Release tag `v11.0.0` points to `c8e31b8e14bd3470d99be4852f7687e7a5a53f63`; the tag and private `origin/main` were pushed successfully. Read Git for the moving main tip after documentation-only follow-ups.
- Backup `/Users/c3/Library/Application Support/Praelude Release Backups/v11.0.0-2026-09-07-2340/pre-v11.0.0.db` (35,004,416 bytes), SHA-256 `b285c5a0624769aeccc27a2543f9b414eb1b22750fa2c551e60f02cfee553cb4`; rollback `/Users/c3/Library/Application Support/Praelude Release Backups/v11.0.0-2026-09-07-2340/Praelude-10.1.0-rollback.zip` (9,778,474 bytes), SHA-256 `1b9647ce671feab84e23c0da66d0fd5351e19c1f2fc8e2908432e252a7e24d40`. Pre-install audit was captured 2026-09-07 at 23:41 EDT with the native app quit and zero open rows.

## The product boundary

**User-as-sensor; deterministic hot loop; suggest, never dictate; small tested modules; honest acceptance.** Studio celebrates commitment and stays out of the rep/metronome loop. It contains no purchases with real money, randomized rewards or public skill rank. A first-ever installation is generic and blank. Legacy identifiers are data compatibility only.

## Where things live

| Need | Open |
| --- | --- |
| Mobile source recovery | B116 in [[(C) Flaws]]; historical `ios/README.md` and `ios/DESIGN.md` are absent from this checkout |
| Binding process and install preference | [[AGENTS]]; Git mirror `docs/project/AGENTS.md` |
| Portable current overview | [[Praelude]] |
| Installed tutorial | [[(C) How To Use]] |
| Why the product exists / motivation pivot | [[(C) Motivation]] |
| Current plan and historic phases | [[(C) Roadmap]] |
| Open and resolved problems | [[(C) Flaws]] |
| Chronology and exact release facts | [[(C) Changelog]] and `versions/` |
| Code, tests, engineering facts | private GitHub `cchow375/praelude`, especially `AGENTS.md`, `docs/NEW_MAC_SETUP.md` and `NOTES.md` |
| Current v11.1 spec and QA | repo `docs/superpowers/specs/2026-09-08-practice-resonance.md`, `docs/qa/v11.1.0/` |

## Next steps

Use the next real practice session to judge the escalating visual/audio rewards, native voice/chime overlap and motivation. Finish cover-picker selection → rendered cover → restart when controllable. Microphone/Steinway, real-provider mapping, accounts/social and Windows-native acceptance remain separate. Assistant stays OFF and ON HOLD.

## Parent

[[Piano Practice]]
