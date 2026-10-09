# Mobile candidate changes

## October 9 — native build8 usability and persistence repair (DEVELOPMENT CANDIDATE)

Christian's new feedback reports that installed build7 still freezes while confirming marks and remains too difficult for everyday piano practice. Source advances to 2.0.0/build8/schema5; the personal iPad is confirmed on build7 today. Build8 is not installed, and the Mac remains v11.1.0/schema21.

- **Practice:** exact numeric/tap tempo with local drag preview and one release commit; visible tempo goals and hands, with compact BPM units and distinct accessible start/goal labels; draft start/goal/step/clean contract; optional saved passage performance goal; clearer ordered technique stages; live warmup tempo/metronome, Pause & close and Finish. Files: `TempoDial`, `PracticeTempoGoalView`, `PracticeArmView`, `PracticeHUDView`, `SetComposerView`, `WarmupPracticeView` and `PracticeArmController`.
- **Score interaction:** practice remains available during annotation and selection; movable, collapsible, bounded drawing palette with all six tools visible at 44-point targets; native PencilKit zoom and inactive-layer rendering; fine/medium/broad pen widths and lighter highlighter; two-finger Undo; movable sticky notes; passage/note double-tap editing and triple-tap dictation, visible rename alternatives and gesture help. Files: `AnnotationPalette`, `AnnotationTool`, `ScorePageOverlay`, `PagedScoreView`, `ScoreMarkupState`, `ScoreWorkspace`, `ScoreStamps`, `PassageRenameView`, `PassagePickerView` and `PassageQuickActions`.
- **Organization and preservation:** direct movement entries use the original PDF and constrain source-page navigation/passage lists; first/last page fields have 44-point targets and adjacent steppers. Native testing exposed caret placement producing 21 instead of 2; page and tempo fields now share a select-all numeric editor. Empty/invalid page drafts remain visible and disable Save, and stepper edits remain visible while focused. Starting movement practice validates the saved section and preserves its title/range in the existing immutable practice snapshot; no duplicate PDF, fabricated passage or rep. Idle-save stroke/JSON preparation runs off the UI actor; generation and revision checks protect newer ink and unrelated practice updates, while explicit transitions still checkpoint synchronously. Duplicate page notifications and unchanged historical projections avoid redundant work. Files: `ScoreOrganization`, `ScorePageNavigation`, `PracticeStore`, library/section views and the score coordinator.
- **Voice and deployment:** speech callbacks explicitly enter the UI actor; shared capture ownership, permission, route and stale-callback guards cover speech, dictation, tuner and recording. Read-only device discovery now probes the exact named device to activate its on-demand tunnel, retaining identity and readiness checks; three regressions bring deployment-helper tests to 57. Files: speech/audio/tuner/recording services, onboarding and `ios/scripts/device.py`/`test_device.py`.
- **Physical crash diagnosis and source repair:** six build7 watchdog reports and the CPU report symbolicate to `PDFView.go(to:)` in `PagedScoreView.updateUIView`; focused-overlay removal reenters SwiftUI responder/AttributeGraph updates. Navigation/document/display changes and teardown now defer/coalesce outside that transaction, explicitly observe dependent state, and retain failed-save gates. This diagnoses the recorded freeze path, not the separate microphone complaint. Sanitized matching-dSYM evidence is in `docs/qa/ios/2.0.0/build8/crash-analysis.md`.
- **Native follow-up:** UI6 full native suite executes 242 with 1 live-account skip and 0 failures; its movement typing/empty and invalid-input guards/steppers/list/grid/correct-page flow passes. UI7 passes exact 72→88 BPM goal with Left hand, Start/Clean/Undo and largest-text portrait/landscape after explicit header glyph fonts. UI5 passes both score-continuity cases, all three markup cases, two-finger Undo/Redo and double-tap rename. The single-movement label uses singular grammar.
- **Sticky-note failure sequence and scoped repair:** UI5/6/7 fail the actual touch scenario. Trace evidence exposed UIKit zeroing pan translation and an overlay single tap competing with parent double/triple taps. Captured-origin/priority/readonly-note source changes pass 13 selected native tests in UI8; actual dragging now reaches its destination, but opening the moved note on double tap fails in UI8 and UI9. UI10 failed before sticky editing because Annotate did not reveal the palette. Unchanged UI11 reached the sticky failure again and identified the winning single-tap recognizer; the resulting local note multi-tap owner repair then entered actual UI12 replay. UI12 now passes the complete actual drag/double-tap/edit/relaunch scenario in52.404 seconds; the earlier failed runs remain recorded. This is simulator touch acceptance for the tested source, not physical-iPad acceptance.
- **Phone selection escape (improvement43):** Phone1 goal setup and warmup Finish pass, but accessibility-size selection Done is unreachable. `ScoreWorkspace` pins `selectionTools` outside the scrolling `practiceDock`, retains a shared 60% height budget and uses `ViewThatFits` to reflow narrow large-text actions into two rows. Phone1 completes242 native tests with1 live-account skip/0 failures and three of four UI cases pass (goal, warmup Finish, repeated Done/ink relaunch); its accessibility selection failure is retained. After repair, UI12 completes243 native/1 skip/0 failures, and both sticky interaction and iPad accessibility portrait/landscape UI cases pass (the latter67.236 seconds). Rename did not execute in UI12 because of an incorrect selector; Phone2 now passes the actual passage-rename test in52.388s and reaches selection Done in both orientations, but its later annotation step fails as recorded below. Later note accessibility fails UI13; UI14 actual touch passes, but the test-only mounted-window correction now passes the final245-test native run with1 live-account skip/0 failures. No installation claim.
- **Short drawing tool space (improvement45):** Phone2 completes two UI cases: actual passage rename passes, while the accessibility case fails later in landscape annotation with only3 pixels of tool viewport (score63/footer202 of337 workspace). `ScoreWorkspace` caps practice footer height at30% only for short writing windows; reading/selection keep60%. `AnnotationPalette` uses a fixed13-point header title within its44-point header while tool-body accessibility text stays adaptive. Cancel/Done gain a12-point gap and6-point side padding each. Phone3 passes actual accessibility portrait/landscape in 71.631 seconds. Independent review accepts the four final selection/palette screenshots: Cancel/Done stay separated and pinned, and all six tools plus finger/Undo/Redo/colors have a usable landscape viewport. Lower tool content and practice controls scroll at the largest text size.
- **Accessible score notes (improvement44):** visible chips now have native accessibility elements with stable identity, text/hints and activation of the real panel. Frames follow crop, zoom and note movement; hidden layers and readonly/deleted/cropped-away stale references are guarded, while native ink/panel controls remain accessible. UI13 executes 244 native tests with 1 live-account skip and 2 assertion failures in one new frame case; the sticky test passes its earlier create/drag/double-edit/relaunch steps, then cannot find the new triple-tap target. Dynamic screen-frame calculation and visible attached PDF overlay accessibility traversal now pass independent source review, including hidden-parent guards, and test-build9. UI14 passes the complete actual sticky create/hold-drag/double-tap-edit/relaunch/triple-tap/permission-denied recovery flow in 71.060 seconds. Its native suite executes 245 tests with 1 live-account skip and the same 2 zoom-frame assertion failures in one case; all other native cases pass, including PDF accessibility publication and hidden-wrapper guards. The aggregate does not pass. UI15 repeats the complete actual sticky triple-tap/recovery flow successfully in 59.539 seconds. Native245/1 live-account skip still has two frame assertions failing in one case, now with a zero frame. A detached test fixture is suspected; the test now asynchronously mounts a real UIWindowScene/window and asserts overlay.window identity before applying the transform. Only the test fixture changed after the UI15 production source. The final strict native run now passes245 tests/1 live-account skip/0 failures in16.881s; mounted-scene/window identity and crop/zoom assertions pass.
- **Goal follow-up:** UI9 passes actual 72→88 goal/hands/Start/Clean/Undo after opening the goal editor at its large detent and exposing the complete goal in compact practice context. Independent visual review accepts `ipad-tempo-goal-editor.png` and `ipad-active-tempo-goal.png`; both are linked in the 45-item QA report. Build7 remains physically installed.
- **Review:** 406 core tests, 2,211 service assertions and 57 Python helper tests pass. UI3 source failures and UI4 stale XCTest evidence remain recorded; a fresh current runner is verified in UI5. Exact run scopes, failures and screenshots remain in `docs/qa/ios/2.0.0/build8/usability-review.md`. Living docs distinguish installed build7 instructions from candidate build8 actions. No immutable version record is changed.

**Delivery checkpoint:** the first two signed device Release attempts stopped before compilation with Xcode `No Accounts` / `No Profiles`; Xcode settings confirmed it was signed out. The user now confirms sign-in, and the final signed Release build is running. Its signing/profile validation and guarded installation remain pending. No credentials were obtained or new account/certificate created; the prior profile backup is archived. Build7 remains installed and unchanged.

**Next steps:** finish candidate/native/Release and independent review, resolve observed failures, complete the guarded update and all-file comparison, then physical Pencil/audio/large-score and sustained-use acceptance. No zero-defect or week-long teacher acceptance claim is supported.

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


## October3 build6 — compact controls, carrying build5 score and shared data

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
