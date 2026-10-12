# Praelude — How To Use

## October 12 — installed Build16 camera controls

**Matches: installed personal native2.0.0/build16/schema5; friend native2.0.0/build12/schema5; Macv11.1.0/schema21. Last updated:2026-10-12.** The personal update is installed, user-opened and observed running, with all13 saved files exact before/after/after opening. Camera fixes and command-first customization below are installed; actual camera preview and recognition acceptance remain pending. The earlier Build15/candidate sections below are historical.

1. Open a score, choose **Score options → Camera gestures**, then **Enable camera**. The live preview opens. Sit as you will at the piano, relax your face and keep the iPad in its normal position. A stable recent face calibrates automatically; use **Recalibrate neutral face** after moving the iPad.
2. Under **Choose an expression for each command**, pick an expression or **Unassigned** for **Next page**, **Previous page**, **Clean**, **Sloppy** and **Again**. Each expression controls one command; moving it makes its previous command Unassigned and explains the change.
3. Available expressions are **Nod**, **Shake head**, **Grin**, **Open mouth** and **Close both eyes**. Nod up or down and return; shake to one side then the other and center. Hold a smile/open mouth briefly, then relax. Deliberate eye closure needs at least0.6seconds; ordinary blinks and a single closed eye are ignored.
4. **Sensitivity** offers Easy, Standard and Deliberate. **Expression hold** defaults to0.4seconds (0.2–1.2); **Time between commands** defaults to1.25seconds (0.5–3). Easy accepts smaller movements; the gesture must still finish and return to relaxed before a command can fire.
5. Test expressions in this panel: recognized input appears beside the preview, while score commands remain paused. **Available** names the gestures supported by current measurements. Missing pose or an individual landmark does not disable unrelated expressions; newly steady measurements can be recovered automatically without moving existing neutral.
6. **Show live preview** shows/hides the video without restarting capture; **Show face landmarks** controls the overlay. Use **Turn camera off** to stop capture. Startup/shutdown stays asynchronous; the button waits for shutdown before another camera can start.
7. Choose **Done** to use page commands on the score in Reading mode. Rep commands additionally need **Allow gestures to record reps**, a running set, score focus off and the first-attempt grade already chosen. The user supplies every verdict. Blocked contexts are explained rather than falsely reporting a recorded rep.

Frames stay on-device and are discarded; no video recording, face identity or cloud upload is added. Camera mappings remain device-local and do not alter practice schema/history or create continuous desktop sync.

**Next steps:** test preview hide/show and relaxed-face calibration/expression feedback in the settings panel, where score actions are paused. Report a freeze/crash or the exact persistent tracking message. Keep the friend iPad held.

## October 12 — personal update waiting for device readiness

**Matches: installed personal native2.0.0/build15/schema5; friend native2.0.0/build12/schema5; Macv11.1.0/schema21. Last updated:2026-10-12.** Build16 source is prepared; installation failed and read-only status still confirms Build15. A retry timed out during backup, before installation. Unlock the personal iPad, open Praelude, pause any running set and leave it idle; confirm readiness before another guarded attempt. Keep the existing app installed. Command-first controls remain the Build16 candidate until delivery.

## October12 camera repair candidate

**Matches: installed personal native2.0.0/build15/schema5; friend native2.0.0/build12/schema5; Macv11.1.0/schema21. Last updated:2026-10-12.** Build15 camera preview and recognition are reported unreliable. Build16 repairs and command-first controls are prepared for guarded personal delivery, with physical acceptance pending. Installed instructions below remain Build15 until delivery; candidate actions and exact limits are in `docs/qa/ios/2.0.0/build16/candidate-guide.md`.

## October 12 — installed Build15 on the personal iPad

**Matches: personal native2.0.0/build15/schema5; friend native2.0.0/build12/schema5; Macv11.1.0/schema21. Last updated:2026-10-12.** The personal update preserves every saved file exactly. Automatic opening was declined; Christian then opened Praelude and read-only verification observes it running. If an untrusted-developer message appears, follow Settings → General → VPN & Device Management → Developer App for your own developer. Complete post-launch readback preserves all13 files/19,420,130bytes exactly at schema5/revision3423; the friend iPad remains held.

Build15 includes the following installed personal-iPad controls and repairs:

- Tap the passage pencil, or double-tap its name/selected saved box, to edit its name and performance goal. Ordinary editing does not start dictation; use Dictate explicitly or the saved-box triple tap. Save/Cancel returns score voice input to its previous enabled/muted state.
- Use Pen and Undo/Redo for markings; a new drawing after Undo starts a new history branch. Manual zoom is retained when the practice controls change only the score's available height. Pencil and sustained physical behavior still need real use.
- Bare **Next** turns the score page; **Next set** starts the next eligible set. First-attempt Metronome starts at the armed practice tempo. After the first recorded attempt, supported voice Undo is available. The user supplies every verdict.
- The microphone attention indicator opens Hands-free details; recovery controls appear above command examples. Voice Check returns input ownership on Back/Done, and Mute retains capture while suppressing verdict dispatch. Recognition over piano remains unaccepted.
- **End practice** is first in the current-practice menu and still requires confirmation. Optional camera gestures offer local nod/shake/grin mappings to pages, verdicts or Off, with separate rep-input opt-in. Real camera accuracy, audible click and long-session behavior remain unaccepted.

