# Praelude Mobile


## October12 — Build15 prepared for controlled device validation, installation held

**All affected simulator/live/package gates pass. Both physical iPads remain untouched and last verified12; Mac11.1.0/schema21 is unchanged.** Native2.0.0/build15/schema5 is prepared for the next authorized device-validation step, with no bug-free or physical-acceptance claim. Checkpoint `ios-v2.0.0-build15-device-validation` identifies the final source; the original failed `ios-v2.0.0-build15-candidate` tag remains unchanged.

Actual44pt armed Edit padding/name112.5/Save/process-relaunch passes, including independent normal-UI readback. Only intended passage fields/update metadata and revision change; other records/PDF are exact. Absolute manual zoom now survives height-only practice-HUD changes: actual pinch/pan/arm passes64.577s and independently70.062s, all16 strict predicates, exact2.4332361227405377 across927→901pt; two affected native layout checks pass. At-fit, explicit refit, width/rotation and automatic short-landscape rules are retained.

The named fifth/fourteenth/third-launch test failures have matched simulator logs: XCTest's virtual digitizer disappears while its contact remains down, causing cancellation before UIWindow forwarding. A HARNESS-only single120ms same-center contact/no retry passes20 delivery-checked and10 untraced fresh launches with protected practice state,20began/20ended/0cancelled and no live-contact teardown in OS logs. No production cancelled-touch fallback is introduced. Independent normal navigation/first arm/Edit/Focus/Close/relaunch/Cancel also pass.

Generic signed Release15 and archive readback pass:29 root/40 independent checks,65 diagnostic markers absent, matching arm64 dSYM/fonts/resources; profile valid through2026-10-17 16:14:24UTC. Signed executable `b3c21602064f27282cf40e0d04f79a2445d6dae2424f179cb6fe4a9c2742f4f8`; ignored archive `releases/ios-build15-verified-20261012`. Exact-device inclusion is not queried or claimed. Manual landscape rotation was not established; separately recorded actual rotation/native scopes remain in QA. Physical speech/camera/Pencil/click/OS/sustained acceptance and unmatched historical failures remain unproven.

**Next steps:** maintain the no-install hold. Future authorized device validation must separately pass exact-target/profile, fresh idle/paused backup, full-file preservation, launch/readback and physical acceptance. Evidence/screenshots: `docs/qa/ios/2.0.0/build15/README.md`.

## Historical October11 bounded build15 report — failed final18

**Native2.0.0/build15/schema5 is held. Both physical iPads remain untouched and last verified at build12; Mac11.1.0/schema21 is unchanged.** The user narrowed the task to finishing the current tap/note/Back/rotation verification and reporting passes, failures and untested boundaries, without further scope or diagnostic loops.

Final18 executes316 tests:313 passed,2 failed,1 live-account skip. All308 native cases have0 failures(15.960s). Six of8 actual simulator UI cases pass: ink/Undo/new stroke/save/process-relaunch86.400s; eight selected-box double/Cancel cycles then triple/ordinary editing167.412s; actual rotation/Sidebar/Focus with saved ink179.912s; New Text dictation Cancel80.870s; Voice Check Back112.620s; saved-note dictation Cancel106.990s. Speech inputs are explicitly synthetic.

**The current tap repair fails.** The normal10-launch case succeeds4 times, then one valid saved-box center tap on launch5 leaves Whole piece unchanged(105.004s). The all-saved-region routing change is insufficient; B155 remains open and its loss point is unknown. The separate zoom case fails69.327s at its combined final assertion: real pinch/pan succeed and the correct passage actually arms, but the last absolute-scale comparison does not pass after the viewport changes927→901pt. Exact failed scale/minimum values were not captured; zoom preservation remains unaccepted, without classifying that case as a tap no-op.

Build15 also contains the earlier scoped recovery/Edit/owned-Sidebar, Undo-context, nested-command, Mute, audio-notification, armed-click, End reachability and editor-voice-handoff repairs. Their individual runs and binary scopes remain in the full QA history; they are not a blanket acceptance of this failed candidate. No schema/history snapshot change. The armed-pencil9.5pt target is newly observed and unrepaired; uncompiled shape/diagnostic additions were reverted to final18 source when scope was narrowed.

