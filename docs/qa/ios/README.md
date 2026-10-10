# Native iPhone/iPad candidate acceptance

## October 10 — build9 named physical interactions accepted

**Installed iPad: native2.0.0/build9/schema5 from `2de2444`. Launch/readback and named physical interactions pass. Broader acceptance remains scoped below. Mac:v11.1.0/schema21 unchanged.** On the iPad Pro12.9-inch (3rd generation, iPad8,5), iOS18.7.8, the prior build8 report was that the score cannot zoom while ink pans, Clean takes about one second, scrolling/menu/mode changes and warmup exit are delayed, passage selection updates about once every four seconds, and Pencil use crashes. These are physical observations, not accepted performance limits.

A45-second physical build8 Time Profiler capture records18.293 seconds of main-thread sampled CPU time, including12.276 seconds in `syncAll`. Instruments identifies14 hang/microhang intervals, the longest2.0187 seconds. The leading stack is `String(format:)` → `Data.praeludeHexLiteral` → `InkStrokeSyncRow` → `enqueueLibrarySnapshot` → scheduled `syncAll`. Inclusive samples overlap; hang duration is not measured touch-to-frame latency. These are build8 measurements, not evidence of build9 improvement. Sanitized evidence is `docs/qa/ios/2.0.0/build9/build8-physical-performance.json`.

Installed build9 source repairs: PDFKit owns page pan/zoom while the drawing canvas stays fixed; bounded app-owned drawing-value history replaces native tile Undo registrations; durable practice sync entries batch in parent-before-child order with debounced draining and account/revision-scoped snapshot reuse; a byte lookup replaces per-byte NSString formatting while retaining the existing hex wire format. Core412 and full native258 (1 live-account skip,0 failures) pass before the final gesture-priority change; two iPad practice/selection UI cases also pass. The earlier actual pinch failure is retained in QA. Undo now waits for the native pinch recognizer to fail and cannot recognize simultaneously. All14 targeted native interaction tests and fresh source review pass after that change. Actual UI5x pinch raises PDF scale to2.3177427145 from minimum1.0255516841 with the ink stroke retained; independent before/after pixel review accepts score/ink alignment and the settled palette. Actual two-finger Undo passes in Draw and reading. Two attempts to place the zoomed two-finger tap through XCTest fail because the target lies in a clipped viewport; this does not establish a production failure or a pass. The final gesture UI passes70.518 seconds: actual stroke, two-finger Undo in Draw/reading, Redo, mode change, strict real PDF pinch with unchanged ink, toolbar Undo/Redo at zoom, Done and saved ink after relaunch. Physical two-finger Undo at zoom remains pending. Source is frozen. Signed device build9 Release and strict app/profile/team/device/signer-trust and Release fixture/debug-exclusion checks pass. The same-bundle profile expires October16 at23:56:11 UTC (7:56 PM EDT). Independent signed-artifact verification and guarded installation also pass. Build9 is installed and running; independent post-launch preservation passes. On October10, the user confirms score pinch-zoom, Pencil marks → Done, two-finger Undo, passage selection and button response: “Those actions work and feel responsive.” These named interactions are user-accepted on source `2de2444`; measured latency, Undo specifically while zoomed, microphone/two-device behavior and sustained or week-long reliability remain unverified.

**Installed build9 checkpoint:** source `2de2444a782cb54a5cd31966ecc33257e4511dd0`, tag `ios-v2.0.0-build9-candidate`, is installed through the guarded same-bundle refresh. Independent review verifies all13 owned files/12,960,329 bytes identical by filename, size and SHA-256 before launch. Schema5/revision2167 retains6 pieces/53 passages/54 set IDs (53 historical plus1 paused active set)/35 sessions/317 attempts/259 ink records (202 active)/2 stamps/2 notes. The paused set is preserved; it is not a running set or an empty active slot. Actual post-helper Release signing/profile checks pass; expiry remains October16 at23:56:11 UTC (7:56 PM EDT). iOS denied automatic launch, then the user confirmed opening build9 and read-only process inspection confirmed it running. Independent complete post-launch readback at October10 00:57:50 UTC (October9 8:57:50 PM EDT) verifies the same13 files/12,960,329 bytes unchanged, schema5/revision2167 and every original record including the paused set. Undo specifically while zoomed and sustained practice remain unverified. Both build9 traces completed but were effectively idle: the45-second trace has12 all-thread samples/5 main-thread CPU milliseconds; the120-second trace has15 all-thread samples/8 main-thread samples (8 milliseconds). Neither reports potential hangs, but neither proves active score gestures or a speedup; foreground lifecycle is unknown. The October10 user confirmation accepts the named actions separately from these inconclusive traces. Evidence: `docs/qa/ios/2.0.0/build9/personal-ipad-install.json`.