**Next steps:** use the score normally; real-device feature acceptance remains open. Report a concrete failure if one appears. Earlier candidate/hold instructions below are retained history and do not override this personal-iPad installation.

## October 11 — build15 follow-up; explicit no-install hold

**Matches: installed native2.0.0/build12/schema5 on both iPads; Macv11.1.0/schema21. Last updated:2026-10-12.**

**Candidate only:** native2.0.0/build15/schema5 is prepared for controlled device validation; installation HELD. All authorized affected UI, independent live and package gates pass, with zero current scoped simulator failures. Final18’s failed record is retained below. Installed instructions remain unchanged: both iPads remain at build12/schema5 and were neither queried, installed nor operated under this work. The explicit user no-install hold remains binding; physical acceptance is separate.

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


**Matches: installed native2.0.0/build12/schema5 on both iPads; Macv11.1.0/schema21. Last updated:2026-10-11.**

**Candidate only:** native2.0.0/build15/schema5 diagnostic and functional follow-up is in progress. Christian asks to fix taps that do nothing and finish actual-flow testing, continuing until ready. B155’s cause remains under investigation; no tap-fix or readiness claim is made. Candidate changes are not installed behavior.

**Explicit user install hold:** do not install on either iPad until Christian lifts this hold. Candidate readiness and the standing immediate-install preference do not override it.

**Uninstalled candidate changes under verification:** Hands-free puts recovery controls before command examples; mute retires queued recognition/audio, and customization/checks suspend score voice actions. Voice/Space first-attempt Metronome uses the armed start BPM. The candidate also changes audio-notification handoff to address a deadlock risk (B160–B168). Broader final-source verification remains pending; none of this changes the installed build12 instructions below.

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

## Earlier October 11 — build14 held; installed guide remains build12

**Matches: installed native2.0.0/build12/schema5 on both iPads; Macv11.1.0/schema21. Last updated:2026-10-11.** Build13 is held after the stale passage-dictation finding. Build14 explicitly disables dictation for ordinary rename and clears intent on dismissal. Its candidate microphone now uses a small neutral attention indicator instead of a long red score caption; tap it for Hands-free details and recovery. These controls remain uninstalled. Final native tests and generic signing pass. The combined actual UI regression fails to open box editing after saving a name/goal, and unexplained opening failures remain; the successor is held. Speech over piano, camera accuracy, click, Pencil and sustained use are unaccepted.

**Next steps:** resolve the candidate's functional hold and verify guarded delivery after explicit readiness before treating candidate controls as installed behavior. Existing build12 controls are below; historical candidate controls are in `docs/qa/ios/2.0.0/build13/candidate-guide.md`, current evidence in `docs/qa/ios/2.0.0/build14/functional-follow-up.md`.

## October 10 — build12 personal iPad controls

**Matches: installed personal native 2.0.0/build12/schema5; friend native2.0.0/build12/schema5; Mac v11.1.0/schema21. Last updated: 2026-10-11.** Guarded installation and full-file preservation pass; Christian confirms opening build12. The friend’s existing library was preserved exactly and opening is user-confirmed; full friend post-launch readback remains unverified because the device is unavailable. Physical Pencil/audio/performance acceptance remains open. Full evidence: `docs/qa/ios/2.0.0/build12/practice-upgrade.md`.

- **Focus:** while reading, tap the center third near the top or bottom16% of the score, or use
  Score options → Focus. Controls and rep count hide. Rep recording, rep Undo and Reset are
  suspended; the set and prior history remain. Use Exit focus or the same middle-edge tap to
  restore counting. Listening can continue for other supported commands.
- **Control position:** tap the up/down control beside the microphone, or use Settings → score
  controls position. The main dock and annotation entry move together. The preference is local
  to this device. The microphone starts hands-free mode directly; its active button opens the
  hands-free panel.
- **Hands:** L / Both / R sit directly above Clean in a running set. The choice is captured for
  the next reported verdict; switching it does not change older reps or the original set contract.
- **Passage names:** double-tap the selected passage name to rename it. Today → Name and
  organize passages opens a searchable naming list without opening a score or beginning practice.
  Pencil buttons provide an explicit alternative to double-tapping.
- **Reading:** tap a white side margin to turn a page; left goes back, right advances. Top/bottom
  middle focus zones take precedence. Drawing, passage selection and modal editors retain their
  own gestures. Page buttons and keyboard arrows remain available. A250ms deferred bookmark write
  keeps persistence out of the immediate turn callback; closing/backgrounding flushes the bookmark.
