# Install and refresh on your own iPad

A free **Apple Account / Xcode Personal Team** is enough to run Praelude on your own iPad or iPhone.
You do not need a paid developer membership for this workflow. Personal Team profiles expire
**seven days after issuance**; Apple requires rebuilding and reinstalling after expiration.
The current limits are three registered devices and three installed apps per device.
[Apple's Personal Team rules](https://developer.apple.com/help/account/basics/about-your-developer-account).

## First-time setup

1. Install full Xcode with the iOS SDK. Open `ios/Praelude.xcodeproj` and sign in under
   **Xcode → Settings → Apple Accounts**. Complete sign-in and agreement prompts yourself.
2. Connect the iPad by cable, unlock it, and accept **Trust This Computer**. Choose the iPad in
   Xcode's **Window → Devices and Simulators** and allow preparation to finish.
3. On the iPad, enable **Settings → Privacy & Security → Developer Mode**. Restart when asked,
   then confirm enablement and enter the passcode after restart. The option may appear only after
   pairing with Xcode. [Apple's Developer Mode guide](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).
4. In the Praelude target's **Signing & Capabilities**, select **Automatically manage signing**
   and your **Personal Team**. Use the same account/team for every refresh of this app. Apple's
   [physical-device running guide](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
   explains registration and automatic profile creation.
5. Keep the team selection in `ios/Signing.local.xcconfig`, which is ignored by Git. The committed
   `Signing.xcconfig` includes it optionally, so project regeneration keeps the local selection.
   The file needs one line, using your own team identifier:

   ```xcconfig
   DEVELOPMENT_TEAM = YOUR_PERSONAL_TEAM_ID
   ```

   Find the team identifier in Xcode's signing/build settings; do not paste it into a tracked file
   or this guide. Restrict the local file to your user with `chmod 600 ios/Signing.local.xcconfig`
   when running from the repository root. This file is unnecessary for unsigned/simulator work.

Keep the existing bundle identifier, `com.christian.praelude.ios`, for this installation.
If Xcode rejects the identifier or account, resolve signing before proceeding. The helper refuses
a different identifier and never silently creates a second app or moves your library to it.

## The normal one-command install

From the repository root:

```sh
# Read-only inventory; names are shown without device identifiers
npm run ios:devices

# Explicitly build, sign, back up any existing library, install and launch
npm run ios:install -- --device "YOUR IPAD NAME"
```

From the mobile folder alone, use:

```sh
python3 scripts/device.py install --device "YOUR IPAD NAME"
```

The name must exactly match the device inventory. If exactly one iPhone/iPad is connected, the
name may be omitted. Multiple connected devices require an explicit name; duplicate device names
must be made distinct in **Settings → General → About → Name**. A selected unavailable device
never falls back to another destination.

If the app is already installed, pause/end the practice set and keep the app idle during the update.
The helper refuses a running set, copies and verifies the complete app-owned practice folder,
builds Release using local automatic signing, verifies the signature/profile/expiry/device inclusion,
checks the ledger again, and installs over the same identifier. After confirming the installed
version, it makes one more complete copy and compares every file name, byte count and SHA-256 with
the pre-update backup before launching without test arguments. It does not uninstall, reset data,
terminate an active set, change the bundle identifier, or touch the Mac application.

The helper uses `xcodebuild` and `devicectl`; raw signing/device logs and identifiers are not printed.
Apple may show account or Keychain prompts that you must complete yourself. The script does not
store your Apple password. Build output is under ignored `ios/DeviceDerivedData/`.

## If the first launch is blocked

Developer Mode, **Trust This Computer**, and **Developer App trust** are separate steps. If iPadOS
reports an untrusted developer, open **Settings → General → VPN & Device Management**, select your
**Developer App** entry, and trust your own developer certificate. Complete the device prompts.
Apple describes this Personal Team step in its
[Food Truck sample setup](https://developer.apple.com/documentation/swiftui/food-truck-building-a-swiftui-multiplatform-app).

Then open Praelude on the iPad, or run this command without rebuilding:

```sh
npm run ios:launch -- --device "YOUR IPAD NAME"
```

A failed launch does not imply the install failed. Read the helper's installed-version result,
then follow the device's security message. The script does not claim it can grant Developer App
trust automatically or diagnose every signing error from a generic launch denial.

## Every seven days

Connect and unlock the same iPad. Keep the same Apple Account, Personal Team, and bundle identifier.
From the repository root:

```sh
npm run ios:refresh -- --device "YOUR IPAD NAME"
```

`refresh` follows the same checked build/install path and requires an existing installation.
**Do not delete the app to renew it.** An in-place update retains its data container; deleting the
app can remove that data. The helper also makes a separate local backup before updating.

After signing, the helper prints the profile's actual UTC expiration. Rebuilding before expiry
may reuse a still-valid profile; it does not promise a new seven-day period from every command.
If Xcode cannot renew signing, open the project, confirm the original Personal Team and account,
and resolve its Signing & Capabilities message, then retry. No profile/certificate deletion or
revocation workaround is performed.

For a read-only check:

```sh
npm run ios:status -- --device "YOUR IPAD NAME"
npm run ios:device -- --help
```

Status reports connected-device state, installed version, and the local signed app's profile
expiry when available. **The installed app's profile may differ from that local artifact.** Status
does not launch the app or establish developer trust. Help does not contact Xcode or a device.

## Backups and recovery boundaries

Before an update, the helper copies only this app's `Library/Application Support/Praelude` folder,
including `library.json` and `Scores/`, to:

```text
releases/ios-device-backups/<UTC timestamp>-<random suffix>/
  Praelude/...
  backup.json
```

The folder is ignored by Git and private to your local account. The manifest records file lengths
and SHA-256 checksums without account/device identifiers. A never-used installation may have no
practice folder yet; the manifest records that observation. An unreadable or unsupported ledger,
running set, incomplete copy, or data change before installation stops the update and retains the
copy for review. These are raw local recovery files, not the app's shareable export format; the
helper does not automatically restore or overwrite anything on the device.

An existing-app refresh makes at most **two complete folder copies**: one before the build and one
after installation, plus a small ledger-only recheck immediately before installation. The two full
copies have separate timestamped folders and are retained. After installation, any missing, added,
or changed file—including a PDF whose size did not change—or a failed verification copy stops
launch. The error explicitly says the app is already installed but its data is unverified. Review
the retained copies before launching or restoring; the helper performs neither action on failure.
A first install with no existing app makes no data copies.

Use the app's **Settings → Export backup** periodically for its supported portable backup format.
Keep important backups outside the Mac as well: this private Git repository excludes all practice
data and does not back up either the iPad library or these local recovery folders.

## What an install proves

An installed version and successful launch are separate from score/annotation persistence, Pencil,
audio timing, voice, interruptions, accessibility, and backup acceptance on physical hardware.
See the [current native QA ledger](../../docs/qa/ios/README.md). Personal Team installation is personal
testing; App Store/TestFlight distribution remains a separate release path.

**Next steps:** after installation, use disposable data to check the changed flows and record the
device results. Re-run the refresh command when the actual profile expires.
