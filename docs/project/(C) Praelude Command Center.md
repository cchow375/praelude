# Praelude — Command Center

## October7 — build7 installed on the personal iPad

Guarded same-bundle refresh installs2.0.0/build7/schema5 from source `3e03330`. Independent full pre/post inventory review proves all11 owned files/7,981,365bytes identical by filename,size andSHA256, including scores, annotations, history, account ownership/privacy/preferences. Pre-launch schema5/revision1647 has5pieces/44passages/43historical sets/30sessions/255unique attempts; retained active set is completed, with no running set. No schema migration, import, restore, uninstall or Mac change occurred.

Actual signed device Release passes strict signature, app/profile/team agreement, signer-certificate membership/trust and helper device inclusion; fixture arguments/debug diagnostics/test plug-ins are absent. Profile expiresOctober10 at17:55:53UTC (1:55PM EDT). Automatic launch failed; subsequent read-only device inspection confirms Praelude running and schema5/revision1660. Independent post-launch review retains all255 attempts,44set IDs,30sessions and every original45ink record, plus exact profile/privacy/preferences. A completed set is archived and newer ink/reward/page activity is observed; no author or automatic-startup attribution is inferred. User screen-quality confirmation remains separate. Source/native simulator verification remains distinct from physical Pencil/audio/freeze/long-session/real-account two-device acceptance. Exact sanitized evidence: `docs/qa/ios/2.0.0/build7/personal-ipad-install.json`; private complete backups stay outside Git.

**Next steps:** use the installed build7 for real practice to verify sustained Pencil/eraser/Undo/layer/page transitions and responsiveness. Renew with the same app/team before the actual profile expiry.


## October6 — iOS stability and responsiveness candidate

**Mobile current source: 2.0.0/build7, schema5, DEVELOPMENT CANDIDATE. Personal iPad now has build7 (October7); device running-process and schema5 readback are confirmed.** Christian reports freezes requiring force quit, lagging/disappearing ink and crowded controls. This repair preserves the native format, score source geometry and user-supplied practice verdicts.

Native testing reproduced a stamp-switch freeze in UIKit responder teardown. The canvas stays enabled; overlay hit routing handles selection/stamps/text/read-only states without disabling the focused canvas.

Drawing samples now mark a canvas dirty without repeatedly serializing it or rewriting practice data. Autosave waits for a 600ms idle interval; page/mode/layer/background/exit transitions still require a successful save. Failed checkpoints remain recoverable, and Keep my drawing uses the newest dirty canvas. Long strokes receive bounded content identities; partial-erasure masks participate in identity. Corrupt saved ink stays read-only instead of masquerading as an empty page. A non-observed drawing cache avoids recursive view invalidation and evicts old pages while pinning live/failed-save baselines.

Page/link/passages/cover/heatmap previews use serial background renderers, bounded pixels and image-memory costs. Offscreen cover requests cancel queued work after their last viewer leaves, while shared visible requests survive cancellation. Neighbor-page speculative rendering no longer races the displayed PDF. Stamp glyphs and inactive-layer images have bounded retention. Annotation tools use a shallow icon strip with accessible names; long tool trays scroll within half the usable workspace height. Geometric stamps retain fixed size with named44-point buttons. Short landscape annotation starts at stave width, restores prior portrait zoom after automatic fitting, and preserves a deliberate pinch. The phone resume banner stays above the tab bar, including secondary screens. Warmup Close and practice controls remain anchored while the central readout scrolls in short windows. Today uses a 44-point reorder menu. The metronome preset row now has a full-width44-point hit target. Independent native screenshots drive intrinsic annotation-footer sizing, preserving score space. Compatible iPhones opt into higher refresh rates; iOS still chooses actual frame pacing.

Ink matching and session validation/projection use indexes; reward catch-up batches writes without combining or inventing awards. Tuner analysis admits one window at a time. Sync rejects canceled/old-account pulls, yields during large pulls and hashes private files off the UI actor. Search/avatar/profile previews and measure scans cannot overwrite newer requests. Notebook multi-delete captures IDs before the list changes. Metronome settings no longer subscribe to animated beat progress. Live meter rows capture stable accents so an older SwiftUI row cannot index a changed list. A retained background click survives a delayed foreground pause observer, while explicit Stop and later manual pauses still stop it. Annotated sharing captures saved data, yields between pages and cleans partial canceled output; photo-to-PDF composition runs off the UI actor.

**Verification:**394 core tests,2,211 service assertions and54 Python tests pass. Native hosted215 execute per form factor with1 live-account skip/zero failures. Eight phone UI cases and a stricter rotation/Done rerun pass; four iPad UI cases plus the corrected metronome retry pass. Independent final phone/iPad visual review accepts these scoped layouts. A fresh arm64 device Release compiles as2.0.0/build7 with fixture arguments, debug diagnostics and test plug-ins excluded. Failed aggregates remain recorded in `docs/qa/ios/2.0.0/build7/stability.md`; source tag is `ios-v2.0.0-build7-candidate`. Physical installation and complete-file preservation pass; physical Pencil, sustained refresh-rate and real-account/two-device acceptance remain open.

