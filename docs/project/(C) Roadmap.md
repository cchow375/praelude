# Praelude — Roadmap

## October 12 — Build16 camera repair prepared for personal-device check

**Last updated:2026-10-12. Source: native2.0.0/build16/schema5. Personal iPad remains installed/opened at Build15; friend remains held at Build12. Macv11.1.0/schema21 unchanged.** Christian reports crashes/freezes specifically when toggling **Show camera preview**, a visible face rejected as unclear, no gesture actions, and requests command-first customization. B169/B170 remain open for physical acceptance.

Source repairs serialize background capture operations and main-actor preview changes through one asynchronous logical FIFO across workers, retain camera ownership until shutdown completes, and deliver capture notifications asynchronously without waiting for main. Explicit Vision rectangle revision3 supplies head pose before landmarks; missing individual metrics no longer disable every gesture. Capture uses720p when supported, with actual frame aspect for overlay mapping, finite geometry guards, per-frame recovery feedback, automatic neutral calibration and conservative recovery of missing metrics without moving existing neutral. Orientation epochs fence startup/rotation frames. Meaningful context changes reset motion; unrelated voice updates do not. Rep dispatch rechecks running set, focus and first-attempt state and reports a blocked context honestly.

Customization now fixes five commands (Next page, Previous page, Clean, Sloppy, Again), then selects an exclusive expression or Unassigned. Expressions include nod in either direction, head shake, grin, open mouth and deliberate both-eyes closure. Sensitivity, expression hold and cooldown are adjustable. Legacy local mappings decode; moving an expression unassigns its previous command explicitly. Camera settings remain device-local; no practice/schema/sync contract changes.

Core476 cases/1 skip/0 failures and32 targeted gestures pass. Final native316/1 skip/0 failures41.214s includes the logical-FIFO preview-ack regression. Command-first mapping/recognition-settings Save/relaunch passes335.073s. Independent live iPad navigation/reassignment/reopen plus six synthetic camera/preview cycles and mapping off/on pass; all synthetic library bytes stay exact with zero practice activity. iPhone portrait controls/one assignment/Done pass after an unexplained long presentation delay; manual lower-form scrolling is untested. Final4 retains one untraced preview-off state failure240.661s on its fifth camera cycle; its cause remains unproven and no production tap fallback was added. First-attempt neighbor65.536s retains intermediate scope. Current signed Release/package audit passes; exact-device delivery/readback and real camera acceptance remain pending. The final DEBUG camera fixture simulates capture/startup/measurements and preview controls; real preview graph/video requires physical acceptance. Device crash inventory contains nine older October7–10 reports, with no current Build15/October12 camera crash stack. Unsupported empty-graph attempts and their failures remain in QA.

**Next steps:** guarded personal-iPad delivery under the ongoing repair request, with fresh idle backup, actual helper artifact audit, complete-file preservation and launch/readback. Confirm actual live preview on/off, calibration and expression commands at piano distance separately. Keep the friend held. Full evidence: `docs/qa/ios/2.0.0/build16/README.md`.

## October 12 — Build15 installed on the personal iPad

**Last updated: 2026-10-12. Personal iPad: native2.0.0/build15/schema5 installed, user-opened and observed running; post-launch library exact. Friend iPad: last verified build12/schema5, still held. Mac v11.1.0/schema21 unchanged.** Christian explicitly requested last night's verified Build15 on the plugged-in personal iPad, lifting the earlier no-install hold for this target only.

Guarded same-bundle refresh from source `68d667f` / `ios-v2.0.0-build15-device-validation` passes exact target readiness, signing/profile inclusion, installation and complete-file preservation. All241 source hashes match the verified checkpoint. Private backups `20261012T162528Z-6f0225cd` and `20261012T162604Z-92f7b475` retain all13 files/19,420,130bytes exactly by filename/size/SHA-256. Ledger remains schema5/revision3423, with6 pieces/77 passages/73 historical sets/46 sessions/534 ink records/20 stamps/5 notes and a completed active-slot set. No running set was interrupted and no uninstall/reset/restore/termination occurred.

The helper rebuilt Release for this device; actual executable SHA-256 is `e176ae5ad22e32766d665127791b9984f12d02e54134ce26de228af1560f88ea`, distinct from the earlier generic package. Independent full-file/record, strict signature, signer trust, entitlement/profile, exact target,65-marker absence, resources and matching arm64 dSYM checks pass; profile expires2026-10-17T16:14:24Z. iOS declined automatic launch after successful install/preservation; the first read-only process check finds no running Praelude. Christian then confirms opening; the next read-only process query observes Praelude running. Complete post-launch backup `20261012T163008Z-91208583` retains all13 files/19,420,130bytes exactly, including unchanged schema5/revision3423, every original record, score, annotation, profile/privacy and preference. No migration occurs. No Mac import or physical Pencil/speech/camera/click/sustained-practice acceptance is claimed. Evidence: `docs/qa/ios/2.0.0/build15/personal-ipad-install.json`.

**Next steps:** use Build15 on the personal iPad; physical Pencil/speech/camera/click/sustained acceptance remains separate from this verified install/open/readback. Keep the other iPad held. Earlier preparation/hold and failed verification records below are historical; their evidence and physical-acceptance limits remain intact.

## October 11 — build15 follow-up; explicit no-install hold

**Current source: native2.0.0/build15/schema5; Build15 prepared for controlled device validation; installation HELD. Both iPads remain last verified installed at build12/schema5; Macv11.1.0/schema21 is unchanged. Last updated:2026-10-12.** All authorized affected UI, independent live and package gates pass, with zero current scoped simulator failures. Physical acceptance is separate. Neither iPad was queried, installed or operated; the explicit user no-install hold remains binding. Final18’s failed record is retained below.

**October12 affected-flow checkpoint:** final19 (app `8e533681…`, plugin `ff6e9a1b…`) finishes3 UI cases:1 pass/2 fail. The44pt Edit-padding/name/112.5-goal/Save/process-relaunch flow passes94.063s. Zoom fails70.791s with its resize cause proved: height927→901pt, minimum1.076655→1.046458 and scale2.433236→2.364990, while relative zoom stays2.259996; all other postconditions pass. Source preserves absolute manual zoom for height-only changes, excluding explicit refit, width/rotation and automatic short-landscape fitting. The passive20-launch tap diagnostic fails290.722s on launch14 after13 passes: the correct-center touch is received and allowed at began, but no `shouldBegin` or action follows; the coordinator remains healthy. Final20 passes4/4: actual zoom64.577s preserves absolute2.433236 before/after despite927→901pt, mounted height0.123s, existing landscape0.022s, and forwarding-lifecycle20 success395.020s. Final21’s original UIKit plus existing window trace completes20 actual executions, all passing (summary:1 unique aggregated case); all touches complete and none cancel. Final22 (app `f18c220c…`) captures launch3 began→cancelled in173ms before UIWindow forwarding, with an active key window and no ended touch. Matching simulator unified logs independently confirm the cause of three specific no-ops—final18’s fifth launch (PID4733), final19’s launch14 (PID8044), and final22’s launch3 (PID11364): testmanagerd’s Recap virtual digitizer disappears while contact remains touching/locked, then BackBoard soft-cancels one contact. These are harness input-transport failures; a production fallback on cancelled touches is not warranted. Earlier no-ops and physical behavior remain unproven. Final23 completes PASS (exit0;2 cases/0 failures/0 skips):20 passive-window delivery fresh launches424.045s and10 untraced native-UIKit fresh launches200.221s, using one120ms same-center contact without retries. The20 receipt rows contain20 began/20 ended/0 cancelled and one retained direct-ended touch each; the10 normal launches have protected-state receipts. App `f18c220c…`, plugin `bd8fbee…` and all241 compiled/installed source hashes match. No production gesture fallback was added. Independent live final24 now PASSES: normal Today→Sidebar/Pieces/card navigation, one-center Evenness arm, first-click lower44pt Edit padding, typed name/112.5 goal Save, Focus enter/exit retaining page/selection, and Close/new-PID relaunch→Passages Edit exact-name/goal reopen; Cancel and picker Close work first-click. The full union comparison changes only intended passage title/performanceTempo112.5/updatedAt plus revision7→8; every other record, PDF and artifact is exact with zero activity. Its independent one-real-pinch/pan/arm case passes70.062s (all16 predicates true), preserving absolute scale2.4332361227405377 exactly across927→901pt. Manual rotation changed only control casing and is not a manual Landscape pass; final18 actual rotation179.912s and current native height/landscape passes retain separate scope. Report: `independent-live-final24.json`. All authorized affected UI, independent live and generic Release/package gates now pass. Build15 is prepared for controlled device validation; installation remains HELD and both iPads untouched.

**Release/package gate PASS:** generic Release exits0 with all241 current source hashes matching. Executable SHA-256 is `b3c21602064f27282cf40e0d04f79a2445d6dae2424f179cb6fe4a9c2742f4f8`. Root29 signature checks and independent40/40 checks pass:65 DEBUG/test markers absent, two fonts exact, matching arm64 dSYM,13 bundle files and3 dSYM files. Profile expiry is2026-10-17T16:14:24Z. The ignored archive `releases/ios-build15-verified-20261012` includes zipped app/dSYM with extracted full-inventory readback exact and `installHold=true`. Evidence: `release-signature-final23.json`, `release-independent-final24.json`, `release-package-final23.json`.

**Checkpoint identity:** root will create `ios-v2.0.0-build15-device-validation` after commit as the fixing checkpoint for B165’s44pt Edit target and absolute-height zoom repair. The original `ios-v2.0.0-build15-candidate` tag remains the immutable failed-final18 checkpoint; no failed evidence is replaced.

**Explicit user install hold:** do not install on either iPad until Christian lifts this hold. Candidate readiness and the standing immediate-install preference do not override it.

**Final18 bounded historical verification (frozen app `0cfc8689…`; latest results are final19/20/21 above):**316 tests total:313 passed,2 failed,1 live-account skip. Native308 has307 passes/1 skip/0 failures (15.960s); eight actual UI cases finish6 pass/2 fail. This is a failed verification run, not readiness or physical acceptance.

| Result | Actual verification scope | Time |
| --- | --- | --- |
| Pass | Ink/Undo/new branch/save/process relaunch/reopen | 86.400s |
| Pass | Eight selected-box double-tap/Cancel cycles, triple-tap and ordinary edit | 167.412s |
| Pass | Rotation, Sidebar, focus and saved ink | 179.912s |
| Pass | New Text Dictate/Cancel and score-voice return | 80.870s |
| Pass | Ordinary Voice Check/Back | 112.620s |
| Pass | Saved-note Dictate/Cancel, restored owner, unchanged note text and fresh Clean | 106.990s |
| Fail | Normal ten-launch single-tap stress: first four pass, fifth remains Whole piece | 105.004s |
| Fail | Zoom combined predicate: correct passage is armed; final absolute-scale assertion fails | 69.327s |

**Final18 failure evidence (historical snapshot; retained unchanged):** on launch5 the actual Evenness target remains absent and Whole piece unchanged, so the all-saved-region routing repair (`74e757…`) is insufficient and B155 remains open. The zoom snapshot satisfies the armed-state and preceding checks, but lacks the full failed value. Pre-arm scale is2.433236/minimum1.076655 with viewport927pt; failed AX viewport is901pt. These partial readings do not prove a fit-ratio explanation, tap no-op or production zoom defect; complete zoom acceptance is not established.

**Final18 bounded stop (historical; superseded by the resumed final19/20/21 work above):** physical microphone recognition, camera gestures, Pencil, audible click and sustained practice; fresh manual verification of the latest source; and current build15 signed Release/package validation. The armed-passage pencil’s9.5×9.5pt accessibility target (B165) remains unrepaired and its padding behavior untested. The uncompiled44pt target repair, padding test, passive20 and full-capture additions were withdrawn and reverted to exact final18 source; all241 source hashes match. None was built or accepted. No final19 build/run, further manual/package run or installation will be represented as completed.

**Current physical/historical limits:** physical microphone recognition, camera gestures, Pencil, audible click, sustained practice and real-device OS behavior remain unaccepted. No manual Landscape-rotation pass is claimed; final18’s actual rotation179.912s and current native height/landscape checks retain separate scope. Final23’s30 fresh launches and final24’s live Edit/save/relaunch and real-pinch/pan/arm checks pass. The three matched historical failures are explained as harness transport cancellation; unmatched earlier no-op causes remain unproven. Package validation does not establish exact-device inclusion or physical feature acceptance.

**Earlier passes retain their scope:** passage dictation Cancel with prior unmuted/muted/Off state, Picker no-resume-until-Close, typed Save/reopen/fresh Clean, supported Undo, End/Cancel, first-attempt click and prior Sidebar repeats remain their recorded simulator checks. They do not erase the current B155 failure or establish physical recognition. Current result: `docs/qa/ios/2.0.0/build15/README.md`; full retained history: `docs/qa/ios/2.0.0/build15/functional-flows.md`.

**Next steps:** maintain the explicit user no-install hold on both iPads. No further diagnostics or tests are needed unless a concrete new failure appears or Christian authorizes controlled device acceptance. Preserve the verified package, original failed checkpoint, scoped evidence and physical-acceptance limits; no device operation is authorized by this preparation.

## Earlier October 11 — build15 intermediate verification checkpoints (historical)

**Historical checkpoint record:** the following text preserves the earlier Build15 status/evidence exactly. Its then-pending plans are superseded by the finished final18 result above; they are not commitments to further runs or source changes.


**Current source: native2.0.0/build15/schema5; diagnostic and functional follow-up in progress. Both iPads remain last verified installed at build12/schema5; Macv11.1.0/schema21 is unchanged. Last updated:2026-10-11.** Christian asks to fix taps that do nothing and finish testing actual flows, continuing until ready. B155’s cause remains under investigation; no tap-fix or readiness claim is made.

**Explicit user install hold:** do not install on either iPad until Christian lifts this hold. Candidate readiness and the standing immediate-install preference do not override it.

**Build15 source changes under verification (B160–B168):** Hands-free recovery controls move above the command examples. Metronome audio notifications now use the existing handoff asynchronously to remove a synchronous main-queue deadlock risk. Muting retires stale partial/final recognition and staged audio while retaining capture. Nested Hands-free customization/checks suspend score voice actions through a root-visible gate and a dispatch guard. Voice/Space first-attempt Metronome uses the armed start BPM instead of retained tempo. Broader final-source verification remains pending.

**Additional scoped finding (B165; latest verification pending):** the intermediate untraced ScoreFocus Today passage-names test fails16.971s at line123 because its old `Rename ` selector no longer matches `Edit name and goal for`. Its hierarchy confirms the organizer opened and reports the Edit button at13.5×13.5pt despite a44pt image. Source changes give organizer and analogous review Edit labels an explicit44pt content shape and plain button style. The completed pre-B166 batch below passes the corrected organizer/review44pt padding checks; final-source verification remains pending. No baseline padding tap was attempted, so no padding-tap failure or cause of older B155 no-ops is established.

**B163 ownership and modal safeguards under verification:** final9 passes the full nested gate/Voice Check/Done case and prior-mute restoration/reject-Clean/explicit-Unmute case, but ordinary Back leaves Voice Off in a real owner-release race (107.976s failure). The source repair retains pending return until the owner releases, observes owner-ID changes, and cancels restoration on explicit Voice Off, exit or background; prior mute is preserved and ownership is not stolen. Final10 passes actual ordinary Back (105.815s), prior mute/explicit Unmute (170.141s) and End/Cancel confirmation protection (89.430s). It uses injected recognition finals with tracing off, so this is scoped simulator acceptance. Existing score/camera modal/context dispatch gates are unchanged from final9; broader ownership and physical verification remain separate.

**B166 — first verdict can leave supported voice Undo stale (source fix; native/actual Undo UI pass, delivery checks pending):** start an ungraded set and enable voice before the first Clean. The actual verdict records an attempt, but supported Undo does not refresh until an unrelated sheet, status or ID transition. Source now observes `hasUndoableAttempt` and refreshes context synchronously after recording or voice Undo. The final source now skips recognition renewal for a same-token Undo-only action-set delta, retaining capture and staged audio so the first Clean context refresh does not discard a successive, properly separated verdict. Other semantic context changes still renew recognition. Final1’s 308-case native suite passes with 1 live-account skip and 0 failures in 16.566s, including the two new regressions. The actual two-cycle touch Clean→voice Undo case passes60.509s with Undo-availability and raw-ledger assertions. Context-final2 later passes first-attempt tempo/stop with three cases failing before their intended actions; repaired settings/confirmation checks, release and physical acceptance remain separate.

**Intermediate UI evidence, not latest-source validation:** the untraced `/tmp/praelude-build15-final` combined case fails34.025s at the goal-enabled coordinate tap with the keyboard open. Direct rename/112.5 goal/save/reopen passes96.799s, camera passes146.305s and first-attempt controls pass67.385s on that same intermediate compiled source. The failed tap has no event trace; its cause and the earlier B155 no-op cause remain unproven. These scoped passes do not establish readiness.

**Later intermediate UI evidence:** all seven untraced TapDelivery cases pass, covering eight review open/Done cycles, camera Done/reopen, sidebar, card padding, grid and Passages. Eight selected-box double-tap/Cancel cycles followed by triple-tap and ordinary dock editing pass in 215.496s. These runs precede the latest source safeguards and do not establish B155’s cause or candidate readiness.