- **Drawing:** Undo/Redo follow queued edits in order and reject obsolete asynchronous saves.
  Clean recent-page histories are retained for two detached pages; memory pressure can evict older
  Undo histories while saved ink remains. Huge pages use a normalized native canvas so PencilKit's
  width clamp does not collapse Fine/Medium/Bold into the same stroke.
- **Stamps:** accidentals come first in rows. Collapse stamp choices or minimize/move the palette
  to uncover the score. Pencil lift places a stamp; a finger creates a preview and Place confirms it.
- **Notes:** open Formatting for background color/opacity or Transparent, text color, size, font,
  emphasis and alignment. Resize from a corner. Text shrinks within the box to a12-point floor.
  The expanded reading inspector uses readable system colors; your chosen colors remain saved
  for the score and PDF export.
- **Voice:** Score options → Hands-free commands → Customize command phrases lets you add up
  to three phrases per supported action; built-in phrases remain available. Tempo phrases are a
  prefix followed by a number. Conflicting phrases are rejected with an editable error. Repaired
  or ambiguous phrases require confirmation; Cancel/expiry leaves history unchanged. Only actions
  supported in the current context are offered. Microphone diagnostics show permissions, route,
  ownership, received audio and recognition timing. Simulator checks do not prove speech over piano.
- **History:** Score options → Practice balance & full-tempo target, or History → By piece. Set
  an optional20–300 BPM full-tempo reference, using the same beat unit as practice BPM. It is separate
  from Start and Tempo goal. New sets capture it; older BPM is preserved and comparisons explicitly
  use today's reference. Last14 days, All history and individual session views show hands, tempo
  bands (including20–30% around quarter tempo), named variants, reps and sessions. Optional minimum
  shares define the suggested signal. Missing attribution or sparse records show insufficient
  information; this is not a judgment of playing or a prescribed practice mix.
- **Measure map:** Score options → Score tools → Measure map. Choose a source page, drag a box
  around one bar or system, enter first/last measure (same number for one bar), and confirm. Tap a
  confirmed range to correct it. Draw passages fully within confirmed regions to use their labels.
  A system rectangle yields the whole system range, not exact individual bar locations. Scan printed
  numbers provides untrusted hints; confirm them manually. Real-score host scanning succeeds but
  actual iPad map correctness and manual-flow acceptance remain pending.


**Next steps:** practice with build12 and verify the physical flows above. Preserve the current set; report exact failures without resetting the app.

## Historical build11 controls and acceptance checkpoint

**Historical checkpoint: both iPads installed native2.0.0/build11/schema5; Macv11.1.0/schema21. Last updated:2026-10-10.** Friend launch is user-confirmed; its initial-library readback remains unverified. Personal build11 refresh preserves13 files/13,568,473 bytes and its paused active set exactly under independent review. Personal launch/post-launch readback remains pending.

Build10 keeps selection handles and borders visible across ordinary and oversized page coordinates and limits overlay raster work. Explicit selection Cancel immediately discards the draft and returns to the score; existing saved passages stay unchanged. Navigating away retains a separate confirmation guard. These flows pass scoped native and actual iPad/phone UI checks; the user now reports qualified improvement in the real-score comparison. Earlier build9 user acceptance and the later score-specific failure remain in QA.

- **Tempo:** compact numbers show BPM and the Start/Goal controls have distinct spoken labels. Tap the BPM number to replace it with an exact value, use ±1/±5 or Tap tempo, then Apply. Cancel leaves the current value unchanged. Dragging the number previews the change and applies it on release. The supported range is 20–300 BPM.
- **Tempo goal and hands:** before starting, open the visible Tempo goal action in its large sheet, choose Start and Goal, a BPM/percent increase and the clean target, then Use goal. A passage can also retain that goal for future practice; the compact running controls show the full goal value. Choose L, Both or R directly. Techniques shows an ordered sequence with per-stage clean counts; changes describe the next set and do not invent attempts. Explore remains the ungraded start action.
- **Passage selection:** draw a box in Select, drag a corner to resize or the box to move, then choose Done. Cancel discards only the current draft, including an added box while editing an existing passage. The original saved passage remains intact. The response to the Prokofiev/Beethoven selection and Cancel comparison is “good it works better”; broader reliability remains unverified.
- **Marking while practicing:** Draw keeps practice controls available. In Select, Done stays above scrolling practice controls; narrow large-text layouts reflow. All six drawing tools have44-point targets. Drag or collapse the palette to uncover notation. Pinch and pan move the score and ink together. Two-finger tap undoes a drawing edit; visible Undo/Redo is available, including while zoomed. The pinch recognizer has priority over two-finger Undo. Fine/medium/broad widths and lighter highlighting support small marks. Pencil marks → Done and two-finger Undo were user-accepted on build9; Undo specifically while zoomed is not separately confirmed.
- **Names and notes:** double-tap a selected passage to rename, or triple-tap to dictate a draft. The passage list also offers a pencil button and Rename swipe action. Double-tap a sticky note to edit, triple-tap to dictate, or hold and drag to move it. VoiceOver identifies visible notes and opens their panel. Review text and Save; microphone errors leave keyboard entry available. Score gestures lists the shortcuts.
- **Movements:** use Movements & pieces in the score or the library's movement entries. Name the movement and set its first/last PDF pages with the large number fields or adjacent steppers. Typing replaces the selected page number; empty, zero or out-of-range pages keep Save disabled until corrected. An entry opens that source-page range and shows its own practice target. The PDF and annotations remain shared; saved practice retains the movement name and source range even if the label later changes. Actual saved passages keep their own identity and history.
- **Warmups:** adjust tempo or metronome without leaving the exercise. Pause & close preserves unfinished practice; Finish ends the session. Failed saves stay visible so work is not silently discarded.

