# Praelude Mobile

## October2 build5 — score workflow and shared data

**Mobile current source (2026-10-03): 2.0.0/build6, schema5, DEVELOPMENT CANDIDATE.** Christian's physical build4 feedback drives this round: Pencil did not draw without finger mode, black marks/stamps were invisible, annotation could freeze during a set, passage navigation was slow and ambiguous, and score chrome took too much space. Build5 implements fixes and new controls and is personally installed on the iPad. Complete pre-launch file preservation and actual schema5 upgrade pass; physical Pencil/freeze acceptance remains open.

**Build6 compact practice correction:** Christian found build5’s dock still too tall, especially Start without grading, Techniques and More options. The fixed width cap is removed. Wide setup uses two columns; those secondary actions share a shallow44-point row. Grading/verdict buttons use horizontal icon/text and52-point targets; running status, direct tempo, transport and verdicts share a row when the available width fits. Narrow windows reflow and accessibility text retains wrapping/scrolling. Six scoped iPad cases pass, including actual grading/Undo, portrait/landscape geometry and largest-text reachability. Setup is143pt and running100pt; secondary controls44pt, verdicts52pt. Two scoped phone cases also pass portrait/landscape geometry and actual grading/Undo. Independent final visual review passes. The user supplied the exported identity; native login-keychain import now yields one trusted, unexpired same-team identity. The two earlier certificates remain revoked. A fresh guarded backup passes, but Release fails because the existing provisioning profile excludes the new certificate; CLI also reports No Accounts. Native Download Manual Profiles completes but retains the stale profile. Build5 remains installed; no installation occurred. Native Release Build For Profiling is requested from the user because menu automation repeatedly fails with stale-element errors. Regenerate the same-app/team profile, verify the actual signed app, then rerun the complete guarded refresh. Recovery steps: `ios/docs/INSTALL_ON_IPAD.md`. Attempt evidence: `docs/qa/ios/2.0.0/build6/device-update-attempt.json`. Evidence: `docs/qa/ios/2.0.0/compact-practice.md`.

**Score workflow:** a visible Library exit and compact bottom Practice / Select / Draw controls; passage Done at the bottom or score double-tap; distinct editable passage colors and an account-synced hide-boxes setting. Entering annotation retains the active set and its saved progress. PencilKit uses paper-light traits and deferred responder setup; finger navigation and optional finger drawing remain separate. Stamps have movable sized previews and a magnifier before Place. Yellow note chips expand locally with Edit/Close; failed saves retain the note text or stamp preview.

**Organization:** reviewed movement/book page ranges keep source PDFs, marks and history anchored while labels restart at section page1. PDF contents/bookmarks suggest sections; local Vision offers printed-number hints for review. Users confirm a measure or system region and its first/last numbers; newly drawn boxes inherit confirmed ranges, and older unlabeled passage/history displays derive fully covered confirmed ranges without rewriting snapshots. This is assisted mapping, not automatic optical music recognition. Passage lists group by page, sort measure numbers, and use bounded background thumbnail caches; history shows meaningful locations.

**Practice:** per-piece default tempo, visible pre-start metronome On/Off, stable Techniques with explicit Left hand/Right hand, less dock padding, a compact initial practice readout and width-fit Focus. Notebook New note opens directly. Rank progress leads Rewards; Studio stays secondary.

**Sync and preservation:** native profiles/privacy, instruments, practice records, score marks, goals/routines with deletion tombstones, movement/measure metadata, default tempo, account preferences and private score/recording/cover files have shared Supabase contracts. First sign-in reads the account before publishing defaults. Name/photo/privacy edits stage durably before local save and remain recoverable through failed saves, concurrent hydration, reverted retries and same-account sign-out. Local edits request debounced sync; unchanged remote adoption does not rewrite the ledger. Canonical lowercase owner-folder UUIDs fix a file-policy mismatch. Absent SQL columns and unknown preference keys survive older clients; other nested schemas remain versioned. Nullable clears remain explicit. Schema5 preserves the exact old ledger; backups require version4. Hardware permissions/audio state stay device-local.

**Mac boundary:** the additive read-only snapshot transfer still preserves all46 original Mac tables and history/contracts, without replaying them under mobile rules or granting rewards. The original Mac archive stays local and in native backups. Continuous Mac↔native synchronization still needs a desktop adapter; the installed Tauri product is unchanged. Future clients must follow the shared ownership, source-page, LWW and append-only contracts.

**Installed-device boundary:** physical iPad is2.0.0/build5/schema5 after the October2 requested guarded update. All10 app-owned files match the pre-update backup exactly before launch:5pieces/28passages/23historical sets/15sessions/114attempts, no active set. Automatic launch was declined; subsequent direct read confirms schema5 and the exact schema4 original retained on the device. Later additive passage/ink/note edits and page/account hydration changes are distinguished from migration; all preexisting practice history/contracts remain intact. Evidence: `docs/qa/ios/2.0.0/build5/personal-ipad-install.json`. Real Pencil/freeze/piano and actual two-device acceptance remain open.

**Build5 verification:** 385 core tests, 2,211 service assertions and 54 Python tests pass; the final native app-hosted run executes 193 tests with one live-account test skipped and zero failures. Seven distinct iPad and five phone UI cases pass across scoped runs. Final arm64 device Release compiles with fixture flags/test plug-ins absent; a later guarded physical update is recorded below. Exact evidence and remaining acceptance are in `docs/qa/ios/2.0.0/score-workflow.md`.

