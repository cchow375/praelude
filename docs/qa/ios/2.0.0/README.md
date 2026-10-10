# Mobile 2.0 overview and October 2 verification

## October 10 — build10 selection consistency repair (DEVELOPMENT CANDIDATE)

**Build10 production source is frozen and scoped checks pass; installed iPad remains2.0.0/build9/schema5, source `2de2444`. Macv11.1.0/schema21 is unchanged.** After accepting the earlier named interactions, the user reports that Prokofiev passage creation has no visible corner dots and lags badly, while Beethoven handles are smooth. That earlier acceptance does not establish consistency across scores. This new defect is B146.

Confirmed PDF metadata differs sharply: Prokofiev page10 is5609.6×7764.01 points; Beethoven page4 is626.76×874.92 points. The old overlay's minimum content scale of1 defeats its4-million-pixel cap on the larger page, permitting about43.55 million pixels;8-source-point handles shrink below1 screen point. These identify page-size-dependent rendering and handle-visibility defects. Overlay/state repairs are implemented and two fresh source reviews find no new blocker. Final ordinary/oversized selection UI passes on both iPad and iPhone, including blank/drawn Cancel, Undo/Redo/save and adding a second box to a saved passage, canceling, then reopening the original one-box baseline. All48 selected native checks pass on phone; iPad passes42 existing plus6 new checks across the recorded runs. Four independently accepted screenshots show consistent handles/borders and unclipped Cancel/Done. These are scoped checks, not a full-suite or performance-rate claim; earlier failures and the zero-test run remain in QA. No build10 installation or physical acceptance is claimed. The raster cap does not bound total PencilKit cache/RAM; the pre-existing cropped-resize limitation when the opposite edge is hidden remains.

The user also reports that selection Cancel does not work (B147). The candidate repair makes explicit Cancel immediately discard only the draft and return to the score, preserving any saved baseline; navigating away retains its separate confirmation guard. Actual UI on both devices passes empty/drawn Cancel and verifies a saved passage retains its original one-box baseline after canceling an added second box.

**Next steps:** complete signed Release and guarded delivery, then repeat the actual Prokofiev/Beethoven selection and Cancel flows. Preserve the earlier build9 acceptance and failure history. Evidence and pending checks: `docs/qa/ios/2.0.0/build10/selection-consistency.md`.

## October 10 — build9 named physical interactions accepted

**Installed iPad: native2.0.0/build9/schema5 from `2de2444`. Launch/readback and named physical interactions pass. Broader acceptance remains scoped below. Mac:v11.1.0/schema21 unchanged.** On the iPad Pro12.9-inch (3rd generation, iPad8,5), iOS18.7.8, the prior build8 report was that the score cannot zoom while ink pans, Clean takes about one second, scrolling/menu/mode changes and warmup exit are delayed, passage selection updates about once every four seconds, and Pencil use crashes. These are physical observations, not accepted performance limits.

A45-second physical build8 Time Profiler capture records18.293 seconds of main-thread sampled CPU time, including12.276 seconds in `syncAll`. Instruments identifies14 hang/microhang intervals, the longest2.0187 seconds. The leading stack is `String(format:)` → `Data.praeludeHexLiteral` → `InkStrokeSyncRow` → `enqueueLibrarySnapshot` → scheduled `syncAll`. Inclusive samples overlap; hang duration is not measured touch-to-frame latency. These are build8 measurements, not evidence of build9 improvement. Sanitized evidence is `docs/qa/ios/2.0.0/build9/build8-physical-performance.json`.

Installed build9 source repairs: PDFKit owns page pan/zoom while the drawing canvas stays fixed; bounded app-owned drawing-value history replaces native tile Undo registrations; durable practice sync entries batch in parent-before-child order with debounced draining and account/revision-scoped snapshot reuse; a byte lookup replaces per-byte NSString formatting while retaining the existing hex wire format. Core412 and full native258 (1 live-account skip,0 failures) pass before the final gesture-priority change; two iPad practice/selection UI cases also pass. The earlier actual pinch failure is retained in QA. Undo now waits for the native pinch recognizer to fail and cannot recognize simultaneously. All14 targeted native interaction tests and fresh source review pass after that change. Actual UI5x pinch raises PDF scale to2.3177427145 from minimum1.0255516841 with the ink stroke retained; independent before/after pixel review accepts score/ink alignment and the settled palette. Actual two-finger Undo passes in Draw and reading. Two attempts to place the zoomed two-finger tap through XCTest fail because the target lies in a clipped viewport; this does not establish a production failure or a pass. The final gesture UI passes70.518 seconds: actual stroke, two-finger Undo in Draw/reading, Redo, mode change, strict real PDF pinch with unchanged ink, toolbar Undo/Redo at zoom, Done and saved ink after relaunch. Physical two-finger Undo at zoom remains pending. Source is frozen. Signed device build9 Release and strict app/profile/team/device/signer-trust and Release fixture/debug-exclusion checks pass. The same-bundle profile expires October16 at23:56:11 UTC (7:56 PM EDT). Independent signed-artifact verification and guarded installation also pass. Build9 is installed and running; independent post-launch preservation passes. On October10, the user confirms score pinch-zoom, Pencil marks → Done, two-finger Undo, passage selection and button response: “Those actions work and feel responsive.” These named interactions are user-accepted on source `2de2444`; measured latency, Undo specifically while zoomed, microphone/two-device behavior and sustained or week-long reliability remain unverified.

