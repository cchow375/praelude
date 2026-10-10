# Praelude Mobile roadmap

## October 9 — build8 usability and reliability lane (INSTALLED — PHYSICAL FAILURE REPORTED)

Native source is 2.0.0/build8/schema5; the personal iPad now runs build8/schema5 and the user reports a confirmed native Undo crash. The installed Mac stays v11.1.0/schema21. Christian's reported freezes, lag, inaccessible practice controls and microphone crashes remain the acceptance target, regardless of earlier build7 tests.

- Implemented for review: exact and tap tempo, visible goal/hands setup, clear technique chains, practice during annotation/selection, movable/minimizable palette, native ink zoom/layers, lighter highlighter and finer pen widths, two-finger Undo, passage/note rename and dictation, note repositioning, direct movement entries and safe warmup close/finish.
- Implemented for review: background idle-save preparation with revision/ink conflict checks and coordinator generations; no redundant PDF-page writes or historical-session reprojection for unchanged practice records. Explicit transition saves and atomic publication remain synchronous.
- Implemented for review: validated movement practice snapshots in the existing ledger, and speech/microphone permission, route and lifecycle guards. No new PDF copies, invented reps or schema migration.
- Diagnosed and repaired in source: six physical build7 watchdog reports and the CPU report share the focused-overlay removal cycle at synchronous `PDFView.go(to:)` inside SwiftUI update. Deferred/coalesced navigation and explicit state observation retain checkpoint gates; see `docs/qa/ios/2.0.0/build8/crash-analysis.md`. This does not attribute the separate microphone report.
- Verification: 406 core, 2,211 service assertions and 57 Python helper tests pass; UI6 full native runs 242 with 1 live-account skip and 0 failures. UI6 movement entry/validation/steppers/list/grid/page targeting passes. UI7 exact 72→88 goal, Left hand, Start/Clean/Undo and largest-text portrait/landscape pass. UI5 continuity, all three markup cases, two-finger Undo/Redo and rename pass.
- Latest checkpoints: Phone1 full native242 tests/1 live-account skip/0 failures; three of four UI cases pass, with accessibility selection Done failing on the prior source. Repaired iPad UI12 runs243 native/1 skip/0 failures and both actual UI cases pass: sticky drag/double-tap/edit/relaunch and accessibility portrait/landscape. UI12 omitted rename because its selector was wrong; Phone2 actual rename now passes52.388s. Phone2 reaches selection Done in both orientations, then fails landscape annotation with a3-pixel tool viewport. A30% footer cap only for short writing windows,13-point palette header title and improved Cancel/Done spacing pass source review; reading/selection retain60% and tool-body accessibility text remains. Phone3 now passes actual accessibility portrait/landscape in 71.631 seconds, with four independently accepted screenshots. UI13 then records 244 native tests/1 live-account skip/2 assertion failures in one note-frame case; actual triple tap fails at its missing accessibility target after earlier sticky steps pass. The subsequent public-API frame/traversal repair, including hidden-parent guards, passes independent source review and test-build9. UI14 passes the complete actual sticky create/hold-drag/double-tap-edit/relaunch/triple-tap/permission-denied recovery flow in 71.060 seconds. Its native suite executes 245 tests with 1 live-account skip and the same 2 zoom-frame assertion failures in one case; all other native cases pass, including PDF accessibility publication and hidden-wrapper guards. The aggregate does not pass. UI15 repeats the complete actual sticky triple-tap/recovery flow successfully in 59.539 seconds. Native245/1 live-account skip still has two frame assertions failing in one case, now with a zero frame. A detached test fixture is suspected; the test now asynchronously mounts a real UIWindowScene/window and asserts overlay.window identity before applying the transform. Only the test fixture changed after the UI15 production source. The final strict native run now passes245 tests/1 live-account skip/0 failures in16.881s; mounted-scene/window identity and crop/zoom assertions pass. Earlier failures remain in the 45-item QA report.