**Next steps:** continue practice with the accepted interactions; separately verify combined zoomed Undo, microphone/two-device paths and sustained use. Capture active-use profiling if a latency issue recurs. Preserve the paused set and keep installation/preservation separate from physical acceptance. No week-long or zero-defect claim is supported.

Evidence and planned checks: `docs/qa/ios/2.0.0/build9/responsiveness-regressions.md`; the separate Undo repair ledger is `docs/qa/ios/2.0.0/build9/undo-repair.md`.

## Current installed build — October 9, 2026; physical failure open

Native source is **2.0.0/build8/schema5, INSTALLED — PHYSICAL FAILURE REPORTED**. The physical iPad now runs
build8; a confirmed native Undo crash remains under repair; the installed Mac remains v11.1.0/schema21. The [45-item usability review](2.0.0/build8/usability-review.md)
retains exact run scopes, failures, screenshots and open gates; [physical build7 crash analysis](2.0.0/build8/crash-analysis.md)
records the matching-dSYM PDFKit/SwiftUI responder-cycle evidence.

Final source verification:406 core tests,2,211 service assertions and57 helper tests pass.
The final native run executes245 tests/1 live-account skip/0 failures in16.881s. UI15 actual
sticky double/triple-tap and permission-denied recovery passes59.539s on the same production
source. Phone3 accessibility portrait/landscape passes71.631s with four accepted screenshots.
Source and scoped layout review pass; source is frozen. Earlier failed runs, the test-only
mounted-window fixture correction and all exact scopes remain in the45-item review.

**Installed build8 — physical Undo crash remains open:** native2.0.0/build8/schema5 from `a23cdec4f4f9acf42e8e5c724b6a386430dddca5` is installed. Independent review verifies all13 owned files/12,788,247 bytes unchanged by filename, size and SHA-256 before launch. Automatic launch was declined; the user opened the app. The23:59:40 UTC readback retains schema5/revision2086 (from2079),6 pieces/51 passages/50 sets/31 sessions/304 attempts/255 ink records (199 active)/2 stamps/2 notes. Original records remain exact except one piece page bookmark; profile/privacy/account/score data are exact. This readback precedes the23:59:53 UTC crash and is not post-crash retention proof. The user reported failure at19:59:56 EDT. Matching build8 dSYM identifies main-thread `EXC_BAD_ACCESS` at0x10 in `PKTiledView.performUndo` tile update, reached through the two-finger Undo action; this is distinct from the build7 PDF watchdog. Exact user sequence remains pending and the crash is unclosed. Signed Release checks pass, with profile valid through October16 at23:56:11 UTC (7:56 PM EDT). Sanitized evidence: `docs/qa/ios/2.0.0/build8/personal-ipad-install.json`. Mac v11.1.0/schema21 is unchanged.

**Next steps:** obtain the exact user sequence and reproduce the confirmed native two-finger Undo crash before accepting its repair. Keep the23:59:40 UTC readback separate from post-crash retention. Keep physical Pencil, microphone, large-score and sustained-use acceptance open; do not treat installation as task completion.
Release/signing and the guarded all-file-preserving update. Installation, launch/readback and
physical Pencil/audio/sustained-use acceptance must be recorded separately.

## Historical 1.1 candidate evidence