**Installed build9 checkpoint:** source `2de2444a782cb54a5cd31966ecc33257e4511dd0`, tag `ios-v2.0.0-build9-candidate`, is installed through the guarded same-bundle refresh. Independent review verifies all13 owned files/12,960,329 bytes identical by filename, size and SHA-256 before launch. Schema5/revision2167 retains6 pieces/53 passages/54 set IDs (53 historical plus1 paused active set)/35 sessions/317 attempts/259 ink records (202 active)/2 stamps/2 notes. The paused set is preserved; it is not a running set or an empty active slot. Actual post-helper Release signing/profile checks pass; expiry remains October16 at23:56:11 UTC (7:56 PM EDT). iOS denied automatic launch, then the user confirmed opening build9 and read-only process inspection confirmed it running. Independent complete post-launch readback at October10 00:57:50 UTC (October9 8:57:50 PM EDT) verifies the same13 files/12,960,329 bytes unchanged, schema5/revision2167 and every original record including the paused set. Undo specifically while zoomed and sustained practice remain unverified. Both build9 traces completed but were effectively idle: the45-second trace has12 all-thread samples/5 main-thread CPU milliseconds; the120-second trace has15 all-thread samples/8 main-thread samples (8 milliseconds). Neither reports potential hangs, but neither proves active score gestures or a speedup; foreground lifecycle is unknown. The October10 user confirmation accepts the named actions separately from these inconclusive traces. Evidence: `docs/qa/ios/2.0.0/build9/personal-ipad-install.json`.

**Next steps:** continue practice with the accepted interactions; separately verify combined zoomed Undo, microphone/two-device paths and sustained use. Capture active-use profiling if a latency issue recurs. Preserve the paused set and keep installation/preservation separate from physical acceptance. No week-long or zero-defect claim is supported.

Evidence and planned checks: `docs/qa/ios/2.0.0/build9/responsiveness-regressions.md`; the separate Undo repair ledger is `docs/qa/ios/2.0.0/build9/undo-repair.md`.

**Current source follow-up (October 9):** [build8 usability repair and 45-item acceptance report](build8/usability-review.md), with [physical build7 freeze diagnosis](build8/crash-analysis.md). Build8/schema5 is installed, and a physical failure is under diagnosis. Phone1 completes242 native tests/1 live-account skip/0 failures and three of four UI cases pass, with accessibility selection Done failing on its earlier source. Repaired iPad UI12 completes243 native/1 skip/0 failures and both sticky edit/relaunch and accessibility portrait/landscape UI cases pass. Rename did not execute in UI12 due an incorrect selector; Phone2 correct actual rename passes52.388s and selection Done is reachable in both orientations, but later landscape annotation fails with a3-pixel tool viewport. Phone3 now passes repaired accessibility portrait/landscape in 71.631 seconds, with four independently accepted screenshots. UI13 later records 244 native/1 live-account skip/2 assertion failures in one note-frame case and a missing actual triple-tap target. UI14 passes the complete actual sticky create/hold-drag/double-tap-edit/relaunch/triple-tap/permission-denied recovery flow in 71.060 seconds. Its native suite executes 245 tests with 1 live-account skip and the same 2 zoom-frame assertion failures in one case; all other native cases pass, including PDF accessibility publication and hidden-wrapper guards. The aggregate does not pass. UI15 repeats the complete actual sticky triple-tap/recovery flow successfully in 59.539 seconds. Native245/1 live-account skip still has two frame assertions failing in one case, now with a zero frame. A detached test fixture is suspected; the test now asynchronously mounts a real UIWindowScene/window and asserts overlay.window identity before applying the transform. Only the test fixture changed after the UI15 production source. The final strict native run now passes245 tests/1 live-account skip/0 failures in16.881s; mounted-scene/window identity and crop/zoom assertions pass. UI12 does not cover later source edits. Source review, signed Release and guarded installation pass; physical acceptance has failed and diagnosis remains active.

