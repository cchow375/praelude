# Developing Praelude Mobile

## October 9 — build9 installed and opened; physical acceptance pending

**Installed iPad: native2.0.0/build9/schema5 from `2de2444`. Launch/readback pass; physical acceptance remains pending. Mac:v11.1.0/schema21 unchanged.** On the iPad Pro12.9-inch (3rd generation, iPad8,5), iOS18.7.8, the prior build8 report was that the score cannot zoom while ink pans, Clean takes about one second, scrolling/menu/mode changes and warmup exit are delayed, passage selection updates about once every four seconds, and Pencil use crashes. These are physical observations, not accepted performance limits.

A45-second physical build8 Time Profiler capture records18.293 seconds of main-thread sampled CPU time, including12.276 seconds in `syncAll`. Instruments identifies14 hang/microhang intervals, the longest2.0187 seconds. The leading stack is `String(format:)` → `Data.praeludeHexLiteral` → `InkStrokeSyncRow` → `enqueueLibrarySnapshot` → scheduled `syncAll`. Inclusive samples overlap; hang duration is not measured touch-to-frame latency. These are build8 measurements, not evidence of build9 improvement. Sanitized evidence is `docs/qa/ios/2.0.0/build9/build8-physical-performance.json`.

Build9 source repairs are frozen for final verification: PDFKit owns page pan/zoom while the drawing canvas stays fixed; bounded app-owned drawing-value history replaces native tile Undo registrations; durable practice sync entries batch in parent-before-child order with debounced draining and account/revision-scoped snapshot reuse; a byte lookup replaces per-byte NSString formatting while retaining the existing hex wire format. Core412 and full native258 (1 live-account skip,0 failures) pass before the final gesture-priority change; two iPad practice/selection UI cases also pass. The earlier actual pinch failure is retained in QA. Undo now waits for the native pinch recognizer to fail and cannot recognize simultaneously. All14 targeted native interaction tests and fresh source review pass after that change. Actual UI5x pinch raises PDF scale to2.3177427145 from minimum1.0255516841 with the ink stroke retained; independent before/after pixel review accepts score/ink alignment and the settled palette. Actual two-finger Undo passes in Draw and reading. Two attempts to place the zoomed two-finger tap through XCTest fail because the target lies in a clipped viewport; this does not establish a production failure or a pass. The final gesture UI passes70.518 seconds: actual stroke, two-finger Undo in Draw/reading, Redo, mode change, strict real PDF pinch with unchanged ink, toolbar Undo/Redo at zoom, Done and saved ink after relaunch. Physical two-finger Undo at zoom remains pending. Source is frozen. Signed device build9 Release and strict app/profile/team/device/signer-trust and Release fixture/debug-exclusion checks pass. The same-bundle profile expires October16 at23:56:11 UTC (7:56 PM EDT). Independent signed-artifact verification and guarded installation also pass. Build9 is installed and running; independent post-launch preservation passes. Active-use responsiveness evidence and physical acceptance remain pending. No measured speedup or physical-crash closure is claimed.

**Installed build9 checkpoint:** source `2de2444a782cb54a5cd31966ecc33257e4511dd0`, tag `ios-v2.0.0-build9-candidate`, is installed through the guarded same-bundle refresh. Independent review verifies all13 owned files/12,960,329 bytes identical by filename, size and SHA-256 before launch. Schema5/revision2167 retains6 pieces/53 passages/54 set IDs (53 historical plus1 paused active set)/35 sessions/317 attempts/259 ink records (202 active)/2 stamps/2 notes. The paused set is preserved; it is not a running set or an empty active slot. Actual post-helper Release signing/profile checks pass; expiry remains October16 at23:56:11 UTC (7:56 PM EDT). iOS denied automatic launch, then the user confirmed opening build9 and read-only process inspection confirmed it running. Independent complete post-launch readback at October10 00:57:50 UTC (October9 8:57:50 PM EDT) verifies the same13 files/12,960,329 bytes unchanged, schema5/revision2167 and every original record including the paused set. Physical zoomed two-finger Undo, responsiveness and sustained practice remain pending. Both build9 traces completed but were effectively idle: the45-second trace has12 all-thread samples/5 main-thread CPU milliseconds; the120-second trace has15 all-thread samples/8 main-thread samples (8 milliseconds). Neither reports potential hangs, but neither proves active score gestures or a speedup; foreground lifecycle is unknown. User gesture feedback remains pending. Evidence: `docs/qa/ios/2.0.0/build9/personal-ipad-install.json`.