**Next steps:** confirm personal launch and inspect post-launch data separately. The friend’s user-confirmed launch does not establish initial-library readback or physical note acceptance. Keep unmatched UI/accessibility and B148 acceptance open.

## Historical build11 note controls and acceptance checkpoint

Both iPads now have build11 from `646fd6cd26fd6fe6ef81df0dd22da9cdd59fb2d9`. The friend’s fresh empty install copies no personal data; Christian confirms opening it. His own iPad is updated in place with independently verified exact file and paused-set preservation, but automatic launch is denied and readback finds no running process. Open Praelude there; personal launch/post-launch data and physical note acceptance remain separate checks.

Build11 adds readable on-score notes and corner resizing. Select a note to show its corner handles, then drag a corner to resize. Double-tap the note to edit; open the lower scrollable formatting section for size (12–48, default20), font, bold/italic, text color and alignment. Review the preview and Save; Cancel preserves the original note. A failed save retains the draft and displays its exact error. The original score PDF remains unchanged.

Core420/native64 and the final oversized actual UI flow pass. Ordinary final UI fails before note entry amid extreme host load; this is not blanket UI or physical acceptance. See `docs/qa/ios/2.0.0/build11/sticky-notes.md` for the exact limits.

**Next steps:** confirm personal opening and post-launch retention, then verify note readability/resize/formatting. The friend’s initial-library readback remains unverified while that device is unavailable.

## Historical build8 installation and failure

**Installed build8 — physical Undo crash remains open:** native2.0.0/build8/schema5 from `a23cdec4f4f9acf42e8e5c724b6a386430dddca5` is installed. Independent review verifies all13 owned files/12,788,247 bytes unchanged by filename, size and SHA-256 before launch. Automatic launch was declined; the user opened the app. The23:59:40 UTC readback retains schema5/revision2086 (from2079),6 pieces/51 passages/50 sets/31 sessions/304 attempts/255 ink records (199 active)/2 stamps/2 notes. Original records remain exact except one piece page bookmark; profile/privacy/account/score data are exact. This readback precedes the23:59:53 UTC crash and is not post-crash retention proof. The user reported failure at19:59:56 EDT. Matching build8 dSYM identifies main-thread `EXC_BAD_ACCESS` at0x10 in `PKTiledView.performUndo` tile update, reached through the two-finger Undo action; this is distinct from the build7 PDF watchdog. Exact user sequence remains pending and the crash is unclosed. Signed Release checks pass, with profile valid through October16 at23:56:11 UTC (7:56 PM EDT). Sanitized evidence: `docs/qa/ios/2.0.0/build8/personal-ipad-install.json`. Mac v11.1.0/schema21 is unchanged.

**Next steps:** obtain the exact user sequence and reproduce the confirmed native two-finger Undo crash before accepting its repair. Keep the23:59:40 UTC readback separate from post-crash retention. Keep physical Pencil, microphone, large-score and sustained-use acceptance open; do not treat installation as task completion.

## October7 — build7 installed on the personal iPad

**October 7 user confirmation:** Christian confirms the update reached the iPad. This confirms installation; sustained Pencil, audio, freeze recovery, refresh rate and real two-device behavior still require physical acceptance. The complete implementation, verification and deployment handoff is `docs/qa/ios/2.0.0/build7/session-handoff.md` (source `3e03330`, installation record `2227817`).

Guarded same-bundle refresh installs2.0.0/build7/schema5 from source `3e03330`. Independent full pre/post inventory review proves all11 owned files/7,981,365bytes identical by filename,size andSHA256, including scores, annotations, history, account ownership/privacy/preferences. Pre-launch schema5/revision1647 has5pieces/44passages/43historical sets/30sessions/255unique attempts; retained active set is completed, with no running set. No schema migration, import, restore, uninstall or Mac change occurred.