**Historical September14 candidate: [1.1.0/build2/schema2](1.1.0/README.md), scoped simulator/build verification
complete (2026-09-14).** Core29/services2,166/helper28 and 36 native hosted tests on each simulator
pass. Final-toolbar iPad9 passes 3/3 and Phone4 passes 2/2. iPad7 and Phone2/3 supply the remaining
scoped cases: five targeted iPad and seven distinct phone scenarios have passing evidence across
regressions. Phone3 closes the historical complete-phone-backup simulator UI gap. The final
frozen-source signed Release and all preserved app files verify. Earlier failed bundles remain
failed; no all-green full-scheme claim is made. **1.1.0/build2 is installed on the iPad as of
September 14 at 20:56 EDT**, after successful complete pre/post file preservation checks. Automatic
launch was denied; the user launch/trust step, migration and physical features remain unaccepted.
Earlier 20:50–20:52 EDT backup failures are retained as history in the versioned QA ledger.

Use the build8 review linked above for current candidate work; the versioned 1.1 ledger remains historical. The section below retains the 1.0 test results,
failures, manifests and installed-candidate boundary as historical evidence; they have not been
overwritten or promoted to 1.1 acceptance.

## Historical 1.0 candidate evidence

**2026-09-14 · native candidate 1.0.0/build1 · schema1.** This ledger covers the new
`ios/` target. It is not a Mac release or physical-device acceptance. Installed macOS
Praelude remains v11.1.0/schema21; no Mac application replacement or live-data migration
was performed.

## Reproducible environment

- Xcode 26.6, Swift 6.3.3, iOS SDK/simulator runtime 26.5, Apple Silicon host.
- iPhone 17 Pro simulator and iPad Air 11-inch (M3) simulator.
- Native deployment minimum: iOS/iPadOS 17.0. Both device families are declared.
- No third-party packages. SwiftUI, PDFKit, AVAudioEngine, Speech, and Foundation.
- Normal launches are blank. DEBUG UI tests use `--uitesting --reset --seed`, a separate
  test store, and an original generated four-page notation fixture. Screenshots contain
  no personal repertoire, scores, or practice records.

## Verification

| Gate | Result |
| --- | --- |
| Foundation package | 22 tests passed |
| Speech parser and generated metronome PCM | 2,041 deterministic assertions passed |
| Native Swift 6 complete concurrency compilation | Passed, including emitted code |
| Native app-hosted PDF/storage tests | 13 passed on each of iPhone and iPad |
| iPhone/iPad interface acceptance | All 8 distinct iPad scenarios and 7 of 8 phone scenarios passed across regression runs. Complete phone backup UI remains unaccepted; corrected maximum-text tests passed on both |
| Generic simulator app build | Passed |
| Release device build | Final source passed unsigned, arm64, iOS 17 minimum, iPhone and iPad families; exact artifact/source digests in [device-build.json](device-build.json) |
| Personal iPad installation | Free Personal Team Release signature passed; Developer Mode is enabled. Installation succeeded and the iPad reports 1.0.0/build1. First launch remains blocked by the device trust/security check. See [personal-ipad-install.json](personal-ipad-install.json). |
| Release fixture exclusion | `--uitesting` launch path absent from production executable |
| Existing desktop production build | Passed; existing chunk-size notice only |
| Git-backed project manual | Passed `npm run docs:sync` and `npm run docs:check`; the Markdown mirror is current. |

The native host tests exercise real PDFKit import, security-scoped source copying, metadata
persistence, source preservation, replacement recovery, invalid PDF rejection, backup roundtrip,
unsafe filenames, shared-resource consistency, failed-restore cleanup and active-set protection.
Core tests cover count semantics, variants, ladder transitions, undo, durable reopen, bounded
validation, damaged/future stores, and atomic failure behavior. These are actual implementation
tests, not a simulation of the SwiftUI app.

The UI suite exercises blank launch, paper-piece creation, score/page controls, metronome,
practice/corrections/completion/relaunch, native backup dialogs, dark mode, largest Dynamic Type,
rotation, active-tempo locking, both count bases, variant stage retention, and focus-mode pinch
zoom. The pinch check requires PDFKit's actual scale to increase while the page remains unchanged;
the corresponding native screenshots are independently inspected for crisp notation enlargement.
System Files selection and hardware-specific behavior have the limits below.

## Failures found and resolved during development

- Full Swift 6 compilation found actor/sendability errors that a preliminary typecheck had
  missed. Notification payloads now cross actor boundaries as explicit sendable context;
  timer invalidation stays outside isolated closures. Full emitted-code compilation passes.