**Next steps:** obtain feedback on the actual practice/Pencil/zoom/Undo flows and capture verified active-use profiling if needed. Physical lag and zoomed two-finger Undo remain open. Preserve the paused set and keep installation/preservation separate from physical acceptance. No week-long or zero-defect claim is supported.

Evidence and planned checks: `docs/qa/ios/2.0.0/build9/responsiveness-regressions.md`; the separate Undo repair ledger is `docs/qa/ios/2.0.0/build9/undo-repair.md`.

## Installed build8 boundaries — October 9; physical failure open

Installed native source is2.0.0/build8/schema5; a confirmed native Undo crash was reported after opening. The installed Mac remains v11.1.0/schema21. Verification checkpoints: 406 core tests, 2,211 deterministic service assertions and 57 Python helper tests pass. The final native run executes 245 tests with 1 live-account skip and 0 failures in 16.881 seconds; the mounted-scene fixture proves window identity before its strict crop/zoom checks. UI15 passes the complete actual sticky create/hold-drag/double-tap-edit/relaunch/triple-tap/permission-denied recovery flow in 59.539 seconds on the same final production source. Phone3 passes accessibility portrait/landscape in 71.631 seconds, with four independently accepted screenshots. Earlier scoped passes cover exact 72→88 BPM goals, hands, grading/Undo, movement editing/navigation, warmup Finish, score continuity, markup and two-finger Undo/Redo. Source review and scoped layout review pass; source is frozen. The 45-item QA report preserves UI13–15 native frame failures, earlier UI failures, stale-runner evidence and the test-fixture correction instead of replacing them with a blanket pass. Build8 is installed; the user reports a physical failure, and no week-long teacher trial has occurred. Use the [build8 review ledger](../../docs/qa/ios/2.0.0/build8/usability-review.md) for exact results, failed attempts and physical gates.

Defer/coalesce PDFKit document/display/page and overlay-provider mutations until `updateUIView`/dismantle has unwound. Six symbolicated physical build7 watchdogs establish the focused-overlay responder/AttributeGraph cycle at synchronous `PDFView.go(to:)`; [the crash analysis](../../docs/qa/ios/2.0.0/build8/crash-analysis.md) records the evidence. Explicitly observe values read only by the deferred coordinator, suppress transient PDF page notifications, discard canceled/dismantled work, and retain failed-checkpoint refusal. Hosted9 validates these paths in a real SwiftUI/PDFKit hierarchy.

`AnnotationPalette`, `ScorePageOverlay` and `PagedScoreView` own the movable palette, native zoomed ink and direct gestures. Keep the PDF viewport stable when moving/collapsing tools and retain visible alternatives for essential gestures. `TempoDial` owns cancelable exact/tap entry and local drag preview; `PracticeTempoGoalView` owns the draft progression contract. `PassageRenameView` retains its original target and only saves reviewed text; dictation shares the command service's microphone owner.

`PracticeStore.replaceInkPreparedAsync` is the idle-save path: immutable stroke/JSON preparation may leave the UI actor; file publication may not. Revalidate revision and expected rows after suspension and publish only after a successful atomic write. The coordinator's edit generation prevents an older completion from clearing newer drawing. Explicit navigation/layer/mode/background/exit checkpoints cancel the preparation and keep synchronous save-before-transition semantics. Import/backup/export and atomic write latency still need physical measurement.

Movement entries retain the original piece/PDF/source coordinates. `ScoreOrganization.practiceSnapshot` and `startSet(_:scoreSectionID:)` create a trusted immutable movement title/range snapshot using existing practice fields. They do not store an ordinary Passage. Unknown or mixed targets must fail before persistence, and a caller's forged snapshot must remain ignored. Typed draft keys distinguish whole-piece, passage and movement contexts. Schema5, backup4 and native sync DTOs are unchanged by this feature.