Fresh manual verification of this final binary, a signed build15 Release audit, physical mic/camera/Pencil/click/OS behavior and sustained practice remain untested. No final19 run, extra diagnostic sweep, Release build or physical-device action follows this checkpoint. No bug-free or fully-functional claim is supported.

Current report: `docs/qa/ios/2.0.0/build15/README.md`; raw scopes/failures: `functional-flows.md`, `functional-final18-summary.json` and `functional-final18-provenance.json` in that directory.

**Next steps:** report these results and preserve the candidate as not ready. Keep both iPads on the explicit hold; further repair/verification is outside this bounded checkpoint.

## October 11 — functional audit; build14 held from delivery

**Current source: native2.0.0/build14/schema5, held from delivery. Both iPads last verified installed at build12; Macv11.1.0/schema21 unchanged. Last updated:2026-10-11.** The user's challenge exposes an acceptance gap: a build and service tests do not establish a bug-free, fully functional app. Actual simulator drawing→Undo→new branch→pinch→save/reopen and decimal passage goals pass. Today pixels/AX verify2 due URGENT reviews and a future Tough passage without URGENT. Voice recognition/camera detection checks use injected or synthetic inputs; speech over piano, physical face mapping/light/orientations, Pencil, audible click and sustained practice remain unaccepted.

The audit finds and repairs stale passage-dictation intent: all four rename entry paths now explicitly set ordinary versus dictation intent and clear it on dismissal. It also finds lingering red voice text behind the rename editor. Build14 replaces that score caption with a neutral attention indicator on the existing44pt microphone control; tapping it opens Hands-free details/recovery. No practice/sync schema changes. Final native304 cases/1 live-account skip/0 failures pass16.224s. Fresh6 actual box selection, dock-name double tap and name/108.5 goal Save succeed, then selected-box double tap fails to open the editor (58.198s case failure). Triple-tap/ordinary-reopen and the new voice attention/details flow are not fully accepted; no blanket UI pass is claimed.

**Open functional failures:** valid-coordinate taps intermittently leave camera options, review queue, sidebar, score card or Passages unopened. Fresh5 fails at Passages before any rename/badge assertion; fresh4 successfully opened the same target. Source cause and first-tap/sustained reliability are unproved (B155). Tests preserve every failed, compile-only and selector-correction run. Protected practice/passages/schedules remain exact apart from intentional name/goal edits; startup reward/rank normalization is reported separately, not as all-record/byte equality.

**Package/delivery:** generic signed Release/profile/entitlement/trust/private-key/dSYM/resource checks pass, including absence of all new DEBUG audit fixtures. Executable SHA-256 starts `94a3b019`; profile expires October17 at16:14:24 UTC. This is a package audit, not functional readiness or exact-device inclusion. Build13's original tag/archive remain unchanged and held. No build13/build14 backup, installation or launch occurred. The user will connect when ready; readiness has not been confirmed. Evidence: `docs/qa/ios/2.0.0/build13/functional-audit.md`, `docs/qa/ios/2.0.0/build14/functional-follow-up.md`, `signed-release.json`.

**Next steps:** diagnose the unresolved opening/selected-box gesture failures under B155 before calling the candidate ready. Preserve failed runs and the unaccepted combined rename/voice recovery flow. Later guarded same-bundle delivery requires explicit readiness, fresh idle backup, complete-file comparison and separate launch/readback. Physical acceptance remains separate; no bug-free or fully-functional claim is supported.

## Earlier October 11 — build13 checkpoint, subsequently held

**Historical source checkpoint: native2.0.0/build13/schema5, subsequently held after the functional audit above. Both iPads last verified installed at build12; Macv11.1.0/schema21 unchanged. Last updated:2026-10-11.** New feedback reproduces Undo→new draw resurrection in the live simulator:1 stroke→Undo0→new stroke2 before saving. Build13 replaces the native PencilKit canvas at Undo/Redo while preserving independent history and exact source-stroke identity. Actual new-branch/pinch/Undo/Redo/save/relaunch and independent disjoint-stroke-bounds checks pass. Physical Pencil acceptance remains open.

