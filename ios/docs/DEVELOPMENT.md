# Developing Praelude Mobile

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

| Path                                                                                                                     | Responsibility                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Praelude/PraeludeApp.swift`                                                                                             | App lifecycle, shared services, adaptive navigation and system windows                                                                  |
| `Praelude/Core/Models.swift`                                                                                             | Codable domain, preferences, practice and score-markup records                                                                          |
| `Praelude/Core/PracticeEngine.swift`                                                                                     | Deterministic repetitions, stages and tempo progression                                                                                 |
| `Praelude/Core/PracticeStore.swift`                                                                                      | Validation, atomic persistence, migration and recovery                                                                                  |
| `Praelude/NativeLibraryFiles.swift`                                                                                      | Owned PDF import, native backup packaging and restoration                                                                               |
| `Praelude/Views/ScoreWorkspace.swift`                                                                                    | Score/practice workspace, commands and focused actions                                                                                  |
| `Praelude/Views/PagedScoreView.swift`                                                                                    | PDFKit integration, page position and zoom                                                                                              |
| `Praelude/Views/ScorePageOverlay.swift`, `ScoreMarkupState.swift`                                                        | PencilKit overlays, passage-box drafts and pending ink across view transitions                                                          |
| `Praelude/Views/RecordedPassageView.swift`                                                                               | Read-only original target for a recorded set                                                                                            |
| `Praelude/Services/ScoreExport.swift`, `Views/ScoreShareView.swift`                                                      | Separate annotated PDF rendering and native share/print sheet                                                                           |
| `Praelude/Core/SyncEngine.swift`, `SyncDTO.swift`, `SyncJSON.swift`, `SyncCoding.swift`                                  | Transport-agnostic outbound queue, LWW, wire-format DTOs (spec §4d) — Foundation-only, fake-transport-testable                          |
| `Praelude/Services/SupabaseServices.swift`, `AuthManager.swift`, `PostgRESTSyncTransport.swift`, `SyncCoordinator.swift` | Supabase SDK clients, account lifecycle (spec §4b), the real sync transport, and the Core↔PracticeStore bridge                          |
| `Praelude/Views/AccountView.swift`, `ProfileEditView.swift`                                                              | Sign up/in/out, delete account (Settings → Account and sync); profile fields, instruments, privacy, stats, preview-as-others (spec §4c) |
| `Praelude/Views/`                                                                                                        | Today, library, progress, goals, set/passage editors and settings                                                                       |
| `Praelude/Services/`                                                                                                     | Metronome, feedback, speech commands, audio session and runtime coordination                                                            |
| `PraeludeCoreTests/`                                                                                                     | Foundation persistence/engine/migration tests, runnable without a simulator                                                             |
| `ServiceChecks/`                                                                                                         | Deterministic command/pattern checks                                                                                                    |
| `PraeludeAppTests/`                                                                                                      | App-hosted native PDF and backup tests                                                                                                  |
| `PraeludeUITests/`                                                                                                       | Native interaction and visual/geometry assertions                                                                                       |
| `scripts/generate-project.py`                                                                                            | Deterministic project/scheme generation; project/version configuration                                                                  |
| `scripts/device.py`, `scripts/test_device.py`                                                                            | Explicit device update workflow and fake-device safety tests                                                                            |

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