**Stopped intermediate run:** the untraced run was stopped at the XCTest keyboard-animation wait (status143). Twenty UI cases completed:18 passed and2 failed;0 native tests ran. Its xcresult is incomplete, so it is not an overall pass. The app appeared responsive during the wait; this observation does not establish an app freeze or measured responsiveness. The unnecessary placeholder deletions prompted test changes.

**Completed pre-B166 batch1:** `/tmp/praelude-build15-flows-latest.xcresult` runs nine UI cases with normal flags on pre-B166 binary `78ffecee`:4 pass and5 fail. Passes are full combined rename/goal/dictation/ordinary-edit/attention→initial-recovery (147.951s), first-attempt controls (61.369s), urgent flow plus44pt review Edit padding (28.898s), and Today44pt organizer Edit padding plus rename without Practice (23.848s). Core451 (1 skip) and native306 (1 skip,0 failures;17.927s) also pass before the Undo extras. These results do not validate final B166 source.

**Earlier four voice-context cases stop before their first action:** failures at13.320–21.382s occur at the combined PDF hittability/full-containment guard; their exact cause is unproven despite rounded frames looking contained. The stronger fixture records17-digit frames and individual guard booleans, waits for a stable full page with0.5pt boundary tolerance, and makes one fixed-center tap while retaining the actual armed-state postcondition. Final1 passes the Undo case using this fixture; the subsequent context-final2 result is recorded below. The earlier guard failures do not test the intended voice-context protections.

**B155 historical alias focus failure retained; stronger flow passes:** the placeholder change avoids the old keyboard wait, but the earlier alias case fails55.151s because tapping the first field leaves focus in the third and typing reports no focus. Final1’s full alias customization passes132.807s with a helper that records the settled exact target and waits for focus without retrying. No production alias-focus patch was made, and the historical failure cause remains unproved. Independent CUA alias reproduction was not reached after a tool-generated8ms drag; no production scrolling failure is established.

**Scoped manual pre-B166 evidence:** one-click Sidebar/Pieces/card opening, Performance exit and badge→visible Recovery pass. The two seeded files and full library JSON remain exact. That manual flow does not establish alias focus or explain B155.

**Final1 verification checkpoint (310 tests total):** native308 (1 live-account skip,0 failures;16.566s), actual two-touch-Clean→voice-Undo cycles (60.509s) and full alias customization with the stronger fixture (132.807s). A fresh verifier confirms only in the final1 snapshot that `page.minY = 85.999999999999943` is below `score.minY = 86`, so strict containment is false while tolerant containment is true. This does not assign the causes of the four earlier guard failures retroactively.

**Context-final2 completes with 1 UI pass/3 pre-action failures (exit65):** the voice first-attempt click uses armed 60 BPM rather than retained 90 BPM and stops without grading (42.320s). End-practice fails74.391s because the helper uses AX menu content 1180pt tall inside an actual 520pt popover; its requested row at826–864 is clipped. Nested customization (44.707s) and mute/check (52.491s) fail before Customize/Check because the CollectionView container reports `isHittable = false` despite visible Enable/Mute children. Visible-viewport and child-scoping test corrections are underway; no production fault or acceptance of the settings/confirmation paths is established by these failures.

**Normal-final3 completes 17 actual UI cases:16 pass/1 fail (exit65; same final1 binary `96c291`).** The independent ink-location case passes branch bounds, Undo/Redo, Done/Save and Close. After a real process relaunch with a new PID, the actual Show Sidebar center tap at (32,54) at 62.87s leaves Today unchanged; the case fails73.594s. B155 is a current open no-op-tap defect, not merely historical. This case does not pass ink reopen. Summary: `docs/qa/ios/2.0.0/build15/normal-final3-summary.json`.

**Separate final3 passes:** the Gesture case passes actual draw→Undo→new branch, real pinch, save and reopen in70.881s. All seven TapDelivery cases pass, including eight review cycles and standalone Sidebar/camera/card-padding/grid/Passages. Selected passage eight double-tap/Cancel cycles pass168.357s; all four ScoreFocus cases pass. Combined flow passes147.444s, first click58.725s and urgent flow26.738s. These scoped passes do not close the post-relaunch Sidebar failure.

**Additional B165 scope: traced final4 Today session-card Edit passes 53.575s.** The observed 13.5pt target now has 44pt inside its button label. Actual lower-padding hit, name plus112.5 goal Save, relaunch and reopen pass in `/tmp/praelude-build15-today-final4.xcresult`. Retained actual-process traces prove this run used trace flags despite no NSLog output; it is not a normal-flags pass. An independent raw comparison finds only the target passage’s name, `updatedAt` and new `performanceTempo = 112.5` changed among passages; performance tempo was absent at baseline. The other passage is unchanged, and sets/attempts/sessions/coldGrades remain zero. Reward/revision startup differences are separate; a union-key audit remains underway.

**Earlier compiled-app scope:** final4 SHA prefix `2e6cbc…` differs from final3’s `96c291…` because of the Today44pt label repair and DEBUG-only diagnostics. Earlier passes retain their recorded binary and trace scope.

**Final7 checkpoint:** native308 passes with 1 live-account skip/0 failures in16.595s. Normal Today repeats the44pt lower-padding/name/112.5 goal/save/relaunch/reopen/no-practice flow and passes51.188s. The low-perturbation traced independent ink/new-branch/save/real-process-relaunch/reopen case passes86.907s. At that checkpoint the32-cycle/4-launch and original normal repeat remained pending; final9 results are recorded below and do not establish the historical causes.

**Final6 diagnostic limit:** the initial Sidebar `TouchCancelled` observation included 591ms of cold reflection before forwarding the touch. That diagnostic perturbation prevents using the observation as a production causal explanation. No B155 root cause is established.

**Final8 voice-context progress, not acceptance:** actual navigation reaches Voice Check and Clean count1. Tests then fail because the fixture expects value1 while accessibility exposes a merged Clean/count label. All three assertions are corrected to the exact merged label with full protected-state equality; no production counter failure is established. Final9’s corrected nested/mute results and separate ordinary-Back race are recorded below.

**B167 — End practice was buried beyond the visible menu (source repair; actual End/Cancel passes, delivery pending):** source moves the existing End action into the first Current practice section only while practice is active. Final9 fails57.856s in the fixture: the fully visible 224pt End row is rejected by a 214pt inset viewport, then an unnecessary drag dismisses the menu. Sanitized geometry evidence is `docs/qa/ios/2.0.0/build15/end-final9-geometry.json` plus its PNG. Final10 actual End/Cancel and confirmation protection pass89.430s with injected finals and tracing off; physical speech recognition remains separate.

**Final9 checkpoint (app `2b116…`, runner `aa2…`):** native308 passes with1 live-account skip/0 failures in16.779s. Six actual UI cases finish with 4 pass/2 fail. Passes are normal independent ink/save/relaunch/reopen (82.450s), native Sidebar32 Show/Hide cycles/64 single taps across4 launches (435.694s), full nested gate/Voice Check/Done (268.090s), and prior mute restored/reject Clean/explicit Unmute (175.255s). Failures are the End fixture geometry above (57.856s) and actual ordinary Back leaving Voice Off (107.976s). This does not prove the earlier intermittent B155 causes.

**B155 app-owned path has scoped stress acceptance:** regular iPad uses app-owned 44pt Show/Hide controls that write the split-view binding directly; compact layouts retain native controls. Initial display and Close select detail-only without a score checkpoint or identity reset. Normal final12 passes 64 fixed-center single taps/32 cycles across 4 real process launches (450.429s) and the original normal independent ink/Undo/new-branch/save/Close/process-relaunch/reopen case (77.545s). Final18 actual rotation/Sidebar/focus/saved ink passes179.912s; historical native-control causes remain unproved, and compact-layout/physical acceptance remains pending. This is acceptance of the narrow owned path, not overall readiness; final13 later reproduces separate saved-box arming no-ops.

**Final10 passes 311 tests total including 1 live-account skip:** native308 has 0 failures in16.283s; three actual UI cases pass—End/Cancel89.430s, ordinary Back105.815s and prior mute/explicit Unmute170.141s. Matching app `41a1c1a…` and runner `fe5f77…` run without tracing and with injected recognition finals. The binary includes the app-owned Sidebar source; its later stress/ink result and pending rotation are recorded below. No signed build15 Release, commit or installation has occurred; independent live and physical verification remain pending.

**B168 — Cancel after passage dictation does not restore prior score voice (source repair; passage/picker/new-note pass, saved-note scope pending):** matched baseline app `41a…`/runner `cce279…` fails `testPassageDictationCancelRestoresPriorScoreVoiceAndPracticeContext` in 63.117s. With score voice enabled, actual HUD-name double tap opens ordinary Rename; actual Dictate takes editor capture ownership, then actual Cancel returns to the visible score without restoring prior ownership/listening. Evidence: `/tmp/praelude-build15-dictation-final11.log` and QA `newdictation-final11` summary/provenance. Final13 later accepts reached passage/picker flows and final18 reaches New Text; saved-note and physical coverage remain pending.

**B168 source frozen; passage/picker/new-note checks pass, saved-note scope pending:** ScoreWorkspace source hash prefix `11ec…` captures specific prior opt-in/mute state before presenting direct passage dictation, existing/new note dictation or PassagePicker. Restoration requires the editor closed, a free owner, unobstructed presentation and the same score; explicit Off, exit, background or End cancels it. Final13 passes direct unmuted/prior-muted/originally-Off Cancel, Picker Cancel without resuming until Close, and armed Dictate/Finish/typed Save/reopen/fresh Clean. Final18 reaches New Text Dictate/Cancel and passes80.870s, plus ordinary Voice Check/Back112.620s. Existing saved-note ID/text/fresh-Clean coverage is still pending; earlier passes retain their scope.

**Final13 full run (app `b7199ec…`, runner `0925fb…`, ScoreWorkspace `11ec…`):** 318 tests total:314 passed,3 failed,1 live-account skip. Native308 has0 failures/1 skip;10 actual UI cases finish7 pass/3 fail. Passes are independent ink/new branch/save/relaunch (87.659s), armed Dictate/Finish/typed Save/actual reopen/Start/fresh Clean (101.809s), direct unmuted Cancel (60.316s), prior-muted Cancel (106.142s), originally-Off Cancel (57.257s), Picker Cancel/no resume until Close (73.715s), and armed60-versus-retained90 click plus allowed bare Next (50.962s). Summary: `docs/qa/ios/2.0.0/build15/functional-final13-summary.json`.

**B155 saved-box failure history retained; hardening partly verified:** final13 New Text (21.905s) and ordinary Back (22.263s) fail at the actual initial single fixed-center saved-box arm; Whole piece remains unchanged before voice. These failures do not reach dictation or Voice Check/Back. Their cause is untraced; later unchanged-code passes do not close them. New routing hardening reaches New Text and ordinary Back in final18; ten-launch stress remains pending. Owned Sidebar stress remains a separate narrow pass.

**Rotation fixture history; final18 actual case passes:** final13 fails84.762s before rotation because its saved reading baseline wrongly expects PDFKit markup=false, although markup remains true for the overlay. The corrected reading predicate uses actual Annotate/Exit Focus controls and no Done. Final14 then reaches actual landscape Sidebar, focus and portrait, but fails136.508s on a fixture expectation for a hidden page indicator. The corrected fixture uses DEBUG actual PDF currentPage1 in all modes and the visible indicator while reading. Final18 subsequently passes actual rotation/Sidebar/focus/saved ink179.912s; these older failures do not establish a production rotation defect.

**Final14–17 repeat scope:** final14 diagnostic passes all stages in 17.222s. Four final15 full-trace runs pass17.003/17.668/19.355/18.206s; four final16 passive runs pass24.020/19.790/17.218/18.775s without swizzling, gesture-target additions or file logging, with the same recorded baseline hash. Final17 passes ten normal, untraced fresh-process single-center arm attempts in 215.627s on unchanged code. Neither the traces nor these repeats explain or close final13’s two normal no-op failures.

**B155 routing hardening frozen; final18 partly verified:** ScorePageOverlay source prefix `74e757…` routes reading-mode finger touches on any visible saved region through the existing app overlay, extending the previous selected-only route. Existing Pencil/nil-touch, note, read-only, hidden/crop and quick-edit/break guards remain; recognizer priorities are unchanged and actions are not duplicated. Fresh source review accepts the narrow change and the native guard matrix is updated. The exact historical cause remains unproved; final18 reached flows pass below, while all-saved-route ten-launch stress remains pending.

**Interim final18 (frozen app `0cfc8689…`):** original ink/relaunch passes86.400s; eight selected-box double-tap/Cancel cycles plus triple-tap/ordinary edit pass167.412s; actual rotation/Sidebar/focus/saved ink passes179.912s; New Text Dictate/Cancel passes80.870s; ordinary Voice Check/Back passes112.620s. Saved-note, ten-launch arm stress and native308 remain pending. These are scoped passes, not an overall suite or readiness pass.

**Final18 zoom combined-predicate failure (69.327s) remains unclassified:** the snapshot shows the correct Evenness passage armed with cold-grade controls, and queries reach the last absolute-scale condition. Exact scale readouts are still needed; a fit-relative zoom/resize fixture issue is one possibility. This failure does not establish a tap no-op or production zoom defect.

**Additional B165 scope; final19 padding test pending:** the armed-passage pencil exposes a 9.5×9.5pt accessibility target. A narrow repair puts 44pt and a Rectangle content shape inside its label (source prefix `d20340ac…`); a new actual padding test (prefix `4ea007…`) awaits final19. No actual padding acceptance is claimed yet.

**Candidate remains NOT READY:** remaining actual saved-note/ten-launch/native checks, zoom readouts, final19 padding, fresh live/manual verification and generic signed Release/package gates are pending. No build15 commit or installation is claimed; both iPads remain installed12 under the explicit hold.

**Final12 normal checkpoint (frozen app `41a…`, runner `cce279…`):** three actual UI cases finish 2 pass/1 pre-rotation fixture failure. Owned Sidebar stress passes450.429s and original independent ink/relaunch/reopen passes77.545s. Rotation fails86.064s before any rotation at the saved-PDF baseline because the TextView title is an accessibility value, not a label. The corrected fixture retains every original score/page/ink/source-bounds/mode/no-practice check and attaches complete predicate diagnostics; actual rotation remains pending.

**Delivery remains in progress:** no build15 Release, commit or installation has occurred. Independent live verification, generic signed Release and physical acceptance remain pending. Simulator checks do not establish physical speech recognition accuracy.

**Next steps:** finish final18 saved-note/ten-launch/native gates, obtain exact zoom readouts and execute final19 actual pencil padding, then finish preservation, fresh live/manual verification and generic signed Release/package checks. Retain the interim passes and zoom failure alongside final13’s7-pass/3-fail result and all earlier evidence; historical causes remain unproved. B155 hardening is partly verified, with ten-launch stress pending; B168 saved-note and physical coverage remain pending. Keep both iPads on the explicit user no-install hold until Christian lifts it; the candidate is NOT READY.

## Earlier October 11 — functional audit; build14 held checkpoint

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

**Personal iPad: native 2.0.0/build12/schema5, source `459081c` (tag `ios-v2.0.0-build12-candidate`), installed and user-opened. Friend’s subsequent build12 delivery is recorded above. Mac v11.1.0/schema21 is unchanged. Last updated: 2026-10-11.** All 19 requested areas have implementations: score focus with rep-input suspension; saved top/bottom controls and white-margin turns; direct L/Both/R verdict capture; score/Today passage naming; sequential drawing history and normalized huge-page brush widths; expandable accidental-first stamps; arbitrary/transparent note backgrounds; supported voice aliases, confirmation and diagnostics; independent full-tempo references, provenance-aware practice balance and measure-map guidance/correction.

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


**Last updated: 2026-10-10. Praelude v11.1.0 / schema 21 — SHIPPED + INSTALLED.** Installed at `/Applications/Praelude.app` at 16:58 EDT on 2026-09-08; implementation `c411e7b`. Fresh native launch, real Score and Variants dialog pass. All 46 database tables and DB bytes are unchanged from the fresh backup.

**Native boundary:** v11.1.0 launches and renders the real Beethoven Op.90 movement 2 score, selected passage and Variants dialog. The earlier Desktop/Score permission blocker is cleared. Progressive rep/set/chain effects passed independent live browser review; native audible quality, voice/chime overlap and Christian’s motivation verdict remain open. Cover-picker selection/save (B109), microphone/Steinway, real mapping and Windows acceptance remain separate.

## iOS2.0.0 — Mac library transfer and musician overview (candidate, October 2)

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

## Historical iOS1.1.0 — Score markup and mobile handoff (candidate installed; launch pending, 2026-09-14)

Native **1.1.0/build2/schema2** implements visual passage boxes, editable PencilKit ink, original
targets in Progress history, separate annotated-PDF export/share/Print and expanded metronome/rewards.
Plain native surfaces and adaptive controls keep the music central. The iPad now reports
1.1.0/build2, installed at 20:56 EDT from source `124707d`; this is not full forScore/desktop parity,
physical-feature acceptance or shipment.

