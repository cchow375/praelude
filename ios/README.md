# Praelude for iPhone and iPad

**Version 1.0.0 — DEVELOPMENT CANDIDATE. Last updated: 2026-09-14.** This is a native SwiftUI
application target for iOS/iPadOS 17 and later. It is separate from the installed Mac
Praelude v11.1.0/schema21 product. It has not been shipped through the App Store/TestFlight or
completed physical-device feature acceptance. Simulator evidence and hardware acceptance are different gates.

**Cable install status (2026-09-14): installed on iPad; first-launch trust pending.** Installation
succeeded at 17:51 EDT, and the device app listing confirms version 1.0.0/build1 on the iPad Pro
12.9-inch (3rd generation), iPadOS 18.7.8. Developer Mode is enabled. The earlier attempt failed
when the device became unavailable; that is retained as history. The first launch was denied
with a security/trust message. Developer App trust is the next step; launch and feature QA are
not accepted yet.

The free Personal Team profile expires **2026-09-21 at 21:24:58 UTC**. Fixtures/test plug-ins
are excluded, and the signed app is preserved at ignored `releases/ios-personal/Praelude.app`.
The [sanitized Personal Team manifest](../docs/qa/ios/personal-ipad-install.json) records signing,
expiry and confirmed installation separately from pending launch. The local-config Release build
passes without a CLI team override. The historical unsigned manifest and simulator evidence remain
unchanged; no Mac app or practice data was touched.

Praelude keeps the same rule on every device: **the pianist is the sensor; the app is the memory**.
You supply Clean, Sloppy, or Again. The app records practice, runs a metronome, and keeps your score
close. It never listens to the piano to grade your playing. A normal first launch is blank.

## The native interface

The iPhone has three labeled tabs: **Today, Pieces, Progress**. iPad uses a collapsible system
sidebar and a score workspace that adapts to window width; accessibility text sizes use full-width
tabs so sidebar labels stay readable. Plain surfaces, system typography,
large touch controls, one indigo action tint, and native sheets replace the desktop panel layout.
There are no decorative gradients or simulated draggable desktop windows. Native system materials
separate controls from the readable score. The rationale and primary-source research are in
[DESIGN.md](DESIGN.md).

- **Today:** return to the current set, open recent pieces, and see recorded work. Goals has its
  own toolbar button and focused editor; goals are optional and never impose a practice plan.
- **Pieces:** import a PDF from Files, search by title/composer, sort, edit notes/details, or move
  a piece to Resting without losing its record.
- **Score:** PDFKit page reading and zoom, saved measure-range passages, a focused set composer,
  and large verdict buttons. iPad can explicitly open a score in a separate system window.
- **Practice:** Clean streak or fixed Total plays, hands/focus, optional tempo ladder, ordered
  variants and saved routines, pause/resume, current-set undo, and recorded sessions. Saving a rep
  is independent of audio and feedback. A running/paused set cannot be silently replaced.
- **Progress:** actual time, repetitions, completed sets, practice days, session details, and a
  date-based practice calendar. Native levels advance every 100 earned XP; these are effort
  feedback and are separate from the Mac Studio economy. Daily views group sessions by start date.
- **Settings:** System/Light/Dark, score display-awake behavior, optional practice feedback,
  backup export/restore, and the compact practice/keyboard guide.

## Start practicing

1. In **Pieces**, choose **Add piece**, enter a title, and import an unlocked score PDF from Files.
   The app keeps its own copy; your source file is unchanged. You can also create a piece before
   attaching a score. Imports accept up to 100 MB and 2,000 pages.
2. Open the piece. Turn pages with the visible arrows; pinch to zoom.
   Open **Passages** to add a title, measure range, score page, and focus.
3. Choose the passage or whole piece and open **Practice set**. Start with the focus, clean
   target, and tempo. **Set rules** holds count basis and hands. Variants and the optional tempo
   ladder apply to Clean streak; Total plays uses one fixed tempo and no variants.
4. Record **Clean**, **Sloppy**, or **Again** after playing. Sloppy restarts the current clean run.
   Again preserves a variant stage's progress; with a plain clean streak it restarts the run.
   All three verdicts count toward Total plays. Use Undo for the most recent verdict.
5. Pause when stepping away, resume from Today, and finish the session when done. The app pauses
   practice for backgrounding and restores saved work after reopening.

The native tempo range is **20–300 BPM**. The metronome uses an audio-buffer loop scheduled by
the audio engine, not a UI timer. Audio interruptions and disconnected routes stop playback with
a recoverable state. Real-device output, sustained timing, and piano-room acoustics still need
hardware acceptance.

## Voice and keyboard

