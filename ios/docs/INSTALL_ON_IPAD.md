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

## Weekly Personal Team renewal

The seven-day expiry belongs to the development provisioning profile. Check its actual expiry;
certificate revocation, missing keys and profile membership are separate checks. Renew by rebuilding
and reinstalling the same app with the same team through `npm run ios:refresh`; a paid membership
is not required for this existing personal-device workflow.

If automatic signing retains a stale profile that excludes a trusted development identity, preserve
that precisely matching local cache profile outside Git, let native Xcode regenerate it for the same
app/team/device, and verify the new profile expiry and certificate membership. Download Manual
Profiles can simply download the same stale profile. Do not revoke certificates as a weekly routine.
Use **Product → Build For → Profiling** (Command-Shift-I) for a Release build without running/installing
before resuming the guarded helper. If macOS asks to authorize codesign's key use, enter the Mac
password locally. SecurityAgent is not accessible to automation; passwords remain local.

The October3 renewal profile expires **October10 at17:55:53UTC /1:55PM EDT**. This is a recorded
renewal, not an automatic future schedule. Actual app signing, in-place build6 installation and complete-file preservation pass; the user
confirms launch. Future refreshes must verify those gates again.

The October7 guarded build7 update reuses the still-valid profile with that same October10 expiry. Actual signature/profile/signer trust and same-bundle installation pass; all11 owned files/7,981,365bytes are exactly preserved. Automatic launch failed; subsequent read-only inspection confirms Praelude running and schema5/revision1660, with original history/marks retained. User screen quality and sustained hardware behavior remain separate. Current proof is [build7 personal install](../../docs/qa/ios/2.0.0/build7/personal-ipad-install.json).

## Move an existing signing identity between your Macs

Sharing an existing identity is one recovery path. A new valid certificate/key pair on this Mac
is another; coordinate any replacement or revocation with the Mac using the existing identity.

If Xcode shows the usable development certificate as **Not in Keychain** on this Mac,
recover its certificate **and matching private key** from the Mac where it was created.
Downloading provisioning profiles does not restore that private key.

1. On the source Mac, open **Xcode → Settings → Apple Accounts → your account → Personal Team → Manage Certificates**.
2. Control-click the matching Apple Development certificate and choose **Export Certificate**.
   Save the PKCS#12 (`.p12`) identity with a password entered locally.
3. Transfer that encrypted file locally between your Macs, for example with AirDrop.
4. On the destination Mac, import it into the **login** keychain. Double-click the file,
   or open Keychain Access via Spotlight, choose **File → Import Items**, and select
   **login** as the destination. Enter the export/import passwords locally.
5. Verify certificate trust and usable identity, then run the complete guarded
   `npm run ios:refresh` procedure. Restoring the key does not by itself establish installation.

The `.p12` file and its password stay outside the project documentation and Git.
The repository already ignores `.p12`, `.pem`, `.key` and `.mobileprovision` files.
If export is unavailable on the source Mac too, stop and inspect the signing-key location;
this procedure does not revoke another Mac's certificate or change certificate trust.

Sources: [Apple's identity-export instructions](https://developer.apple.com/documentation/xcode/sharing-your-teams-signing-certificates),
[Keychain import/export](https://support.apple.com/guide/keychain-access/import-and-export-keychain-items-kyca35961/mac),
and [missing-key recovery](https://help.apple.com/xcode/mac/current/en.lproj/dev8a2822e0b.html).

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

## If copying is denied before installation

Unlock the connected iPad, open Praelude, pause any running set and leave the app idle on screen
before retrying. A generic file-permission error does not prove the device is locked. If copying
continues to fail, retain the incomplete copies and inspect the error before another attempt.
On September 14, both the helper's owned-library copy and Xcode's Download Container were denied;
the latter failed on a SplashBoard snapshot cache. After the user confirmed device readiness,
the helper's complete backup succeeded and 1.1 installed with matching pre/post files. The earlier
permission cause remains unproven. A partially downloaded container is not a verified backup. No reinstall, restore or deletion is an accepted workaround for missing data
preservation. See the [current installation](../../docs/qa/ios/1.1.0/personal-ipad-install.json)
and [earlier failed attempts](../../docs/qa/ios/1.1.0/device-update-attempt.json).

## What an install proves

An installed version and successful launch are separate from score/annotation persistence, Pencil,
audio timing, voice, interruptions, accessibility, and backup acceptance on physical hardware.
See the [current native QA ledger](../../docs/qa/ios/README.md). Personal Team installation is personal
testing; App Store/TestFlight distribution remains a separate release path.

**Next steps:** after installation, use disposable data to check the changed flows and record the
device results. Re-run the refresh command when the actual profile expires.