**Open limits:** full-library JSON encoding/atomic writes, large import/backup/restore and a single complex PDF page/final export rewrite can still block the UI. These require a separate persistence/rendering design and real-device profiling. Background work and simulator screenshots cannot prove a fixed 120fps rate or eliminate every freeze. Mac remains v11.1.0/schema21; Assistant remains on hold.

**Next steps:** verify sustained real Pencil/practice behavior on the installed build7 after the completed guarded update and schema readback. Verify sustained physical Pencil/eraser/layer/page transitions during practice, large actual scores, interruptions and real-account second-device continuity.


**Last updated: 2026-10-07. Praelude v11.1.0 / schema 21 — SHIPPED + INSTALLED.** Installed at `/Applications/Praelude.app` at 16:58 EDT on 2026-09-08; implementation `c411e7b`. Fresh native launch, real Score and Variants dialog pass. All 46 database tables and DB bytes are unchanged from the fresh backup.

**Native boundary:** v11.1.0 launches and renders the real Beethoven Op.90 movement 2 score, selected passage and Variants dialog. The earlier Desktop/Score permission blocker is cleared. Progressive rep/set/chain effects passed independent live browser review; native audible quality, voice/chime overlap and Christian’s motivation verdict remain open. Cover-picker selection/save (B109), microphone/Steinway, real mapping and Windows acceptance remain separate.

This is the live entry map. Historical release detail belongs in [[(C) Changelog]] and `versions/`; historical implementation phases remain in [[(C) Roadmap]]. Never restart an old lane from a stale snapshot.

## Current work

**Historical October3 mobile source: 2.0.0/build6, schema5, DEVELOPMENT CANDIDATE.** Christian's physical build4 feedback drives this round: Pencil did not draw without finger mode, black marks/stamps were invisible, annotation could freeze during a set, passage navigation was slow and ambiguous, and score chrome took too much space. Build5 implements fixes and new controls and is personally installed on the iPad. Complete pre-launch file preservation and actual schema5 upgrade pass; physical Pencil/freeze acceptance remains open.

**Build6 compact practice correction:** Christian found build5’s dock still too tall, especially Start without grading, Techniques and More options. The fixed width cap is removed. Wide setup uses two columns; those secondary actions share a shallow44-point row. Grading/verdict buttons use horizontal icon/text and52-point targets; running status, direct tempo, transport and verdicts share a row when the available width fits. Narrow windows reflow and accessibility text retains wrapping/scrolling. Six scoped iPad cases pass, including actual grading/Undo, portrait/landscape geometry and largest-text reachability. Setup is143pt and running100pt; secondary controls44pt, verdicts52pt. Two scoped phone cases also pass portrait/landscape geometry and actual grading/Undo. Independent final visual review passes. Build6 is now installed on the physical iPad after the October3 guarded update. Renewed provisioning is valid until October10 at17:55:53UTC (1:55PM EDT); actual Release signature/profile/team/device checks pass. Independent review confirms all11 owned files/6,212,619bytes exactly preserved, including practice history and account ownership/privacy. Pre-launch schema5/revision883 has5pieces/30passages/24historical sets/15sessions/114attempts and no active set. Automatic launch was declined; Christian confirms Praelude opened, and a direct ledger read confirms schema5/revision883. Native Pencil/freeze/piano and actual two-device acceptance remain open. Earlier signing attempts and renewal recovery are retained in `docs/qa/ios/2.0.0/build6/device-update-attempt.json`; installed evidence is `docs/qa/ios/2.0.0/build6/personal-ipad-install.json`. Layout evidence: `docs/qa/ios/2.0.0/compact-practice.md`.

**Score workflow:** a visible Library exit and compact bottom Practice / Select / Draw controls; passage Done at the bottom or score double-tap; distinct editable passage colors and an account-synced hide-boxes setting. Entering annotation retains the active set and its saved progress. PencilKit uses paper-light traits and deferred responder setup; finger navigation and optional finger drawing remain separate. Stamps have movable sized previews and a magnifier before Place. Yellow note chips expand locally with Edit/Close; failed saves retain the note text or stamp preview.

**Organization:** reviewed movement/book page ranges keep source PDFs, marks and history anchored while labels restart at section page1. PDF contents/bookmarks suggest sections; local Vision offers printed-number hints for review. Users confirm a measure or system region and its first/last numbers; newly drawn boxes inherit confirmed ranges, and older unlabeled passage/history displays derive fully covered confirmed ranges without rewriting snapshots. This is assisted mapping, not automatic optical music recognition. Passage lists group by page, sort measure numbers, and use bounded background thumbnail caches; history shows meaningful locations.

**Practice:** per-piece default tempo, visible pre-start metronome On/Off, stable Techniques with explicit Left hand/Right hand, less dock padding, a compact initial practice readout and width-fit Focus. Notebook New note opens directly. Rank progress leads Rewards; Studio stays secondary.

