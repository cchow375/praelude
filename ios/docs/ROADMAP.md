# Praelude Mobile roadmap

## October2 build5 — score workflow and shared data

**Mobile current source (2026-10-02): 2.0.0/build5, schema5, DEVELOPMENT CANDIDATE.** Christian's physical build4 feedback drives this round: Pencil did not draw without finger mode, black marks/stamps were invisible, annotation could freeze during a set, passage navigation was slow and ambiguous, and score chrome took too much space. Build5 implements fixes and new controls; physical build5 installation/Pencil acceptance is not established.

**Score workflow:** a visible Library exit and compact bottom Practice / Select / Draw controls; passage Done at the bottom or score double-tap; distinct editable passage colors and an account-synced hide-boxes setting. Entering annotation retains the active set and its saved progress. PencilKit uses paper-light traits and deferred responder setup; finger navigation and optional finger drawing remain separate. Stamps have movable sized previews and a magnifier before Place. Yellow note chips expand locally with Edit/Close; failed saves retain the note text or stamp preview.

**Organization:** reviewed movement/book page ranges keep source PDFs, marks and history anchored while labels restart at section page1. PDF contents/bookmarks suggest sections; local Vision offers printed-number hints for review. Users confirm a measure or system region and its first/last numbers; newly drawn boxes inherit confirmed ranges, and older unlabeled passage/history displays derive fully covered confirmed ranges without rewriting snapshots. This is assisted mapping, not automatic optical music recognition. Passage lists group by page, sort measure numbers, and use bounded background thumbnail caches; history shows meaningful locations.

**Practice:** per-piece default tempo, visible pre-start metronome On/Off, stable Techniques with explicit Left hand/Right hand, less dock padding, a compact initial practice readout and width-fit Focus. Notebook New note opens directly. Rank progress leads Rewards; Studio stays secondary.

**Sync and preservation:** native profiles/privacy, instruments, practice records, score marks, goals/routines with deletion tombstones, movement/measure metadata, default tempo, account preferences and private score/recording/cover files have shared Supabase contracts. First sign-in reads the account before publishing defaults. Name/photo/privacy edits stage durably before local save and remain recoverable through failed saves, concurrent hydration, reverted retries and same-account sign-out. Local edits request debounced sync; unchanged remote adoption does not rewrite the ledger. Canonical lowercase owner-folder UUIDs fix a file-policy mismatch. Absent SQL columns and unknown preference keys survive older clients; other nested schemas remain versioned. Nullable clears remain explicit. Schema5 preserves the exact old ledger; backups require version4. Hardware permissions/audio state stay device-local.

**Mac boundary:** the additive read-only snapshot transfer still preserves all46 original Mac tables and history/contracts, without replaying them under mobile rules or granting rewards. The original Mac archive stays local and in native backups. Continuous Mac↔native synchronization still needs a desktop adapter; the installed Tauri product is unchanged. Future clients must follow the shared ownership, source-page, LWW and append-only contracts.

**Installed-device boundary:** physical iPad remains2.0.0/build4/schema4, opened by Christian after the October2 guarded install with all seven original library files matched exactly. His new Pencil/freeze feedback is direct physical evidence of defects, not acceptance of build5. Build5 verification is tracked in `docs/qa/ios/2.0.0/score-workflow.md`; real Pencil/piano use and real-account/two-device acceptance remain open.

**Build5 verification:** 385 core tests, 2,211 service assertions and 54 Python tests pass; the final native app-hosted run executes 193 tests with one live-account test skipped and zero failures. Seven distinct iPad and five phone UI cases pass across scoped runs. Final arm64 device Release compiles with fixture flags/test plug-ins absent; no physical update occurred. Exact evidence and remaining acceptance are in `docs/qa/ios/2.0.0/score-workflow.md`.

**Next steps:** guarded same-bundle build5 update when the iPad is connected and no set is open. Verify Pencil, black ink, sustained annotation during practice, reviewed movement/measure mapping and actual second-device continuity. Continuous desktop sync needs its separate adapter; Assistant remains on hold.

## Historical October2 build4/schema4 — practice polish before installation

At this historical boundary, source was **2.0.0/build4/schema4**, a development candidate. Search saved passages by name;
passages on the current source page appear first. Switching away from a running set requires an
explicit Finish and switch; Cancel keeps the current target. Setup and optional Techniques are
available before the first-attempt grade. Editable choices include rhythm pairs, hands separately
then together, passage joins, slow connected playing, touch contrast and memory checkpoints.
They suggest actions and never grade piano audio or change tempo without your choice.

More options carries the entire current draft; Use settings returns to the arm screen. Another set
and voice Next retain your chosen target count, hands, stages, tempo and metronome choices. Start
without grading records no invented attempt. Cold grading and visual passage joins now commit
atomically, retaining the original state on failed saves. Active tempo edits retain earlier attempt
BPM, stage/streak and Undo history instead of replaying from a rewritten starting tempo.