Actual signed device Release passes strict signature, app/profile/team agreement, signer-certificate membership/trust and helper device inclusion; fixture arguments/debug diagnostics/test plug-ins are absent. Profile expiresOctober10 at17:55:53UTC (1:55PM EDT). Automatic launch failed; subsequent read-only device inspection confirms Praelude running and schema5/revision1660. Independent post-launch review retains all255 attempts,44set IDs,30sessions and every original45ink record, plus exact profile/privacy/preferences. A completed set is archived and newer ink/reward/page activity is observed; no author or automatic-startup attribution is inferred. User screen-quality confirmation remains separate. Source/native simulator verification remains distinct from physical Pencil/audio/freeze/long-session/real-account two-device acceptance. Exact sanitized evidence: `docs/qa/ios/2.0.0/build7/personal-ipad-install.json`; private complete backups stay outside Git.

**Next steps:** use the installed build7 for real practice to verify sustained Pencil/eraser/Undo/layer/page transitions and responsiveness. Renew with the same app/team before the actual profile expiry.


Build7 source candidate also keeps the phone’s resume strip above the tabs. In short landscape annotation windows, the score opens at stave width; pinch to choose another zoom and use finger navigation with Pencil drawing. Automatic width fitting returns to the previous portrait zoom. Scroll the bounded tool tray to reveal Done in short windows. Warmup Close and verdicts stay anchored while the central readout and error messages scroll. These build7 controls are installed now; Praelude is running and schema5 readback passes.

## October6 source repair boundary

At this historical October6 boundary, the iPad remained on2.0.0/build6/schema5. Build7 was a source candidate for freezing, disappearing ink, slow previews and crowded annotation controls; it was not installed then. The October7 installed boundary above now supersedes that source-only status.

**Next steps:** requested guarded update after the completed source/native/Release gates, then sustained physical drawing/practice acceptance.


## Historical installed mobile build6 (October3)

At the October3 historical boundary, the physical iPad ran2.0.0/build6/schema5. The guarded update preserves all11 owned files exactly. Christian confirms it opens; direct schema5/revision883 read passes. Personal Team provisioning expiresOctober10 at1:55PM EDT; renew with the same app/team using `npm run ios:refresh`.

The score controls now use the available width. Start without grading, Techniques and More options share44-point secondary actions; first-attempt and running verdicts use52-point horizontal labels. Setup/transport share rows when they fit; narrow and accessibility layouts reflow. Bottom Practice/Select/Draw, Done/double-tap, Library exit, colored hideable passages, stamp previews and expandable yellow notes remain available. Mobile usage: `/Users/c3/praelude/ios/docs/USING_MOBILE.md`.

**Next steps:** judge compact controls and Pencil/black ink/in-set annotation on the actual iPad, then verify real-account second-device continuity. These physical checks remain open.

**Matches: installed Mac v11.1.0/schema21 and native iPad2.0.0/build10/schema5. Build10 is observed running with exact post-launch preservation; the user reports qualified improvement in the selection/Cancel comparison. Last updated:2026-10-10.** Open `/Applications/Praelude.app`. This guide describes current actions; old UI and release history are retained in Changelog/version records.

## Separate installed iPhone/iPad build7

The Mac instructions below describe installed v11.1.0/schema21. The physical iPad runs **2.0.0/build7/schema5**, confirmed October 9. Build8 source is the separate development preview above. Its workflow is documented in `ios/docs/USING_MOBILE.md`; historical September14 device evidence is in `docs/qa/ios/1.1.0/`.

Phone tabs are Today, Pieces, Warmups, Progress and More. On iPad, the sidebar exposes every section. Settings → Import from Mac opens a reviewed transfer from Files and adds compatible scores, passage boxes, pencil marks and goals without replacing mobile data. Progress → Mac practice record retains original Mac history and all table records. Build5 extends Supabase sync to goals/routines, preferences, score metadata and private covers alongside supported native records/PDFs/recordings. The original Mac archive stays local and backed up; continuous desktop sync still requires an adapter.

In a score, Clean/Sloppy/Again record the pianist's verdict. Compact controls preserve large targets; acknowledgements no longer resize the music. Automatic passage-page turning is opt-in in Score options. Today → Start session follows warmup-first plans. First hands-free enable runs a voice check before starting requested listening. Performance mode explains that touching and holding exits it. Backup includes PDFs, editable ink, recordings and original Mac archives, within the bounded size limit.

**Next steps:** physical score/ink/voice acceptance and real-account/two-device checks; reviewed Mac import remains musician-controlled. The guarded build5 update and schema5 upgrade now pass; installed Mac remains unchanged.

## Start a useful practice session

1. Open **Pieces → Library → Add Piece**. Enter a title, optionally composer/folder, and choose a local score PDF. The app copies the PDF; your original stays where it is. You may also drag a PDF onto the app. A new installation starts blank.
2. Open the piece in **Score**. Use **Tricky Sections** to select an existing passage or add the measures you want to work on.
3. In the top practice bar choose **Goal**, toggle **Metronome**, and set **Starting tempo** / **Target tempo** where applicable. Press **Start set**.
4. After each attempt, choose **Clean**, **Sloppy** or **Again** in the Rep Counter, use your configured verdict keys, or speak a verdict with voice enabled. You supply the judgment.
5. Pause unfinished work to resume later, or finish the set. Use **End session** when done; your history remains local. **End my day** is a separate confirmed action with an optional photo.

