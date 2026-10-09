# Build8 usability repair and critical review

October 9, 2026. Candidate 2.0.0/build8, schema5. This is a working acceptance ledger,
not a declaration of shipment, zero bugs, physical acceptance, or a week-long teacher trial.
User feedback rejects build7's practical usability: annotation confirmation still freezes;
ink looks pixelated; controls and navigation impede actual practice; voice/microphone crash.
The full attached feedback is the scope, not just the previous stamp-switch reproduction.

## Design research

Apple's [gesture guidance](https://developer.apple.com/design/human-interface-guidelines/gestures/)
calls for responsive feedback, discoverable shortcuts and familiar alternatives to important
actions. This supports the visible Undo, Rename and dictation controls alongside touch shortcuts.
Its [UI design tips](https://developer.apple.com/design/tips/) recommend controls at least
44×44 points, while [layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout)
calls for essential information to remain easy to find as orientation, window size and text size
change. These principles informed the direct tempo/goal controls, pinned Done actions and usable
palette viewport. [Accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility)
also favors simple gestures and onscreen alternatives. These are design criteria, not evidence
that this app has passed physical or sustained-use acceptance.

## Concrete improvements and why they matter

The 45 concrete improvements below are under final verification; scoped passes, failed attempts and remaining acceptance gates are recorded below. Build7 remains installed; build8 has not been installed.

1. Tap the tempo number for exact numeric entry: avoids guessing a drag distance.
2. Drag tempo with immediate local preview and one commit at release: avoids writing the whole ledger per touch sample.
3. Fine/coarse tempo nudges in the editor: useful with one hand at the piano.
4. Tap-tempo entry: translates an intended pulse without typing.
5. A visible Tempo goal action: removes the hidden ladder setup.
6. Start/target/step/clean-count goal draft: makes the progression contract readable before practice.
7. Optional saved passage performance goal: retains the destination for future sessions.
8. Direct L/Both/R setup controls: removes repeated menu navigation for hands practice.
9. Practice controls remain visible while annotating: marking music no longer hides verdicts and transport.
10. Practice remains accessible while selecting passage boxes: the active set stays available.
11. Movable drawing palette: lets the pianist uncover the staff being studied.
12. Collapsible drawing palette: frees score space without exiting annotation.
13. Palette movement does not resize the PDF: avoids notation moving under the Pencil.
14. Short palette animation honors Reduce Motion: communicates state without an unavoidable animation delay.
15. Two-finger tap Undo with visible Undo/Redo alternatives: quick correction without losing discoverability.
16. Native PencilKit zoom rendering: addresses magnified low-resolution strokes without changing saved coordinates.
17. Native rendering for inactive ink layers: removes the fixed-resolution layer preview bottleneck.
18. Distinct fine/medium/broad pen widths: supports small notation between notes.
19. Lower highlighter opacity: keeps the underlying music legible.
20. Hold and drag sticky notes: allows repositioning instead of deleting/recreating them.
21. Double-tap selected passages for focused rename: avoids opening a full editor.
22. Triple-tap selected passages for dictation: reduces keyboard movement while retaining review before save.
23. Direct rename button and swipe action in passage lists: visible alternatives to gestures.
24. Double-tap a sticky note to edit and triple-tap to dictate: consistent note/passage text entry.
25. A visible Score gestures guide: explains shortcuts without cluttering the score.
26. Movements directly reachable from the score toolbar and library: removes the hidden large-menu entry path.
27. Warmup Pause & close and Finish: makes escape and completion explicit and preserves progress first.
28. Warmup live tempo and direct metronome controls: avoids leaving the exercise to adjust the pulse.
29. Duplicate PDF page notifications no longer rewrite the library: removes redundant disk writes during navigation.
30. Annotation saves skip unchanged historical-session projection: avoids re-sorting practice history while marking music.
31. Speech updates reach the interface safely: callbacks explicitly enter the UI actor to address a concurrency crash path.
32. Microphone permission, route and capture lifecycle guards: makes unavailable audio fail with recoverable UI.
33. Select the existing tempo on first focus: typing a replacement cannot accidentally append to the old BPM.
34. Movement practice retains the movement name and original page range in history: separate library entries also have meaningful practice records without duplicating a PDF.
35. Idle ink saves prepare in the background: newer drawing, verdicts or remote edits are checked again before publication.
36. Ink-save receipts identify exactly what was saved: cancellation and lasso reordering cannot silently clear newer drawing.
37. Audio notifications deliver asynchronously to the UI thread: an audio thread never has to wait for a UI actor that may itself be starting or stopping the engine.
38. All six annotation tools have visible 44-point targets: narrow palettes move finger/Undo/Redo controls onto a second row instead of hiding the note tool.
39. Compact tempo numbers include a BPM label, and Start/Goal have distinct spoken labels: the control's purpose is visible and accessible.
40. Movement page fields have 44-point targets, adjacent steppers and select-all numeric drafts: source ranges can be changed accurately, invalid/empty values block Save, and stepper changes remain visible while focused.
41. PDF page changes wait until the current interface update finishes: addresses the focused-overlay responder cycle identified in six physical build7 watchdogs.
42. Tool, drawing-policy and ink changes still reach the live canvas after navigation is deferred.
43. Selection Done stays above scrolling practice controls: narrow large-text actions reflow into two rows. iPad UI12 and Phone3 accessibility flows pass.
44. Visible sticky notes expose their text and real edit panel to accessibility tools. UI15 passes actual double/triple-tap editing and permission-denied recovery; final strict native crop/zoom checks pass after a test-only mounted-window fixture correction.
45. Short drawing windows reserve usable space for the tools; Cancel and Done stay separated and pinned. Phone3 portrait/landscape interaction and independent screenshot review pass, including the largest text size.

## Gates

- [x] Core/service/helper verification checkpoints: 406 core tests, 2,211 service assertions and 57 Python helper tests pass (exact run scope below).
- [x] Native hosted checkpoints: hosted9 executes241; UI6/Phone1 execute242; iPad UI12 executes243, each with1 live-account skip and0 failures. These are dated source checkpoints, not verification of later edits.
- [x] Scoped native iPad score-continuity/palette/practice/markup interactions, two-finger Undo/Redo and double-tap rename pass in UI5.
- [x] Scoped movement edit/validation/steppers/list/grid/page targeting passes in UI6; exact 72→88 goal/Left hand/Start/Clean/Undo passes in UI7. Warmup Finish and tempo cancellation passes remain in the earlier run table.
- [x] Actual sticky drag/double-tap/edit/relaunch passes UI12 (52.404 seconds); physical acceptance remains separate.
- [x] Repaired iPad accessibility portrait/landscape passes UI12 (67.236 seconds).
- [x] Phone2 correct actual passage rename passes52.388s; selection Done is reachable in both orientations. The complete accessibility case fails later in annotation and remains below.
- [x] Phone3 actual accessibility portrait/landscape passes71.631s on the UI13 binary; four screenshots pass independent review. This verifies the short-writing layout, not the subsequent note-accessibility patch.
- [x] UI14 complete actual sticky create/hold-drag/double-tap-edit/relaunch/triple-tap/permission-denied recovery passes71.060s.
- [x] UI15 repeats the complete actual sticky triple-tap/recovery flow successfully in59.539s on the current production source.
- [x] Final native run:245 executed/1 live-account skip/0 failures in16.881s (exit0). The test-only mounted-scene correction explicitly proves overlay.window identity before the strict crop/zoom transform checks; production is unchanged from UI15.
- [x] Scoped phone + iPad portrait/landscape accessibility reachability: iPad UI12 and Phone3 pass; later production changes concern note accessibility geometry and retain UI15 actual touch coverage.
- [x] Independent source and scoped screenshot/interaction review pass; source is frozen. This is not a full physical or week-long acceptance claim.
- [ ] Signed device Release and fixture exclusion: first two attempts stop before compilation with Xcode No Accounts / No Profiles; user-confirmed sign-in restored, final signed build running.
- [ ] Connected device, valid signing and fresh complete pre-install owned-file backup. The device is connected; current signing/profile checks and fresh backup remain pending.
- [ ] Same-bundle installation and exact complete post-install filename/size/SHA-256 comparison.
- [ ] Launch/readback.
- [ ] Physical Pencil, microphone, interruptions, large real score and sustained practice acceptance.

## Evidence and limitations

Initial read-only device status on October9 found no connected device; reconnection and installed-build7
readback subsequently succeeded. Build8 is not installed. Prior build7 profile expiry is historical;
actual current signing must be checked before installation. Mac application/data stay unchanged.

Two signed device Release attempts stop before compilation with Xcode `No Accounts` / `No Profiles`.
Xcode Settings → Apple Accounts confirmed it was signed out. The user now confirms sign-in, and the
final signed device Release is running. No credentials were obtained and no new account or certificate
was created. The prior profile backup is safely archived. Signing/profile checks and installation
remain pending. Build7 remains installed and unchanged; no build8 installation has occurred.

Verification checkpoints include406 core tests,2,211 deterministic service assertions and57
Python helper tests. Phone1 completes242 native tests with1 live-account skip/0 failures; three
of four UI cases pass, with accessibility selection Done failing on its earlier source. Repaired
iPad UI12 completes243 native/1 skip/0 failures and both executed UI cases pass: actual sticky
drag/double-tap/edit/relaunch and accessibility portrait/landscape. UI12 did not execute passage
rename because its requested selector was incorrect. Phone2 passes the correct actual rename
test52.388s and reaches selection Done in both orientations, then fails landscape annotation
with a3-pixel tool viewport. UI13 completes244 native tests with1 live-account skip and2 assertion
failures in one new note-accessibility frame case. Its actual sticky test passes the earlier
create/drag/double-tap-edit/relaunch assertions, then fails because the new triple-tap accessibility
target is missing; the complete UI case does not pass. A minimal public-API repair for dynamic
screen frames and visible attached overlay traversal is frozen, but its next native run has not
occurred at that checkpoint. Phone3 now passes the existing UI13 binary's actual accessibility
portrait/landscape flow in71.631s (exit0), including the short-writing footer/header/spacing repair.
Independent review accepts all four screenshots: Cancel/Done are separated and pinned, all six tools,
finger drawing, Undo/Redo and colors have a usable landscape viewport, and lower tools/practice
controls scroll at the largest text size. The later accessibility patch passes independent source
review, including hidden-parent guards, and test-build9. UI14 passes the complete actual sticky
create/hold-drag/double-tap-edit/relaunch/triple-tap/permission-denied recovery case in71.060s.
Its native suite executes245 tests/1 live-account skip but retains two assertions in one zoom-frame
case: the screen-coordinate helper returns an unscaled frame. All other cases pass, including PDF
accessibility publication and hidden-wrapper guards. An explicit view→window→screen conversion
repair kept the strict assertions for the later native rerun; UI14 is not an aggregate pass.
UI15 repeats the actual complete sticky triple-tap/recovery flow successfully in59.539s, but
native245/1 live-account skip retains two frame assertions in one case, now with a zero frame.
A detached fixture is suspected. The test now asynchronously mounts a real UIWindowScene/window
and explicitly asserts overlay.window identity before the transform. Production is unchanged from
the successful UI15 actual gesture flow; only the test fixture changed for the final native rerun.
That final run now passes245 tests with1 live-account skip and0 failures in16.881s (exit0),
including the explicit mounted-window identity and strict crop/zoom frame assertions. Independent
source and scoped layout review pass; source is frozen. Failed UI13–15 native runs remain failures.
Earlier failures and the cleared UI4 stale-runner issue
remain below. Idle ink preparation runs off the UI thread; final atomic writes and explicit
transition fallback remain synchronous. Worst-case large-library latency still needs physical
measurement.

The retained October6 local simulator crash is an Array bounds trap in MetronomePulseGrid.beatButton.
Build7's stable captured accent addresses that specific source path. It is not evidence for the
newly reported physical microphone crash. Current-device diagnostics became available after reconnection below.

### October9 device evidence and intermediate verification

The user reconnected the iPad. CoreDevice's list retained an inactive on-demand tunnel while
an explicit details request successfully connected to the same wired device. The deployment
helper now probes only an explicitly named unique device, rejects changed identities, then
applies its existing selection/readiness checks. Three safety regressions pass; 57 helper tests
pass. Read-only status confirms installed 2.0.0/build7. No installation occurred at this stage.

A separate read-only preflight backup verifies 13 owned files / 12,788,247 bytes. The schema5
ledger is revision2079, with6 pieces,51 passages,50 historical sets,31 sessions and255 ink rows;
there is no active set. These are observations, not synthetic acceptance writes. The complete
private backup remains outside Git. The later guarded refresh must take a fresh backup again.

Six actual build7 crash reports (three each from October7 and October9) and a90-second CPU-overuse
report were retrieved from the iPad. [Matching-dSYM analysis](crash-analysis.md) identifies a SwiftUI responder/AttributeGraph cycle at
synchronous `PDFView.go(to:)` inside `PagedScoreView.updateUIView`. Deferred/coalesced
reconfiguration and teardown with explicit dependency observation now pass hosted9, including
focused-canvas navigation, document/mode changes and failed-checkpoint refusal. Final touch-flow
and physical acceptance remain open. These reports do not establish a microphone or JSON-save cause.

Intermediate runs remain recorded rather than being replaced by final pass counts:

| Run | Result and follow-up |
| --- | --- |
| Core final2 / receipt rerun |406 core tests pass;2,211 deterministic service assertions pass before the receipt-only API change;406 core tests pass again with the receipt API. |
| Hosted1–4 | Build failures: UI query compile typo; Swift6 IRGen crash with a bound-method setter (changed to closure); ambiguous numeric infinity; overcomplex test expression. All repaired before execution. |
| Hosted5 |228 execute,1 skipped,11 assertions fail across3 tests: PencilKit clamps fine width and native responder behavior differed from old assumptions. Actual SDK width range and native responder handoff replace those assumptions. |
| Hosted6 | Build failure: wrong imported PencilKit width API. Corrected using the installed SDK's `InkType.pen.validWidthRange`. |
| Hosted7 |236 execute,1 skipped,1 failure: zoomed swipe suppression test. Async race tests, width separation, responder transitions, voice lifecycle and crop-preserving note moves pass. The later repair loads an actual PDF before setting scale; PDFKit ignores scale changes without a document. |
| iPad UI1 |9 execute;6 pass,3 fail. Actual two-finger Undo/Redo, passage double-tap rename/relaunch, repeated Done during practice, invalid tempo cancellation, direct rename and warmup Finish pass. Exact-tempo typing exposed caret insertion before old digits; native select-all fixes it. Movement test targeted a disabled scoreless row; selector corrected. Palette-collapse assertion raced its animation; bounded state wait added. |
| iPad UI2 |12 execute;10 pass,2 fail. Exact72 BPM now applies. Goal test selected Start because it used a global numeric index; explicit Start/Goal identifiers now distinguish them. Movement page input exposes a small22-point field/focus problem; actual44-point fields and adjacent steppers replace that layout. Palette movement/minimization, portrait/landscape/portrait, selection Done, practice while drawing, two-finger Undo/Redo and rename/relaunch pass. |
| Hosted8 |241 execute,1 skipped,3 failures. All6 async save/lasso and6 voice safety cases pass. Deferred rendering lost SwiftUI dependency tracking for markup and callback-backed page state: the focused-navigation regression and both existing finger-input policy tests catch this. Explicit observation and layout-aware assertions repaired these findings before hosted9; these failures were not accepted as test timing noise. |
| Hosted9 |241 execute,1 live-account skipped,0 failures. Focused navigation/coalescing/failed-checkpoint refusal, explicit tool/ink observation, full-hierarchy routing, async persistence and audio lifecycle regressions pass. |
| iPad UI3 | Interrupted after toolbar parent accessibility identifiers propagated to children and movement numeric entry appended to existing digits (21 instead of2). Both have source repairs: individual tool identifiers and shared select-all numeric drafts with invalid-page Save guards. No complete aggregate pass is claimed. |
| iPad UI4 | Untrusted current-candidate coverage: the running process loaded an old XCTest bundle from a simulator cache (935,824 bytes), while the newly installed/product bundle is951,072 bytes. Obsolete goal/tool queries and zero execution of the new sticky-note test agree with that binary mismatch. The isolated simulator was restarted and the app/runner explicitly installed; UI5 verified the current loaded test binary before its replay. Do not infer a source regression or pass from this stale test run. |

### Final touch follow-up

| Run | Result and follow-up |
| --- | --- |
| iPad UI5 | Current loaded runner verified against built SHA-256.10 execute;7 pass,3 fail. Two-finger Undo/Redo, double-tap rename/relaunch, all3 stamp/large-text cases and both continuity/moving-palette cases pass. Sticky hold-drag missed the chip after the recognition threshold; original-touch/full-translation routing and readonly-mode regression added. Movement test used the wrong native Stepper child identifier; observed increment/decrement identifiers replace it without changing the assertions. Tempo goal exposed duplicate accessibility elements inherited by the BPM overlay; the numeric control now exposes one adjustable element. Later UI6/UI7 scopes below record those retries; the first sticky repair did not pass actual touch replay. |
| iPad UI6 | Full native suite:242 execute,1 live-account skipped,0 failures. Complete movement typing, empty/zero/invalid-input refusal, focused stepper updates, list/grid entries and correct source-page opening pass. Sticky touch still fails; hosted/source success is not counted as actual gesture acceptance. |
| iPad UI7 | Exact72→88 BPM goal with Left hand, Start/Clean/Undo passes. Largest-text portrait/landscape passes with explicit header glyph fonts. Sticky touch fails again; actual trace exposes UIKit resetting pan translation and overlay single-tap competition with parent double/triple taps. |
| iPad UI8 |13 selected native tests pass (10 AnnotationInteraction and3 FocusedPDFNavigation). Actual sticky hold-drag reaches the requested destination with its full source size preserved; the unchanged UI test fails because double-tapping the moved note does not open the editor. Drag evidence does not close the complete sticky workflow. |
| iPad UI9 |2 UI cases execute: exact goal/hands/Start/Clean/Undo passes; sticky editing fails again at the moved-note opening assertion. The goal sheet uses its large detent and compact practice context exposes the full goal. Independent visual review accepts the goal-editor and active-goal screenshots. |
| iPad UI10 | Annotate tap did not reveal the palette; the run did not reach complete sticky interaction. No sticky pass or new physical inference. |
| iPad UI11 | Unchanged scenario reached moved-note editing failure again. Trace identifies the winning one-tap recognizer. Local note multi-tap ownership source repair subsequently passes the complete sticky scenario in UI12; this failed run remains retained. |
| Phone1 | Complete native suite242 execute,1 live-account skipped,0 failures. Four UI cases: goal, warmup Finish and repeated Done/ink relaunch pass; accessibility-size selection Done fails. `ScoreWorkspace` repair pins selection tools outside the scrolling practice dock within the existing60% combined height budget and reflows narrow large-text actions into two rows; independent source review and later iPad UI12 pass. Phone2 reaches selection Done both ways, then fails on the separate annotation viewport issue. |
| iPad UI12 | Complete native suite243 execute,1 live-account skipped,0 failures. Both executed UI cases pass: actual sticky drag/double-tap/edit/relaunch52.404s; accessibility portrait/landscape67.236s. The requested passage-rename selector was incorrect and that test did not execute; do not count a rename pass in this run. These results precede later note-accessibility/triple-tap additions. |
| Phone2 |2 UI cases complete: actual `testActualDoubleTapSelectedPassageOpensRenameAndPersists` passes52.388s; accessibility fails later in landscape annotation, after selection Done is reachable in both orientations. Tool viewport is3 pixels, score63/footer202 of337 workspace. Source repair caps footer at30% only for short writing, retains60% otherwise, fits header title at13 points beside44-point icons, and leaves tool-body Dynamic Type active. Cancel/Done gain12-point spacing and6-point padding each. Independent source review passed; later Phone3 replay passes below. |
| iPad UI13 | Completes244 native tests with1 live-account skip and2 assertion failures in one new note-accessibility frame case. The actual sticky case passes its earlier create/drag/double-tap-edit/relaunch assertions, then fails because the new actual triple-tap accessibility target is missing; no complete UI pass. A subsequent minimal public-API patch computes note screen frames dynamically and appends visible, attached overlay accessibility containers to the PDF's native traversal. That patch was frozen but unverified at this boundary; its later245-test run is recorded as UI14 below. |
| Phone3 | Exit0; actual accessibility portrait/landscape passes71.631s on the UI13 binary. Selection escape, the30% short-writing footer,13-point palette header and separated Cancel/Done controls pass; independent review accepts all four screenshots. All six tools, finger toggle, Undo/Redo and colors are visible in the landscape tool body, with lower controls/practice scrollable at the largest text size. This binary predates the subsequent note-accessibility repair. |
| Test-build9 / iPad UI14 | Test build and independent accessibility source review pass, including hidden-parent guards. Actual complete sticky create/hold-drag/double-tap-edit/relaunch/triple-tap/permission-denied recovery passes71.060s. Native245/1 live-account skip retains2 zoom-frame assertions in one case; all other cases pass, including PDF accessibility publication/hidden-wrapper guards. The helper returns an unscaled120×216 frame instead of the transformed screen frame. The aggregate fails. A narrow explicit view→window→screen conversion repair retained the strict assertions for the subsequent run. |
| iPad UI15 | Actual complete sticky triple-tap/recovery passes59.539s. Native245/1 live-account skip still has2 frame assertion failures in one case, now returning a zero frame. The aggregate fails; a detached fixture is suspected. The subsequent test-only correction asynchronously mounts a real UIWindowScene/window and asserts overlay.window identity before the transform. Production is unchanged from this actual UI pass; the final passing native rerun is recorded below. |
| Signed device Release attempts1–2 | Both fail before compilation: Xcode No Accounts / No Profiles. Actual Xcode Apple Accounts settings confirms signed-out state; the user has been asked to sign into the same original account. No credentials, new account or certificate changes; prior profile backup safely archived. No build8 install and no change to installed build7. |
| Final native | Exit0;245 executed/1 live-account skip/0 failures in16.881s. The test-only async mounted-scene/window fixture explicitly asserts overlay.window identity before the unchanged strict crop/zoom checks. Same production source as successful actual UI15. Local evidence: `/tmp/praelude-build8-native-final.log`. |
| Final signed device Release | User confirms restored sign-in; build is running. Signing/profile/fixture-exclusion result and installation remain pending. Earlier No Accounts / No Profiles failures stay recorded above. |

Local full run logs and result bundles use `/tmp/praelude-build8-*`; raw device diagnostics,
personal content and complete backups are deliberately excluded from Git.

The UI4 application binary matched the new product, but the running XCTest bundle did not.
The loaded bundle came from CoreSimulator's removed-container cache (935,824 bytes); the built
and installed test bundle was951,072 bytes. Its old selectors and absent sticky test therefore
cannot establish current-test coverage. A complete simulator restart and explicit replacement of
only its disposable test runner cleared that cache. UI5 records a loaded-test-binary SHA-256 of
`368b82281d64e987974e75b03648d4666e329be05b9920feb8a91d4f28240a28`, exactly matching the product.
No physical-device application was removed or terminated.

UI4 also exposed a real application layout issue: the palette retained its initial160-point
content height after switching to the229-point stamp controls, clipping Size and Place. Direct
geometry observation replaces the ineffective preference propagation; UI5 passes actual
slider growth/shrink and confirmed placement, tool changes and rotation. Largest-text
portrait/landscape also passes in UI7 after explicit header glyph sizing. Single-movement
wording now uses the singular form.

### Saved simulator screenshots

These fixture screenshots document the scoped layouts above; they do not establish physical
Pencil/audio behavior or sustained-use acceptance.

| Flow | Evidence |
| --- | --- |
| Tempo and goal | [Numeric entry](screenshots/ipad-exact-tempo-entry.png), [goal editor](screenshots/ipad-tempo-goal-editor.png), [active goal](screenshots/ipad-active-tempo-goal.png) |
| Annotation palette | [Minimized](screenshots/ipad-minimized-palette.png), [stamp sizing](screenshots/ipad-stamp-sizing.png) |
| Largest text | [Portrait](screenshots/ipad-accessibility-palette-portrait.png), [landscape](screenshots/ipad-accessibility-palette-landscape.png) |
| Phone3 largest text — independently accepted | [Selection portrait](screenshots/phone-accessibility-selection-portrait.png), [selection landscape](screenshots/phone-accessibility-selection-landscape.png), [palette portrait](screenshots/phone-accessibility-palette-portrait.png), [palette landscape](screenshots/phone-accessibility-palette-landscape.png) |
| Movement organization | [List](screenshots/ipad-movement-list.png), [grid](screenshots/ipad-movement-grid.png), [scoped score](screenshots/ipad-movement-score.png) |

**Next steps:** complete and validate the running signed device Release after user-confirmed sign-in. Then perform the guarded same-bundle refresh with a fresh complete backup and exact pre/post file comparison, followed by launch/readback. Build7 remains physically installed at this checkpoint. Physical Pencil/audio/interruption/large-score and sustained-use acceptance remain separate.