Metronome exposes Count-in Off/1–4 bars and Keep playing when locked, custom beat accents, sound,
subdivision and grouped compound pulse. In 6/8, 9/8 and 12/8 the optional dotted-quarter pulse is
labeled explicitly; triplet subdivisions supply the written eighths. Muted patterns still have audible
main-beat count-in. Count-in changes apply on next Start. Ordinary click edits retain bar phase;
route/session interruptions remain a physical-device acceptance gate.

Practice controls use native SF text and one system Liquid Glass layer on iOS26+, system material
on older iOS and an opaque accessibility fallback. Music stays opaque. Schema4 preserves the exact
older ledger before migrating; tempo histories require backup version3. Older apps refuse newer
local formats; participating sync clients must be current. See the [follow-up QA](../../docs/qa/ios/2.0.0/practice-polish.md)
for verification and remaining hardware/backend limits.

**Next steps at that build4 boundary:** finish native/Release checks and the guarded update, then
the musician-controlled Mac import and actual piano-session/two-device acceptance. The later
installation and first-open records below supersede the build4 installation/launch gates.

## Historical October2 build4 source / installed build3 — transfer and practicality

**Source at this October2 boundary: 2.0.0/build4, schema4, DEVELOPMENT CANDIDATE.** The SwiftUI source included a configured Supabase backend, accounts, mobile sync/private score storage, multi-instrument practice, expanded score tools, warmups, history, notebooks, rewards and social views. These source capabilities supersede the September 14 1.1 description; they do not establish a new physical installation or hardware acceptance.

**Mac library transfer:** a new read-only SQLite exporter and additive native importer preserve the complete original Mac database plus all 46 table projections. The private October 2 snapshot contains 11 piece rows (one system row), 13 distinct PDFs/14 edition paths, 140 passages, 31 goals, 3,313 repetitions, 370 sets and 67 sessions. One score, “Aolean Harp Contemporary,” is missing from the Mac; its records and missing reference are retained. Available stale-path scores are recovered through the current piece folders, with warnings. The original Mac database is not changed or uploaded.

Imported scores, equivalent passages/goals and matching pencil marks become native content; original Mac history/contracts/corrections remain readable under **Progress → Mac practice record** and travel with native backups. Old sets are not replayed through different mobile rules and do not grant new rewards. This is a reviewed snapshot transfer, not continuous Mac↔iOS sync or complete semantic parity. Supabase sync covers supported native records and private PDFs/recordings. At that build4 boundary, goals/routines were not cloud-wired and the original Mac archive remained local. Build5 adds goals/routine sync; the original archive stays local.

**Practicality fixes:** compact practice controls fit narrow screens; acknowledgements do not resize the score; passage-page turning after verdicts is opt-in; Today launches the first warmup in its plan; phone navigation has four main tabs plus a deliberate More; first voice-check dismissal starts requested hands-free listening; Performance mode explains its exit gesture. Native backup now includes recording files and preserved Mac archives. Sync gains paginated reads, guest-library catch-up, local-save retry, remote Undo, file retries and account isolation. Full source/core checks and scoped native evidence are in `docs/qa/ios/2.0.0/README.md`.

**Device boundary at that pre-install check:** October2 initially found no connected device; after Xcode preparation, read-only inventory confirmed installed 2.0.0/build3. That observation did not establish migration, Mac import, account sync or piano acceptance. The later October2 install/first-open records establish installed build4/schema4; build5 remains a source candidate.

**Next steps at that pre-install boundary:** connect/unlock the iPad for the guarded build4 update, then import the reviewed transfer from Files. Confirm score boxes/ink and history on hardware, sign into the intended account, and verify a real second-device sync before trusting cross-device continuity. Mac integration remains a separate adapter; Assistant remains on hold.


**Historical September14 foundation.** This is the mobile implementation map, not a claim of shipped desktop or
forScore parity. The installed Mac product remains v11.1.0/schema21. Exact candidate versions,
source digests and verification results belong to the [native QA ledger](../../docs/qa/ios/README.md).

## Established native foundation

The first 1.0.0/build1 candidate established SwiftUI iPhone tabs/iPad navigation, page-based PDF
practice, passage/set editors, ordered variants and saved routines, durable local repetitions,
goals/history, deterministic metronome/voice commands, and native backup tooling. Simulator checks
and physical installation are recorded separately. The complete iPhone backup UI scenario was
open in that baseline; the later Phone3 exporter/restore flow now closes it with simulator evidence.

The signed Personal Team candidate was installed on an iPad on September 14. At that September14 boundary, the verified
first-launch outcome was a trust/security denial; do not infer a new launch or hardware feature
verdict from an install or informal feedback. Follow the QA ledger for subsequent device evidence.

**Next steps:** retain those regression protections while evolving the native score workflow.

## Historical September14 build2/schema2 plan — score markup

At that September14 boundary, the 1.1.0/build2/schema2 candidate had completed scoped simulator/build verification separately
from the baseline:

- Native score annotation with Apple Pencil/PencilKit, persistent per-page drawing data and safe
  schema migration, with focused tools that preserve normal page reading and zoom.