IMSLP is only an optional external source: use its link, download a suitable public-domain PDF in your browser, then add that local file. There is no required IMSLP lookup or bundled score/teaching library.

## Navigation and setup

The main rail opens **Today, Score, Warmups, Pieces and Studio**. Its top arrow collapses labels into icons to return width to the score. **Settings** and **Metronome** are in the rail; the **Mic / Muted** control toggles speech input when the native voice service is available. The Assistant remains off.

Today makes **Open Score** and **Today's Practice** the main launch actions. **Today's Practice** opens your day sheet, plans and notes. Piece headings can return to that piece's Score/Plan. **Pieces** contains **Library | History | Calendar**. Settings sections start closed; open the section you need, make changes and choose **Save**. **Appearance** offers **Dark**, **Light** or **System**, with glass following system reduced-transparency/motion preferences. Interface scale and **Reset panel layout** help when controls or panels feel awkward. The minimum window is 720×520.

Microphone and Speech Recognition permissions are needed only for hands-free use. macOS Dictation must be enabled for that path. A fresh ad-hoc update may renew those prompts and separately ask to read Desktop-folder scores. Until Desktop access is allowed, Score can wait at **Finding score editions…**. Keyboard/mouse practice does not require a microphone. The app is ad-hoc signed, not notarized; native folder permission is separate from opening the app.

## Organize your repertoire

Use **All Pieces**, **Unfiled**, or a folder. The **+** creates a folder/subfolder; folder actions support New subfolder, Rename, Move and Delete. These are logical folders; organizing them does not relocate your score PDFs.

The Library uses **Active**, **Completed** and **Resting**. A piece's right-click or **⋯** menu opens it, moves it to a folder, changes completion state, puts it to rest/restores it or removes it. **Put to rest** declutters the active shelf while retaining files/history; **Restore** brings it back. **Remove…** asks for confirmation and moves an eligible app-owned piece folder to the Library's `.trash`; practice history remains in History. A separate detail-level file-removal action requires the exact piece name. Read its confirmation before proceeding.

Use the **Cover grid / Compact list** switch, title/composer search and **Recently practiced / Title / Composer** sorting. **⋯ → Choose cover… / Change cover…** accepts local JPEG, PNG or WebP files under 15 MB. A centered square thumbnail is stored without changing your original. **Reset cover** restores generated artwork. The folder control collapses in compact windows.

## Score and passage tools

Score opens one PDF page at a time, centered at a minimum 100% initial scale. Use **‹ / ›**, the page field or **Page Up / Page Down / Left / Right** to turn pages. **Score tools** contains fit and explicit two-page options. Zoom with **− / % / +**, trackpad pinch or Command/Control + scroll. Zoomed music scrolls inside its pane.

**Tricky Sections** is a finder: search, add and select passages. It stays available while you select or draw. Selecting a passage replaces the ordinary Score toolbar with an in-flow practice bar above the music. It never floats over the PDF. Long names truncate; hover to read the full name. Closing the selection restores the ordinary Score controls.

Use **Passage tools** beside the passage identity for **Edit**, **Score marks** or **Tutorial**. This is a centered surface, not an expanding sidebar. Starting a score mark closes the surface and exposes the tool, Review, Undo, Save and Cancel controls above the score, leaving the actual page drawable. **Review** returns to the editor. Marks retain their PDF edition/page/fingerprint identity; replacing the source can require remapping.

For freehand annotations choose **Pencil**, drag on the page, and use Command/Control + Z for the last stroke. **Escape** puts the pencil down. Clearing a page asks first. Pencil marks are stored per piece, edition, page and fingerprint; they do not modify the original PDF.

The **Plan** tab is today's checklist for the selected piece. Checking a plan item changes plan metadata; it does not log a rep. Sound targets and the editable piece goal cue remain descriptions of the sound you want, not grades from the microphone.

## Choose the set contract

The bar's **Goal** selects Tempo, Notes & accuracy, Phrasing, Dynamics, Memory, Hands / coordination or Other. Choosing a non-tempo goal turns the click off; turn it on again if useful. **Settings** holds completion basis/count and advanced tuning. **Variants** holds the ordered practice chain.

| Contract | What completes it |
| --- | --- |
| **Clean streak** | The required consecutive Clean evidence at the relevant tempo or through the chosen variant stages. Supports tempo ladders and mastery evidence. |
| **Total plays** | The chosen 5/10/15/25/Custom total of effective attempts, at a fixed starting tempo. Every verdict counts; completion does not claim mastery. |