**Next steps:** use the installed build5 to verify Pencil, black ink, sustained annotation during practice, reviewed movement/measure mapping and actual second-device continuity. Continuous desktop sync needs its separate adapter; Assistant remains on hold.

**Historical source boundary: 2.0.0/build4 · schema4 · DEVELOPMENT CANDIDATE · October2, 2026.**
Native SwiftUI/PDFKit/PencilKit for iPhone/iPad on iOS17+. At that build4 boundary, source included Supabase accounts,
private PDF/recording storage and supported native-record sync, multi-instrument practice,
passage learning rules, warmups, score organization/annotation, notebook, history, rewards and social views.
The installed Mac remains v11.1.0/schema21. These source features are not a physical-device acceptance claim.

The pianist supplies every verdict; Praelude never interprets piano audio as musical performance.
Score reading remains page-based; feedback must follow durable practice saves. Touch/offline guest use
works without an account. Optional voice uses the on-device command vocabulary.

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
local formats; participating sync clients must be current. See the [follow-up QA](../docs/qa/ios/2.0.0/practice-polish.md)
for verification and remaining hardware/backend limits.

**Next steps at that build4 boundary:** finish native/Release checks and the guarded update, then
the musician-controlled Mac import and actual piano-session/two-device acceptance. The later
installation and first-open records below supersede the build4 installation/launch gates.

## Bring your Mac library

From the repo root, export a consistent read-only snapshot to a private path outside Git:

```sh
python3 ios/scripts/export_desktop.py --database '/absolute/path/codakiller.db' --output '/private/path/Mac-practice.json'
```

Finish Mac practice first. The helper refuses active sessions/sets, corrupt snapshots, overwrites,
unsafe/missing scores and exports inside Git. `--allow-missing-scores` explicitly permits unavailable
score bytes while retaining every original record/reference and reporting warnings. Available editions
under current score folders are included, without following directory symlinks. Related unsupported
files (such as tutorial videos) are reported; this is not a full filesystem backup.

Copy the reviewed JSON to Files/AirDrop. **Settings → Import from Mac → Choose Mac transfer** previews
counts/warnings. **Import library** adds compatible pieces, score editions, passages, goals and matching
pencil marks without replacing mobile records/preferences. Original history/contracts/corrections and
all Mac table records remain in **Progress → Mac practice record**. Original Mac sets do not grant native
rewards or fabricate mobile mastery. The archived database is private/local and travels in native backups;
it is not uploaded through Supabase. Supported native records and PDFs can sync after account sign-in.
This is a snapshot import, not continuous Mac↔iOS synchronization. Build5 source syncs native
goals/routines and private cover bytes; the original Mac archive remains local and in backups.
The installed build4 retains its older sync scope until an in-place update.

## Current practice navigation

Phone: Today, Pieces, Warmups, Progress and More. iPad: adaptive sidebar. More exposes Friends,
History, Calendar, Notebook, Data and Rewards. Score controls adapt to width; saved-verdict feedback
stays within the existing dock so notation does not resize. Automatic passage turns after verdicts
are opt-in in Score options. Today plans launch their first warmup. Performance mode explains its
exit gesture. First hands-free enable checks recognition then starts the requested listening.

## Development and evidence

- [Agent context](AGENTS.md), [module/check guide](docs/DEVELOPMENT.md), [workflow guide](docs/USING_MOBILE.md).
- [Install/renewal](docs/INSTALL_ON_IPAD.md), [roadmap](docs/ROADMAP.md), [changes](docs/CHANGELOG.md).
- [Current review and QA](../docs/qa/ios/2.0.0/README.md), [historical 1.1 QA](../docs/qa/ios/1.1.0/README.md).
- Current broader specification: `ios/docs/(C) Build Spec v2.md`; backend contract: `supabase/(C) Backend.md`.

```sh
python3 ios/scripts/generate-project.py
bash ios/scripts/check.sh
python3 -m unittest discover -s ios/scripts -p 'test_*.py'
open ios/Praelude.xcodeproj
```

Core uses Foundation and deterministic tests. The native target also uses pinned `supabase-swift`;
full Xcode and compatible simulator runtime are required. Normal launches remain blank; DEBUG test
fixtures/private transfer probes use a separate test store and are excluded from Release.

## Preservation and remaining gates

Native JSON, owned scores/ink/recordings and Mac archives remain independent of the live Mac database.
Backup now includes recording bytes and Mac archives. Combined payload is bounded to210 MB and encoded
JSON to280 MB; missing/corrupt files refuse backup/restore rather than silently dropping user data.
A repeat import preserves edits and validates/repairs missing identical score files. Very large or
repeated full Mac snapshots can exceed these limits and are refused before ledger replacement.

Sync reads all pages, preserves failed queues/pulls, catches up guest content, merges remote Undo and
retries files. Account switching is blocked when this device's library belongs to a different account.
Actual hosted/two-device convergence, backend independent page clocks, file-version invalidation,
integrated original-history analytics and ongoing desktop sync remain open. Build5 implements
native goals/routine sync; actual two-device acceptance is still required.

The latest October2 first-open verification confirms the physical iPad runs 2.0.0/build4/schema4.
Build5/schema5 remains a source candidate. Xcode preparation resolved the earlier disconnected
development tunnel; a fresh full private backup precedes any further update.
Use `npm run ios:status` to recheck and `npm run ios:refresh -- --device "YOUR IPAD NAME"` for the guarded
same-bundle update once connected. Never uninstall/reset to make an update or import easier.

**Next steps:** guarded physical update/import, then score/ink/voice/hardware and real-account
second-device synchronization acceptance. Do not label the candidate shipped.

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