**Installed build8 — physical Undo crash remains open:** native2.0.0/build8/schema5 from `a23cdec4f4f9acf42e8e5c724b6a386430dddca5` is installed. Independent review verifies all13 owned files/12,788,247 bytes unchanged by filename, size and SHA-256 before launch. Automatic launch was declined; the user opened the app. The23:59:40 UTC readback retains schema5/revision2086 (from2079),6 pieces/51 passages/50 sets/31 sessions/304 attempts/255 ink records (199 active)/2 stamps/2 notes. Original records remain exact except one piece page bookmark; profile/privacy/account/score data are exact. This readback precedes the23:59:53 UTC crash and is not post-crash retention proof. The user reported failure at19:59:56 EDT. Matching build8 dSYM identifies main-thread `EXC_BAD_ACCESS` at0x10 in `PKTiledView.performUndo` tile update, reached through the two-finger Undo action; this is distinct from the build7 PDF watchdog. Exact user sequence remains pending and the crash is unclosed. Signed Release checks pass, with profile valid through October16 at23:56:11 UTC (7:56 PM EDT). Sanitized evidence: `docs/qa/ios/2.0.0/build8/personal-ipad-install.json`. Mac v11.1.0/schema21 is unchanged.

**Historical installed build7 follow-up (October 7):** [build7 stability repairs, native verification and guarded installation](build7/stability.md); [complete session handoff](build7/session-handoff.md). Build7/schema5 is installed on the personal iPad; the user confirms receipt. Installation, exact file preservation and running-process/schema readback pass. Physical Pencil/audio/long-session/refresh-rate/two-device acceptance remains open.

Historical follow-ups: [build6 compact practice](compact-practice.md), [build5/schema5 score workflow](score-workflow.md), and [build4/schema4 practice polish](practice-polish.md). Everything below retains the October 2 build3 review and does not override the current installed build8 and unresolved physical-failure boundary.

**Development candidate: 2.0.0/build3/schema3.** Base before this session: `8c87409`. Implementation: `635a5ae`.
The [verification manifest](verification.json) records exact Release input/binary fingerprints and scoped check results.
User request: bring Mac scores/practice data to iOS and review current Supabase/native app for real pianist practicality.
No Mac application replacement, source-database rewrite, hosted backend mutation, user-account signup/upload,
or physical-device installation occurred. Read-only device status found no connected hardware.

## What is present now

The current source is much broader than the historical 1.1 README. SwiftUI/PDFKit/PencilKit supply
page-first scores, multi-box passages, ink layers, page tools, links, score scan import, organization,
setlists, bookmarks and performance mode. Practice includes explicit verdicts, tempo/variants,
learning rules, multi-instrument configuration, warmups, metronome, optional tuner/drone/recording,
fixed on-device voice commands, history/insights/notebook, rewards and social surfaces. Supabase config,
pinned SDK and migrations exist; this session does not infer hosted acceptance from their existence.

The score-first structure and deterministic verdict loop suit pianist practice. Touch-only use works
without mic/account/network. Significant friction was found by source and actual native reviews.

## Findings and resulting changes

| Finding | Consequence at a piano | Current candidate behavior | Verification boundary |
| --- | --- | --- | --- |
| Idle setup occupied nearly half the score screen | Music too small before practice starts | Compact passage/tempo/Start dock; full configuration expands on demand | Real Beethoven native screenshot inspected |
| Eight controls in one fixed-width row | Controls fall outside narrow phone/windows | Adaptive full row or stacked transport/verdict rows | Native phone/iPad geometry checks; hardware touch pending |
| Feedback added height to score inset | Notation rescaled/repositioned after repetitions | Acknowledgements occupy existing dock bounds | Native Clean/Sloppy frame checks and visual inspection |
| Multi-page passage turned after every verdict | Retry could begin on a middle page | Explicit opt-in, initially off | Source/helper tests; musical passage hardware check pending |
| Start session skipped planned warmups | Plan's first action silently changed | Launches first planned warmup | Native plan-start checks |
| Ten phone tabs | UIKit More obscured destinations unpredictably | Four main tabs plus deliberate More list | Native phone navigation check |
| First hands-free check did not start listening | Pianist needed a second enable action | Requested listening starts after initial check dismissal | Source/native build; physical mic/permission/interruption acceptance pending |
| Performance exit hidden | Player could be stranded during performance | Menu wording plus brief exit hint | Source/native build; physical page-turn performance pending |
| Backup contained recording metadata without bytes | Restore could leave missing recordings | Audio bytes included; incomplete old backups refuse replacement | Hosted regression checks below |
| Sync cap/client timestamps/ignored saves | Large or offline practice histories could disappear from device view | Paginated reads, complete log reconciliation, throwing durable apply, persisted catches/retries | Fake transport/Core checks; hosted two-device acceptance pending |
| First-device completed-set ordering | Set validated before reps, or session closed before active set moved | Atomic sessions/sets/reps reconstruction, with durable validation and retry | 41 sync checks; independent standalone completion/closure/reopen/failure reproductions pass |