[Mobile README](/Users/c3/praelude/ios/README.md), [task context](/Users/c3/praelude/ios/AGENTS.md),
[module/check guide](/Users/c3/praelude/ios/docs/DEVELOPMENT.md),
[installation/renewal](/Users/c3/praelude/ios/docs/INSTALL_ON_IPAD.md) and
[mobile roadmap](/Users/c3/praelude/ios/docs/ROADMAP.md) make the same Git repo usable as a focused
mobile workspace. The helper has 28 passing fake-device tests, including full file-hash comparison
before/after installation and no launch on a post-install discrepancy. It never deletes the app.

Current native evidence: 29 core tests, 2,166 service assertions, 28 fake-device helper tests and 36/36 native hosted tests
on each simulator pass. The final-toolbar iPad9 selected run passes 3/3: finger 59.497 s, meter 61.653 s,
Focus 23.719 s. iPad7 supplies box editing/relaunch and accessibility markup in both orientations;
five targeted iPad scenarios pass across runs. Phone3 passes 36 hosted plus 3 selected UI, and Phone2
supplies the other four UI passes: seven distinct phone scenarios pass across runs. Phone4 also passes its final-toolbar finger 91.652 s/meter 84.624 s recheck. Final exact-source signed Release verification passes. Earlier failed runs remain
failed; no all-green full-scheme or physical-feature claim is made.

Phone2's zero strokes led to explicit PDF/PencilKit gesture arbitration; Phone3 ink is visibly
present. iPad9 verifies the 44-point toolbar entry, finger persistence, meter controls and Focus
after corrected offscreen-test guards. Earlier PDF-copy probes failed with EPERM. The 20:50
guarded refresh again failed the complete copy, with only a generic failure reported. The 20:52
Xcode container download failed with CoreDevice7000/POSIX1 on a SplashBoard snapshot cache.
After the user reported ready, complete copying succeeded and the helper installed 1.1.0/build2.
All owned file names, byte counts and SHA-256 match in the complete private pre/post copies.
Automatic launch was denied with a generic security/unlock error; exact cause is unproven.
The preserved ledger remains schema1 until first-launch migration is separately verified.

### Next steps

Confirm controlled launch after user unlock/open and conditional Developer App trust, then verify
schema2 migration. This update's version and complete file preservation pass; launch remains separate.
Keep physical Pencil/audio/voice, printing, VoiceOver, keyboard/pedals, interruptions, in-app backup/restore
and sync/parity limits open under B115 until their own evidence is recorded.

## iOS1.0.0 — Historical native baseline (2026-09-14)

- Christian's request is a musician-first native redesign: plain Apple surfaces, large controls,
  page-first music, essential actions first, focused sheets and iPad score windows. SwiftUI for
  iOS/iPadOS17+ lives under `ios/`; the installed Mac remains v11.1.0/schema21.
- Native scope includes pieces/PDF import, PDFKit reading, saved passages, Clean streak/Total plays,
  20–300 BPM tempo/ladder, variants/routines, pause/resume/undo, actual history/calendar, optional
  goals, metadata/Resting, settings and backup/restore. Native PCM audio and explicit on-device
  English speech implement timekeeping/commands. Durable state precedes rewards.
- An independent schema1 JSON store owns sandbox-relative score copies; the Mac SQLite database
  and personal library are outside this target. Damaged/newer native data stays read-only; a
  deliberate valid backup restore copies and byte-verifies the original before replacement.
  Unreadable fallback export is refused. Swift 6 compilation, unsigned Release arm64 device build,
  22 core tests, 2,041 service assertions and 13 native app-hosted tests pass on each iPhone/iPad
  simulator. All eight iPad UI scenarios and seven of eight phone scenarios pass across regression
  runs, including corrected large-text checks. iPad backup UI passes; complete phone backup UI
  remains open after the final initial-Settings-navigation failure. The exact-source unsigned
  Release build passes; fixture flags/test plug-ins are absent. The current source/binary
  manifest and evidence are in `ios/README.md` and `docs/qa/ios/README.md`.
- Historical cable installation is **verified; its initial launch request encountered trust**. Free Personal Team
  Release 1.0.0/build1 installed at 17:51 EDT; the device listing confirms version/build and
  Developer Mode is enabled. The prior device-unavailable attempt remains history. First launch
  was denied by a security/trust message; Developer App trust must precede launch acceptance.
  The profile expires 2026-09-21 at 21:24:58 UTC; fixtures/test plug-ins are absent. Local-config
  signing passes and the signed app remains at ignored `releases/ios-personal/Praelude.app`.
  The sanitized manifest records installation separately from launch; unsigned evidence is unchanged.
- Status is **DEVELOPMENT CANDIDATE**, not device accepted or shipped. Mac migration/sync, cloud
  mapping, Listen Back, Studio furnishings/economy, desktop warmups and full history repair remain
  unported. Assistant stays OFF/ON HOLD.

### Next steps

Retain these baseline results as history; current source acceptance belongs to the 1.1 section above.
Obtain a controlled device launch/feature verdict, handling developer trust if the device requests
it, and use the current Phone3 result for the now-closed simulator backup gap. Mac-data migration and remaining ports
are explicit follow-up work; this baseline is not full desktop parity.

## Maintenance — fresh-Mac development portability (completed 2026-09-13)

- The private code repository now includes a curated `docs/project/` mirror of every living
  project document and Markdown version record. A clone no longer depends on Christian's local
  Obsidian path for its operating manual or current product truth.
- Root README/AGENTS/CLAUDE entry points now route to repository-relative current documentation.
  A new-Mac guide covers Git access, toolchain evidence, lockfile setup, test/build/dev commands,
  permissions and the boundary between development source and personal app state.
- `npm run doctor`, `npm run setup:mac`, `npm run docs:sync` and `npm run docs:check` make the
  setup and mirror repeatable. Privacy ignore rules cover databases, environment files and signing
  material. The mirror excludes databases, scores, media, release artifacts and credentials.
- Current docs no longer ask for the already-cleared v11.0 Desktop permission gate. Release facts
  remain historical; v11.1 product/native boundaries are unchanged.

### Next steps

Test a clean clone on the second Mac. Treat transfer of Christian's live database and score tree as
a separate, encrypted migration: stored library/PDF paths are absolute and the relocation path has
not been accepted. Do not copy the live database into normal tests or Git.

## v11.1 — Progressive practice resonance (shipped 2026-09-08)

The Rep Counter now builds a luminous core, orbital arcs, a filling ring and progressively richer sparks as the current clean target fills. Sloppy/Again send falling fragments and deepen amber to coral on successive setbacks, capped at three. Set completion gets a larger radial bloom; a fully completed variant chain gets the largest gold finale. Original offline pluck/glass/air sounds rise and gain harmonics with progress, vary their ornaments, descend on setbacks and resolve into richer set/chain chords. Existing practice rules are unchanged: Total plays retains earned volume, and Again preserves variant-stage progress. No added XP penalty or automatic musical judgment.

Final frontend **2,614 passed / 1 skipped** (214 files passed / 1 skipped, four workers); native **1,106 passed / 18 ignored plus integrations**; TypeScript, production/native builds, strict Clippy and Rustfmt pass. Independent 1280×720 and 720×520 live review verifies clean/setback/undo, fifth-clean set completion and a Dotted 2 → Reverse dotted 3 chain. Audio-device failure, cleanup, gesture unlock and reduced-motion behavior have automated/source coverage. The sandboxed macOS speech probe and one concurrently loaded Listen Back assertion failed before authorized/native and four-worker full reruns passed; the QA ledger retains those limits.

### Next steps

Use the next real practice session to judge the escalating visual/audio rewards, native voice/chime overlap and motivation. Finish cover-picker selection → rendered cover → restart when controllable. Microphone/Steinway, real-provider mapping, accounts/social and Windows-native acceptance remain separate. Assistant stays OFF and ON HOLD.

## v11 — Studio and practical glass interface

**Requested:** Christian's September 7 overnight brief and handwritten ranked-room design. Implementation spec: repo `docs/superpowers/specs/2026-09-08-v11-studio-design.md`. Implementation `a338581`; released/installed 2026-09-07 at 23:53 EDT. Final evidence: repo `docs/qa/v11.0.0/README.md`.

- Studio replaces Universe with a quiet scalable room, ten musical ranks × ten divisions, continued Encore ranks, 25 earned-coin furnishings/palettes and local display name. One item equips per slot; the catalog is finite.
- 1 XP per 600 focused seconds; per-session completed-set milestones yield cumulative 1/2/4/6 XP at 3/5/7/10 sets. Rank 1 costs 100 XP/division, +50 per subsequent rank; each division earns 25 coins. Existing practice counts and corrections reconcile rewards without farming.
- Native SQLite atomic revisions persist profile, purchases and equipped items without changing schema 21 or practice history. Full 46-table copy rehearsal preserved every value except the Studio settings key; reopen proof passed.
- Today makes Score and today's notes primary. Pieces offers covers, chosen local artwork, search/sort, grid/list, folders and rest/restore. Glass shell/controls preserve readable music, keyboard focus and compact windows; Dark/Light/System follows system accessibility preferences.
- Accounts, sync and friends remain unbuilt; no credentials or fake social presence. Assistant remains off.

### Next steps

1. Release tag/private push are complete. Full-home app-copy enumeration remains incomplete after stalled directory reads; Spotlight and known install/build locations are verified. Frontend **2,595 passed / 1 skipped** across **212 passed files / 1 skipped**; native **1,106 passed / 18 ignored plus integrations** with four test workers; TypeScript, production/native builds, format and strict all-target/all-features Clippy pass. Final independent dock/library review found no remaining source blockers; broad dock/Shell checks passed 222, with the two additional policy cases included in the passing full suite. Package/install and exact 46-table/byte data gates pass; backup/rollback are retained.
2. Installed Score/Variants passed after the renewed Desktop prompt in v11.1. Today/Studio/rank path/practice record/Pieces/Settings and canceled purchase/profile previews passed across two fresh native launches.
3. Obtain Christian's sustained practice/motivation verdict. Keep microphone/Steinway, real mapping and Windows acceptance separate.
4. Revisit account infrastructure and social design when credentials/service configuration exist. Expand furnishings based on real use, not an implied infinite catalog.

## Current independent lanes

- **iOS1.1.0/build2:** SwiftUI development candidate under `ios/`, independent schema2 storage; source `124707d`. Exact scope/evidence in `ios/README.md`; device/physical-feature/parity boundaries are B115.
- **Windows v9.1.0:** exact historical unsigned x64 NSIS candidate remains unchanged. Windows-native cargo tests and real Windows 10/11 install, PDF/audio, persistence and uninstall are pending; no voice/Listen Back/system TTS/volume boost. A later branded package is a separate release.
- **Custom-cover picker:** automated browser image selection hung; the native chooser opened but could not be inspected by computer use, then was canceled with no saved image. Preprocessing/native persistence/validation pass; picker/render/restart acceptance remains pending (B109).
- **Native audio and mapping:** real microphone/Steinway and one authorized real-provider mapping still need their own evidence. No browser fixture closes them.
- **Sharing:** blank local-PDF Library and share-clean packaging exist; a new recipient's first-run usability remains its own acceptance test.
- **Assistant:** OFF / ON HOLD; broad Practice Operator work does not resume without Christian's word.

### Next steps

After v11 real-use review, take the first available native acceptance lane. Configure accounts only when the external dependency is actually available.

## Historical roadmap below

The version/phase map and phase narratives below record their original release boundaries. Mentions of “installed,” “current,” “next,” old app names or old open-session blockers in those historical narratives are scoped to their dates. They do not override the current status above. The former long handoff preamble is preserved in `versions/(C) pre-v11 Roadmap handoff — Historical Snapshot.md`; complete chronology remains in [[(C) Changelog]].


## Version ↔ phase map