- Pending: device Release/signing, guarded same-bundle installation with all-file pre/post comparison, launch/readback, then physical Pencil/audio/interruption/large-score and sustained practice acceptance. The exact named-device on-demand tunnel probe has three new regressions in the 57-test deployment-helper suite.

**Installed build8 — physical Undo crash remains open:** native2.0.0/build8/schema5 from `a23cdec4f4f9acf42e8e5c724b6a386430dddca5` is installed. Independent review verifies all13 owned files/12,788,247 bytes unchanged by filename, size and SHA-256 before launch. Automatic launch was declined; the user opened the app. The23:59:40 UTC readback retains schema5/revision2086 (from2079),6 pieces/51 passages/50 sets/31 sessions/304 attempts/255 ink records (199 active)/2 stamps/2 notes. Original records remain exact except one piece page bookmark; profile/privacy/account/score data are exact. This readback precedes the23:59:53 UTC crash and is not post-crash retention proof. The user reported failure at19:59:56 EDT. Matching build8 dSYM identifies main-thread `EXC_BAD_ACCESS` at0x10 in `PKTiledView.performUndo` tile update, reached through the two-finger Undo action; this is distinct from the build7 PDF watchdog. Exact user sequence remains pending and the crash is unclosed. Signed Release checks pass, with profile valid through October16 at23:56:11 UTC (7:56 PM EDT). Sanitized evidence: `docs/qa/ios/2.0.0/build8/personal-ipad-install.json`. Mac v11.1.0/schema21 is unchanged.

### Next steps

Repair and verify the confirmed native Undo crash after obtaining the exact user sequence; the independent pre-crash preservation/readback audit passes. Keep physical acceptance open until the failing flow is reproduced, repaired and verified. A week of teacher use has not occurred. Continue separate desktop-sync and two-device work only within their existing scope; Assistant remains on hold.

## October7 — build7 installed on the personal iPad

**October 7 user confirmation:** Christian confirms the update reached the iPad. This confirms installation; sustained Pencil, audio, freeze recovery, refresh rate and real two-device behavior still require physical acceptance. The complete implementation, verification and deployment handoff is `docs/qa/ios/2.0.0/build7/session-handoff.md` (source `3e03330`, installation record `2227817`).

Guarded same-bundle refresh installs2.0.0/build7/schema5 from source `3e03330`. Independent full pre/post inventory review proves all11 owned files/7,981,365bytes identical by filename,size andSHA256, including scores, annotations, history, account ownership/privacy/preferences. Pre-launch schema5/revision1647 has5pieces/44passages/43historical sets/30sessions/255unique attempts; retained active set is completed, with no running set. No schema migration, import, restore, uninstall or Mac change occurred.

Actual signed device Release passes strict signature, app/profile/team agreement, signer-certificate membership/trust and helper device inclusion; fixture arguments/debug diagnostics/test plug-ins are absent. Profile expiresOctober10 at17:55:53UTC (1:55PM EDT). Automatic launch failed; subsequent read-only device inspection confirms Praelude running and schema5/revision1660. Independent post-launch review retains all255 attempts,44set IDs,30sessions and every original45ink record, plus exact profile/privacy/preferences. A completed set is archived and newer ink/reward/page activity is observed; no author or automatic-startup attribution is inferred. User screen-quality confirmation remains separate. Source/native simulator verification remains distinct from physical Pencil/audio/freeze/long-session/real-account two-device acceptance. Exact sanitized evidence: `docs/qa/ios/2.0.0/build7/personal-ipad-install.json`; private complete backups stay outside Git.

**Next steps:** use the installed build7 for real practice to verify sustained Pencil/eraser/Undo/layer/page transitions and responsiveness. Renew with the same app/team before the actual profile expiry.


## Historical October 6 — build7 stability and responsiveness candidate