Voice retains opt-in/ownership through bounded recovery, captures bounded next-utterance audio while finalizing and rejects stale/duplicate finals. Timed repeated verdicts require distinct acoustic gaps. Bare **Next** turns a page; **Next set** explicitly starts another completed-passage set. Name & goal editing is available by pencil/double-tap and in passage lists; triple-tap dictation remains. Existing name/performance_tempo fields preserve active/historical set snapshots. First-attempt Metronome On/Off starts/stops actual preview playback. Today/session queues retain Learning after lapse, mark overdue/due tough passages **URGENT**, and show future tough dates/latest self-reports without inventing grades.

Optional camera gestures map nod/shake/grin to page turns, verdicts or Off. Preview starts minimized, with optional landmarks and low-light/multiple-face feedback. Capture is video-only, on-device and discarded; no recording, identity recognition or frame upload. One score owner, permission generations, fresh neutral calibration, dwell/return/cooldown, stale-frame/editor/focus guards and background/exit cleanup fence actions. Failed recalibration clears the old baseline. Rep verdicts need separate opt-in and a running set. Camera settings/preview/calibration remain local/transient as documented; physical accuracy in piano posture/light/orientation is unverified and no perfect-recognition claim is made.

**Verification:** full core451 cases/1 skip/0 failures and deterministic service2,340 assertions pass. Final-source native304/1 live-account skip/0 failures16.352s passes. Four independent actual UI flows pass across fresh2/fresh6: Undo/new branch/location/save/reopen; name/112.5 goal/save/relaunch; first-attempt click/Missed→upcoming Tough; camera defaults/mapping/save/relaunch/reopen/restore (98.516s). Independent source and iPad portrait visual review finds no remaining blocker. Earlier fixture/compile failures, center-switch no-op and centered menu-opening no-op remain in QA; B155 first-tap/sustained reliability is unaccepted. Camera capture, perceived click volume, speech over piano and sustained use remain physical gates.

**Delivery boundary:** generic signed Release and independent strict bundle/profile/entitlement/signer-trust/private-key/dSYM/resource checks pass; profile expires October17 at16:14:24 UTC. Candidate executable SHA-256 starts `3f0462ea`; actual helper-built artifact must be reverified. Exact-device preflight reports development services not ready, so no build13 backup/install/launch occurs and the user readiness question remains pending. Current-device profile inclusion, fresh idle-library backup, full-file preservation and post-launch readback are pending. Schema5, protected history and native sync fields remain; camera mappings are device-local and real-account/continuous desktop convergence is unverified. Evidence: `docs/qa/ios/2.0.0/build13/practice-reliability.md`, `signed-release.json`, `candidate-guide.md`.

**Next steps:** after explicit connected/unlocked/open/paused-or-idle readiness, validate the exact personal target and run guarded same-bundle refresh with independent complete-file comparison; verify user launch/readback separately. Physically test Undo→new draw, calibration/lighting/orientations/false actions, repeated Clean over piano, audible first-attempt click and sustained practice. Keep B155 and all unaccepted physical gates open.

## October 11 — friend’s build12 delivery recorded

The October10 guarded update of the exact friend’s **iPad (6)** installed native2.0.0/build12/schema5 from `459081c`. Independent comparison of `20261010T204159Z-5efce8ed` → `20261010T204231Z-3fc3a700` verifies all **3 files/38,874,123 bytes** identical by filename, size and SHA-256. Schema5/revision85 retains3 pieces,4 passages,3 historical sets,2 sessions and3 attempts, with no active set. This preserves the friend’s existing library; no personal data was copied. Actual helper-artifact signing/profile/device/dSYM checks pass. Automatic launch was declined; Christian confirms opening Praelude. A read-only process query failed before backup and the exact device was then unavailable, so full post-launch retention and physical feature acceptance remain unverified. Evidence: `docs/qa/ios/2.0.0/build12/friend-ipad-install.json` and `friend-signed-release.json`.

**Current installed boundary:** both iPads last verified at build12; personal post-launch retention passes with documented Sync-only changes; friend opening is user-confirmed with post-launch readback unverified. Macv11.1.0/schema21 is unchanged.

**Next steps:** investigate the newly reported Undo→draw resurrection, voice interruptions, camera gestures, passage goal editing, first-attempt click and urgent review. These reports reopen physical usability; build12 installation does not establish their correctness.


## October 10 — build12 installed and opened; physical feature acceptance pending

