# Mobile candidate changes

## October3 build6 — compact controls, carrying build5 score and shared data

**Mobile current source (2026-10-03): 2.0.0/build6, schema5, DEVELOPMENT CANDIDATE.** Christian's physical build4 feedback drives this round: Pencil did not draw without finger mode, black marks/stamps were invisible, annotation could freeze during a set, passage navigation was slow and ambiguous, and score chrome took too much space. Build5 implements fixes and new controls and is personally installed on the iPad. Complete pre-launch file preservation and actual schema5 upgrade pass; physical Pencil/freeze acceptance remains open.

**Build6 compact practice correction:** Christian found build5’s dock still too tall, especially Start without grading, Techniques and More options. The fixed width cap is removed. Wide setup uses two columns; those secondary actions share a shallow44-point row. Grading/verdict buttons use horizontal icon/text and52-point targets; running status, direct tempo, transport and verdicts share a row when the available width fits. Narrow windows reflow and accessibility text retains wrapping/scrolling. Six scoped iPad cases pass, including actual grading/Undo, portrait/landscape geometry and largest-text reachability. Setup is143pt and running100pt; secondary controls44pt, verdicts52pt. Two scoped phone cases also pass portrait/landscape geometry and actual grading/Undo. Independent final visual review passes. Build6 is now installed on the physical iPad after the October3 guarded update. Renewed provisioning is valid until October10 at17:55:53UTC (1:55PM EDT); actual Release signature/profile/team/device checks pass. Independent review confirms all11 owned files/6,212,619bytes exactly preserved, including practice history and account ownership/privacy. Pre-launch schema5/revision883 has5pieces/30passages/24historical sets/15sessions/114attempts and no active set. Automatic launch was declined; Christian confirms Praelude opened, and a direct ledger read confirms schema5/revision883. Native Pencil/freeze/piano and actual two-device acceptance remain open. Earlier signing attempts and renewal recovery are retained in `docs/qa/ios/2.0.0/build6/device-update-attempt.json`; installed evidence is `docs/qa/ios/2.0.0/build6/personal-ipad-install.json`. Layout evidence: `docs/qa/ios/2.0.0/compact-practice.md`.

**Score workflow:** a visible Library exit and compact bottom Practice / Select / Draw controls; passage Done at the bottom or score double-tap; distinct editable passage colors and an account-synced hide-boxes setting. Entering annotation retains the active set and its saved progress. PencilKit uses paper-light traits and deferred responder setup; finger navigation and optional finger drawing remain separate. Stamps have movable sized previews and a magnifier before Place. Yellow note chips expand locally with Edit/Close; failed saves retain the note text or stamp preview.

**Organization:** reviewed movement/book page ranges keep source PDFs, marks and history anchored while labels restart at section page1. PDF contents/bookmarks suggest sections; local Vision offers printed-number hints for review. Users confirm a measure or system region and its first/last numbers; newly drawn boxes inherit confirmed ranges, and older unlabeled passage/history displays derive fully covered confirmed ranges without rewriting snapshots. This is assisted mapping, not automatic optical music recognition. Passage lists group by page, sort measure numbers, and use bounded background thumbnail caches; history shows meaningful locations.

**Practice:** per-piece default tempo, visible pre-start metronome On/Off, stable Techniques with explicit Left hand/Right hand, less dock padding, a compact initial practice readout and width-fit Focus. Notebook New note opens directly. Rank progress leads Rewards; Studio stays secondary.

**Sync and preservation:** native profiles/privacy, instruments, practice records, score marks, goals/routines with deletion tombstones, movement/measure metadata, default tempo, account preferences and private score/recording/cover files have shared Supabase contracts. First sign-in reads the account before publishing defaults. Name/photo/privacy edits stage durably before local save and remain recoverable through failed saves, concurrent hydration, reverted retries and same-account sign-out. Local edits request debounced sync; unchanged remote adoption does not rewrite the ledger. Canonical lowercase owner-folder UUIDs fix a file-policy mismatch. Absent SQL columns and unknown preference keys survive older clients; other nested schemas remain versioned. Nullable clears remain explicit. Schema5 preserves the exact old ledger; backups require version4. Hardware permissions/audio state stay device-local.