The optional R6 tempo-drop and R14 pulse-drop rules are explicitly authorized by current Build Spec v2 §11;
their defaults were not changed. They can be disabled in Practice rules. They are still musician-authored
practice structure, not piano audio grading.

## Mac library transfer and fidelity

`ios/scripts/export_desktop.py` reads SQLite through a read-only connection and SQLite backup API,
verifies integrity/foreign keys and refuses unfinished practice. It exports every table with exact
values, retains the original database bytes and gathers actual score editions without directory-symlink
following. JSON tables were independently compared with all 46 tables in the preserved snapshot.
Original score names/paths/fingerprints are retained privately; no real data belongs in Git.

October 2 private complete archive: **158,357,571 bytes**, SHA256
`c4b303c37d43bbfbe129976681cb47674f3dceeeff9c8ca4c70d26b9afb5c2b8`.
Database SHA256 `afd5d18d74d619654d329754944f6be97e1d27133bc7ce0f2a6ce761c8f000e8`.
Snapshot: 11 piece rows (one system), 140 regions, 31 goals, 3,313 reps, 370 sets, 67 sessions,
14 PDF edition paths/13 distinct PDFs (39,495,428 bytes). The live DB was not changed by export.
One score, “Aolean Harp Contemporary,” is unavailable; all its records remain. Stale original paths
for two pieces resolve through available current-folder editions with explicit warnings. Related
unsupported tutorial/video or other filesystem assets are reported; this is not a full vault backup.

Settings → Import from Mac previews counts/warnings and adds native scores, edition-aware boxes,
matching pencil marks and goals. Integer identities use a stable separate namespace. Existing native
records/preferences/history/rewards win; identical import preserves edits and repairs missing identical
files. Original Mac sets retain their actual contracts, verdict vocabulary and correction events in
Progress → Mac practice record. Replaying them through different native rules would invent mastery,
so they do not grant rewards or populate native insight projections. All original table rows remain readable.
System Warm-ups is kept in the archive rather than creating a duplicate repertoire piece.

Files stage first, prior ledger is preserved and byte-verified, atomic ledger save commits last.
Failures remove only newly staged files. Original Mac archives travel in native backup/restore along
with score/cover/ink/recording data. Payload is bounded to 210 MB and encoded JSON to 280 MB; very large
existing libraries or repeated whole snapshots can exceed this limit and are refused. This is a one-time
reviewed snapshot bridge; subsequent continuous Mac↔iOS synchronization is not implemented.

## Checks and evidence

- Final Core suite: 343 tests, zero failures.41 focused sync tests include the independent verifier’s graph-ordering cases.
- Python helper/exporter suite: 52 tests, zero failures (30 device helpers + 22 exporter tests). Schema3 guarded updates preserve archives/recordings and still refuse running practice/unknown formats.
- Exporter real PDFKit page count and exact 46-table snapshot parity pass.
- Final current-source iPad hosted run: 175 tests executed, one live Supabase smoke test skipped, zero failures. Standard Xcode scheme/build settings, without the isolated linker override.
- Deterministic service harness: 2,199 voice/metronome/tap-tempo/reward/PCM assertions pass.
- Final current-source iPad UI run: transfer navigation, adaptive HUD/stable PDF geometry, compact idle tempo and private real-library import all pass. Warmup-first plan start and other listed regressions pass in separate scoped runs. The later exact-source backup compatibility run again passes the private import/start/Sloppy probe (47.320 seconds), including unchanged multi-page passage page and durable Undo.
- Phone transfer-entry and adaptive geometry scenarios pass; final isolated compact-tempo drag/one-tap expand scenario passes (59.478 seconds), using one score-row press. These are scoped passes across runs, not an all-green full UI scheme.
- Unsigned arm64 iOS Release build succeeds for 2.0.0/build3/iOS17. Binary inspection finds no DEBUG UI-test flags, desktop-transfer test entry or private transfer path. This is compilation, not signed distribution or physical launch.
- Native screenshots were visually inspected. Synthetic screenshots may be committed; personal score/library
  screenshots and transferred archives remain only in private simulator/temp directories.