- Visual passage boxes with optional measure labels, saved previews, and read-only original-target
  review under Progress session history. Recorded targets retain their meaning after shortcut edits.
- A separate annotated PDF sharing/printing copy, with flattened ink and no practice boxes; editable
  ink and the source score remain in the native library. The three native hosted export tests pass on iPad; system share/Print UI and physical output
  acceptance are pending.
- Score-first navigation and larger, clearer practice interaction across iPhone/iPad sizes.
- Refined metronome/practice feedback with durable repetitions independent of playback.
- This mobile subproject's developer context, module map, reproducible checks, and explicit
  Personal Team install/refresh helper with full pre/post-install file hash comparison before launch
  and 28 passing fake-device safety tests.

Evidence at the September14 build2 boundary included 36 hosted tests passing on both simulators. iPad9's final-toolbar
finger/meter/Focus run passes 3/3; iPad7 supplies boxes and accessibility markup. Phone3 passes
finger/backup/Focus, with four other phone UI cases from Phone2. These are five targeted iPad and
seven phone scenarios across regression runs, not one all-green full-scheme run. Phone4's final
toolbar recheck passes 2/2, and exact-source signing/artifact verification passes. The physical iPad then had 1.1.0/build2 installed (September14, 20:56 EDT). After user readiness,
complete pre/post copies matched both owned files; earlier failed attempts remain historical.
Automatic launch was denied; user launch/trust, migration and physical-feature checks were
pending at that September14 boundary. Later installation/first-open evidence supersedes those
installed-version and launch claims. Simulator passes do not establish hardware acceptance.

**Next steps at that September14 boundary:** finish opening the installed update (Developer App trust if prompted), verify
schema2 migration and the preserved original, then check Pencil alignment/persistence, real
touches, audio, voice and interruptions with disposable data. The in-place update and pre-launch
file preservation are already verified.

## Historical September14 build2 — follow-up acceptance and scope

| Work | Boundary |
| --- | --- |
| Physical iPhone/iPad validation | Actual imports, durable practice, rotation, VoiceOver/Dynamic Type, long-session audio, interruption and backup checks |
| Pencil precision | Test actual stylus marks, erasing/undo, zoom/rotation alignment, page transitions and reopening on supported hardware |
| Complete iPhone backup UI flow | Phone3 simulator flow passes; physical full-copy/restore preservation remains a separate gate |
| Mac/iOS data transfer | Explicit migration/sync design; native sandbox and Mac schema21 SQLite are separate |
| Annotated PDF sharing/printing | Three iPad hosted export tests pass; native share-sheet, Print workflow and physical output acceptance remain pending |
| Broader score-reader features | Layers, stamps/shapes, text annotations, page rearrangement/cropping, links and set lists each require their own scope and tests |
| Desktop features | Listen Back, Studio economy/furnishings, warmups and legacy history repair are separate ports |
| Assistant/cloud mapping | Remain on hold; neither is required for the deterministic practice loop |
| Distribution | Personal Team renewals are available for local testing; App Store/TestFlight needs a separate signing/release process |

forScore is a workflow reference, not a parity checklist silently marked complete. Its annotation
guide covers distinct features such as layers, symbols, typed notes and automatic Pencil entry.
Praelude should adopt useful musician workflows while keeping a clear practice focus.
[forScore annotation documentation](https://forscore.co/documentation/annotation/).

**Next steps:** prioritize the user's observed piano-session friction after the current milestone's
evidence is complete; document each remaining gap explicitly rather than calling the app a full port.

## Historical October2 19:14 EDT — build4 installed, before first open

At 19:14 EDT, 2.0.0/build4 was installed over the existing iPad app. All seven original library files matched complete
pre/post-install copies exactly. The pre-launch ledger was schema3; current-data migration rehearsal
preserved all3,447 scalar values and the exact original file. iOS denied automatic launch. At that pre-launch boundary, the next step was to unlock and tap
Praelude, completing Developer App trust only if prompted; launch/schema4 migration and physical
piano acceptance were unverified. The first-open follow-up below supersedes the launch/migration gate. Mac import had not run. Further phone acceptance was deferred at
Christian's explicit request to get build4 onto the iPad then. Signed Release excludes test fixtures;
Core356, service2211, Python53, native runtime12 and largest-text300BPM checks pass.

**Next steps at that pre-launch boundary:** open build4 and practice, then import the reviewed Mac
transfer. The first-open follow-up below establishes launch/schema4; Mac import and hardware
acceptance remain separate.

## October2 build4/schema4 — verified first-open follow-up

Christian opened the installed app without a trust prompt. Read-only verification confirmed 2.0.0/build4/schema4 with three existing mobile pieces and ten historical sets. Mac import remains pending; piano/audio/two-device acceptance remains separate.

**Next steps:** complete build5 verification and a guarded update, then physical Pencil/piano and
real-account/two-device acceptance. Import the reviewed Mac transfer when Christian is ready.
