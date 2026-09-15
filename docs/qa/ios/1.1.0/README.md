# Native mobile 1.1.0 acceptance

**2026-09-14 · 1.1.0/build2 DEVELOPMENT CANDIDATE · schema2 · scoped simulator/build verification complete.**
The final frozen-source signed Release and its preserved copy are verified. The physical iPad
still reports **1.0.0/build1**; complete PDF backup access remains blocked, so no 1.1 installation
or hardware feature acceptance is claimed. Mac v11.1.0/schema21 application/data are unchanged.

The [1.0 ledger](../README.md#historical-10-candidate-evidence) and its manifests/screenshots remain
historical evidence. Passing 1.0 checks are not silently counted as current 1.1 regression passes.

## Scope and current gates

This candidate adds visual passage boxes with optional measure labels and original-target history,
editable PencilKit ink, a separate annotated-PDF sharing/printing copy, stronger score navigation
and unsaved-edit protections, expanded meter/accents/sounds, and reward feedback after durable
practice writes. Native schema2 migration preserves the original schema1 ledger. The mobile folder
also has its own developer context, workspace tasks and explicit data-preserving Personal Team
install/refresh helper. See [current usage](../../../../ios/docs/USING_MOBILE.md),
[development](../../../../ios/docs/DEVELOPMENT.md), and
[installation](../../../../ios/docs/INSTALL_ON_IPAD.md).

| Gate | Current evidence |
| --- | --- |
| Foundation core | 29 passed; `praelude-mobile11-core-services.log` |
| Deterministic services | 2,166 voice/metronome/tap-tempo/reward/PCM assertions passed in the same log |
| Deployment helper | 28 fake-device safety tests passed; no install is performed by these tests |
| Native app-hosted tests | **36/36 pass on each simulator**: `praelude-mobile11-ipad8.xcresult` and `praelude-mobile11-phone3.xcresult` |
| iPad passage UI | `ipad7` passed box selection/edit/Done/relaunch (65.090 s); the earlier `touchdiag` case also passed (72.764 s) |
| iPad finger-ink persistence UI | Final-toolbar `ipad9` passes (59.497 s): enter writing, enable finger drawing, stroke, Undo/Redo, Done and retained ink after relaunch |
| Live ink visibility | Newer `ipad7` pre-Undo capture visibly shows the stroke, independently reviewed; the earlier `ipad6` blank image remains unexplained. Phone3 pre-Undo/after-Redo ink is visible after gesture arbitration; Phone4 final-toolbar checks also pass (finger 91.652 s, meter 84.624 s) |
| iPad markup at accessibility text sizes | `ipad7` portrait/landscape case passed (50.594 s) |
| Metronome controls and Focus UI | Final-toolbar `ipad9` passes meter (61.653 s) and Focus pinch (23.719 s) after corrected offscreen-control guards |
| Earned-feedback visual | Independent native video review verifies a short visible Clean 1-of-5 response without obscuring controls; audio/haptics are separate |
| iPad latest selected UI | **`ipad9` passes 3/3**: finger, meter and Focus. `ipad7` supplies boxes and accessibility markup; five targeted 1.1 iPad scenarios pass across runs |
| iPhone 1.1 hosted/UI regression | `phone3.xcresult`: **36/36 hosted + 3/3 selected UI pass**: finger 52.960 s, backup 62.827 s, Focus 24.024 s. Phone2 supplies boxes, accessibility markup, meter/feedback and accessibility practice passes; seven distinct scenarios pass across runs; `phone4` final-toolbar finger 91.652 s/meter 84.624 s also passes 2/2 |
| 1.1 signed Release and fixture exclusion | **Final frozen-source build passed**; [sanitized manifest](signed-release.json). Stable inputs, signature/profile/fixture checks, and all preserved app file hashes verified |
| Physical pre-update backup | Ledger can be copied, but full backup still fails reading the app-owned PDF; no complete native copy/hash acceptance |
| Physical 1.1 install/launch/feature acceptance | Not performed/accepted; the existing 1.0 app and its data remain in place |

The `ipad3` result bundle as a whole is **failed: 35 passed / 1 failed**. Its 35 app-hosted tests
pass; the additional finger-ink UI case failed. The `touchdiag` UI group is also **failed: one
case passed and one failed**. `ipad6` passed only finger-ink persistence; its accessibility, boxes
and metronome cases failed. These remain failed runs. `ipad7` completed four passes and one
metronome harness failure. `ipad8` passes 36 hosted and Focus 29.081 s but fails finger entry and
Reset-control virtualization. The later `ipad9` selected suite passes 3/3. Phone2 had 35 hosted/5 UI
passes with two failed UI cases; Phone3 passes 36 hosted plus 3 selected UI. These scoped successes
do not turn the earlier bundles green or establish one all-green full-scheme run. Physical Pencil
rendering and current device acceptance remain separate.

## Native app-hosted coverage

| Native group | Passed | Coverage |
| --- | --- | --- |
| NativeLibraryFilesTests | 17 | Real PDF import, schema1 backup compatibility, markup/snapshot/PDF backup roundtrip, invalid resource rejection, damaged ink, replacement guards and recovery |
| ScoreMarkupTests | 6 | Bounded normalized boxes, crop/rotation alignment, ink conflict choices, failed-save retention, page eviction and selection undo/redo |
| FullPDFHitRoutingTests | 2 | Actual hosted PDF hierarchy routes selection/finger ink; the added phone-sized case preserves reading navigation and pinch across ink modes |
| PendingInkLifecycleTests | 3 | Failed ink survives coordinator teardown, reused views flush the old piece before switching callbacks, empty-baseline cleanup |
| RuntimeFeedbackTests | 5 | Save-before-feedback, duplicate/reopen silence, failed-save retry, undo/reset behavior and safe persisted metronome settings |
| ScoreExportTests | 3 | Ink alignment for rotated/cropped/offset pages, searchable/vector source content, no practice-box export, unique copies and original preservation |

Phone3 and iPad8 each pass all 36 hosted tests, including the added navigation/pinch case. These
execute native PDFKit/PencilKit/UIKit/SwiftUI hosting, rather than a browser mock. They do not prove that an actual Pencil, printer, audio route, or every SwiftUI touch gesture works on
physical hardware. Share-sheet/Print presentation still needs corresponding UI/device evidence.

## UI and visual review so far

The passing passage case draws three boxes across two pages, removes/undoes a box, moves/edits,
saves with Done, and confirms the passage after relaunch. Its independently reviewed iPad PNGs
show crisp notation through restrained translucent indigo boxes, visible selection handles,
clear Cancel/Done/page controls, and uncomplicated native sheets. This is ordinary text size and
light appearance on an iPad simulator, not broad accessibility/contrast/hardware acceptance.

- [Passage selection](screenshots/ipad-passage-selection.png): two boxes during selection; the
  active box has corner handles and the notation remains readable.
- [Saved passages](screenshots/ipad-saved-passages.png): saved three-box/two-page target and native
  passage sheet. The updated `ipad4` capture shows the target union with padding at a useful
  preview size; the measure-only legacy passage retains its whole-page preview.
- [Earned Clean feedback](screenshots/ipad-earned-feedback.png): the actual simulator video frame
  at 28.25 s shows Clean, 1 of 5 above the practice controls. Independent video review found no
  feedback at 27.75 s, visible feedback at 28.0–28.5 s, and none at 29.0 s. The notation and verdict
  controls stay readable; this is visual timing evidence, not an audio/haptic quality verdict.

Passage selection comes from `touchdiag`; the updated saved-passages image comes from `ipad4`.
These and the earned-feedback video frame contain only the original synthetic notation fixture,
not personal repertoire or practice history. They do not establish live ink or full-suite acceptance.

Current additional captures include [iPad live ink](screenshots/ipad-live-ink.png),
[ink after relaunch](screenshots/ipad-ink-after-relaunch.png),
[iPhone live ink](screenshots/iphone-live-ink.png),
[iPhone ink after relaunch](screenshots/iphone-ink-after-relaunch.png),
[iPad accessibility selection](screenshots/ipad-accessible-selection-landscape.png),
[iPhone accessibility selection](screenshots/iphone-accessible-selection-landscape.png),
[iPhone dark practice](screenshots/iphone-dark-practice.png),
[phone backup exporter](screenshots/iphone-backup-exporter.png), and
[iPad custom metronome](screenshots/ipad-custom-metronome.png) and
[iPhone custom metronome](screenshots/iphone-custom-metronome.png). Live-ink/relaunch/metronome
images use final-toolbar iPad9/Phone4 captures. These are native simulator captures of
synthetic data. They document their particular states, not physical-device acceptance.

## Findings and corrections retained as evidence

- Initial emitted-code compilation found main-actor/protocol isolation and UIKit override issues.
  Those compile errors were fixed before the later native hosted run; a preliminary source review
  alone was insufficient.
- Native invalid-ink testing found that decoding arbitrary nonempty data can produce an empty
  PencilKit drawing instead of throwing. The native save/export/restore boundaries now require
  readable strokes and preserve the original library on rejection; the hosted regression passes.
- PencilKit may normalize its encoded representation when a drawing enters/leaves a canvas.
  Early canvas tests wrongly equated separately encoded byte buffers. Reopen/conflict tests now
  compare stroke geometry, tool, color, transform and point attributes; raw backup transport still
  requires byte-identical stored ink/PDF data. Those current hosted tests pass.
- The first annotated-export test assumed a literal source string's token order. PDFKit extracted
  the original fixture differently, causing five text assertions to fail while ink geometry passed.
  The corrected test compares export text with the actual source extraction; all three export
  tests now pass, including alignment and source-preservation assertions.
- Early synthesized UI touches failed to reach the intended drawing control. The successful
  `touchdiag` passage case provides actual event/retained-state evidence; native hosted hit-routing
  also passes. This does not make the separate finger-ink case pass.
- In `ipad3`, the finger-drawing query matched a full-width SwiftUI switch container. Its center
  was empty space; the actual trailing switch still had value 0. The next harness targets the
  visible switch and requires enabled state before drawing. The later `ipad6` finger-ink case
  passes at 75.043 s, including Undo/Redo and retained ink after relaunch. The earlier failed case
  remains failed rather than being reclassified as acceptance.
- `ipad6` accessibility testing queried a virtualized offscreen List row. The harness now scrolls
  to that row; `ipad7` passes markup at accessibility text sizes in portrait and landscape.
  The `ipad6` boxes case did not open its final sheet; waiting for PDF/layout readiness before the
  action precedes the later `ipad7` pass, without claiming every earlier input failure had one cause.
- The earlier metronome test expected Beat 2 to be regular even though its saved value was Silent.
  The revised harness uses Reset accents before asserting the sequence. Its `ipad7` followup then
  overscrolled Reset/Beat 7 behind the navigation region. The next harness bounds its swipes within
  the form body and explicitly reveals Beat 7. iPad9 meter/feedback passes in 61.653 s.
- **Live-ink evidence is qualified by the actual capture.** The `ipad6` pre-Undo image has no
  visible line while the post-relaunch image shows it. The newer `ipad7` pre-Undo image clearly
  contains a black stroke, independently reviewed. The older blank capture's cause is unexplained;
  it is not proof of a persistent iPad rendering defect. On `phone2`, the actual drawing contained
  zero strokes. PDF pan now waits for the canvas drawing recognizer; `phone3` finger persistence,
  Undo/Redo and relaunch pass (52.960 s); its visible ink is independently reviewed. iPad9 also
  passes on the corrected source. Phone4 final-toolbar checks also pass; physical Pencil precision remains open.
- `ipad8` finger testing stopped before drawing: a centered press on Annotate did not enter the
  writing surface, and the toolbar image frame measured 40×36 points. Close, Annotate, Metronome
  and Options now have explicit 44×44 frames and rectangular hit regions. The still-running
  `ipad8` checks use the earlier toolbar snapshot. The final-toolbar iPad9 finger case passes
  in 59.497 s, including entry and persistence; Phone4 also passes on the same toolbar: finger 91.652 s and meter 84.624 s.
  This records actual entry behavior rather than treating frame size alone as acceptance.
- `phone2` backup testing selected an inactive zero-frame Settings element. The filtered harness
  uses the visible control; `phone3` exporter/restore-picker flow passes (62.827 s), closing the
  historical complete-phone-backup UI gap with simulator evidence. No production backup routing
  change or manual/physical acceptance is inferred.
- Independent visual review identified an unhelpfully small whole-page saved-target thumbnail.
  The updated `ipad4` capture verifies that cropping to the target union with padding makes the
  marked staves recognizable while retaining readable notation and the clean native sheet. This
  visual result covers ordinary text size on an iPad simulator.
- Unsaved box navigation, failed ink writes, multiwindow conflict handling and pending ink through
  adaptive view teardown have explicit source guards. Hosted lifecycle/failed-save tests pass;
  end-to-end iPhone/iPad view-transition checks remain part of the pending UI/device work.

## Final signed Release artifact

The final two-job generic-device build passes using the existing ignored Personal Team configuration,
without a CLI team override. It produces **1.1.0/build2**, native schema2, **arm64**, minimum **iOS 17**,
for both phone and tablet. Production inputs and local signing stayed stable throughout compilation.
Source was a dirty working tree at `7e8793e63ae2e47c93147de0f3d146491f774160`; the manifest records the
41-input digest and 32 Swift-source digest instead of attributing uncommitted changes to that commit.

`codesign --verify --deep --strict` passes. Signed application/team/development entitlements match
the profile and local configuration. The profile includes the previously observed iPad and expires
**2026-09-21 at 21:24:58 UTC**; no device query was made during verification. Release excludes UI-test/
seed fixture flags and test plug-ins. Executable SHA-256:
`f472faa3ddc85949bc9b3c4ab5d1734a2dd19ff42c00328307e9b5a2ee58dd12`.
Production-input SHA-256: `8e10d539cf46aa5d6c244bf8dc1f90b5be3325509d4778c1989d2b88c6d83cf2`.

The final app is preserved at ignored `releases/ios-personal-1.1.0/Praelude.app`. All nine files match
the build product byte for byte, and its copied signature verifies. Private logs, source/file hashes
and verification records sit beside it. The [public manifest](signed-release.json) excludes personal
account/team/device identifiers. The older signed 1.0 complete file tree is unchanged; the prior 1.1
snapshot is retained privately. Early provisional builds overlapped or preceded later source changes;
the final stable repeat includes the gesture/toolbar corrections. Root independently reverified the
signature, executable hash, version/PlugIns exclusion and all 32 current Swift source bytes. No device
query, install, launch or backup retry was performed while preparing the artifact.

The exact build command is recorded in the manifest; its portable form is:

```sh
xcodebuild -project ios/Praelude.xcodeproj -scheme Praelude \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath /private/tmp/praelude-mobile11-signed-release-UNIQUE/DerivedData \
  -jobs 2 -allowProvisioningUpdates build
```

## Physical device and deployment helper

Read-only devicectl queries confirm the existing 1.0 app's data container contains a schema1
ledger and one PDF. A single-ledger copy succeeds and its active set is absent. Full directory
copy fails at the PDF with CoreDevice error 7000 / underlying POSIX error 1, although its metadata
says readable/0644/non-symlink. The last authorized one-time retry also failed; no automatic repeat,
install, launch or termination followed. Device unlock/protected-file access remains unresolved;
the cause is not claimed proven from the lock-state flags alone.

The helper therefore stops before building/installing an update. Complete backups and hashes
stay in ignored private local folders under `releases/ios-device-backups/`; no personal score,
ledger, account, team or device identifier is committed. Fake-device tests cover refusal of running
sets, changed ledgers, bad profiles, missing devices, failed copies and fixture-bearing binaries.
Independent review found that the first post-install check compared only the ledger and would
miss PDF-only loss or mutation. The helper now makes its second full copy after the installed
version is confirmed and compares every saved file name, byte count and SHA-256 before launch.
All 28 fake tests pass, including same-size PDF mutation, PDF deletion, post-install copy failure
and unexpected files in an initially empty library. The success path requires exactly two full
copies in the correct pre/post-install order. Any mismatch leaves the backups intact and reports
installed-but-unverified status; no automatic launch, restore or uninstall follows.
No fake test or signed-app preparation is a substitute for real full backup verification.

## Remaining acceptance

Scoped iPad9/Phone3/Phone4 checks and the final signed build pass. Earlier failed bundles remain
failed; these results are not one all-green full-scheme run. Obtain complete protected-PDF backup
access before any update, then verify installed version and full pre/post file preservation before
launch/migration acceptance. No third backup probe or 1.1 install has been performed.

Physical Pencil input/precision, long-session audio, speech over an acoustic piano, interruptions,
VoiceOver, hardware keyboard/pedals, actual printing and provider-specific sharing remain their own
gates. The historical complete iPhone backup UI gap is closed by the passing `phone3` simulator
flow; physical-device backup and the real full-copy preservation gate remain open.
Mac SQLite migration/sync, full Studio economy, advanced desktop practice policies/warmups/history
repair, Listen Back and cloud mapping remain separate scope. Assistant stays off/on hold. This is
neither a full forScore clone nor App Store/TestFlight shipment. B115 remains open.

**Next steps:** resolve the real complete-backup gate, then record any authorized update and
physical validation separately. Retain failed-run explanations and the precise simulator scope.