Run core movement/snapshot, asynchronous ink conflict/cancellation and page-navigation tests; hosted overlay/checkpoint/audio-lifecycle tests; and native UI tests that actually use tempo/goal/hands, Undo, save/relaunch, annotation with live practice, short/rotated layouts, movement entry and warmup exits. A field existing is not evidence that it is tappable, and an underlying duplicate accessibility element is not the intended sheet control. Root coordinates Xcode runs serially. The 57-test deployment-helper suite includes three new exact named-device tunnel regressions; it is not an app or physical-device acceptance result.

**Installed build8 — physical Undo crash remains open:** native2.0.0/build8/schema5 from `a23cdec4f4f9acf42e8e5c724b6a386430dddca5` is installed. Independent review verifies all13 owned files/12,788,247 bytes unchanged by filename, size and SHA-256 before launch. Automatic launch was declined; the user opened the app. The23:59:40 UTC readback retains schema5/revision2086 (from2079),6 pieces/51 passages/50 sets/31 sessions/304 attempts/255 ink records (199 active)/2 stamps/2 notes. Original records remain exact except one piece page bookmark; profile/privacy/account/score data are exact. This readback precedes the23:59:53 UTC crash and is not post-crash retention proof. The user reported failure at19:59:56 EDT. Matching build8 dSYM identifies main-thread `EXC_BAD_ACCESS` at0x10 in `PKTiledView.performUndo` tile update, reached through the two-finger Undo action; this is distinct from the build7 PDF watchdog. Exact user sequence remains pending and the crash is unclosed. Signed Release checks pass, with profile valid through October16 at23:56:11 UTC (7:56 PM EDT). Sanitized evidence: `docs/qa/ios/2.0.0/build8/personal-ipad-install.json`. Mac v11.1.0/schema21 is unchanged.

**Next steps:** obtain the exact user sequence and reproduce the confirmed native two-finger Undo crash before accepting its repair. Keep the23:59:40 UTC readback separate from post-crash retention. Keep physical Pencil, microphone, large-score and sustained-use acceptance open; do not treat installation as task completion.

Open `ios/` as its own working folder, or open [Praelude Mobile.code-workspace](../Praelude%20Mobile.code-workspace)
in a compatible editor. The project remains inside the parent Git repository. Native debugging,
signing, previews and device destinations live in [Praelude.xcodeproj](../Praelude.xcodeproj).

In a compatible editor, **Run Build Task → Mobile: build** runs project generation, then core/service
checks and the unsigned simulator build in sequence. **Run Task** also offers core-only checks,
deployment-helper tests, Open Xcode, read-only device status, and an explicitly labeled device
refresh that builds and installs. Device tasks ask for the exact device name; leave it blank only
when one device is connected. Opening the workspace runs nothing automatically. The build task
does not run app-hosted/UI tests or install an app.

## First setup

