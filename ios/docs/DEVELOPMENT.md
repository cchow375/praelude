# Developing Praelude Mobile

## Build8 candidate boundaries — October 9

Current source is 2.0.0/build8/schema5; the confirmed personal iPad installation is build7. The installed Mac remains v11.1.0/schema21. Verification checkpoints: 406 core tests, 2,211 deterministic service assertions and 57 Python helper tests pass. The final native run executes 245 tests with 1 live-account skip and 0 failures in 16.881 seconds; the mounted-scene fixture proves window identity before its strict crop/zoom checks. UI15 passes the complete actual sticky create/hold-drag/double-tap-edit/relaunch/triple-tap/permission-denied recovery flow in 59.539 seconds on the same final production source. Phone3 passes accessibility portrait/landscape in 71.631 seconds, with four independently accepted screenshots. Earlier scoped passes cover exact 72→88 BPM goals, hands, grading/Undo, movement editing/navigation, warmup Finish, score continuity, markup and two-finger Undo/Redo. Source review and scoped layout review pass; source is frozen. The 45-item QA report preserves UI13–15 native frame failures, earlier UI failures, stale-runner evidence and the test-fixture correction instead of replacing them with a blanket pass. Build8 is not installed; physical acceptance and a week-long teacher trial remain unproved. Use the [build8 review ledger](../../docs/qa/ios/2.0.0/build8/usability-review.md) for exact results, failed attempts and physical gates.

Defer/coalesce PDFKit document/display/page and overlay-provider mutations until `updateUIView`/dismantle has unwound. Six symbolicated physical build7 watchdogs establish the focused-overlay responder/AttributeGraph cycle at synchronous `PDFView.go(to:)`; [the crash analysis](../../docs/qa/ios/2.0.0/build8/crash-analysis.md) records the evidence. Explicitly observe values read only by the deferred coordinator, suppress transient PDF page notifications, discard canceled/dismantled work, and retain failed-checkpoint refusal. Hosted9 validates these paths in a real SwiftUI/PDFKit hierarchy.

`AnnotationPalette`, `ScorePageOverlay` and `PagedScoreView` own the movable palette, native zoomed ink and direct gestures. Keep the PDF viewport stable when moving/collapsing tools and retain visible alternatives for essential gestures. `TempoDial` owns cancelable exact/tap entry and local drag preview; `PracticeTempoGoalView` owns the draft progression contract. `PassageRenameView` retains its original target and only saves reviewed text; dictation shares the command service's microphone owner.

`PracticeStore.replaceInkPreparedAsync` is the idle-save path: immutable stroke/JSON preparation may leave the UI actor; file publication may not. Revalidate revision and expected rows after suspension and publish only after a successful atomic write. The coordinator's edit generation prevents an older completion from clearing newer drawing. Explicit navigation/layer/mode/background/exit checkpoints cancel the preparation and keep synchronous save-before-transition semantics. Import/backup/export and atomic write latency still need physical measurement.

Movement entries retain the original piece/PDF/source coordinates. `ScoreOrganization.practiceSnapshot` and `startSet(_:scoreSectionID:)` create a trusted immutable movement title/range snapshot using existing practice fields. They do not store an ordinary Passage. Unknown or mixed targets must fail before persistence, and a caller's forged snapshot must remain ignored. Typed draft keys distinguish whole-piece, passage and movement contexts. Schema5, backup4 and native sync DTOs are unchanged by this feature.

Run core movement/snapshot, asynchronous ink conflict/cancellation and page-navigation tests; hosted overlay/checkpoint/audio-lifecycle tests; and native UI tests that actually use tempo/goal/hands, Undo, save/relaunch, annotation with live practice, short/rotated layouts, movement entry and warmup exits. A field existing is not evidence that it is tappable, and an underlying duplicate accessibility element is not the intended sheet control. Root coordinates Xcode runs serially. The 57-test deployment-helper suite includes three new exact named-device tunnel regressions; it is not an app or physical-device acceptance result.

**Delivery checkpoint:** the first two signed device Release attempts stopped before compilation with Xcode `No Accounts` / `No Profiles`; Xcode settings confirmed it was signed out. The user now confirms sign-in, and the final signed Release build is running. Its signing/profile validation and guarded installation remain pending. No credentials were obtained or new account/certificate created; the prior profile backup is archived. Build7 remains installed and unchanged.

**Next steps:** finish final UI/Release and independent review, preserve every owned file through the guarded refresh, then separately measure real Pencil/audio and sustained-use behavior.

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