**Personal iPad: native 2.0.0/build12/schema5, source `459081c` (tag `ios-v2.0.0-build12-candidate`), installed and user-opened. Friend’s subsequent build12 delivery is recorded above. Mac v11.1.0/schema21 is unchanged. Last updated: 2026-10-10.** All 19 requested areas have implementations: score focus with rep-input suspension; saved top/bottom controls and white-margin turns; direct L/Both/R verdict capture; score/Today passage naming; sequential drawing history and normalized huge-page brush widths; expandable accidental-first stamps; arbitrary/transparent note backgrounds; supported voice aliases, confirmation and diagnostics; independent full-tempo references, provenance-aware practice balance and measure-map guidance/correction.

Core 438, deterministic service 2,327 and helper 57 pass. Final native10 executes 294 cases with 1 live-account skip and 0 failures in 17.463s. Scoped iPad UI covers focus/count preservation, control-position persistence, hands, Today names, full-tempo/quarter-speed provenance, both double-tap rename paths, Undo/Redo/pinch/save/relaunch, stamps, oversized selection/Cancel and alias recovery/diagnostics. UI3 passes all 3 cases in 162.209s, including ordinary/huge Transparent→Yellow→Transparent, resize/format/save/relaunch/reopen and settled gutters. Independent fresh3 passes focus and oversized-note persistence in 109.403s on the same final production binary. Fresh1 overscrolling and fresh2 unexplained valid-coordinate no-op taps remain recorded; this is scoped acceptance, not first-tap or sustained reliability. Fresh3 does not validate newly compiled test-only stability/scroll helpers; matching built/installed runner hashes do not resolve the differing log traversal. Phone control width is repaired; largest-text stamp reachability and actual phone landscape remain unaccepted.

Final-source simulator unique-page timings: ordinary first visible page2 request 81.850ms/warm 69.293ms/rapid 72.696ms; huge 99.431/91.576/107.325ms. Fresh four-page raster PDFs, current-page identity and unique nonblank pixels, 10ms polling/screenshot overhead and uninstrumented PDFKit prefetch. Earlier faster samples remain in QA; no physical touch latency or controlled speedup claim. Five actual PDFs were opened by the host scanner; two pages returned no hints, and bar-number correctness/manual iPad mapping remain open. Optional user-defined coverage signals suppress sparse/missing data and never judge playing. Sync/local/snapshot-only and older-client loss boundaries are explicit.

**Guarded installation:** an initial read-only preflight stopped on a size change while a set was running; no install occurred. After Christian confirmed idle readiness, guarded refresh preserved all 13 files/15,674,360 bytes exactly by filename, size and SHA-256: `20261010T194140Z-d9993743` → `20261010T194209Z-47d3fadd`. Schema5/revision2848 retains 6 pieces,66 passages,62 historical sets plus1 completed active-slot set (63 unique set IDs),40 sessions,393 attempts,343 ink rows (267 active),20 stamps and5 notes. This current completed set replaces the historical paused revision2264 checkpoint; no running set was interrupted. Independent actual-helper-artifact checks pass; executable SHA-256 `9c4ea7130c15a56df04ca700c4dff201628d9f56b963108fa508c394c7dfd534`, profile expires October17 at16:14:24 UTC. The helper rebuild changed the initial artifact hash, and the actual artifact was reverified.

Automatic launch was declined by iOS. Christian then confirms opening Praelude; a read-only process query observes it running. Complete post-launch backup `20261010T194327Z-d6aff550` at19:43:35 UTC still has schema5/revision2848 and the completed set. Independent post-launch verification retains every original record, ledger, score, profile/privacy and preferences. Two Sync files change after opening (+3,933 bytes; total15,678,293), so all13 files are not byte-identical across launch. Installation preservation remains exact. Evidence: `docs/qa/ios/2.0.0/build12/personal-ipad-install.json`; opening is not physical feature acceptance.

**Next steps:** use build12 and physically verify focus/count resumption, both control positions, ordinary/huge page turns, Pencil Undo/Redo through zoom/save/relaunch, brush widths, stamp lift, transparent notes, commands over piano and manual real-score mapping. Sustained performance, intermittent tap reliability, actual phone landscape/largest text and real-account sync remain open. Full checklist/failures: `docs/qa/ios/2.0.0/build12/practice-upgrade.md`; installed instructions: `docs/qa/ios/2.0.0/build12/candidate-guide.md`.