| Version      | Phases                                       | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                       | Status                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1.0**   | P0–P2                                        | Skeleton + metronome + voice loop                                                                                                                                                                                                                                                                                                                                                                                             | 🟢 shipped 2026-07-09 (tag `p2-done`)                                                                                                                                                                                                                                                                                                                                                  |
| **v0.2.0**   | P3                                           | Pieces + rep engine (the real product begins)                                                                                                                                                                                                                                                                                                                                                                                 | 🟢 shipped 2026-07-10 (tag `v0.2.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v0.3.0**   | P3.5                                         | Editable Foundation                                                                                                                                                                                                                                                                                                                                                                                                           | 🟢 shipped 2026-07-12 (tag `v0.3.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v0.3.1**   | P3.5 patch                                   | Release identity + single-app cleanup                                                                                                                                                                                                                                                                                                                                                                                         | 🟢 shipped 2026-07-12 (tag `v0.3.1`)                                                                                                                                                                                                                                                                                                                                                   |
| **v0.4.0**   | P4                                           | Real-PDF score viewer + light mapping                                                                                                                                                                                                                                                                                                                                                                                         | 🟢 shipped 2026-07-12 (tag `v0.4.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v0.5.0**   | P5                                           | Brain + knowledge graph                                                                                                                                                                                                                                                                                                                                                                                                       | 🟢 shipped 2026-07-12 (tag `v0.5.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v0.6.0**   | P5.5                                         | Goals/calendar + missed-day recovery                                                                                                                                                                                                                                                                                                                                                                                          | 🟢 shipped 2026-07-12 (tag `v0.6.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.0.0**   | P6                                           | Home + Practice Universe + references/polish                                                                                                                                                                                                                                                                                                                                                                                  | 🟢 shipped 2026-07-12 (tag `v1.0.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.0.1**   | P6 patch                                     | WebKit PDF reliability + bounded loading                                                                                                                                                                                                                                                                                                                                                                                      | 🟢 shipped 2026-07-13 (tag `v1.0.1`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.0.2**   | P6 patch                                     | Bundled scanned-PDF decoders + native pixel gate                                                                                                                                                                                                                                                                                                                                                                              | 🟢 shipped 2026-07-13 (tag `v1.0.2`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.1.0**   | P6 coherence                                 | Unified Tricky Sections, editable score marks, Calendar/constellation sync                                                                                                                                                                                                                                                                                                                                                    | 🟢 shipped 2026-07-13 (tag `v1.1.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.2.0**   | P6 workflow                                  | Row-local score actions, separate titles/notes, tutorial chapter mapping                                                                                                                                                                                                                                                                                                                                                      | 🟢 shipped 2026-07-13 (tag `v1.2.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v1.3.0**   | P6 intelligence/workspace                    | Compact scalable UI + contextual three-book/MusicXML Practice Brain                                                                                                                                                                                                                                                                                                                                                           | 🟢 shipped 2026-07-13 (tag `v1.3.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v2.0.0**   | P7 Practice OS                               | Score Atlas + rigorous protocols/ledger + voice/Brain actions + handcrafted UI + earned Universe                                                                                                                                                                                                                                                                                                                              | 🔵 backend done in source; superseded by v3.0.0 (never installed as v2.0.0)                                                                                                                                                                                                                                                                                                            |
| **v3.0.0**   | P7 backend + v3 frontend rework (P0–P8)      | Complete monochrome frontend rework: five-workspace shell, Score wizard, force-graph Universe, Brain fixed                                                                                                                                                                                                                                                                                                                    | 🟢 shipped 2026-07-16 (tag `v3.0.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v3.0.1–4** | Real-use repair sequence                     | Paged Score, nonblocking target dock, working Score Practice seam, UI/token/metronome visibility repair                                                                                                                                                                                                                                                                                                                       | 🟢 shipped 2026-07-16–17 (`v3.0.1`…`v3.0.4`)                                                                                                                                                                                                                                                                                                                                           |
| **v3.1.0**   | Hands-free stabilization                     | Ephemeral receipts, synchronized metronome, Today plan/guide, screen-grounded confirm-gated Brain set action                                                                                                                                                                                                                                                                                                                  | 🟢 shipped 2026-07-20 (tag `v3.1.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v3.2.0**   | Endurance + system coherence                 | Explicit metronome/session ownership, preserved plans/Score work, exact deep links/context, long-session proof                                                                                                                                                                                                                                                                                                                | 🟢 shipped 2026-07-20 (tag `v3.2.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v4.0.0**   | Practice Notebook OS (Phases A–D)            | Bug/perf fixes; UI overhaul + Assistant/History rename + Today-as-menu; the day-sheet Practice Notebook (schema v11); quotes/scholarly-reader, book library, IMSLP add-a-score, real mapping wizard                                                                                                                                                                                                                           | 🟢 shipped 2026-07-30 (tag `v4.0.0`)                                                                                                                                                                                                                                                                                                                                                   |
| **v4.0.1**   | v4 perf patch                                | Module-scope the first-page cache (a key-remount had been discarding the memory tier); gate the composer-candidate fetch behind the fold; correct an over-claimed benchmark figure in NOTES                                                                                                                                                                                                                                   | 🟢 shipped 2026-07-30 (tag `v4.0.1`, commit `b06ffb6`) — patch release, Changelog-only by the `versions/` rule; it had been undocumented everywhere until the 2026-08-20 audit                                                                                                                                                                                                         |
| **v5.0.0**   | Paper redesign + real perf fix               | Colour-depth-aware image decoding (real perf fix); paper design system; notebook Today; static Universe; freehand pencil drawing (schema v13); IMSLP UI fix; curated 134-quote set; Barber/Copland chamber split                                                                                                                                                                                                              | 🟢 shipped 2026-07-31 (tag `v5.0.0`, merge `3de140c`)                                                                                                                                                                                                                                                                                                                                  |
| **v6.0.0**   | Practice Core (S1–S10)                       | Cloud-vision measure mapping + review/Apply; sub-sections (dormant `target_meta.parent_region_id`); floating Practice Dock (rep counter / paused-sets tray / clock+timers); pause-across-days; day-scoped sessions; day-sheet date nav + carry-forward + time estimates; History day timeline; Calendar planned-vs-done; score goals banner; voice fast-path/chime/fuzzy + TTS recovery; Brain status/style fixes. Schema v14 | 🟢 **shipped + installed 2026-08-18** (tag `v6.0.0`, release `34c1a15`). Plans A+B+C+D all landed. Post-ship: in real use, but measure mapping has produced 0 rows on the live DB and no acceptance verdict is recorded                                                                                                                                                                |
| **v6.0.1**   | Real-Use Fixes (patch)                       | Score toolbar top-row overlap fix (B76); dock stacking-floor + defaults + Reset panel layout; B70 voice-misfire fix (suppress by routed intent); B72 BooksPanel nested-form fix; docs + backup                                                                                                                                                                                                                                | 🟢 **shipped + installed 2026-08-21** (tag `v6.0.1`, merge `d9fa0fe`, release `440200b`). Schema unchanged at 14. B70/B72/B76 RESOLVED; B77 (measure-map focus trap) found, pre-existing                                                                                                                                                                                               |
| **v7.0.0**   | Motivation Layer (Plans A+B+C)               | Living earned-only galaxy; streaks + end-of-day photo calendar (Liftoff-style); completion animations; full volume/dynamics checker (calibrated, loudness-only); Brain usefulness overhaul. Schema v14→v15                                                                                                                                                                                                                    | 🟢 **SHIPPED + INSTALLED 2026-08-24** (tag `v7.0.0`, DMG 10 MB). Galaxy, streaks, photo ritual, animations, full dynamics checker, B81 TTS fix, and an Assistant OFF switch. Schema 14→15, counts preserved 10/193/1814/40. Gates: vitest 2285/0, cargo 949/0, clippy+tsc clean. **Plan C (Assistant) ON HOLD, unmerged** — its numbers policy was refuted twice; C2/C3/C4 never built |
| **v7.0.1**   | P0 Stabilize & Reveal (Aug 8 overhaul train) | B56 end-session race narrowed at this boundary; B4/B77/B82/B83 fixed; C3 mic mute button + B1 sub-sections revealed; §4b visibility pass; D1 voice-latency instrument; `npm run qa:shots` harness. Schema unchanged at v15, no migration                                                                                                                                                                                          | 🟢 **SHIPPED + INSTALLED 2026-08-25** (tag `v7.0.1`, DMG 10 MB, SHA256 `95d534bb…`). Counts preserved 10/208/1915/43. Gates: vitest 2322/1 skipped/0 failed, cargo 959/0, clippy+tsc clean, all eight release-script gates PASS. **B56 was later fully closed in v7.1.0.** |
| **v7.1.0**   | P1 Practice Set Core                         | Tempo demotion engine (A1), variant-chain engine (A2), composer hierarchy (A3), schema-v16 set tuning model (A5), verdict hotkeys (A6), ± reps (A7), B56 fully closed. Important correction: global demotion controls and composer tuning controls were not exposed in the installed UI; per-stage composer copy still read as attempts. | 🟢 **SHIPPED + INSTALLED 2026-08-26** (tag `v7.1.0`, schema 15→16). Gates: frontend 2,383/1 skipped, native 994/0, tsc/clippy clean, five voice corpora zero false mutations. Christian's immediate use found B85–B87. |
| **v7.2.0**   | P2 Micro-Targets v2 + corrective release     | B85 direct atomic persistent spots + exact-region start/resume; B86 chain-governed mastery, stage attribution and cancellable auto-close/retry; B87 spoken acks opt-in/off by default; missing v7.1 global-demotion and per-set tuning/consecutive-clean surfaces; B3 unified overlay; E3 low-data Universe teaching. Schema remains 16. | 🟢 **SHIPPED + INSTALLED 2026-08-27** (tag `v7.2.0`, release `7a5061d`). DMG/signing/identity/launch/database preservation and all eight release gates passed. Frontend 2,499/1 skipped; native 1,049/19 ignored; build/tsc/clippy clean; five voice corpora zero false mutations. Native/at-piano interaction acceptance was still owed. B88/B89 were open at this historical boundary and closed in v8.1. |
| **v8.1.0**   | Combined P3–P6 + motivation correction       | Voice reliability/counted adjustment; movements + honest mapping activation; visual warmup routines; Listen Back; exact prompt-only rotation; archive/recent-first; Sound targets; evidence-based XP/levels/badges/cadence; live hotkey remaps; B88/B89 closures. Schema 16→19. | 🟢 **SHIPPED + INSTALLED 2026-08-27.** Final gates, live migration and installed-native Universe/Warmups 720×520 passed. Final runtime HEAD `1a1e38b`; pushed tag `v8.1.0` points to `0a3d6a5d339955fd7e7318299eaa6c3063674415`; first post-tag docs baseline `da71efb5509afa36beb073050719ac1094751b98`; pushed cold-start handoff at that boundary `d03a3d7b9820494b878336f7d18e5da94b821f68`. Native mic/Steinway and real mapping acceptance remain open. |
| **v8.2.0**   | Score/practice UI cleanse + Total plays      | Continuous virtualized Score; independent Tricky Sections scroll/auto-reveal; compact Score toolbar, one-line dock and 32px variants; accessible Clean streak/Total plays choice; fixed-tempo 5/10/15/25/Custom volume completion excluded from mastery. Schema 19→20. | 🟢 **SHIPPED + INSTALLED 2026-08-27** from `afe65f3b`; pushed lightweight tag `v8.2.0` → `5de8bf9e1e9bced09c3d5091acd4b42241edae28`; private `origin/main` contains later docs-only corrections, so read its current tip from Git. Browser 720×520/1462×919, all release/artifact gates and exact live migration pass. Native Score frame remains open behind ungranted Desktop permission. |
| **v8.2.1**   | Compact composer + safe day close            | Pair/compact composer controls; preserve one rail scroll owner; make plain End session camera-free; offer an inert photo card only after confirmed End my day; require explicit Use camera with file fallback; add/gate truthful camera/mic/speech plist descriptions. Schema stays 20. | 🟢 **SHIPPED + INSTALLED + PUBLISHED 2026-08-28.** Runtime `496033e`; pushed tag `v8.2.1` → `971a0d2dc7cf8f093527239e2394391dbbfec0a4`; frontend 2,684/1 skipped, native 1,109/19 ignored; all gates pass. |
| **v9.0.0**   | Portable Pieces Library + share-clean build  | Library-first Pieces workspace; direct local-PDF intake; nested logical folders; active/completed/archived; context actions; blank app-owned first install; preserved upgrade path/data; remove embedded copyrighted pedagogy and related UI; schema 20→21. | 🟠 **PACKAGED SHAREABLE CANDIDATE 2026-08-30; NOT INSTALLED; CLEAN-RECIPIENT ACCEPTANCE PENDING.** Source/build, clean-store, exact-copy migration, cleanliness, devMock and final package gates pass. Packaged implementation `709542023…`; release/docs commit `6a560eeae…` is the exact target of lightweight tag `v9.0.0` and private `origin/main`, with both pushes successful. Install/recipient remain pending. Installed remains v8.2.1/schema 20. |
| **v9.1.0**   | Windows x64 portability + NSIS distribution | Carry the same schema-21 blank/share-clean Pieces product onto Windows 10/11 x64; platform-correct score/file/browser paths; current-user NSIS; keyboard/mouse practice core; explicit no-voice/no-Listen-Back boundary. | 🟠 **PACKAGED SENDABLE CANDIDATE 2026-08-31; NOT INSTALLED OR NATIVE-ACCEPTED.** Exact 7,654,002-byte unsigned EXE and SHA-256 are recorded; recursive share-clean and PE32+ x64 checks pass. Cross-target check/strict Clippy and Mac/full frontend gates pass. Windows-native cargo tests and Win10/11 acceptance remain PENDING. Implementation `2d3300488…`; pushed tag `v9.1.0` and `origin/main` resolve to release/docs `f296f3c…`. |

| **v10.0.0** | Praelude identity and interface reset | Visible Praelude branding, neutral dark system and share-clean Library on schema 21. | Shipped + installed 2026-09-03; historical exact facts in Changelog/version record. |
| **v10.0.1–v10.0.5** | Practice/Score corrections | Earned feedback; centered page-first Score; in-flow bar; focused Passage tools; responsive direct Goal/metronome/tempo controls. | Shipped + installed successive patches; historical exact gates in Changelog. |
| **v10.1.0** | Saved variants and routines | Durable global custom shortcut library, visibility controls and named ordered routine snapshots; schema 21. | Historical installed baseline before v11; native Score permission was available and real Scherzo/regions were observed before the replacement. |
| **v11.0.0** | Studio and practical glass | Ranked furnished room, earned coins/local name, original vector scene, cover Library, Today launchpad and restrained glass/accessibility corrections; schema 21. | Shipped + installed 2026-09-07 23:53 EDT; implementation `a338581`. Full gates and exact data preservation pass. Native Score/Variants await renewed Desktop permission; current evidence is above and in the QA ledger. |

---

## 🟠 v9.1.0 — Windows x64 sendable installer — PACKAGED CANDIDATE / NATIVE ACCEPTANCE PENDING

**Why:** Christian wants to send the same blank practice app to a pianist using Windows 10 or 11,
not require that friend to own a Mac and not create a data-bearing personal fork.

- The exact per-user x64 NSIS Setup EXE is packaged through Tauri's documented macOS cross-build:
  `CodaKiller-9.1.0-Windows-x64-Setup.exe`, 7,654,002 bytes, SHA-256
  `e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4`.
- Implementation is `2d33004888a97c3ebcb4b7799bf54029efd15626`. Release/docs commit
  `f296f3cb38ae5d29c1ae813493f5c37ea07ed9a6` is the exact target of pushed lightweight tag
  `v9.1.0`; private `origin/main` and the tag currently resolve to `f296f3c`.
- The product remains blank and share-clean: no Christian data, PDFs, database, recordings,
  photos, quotes, methods or Knowledge payload.
- The supported first-port surface is Pieces/PDFs, folders/states/actions, Score,
  keyboard/mouse verdicts, metronome/chimes, History, Calendar and local persistence.
- The Mach-O `hear` binary is excluded. Mic, hands-free commands, macOS `say`, system-volume
  boost and Listen Back are unavailable on Windows and must not appear to be working.
- Windows path, filename, score-protocol, picker/browser and cache/durability edges are handled
  explicitly instead of relying on Unix/macOS behavior.
- The installer is unsigned because no Windows certificate exists; SmartScreen is an honest
  distribution limit until real signing is obtained. WebView2 downloads only if missing.
- Recursive share-clean inspection passes, and the embedded app is PE32+ x64. The package has no
  personal files/DB/scores/library/history, personal or unremapped host paths, or copyrighted
  pedagogy payload; intentional `/build-user` remapped build paths remain. Inert migration
  metadata/identifiers and the bundle id remain to support compatible upgrades, but Windows
  upgrade/data preservation has not been exercised.
- Frontend 205 files/1 skipped, 2,540 tests/1 skipped, TypeScript/build, Mac native 1,111/19
  ignored, Mac strict Clippy/format and Windows cross-target check/strict Clippy pass. Windows-
  native tests and real Windows acceptance remain pending.

### ⟶ Next steps

1. Verify the exact EXE on clean Windows 10 and 11 through Authenticode/SmartScreen, first launch,
   first PDF/Score, practice/audio,
   persistence and uninstall/reinstall.
2. Run Windows-native cargo tests and retain exact native picker, relaunch and persistence evidence.
3. Keep the record draft until those recipient gates pass; retain the Windows voice/audio gap as
   an explicit future phase.

## 🟠 v9.0.0 — portable Pieces Library + share-clean build — PACKAGED CANDIDATE / NOT INSTALLED

**Why:** Christian needs to hand the same normal app to another pianist. The current installed
Library is buried under History, adding a normal local PDF is needlessly organized around IMSLP,
and the distributable should not preload copyrighted book quotations or methods.

- One generic build, never a personal friend fork.
- Fresh installs are blank and app-owned; upgrades preserve Christian's stored/inferred Pieces
  root, database and score relationships.
- Pieces is primary, with **Library | History | Calendar**; History is nearby but subordinate.
- Arbitrarily nested logical folders and Unfiled never move physical score files.
- Active, Completed and Archived are reversible library projections; right-click/ellipsis exposes
  move, complete/return, archive/restore and remove.
- Add Piece takes title, optional composer/folder and a chosen or dropped PDF. It copies a
  validated PDF into the Pieces root and leaves the source file intact. IMSLP is optional and
  external, not the required import workflow.
- Remove moves an eligible app-owned piece folder to `.trash`; practice history stays queryable.
- Quotes/Reader/Books/passage-helper and the embedded book/method payload are absent from the
  distributable. The external source directory and historical DB text remain untouched.
- Candidate schema 21 is additive; an exact disposable schema-20 copy preserves 11 pieces, 255
  blocks, 2,315 reps, 51 sessions and 9,173 events with integrity OK/FK0.
- Distribution is Apple silicon/macOS 13+, ad-hoc signed and not notarized. Gatekeeper first-open
  friction is documented, not disguised as a notarized public release.
- Source/build/cleanliness, fresh-store-twice and 720×520 browser gates pass. The current live DB
  has one open session and block, so installed v8.2.1 and live data remain untouched.

### ⟶ Next steps

1. Close/preserve the live open session/block, repeat the audit, then take backup/rollback.
2. Install and verify exact before/after data, one-copy, fresh native launch and native file/UI flow.
3. Test a clean recipient install and freeze the version record only after acceptance; package
   commit/tag/private push are already complete.

## 🟢 v8.2.1 — compact composer + safe day-close correction — SHIPPED + INSTALLED

**Why:** the first installed v8.2.0 screenshot showed that generic field wrapping still wasted
vertical space and put Start after optional controls. Friction is also time.

- Measure and BPM controls stay in paired two-column rows.
- Focus/Metronome and target mode/count each share compact rows.
- Start is pinned in the form header; **+ Custom** reveals variant text entry only on demand.
- Tricky Sections remains the sole scroll owner; no nested form scrollbar or horizontal overflow.
- Installed v8.2.0 preserved closed session 48, then crashed in under one second. The photo card
  auto-requested camera while the packaged plist lacked `NSCameraUsageDescription`; macOS TCC
  delivered `SIGABRT`. Six retained reports from v7.0–v8.2 share the signature.
- Plain End session is camera-free. Only confirmed End my day offers the inert card; camera waits
  for explicit **Use camera** and sync/rejected requests fall back to file choice.
- The source plist declares camera use truthfully and release gates require camera/mic/speech
  descriptions. The crash-left orphan `hear` PID was cleaned.
- Full frontend 2,684/1 skipped, native 1,109/19 ignored, TypeScript, strict Clippy, production +
  native builds, five corpora and all eight release gates pass.
- Verified pre-install backup `(C) pre-v8.2.1-install-2026-08-28-132046.db`: 23,449,600 bytes,
  SHA-256 `2c99dec1c3bc14f595e69c92a9415076299752d46930eea0fa3c9f5a793379c7`; schema 20,
  integrity OK/FK0, 11 pieces, 246 blocks/contracts, 2,207 reps, 48 sessions, 8,391 events, zero
  open sessions/blocks.
- Installed identity/exact privacy strings/signature, DMG/checksum, rollback, exact before/after
  DB and fresh launch pass. Pushed tag `v8.2.1` points to
  `971a0d2dc7cf8f093527239e2394391dbbfec0a4`; native Score feel stays B91.
- Installed `/Applications/CodaKiller.app`: 8.2.1, bundle `com.christian.codakiller`, strict
  signature PASS, CDHash `f0460dcb3b62825ea29328a32489987364b19828`. DMG 10,907,287 bytes,
  SHA-256 `6ce58b77b32642c644df1c0b42d2c89ea745a75e28c7891a484190ad111c61dd`;
  v8.2 rollback 10,057,883 bytes, SHA-256
  `da29be1e96c120f2c27994fc2d83c26a5c8bc9a40c08b2f87097b0e82a117b71`.

### ⟶ Next steps

1. Repeat the composer walkthrough in the installed WKWebView, then continue the separate native
   Score, microphone/Steinway, authorized mapping and sustained-motivation gates.

## 🟢 v8.2.0 — Score/practice UI cleanse + Total plays — SHIPPED + INSTALLED

**Why:** Christian's screenshots showed basic practice-time friction that source checklists had
missed: a one-page Score with dead space, a non-obvious practice rail, enormous variant fields and
too much chrome. He also needed a volume target that did not pretend five sloppy repetitions were
mastery.

- Continuous document with stable page slots, maximum five mounted PDF pages and two-column
  overview; the visible page drives navigation.
- PDF and Tricky Sections scroll independently; expanded practice composer auto-reveals in the
  rail at the supported floor.
- Score tools and utility dock items are grouped without burying Paused Sets or Rep Counter;
  variants stay as one preset line plus compact 32px configured rows.
- Total plays has 5/10/15/25/Custom, fixed tempo, all-verdict counting and Undo. It can complete
  and auto-close but is filtered out of mastery copy, badges, day mastery counts and mastery FX.
- Schema-20 rehearsal preserves 242 blocks/contracts, 2,184 reps, 47 sessions and 8,283 events;
  integrity/FKs clean.
- Gates: frontend 2,678/1 skipped, native 1,109/19 ignored; build/type/format/clippy clean; five
  accepted browser frames and all eight release gates.
- Installed identity/signature, one-copy audit, DMG/checksum, backup/rollback and fresh schema-20
  graph all pass. Native Score visual is not claimed behind the ungranted Desktop prompt.
- Pushed lightweight tag `v8.2.0` points to
  `5de8bf9e1e9bced09c3d5091acd4b42241edae28`; private `origin/main` contains later
  documentation-only corrections, and its exact current tip must be read from Git.

### ⟶ Next steps

1. Run installed-native 720×520 Score/composer acceptance after Desktop access is deliberately handled.
2. Resume real microphone/Listen Back/Steinway acceptance.
3. Apply one explicitly authorized provider map, then judge motivation across sustained use.

## 🟢 v8.1.0 — P3–P6 completion + visible motivation — SHIPPED + INSTALLED

The release finishes the remaining train in one installed app:

- **P3:** verdict chime, persistent last-three heard feed, live-set-only `mark done`/`rep done`/
  `mark sloppy`/`mark again`, live settle timing, counted add/undo and live saved hotkey remaps.
- **P4 / schema 17:** movement CRUD and Score scope; provider/prerequisite-aware mapping entry.
  B5 remains externally unproven because no Anthropic key exists and the live table was last empty.
- **P5 / schema 18:** visual warmup catalog, named routines and exact rep-engine system-piece runner;
  its compact layout shrinks inside the effective 480px stage.
- **P6 / schema 19:** safe Listen Back with physical native STT suspension, temporary-by-default
  files and explicit Keep; exact prompt-only Rotation whose unsafe 720×520 position clamps to
  `y=164` above a 56px Tools reserve; archive/restore + recent-first; Sound target.
- **Motivation:** old galaxy removed; 1 XP/completed focused minute, deterministic levels, six
  badge tracks, exact next rails, 28-day cadence, progress/repertoire rails and technique evidence.
- **Corrections:** B88 per-set demotion + running subdivision; B89 durable spot identity/replay.
- **Accepted exclusions at the v8.1 boundary:** Assistant stays OFF/gated; its Settings guide was
  practice-only and Books stayed hidden while off; archive+recent-first replaced folders. The
  no-folders/Books payload decisions are explicitly reversed or retired by the v9 candidate.

**Rehearsal:** a disposable live-DB backup migrated 16→19 with integrity OK, historical graph
preserved, one hidden Warm-ups system row added and new feature tables empty. The installed
migration later reproduced that exact preservation.

**Release proof:** full gates passed; the live schema 16→19 graph preserved blocks/reps/sessions/
events and the one open session, adding only hidden Warm-ups. Installed-native Universe and
Warmups passed at 720×520; Warmups had no overlay/clipping, exposed **Restore Rep Counter** and
preserved the active set. Final HEAD is `1a1e38bb7a3757cf90ee6ea814e93d5971c595d6`;
frontend 2,650/1 skipped/0 failed and native 1,100/19 ignored/0 failed passed with every release
gate. Exact installed identity/artifact facts live in the version record.

### ⟶ Next steps

1. Obtain real WKWebView microphone/Listen Back and Steinway acceptance.
2. Run one real mapping only after Christian explicitly approves sending the whole current
   edition to the selected cloud provider.
3. Judge sustained motivation in use; do not infer it from screenshots or automated tests.

## 🟢 v7.2.0 — Corrective release + Micro-Targets v2 (P2) — SHIPPED + INSTALLED 2026-08-27

One corrective release atop v7.1.0; schema remains 16. Christian's v7.1 use defined the release:

- **B85:** select an anchored parent → **Isolate a spot** → drag one fully contained box. The
  child, parent link, colour, inferred measures and exact edition anchor commit atomically; no
  typing or second mapping pass. Spots persist, hide per parent, undo for about eight seconds,
  and **Practice this** refreshes blocks, resumes only the latest paused set with that exact
  `region_id`, or starts a three-clean set directly. Same-measure siblings cannot cross-resume;
  the already-running message is generic. The chip hides while another canvas pointer mode or
  save owns interaction.
  Conservative contained-box inference recovers exactly-one-parent legacy geometry without
  rewriting live rows.
- **B86:** the chain governs mastery across focus/target shapes; stage progress and durable
  attribution use the same clean-streak stage; ordinary/chained mastery holds for a six-second
  cancellable countdown and closes, with one bounded transient retry. Recovery cancels before
  IPC and the timer rechecks live eligibility. The stage chime is limited to genuine forward
  intermediate new-Clean transitions, including a one-clean opener—never undo/final/extra Clean.
- **B87:** spoken deterministic acknowledgements are opt-in, default off; the chime remains.
- **v7.1 surface correction:** global demotion controls in Settings; beat-unit label, beats per
  bar and subdivision in the set composer's Advanced section; explicit **Consecutive cleans**
  for new variants with legacy `reps` compatibility.
- **B3:** one memoized score overlay path for Regions/spots, mapping/create state and atlas draft.
- **E3:** honest low-data Universe teaching at zero–two evidenced systems; disappears at three
  and grants nothing.

**Ship proof:** DMG `releases/v7.2.0/CodaKiller-7.2.0.dmg` (10,739,055 bytes), SHA-256
`532868f089241e64d134b2fb3b645f2ddf7db8df838d8706d3a39d7d5b7dc77f`; installed plist 7.2.0,
strict signature, checksum and fresh launch verified. Live DB before/after: schema 16, integrity
OK, 10 pieces / 228 blocks / 2,026 reps / 44 sessions / 0 open, unchanged. Frontend 2,499 / 1
skipped; native 1,049 / 19 ignored; build/tsc/strict Clippy clean; five voice corpora zero false
mutations; all eight release gates PASS. Tag `v7.2.0` points to release commit `7a5061d`. The
720×520 workflow pass was browser/mock interaction evidence, not native or at-piano interaction
acceptance.

**Historical residuals at the v7.2 boundary:** **B88** names the missing per-set demotion override and running-HUD quick
subdivision control. **B89** records that transactional spot creation lacks replay idempotency: a
lost post-commit IPC response plus retry could duplicate a spot despite the ordinary same-tick UI
guard. No occurrence has been observed; B85 remains resolved. Both are closed in the later
installed v8.1 release, not retroactively in v7.2.

### ⟶ Next steps

1. Run the exact B85/B86/B87 flows natively at 720×520 and obtain Christian's at-piano verdict.
2. Keep B67/B75/B78 and native acceptance open. B88/B89 are closed in installed v8.1; Assistant
   remains deliberately off.

## 🟢 v7.1.0 — Practice Set Core (P1) — SHIPPED + INSTALLED 2026-08-26

The Aug 8 overhaul train's second phase, per Christian's 2026-08-25 approval. Schema 15→16.

- **A1 tempo demotion engine** ("the punishment"), using global defaults in normal UI use.
- **A2 clean-streak variant-chain engine.**
- **A3 composer hierarchy** — variants/focus/clean target unburied.
- **A5 schema-v16 per-set tuning model.**
- **A6 verdict hotkeys** and **A7 ± reps**.
- **B56 fully closed** across every production rep/retention mutation path.

**Installed-scope correction:** v7.1 did not expose the global A1 demotion settings or A5 beat
unit/beats-per-bar/subdivision composer controls, and its per-variant numeric copy still presented
an attempts target rather than an explicit consecutive-clean requirement. Installed v7.2 supplies
those missing surfaces. A per-set demotion override and running-HUD quick subdivision remain absent.

**Gates at ship:** frontend 2,383 passed / 1 skipped; native 994 passed / 0 failed; tsc and strict
Clippy clean; five voice corpora zero false mutations; migration 15→16 rehearsed and installed
counts preserved. Christian's immediate use then found B85, B86 and B87; green ship gates had not
proven those workflows usable.

Christian's recorded answers feeding this phase (2026-08-25): tempo demotion counts sloppy only;
hotkeys Space / Right-Shift / Return confirmed; gamification stays deferred until he's lived with
v7 longer.

### ⟶ Next steps

1. Keep this v7.1 record honest: the corrected controls and workflows first shipped in v7.2.
2. Historical acceptance item, now consolidated: surviving set/spot/hardware proof belongs to the
   current installed v8.2 acceptance train, not a separate v7.2 task.
3. Historical next step, now complete: P3–P6 shipped together in installed v8.1.0. Do not reopen
   this v7.1 phase as current work.

## 🟢 v7.0.1 — Stabilize & Reveal (P0) — SHIPPED + INSTALLED 2026-08-25

The first phase of the approved Aug 8 overhaul train. Plan:
`~/praelude/docs/superpowers/plans/2026-08-25-p0-v7.0.1-stabilize-and-reveal.md`. **Schema
unchanged at 15 — no migration was run, and no migration rehearsal was performed** (none was
needed).

**Fixed:** B4 (section-editor measure fields overflowing "Save section" at small window sizes);
B77 (measure-map dialog focus trap — Tab escaped it and could land Enter on a rep verdict button
behind the scrim; now trapped, Escape closes, focus returns to opener); B82 NEW, most serious
(the Clean/Sloppy/Again buttons were not rendered at all at 720×520, the app's own configured
minimum — auto-collapse removed entirely, only the deliberate "Collapse set" toggle remains);
B83 NEW (two banned `window.confirm` call sites trapped the user in a dirty measure-map review
and silently no-op'd piece switching under wry/WKWebView — both now use the app's inline
two-step confirm). **B56 / E5 end-session race — NARROWED, NOT CLOSED:** the "is a set live?"
check now runs under the session lifecycle lock, closing the concurrent-open/checkpoint window
and blocking adoption of an ended session; a smaller opener-side window remains, scheduled for
v7.1.0. At this boundary B56 was not fixed; **v7.1 later resolved it completely.**

**Revealed:** C3 mic mute button (backend existed since v6, no button anywhere — now an
always-visible labelled control in the left rail); B1 sub-sections (built and tested but never
used on the live DB — the select-then-drag rule was undocumented and a drag starting inside a
selected box was swallowed; both fixed, plus a taught empty state and an opt-out default on
"+ Add"); the §4b visibility pass (dock pill row labelled "Tools"; day-streak zero-state teaches
the focused-minute threshold; disabled Map-measures buttons explain why).

**Added:** D1 voice-latency instrument (the "app" figure on the heard pill — explicitly excludes
how long the Mac itself took to hear you, since the "hear" pipe carries no timestamps);
`npm run qa:shots`, a 720×520 screenshot harness that found B82 within minutes.

**Gates at ship:** vitest 2322 passed / 1 skipped / 0 failed; cargo 959 passed / 0 failed
(filtered out: 0 on every target); `cargo clippy --all-targets --all-features -- -D warnings`
clean; `tsc --noEmit` clean; all five narrated corpus suites (griffes, scherzo1/2/3, voice
firewall) zero false mutations; all eight release-script gates PASS.

**Installed 2026-08-25:** tag `v7.0.1`, DMG `releases/v7.0.1/CodaKiller-7.0.1.dmg` (10 MB),
SHA256 `95d534bb3d8c3ab1df5b7178bc170334d1097ae509b2d653e0ebb41652192f30`. Installed app verified
`7.0.1`, `codesign --verify --deep --strict` OK, DMG checksum verifies. Live DB verified
read-only after install: integrity ok, `user_version` 15, **10 pieces / 208 rep_blocks / 1,915
reps / 43 sessions** — identical before and after. Pre-install backup `(C)
pre-v7.0.1-install-2026-08-25-162832.db`, SHA256
`ee91bba3dd81b90667ad1841bd8899376f49eb3eaa04e48d3b8111dba51c8b71`. v7.0.0 rollback tarballed to
`~/Library/CodaKiller-rollbacks/CodaKiller-v7.0.0-rollback.app.tar.gz`.

**Still open at the v7.0.1 boundary:** B56 was narrowed and scheduled for v7.1.0 (now resolved);
B67 — still no Anthropic
key in Keychain, Claude vision path still never run (Christian confirmed 2026-08-25); B75 —
`measure_map` still holds 0 rows on the live DB (B83's fix removed two failure modes that may or
may not have been the cause — nothing proves it); B78 — dock residuals, a concrete 720×520
repro recorded this round (Dynamics panel overlaps Rep Counter); the at-piano voice-latency
baseline (the instrument exists, the number needs Christian practising); the v7.0.0 acceptance
verdict is still owed, and now v7.0.1's too; no streak zero-state screenshot exists (the mock
seeds a non-zero streak — behaviour is pinned by unit tests only).

**Christian's spec-review answers (recorded 2026-08-25; historical, partly reversed 2026-08-30):** Assistant stays OFF and gated — zero
assistant work; gamification deferred until he's lived with v7; warmup visuals = keyboard
figures + text, no VexFlow; tempo demotion counts sloppy only; pieces get archive + recent-first
sort, no folders (**reversed by the v9 Pieces Library request**); unkept recordings deleted at session end; hotkeys Space / Right-Shift / Return
confirmed; no Anthropic key — build the rest of P4 and leave B75 honestly open, remind him once
at P4.

### ⟶ Next steps

1. **P1 "Practice Set Core" (v7.1.0) is next** — see the section above. Not yet started.
2. Keep reminding Christian about the missing Anthropic key once, at P4 (Score Map), per his own
   instruction — not before.
3. At-piano acceptance verdicts for both v7.0.0 and v7.0.1 are still owed; do not let a third
   release ship without one.

## 🟢 v7.0.0 — Motivation Layer — SHIPPED + INSTALLED 2026-08-24

Agreed-deferred out of v6.0.0 so Practice Core could ship. A same-day spec round on 2026-08-20
turned the July 31 intent into an approved design (three plans, schema v14→v15) written to
`~/praelude/docs/superpowers/specs/2026-08-20-codakiller-v6.0.1-fixes-v7-motivation-layer.md`
(commit `1994895`) — **still awaiting Christian's review of the written spec file.** No
implementation plan and no code exist yet. What follows below is the agreed _intent_ from
Christian's July 31 dump, left intact; see the spec file for the approved shape:

- **Plan A "Galaxy & Ritual"** — the living galaxy, day streaks, end-of-day photo calendar,
  completion animations.
- **Plan B "Dynamics Checker"** — opens with a throwaway feasibility spike (can `cpal` input and
  hear-CLI STT share one mic on the M2 Air?), then the calibrated loudness-only RMS meter.
- **Plan C "Assistant Usefulness"** — all four pillars: confirm-gated read tools, book-grounded
  coaching with citations, suggest-never-dictate planning, real-metadata piece knowledge.

- **A living, earned-only galaxy** — the Universe grows from real practice and cannot be filled
  any other way.
- **Streaks + an end-of-day photo calendar** (Liftoff-style) — the day closes with a visible mark.
- **Completion animations** — a set or a mastery landing should feel like something.
- **A full volume/dynamics checker** — calibrated, **loudness-only**. This does not weaken the
  durable non-goals at the bottom of this doc: it measures loudness; it does not transcribe,
  grade, or detect pitch. If that boundary ever blurs during design, the feature is wrong.
- **Assistant usefulness overhaul** — v6 made it truthful; this round is about making it worth
  asking.

### ⟶ Next steps

1. ~~A spec round of its own, the same shape that worked for v6: Christian's feedback → themes →
   approved design spec → per-plan implementation → verified slices.~~ **Done 2026-08-20** —
   spec written and committed (`1994895`); Christian's review of the file itself is the
   remaining gate before per-plan implementation plans get written.
2. **Do not start it until the v6.0.0 items above are closed** — in particular the acceptance
   verdict and the off-disk backup. Shipping a motivation layer on top of an unaccepted release
   with no backup would be building on sand. **Status 2026-08-20:** the acceptance-verdict half
   is satisfied — v6.0.0 was accepted with issues (see the Post-ship reality section below). The
   backup half is approved (private GitHub repo) but still pending Christian running
   `gh auth login`; B54 stays open until the push succeeds. **Status 2026-08-21:** the v6.0.1
   patch half of this gate is now satisfied — v6.0.1 shipped + installed 2026-08-21 (see the
   v6.0.1 section above). **Status 2026-08-23:** the off-disk backup half is now satisfied too —
   B54/C1 RESOLVED, private remote at https://github.com/cchow375/praelude (see [[(C) Flaws]]
   Resolved). **Both gates are now clear.** **Status 2026-08-23:** Christian cleared the spec-review gate ("push to v7"); all four implementation plans are written and committed (`a597ca7`); Foundations (B0 spike PASS + schema v15, rehearsed) is merged (`45070c9`); Plan A (Galaxy & Ritual) is in build. B0 verdict: coexistence PASS — Plan B proceeds as scoped, no push-to-measure fallback needed. **Status 2026-08-24:** A1 (living galaxy) and A2 (day streak) are MERGED (`a1e74e5`), and the whole of Plan B (B1–B4 dynamics checker) is MERGED (`d126c3f`); integrated main is green (vitest 2235/0, cargo 904/0, clippy + tsc clean) and pushed to the remote. Adversarial verification refuted the galaxy TWICE before it was allowed through — an earned-only violation (a never-practised piece rendered a glowing star tagged with a zero-valued evidence field) and an unguarded dense-floor claim (orbits left the canvas at 4+ mastered regions) — plus five surviving mutants killed, including one that would have displayed a long-dead streak as current. **Still owed:** A3 photo calendar, A4 completion animations, Plan C in full, 720×520 live QA, B75's real measure-mapping run, and the ship.

## 🟢 v6.0.1 — Real-Use Fixes — SHIPPED + INSTALLED 2026-08-21 (patch)

Driven by Christian's 2026-08-20 acceptance-with-issues verdict on v6.0.0 (four areas: score
top-row overlap, voice misfires, Assistant not worth asking, dock/panel ergonomics). This patch
closes the first, second, and fourth; the Assistant overhaul is v7 Plan C. Deliberately
schema-free — schema stayed at 14, no migration.

**Five fixes, all shipped:** B70 (fast-path tail guard now suppresses by routed intent,
consume-on-use, clear-on-dispatch — commits `c1d16a8`, `1a0a3c1`); B76 (score toolbar top-row
overlap — flex-wrap + `flex: 0 1 auto`, reflow breakpoint moved to its own 1200px query — commits
`b05b0db`, `c3cc6e4`, `71f7902`); dock mount-time re-clamp using each panel's real configured
width, non-open panels skipped (commits `51abd62`, `2514aa6`); the dock stacking floor —
`DOCK_Z_BASE` 10 / `DOCK_Z_CEILING` 39, rank-based mapping, plus new Settings → Appearance →
"Reset panel layout" (commits `59af6c5`, `3033eb8`, `c5f878d`, `92694bd`); B72 (BooksPanel nested
form → `role="group"` — commits `274aa0c`, `3f28ed0`). Full root-cause detail in
[[(C) Flaws]]'s Resolved section for B70/B72/B76.

**Gates at ship (`92694bd`):** vitest 2125/0 (1 skipped, 169 files), cargo 898/0 (19 ignored),
clippy + tsc + build clean, all six narrated-corpus/firewall/complaint suites zero false
mutations, `FAST_PATH_PHRASES` untouched, CSS custom properties 139 before/after (none removed).
Mutation-tested the new stacking guard: 8 mutations, 7 killed, 1 survivor exposed the guard only
scanned `ScoreView.css` — widened to every stylesheet under `src/`.

**Installed 2026-08-21:** tag `v6.0.1`, merge `d9fa0fe` on main, release `440200b`. Installed to
`/Applications`, re-signed adhoc, launched clean. Live DB verified after install: integrity ok,
`user_version` 14, **9 pieces / 179 rep_blocks / 1,710 reps / 37 sessions** (was 173/1,660/36 at
the 08-20 audit). Pre-install backup `(C) pre-v6.0.1-install-2026-08-21-121450.db`, SHA-256
`024610394c4f4deec7f11251f6824d055bcda795df05b1e1602451ec28291b94`, 18MB. Rollback archived to
`~/Library/CodaKiller-rollbacks/CodaKiller-v6.0.0-rollback.app.tar.gz`, per the one-copy rule.

**New flaw found, pre-existing:** B77 — the measure-map dialog has no focus trap (Tab reaches
dock-panel controls behind its scrim, including Clean/Sloppy/Again). Verified pre-existing
(`MeasureMapPanel.tsx` byte-identical to `fa086b7`); v6.0.1 neither causes nor worsens it, but it
was rated the most serious item in the final review's triage. See [[(C) Flaws]] B77.

**Honest residuals (not fixed in this patch):** a panel previously left over the score toolbar
comes to the front on first launch after upgrade (the fix working — muscle-memory click risk,
rep has Undo); the rep/clock panels still overlap ~15px at the 720×520 dense floor (proven
unavoidable within ~6px); the rep panel still overlaps some score-page controls (all
navigational/read-only, panel is now the visible coverer, zero fall-throughs in a 3,300-point
sweep); `dockPanelZIndex` degrades past 30 panels (dock ships 3); `FloatingPanel.tsx:163` still
renders a raw focus rank but is unused/inert, logged as a re-arming trap; below 900px the zoom
control group no longer centres on its own row (no overlap, but no design sign-off); modal scrims
now correctly cover dock panels (intended, worth a glance at-piano). Full list: [[(C) Flaws]]
B78/B79.

**Process note:** branch ran subagent-driven with a fresh-context adversarial review per task.
Reviews REFUTED work three separate times and caught five real defects, two of which the
orchestrator had already accepted by ruling. Full engineering account in
`~/praelude/NOTES.md`.

### ⟶ Next steps

1. **Christian's at-piano acceptance of v6.0.1** — owed, same as every release before it.
2. ~~Off-disk git backup (B54/C1)~~ **DONE 2026-08-23** — no longer a gate before v7
   implementation. See [[(C) Flaws]] Resolved.
3. **B77** — give the measure-map dialog the same focus trap the piece picker already has.
4. **v7.0.0 implementation plans** — the only remaining gate before v7 build; not yet written.

## 🟢 v6.0.0 — Practice Core — SHIPPED + INSTALLED 2026-08-18 (Plans A+B+C+D)

Christian's July 31 goal dump (fifth real-use feedback round, 19 items — quoted in
[[(C) Changelog]]), interpreted into four themes and brainstormed to an approved design:
the score knows where measures are (cloud-vision mapping, sub-sections, snap selection);
tracking becomes small floating panels (rep counter, paused-sets tray, clock/timers);
plans and history respect time (date navigator, carry-forward, time estimates, day-timeline
History, planned-vs-done Calendar, day-scoped sessions, score goals banner); and the broken
basics get fixed (voice/metronome fast-path + chime acks + fuzzy variants under the
narrated-corpus zero-false-mutation gate, TTS auto-recovery, Brain status/style). Full
detail: `~/praelude/docs/superpowers/specs/2026-08-05-codakiller-v6-practice-core.md`.

**Plan A "Practice Surfaces" — built + verified on `v6/plan-a`, merged to main `d0bb001` (2026-08-06).**
Schema v14, the floating Practice Dock, pause-across-days, day-scoped sessions, day-sheet date
nav/carry-forward/estimates, and the score goals banner are code-complete, subagent-built with
per-task review gates: three ABBA deadlock classes and phantom-session minting caught and fixed
before landing, final whole-branch review APPROVE-contingent-on-a-12-item-fix-wave (all 12
closed), and two live-QA rounds at 720×520 that found and fixed a real unreachable-clock-panel
bug and a devMock checkpoint crash loop unit tests couldn't have caught. Gates at `f77c199`:
vitest 1808/1 skipped, cargo 718/0, tsc/clippy/build clean. One small residuals commit
(dock-layout only) is landing next. Full detail: [[(C) Changelog]] 2026-08-06 entry,
`~/praelude/.superpowers/sdd/2026-08-05-codakiller-v6-plan-a-practice-surfaces/`.

**Plan B "Read Models" — built + verified on `v6/plan-b`, MERGED to main `73b415d` (commits
`eb98a2f..fe34566`, 2026-08-06).** Two pure read models, no schema change, no migration, zero new write
paths: `history_days`/`history_day_detail`/`day_sheets_range` (Rust, localtime-day bucketing
matching A5's session convention) back a new **Days** default view in History (collapsed day
cards, disclosure detail, 21-day paging; the old piece-indexed view lives behind a **Pieces**
toggle, untouched) and stacked planned-vs-done bars in Calendar day cells (today's cell no
longer sits empty). Whole-branch review + live QA caught and fixed a CSS flex-shrink
renormalization bug jsdom couldn't see, a stale-closure week-nav bug that dropped rapid clicks,
a deep-link regression landing on Days while the hidden Pieces view still fired a piece-select,
and a contract test that only passed via test-order localStorage pollution. Gates: vitest
1886/0 (1 skipped), cargo 727/0, tsc/clippy/build clean. Full detail: [[(C) Changelog]]
2026-08-06 entry, `~/praelude/.superpowers/sdd/2026-08-06-codakiller-v6-plan-b-read-models/`.
Three deliberate spec deltas recorded in [[(C) Flaws]] B65 (also noted here): paging instead of
virtualization; Days view drops piece-scoped filters in v1; day-expand shows per-set
aggregates, not individual attempt rows (attempts stay reachable via the Pieces view). The
400-day History reach ceiling (real ~mid-2027) is tracked as [[(C) Flaws]] B64.

**Plan C "Score Intelligence" — built + verified on `v6/plan-c` (commits `82c87cf..7b1bd73`),
MERGED to main 2026-08-08 (merge `9bae13f`).** Opt-in cloud-vision measure mapping (Map measures button →
per-page scan via Claude/Gemini vision → strict JSON → deterministic reconciliation → human
review with page raster + conflicts + renumber/drag/skip-page → Apply gate → tiny per-bar
overlay numbers, stale maps always surfaced), snap selection prefilling region creation from
mapped bars, and one-level sub-sections on `target_meta.parent_region_id` (child sets default
to 3-in-a-row). **The acceptance story is worth telling straight:** the real-API Scherzo run
took four evidence-directed algorithm iterations (C6→C6d — forward-only → system-start
brackets → cross-page brackets + XML end anchor → positional system-start classification)
before the controller closed it done-with-documented-limits. Printed-number OCR was ~flawless
throughout (22/22, then 24/25 digit-exact); it is barline-geometry COUNTING that stays
unreliable, worst on multi-staff systems. Final state: 5 of 6 sampled pages exact (the miss
was one rate-limited page), landmarks m.67/m.95 located exactly, 781 mapped vs 780 XML bars.
Live QA (post-review) caught a Critical — a local renumber wiped unrelated blocking
conflicts, letting Apply commit malformed geometry through the non-validating devMock — fixed
and regression-locked in the final fix wave, which also brought devMock apply validation to
parity, added a derived-bar-count amber band + interpolated-bar styling, and added per-page
partial-Apply skipping. **Every scan in the acceptance run went through Gemini only — no
Anthropic key exists in this Mac's Keychain, so Claude vision (the intended primary provider)
has never actually been exercised.** Standing action item for Christian. Gates at `7b1bd73`:
vitest 1999/0, cargo 815/0, tsc/clippy/build clean. New honest limits in [[(C) Flaws]]
B66–B69. Full detail: [[(C) Changelog]] 2026-08-08 entry,
`~/praelude/.superpowers/sdd/2026-08-06-codakiller-v6-plan-c-measure-mapping/`, acceptance
evidence `~/praelude/docs/qa/plan-c-scherzo-acceptance.md`.

**Plan D "Voice & Brain" — built, twice-verified, and SHIPPED 2026-08-18** (fix wave `fbe3f6d`,
release `34c1a15`, tag `v6.0.0`). Metronome commands now act on the PARTIAL transcript for
"metronome on / off / stop" (target <1 s, was ~5 s); routine acks became a 120 ms two-partial
chime while info-bearing outcomes still speak; natural phrasing and ASR mangles route through the
same byte-identical ambient firewall; a heard-text pill shows everything the app heard, including
speech it ignored; the default cloud voice moved Kore→Aoede with a cooldown-not-lockout retry and
a "Voice degraded" pill; and the Assistant's grounding copy became honest ("No book excerpts
matched this question" rather than anything implying hidden content). B58 — which had been
blocking the migration rehearsal gate — turned out to be a HARNESS bug, not a data problem: it
misread the legitimate July chamber-split as corruption. Fixed, so v13→v14 rehearsed green on a
fresh copy of the live DB immediately before install.

**The verification story, told straight:** the first fresh-context adversarial pass REFUTED the
build. The fast path's bare single words ("stop", "again", "clean"…) fired on progressive prefix
partials at the head of ordinary sentences — four lines of Christian's own narrated corpus
produced phantom rep writes, with the tail guard then suppressing the real final so the error was
invisible. The allowlist was cut to multi-word metronome phrases only (0 collisions across 1,309
utterances, independently re-swept) and partial-STREAM replay tests were added as the regression
lock. The second pass returned SHIP. Standing rule: **no bare prefix word may ever join the
fast-path allowlist**, and a finals-only replay corpus is structurally blind to this class of
defect.

**Gates at ship:** vitest 2101/0 (1 skipped), cargo 855/0, six narrated-corpus/firewall suites
with zero false mutations, `tsc` + clippy clean. The live DB migrated 13→14 in place; integrity
ok; counts identical across the migration (9 pieces / 171 blocks / 1,640 reps / 34 sessions).
Pre-install backup `(C) pre-v6.0.0-install-2026-08-18-101647.db` (SHA `c142f70a…`); the v5.0.0
rollback was archived to `~/Library/CodaKiller-rollbacks/`. New honest limits: [[(C) Flaws]]
B70–B73.

### ⟶ Post-ship reality — audited read-only 2026-08-20

This is what is **true**, not what was hoped. Every figure below came from a read-only query
against the live database, not from a previous document.

- **The app is genuinely in use.** Live DB: schema 14, integrity ok, **9 pieces / 173 rep_blocks
  / 1,660 reps / 36 sessions**. Two sessions since install — a **24-second** launch poke on
  2026-08-18, and a real **37-minute, 20-rep session on 2026-08-20 (02:20→02:57Z)**. That second
  one is the first genuine at-piano use of v6.0.0.
- **Acceptance recorded 2026-08-20: ACCEPTED WITH ISSUES.** After the 37-minute session above,
  Christian gave the first considered at-piano verdict any release of this app has ever had —
  four issue areas: score toolbar top-row overlap ([[(C) Flaws]] B76), voice misfires (the B70
  class), the Assistant still not worth asking, and dock/panel ergonomics. This satisfies the
  "no v7 before a verdict" gate below; see [[(C) Changelog]] for the full entry.
- **The headline v6 feature has never run on real data.** The live `measure_map` table holds
  **0 rows** ([[(C) Flaws]] B75). Cloud-vision measure mapping is proven in the test suite and in
  one branch-era Gemini acceptance run on the Scherzo; it has produced nothing at all on the real
  vault. And with no Anthropic key in Keychain, the Claude vision path — the intended _primary_
  provider — has never executed even once ([[(C) Flaws]] B67).
- **What is actually being used:** reps, sessions, and the pencil (15 `score_page_mark` rows).
- **Dead schema found by the audit:** `session.focused_seconds` is NULL for all 36 sessions ever
  recorded; every focus figure the UI shows is derived from `event` rows instead
  ([[(C) Flaws]] B74). Harmless today, misleading to anyone reading the schema.

### ⟶ Next steps

1. ~~Christian's at-piano acceptance verdict on v6.0.0 — written down.~~ **Done 2026-08-20** —
   ACCEPTED WITH ISSUES; see above and [[(C) Changelog]].
2. **Add an Anthropic API key to Keychain** (service `codakiller`, account `claude`) and run one
   real measure-mapping pass on a live piece — that closes B67 and B75 together and finally tests
   the feature v6 was named for.
3. ~~Off-disk git backup~~ **DONE 2026-08-23** — `gh auth login`, then `gh repo create
codakiller --private --source=. --push`; private remote at
   https://github.com/cchow375/praelude. See [[(C) Flaws]] B54/C1 Resolved.
4. ~~B70~~ **Fixed 2026-08-21, v6.0.1** — the fast-path tail guard now suppresses on routed
   intent rather than by prefix; "metronome on 96" no longer loses the tempo. See [[(C) Flaws]]
   Resolved.
5. ~~Decide B74~~ **Decided 2026-08-20: DROP** the column, in schema v15 alongside v7.0.0's
   migration, not in the v6.0.1 patch.
6. ~~v6.0.1 "Real-Use Fixes"~~ **Shipped + installed 2026-08-21** (tag `v6.0.1`). See the
   v6.0.1 section above.
7. **v7.0.0 "Motivation Layer"** — design approved + spec written 2026-08-20, awaiting
   Christian's review of the spec file before implementation plans are written.

## 🟢 v4.0.0 — Practice Notebook OS — SHIPPED + INSTALLED 2026-07-30 (started 2026-07-27)

Christian's July 27 goal dump. Requirements ledger: `~/praelude/.workflow/LEDGER.md`; spec:
`docs/superpowers/specs/2026-07-27-codakiller-v4-practice-notebook.md`. Four phases, all merged to
`main`, each lane fresh-verifier CONFIRMED, and now **installed** at `/Applications/CodaKiller.app`
(tag `v4.0.0`, release commit `ab7828a`; rollback preserved at `~/CodaKiller-v3.2.0-rollback.app`).
See [[(C) v4.0.0 — Version Record]] for full ship detail.

- **Phase A — bug + perf** — ✅ done in source: universe click/teleport fix (`502eaab`),
  rep rung-completion display fix (`998ff93`), transform-first score zoom + trackpad pinch
  (`7d7945a`). Honest carry-over: piece-switch first-decode latency still open (ledger 21 / B42).
- **Phase B — UI overhaul** — ✅ done in source: collapsed practice form with byte-identical
  payload (`01fbe03`), metronome quick bar + no-scroll icon popover (`591310b`), 148px icon rail +
  `.ck-fit` text-fit (`e10e77e`), Today rebuilt as the app main menu with a Today's-Practice window
  (`dd25305`), and the **Brain→Assistant / Ledger→History** purge via `src/shell/terms.ts` over
  three verify→fix cycles (`7f983f2`+`6ce658c`+`672e103`).
- **Phase C — the Practice Notebook** — ✅ done in source: schema v11 `day_sheet`/`piece_plan`
  (`720abac`/`b440cca`), the cursor-first paper-like day-sheet editor with the chips-insert-text law
  (`16a11ce`), the Score **Plan** tab with two-way sync + calendar past-day sheets (`145b75f`), the
  ⚑ goal promotion, the Assistant passage-helper with accept-as-only-write (`ce9c72d`), and the
  per-piece Schedule surface (`617174c`). Browser QA 10/10.
- **Phase D — quotes / books / IMSLP / mapping** — ✅ done in source: 182 verbatim-verified quotes
  - scholarly windowed reader (`2b1f2a5`, rotation fix `4b1cfb9`), data-driven `books.json` library
  - Settings Books panel (`0bf9b27`+`caf54f6`+`27805e2`), IMSLP search + browser-handoff download +
    typed-name archive (`ee95ce6`+`923333e`+`4c8aa08`), and the mapping wizard's **real** page pane +
    measure strip + XML landmarks via `score_xml_measure_facts` (`81c8c99`+`04220aa`).

### ⟶ Next steps

1. **Christian's at-piano + design acceptance of v4.0.0:** a design verdict from screenshots,
   then a real Steinway session covering the new notebook flow and the v3.2 voice items still
   owed (exact verdicts, `metronome stop`, one no-wake question, one selected-Region set request).
   First re-grant Microphone + Speech Recognition (fresh binary reset TCC) and confirm Dictation
   ON.
2. **Then** the still-open lanes: piece-switch cached-bitmap (B42), off-disk git remote,
   Goals/Calendar/session voice capability registry, history-at-scale reflow, durable Universe layout.

---

## 🟢 v5.0.0 — the paper redesign + real perf fix — SHIPPED 2026-07-31

Driven directly by Christian's July 30 hands-on feedback (quoted in full in [[(C) Changelog]]):
v4's perf work made the app _laggier_, not faster; the "fast path" bytes/megapixels theory was
wrong; Today read as a form, not a notebook; IMSLP search was dead from the UI; the Tanglewood
chamber pieces were wrongly merged; the quotes didn't land; and the UI itself needed first-class
attention. Commits `da366dc`, `771e7d3`, `ccd35f8`, `35c9572`.

- **The real perf fix** — ✅ done: colour-depth-aware image decoding (`da366dc`/`771e7d3`). The
  lag was never bytes or megapixels — it's pixel colour depth, with an embedded ICC profile acting
  as a ~15× multiplier. New Rust image fast path (`scanned_page.rs`, `page_image.rs`), frontend
  wiring in `pageImage.ts`/`PdfPage.tsx`/`ScoreView.tsx`. Full measurement table in
  `~/praelude/NOTES.md`.
- **Paper design system** — ✅ done: shell/Today/Score/Universe repainted from monochrome dark to
  warm paper, by Christian's explicit direction choice (`da366dc`/`771e7d3`).
- **Today rebuilt as a notebook, not a form** — ✅ done (`771e7d3`, hardened `ccd35f8`): the
  day-sheet editor now reads as an actual notebook page; `ccd35f8` fixed the practice page
  rendering as a modal dimming the app instead of its own page.
- **Universe made static** — ✅ done (`771e7d3`): the force-directed physics simulation is gone,
  by Christian's explicit choice.
- **Freehand pencil drawing on the score — NEW** — ✅ done (`35c9572`, schema v13): toggle,
  undo, clear-page with confirm, Escape to put the pencil down; marks tied to file fingerprint per
  piece+edition+page. Highlighter, sticky notes, and per-stroke eraser explicitly declined.
- **IMSLP UI fix** — ✅ done (`da366dc`): in-app search actually works now.
- **Quotes curated** — ✅ done (`da366dc`): 134 verbatim-verified quotes from 4 pedagogues,
  replacing the noisier 182-quote v4 set.
- **Chamber split** — ✅ done (`da366dc`): Barber Pas de Deux / Copland Cowboys with Lassos
  separated via `scripts/split-tanglewood-folders.sh`.
- **Schema migrated v11 → v13.** Gates: `tsc` clean; vitest **1643 passed / 1 skipped** (was
  1,270 at v4.0.0); cargo **668 passed / 14 ignored** (was 580); `cargo clippy --all-targets --
-D warnings` clean.

### ⟶ Next steps (9 known-open gaps — full entries in [[(C) Flaws]] B47–B55)

1. **Christian's at-piano + design acceptance of the whole v5 UI direction** — still owed
   (screenshots verdict + a real Steinway session).
2. **One real at-piano check of the image fast path on the Barber** — the dev mock returns empty
   for `score_page_image`, so every QA pass so far went through the PDF fallback; the fast path
   itself has never been exercised in a real browser.
3. `stale_marks` (older pencil marks hidden after a re-scan) only surfaces while pencil mode is
   on — someone who never picks up the pencil never sees the notice.
4. A rare chamber-split migration residual: a collision that forces the migration to decline
   still stamps `user_version` 12 and never retries, with no warning surfaced (cannot fire on
   Christian's current data).
5. The fast-path refusal costs ~8ms/page, uncached in Rust — the vector edition re-parses every
   page turn. Negligible but real.
6. The Map-this-score wizard's page pane still renders through PDF.js, deliberately.
7. `.anomalies-badge-warning` (`AnomaliesPanel.css`) measures 4.47:1 at 11px — below AA,
   pre-existing, out of scope this round.
8. Today's screen still shows a menu (Today's Practice / Score / Assistant / History / Universe /
   Settings) duplicating the shell nav rail — redundant, not yet resolved.
9. ~~Off-disk backup is still absent~~ — RESOLVED 2026-08-23: private remote at
   https://github.com/cchow375/praelude (see [[(C) Flaws]] B54/C1 Resolved section). Note the
   Obsidian vault itself is still not backed up.

**Then:** the off-disk private git remote, the Goals/Calendar/session voice capability registry,
and history-at-scale reflow — all carried forward unchanged from v4.0.0.

## 🟢 P0 — Skeleton — DONE

Tauri scaffold, dark/light shell, settings store, sqlite schema v1, toolchain (Rust via brew,
vendored `hear` 0.8), `.app` builds. (Tasks 1–4.)

## 🟢 P1 — Metronome — DONE

Sample-accurate cpal audio engine (fractional clock + mixer, lock-free RT thread), 6 synthesized
click sounds, accents/subdivisions/gain, boost mode (crash-safe volume restore), popover UI.
Daily-usable. (Tasks 5–8.)

## 🟢 P2 — Voice loop — DONE

`hear` STT supervisor + half-duplex gate + deterministic intent router + Gemini TTS (with `say`
fallback) + Keychain key handling. Spoken commands drive the metronome; never hears itself; 60 s
real-piano-plus-narration → zero false intents. (Tasks 9–14.) Ships as **v0.1.0**.
**⚠️ Historical acceptance caveat:** at that boundary, proof was automated tests +
`say`-through-speakers only and the old P0–P2 checklist was pending. That checklist is now a
superseded evidence record, not the current v8.2 flow.

### ⟶ (P2-era next steps — superseded 2026-07-10)

1. ~~At-piano acceptance of v0.1.0~~ → folded into the **v0.2.0 acceptance run** (P3 block
   below): tonight's real practice session tests metronome + voice loop + rep tracker at once.
2. **Off-disk git remote** — still open ([[(C) Flaws]] C1; needs `brew install gh` + auth).
3. ~~Carry the two P2→P3 debts~~ → both paid in v0.2.0 (B1, B2 → Resolved).

---

## 🟢 P3 — Pieces + rep engine — DONE — shipped 2026-07-10 as **v0.2.0**

The real product exists now. Shipped (full record: [[(C) v0.2.0 — Version Record]]):

- **Pieces** seeded from the vault (all 5 found; XML detection right) + **typed intake
  interview** on first open. _Verbal_ intake deferred to P5 by design (it's a conversation —
  the brain's job).
- **Rep tracker:** blocks over measure ranges, voice-opened ("open a rep tracker, measures 40
  to 56, start at 80, target 120") or by form; auto/manual ladders; variant lanes; three-way
  verbal check-off with note capture; minimal speak-back ("Twelve of thirty. Up to
  eighty-four."); metronome follows ladder steps. Rep HUD + block history in the UI.
- **Sessions:** auto-started timeline; end by voice/UI/app-exit → append-only summary markdown
  per practiced piece (`(C) codakiller-sessions.md` in the piece folder — supersedes the spec's
  `CodaKiller 2/` namespace note; recorded in `NOTES.md`).
- **Both P2 debts paid:** runtime Gemini→`say` fallback ([[(C) Flaws]] B1 → Resolved) and
  mic-permission-denied guidance banner (B2 → Resolved).
- Schema v2 (incl. dormant `spot_review` for the P5 planner). Suites: cargo 176 lib + 13
  integration, clippy clean, npm 12 files/90; hero-flow e2e through the real STT supervisor.
- Plan: `~/praelude/docs/superpowers/plans/2026-07-10-codakiller-p3.md` (tasks 15–21).

### ⟶ Immediate next steps (after v0.2.0)

1. **Christian: tonight's at-piano session IS the acceptance run** — intake a real piece,
   voice-open a block on a real hard spot, check off reps hands-free, end the session, read
   the export. Supersedes the v0.1.0-only checklist as the top thread.
2. Feed real-use friction back into a fix round (expect rep-vocab/ladder tuning).
3. Off-disk backup (still open, C1).

## 🟢 P3.5 — Editable Foundation — DONE — shipped 2026-07-12 as **v0.3.0**

The app Christian already uses stops being write-once. Full record:
[[(C) v0.3.0 — Version Record]]. Shipped:

- Schema v3: Region + Goal + canonical Event graph; existing blocks auto-clustered into regions;
  canonical exports; derived progress metrics; nullable tempo for non-tempo work.
- Full CRUD: piece state, goals, regions, blocks, individual reps; consistent inline edits and
  confirmation-before-delete.
- Region-grouped history with summaries, search/sort, rep drill-in, rename/recolor/merge/split,
  and block movement.
- Draggable/resizable/collapsible/snap-to-edge Rep + Session windows, persisted layouts, reset.
- Independent practice focus and metronome controls. Tempo ladders advance without requiring the
  click; notes/phrasing/dynamics/memory/hands blocks can carry no BPM at all.
- Practice Universe readiness: honest metrics reward time, consistency, coverage, and quality
  without making self-reported “clean” reps the currency.

### ⟶ Immediate next steps (after v0.3.0)

1. **Christian: run the real at-piano acceptance session on v0.3.0** — edit one mistake after
   logging, expand its region down to reps, move both floating panels, and try a phrasing block
   with the metronome off.
2. Fix any real-use friction before expanding scope.
3. ~~Plan P4 with a real-PDF/light-mapping spike~~ → shipped in v0.4.0.

## 🟢 P4 — Score viewer — DONE — shipped 2026-07-12 as **v0.4.0**

The real PDF is now the piece's hero surface. Shipped:

- Bundled PDF.js + local worker; continuous pages with visible-page ±1 canvas virtualization,
  cancellable rendering, HiDPI cap, fit-width/manual zoom, page controls, and readable editions.
- Rust-only PDF discovery and path validation. Exact bytes cross raw Tauri IPC; no filesystem
  scope, base64, traversal, symlink escape, or cross-piece edition access.
- Edition preference survives rescans. Region anchors store normalized rectangles per edition
  fingerprint; changed editions say **remap** rather than showing a false highlight.
- Region sidebar + active-block highlighting + selected Region block history + prefilled
  **Practice this Region** form. Mapping supports multiple boxes, undo, save, clear, merge, and
  safe invalidation on split.
- Silent deterministic voice navigation: **“go to/show page N”** and **“go to/show measure N.”**
- Real fixtures: seven Scherzo editions up to 20.3 MB / 28 pages and an 85-page Cortot volume.
  Frontend 28 files / 145 tests; Rust 228 unit + 13 integration passed; strict clippy and
  production build green. Visual mapping flow passed in dark mode.

**Honest boundary:** mapping is manual page geometry, not note recognition. A native real-score
at-piano pass is still part of Christian's standing acceptance run.

### ⟶ Next steps

1. Christian maps one Scherzo Region, switches editions, voice-jumps to its measure, and opens a
   practice block from the score during the real-piano acceptance run.
2. Build P5's grounded brain and knowledge graph; do not put an LLM in score navigation.

## 🟢 P5 — Brain + knowledge library — DONE — shipped 2026-07-12 as **v0.5.0**

Typed + wake-word grounded Q&A now uses Claude-native → Gemini-native → cited-offline fallback;
the local graph contains 28 practice methods, 13 symptom routes, 10 psychology principles, and 18
primary/authoritative sources. Bounded selected-piece context excludes paths/secrets. A visible,
read-only Next work trace ranks due goals, open blocks, weak/recently missed Regions, and spaced
revisits. Intake conversation proposes expiring one-time field diffs; only explicit Save mutates.
The Brain has no verdict/navigation/tempo/scheduling/tools authority. Three fresh reviews closed
semantic policy, authorization, data-sync, and planner visibility gaps. Full record:
[[(C) v0.5.0 — Version Record]].

### ⟶ Next steps

1. Build P5.5's nested Goal + seven-day daily-work layer on top of the deterministic planner.
2. Recovery must preview first and apply atomically only after Christian chooses Move / Done /
   Dismiss / Leave; no broken-streak punishment and no automatic rescheduling.

## 🟢 P5.5 — Goals + calendar — DONE — shipped 2026-07-12 as **v0.6.0**

Schema v5 adds strict daily work with immutable origins and audit events. Nested Goals expose
subgoal completion plus Calendar-work summaries. The seven-day Calendar supports explicit CRUD,
capacity, and Goal paths. Missed work previews without writes, then one optimistic atomic Apply
handles Move / Done / Dismiss / Leave under deadline, horizon, and exact half-capacity rules.
Deterministic Goal suggestions gain an explicit Schedule form; providers still have no scheduling
authority. Full record: [[(C) v0.6.0 — Version Record]].

### ⟶ Next steps

1. Backfill reconstructable `session_event` history into canonical events idempotently before the
   Universe reads metrics; do not claim old work never happened.
2. Execute P6: honest Home/Universe, references, deep settings, icon, automated sealed DMG.

## 🟢 P6 — Home + Practice Universe — DONE — shipped 2026-07-12 as **v1.0.0**

Home now opens on an honesty-first Practice Universe backed by schema-v6 canonical history. Focused
time, 28-day active dates, Region breadth, and revisits drive accessible star systems; quality is
only a narrow text-equivalent brightness tint, never a score. P6 also ships fixed-origin reference
searches, deep typed Settings with native write-only keys, verdict aliases, final icon, restrictive
CSP, and one rollback-safe app/DMG/checksum release path. Full record:
[[(C) v1.0.0 — Version Record]].

**v1.0.1 reliability patch:** the v1.0.0 score spinner was traced to PDF.js's modern module
worker under WKWebView/Tauri's custom protocol—not to corrupt PDFs. The matching legacy display +
in-process loopback worker now renders the actual 25-page Scherzo, and bounded loading exposes a
retryable error instead of hanging. Full record: [[(C) v1.0.1 — Version Record]].

**v1.0.2 scanned-PDF patch:** Christian's screenshot caught the remaining acceptance hole:
page metadata worked while real image-backed music pages painted white. The exact PDF.js 6.1.200
WASM/CMap/font/ICC runtime is now bundled and configured for same-origin WebKit use. A packaged
native pixel gate visibly painted representative JBIG2, JPEG/ICC, and CCITT pages. Full record:
[[(C) v1.0.2 — Version Record]].

**v1.1.0 coherence release:** one canonical Region/Tricky Section now drives Score and Details
editing, explicitly linked score practice, color-coded box/highlight/text-note overlays, block
history, and Calendar associations. Big Goal deadlines appear as Calendar milestones; stars open
their exact piece; async loaders reject stale selections. Region split is atomic and Region graph
deletes/merges preserve linked history. Full record: [[(C) v1.1.0 — Version Record]].

**v1.2.0 actionable-score release:** each measure-sorted section is now an accordion with its own
Practice, Edit, Score marks, and Tutorial tools; title and Practice notes are separate shared
fields; score density adds Fit page, 2-page, 25–200% zoom, search, and hide/show sections. Schema 7
adds reusable local-video chapters mapped many-to-many to Regions. The analyzed 39:57 Scherzo
tutorial is mapped to all 12 live sections. Full record: [[(C) v1.2.0 — Version Record]].

**v1.3.0 compact-workspace/Brain release:** Settings now scales the complete interface from 75–125%
(90% default); the score rail and persistent Brain drawer collapse without discarding context;
floating practice no longer reserves a permanent gutter; the native window reaches 720×520. The
Brain performs cached bounded read-only retrieval across three supported practice books, extracts
bounded notated facts from the exact selected MusicXML measure range, combines canonical goals/
Regions/reps/session state, and exposes a visible per-answer grounding receipt. Retrieved book
excerpts cross to Claude/Gemini only with the explicit sharing setting; offline book prose cannot
leak through later conversation history. Full record: [[(C) v1.3.0 — Version Record]].

### ⟶ Next steps

1. Christian runs the complete v1.3.0 path: narrow/scale the window → Scherzo section → collapse
   score rail → Brain → describe a real failure → verify grounding → disagree/request an
   alternative → manually record the chosen experiment.
2. Tune only what real use proves weak; do not expand scope before that evidence.
3. Add the off-disk private git remote.

## 🟢 P7 — Practice OS transformation — SHIPPED inside **v3.0.0**

Christian's July 15 feedback and the live database replaced the old “wait for first use” plan with
direct evidence. v1.3.0 has been used for **481 recorded attempts across 48 blocks**. The issue is
not missing scope at the edges: the core completion contract, score-location workflow, history
scale, voice firewall, Brain ergonomics, interface, and Universe all need a coordinated rebuild.

Locked product systems (full contract: [[(C) v2 Transformation Brief]]):

1. **Practice Ledger + Protocol Engine** — immutable attempts; configurable consecutive-clean /
   adaptive-recovery gates; current/best streak; honest accuracy; undo/correct/restart; focus,
   breaks, safety, stages, tempo-down recovery, and cold retention.
2. **Score Atlas** — selection-first targets, exact MusicXML identity where compatible, visible
   calibration/confidence/correction for scanned PDFs, nested/overlapping targets, aesthetic notes,
   and one-action resume from the score.
3. **Compact Session Desk** — global write receipts, scalable filtered/disclosed history, precise
   summaries, editable 20-minute routines, and canonical Markdown projections.
4. **Two-lane Voice + Brain** — deterministic terse hot loop; validated/confirmed/undoable
   natural-language action drafts; narrated-recording replay; concise durable score/corpus/history-
   grounded answers and narrowly typed tools.
5. **Handcrafted Practice OS + earned Universe** — off-white/ink/terracotta operational language,
   asymmetrical matte surfaces and restrained motion; zoomable/pannable graph whose dense color is
   earned through time, consistency, coverage, recovery, mastery contracts, and retention.

Execution is gated in that order because history, Brain, and Universe must derive from the corrected
practice semantics—not from v1's “every attempt advances completion” model. The row-level proof
contract lives in [[(C) v2 Acceptance Matrix]].

**Historical source gate, subsequently installed in v3.0.0:** schema-v8 sidecars plus
the schema-v9 one-live-set invariant; transactional RepEngine/store/IPC writes; configurable
consecutive-clean mastery; exact tries/streak/reset/accuracy/tempo/review projections; append-only
undo/correct/reverse/restart; relaunch recovery; immutable historical set rows; and one Rust-owned
projection across the HUD, history, metrics, planner, export, Brain context, and voice verdict
adapter. Disposable copies of the July 15 backup preserve every legacy row/hash, project **792**
explicit anomalies, and keep all 127 legacy non-tempo BPM sentinels physically exact while showing
them semantically as not applicable. Christian's live database is now schema 10; v3.2.0's release
audit preserved it exactly at 6 pieces / 63 blocks / 559 reps / 14 sessions.

This closes the central “attempts are mastery” source defect. **2026-07-16 — the practice loop
itself is now durable and proven in source** (recovered from the interrupted overnight build and
re-verified blocker by blocker): command receipts/idempotency, pause-aware active time with
one-minute suspension caps and backward-clock rejection, a fail-safe idempotent safety stop,
physically-anchored recovery, validated typed retention, and terminal mastered sets (the one real
defect found — history repairs reopening a mastered set — is fixed and regression-locked). The
same slice made Score Atlas target save real end to end (no schema change; rehearsals now land
**schema 10** exactly), gave the two voice lanes a single owner for set-opening, and confirmed
the five-workspace shell/Universe render only earned, real-backend signals. Later the same day,
the Session Composer gained its receipted `session_plan_start` backend and an honest Today mount
(explicit per-item starts, plan recorded in the receipt itself). By the end of the day the
**entire narrated corpus — all four sessions, 1,309 segments (griffes 79 + scherzo 721/201/308)
— replays through production routing with zero false mutations** (verbatim fidelity
machine-checked), and a read-only **anomaly disclosure panel** landed in the Ledger workspace.
The v3.1/v3.2 releases subsequently shipped the first Tier B natural set draft, durable Brain
threads, interactive browser QA, and packaged-native proof. Full Goals/Calendar/session authority
and live Steinway recognition remain open.

**v3.2.0 endurance/coherence gate (2026-07-20):** explicit native metronome ownership now
coordinates manual and practice clicks through pause/resume/close/restart/safety/relaunch; session
end rejects a live set and graceful quit closes before export; a 220-attempt simulation crosses
retries, variants, corrections, recovery, retention, a three-minute relaunch gap, and export with
exact immutable truth. Reviewed plans and Score work survive workspace navigation; repeat deep
links carry the exact piece/surface; hidden Score cannot capture keys; Brain shows the exact
semantic context it sees; routine receipts remain nonblocking while every error/confirmation stays
until dismissal. Final gates: 1,025 frontend and 529 Rust/integration tests, strict clippy,
interactive mock drive, real-database rehearsal, sealed package, and fresh-verifier Ship.

**The corpus finding that sets the next priority:** the deterministic hot-loop firewall is
rock-solid — 1,309 real segments of buried command tokens, ASR corruption, and conversational
verdicts all correctly stay inert — but that is precisely why almost none of Christian's spoken
practice becomes tracked state today. Tier A already handles verdicts/undo/restart/tempo in
_command_ grammar; the gap is _conversational_ phrasing ("forget the last one" vs "undo last
rep"), and the contract's answer for that is the **Brain proposing typed drafts Christian
confirms** (Tier B/C) — not more regex, which overfits (the corpus proves conversational speech is
unboundedly varied). **The first cut shipped in source 2026-07-16** on the wake-cue trigger model
Christian chose: on "Coda, ..." the Brain proposes a typed, confirm-gated draft (verdict / tempo /
undo / restart — session-goal deferred, no backend home) into a slim card; the hot-loop is
untouched, malformed proposals drop, nothing mutates without explicit Confirm, and non-wake-cue
speech never drafts (independently adversarially verified). The Brain's _answer-quality_ half
(one-glance, memory, retention/ledger grounding) shipped the same day. **What's left is the FEEL,
not the mechanism:** how the confirm cards read back and how Christian approves them hands-free —
that needs his ear at the Steinway.

### ⟶ Next steps

1. Run v3.2.0 at the Steinway: exact verdicts, `metronome stop`, one no-wake question, and one
   selected-Region natural set request; capture every failed phrase verbatim.
2. Build the semantic capability registry for Today/Goals/Calendar/session planning. Every write
   must use preview → spoken readback → explicit confirm → durable receipt → undo; the deterministic
   hot loop remains unchanged.
3. Add page/edition-to-Region clarification and durable draft history, then address B25 only when
   real dense-history use supplies the performance/interaction fixture.

### v3 frontend rework (running inside P7) — phase status

Approved 2026-07-16: a full monochrome dark retheme, score-mapping wizard, and force-graph
Universe, on top of the Brain online fix. Eight phases, tracked here so "what's next" stays clear:

- **P0 — Parity inventory** — ✅ done (every existing control/view catalogued before any rebuild).
- **P1 — Brain online fix** — ✅ done and verified in source (invalid default model, swallowed
  5xx, emptied Keychain key all fixed; commits `550af13`, `c3b5271`, `3028d3e`, `92dbed1`).
- **P2 — Design system + shell + Settings** — ✅ done and verified in source: monochrome-only
  token system (`src/design/tokens.css`), the `src/ui/` component kit (no outlined-button
  variant, enforced by test), the new five-workspace shell (Today/Score/Brain/Ledger/Universe +
  Settings), and Settings rebuilt disclosure-organized with full parity plus a truthful
  BrainConnection block. Adversarial verifier CONFIRMED all 7 sub-claims; 629/630 tests (1
  pre-existing, unrelated failure); commits `703788e`, `01451a5`, `0b2a389`, `0b7386b`.
- **P3 — Brain workspace rebuild** — ✅ done and verified in source (2026-07-16): single-column
  chat transcript with typed Q&A (one-glance answers + citation chips), a persistent truthful
  status line (`● online — gemini` / `○ offline — <reason>` via `brain_status`), per-piece
  conversation memory (resume/clear), intake-review + work-suggestion surfaces preserved behind
  disclosures, wake-cue voice UI deliberately excluded from this tab. Dead v2 `Shell.tsx` (+ test
  - css) deleted after proving zero importers, removing the stale "Version 1.3.0" failing test;
    commit `68213d5`; suite 744 passed / 0 failed / 9 todo, tsc clean, headless QA clean; fresh
    adversarial verifier CONFIRMED 7/7.
- **P4 — Score workspace + score-mapping wizard** — ✅ done: wizard + calibration IPC + all 6
  pieces pre-mapped, 288 anchors.
- **P5 — Today workspace + practice surfaces** — ✅ done and verified in source (2026-07-16):
  Rep HUD rebuilt with mono numerals (measures/N-of-M/streak/focus clock/tempo), Clean as the
  single solid primary action, pause-aware focus time, ladder state, no decorative rings; the
  Receipt Center gets an unmissable green/red save-receipt restyle (CSS-only, logic byte-
  identical); the Session Composer's candidates → editable routine → Start flow keeps Start as
  the ONLY write (receipted `session_plan_start`), machine-verified unchanged; the retention
  queue and voice surfaces (mic/STT toast, wake-cue confirm card) plus the session event bar
  now live at SHELL level so they persist across every tab, voice wiring token-identical to the
  old v2 shell. Commits `29d88f2`/`75acdc5`/`78eb5e8`/`da468bf`, follow-up fixes `b3e53f2`. Suite
  691/0, headless QA zero console errors. Fresh adversarial verifier CONFIRMED 7/7. The same day,
  a frontend performance audit (session ledger items 12–18, report at
  `~/praelude/docs/qa/2026-07-16-frontend-perf-audit.md`) produced 14 findings that a
  fresh-context verification pass mostly killed (invented cost models, fixes that couldn't work,
  findings in code Phase 7 replaces); ONE real bug survived — a Tauri `listen()` cleanup race in
  ScoreView's `score://navigate` subscription — fixed same day (`b3e53f2`) with an alive-guard
  pattern now the repo standard. Overall async hygiene verdict: genuinely good.
- **P6 — Ledger + Calendar workspaces** — ✅ done and verified in source (2026-07-16, commits
  `7a7b590`/`37002b5`/`05353b1`): Ledger rebuilt disclosure-first (piece → block → attempts
  loaded on expand), read-only anomaly panel preserved, inline SET-TITLE editing (`block_update`)
  for block labels while attempts stay append-only immutable evidence — corrections/voids keep
  the original visible ("The original stays in the ledger"); destructive block-delete
  deliberately not surfaced. Calendar rebuilt monochrome (week view, recovery review, capacity
  control), mounted with Ledger in ONE nav slot behind a quiet Ledger|Calendar switch — the
  five-tab shell contract stays intact. `devMock` gained `rep_check`/`reps_for_block` handlers.
  Old hued CSS remapped to monochrome via scoped token aliases; the verifier traced every alias
  to its resolved value — all neutral except the two signal colors. Suite 695/2 todo, cargo
  484/0 (backend untouched), zero console errors. Fresh adversarial verifier CONFIRMED in
  substance; accuracy notes: a second pre-existing load-contention test flake
  (`RetentionQueue.test.tsx` "validates snooze dates," fails full-parallel/passes isolated —
  same class as the `pdf-assets` flake), and `RegionEditor.tsx`'s 7-color region palette being
  allowed user-data color on the score, not a monochrome violation.
- **P7 — Universe force-graph rebuild** — ✅ done and verified in source (2026-07-16, commits
  `0d076d9`/`11dff60`, wheel-zoom fix `705f872`, the last workspace): a live, movable d3-force
  galaxy — pieces are suns (size = earned focused time, log scale), practice sections are
  planets (size/brightness = honest mastery state), sessions are satellites that aggregate into
  expandable clusters; drag with spring physics (pin/reheat/settle), pan + bounded zoom, hover
  highlights a node's neighborhood, click opens a detail panel (reps, cleans, mastery,
  last-practiced, jump-to-Ledger, jump-to-score). All the app's color now lives in this one view
  against pure black; the rest of the chrome stays monochrome. Earned-growth/anti-gaming logic
  untouched (frontend-only). Engineered for Christian's 8GB machine (event delegation, memoized
  gradients, one state update per animation frame, sleeps at rest, full teardown on tab close) —
  verified stable positions at rest, zero background CPU, clean unmount. Fresh-context
  adversarial verifier returned CONFIRMED with one narrow issue — a benign console error on
  every wheel-zoom tick from React 19's passive root wheel listeners — fixed same day via a
  non-passive ref-attached listener (`705f872`); full suite after the fix: 704 passed/0
  failed/2 todo. Honest caveats: node positions persist only for the app session (deterministic
  seeding keeps the sky visually stable across opens; durable per-node layout persistence is
  deferred to Phase 8+, needs a small new backend command), and the detail panel only shows
  fields the earned-growth snapshot carries (reps/cleans/mastery/last-practiced), not streak or
  tempo detail (that's Ledger's job).
- **P8 — Package + install v3** — ✅ done: the 288 pre-mapped anchors were injected into
  Christian's live database through the validated `score_calibration_save` path (rehearsed on
  a disposable copy first, with a fresh backup `(C) pre-v3.0.0-install-2026-07-16.db`, SHA
  prefix `3d18c0ba`, taken immediately before); a parity audit checked every row of the P0
  inventory against the final app (checked off or approved as a deliberate removal); final
  gates npm 706/0/2 todo, cargo 518/0, tsc clean; installed and verified running at
  `/Applications/CodaKiller.app`, tagged **v3.0.0** (commits `56dada3`/`c53230a`/`b2e751f`).

**Design checkpoint: PASSED.** Christian approved the new monochrome shell from the P2
screenshots, clearing Phase 3 (and now every later phase through 8) to proceed.

**v3.0.0 shipped the transformation; v3.1.0 added the first safe Practice Operator slice;
v3.2.0 hardens the whole app for long-session coherence.** See
[[versions/(C) v3.0.0 — Version Record]], [[versions/(C) v3.1.0 — Version Record]], and
[[versions/(C) v3.2.0 — Version Record]].
**Next:** at-piano v3.2 acceptance, the complete Goals/Calendar/Today/session capability registry,
page/edition clarification, durable drafts, and the off-disk private git remote.

---

## Historical standing to-dos (current lanes are above)

- [x] **First substantial real use received** — July 15 live history + feedback now drives P7.
- [ ] **At-piano acceptance, written down, for the CURRENT INSTALLED release (v8.2.1).** Automated replay
      does not prove `done`, `metronome stop`, or no-wake/operator speech over the Steinway. This
      item has been open and re-worded since v3.2 without ever being completed for any release —
      v6.0.0 had one real 37-minute session (2026-08-20), but the current packaged microphone,
      Listen Back, two-word verdict and native Score behavior remain unaccepted. Run the current
      packaged checklist in `~/praelude/docs/qa/v8.2.0/README.md` and log verbatim misses in
      [[(C) Changelog]]. The old `docs/qa/p2-acceptance.md` checklist is historical only.
- [ ] **One real measure-mapping pass on the live vault.** `measure_map` is empty; the headline
      v6 feature has never run on real data ([[(C) Flaws]] B75). First obtain Christian's explicit
      approval to send the whole current edition to a selected cloud provider; then use any
      configured provider and keep the review/Apply gate human-controlled.
- [ ] **Provider choice/key is conditional, not a standalone task.** The Claude vision path has
      never executed because no Anthropic key exists ([[(C) Flaws]] B67). Add that Keychain item
      only if Christian selects Claude for the explicitly authorized mapping; an existing Gemini
      path does not waive the cloud-egress approval.
- [x] **Off-disk git backup** — DONE 2026-08-23, the project's oldest unfixed risk, resolved.
      Private remote at https://github.com/cchow375/praelude. See [[(C) Flaws]] B54/C1
      Resolved. Caveat: the Obsidian vault itself is still not backed up, only the git repo.
- [x] P6 task plan executed and checked at
      `plans/(C) 2026-07-12-codakiller-p6.md`.
- [ ] Keep [[(C) Flaws]] current as real use surfaces issues.

## Durable non-goals — do not build these

Transcription/grading/pitch-detection of playing; a local LLM; any LLM in the hot command loop;
auto-imposed drills or plans; an always-on web server / cache-busting deploys. v2 may add local
retrieval and confirmed typed language actions, but it does not weaken these boundaries. (Full
rationale in the design spec §1 and [[(C) Flaws]] D2.)