**Mac boundary:** the additive read-only snapshot transfer still preserves all46 original Mac tables and history/contracts, without replaying them under mobile rules or granting rewards. The original Mac archive stays local and in native backups. Continuous Mac↔native synchronization still needs a desktop adapter; the installed Tauri product is unchanged. Future clients must follow the shared ownership, source-page, LWW and append-only contracts.

**Installed-device boundary:** Build6 is now installed on the physical iPad after the October3 guarded update. Renewed provisioning is valid until October10 at17:55:53UTC (1:55PM EDT); actual Release signature/profile/team/device checks pass. Independent review confirms all11 owned files/6,212,619bytes exactly preserved, including practice history and account ownership/privacy. Pre-launch schema5/revision883 has5pieces/30passages/24historical sets/15sessions/114attempts and no active set. Automatic launch was declined; Christian confirms Praelude opened, and a direct ledger read confirms schema5/revision883. Native Pencil/freeze/piano and actual two-device acceptance remain open. Earlier signing attempts and renewal recovery are retained in `docs/qa/ios/2.0.0/build6/device-update-attempt.json`; installed evidence is `docs/qa/ios/2.0.0/build6/personal-ipad-install.json`. Layout evidence: `docs/qa/ios/2.0.0/compact-practice.md`.

**Build5 verification:** 385 core tests, 2,211 service assertions and 54 Python tests pass; the final native app-hosted run executes 193 tests with one live-account test skipped and zero failures. Seven distinct iPad and five phone UI cases pass across scoped runs. Final arm64 device Release compiles with fixture flags/test plug-ins absent; a later guarded physical update is recorded below. Exact evidence and remaining acceptance are in `docs/qa/ios/2.0.0/score-workflow.md`.

**Next steps:** use the installed build5 to verify Pencil, black ink, sustained annotation during practice, reviewed movement/measure mapping and actual second-device continuity. Continuous desktop sync needs its separate adapter; Assistant remains on hold.

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

Imported scores, equivalent passages/goals and matching pencil marks become native content; original Mac history/contracts/corrections remain readable under **Progress → Mac practice record** and travel with native backups. Old sets are not replayed through different mobile rules and do not grant new rewards. This is a reviewed snapshot transfer, not continuous Mac↔iOS sync or complete semantic parity. Supabase sync covers supported native records and private PDFs/recordings. At that build4 boundary, goals/routines and custom cover bytes were not cloud-wired; the original Mac archive remained local. Build5 adds goals/routines and private-cover sync, while the original archive stays local.

**Practicality fixes:** compact practice controls fit narrow screens; acknowledgements do not resize the score; passage-page turning after verdicts is opt-in; Today launches the first warmup in its plan; phone navigation has four main tabs plus a deliberate More; first voice-check dismissal starts requested hands-free listening; Performance mode explains its exit gesture. Native backup now includes recording files and preserved Mac archives. Sync gains paginated reads, guest-library catch-up, local-save retry, remote Undo, file retries and account isolation. Full source/core checks and scoped native evidence are in `docs/qa/ios/2.0.0/README.md`.

**Device boundary at that pre-install check:** October2 initially found no connected device; after Xcode preparation, read-only inventory confirmed installed 2.0.0/build3. That observation did not establish migration, Mac import, account sync or piano acceptance. The later October2 install/first-open records establish installed build4/schema4; build5 remains a source candidate.

**Next steps at that pre-install boundary:** connect/unlock the iPad for the guarded build4 update, then import the reviewed transfer from Files. Confirm score boxes/ink and history on hardware, sign into the intended account, and verify a real second-device sync before trusting cross-device continuity. Mac integration remains a separate adapter; Assistant remains on hold.


This is the mutable native development history. It does not change shipped Mac version records or
establish App Store/TestFlight shipment. See [current QA](../../docs/qa/ios/2.0.0/README.md) for exact
build/run evidence and [the roadmap](ROADMAP.md) for remaining scope.

## September 14, 20:56 EDT — update installed, data preservation verified