## October 10 — build11 installed on both iPads; personal launch pending

**Both iPads now have native2.0.0/build11/schema5 from `646fd6cd26fd6fe6ef81df0dd22da9cdd59fb2d9` (tag `ios-v2.0.0-build11-candidate`); Macv11.1.0/schema21 is unchanged. Last updated:2026-10-10.** The friend’s `iPad (6)` received a fresh generic empty install with no copied personal data or prior owned inventory to compare. Christian now confirms opening it; that device is unavailable, so initial-library readback and physical note acceptance remain unverified. Christian’s personal iPad receives a guarded same-bundle build11 refresh. Independent review verifies all13 owned files/13,568,473 bytes identical by filename, size and SHA-256, including schema5/revision2264 and the paused active set. Automatic personal launch is denied; readback confirms installed11 with no running process, and the user is asked to open it.

Build11 work uses a consistent page-width basis for note text, corner resizing, a lower scrollable formatting section and a shared text renderer for screen/PDF export. Styling covers size, font, bold, italic, color and alignment. Old notes get readable defaults without rewriting the library on open. Style stays in the existing sync region JSON; an older client can drop unsupported styling when it rewrites a note.

**Verification:** core420 and final-source iPad5 native64 pass (native tests5.446s), including the saved-note receipt regression. Oversized create/resize/format/save/relaunch UI passes1131.493s; ordinary UI fails184.170s before note interaction at `openScore` line19 amid observed host load144. This is not a blanket UI or responsiveness pass. Fresh source review accepts the fixes. A clean targeted Release resolves the incremental sealed-resource failure; strict signing/target checks pass before installation and independently on the actual helper-built artifact afterward. Its profile expires October17 at16:14:24 UTC (12:14 PM EDT). B148 physical acceptance remains open. Evidence: `docs/qa/ios/2.0.0/build11/sticky-notes.md` and `friend-ipad-install.json` in that directory.

**Personal refresh checkpoint:** snapshots `20261010T162445Z-1f3e7476` → `20261010T162506Z-2d5ab44e` preserve all13 files/13,568,473 bytes and schema5/revision2264 exactly:6 pieces,60 passages,55 historical sets plus1 paused active set (56 unique set IDs),37 sessions,321 attempts,274 ink rows (217 active),2 stamps and4 notes. Profile/privacy/preferences are exact. The paused set remains paused, with zero running sets; it is not an empty active slot. Independent actual-artifact signing passes, with the same `ce2373e0…` executable as the friend’s install and profile expiry October17 at16:14:24 UTC. Personal launch/post-launch retention remains pending.

**Next steps:** confirm personal launch and inspect post-launch data separately. The friend’s user-confirmed launch does not establish initial-library readback or physical note acceptance. Keep unmatched UI/accessibility and B148 acceptance open.

## October 10 — build10 installed; qualified physical improvement

**Installed iPad: native2.0.0/build10/schema5, source `b22d4bf`. Scoped native/UI checks and guarded installation pass; the user reports qualified improvement after the selection/Cancel comparison. Macv11.1.0/schema21 is unchanged.** After accepting the earlier named interactions, the user reports that Prokofiev passage creation has no visible corner dots and lags badly, while Beethoven handles are smooth. That earlier acceptance does not establish consistency across scores. This new defect is B146.

Confirmed PDF metadata differs sharply: Prokofiev page10 is5609.6×7764.01 points; Beethoven page4 is626.76×874.92 points. The old overlay's minimum content scale of1 defeats its4-million-pixel cap on the larger page, permitting about43.55 million pixels;8-source-point handles shrink below1 screen point. These identify page-size-dependent rendering and handle-visibility defects. Overlay/state repairs are implemented and two fresh source reviews find no new blocker. Final ordinary/oversized selection UI passes on both iPad and iPhone, including blank/drawn Cancel, Undo/Redo/save and adding a second box to a saved passage, canceling, then reopening the original one-box baseline. All48 selected native checks pass on phone; iPad passes42 existing plus6 new checks across the recorded runs. Four independently accepted screenshots show consistent handles/borders and unclipped Cancel/Done. These are scoped checks, not a full-suite or performance-rate claim; earlier failures and the zero-test run remain in QA. Build10 is installed. Christian now replies “good it works better” to the selection/Cancel comparison. This is qualified improvement, not measured latency or zero-defect acceptance. The raster cap does not bound total PencilKit cache/RAM; the pre-existing cropped-resize limitation when the opposite edge is hidden remains.