- A narrow/large-text iPad sidebar could wrap navigation awkwardly. Accessibility text sizes
  now use full-width labeled tabs; ordinary iPad navigation uses native sidebar collapse,
  retaining the selected score through layout changes.
- Practice setup's primary Start action could scroll out of view. It now stays in a fixed
  bottom inset while optional form sections scroll. XCTest falsely reported occluded rows as
  hittable; the verifier now scrolls entire controls above the footer/keyboard before tapping.
- Backup export/restore presentations could compete with Settings. Settings now dismisses
  before opening the corresponding system document presentation.
- An unreadable library could export a misleading empty snapshot. Both export boundaries now
  reject this state. Explicit validated recovery copies the unreadable/future original to a
  unique `library-preserved-UUID.json`, verifies byte equality and only then replaces the library
  atomically. Copy/write failures keep the original and read-only protection. Four core tests
  cover recovery and injected failure paths; a native host case also restores PDF resources.
- A focus-mode touch layer blocked native gestures. Page-turn taps now coexist with PDFKit
  gestures. Subsequent screenshot review found no enlargement after an automated pinch despite
  valid native scale bounds. Raw XCTest events showed only about 11 points of movement per finger;
  the focused regression now uses a larger pinch, checks actual PDFKit scale and preserves native
  before/after screenshots. Focus6 passed with native scale **1.240418 → 2.869110 (2.31×)** on
  the same page and visibly enlarged notation. No custom pinch workaround was added. The fitted
  minimum/six-times maximum supports zoom through resizing.
- On this 8 GB host under memory pressure, the system backup exporter first appeared about
  65 seconds after the initiating tap. The original 8/30-second assertions failed although the
  exporter subsequently opened, canceled and allowed the restore picker to open. The final test
  gives the system service a bounded 90-second cold-start allowance; this is not a device-speed claim.
- Early UI runs included incorrect assumptions about collapsed sidebar and centered-sheet
  scrolling. Their failed artifacts are retained locally; no failed run is described as accepted.
- The first complete iPhone run passed all 13 hosted tests and 3 of 8 UI cases. Native Files
  appeared, but its phone export sheet had no Cancel **button**; a phantom accessibility Other
  named Cancel overlapped More. The harness now waits for the actual document browser root, dismisses via
  the real Cancel button when available or the phone sheet's native grabber, and verifies that
  the remote provider disappears. It never taps the phantom node.
- Handler traces showed intermittent loss of 50 ms synthesized touches. UI tests now issue
  single 150 ms presses and wait for actual presentation/dismissal state before continuing.
  There are no interaction retries or removed practice assertions. Duration alone was not
  sufficient in earlier runs; the complete phone regression remains unaccepted below.
- Settings now provides an explicit 44-point label/content shape and stable `appSettings`
  accessibility identifier. In the next phone run all three Settings actions were delivered,
  export opened and dismissed by the native sheet gesture, and Restore opened Files in Recents.
  The test still failed because it expected the exporter's Browse-specific identifier. Native
  logs and the accessibility tree proved that the importer was present; there was no UIKit
  presentation warning. The readiness/dismissal check now follows `DOC.browsingRoot Source:`
  for either Browse or Recents. Root UI tests stop after their first failed assertion instead
  of repeating dependent waits against a failed prerequisite.
- Independent screenshot review found a product defect missed by the original 44-point target
  checks: maximum-text iPhone landscape clipped verdict labels outside their backgrounds, while
  portrait controls consumed the score area. At accessibility sizes the practice controls now
  scroll within 60% of the available workspace (maximum 520 points), retaining the score above.
  Verdicts keep their full text size and intrinsic height, omit decorative symbols, and put Clean
  first. The page strip uses a labeled bookmark icon and untruncated page numbers. The stronger
  verifier scrolls every verdict into view, checks the full accessible label and exposed score
  height, and captures both orientations. Post-fix native screenshot review verifies all three
  labels remain inside their button backgrounds and the score remains visible. The first run
  passed the geometry, reachability and tempo-lock checks but failed six obsolete text-child
  selectors: SwiftUI correctly exposes these text-only buttons as combined labels. The verifier
  now checks that full label and checks child containment only when a separate child exists;
  native screenshot review remains required. This failed run is retained as failed.