Install **full Xcode with the iOS SDK** and select it as the active developer directory. Command
Line Tools alone cannot build the app. Install a compatible iPhone/iPad simulator runtime through
**Xcode → Settings → Components**. The repository's Mac bootstrap does not install Xcode or an
iOS runtime. See [Apple's component guide](https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components).

The native project uses Apple frameworks and the Python/Swift tools supplied with the development
environment, plus one pinned remote SPM dependency: `supabase-swift` (accounts/sync, spec §4).
`scripts/generate-project.py` declares the exact version; `Package.resolved`
(`project.xcworkspace/xcshareddata/swiftpm/`) is committed so every resolve gets the same
transitive versions, and `SourcePackages/` (the cloned checkouts) is gitignored as reproducible
from it. Node/npm are optional shortcuts for the commands below, not part of the app.

From `ios/`:

```sh
python3 scripts/generate-project.py
bash scripts/check.sh
open Praelude.xcodeproj
```

Select the **Praelude** scheme and an iPhone or iPad simulator. **Product → Run** launches a normal
blank library. **Product → Test** runs app-hosted tests and UI tests. Device setup and signing are
separate: [install on your iPad](INSTALL_ON_IPAD.md).

## Module map

| Path                                                                                                                     | Responsibility                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Praelude/PraeludeApp.swift`                                                                                             | App lifecycle, shared services, adaptive navigation and system windows                                                                                                                                                       |
| `Praelude/Core/Models.swift`                                                                                             | Codable domain, preferences, practice and score-markup records                                                                                                                                                               |
| `Praelude/Core/PracticeEngine.swift`                                                                                     | Deterministic repetitions, stages and tempo progression                                                                                                                                                                      |
| `Praelude/Core/PracticeStore.swift`                                                                                      | Validation, atomic persistence, migration and recovery                                                                                                                                                                       |
| `Praelude/Core/InFlightWorkGate.swift`, `Services/TunerService.swift` | One analysis window across tuner restarts; cancellation and bounded admission |
| `Praelude/Services/ScoreThumbnailCache.swift`, `PassageThumbnailRenderer.swift` | Private PDF/image workers with bounded decoded caches and shared-request cancellation |
| `Praelude/NativeLibraryFiles.swift`                                                                                      | Owned PDF import, native backup packaging and restoration                                                                                                                                                                    |
| `Praelude/Views/ScoreWorkspace.swift`                                                                                    | Score/practice workspace, commands and focused actions                                                                                                                                                                       |
| `Praelude/Views/PagedScoreView.swift`                                                                                    | PDFKit integration, page position and zoom                                                                                                                                                                                   |
| `Praelude/Views/ScorePageOverlay.swift`, `ScoreMarkupState.swift`                                                        | PencilKit overlays, passage-box drafts and pending ink across view transitions                                                                                                                                               |
| `Praelude/Views/RecordedPassageView.swift`                                                                               | Read-only original target for a recorded set                                                                                                                                                                                 |
| `Praelude/Services/ScoreExport.swift`, `Views/ScoreShareView.swift`                                                      | Separate annotated PDF rendering and native share/print sheet                                                                                                                                                                |
| `Praelude/Core/SyncEngine.swift`, `SyncDTO.swift`, `SyncJSON.swift`, `SyncCoding.swift`                                  | Transport-agnostic outbound queue, LWW, wire-format DTOs (spec §4d) — Foundation-only, fake-transport-testable                                                                                                               |
| `Praelude/Services/SupabaseServices.swift`, `AuthManager.swift`, `PostgRESTSyncTransport.swift`, `SyncCoordinator.swift` | Supabase SDK clients, account lifecycle (spec §4b), the real sync transport, and the Core↔PracticeStore bridge                                                                                                               |
| `Praelude/Views/AccountView.swift`, `ProfileEditView.swift`                                                              | Sign up/in/out, delete account (Settings → Account and sync); profile fields, instruments, privacy, stats, preview-as-others (spec §4c); AccountView's signup also gates on an age bracket (spec §5c)                        |
| `Praelude/Core/SocialSupport.swift`                                                                                      | Foundation-only §5 pieces with no server round trip: activity/reaction/report vocabulary (verified against the backend's check constraints), age-gate decision, presence staleness, invite-link parsing, contact hashing     |
| `Praelude/Services/Social/SocialService.swift`, `SocialModels.swift`                                                     | Every spec §5 RPC/table read-write (friends, blocks, feed, notes, presence fallback, studios, invites, contacts, leaderboard, reports) and their wire-format DTOs — no offline queue, see `supabase/(C) Sync Protocol.md` §1 |
| `Praelude/Services/Social/PresenceService.swift`                                                                         | Live "practicing now" over Supabase Realtime Presence, one topic per user id (see its own doc comment for the channel-topology reasoning)                                                                                    |
| `Praelude/Services/Social/SocialHooks.swift`                                                                             | `shareMilestone`/`postNote` — the integration points another feature track fires a feed event or a Note through, rather than calling `SocialService` directly                                                                |
| `Praelude/Views/Social/`                                                                                                 | The Friends tab: activity feed, practicing-now strip, Notes, friend search/requests/grid, studios, leaderboard, safety (report/block)                                                                                        |
| `Praelude/Views/`                                                                                                        | Today, library, progress, goals, set/passage editors and settings                                                                                                                                                            |
| `Praelude/Services/`                                                                                                     | Metronome, feedback, speech commands, audio session and runtime coordination                                                                                                                                                 |
| `PraeludeCoreTests/`                                                                                                     | Foundation persistence/engine/migration tests, runnable without a simulator                                                                                                                                                  |
| `ServiceChecks/`                                                                                                         | Deterministic command/pattern checks                                                                                                                                                                                         |
| `PraeludeAppTests/`                                                                                                      | App-hosted native PDF and backup tests                                                                                                                                                                                       |
| `PraeludeUITests/`                                                                                                       | Native interaction and visual/geometry assertions                                                                                                                                                                            |
| `scripts/generate-project.py`                                                                                            | Deterministic project/scheme generation; project/version configuration                                                                                                                                                       |
| `scripts/device.py`, `scripts/test_device.py`                                                                            | Explicit device update workflow and fake-device safety tests                                                                                                                                                                 |

Read source for the active schema and API contract. [ROADMAP.md](ROADMAP.md) distinguishes work
in progress from accepted milestones; the [QA ledger](../../docs/qa/ios/README.md) owns exact evidence.
The [candidate usage guide](USING_MOBILE.md) follows current control labels and user flows.

## Checks

From `ios/`:

```sh
# Core + deterministic services + unsigned simulator compilation
bash scripts/check.sh

# Fast platform-independent checks only
bash scripts/check.sh --core-only

# Device helper safety tests: fake commands, no connected-device changes
python3 -m unittest discover -s scripts -p 'test_*.py'

# Choose a simulator in Xcode and run Product > Test for hosted and UI tests
open Praelude.xcodeproj

# Live two-device sync smoke test against the hosted project (spec §17a) - skips itself
# without credentials; see the script's header for how to obtain a throwaway account
PRAELUDE_SMOKE_EMAIL=... PRAELUDE_SMOKE_PASSWORD=... "scripts/(C) sync-smoke.sh"
```

From the repository root, the equivalent shortcuts are `npm run ios:project`, `npm run ios:check`,
`npm run ios:check -- --core-only`, `npm run ios:test:tools`, and `npm run ios:open`.

For command-line native tests, obtain a simulator name from Xcode and use an explicit destination:

```sh
xcodebuild -project Praelude.xcodeproj -scheme Praelude \
  -destination 'platform=iOS Simulator,name=YOUR SIMULATOR NAME' \
  -derivedDataPath DerivedData -resultBundlePath /tmp/praelude-mobile-check.xcresult test
```

Use a new result-bundle path for each run. A successful simulator build does not execute hosted
or UI tests. A selected regression run does not establish that an entire suite passed together.
Inspect failure screenshots: a synthetic gesture may fail to move content even when its test call
returns successfully, and a combined SwiftUI accessibility label may differ from a child-text query.

## Test data and isolation

`--uitesting --seed` is restricted to DEBUG and uses a separate test store; the fixture is a
synthetic score and synthetic practice records. `--uitesting --reset` resets only that store.
Do not pass test arguments to an ordinary development or device launch. Inspect Release binaries
for fixture exclusion before personal-device installation.

The app's durable store is under its own `Library/Application Support/Praelude` sandbox folder.
It contains `library.json` and owned `Scores/` PDFs. New-format migrations must preserve the original
ledger before changing it. The device helper copies this complete folder to an ignored local backup
before replacing an existing app. A second full copy after installation must match every saved
file name, size and SHA-256 before launch; failed copying or a difference leaves both copies for
review and reports installed-but-unverified status. There are at most two full copies per refresh,
plus the pre-install ledger recheck. The helper never writes to the device data container directly.

## Project changes and handoff

Keep the generator and committed project synchronized. A mobile release number is independent of
the root `package.json` Mac version. Preserve the mobile bundle identifier across personal refreshes.
Team selection belongs only in ignored local signing configuration.

Keep raw `.xcresult` bundles, DerivedData, signed apps, backups, certificates, provisioning profiles,
and device logs out of Git. Commit sanitized QA summaries and selected nonpersonal screenshots only.
Follow [AGENTS.md](../AGENTS.md) and the parent living-document update protocol before handoff.

**Next steps:** use the current mobile roadmap for implementation scope, then record exact native
checks and physical-device limits for each accepted milestone.