The user also reports that selection Cancel does not work (B147). The installed repair makes explicit Cancel immediately discard only the draft and return to the score, preserving any saved baseline; navigating away retains its separate confirmation guard. Actual UI on both devices passes empty/drawn Cancel and verifies a saved passage retains its original one-box baseline after canceling an added second box.

**Installed build10 checkpoint:** source `b22d4bf3e25ff7309ff55ad3b700d5bb5f2713ea`, tag `ios-v2.0.0-build10-candidate`, is installed by guarded same-bundle refresh. Independent complete pre/post audit verifies all13 owned files/13,350,814 bytes identical by filename, size and SHA-256. The preserved schema5/revision2198 snapshot has6 pieces/57 passages/54 historical sets/35 sessions/317 attempts/270 ink rows (213 active)/2 stamps/2 notes and no active set. Actual post-helper strict signing and app/dSYM checks pass; profile expires October16 at23:56:11 UTC (7:56 PM EDT). Automatic launch was denied, but a subsequent read-only process inspection confirms build10 running; this is not attributed to a user opening confirmation. Independent post-launch retention at October10 14:58:32 UTC also passes: all13 files/13,350,814 bytes and the complete schema5/revision2198 ledger are identical across all three snapshots, including profile/privacy/account/preferences, sync files and source PDFs. There is no active set or added persisted activity; authorship is not inferred. Christian subsequently reports “good it works better” in the selection/Cancel comparison; retain that qualified improvement without inferring every edge case or sustained reliability.

**Next steps:** retain the qualified selection/Cancel improvement and verify the separate sticky-note repair (B148). Installation, running-process observation and complete post-launch preservation pass. Preserve the earlier build9 acceptance and failure history. Evidence and pending checks: `docs/qa/ios/2.0.0/build10/selection-consistency.md`.

## Historical October 10 — build9 named physical interactions accepted

**Installed iPad: native2.0.0/build9/schema5 from `2de2444`. Launch/readback and named physical interactions pass. Broader acceptance remains scoped below. Mac:v11.1.0/schema21 unchanged.** On the iPad Pro12.9-inch (3rd generation, iPad8,5), iOS18.7.8, the prior build8 report was that the score cannot zoom while ink pans, Clean takes about one second, scrolling/menu/mode changes and warmup exit are delayed, passage selection updates about once every four seconds, and Pencil use crashes. These are physical observations, not accepted performance limits.

A45-second physical build8 Time Profiler capture records18.293 seconds of main-thread sampled CPU time, including12.276 seconds in `syncAll`. Instruments identifies14 hang/microhang intervals, the longest2.0187 seconds. The leading stack is `String(format:)` → `Data.praeludeHexLiteral` → `InkStrokeSyncRow` → `enqueueLibrarySnapshot` → scheduled `syncAll`. Inclusive samples overlap; hang duration is not measured touch-to-frame latency. These are build8 measurements, not evidence of build9 improvement. Sanitized evidence is `docs/qa/ios/2.0.0/build9/build8-physical-performance.json`.