A Clean-streak tempo ladder advances by the configured step after the required consecutive cleans, capped at target. Below target, the HUD shows the current rung streak; at target it shows the final proof requirement. Sloppy resets the streak and may lower tempo under the configured demotion policy; Again does not count toward Sloppy demotion. Global defaults live in Settings; a set may inherit, disable or override them.

With a variant chain, each stage has its own consecutive-clean target. Clearing it advances to the next stage. Sloppy resets the current stage; Again neither advances nor resets it. Earlier stages remain cleared. Only the final stage completes the chain.

## Save variants and routines

Open **Variants → Manage variants**. Enter a **New saved variant** and choose **Save to library**. Each **Show** checkbox controls that shortcut's visibility in the picker. This library is shared across pieces and persists after restart. **+ Custom** remains available for a one-off stage.

Select variants, arrange the sequence and set each stage's clean count. Choose **Save sequence as routine**, enter a name and **Save routine**. A saved routine replaces the current draft with a copy; later edits to the draft do not silently rewrite the stored routine. To replace a saved routine, enter its name and choose **Replace … with current sequence**. Delete requires inline confirmation. Hiding/deleting a shortcut preserves saved routine snapshots and existing sets. Variants are available for Clean streak; Total plays retains its fixed-volume contract.

## Rep Counter, pauses and corrections

The Rep Counter can move or minimize to a pill. **Paused Sets** holds unfinished sets across pieces and restarts; resume the desired set there. Other panels live under **Tools**, including Clock / Timer, Dynamics and configured Rotation. Minimized timers continue running. **Reset panel layout** in Settings restores a usable arrangement.

Use the correction controls or counted voice commands to add missed Clean evidence or reverse recent reps. Corrections append evidence instead of erasing the original record. Excessive undo requests are refused as a whole. A truthful Sloppy or Again is always better than an invented Clean.

The luminous core beside your count fills with the current goal: a clean streak, tempo rung, variant stage or Total plays target. Each saved Clean adds a brighter, wider spark burst and richer rising musical phrase. Sloppy/Again collapse a wave and drop fragments; consecutive setbacks deepen amber to coral, capped at three. A Clean clears that setback sequence. The ring always keeps the actual rule's progress: Again still preserves variant-stage progress and Total plays still counts every verdict.

Completing a set releases a larger radial celebration and resolving chord; completing an intermediate variation gets a shorter flourish; the entire chain earns the largest gold finale and musical cascade. Start-set, mic and verdict clicks/keys unlock local sound for later spoken verdicts; device/autoplay limits can keep it silent, and the native voice acknowledgement remains. Effects follow saved attempts, never block buttons or delay writes, and do not replay on corrections/undo/reopen. Reduced motion keeps static charge and a simple fade. Pausing or closing unfinished work stays quiet. A mastered set may show the six-second **Closing… / Stay open** countdown; another attempt, Stay open, pause or manual close cancels it.

A session rolls over at local midnight using its last real event; the app does not invent overnight practice. Active work pauses for later. **End session** is camera-free. Confirmed **End my day** offers an optional photo: choose a file or explicitly **Use camera**, or **Skip**. Showing the card alone never requests camera permission.

## Warmups, History and Calendar

**Warmups** offers visual exercises and saved ordered routines. Choose exercises and settings deliberately; the app does not impose a drill plan. Warmup evidence stays distinct from repertoire while contributing to retained practice.

**Pieces → History** opens a Days timeline, with expandable sessions/sets/attempts and the alternative piece view. The original evidence remains visible after corrections. **Calendar** shows plans alongside completed practice and can open a dated day sheet. Optional day photos supplement that record.

Day streaks derive from focused practice; the default threshold is ten focused minutes, configurable in Settings. A new profile explains what earns day one. Focused time estimates activity from practice events and excludes idle gaps; it is not a claim to hear how long you played.

## Voice essentials

Voice works on Mac when native permissions/service are available. New installations use `praelude` as the default wake word; upgrades preserve the saved word. Routine spoken confirmations are off by default; the short acknowledgement chime remains. Enable **Speak confirmations aloud** only if you want words too. The heard-text feed shows what the system recognized, including ignored speech.

| Say | Result |
| --- | --- |
| “metronome 96” / “metronome on ninety six” | Set tempo and start click. |
| “metronome on” / “metronome off” | Resume / stop click. |
| “tempo 140” / “faster” / “slower” | Set or nudge tempo. |
| “go to page 12” | Jump in the open score. |
| “open a rep tracker, measures 40 to 56, start at 80, target 120” | Open a block for the selected piece. |
| “clean”, “done”, “got it” | Record Clean while a block is open. |
| “sloppy”, “rough”, “shaky” | Record Sloppy while a block is open. |
| “again”, “nope”, “missed” | Record Again while a block is open. |
| “add two cleans” / “count that” | Add missed Clean evidence. |
| “take one back” / “undo four reps” | Append a correction; excessive undo is refused. |
| “close the block” / “end the tracker” | Close the current block. |
| “end the session” | End/export after the live block is safely closed. |