**Historical build7 source: 2.0.0/build7, schema5, DEVELOPMENT CANDIDATE at that boundary. Personal iPad now has build7 (October7); device running-process and schema5 readback are confirmed.** Christian reports freezes requiring force quit, lagging/disappearing ink and crowded controls. This repair preserves the native format, score source geometry and user-supplied practice verdicts.

Native testing reproduced a stamp-switch freeze in UIKit responder teardown. The canvas stays enabled; overlay hit routing handles selection/stamps/text/read-only states without disabling the focused canvas.

Drawing samples now mark a canvas dirty without repeatedly serializing it or rewriting practice data. Autosave waits for a 600ms idle interval; page/mode/layer/background/exit transitions still require a successful save. Failed checkpoints remain recoverable, and Keep my drawing uses the newest dirty canvas. Long strokes receive bounded content identities; partial-erasure masks participate in identity. Corrupt saved ink stays read-only instead of masquerading as an empty page. A non-observed drawing cache avoids recursive view invalidation and evicts old pages while pinning live/failed-save baselines.

Page/link/passages/cover/heatmap previews use serial background renderers, bounded pixels and image-memory costs. Offscreen cover requests cancel queued work after their last viewer leaves, while shared visible requests survive cancellation. Neighbor-page speculative rendering no longer races the displayed PDF. Stamp glyphs and inactive-layer images have bounded retention. Annotation tools use a shallow icon strip with accessible names; long tool trays scroll within half the usable workspace height. Geometric stamps retain fixed size with named44-point buttons. Short landscape annotation starts at stave width, restores prior portrait zoom after automatic fitting, and preserves a deliberate pinch. The phone resume banner stays above the tab bar, including secondary screens. Warmup Close and practice controls remain anchored while the central readout scrolls in short windows. Today uses a 44-point reorder menu. The metronome preset row now has a full-width44-point hit target. Independent native screenshots drive intrinsic annotation-footer sizing, preserving score space. Compatible iPhones opt into higher refresh rates; iOS still chooses actual frame pacing.

Ink matching and session validation/projection use indexes; reward catch-up batches writes without combining or inventing awards. Tuner analysis admits one window at a time. Sync rejects canceled/old-account pulls, yields during large pulls and hashes private files off the UI actor. Search/avatar/profile previews and measure scans cannot overwrite newer requests. Notebook multi-delete captures IDs before the list changes. Metronome settings no longer subscribe to animated beat progress. Live meter rows capture stable accents so an older SwiftUI row cannot index a changed list. A retained background click survives a delayed foreground pause observer, while explicit Stop and later manual pauses still stop it. Annotated sharing captures saved data, yields between pages and cleans partial canceled output; photo-to-PDF composition runs off the UI actor.

**Verification:**394 core tests,2,211 service assertions and54 Python tests pass. Native hosted215 execute per form factor with1 live-account skip/zero failures. Eight phone UI cases and a stricter rotation/Done rerun pass; four iPad UI cases plus the corrected metronome retry pass. Independent final phone/iPad visual review accepts these scoped layouts. A fresh arm64 device Release compiles as2.0.0/build7 with fixture arguments, debug diagnostics and test plug-ins excluded. Failed aggregates remain recorded in `docs/qa/ios/2.0.0/build7/stability.md`; source tag is `ios-v2.0.0-build7-candidate`. Physical installation and complete-file preservation pass; physical Pencil, sustained refresh-rate and real-account/two-device acceptance remain open.

**Open limits:** full-library JSON encoding/atomic writes, large import/backup/restore and a single complex PDF page/final export rewrite can still block the UI. These require a separate persistence/rendering design and real-device profiling. Background work and simulator screenshots cannot prove a fixed 120fps rate or eliminate every freeze. Mac remains v11.1.0/schema21; Assistant remains on hold.

**Next steps:** verify sustained real Pencil/practice behavior on the installed build7 after the completed guarded update and schema readback. Verify sustained physical Pencil/eraser/layer/page transitions during practice, large actual scores, interruptions and real-account second-device continuity.


## October2 build5 — score workflow and shared data

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