**Installed September 14 at 20:56 EDT:** after the user confirmed the iPad was ready, the
complete pre-update backup passed. The helper rebuilt/signed Release and installed **1.1.0/build2**
over the same app identifier. The complete post-install copy matches both owned files (one ledger
and one PDF) by name, size and SHA-256. The pre-launch ledger remains schema1 with no active set.
Both private backups are retained. Automatic launch was denied; the exact security/lock cause is
unproven. The user was asked to unlock and tap Praelude, completing Developer App trust only if
prompted. Launch, schema2 migration and physical-feature acceptance remain separate open gates.
No uninstall, restore, reset, termination, Mac app replacement or Mac data change occurred.

**Next steps:** finish the device launch/trust step and verify schema migration, then physical
feature acceptance. See the separate installed-artifact and preservation record in current QA.

## September 14, 20:50–20:52 EDT — historical attempts blocked before installation

**Update attempt, September 14 at 20:50–20:52 EDT:** the user-requested refresh stopped at
its full pre-install backup, before building, installing or launching. Xcode's **Download
Container** also failed with CoreDevice7000/POSIX1 while reading a SplashBoard snapshot cache;
its partial cache copy contains no verified practice folder. A subsequent read-only status check
then reported 1.0.0/build1. These failures did not prove the iPad was locked. The requested
unlock/open-app interaction preceded the later successful backup/update recorded above. No uninstall, restore, reset or termination was performed.

**Next steps at that boundary:** obtain device interaction and complete backup before installation.
The subsequent update above clears that gate; launch remains separate. Source is `124707d`.

## 1.1.0/build2 — development candidate, 2026-09-14

- Select passages with multiple translucent boxes across systems/pages, move/resize them, keep
  optional measure labels and reopen a cropped score preview.
- Write editable PencilKit ink, with explicit finger drawing and separate ink Undo/Redo. Keep
  unsaved drawings and present conflicts when two windows edit the same page. PDF navigation now
  waits for the drawing recognizer so finger strokes reach the canvas.
- Review the original recorded visual target from session history. Share a separate annotated
  PDF with flattened ink through the system Files/sharing/Print sheet; omit practice boxes and
  keep the original score and editable ink unchanged.
- Expand metronome meter, accents/silence, subdivisions, sounds, volume, haptics and Tap tempo.
  Show restrained earned feedback after a repetition saves; audio never gates durable practice.
- Improve touch areas, Focus, and portrait/landscape accessibility layouts while keeping the score
  visible. Native sidebar/tabs and sheets remain simple; no decorative gradients or fake windows.
- Use independent native schema2 storage, preserving the original schema1 ledger during migration.
  Blank normal launches and separate DEBUG fixture storage remain mandatory.
- Add the focused mobile workspace, module guide, installation/renewal guide and explicit safe
  helper. Existing-app updates retain full pre/post copies and compare every file hash before
  launch. PDF loss/mutation or failed verification blocks launch; no automatic restore/uninstall.

Scoped simulator/build verification passes: 36 hosted tests pass on each simulator; iPad9 passes its
three final-toolbar cases, with other iPad/phone scenarios accepted across recorded regressions.
Phone4 toolbar verification passes 2/2; final exact-source signing and byte-verified artifact preservation pass. The physical iPad was subsequently updated to 1.1.0/build2 with complete pre/post
file verification; automatic launch was denied. See the dated installation entry above. A signed 1.1 snapshot is preserved outside
Git, and includes the final gesture/toolbar changes with stable input hashes. Physical Pencil/audio/voice,
printing, device accessibility, migration/sync and full desktop/forScore parity are separate gates.

**Next steps:** finish launch/trust and verify migration/physical features. Installation and
complete pre-launch file preservation are recorded separately from those open gates. Keep the
QA ledger's failures and scoped simulator results visible.

## 1.0.0/build1 — historical native candidate, 2026-09-14

Introduced native Today/Pieces/Progress, Files/PDF reading, passages, deterministic practice,
variants/routines, optional on-device speech, metronome, goals/history/calendar and native backups.
It used independent schema1 storage. A free Personal Team build installed on the iPad at 17:51 EDT;
its initial launch request encountered developer trust. The historical signed app and acceptance
records remain unchanged at [the 1.0 ledger](../../docs/qa/ios/README.md#historical-10-candidate-evidence).

**Next steps:** retain the baseline as history and use the current candidate's QA and safe update
workflow; historical passes do not become new-version acceptance automatically.

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