Installed build9 source repairs: PDFKit owns page pan/zoom while the drawing canvas stays fixed; bounded app-owned drawing-value history replaces native tile Undo registrations; durable practice sync entries batch in parent-before-child order with debounced draining and account/revision-scoped snapshot reuse; a byte lookup replaces per-byte NSString formatting while retaining the existing hex wire format. Core412 and full native258 (1 live-account skip,0 failures) pass before the final gesture-priority change; two iPad practice/selection UI cases also pass. The earlier actual pinch failure is retained in QA. Undo now waits for the native pinch recognizer to fail and cannot recognize simultaneously. All14 targeted native interaction tests and fresh source review pass after that change. Actual UI5x pinch raises PDF scale to2.3177427145 from minimum1.0255516841 with the ink stroke retained; independent before/after pixel review accepts score/ink alignment and the settled palette. Actual two-finger Undo passes in Draw and reading. Two attempts to place the zoomed two-finger tap through XCTest fail because the target lies in a clipped viewport; this does not establish a production failure or a pass. The final gesture UI passes70.518 seconds: actual stroke, two-finger Undo in Draw/reading, Redo, mode change, strict real PDF pinch with unchanged ink, toolbar Undo/Redo at zoom, Done and saved ink after relaunch. Physical two-finger Undo at zoom remains pending. Source is frozen. Signed device build9 Release and strict app/profile/team/device/signer-trust and Release fixture/debug-exclusion checks pass. The same-bundle profile expires October16 at23:56:11 UTC (7:56 PM EDT). Independent signed-artifact verification and guarded installation also pass. Build9 is installed and running; independent post-launch preservation passes. On October10, the user confirms score pinch-zoom, Pencil marks → Done, two-finger Undo, passage selection and button response: “Those actions work and feel responsive.” These named interactions are user-accepted on source `2de2444`; measured latency, Undo specifically while zoomed, microphone/two-device behavior and sustained or week-long reliability remain unverified.

**Installed build9 checkpoint:** source `2de2444a782cb54a5cd31966ecc33257e4511dd0`, tag `ios-v2.0.0-build9-candidate`, is installed through the guarded same-bundle refresh. Independent review verifies all13 owned files/12,960,329 bytes identical by filename, size and SHA-256 before launch. Schema5/revision2167 retains6 pieces/53 passages/54 set IDs (53 historical plus1 paused active set)/35 sessions/317 attempts/259 ink records (202 active)/2 stamps/2 notes. The paused set is preserved; it is not a running set or an empty active slot. Actual post-helper Release signing/profile checks pass; expiry remains October16 at23:56:11 UTC (7:56 PM EDT). iOS denied automatic launch, then the user confirmed opening build9 and read-only process inspection confirmed it running. Independent complete post-launch readback at October10 00:57:50 UTC (October9 8:57:50 PM EDT) verifies the same13 files/12,960,329 bytes unchanged, schema5/revision2167 and every original record including the paused set. Undo specifically while zoomed and sustained practice remain unverified. Both build9 traces completed but were effectively idle: the45-second trace has12 all-thread samples/5 main-thread CPU milliseconds; the120-second trace has15 all-thread samples/8 main-thread samples (8 milliseconds). Neither reports potential hangs, but neither proves active score gestures or a speedup; foreground lifecycle is unknown. The October10 user confirmation accepts the named actions separately from these inconclusive traces. Evidence: `docs/qa/ios/2.0.0/build9/personal-ipad-install.json`.

**Next steps:** continue practice with the accepted interactions; separately verify combined zoomed Undo, microphone/two-device paths and sustained use. Capture active-use profiling if a latency issue recurs. Preserve the paused set and keep installation/preservation separate from physical acceptance. No week-long or zero-defect claim is supported.

Evidence and planned checks: `docs/qa/ios/2.0.0/build9/responsiveness-regressions.md`; the separate Undo repair ledger is `docs/qa/ios/2.0.0/build9/undo-repair.md`.

## October 9 — build8 usability repair (INSTALLED — PHYSICAL FAILURE REPORTED)

**Current source: native 2.0.0/build8/schema5. Installed iPad:build8/schema5, October9. The user reports a confirmed native Undo crash after opening. Mac remains v11.1.0/schema21.** Christian's current feedback still reports annotation-confirmation freezes, poor drawing quality, inaccessible tempo/goals, crowded controls and microphone crashes. Build7's earlier test and preservation results do not close those reports.

Build8 exposes exact tempo entry, tap tempo, a visible Tempo goal and L/Both/R controls; keeps practice available during drawing and passage selection; adds a movable, collapsible drawing palette, two-finger Undo, direct rename/dictation and repositionable notes; uses native PencilKit zoom/layer rendering; and makes movement practice and warmup exits explicit. All six annotation tools have visible 44-point targets, compact tempo displays include BPM with distinct Start/Goal spoken labels, and tempo/page numeric fields select the old value on focus; invalid page drafts keep Save disabled. Movement entries share the original score and retain a validated title/source-page-range snapshot in practice history without duplicating PDFs, ink, passages or repetitions. Existing schema5 and native sync contracts remain in use.