- Failed UI setup attempts are retained: passage picker did not open in first geometry probe; Settings list
  virtualization/timing prevented first transfer-entry probes; scroll-adjacent Today taps sometimes did not invoke the row action. The final tempo run used one tap successfully, but the cause of those earlier ignored taps remains unproven. Their failures are not counted as passes.
- Sandbox SwiftPM/CoreSimulator failures were environment restrictions; authorized host runs supplied actual evidence.
- One isolated native build with a different derived-data directory hit the existing Helpers-framework
  workaround and passed only with a linker override. Standard configured builds, rather than that override,
  are required for the final acceptance record.

**Independent fresh review:** no remaining P1 found in reviewed scope. Remote complete-set/session closure and missing-rep failures were independently reproduced, then fixed and rechecked against real persistence/reopen behavior. Native backup version2 compatibility was reviewed: archives/audio use version2 so older readers refuse before replacement; ordinary backups without those new fields retain version1. Final hosted run covers that exact source.

### Selected native UI results across runs

| Scenario | iPad seconds | Phone seconds |
| --- | ---: | ---: |
| HUD collapse keeps controls reachable | 41.296 | — |
| Today starts first planned warmup | 12.610 | 10.200 |
| Today starts new passage through cold grading | 12.887 | 13.698 |
| Compact main/secondary navigation | — | 29.310 |
| Mac transfer entry opens Files | 29.482 | 39.665 |
| Controls fit and verdict leaves score stable | 21.528 | 27.440 |
| Compact tempo drag and one-tap configuration | 18.576 | 59.478 |
| Actual Mac import, passage, Start and Sloppy | 47.320 | — |

These are individual scoped passes across retained results. The final hosted backup-compatibility result
is private at `Praelude iOS Audit-2026-10-02/final-backup-compatibility.xcresult`; final isolated phone tempo
is `/tmp/praelude-practicality-phone-oct2-tempo-retry.xcresult`. Personal result bundles/screenshots remain outside Git.

## Real native Mac import (private simulator probe)

The 158 MB actual transfer imports into the separate DEBUG test store successfully: 14 native piece/edition
entries, 140 passages, 31 goals, 32 ink strokes, 13 owned PDFs and one original archive. Independently inspected
Beethoven movement 2 page 1/9 is legible and passage boxes align with the staves. Original history/database
remains local. Import itself grants no practice/rewards; interaction probes stay in the disposable DEBUG test store.
The final compact idle dock leaves substantially more room for the score; full settings remain one tap away.
The actual score, aligned multi-system boxes and compact controls were independently inspected in private native screenshots.

## Explicit remaining gaps

- Physical device was absent: no in-place install/import, new schema acceptance, touch/Pencil/Steinway voice,
  sustained audio, page-turn interruption, printing/accessibility or real practice motivation verdict.
- User's intended account and actual two-device hosted synchronization were not exercised. Hosted migrations,
  RLS/privacy regressions and deployment were not independently rerun; prior backend documents are historical evidence.
- Cloud goals/routines/custom cover bytes, raw Mac archives and ongoing desktop adapter are absent. Account switching on one local
  library is deliberately refused instead of mixing owners.
- Backend generic piece upsert can overwrite an independent newer page clock; backend receive sequence and
  remote file-content versions are absent. Full pulls favor correctness over network efficiency.
- Original-history viewer exposes only the latest receipt; preserved snapshots remain in local backups.
  Mac history is readable, with original corrections, but not integrated into mobile reward/insight computation.
- Intermittent simulator Today-row first-tap/navigation failures after scrolling remain unexplained; final isolated phone navigation/tempo succeeds without retry. Retest cold navigation on hardware.
- Some score aliases reference identical PDFs; native duplicate editions are deduplicated by content. Unsupported
  raw Mac data is preserved/readable, not represented as new native features.

**Next steps:** obtain the exact user sequence and reproduce the confirmed native two-finger Undo crash before accepting its repair. Keep the23:59:40 UTC readback separate from post-crash retention. Keep physical Pencil, microphone, large-score and sustained-use acceptance open; do not treat installation as task completion.
score selection/ink/history on hardware; then intended-account/real second-device synchronization and desktop adapter.