**Sync and preservation:** native profiles/privacy, instruments, practice records, score marks, goals/routines with deletion tombstones, movement/measure metadata, default tempo, account preferences and private score/recording/cover files have shared Supabase contracts. First sign-in reads the account before publishing defaults. Name/photo/privacy edits stage durably before local save and remain recoverable through failed saves, concurrent hydration, reverted retries and same-account sign-out. Local edits request debounced sync; unchanged remote adoption does not rewrite the ledger. Canonical lowercase owner-folder UUIDs fix a file-policy mismatch. Absent SQL columns and unknown preference keys survive older clients; other nested schemas remain versioned. Nullable clears remain explicit. Schema5 preserves the exact old ledger; backups require version4. Hardware permissions/audio state stay device-local.

**Mac boundary:** the additive read-only snapshot transfer still preserves all46 original Mac tables and history/contracts, without replaying them under mobile rules or granting rewards. The original Mac archive stays local and in native backups. Continuous Mac↔native synchronization still needs a desktop adapter; the installed Tauri product is unchanged. Future clients must follow the shared ownership, source-page, LWW and append-only contracts.

**Installed-device boundary:** Build6 is now installed on the physical iPad after the October3 guarded update. Renewed provisioning is valid until October10 at17:55:53UTC (1:55PM EDT); actual Release signature/profile/team/device checks pass. Independent review confirms all11 owned files/6,212,619bytes exactly preserved, including practice history and account ownership/privacy. Pre-launch schema5/revision883 has5pieces/30passages/24historical sets/15sessions/114attempts and no active set. Automatic launch was declined; Christian confirms Praelude opened, and a direct ledger read confirms schema5/revision883. Native Pencil/freeze/piano and actual two-device acceptance remain open. Earlier signing attempts and renewal recovery are retained in `docs/qa/ios/2.0.0/build6/device-update-attempt.json`; installed evidence is `docs/qa/ios/2.0.0/build6/personal-ipad-install.json`. Layout evidence: `docs/qa/ios/2.0.0/compact-practice.md`.

**Build5 verification:** 385 core tests, 2,211 service assertions and 54 Python tests pass; the final native app-hosted run executes 193 tests with one live-account test skipped and zero failures. Seven distinct iPad and five phone UI cases pass across scoped runs. Final arm64 device Release compiles with fixture flags/test plug-ins absent; a later guarded physical update is recorded below. Exact evidence and remaining acceptance are in `docs/qa/ios/2.0.0/score-workflow.md`.

**Next steps:** use the installed build6 to verify Pencil, black ink, sustained annotation during practice, reviewed movement/measure mapping and actual second-device continuity. Continuous desktop sync needs its separate adapter; Assistant remains on hold.

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

- [ ] Build7 stability candidate: final independent native/Release verification, then requested guarded install and sustained physical Pencil/large-score profiling.
- [ ] Follow-up persistence design for remaining synchronous full JSON/import/backup/export work, preserving failure/rollback semantics.

- [x] Current mobile source overview and snapshot-transfer implementation; original Mac rows preserved.
- [x] Core/exporter checks and targeted source fixes; exact native evidence is in the 2.0 QA ledger.
- [x] Guarded build6 update and first-open preservation evidence (October3).
- [x] Requested guarded build7 update and exact preservation (October7); running-process/schema5 readback pass.
- [ ] Separately reviewed Mac import and sustained physical feature acceptance.
- [ ] Hardware score/ink/voice/recording/interruptions acceptance and intended-account/two-device sync.
- [ ] Continuous Mac↔iOS adapter, integrated original-history analytics, cloud goals/routines and remote file versions.
- [ ] Locate the missing Cowell “Aolean Harp Contemporary” PDF without inventing its content.
- [x] v11.1 progressive practice feedback, independent review, package/install and exact preservation. Runtime `c411e7b`; `docs/qa/v11.1.0/` is the current evidence ledger.
- [x] Fresh-Mac development portability: current manual/version records are Git-backed; clone,
      toolchain, bootstrap, verification and local-only state boundaries are documented and checked.
- [ ] Moving Christian's actual practice environment between Mac usernames/paths remains separate:
      stored library/PDF paths are absolute and need a verified relocation workflow, not a raw DB copy.
- [x] Native Score/Variants permission boundary: fresh installed v11.1 renders the real nine-page Beethoven score, passage controls and Variants dialog.
- [ ] Christian’s audible/practice verdict, including native voice acknowledgement overlap and sustained motivation.
- [ ] Custom-cover picker selection/save/restart (B109).
- [ ] Installed Mac accounts/sync/friends remain absent; the mobile candidate has configured Supabase source support, pending real-account acceptance.
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
| Native iPhone/iPad candidate | repo `ios/README.md` (setup/scope/evidence), `ios/DESIGN.md` (design/source rationale) |
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