Open **Score options (…) → Hands-free commands → Enable hands-free** to opt in. While listening,
use **Off** in the practice controls or **Turn voice off** in Score options to stop. Starting the
app does not ask for microphone access. The native speech path requires supported **on-device US English recognition**;
if it is unavailable, voice refuses and the touch controls remain available. It never falls back
to a server. Only final recognized command phrases dispatch actions; partial text does not log reps.

Supported phrases include **clean**, **sloppy**, **again**, **undo**, **pause**, **resume**,
**metronome start/stop**, **tempo 96**, **next page**, and **previous page**. This is a narrower
command vocabulary than the Mac app. Microphone permission, speech availability, acoustic
reliability, and speech/metronome overlap require physical-device testing.

While the score is open, keyboard shortcuts are **←/→** for pages, **Space** for the metronome,
**1/2/3** for Clean/Sloppy/Again, and **⌘Z** for Undo. A Bluetooth page turner configured to emit
left/right keyboard arrows can use those bindings. MIDI and proprietary pedal protocols are not
implemented or claimed as accepted.

## Local data and backups

The app uses its own sandbox-relative `Application Support/Praelude/library.json` store with
**schema1**, plus owned PDFs in `Scores/`. Native mutations validate and write atomically before
publishing observable state. A damaged or newer-format library opens read-only. Ordinary writes
and export are refused so an empty fallback cannot overwrite a useful backup. Deliberately restoring
a validated native backup first copies the original ledger to `library-preserved-<UUID>.json` and
verifies identical bytes, then atomically installs the replacement. Failed preservation or replacement
keeps the store read-only; the original is retained. A blank new library can still export.
Desktop `codakiller.db`, schema21, absolute score paths, and Keychain credentials are never loaded
or modified by this target.

Settings exports a native JSON backup containing the library and its referenced score PDFs.
The score-data limit is 200 MB; restore files are bounded at 280 MB to account for encoded data.
Restore requires finishing the current set, a visible confirmation, valid references, and readable
PDFs. It stages PDFs under new local filenames before committing the replacement library and
cleans up staged files if validation fails. Backups are not encrypted by the application; choose
their destination deliberately. Exporting to iCloud Drive is file storage, not automatic app sync.