The final iPad regression (`praelude-ios-ipad-final.xcresult`) passed all three selected cases:
backup export/cancel/restore/cancel with practice retained, ordinary practice/correction/relaunch,
and the strengthened maximum-text/rotation/tempo-lock check. Combined with earlier passing cases,
all eight distinct iPad scenarios have passing native evidence. This is a series of regression
runs, not a claim that every historical full run passed. Independent screenshot review confirms
button containment, usable page controls, dark-mode contrast and visible score space.

The final phone accessibility regression passed (63.975 seconds), including full labels, scroll
reachability, visible score area and tempo locking in both orientations. Its selected screenshots
come from that passing case. The phone backup case still lacks a complete passing run: after the
Browse/Recents selector correction, the last attempt failed at the initial Settings presentation
(37.965 seconds), before either picker. Earlier native evidence proves export presentation,
gesture dismissal, all three Settings callbacks, and the initialized Restore Recents view; it does
not turn the final failed case into a pass. No further retries were used to claim acceptance.
The independent CUA manual attempt could not obtain usable Simulator capture and provides no
manual success evidence. Phone backup UI remains an explicit B115 acceptance item.

Raw results remain local under `/private/tmp/praelude-ios-*.xcresult` and matching build/test logs;
large test bundles, simulators, derived data and compiled apps are deliberately excluded from Git.
Selected final screenshots are kept in [screenshots](screenshots/).

## Unaccepted boundaries

- **Physical installation:** the earlier unsigned-build manifest records the environment before
  device setup. On September 14, a wired iPad Pro (12.9-inch, 3rd generation) running iPadOS 18.7.8
  was detected and paired. The user signed into Xcode; free Personal Team signing produced a valid
  Release app and a profile authorizing that iPad, expiring September 21 at 21:24:58 UTC. The last
  query during initial setup reported Developer Mode disabled; the device then became unavailable
  and the first install attempt could not locate it. After the user completed setup, a fresh query
  confirmed Developer Mode enabled and developer services available. Installation succeeded at
  17:51 EDT; a scoped installed-app query verified Praelude 1.0.0/build1. The first launch request
  was denied by the device's signature/entitlements/untrusted-profile check. The prepared signature
  and profile match were already verified; the user was directed to trust their personal developer
  certificate in Settings. No successful launch or new hardware feature acceptance is claimed yet.
  This is personal development signing, not TestFlight, App Store distribution, or device acceptance.
  The signed build also passed using the ignored local signing configuration with no command-line
  team override. A separate project copy without that local file resolves normally, preserving
  fresh-clone portability. No account identifiers, private keys or profiles are committed.
- **Hardware:** microphone permissions, downloaded speech language support, command recognition
  over an acoustic piano, voice/metronome overlap, sustained output timing, audio interruptions,
  external keyboards/page-turn pedals and VoiceOver require physical-device acceptance.
- **Files and windows:** PDF copying/backup restoration are exercised through app-hosted native
  tests. The iPad export/cancel/restore/cancel flow passed; the complete iPhone picker flow remains
  unaccepted as detailed above. Provider-specific file selection, iCloud Drive, independently resized iPad scenes and
  simultaneous multiwindow interactions still need their own end-to-end checks.
- **OS/device coverage:** simulator coverage is iOS 26.5 on the named phone/tablet. Building with
  a minimum of iOS 17 is not evidence that every supported OS or screen width has been exercised.
- **Desktop parity:** native data is independent. Mac SQLite migration/sync, full Studio economy,
  advanced practice policies, parked sets, full warmups/history repair, PDF ink/Pencil, Listen Back
  and cloud mapping are outside this candidate. The Assistant remains off/on hold.

See [native scope and differences](../../../ios/DESIGN.md#native-scope-and-desktop-differences)
and [build/run instructions](../../../ios/README.md). B115 tracks the remaining native acceptance
and parity work in the living flaw register.

## Next steps

Complete the iPad's personal developer trust step and verify that the installed app launches.
Resolve the complete iPhone backup UI acceptance check. Test on a physical
iPhone and iPad with disposable practice data. Complete the hardware,
Files-provider, accessibility and multiwindow checks before distribution. Plan desktop-data
migration and remaining feature ports explicitly rather than treating this independent store as sync.
