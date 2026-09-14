# Native iPhone/iPad candidate acceptance

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
| Personal iPad signing | Free Personal Team Release build and strict signature verification passed; the connected iPad is included in its profile. Installation is pending device reconnection and Developer Mode confirmation. See [personal-ipad-install.json](personal-ipad-install.json). |
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
  complete device query reported Developer Mode disabled; the device then became unavailable during
  setup and the first install attempt could not locate it. No installation or launch is claimed.
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

Reconnect and unlock the iPad after enabling and confirming Developer Mode, then install and launch
the prepared signed app. Resolve the complete iPhone backup UI acceptance check. Test on a physical
iPhone and iPad with disposable practice data. Complete the hardware,
Files-provider, accessibility and multiwindow checks before distribution. Plan desktop-data
migration and remaining feature ports explicitly rather than treating this independent store as sync.