Mute voice or close the tracker before unrelated conversation. Native voice/Listen Back use over Christian's Steinway still needs its current hardware verdict. **Listen Back** optionally records takes for your own replay; unkept takes are discarded, kept audio remains local. It does not grade playing.

## Your data and honest limits

Pieces, scores, settings and practice evidence remain on this Mac. The database is schema 21. Session exports append to the piece's `(C) codakiller-sessions.md`; hidden legacy names preserve compatibility and do not change the visible Praelude product. An upgrade preserves the existing library; a new user's first install is blank. No books, quotes, copyrighted teaching library, personal scores or Christian's history are bundled.

Real-provider measure mapping remains unproven on live data. The Assistant is off/on hold; there is no current Books/Resources workflow. Accounts, friend presence and cloud sync are not connected. The existing Windows v9.1.0 unsigned installer is a separate candidate without native Windows 10/11 acceptance; it lacks voice, Listen Back, system TTS and volume boost.

If Score waits at **Finding score editions…** on a new install or after a code-signature change, answer the app's macOS score-folder prompt when it appears. That prompt was cleared and real Score/Variants passed for installed v11.1; it is troubleshooting, not a current release blocker. If voice reports Dictation/Code 201, enable macOS Dictation. For a PDF loading failure use **Try again**, then check the selected file/edition. If a saved mark says remap, verify the PDF edition. Report a persistent problem with the exact action and visible error; avoid deleting practice data to troubleshoot.

## Studio: your room and earned progress

**Studio:** your room begins with a digital piano and cardboard seat. The rank card shows total XP, progress to the next division and coins. **Furnish** offers Pianos, Seating, Shelves, Objects, Rooms and Palettes. An item's card shows price or rank lock. **Get** opens a price/balance confirmation; **Get for … coins** purchases and immediately equips it. Owned items use **Use in room** and switch freely, one per slot. There are 25 initial catalog items, including a side table; no real money is used.

**Rank path** lists Prelude, Etude, Arabesque, Nocturne, Scherzo, Sonata, Rhapsody, Concerto, Cadenza and Opus. Each has ten divisions, then Encore ranks continue. Division cost begins at 100 XP, rising 50 per rank; every division earns 25 coins. Open **How progress is earned** for the formula: 1 XP/600 focused seconds plus per-session completed-set milestone totals of 1/2/4/6 XP at 3/5/7/10 sets. Ten sets earn 6 bonus XP total. Refreshing does not pay again. Unfinished/paused sets do not count as complete; only sets whose saved record proves completion qualify for the bonus.

**Practice record** shows focus time, completed sets, focus XP, milestone XP, 28-day cadence and pieces with **Open score / History** links. Existing retained practice and resting pieces count. Corrections may revise XP/coins; possessions stay owned and new spending waits until earnings cover past spending.

Choose the profile button, enter a **Display name**, and **Save profile**. This is private device-local personalization. Email accounts, sync and friends are unbuilt, so no password or email is requested. **Back to practice** returns to music. When browsing Today, Pieces, Studio or Settings, an expanded Rep Counter automatically tucks into the bottom practice-tools pill without closing the set. Return to Score or Warmups to restore it if the app tucked it. Manual closed/minimized choices stay respected; you can also restore the panel yourself while browsing.

## Next steps

Practise a real passage using honest verdicts and keep unfinished work paused. Real installed Score/Variants already pass; actual cover selection/save/restart still needs acceptance. Only Christian can judge whether the new room and interface make sustained practice better. A Git clone on another Mac is a development checkout, not a transfer of this Mac's practice history or scores; follow the repository's `docs/NEW_MAC_SETUP.md` and do not copy the live database without a separately verified migration plan.

## Historical mobile build4 controls (separate from installed Mac)

The historical build4 candidate introduced passage search/current-page groups, explicit finish-and-switch, retained set settings and optional editable Techniques. Metronome exposes count-in, compound dotted pulse and lock playback; in-set tempo changes retain earned progress. Schema4 migration preserves originals; tempo-history backups require version3. These are source controls pending physical installation; the installed Mac Matches line above remains unchanged.

### Historical build4 technique and lock details

A technique chain shows its actual clean count per stage; use Edit stage targets to change each one.
The general target count applies only when there is no chain. If a playing metronome differs from the
armed tempo, reporting the first attempt corrects the click and asks you to repeat the passage before
saving a grade. Keep playing when locked preserves an already-running click while practice pauses;
resume the set when you return. A foreground pause or finished set stops its click.

**Installed mobile update October2:** 2.0.0/build4 is on the iPad with all seven original library files preserved. Automatic launch was denied; unlock and tap Praelude, trusting your developer only if iOS prompts. Physical schema4 migration is not yet observed. Mac import remains for after practice.

**First open now verified:** Christian opened build4 without a trust prompt; the device library is schema4 with the three existing pieces and ten historical sets present. Mac import remains pending.