Idle annotation saves prepare stroke records and JSON away from the UI actor, then recheck the current library revision and original ink before atomic publication. A stale task cannot clear newer drawing. Explicit page/mode/layer/exit checkpoints remain synchronous and refuse transitions on failed saves; atomic writes, imports, backups and complex PDF work still need physical latency testing. Speech callbacks explicitly return to the UI actor, and microphone permission/route/ownership guards keep failure recoverable.

**Crash diagnosis:** Six physical build7 watchdog reports (three each from October 7 and October 9) and a 90-second CPU report identify the same SwiftUI responder/AttributeGraph cycle: synchronous `PDFView.go(to:)` in `PagedScoreView.updateUIView` removes a focused overlay while SwiftUI is already updating. Matching-dSYM symbolication establishes this path; it does not attribute every reported freeze or the separate microphone complaint. Build8 defers and coalesces PDF reconfiguration until that update unwinds, explicitly observes the state its deferred coordinator reads, and retains failed-checkpoint guards. Detailed evidence is in `docs/qa/ios/2.0.0/build8/crash-analysis.md`.

**Verification and delivery:** 406 core tests, 2,211 deterministic service assertions and 57 Python helper tests pass. The final native run executes 245 tests with 1 live-account skip and 0 failures in 16.881 seconds; the mounted-scene fixture proves window identity before its strict crop/zoom checks. UI15 passes the complete actual sticky create/hold-drag/double-tap-edit/relaunch/triple-tap/permission-denied recovery flow in 59.539 seconds on the same final production source. Phone3 passes accessibility portrait/landscape in 71.631 seconds, with four independently accepted screenshots. Earlier scoped passes cover exact 72→88 BPM goals, hands, grading/Undo, movement editing/navigation, warmup Finish, score continuity, markup and two-finger Undo/Redo. Source review and scoped layout review pass; source is frozen. The 45-item QA report preserves UI13–15 native frame failures, earlier UI failures, stale-runner evidence and the test-fixture correction instead of replacing them with a blanket pass. Build8 is installed; the user reports a physical failure, and no week-long teacher trial has occurred. Exact run scopes, failures and remaining gates belong to `docs/qa/ios/2.0.0/build8/usability-review.md`. The device is connected. The deployment helper can activate an on-demand connection with a read-only details request to the exact named device; three new regressions bring its suite to 57 tests. This does not establish app acceptance or permit switching devices. Final source/native review and actual Release signing checks pass. Guarded installation and helper-confirmed full-file preservation pass; independent inventory/count audit passes for the pre-crash snapshots. No week-long teacher trial or zero-defect claim is supported.

**Installed build8 — physical Undo crash remains open:** native2.0.0/build8/schema5 from `a23cdec4f4f9acf42e8e5c724b6a386430dddca5` is installed. Independent review verifies all13 owned files/12,788,247 bytes unchanged by filename, size and SHA-256 before launch. Automatic launch was declined; the user opened the app. The23:59:40 UTC readback retains schema5/revision2086 (from2079),6 pieces/51 passages/50 sets/31 sessions/304 attempts/255 ink records (199 active)/2 stamps/2 notes. Original records remain exact except one piece page bookmark; profile/privacy/account/score data are exact. This readback precedes the23:59:53 UTC crash and is not post-crash retention proof. The user reported failure at19:59:56 EDT. Matching build8 dSYM identifies main-thread `EXC_BAD_ACCESS` at0x10 in `PKTiledView.performUndo` tile update, reached through the two-finger Undo action; this is distinct from the build7 PDF watchdog. Exact user sequence remains pending and the crash is unclosed. Signed Release checks pass, with profile valid through October16 at23:56:11 UTC (7:56 PM EDT). Sanitized evidence: `docs/qa/ios/2.0.0/build8/personal-ipad-install.json`. Mac v11.1.0/schema21 is unchanged.

**Next steps:** obtain the exact user sequence and reproduce the confirmed native two-finger Undo crash before accepting its repair. Keep the23:59:40 UTC readback separate from post-crash retention. Keep physical Pencil, microphone, large-score and sustained-use acceptance open; do not treat installation as task completion.

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

The latest October3 update confirms the physical iPad runs2.0.0/build6/schema5 and opens.
Complete11-file preservation passes; provisioning expiresOctober10 at1:55PM EDT.
A fresh full private backup precedes every further update.
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