The native format does **not** import the Mac SQLite database or convert a Mac export. No migration,
account sync, cloud mapping, Listen Back, furnished Studio/coin inventory, desktop warmup suite,
PDF ink/Pencil editing, or full historical repair interface is implemented. Advanced desktop
mastery/demotion policies and multiple parked sets are also outside this candidate; it keeps one
running or paused set at a time. The Assistant remains off and on hold.
See the precise [scope matrix](DESIGN.md#native-scope-and-desktop-differences).

## Build and run

Use Xcode with the iOS SDK and a compatible simulator runtime. No package download or third-party
UI dependency is required. The app project, core Swift package, generator, and tests are in this
directory. From the repository root:

```sh
python3 ios/scripts/generate-project.py
bash ios/scripts/check.sh
open ios/Praelude.xcodeproj
```

Select the **Praelude** scheme and an iPhone or iPad simulator, then Run. The check script runs the
Foundation core tests, deterministic voice/metronome-pattern checks, and an unsigned simulator
build. To run only the deterministic checks:

```sh
bash ios/scripts/check.sh --core-only
```

For native verification, choose a simulator and use **Product → Test** with the **Praelude** scheme.
It includes **PraeludeAppTests** for native PDF/storage behavior and **PraeludeUITests** for actual
interface flows. Test data is restricted to DEBUG launches with `--uitesting --seed`; `--uitesting --reset`
resets only the separate UI-test store. Release builds have no fixture path. Synthetic fixture
scores contain no personal repertoire or practice records.

### Install on your own iPad or iPhone for free

A paid developer membership is **not required** to install this app on your own device through
Xcode. Sign in with your Apple Account and use its **Personal Team**. Apple manages that team's
development certificates and profiles through Xcode. This is personal device testing, not
App Store or TestFlight distribution. See [Apple's Personal Team rules](https://developer.apple.com/help/account/basics/about-your-developer-account).

1. Open `ios/Praelude.xcodeproj` in full Xcode. In **Xcode → Settings → Apple Accounts**, add
   your Apple Account and complete any sign-in or agreement prompts yourself.
2. Connect and unlock the iPad/iPhone by cable. Complete the device's **Trust This Computer**
   prompt if it appears, and select the physical device as the **Praelude** scheme's destination.
3. On the device, open **Settings → Privacy & Security → Developer Mode** and turn it on.
   Restart when prompted, then confirm enablement after the restart and enter the device passcode.
   The option appears after pairing with Xcode has begun. See [Apple's Developer Mode instructions](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).
4. In Xcode, select the **Praelude app target → Signing & Capabilities**, enable
   **Automatically manage signing**, and select your **Personal Team**. If **Set Up Signing**
   appears, use it to select the team. The candidate identifier is `com.christian.praelude.ios`;
   if Xcode reports it unavailable, use a unique identifier for that personal build and keep it
   stable for later refreshes.
5. Choose **Product → Run**. Let Xcode register the device, create its development profile,
   build, install, and launch the app. Use the normal scheme without UI-test fixture arguments.
   Apple's [physical-device running guide](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
   describes automatic signing and device registration.
6. If the first launch says the developer is untrusted, open **Settings → General → VPN & Device
   Management** on the iPad/iPhone, select your **Developer App** entry, and trust your developer
   certificate. Complete the prompts, then open Praelude again. This Personal Team trust step is
   also described in Apple's [Food Truck sample setup](https://developer.apple.com/documentation/swiftui/food-truck-building-a-swiftui-multiplatform-app).

For a portable checkout, the generated project reads `ios/Signing.xcconfig`, which optionally
includes the ignored `ios/Signing.local.xcconfig`. Keep your Personal Team selection in that local
file so regenerating the shared project retains signing without adding the team identifier to Git:

```xcconfig
DEVELOPMENT_TEAM = YOUR_PERSONAL_TEAM_ID
```

Use your own team identifier locally. The local file is optional; simulator and unsigned builds
work without it. Certificates and provisioning profiles remain managed by Xcode on this Mac.

**Refresh every seven days:** Personal Team provisioning profiles expire seven days after issuance.
Reconnect the device and rebuild/reinstall through Xcode when they expire. Keep the same Apple
Account, team, and bundle identifier; do not delete the app as part of the refresh. Apple currently
limits Personal Teams to three devices and three installed apps per device. See
[Apple's current limits and renewal requirement](https://developer.apple.com/help/account/basics/about-your-developer-account).

A successful install and launch must still be followed by device checks for score import, saved
practice, audio, speech, interruptions and backup. This guide does not change the development
candidate's acceptance status. App Store/TestFlight distribution requires separate membership,
signing, archive/upload, privacy and review work.

## Verification and remaining acceptance

The [native acceptance ledger](../docs/qa/ios/README.md) records the environment, exact gates,
review findings, selected screenshots, and remaining device boundaries.

**Current verification:** full Swift 6 compilation and the unsigned Release arm64 device build
pass for both device families with an iOS 17 minimum. The Foundation core has **22 passing tests**;
deterministic service checks have **2,041 passing assertions**. All **13 native app-hosted tests**
pass on **each iPhone and iPad simulator**, including PDF recovery. **All 8 distinct iPad UI
scenarios pass across regression runs**, including the final three-case backup/practice/large-text
suite. **7 of 8 iPhone UI scenarios pass**, including the corrected maximum-text test.

The **complete iPhone backup UI scenario remains open**: the last run failed at initial Settings
navigation, before either picker. An earlier run logged all three Settings callbacks and reached
export dismissal and Restore Recents/Cancel, but failed outdated picker-selector assertions.
iPad backup UI is accepted; neither family has manual CUA acceptance. The **final unsigned Release
build passes on the exact current source**: arm64, version 1.0.0/build1, iOS17 minimum, both device
families, with fixture flags and test plug-ins excluded. The [device build manifest](../docs/qa/ios/device-build.json)
records its SHA-256 and source digest. At that unsigned-build verification, no signing identities
or connected physical devices were present. Exact results and failed runs are retained in the
acceptance ledger.

Independent iPhone simulator screenshots verify the maximum-text correction in both orientations:
verdict labels fit their controls, all three verdicts are reachable by scrolling, the page index
is untruncated, and the score remains visible. Corrected iPhone and iPad large-text regression
tests pass. The requested Dynamic Type size is preserved.

Focused pinch zoom is accepted on the iPad simulator: PDFKit scale
changed from 1.240418 to 2.869110 on the same page (2.31×), with independently reviewed crisp
enlarged notation. The Release executable excludes the DEBUG fixture path. A device build is
not physical-device acceptance or distribution.

Physical iPhone/iPad import/relaunch/backup tests, VoiceOver and largest Dynamic Type, external
keyboard/pedal behavior, interruption handling, long-session audio, and voice over an acoustic
piano remain separate acceptance checks. The installed Mac app and its live database were outside
this native implementation's mutation scope. B115 in the project flaw register tracks the native
acceptance, signing, and feature-parity boundary.

## Next steps

Complete the iPad Developer App trust and verify launch, then test the installed candidate with
disposable data. Complete iPhone backup UI acceptance and physical-iPhone checks separately. Verify real score import, durable repetitions, interruptions,
voice/metronome behavior, accessibility, and backup restoration before calling it device-accepted.
Plan Mac-data migration and any remaining desktop feature ports as explicit follow-up work.
