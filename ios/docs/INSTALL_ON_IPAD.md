# Install and refresh on your own iPad

## Build11 installation boundary — October 10

**First install confirmed on the friend’s exact `iPad (6)` (iPad8,5, iOS18.7.8):2.0.0/build11 from `646fd6cd26fd6fe6ef81df0dd22da9cdd59fb2d9`, tag `ios-v2.0.0-build11-candidate`.** The guarded `ios:install` helper passes strict signature/target/install-version checks. Developer Mode/DDI are ready. A fresh pre-install query found no Praelude, so this is a generic empty first install: no prior owned inventory existed for comparison and no personal scores, account or backups were copied. This first-install evidence is distinct from the personal same-bundle refresh below.

The first incremental targeted Release had invalid sealed resources; a clean rebuild fixes that packaging failure. Independent pre-install checks pass, including only13 expected bundle files/no personal resources. Independent post-helper checks also pass on the actual installed artifact, executable SHA-256 `ce2373e0e3a61116072ddddbd8e9e219f6faa8d025a528f7683a577d12daf0cd`. Its profile expires October17 at16:14:24 UTC (12:14 PM EDT); revalidate the actual profile on any later update.

The friend’s automatic launch is initially denied. Christian subsequently confirms opening it; its device is unavailable, so initial-library readback is unverified. Core420/native64 and oversized actual UI pass, while final ordinary UI times out before note entry; physical note acceptance is separate. Optional phone checks remain unperformed.

**Personal refresh checkpoint:** snapshots `20261010T162445Z-1f3e7476` → `20261010T162506Z-2d5ab44e` preserve all13 files/13,568,473 bytes and schema5/revision2264 exactly:6 pieces,60 passages,55 historical sets plus1 paused active set (56 unique set IDs),37 sessions,321 attempts,274 ink rows (217 active),2 stamps and4 notes. Profile/privacy/preferences are exact. The paused set remains paused, with zero running sets; it is not an empty active slot. Independent actual-artifact signing passes, with the same `ce2373e0…` executable as the friend’s install and profile expiry October17 at16:14:24 UTC. Personal launch/post-launch retention remains pending.

**Next steps:** confirm personal launch and inspect post-launch data separately. The friend’s user-confirmed launch does not establish initial-library readback or physical note acceptance. Keep unmatched UI/accessibility and B148 acceptance open.

## October 10 — build10 installed; qualified physical improvement

**Installed iPad: native2.0.0/build10/schema5, source `b22d4bf`. Scoped native/UI checks and guarded installation pass; the user reports qualified improvement after the selection/Cancel comparison. Macv11.1.0/schema21 is unchanged.** After accepting the earlier named interactions, the user reports that Prokofiev passage creation has no visible corner dots and lags badly, while Beethoven handles are smooth. That earlier acceptance does not establish consistency across scores. This new defect is B146.

Confirmed PDF metadata differs sharply: Prokofiev page10 is5609.6×7764.01 points; Beethoven page4 is626.76×874.92 points. The old overlay's minimum content scale of1 defeats its4-million-pixel cap on the larger page, permitting about43.55 million pixels;8-source-point handles shrink below1 screen point. These identify page-size-dependent rendering and handle-visibility defects. Overlay/state repairs are implemented and two fresh source reviews find no new blocker. Final ordinary/oversized selection UI passes on both iPad and iPhone, including blank/drawn Cancel, Undo/Redo/save and adding a second box to a saved passage, canceling, then reopening the original one-box baseline. All48 selected native checks pass on phone; iPad passes42 existing plus6 new checks across the recorded runs. Four independently accepted screenshots show consistent handles/borders and unclipped Cancel/Done. These are scoped checks, not a full-suite or performance-rate claim; earlier failures and the zero-test run remain in QA. Build10 is installed. Christian now replies “good it works better” to the selection/Cancel comparison. This is qualified improvement, not measured latency or zero-defect acceptance. The raster cap does not bound total PencilKit cache/RAM; the pre-existing cropped-resize limitation when the opposite edge is hidden remains.

The user also reports that selection Cancel does not work (B147). The installed repair makes explicit Cancel immediately discard only the draft and return to the score, preserving any saved baseline; navigating away retains its separate confirmation guard. Actual UI on both devices passes empty/drawn Cancel and verifies a saved passage retains its original one-box baseline after canceling an added second box.

**Installed build10 checkpoint:** source `b22d4bf3e25ff7309ff55ad3b700d5bb5f2713ea`, tag `ios-v2.0.0-build10-candidate`, is installed by guarded same-bundle refresh. Independent complete pre/post audit verifies all13 owned files/13,350,814 bytes identical by filename, size and SHA-256. The preserved schema5/revision2198 snapshot has6 pieces/57 passages/54 historical sets/35 sessions/317 attempts/270 ink rows (213 active)/2 stamps/2 notes and no active set. Actual post-helper strict signing and app/dSYM checks pass; profile expires October16 at23:56:11 UTC (7:56 PM EDT). Automatic launch was denied, but a subsequent read-only process inspection confirms build10 running; this is not attributed to a user opening confirmation. Independent post-launch retention at October10 14:58:32 UTC also passes: all13 files/13,350,814 bytes and the complete schema5/revision2198 ledger are identical across all three snapshots, including profile/privacy/account/preferences, sync files and source PDFs. There is no active set or added persisted activity; authorship is not inferred. Christian subsequently reports “good it works better” in the selection/Cancel comparison; retain that qualified improvement without inferring every edge case or sustained reliability.

**Next steps:** retain the qualified selection/Cancel improvement and verify the separate sticky-note repair (B148). Installation, running-process observation and complete post-launch preservation pass. Preserve the earlier build9 acceptance and failure history. Evidence and pending checks: `docs/qa/ios/2.0.0/build10/selection-consistency.md`.

## Historical October 10 — build9 named physical interactions accepted

**Installed iPad: native2.0.0/build9/schema5 from `2de2444`. Launch/readback and named physical interactions pass. Broader acceptance remains scoped below. Mac:v11.1.0/schema21 unchanged.** On the iPad Pro12.9-inch (3rd generation, iPad8,5), iOS18.7.8, the prior build8 report was that the score cannot zoom while ink pans, Clean takes about one second, scrolling/menu/mode changes and warmup exit are delayed, passage selection updates about once every four seconds, and Pencil use crashes. These are physical observations, not accepted performance limits.

A45-second physical build8 Time Profiler capture records18.293 seconds of main-thread sampled CPU time, including12.276 seconds in `syncAll`. Instruments identifies14 hang/microhang intervals, the longest2.0187 seconds. The leading stack is `String(format:)` → `Data.praeludeHexLiteral` → `InkStrokeSyncRow` → `enqueueLibrarySnapshot` → scheduled `syncAll`. Inclusive samples overlap; hang duration is not measured touch-to-frame latency. These are build8 measurements, not evidence of build9 improvement. Sanitized evidence is `docs/qa/ios/2.0.0/build9/build8-physical-performance.json`.

Installed build9 source repairs: PDFKit owns page pan/zoom while the drawing canvas stays fixed; bounded app-owned drawing-value history replaces native tile Undo registrations; durable practice sync entries batch in parent-before-child order with debounced draining and account/revision-scoped snapshot reuse; a byte lookup replaces per-byte NSString formatting while retaining the existing hex wire format. Core412 and full native258 (1 live-account skip,0 failures) pass before the final gesture-priority change; two iPad practice/selection UI cases also pass. The earlier actual pinch failure is retained in QA. Undo now waits for the native pinch recognizer to fail and cannot recognize simultaneously. All14 targeted native interaction tests and fresh source review pass after that change. Actual UI5x pinch raises PDF scale to2.3177427145 from minimum1.0255516841 with the ink stroke retained; independent before/after pixel review accepts score/ink alignment and the settled palette. Actual two-finger Undo passes in Draw and reading. Two attempts to place the zoomed two-finger tap through XCTest fail because the target lies in a clipped viewport; this does not establish a production failure or a pass. The final gesture UI passes70.518 seconds: actual stroke, two-finger Undo in Draw/reading, Redo, mode change, strict real PDF pinch with unchanged ink, toolbar Undo/Redo at zoom, Done and saved ink after relaunch. Physical two-finger Undo at zoom remains pending. Source is frozen. Signed device build9 Release and strict app/profile/team/device/signer-trust and Release fixture/debug-exclusion checks pass. The same-bundle profile expires October16 at23:56:11 UTC (7:56 PM EDT). Independent signed-artifact verification and guarded installation also pass. Build9 is installed and running; independent post-launch preservation passes. On October10, the user confirms score pinch-zoom, Pencil marks → Done, two-finger Undo, passage selection and button response: “Those actions work and feel responsive.” These named interactions are user-accepted on source `2de2444`; measured latency, Undo specifically while zoomed, microphone/two-device behavior and sustained or week-long reliability remain unverified.

**Installed build9 checkpoint:** source `2de2444a782cb54a5cd31966ecc33257e4511dd0`, tag `ios-v2.0.0-build9-candidate`, is installed through the guarded same-bundle refresh. Independent review verifies all13 owned files/12,960,329 bytes identical by filename, size and SHA-256 before launch. Schema5/revision2167 retains6 pieces/53 passages/54 set IDs (53 historical plus1 paused active set)/35 sessions/317 attempts/259 ink records (202 active)/2 stamps/2 notes. The paused set is preserved; it is not a running set or an empty active slot. Actual post-helper Release signing/profile checks pass; expiry remains October16 at23:56:11 UTC (7:56 PM EDT). iOS denied automatic launch, then the user confirmed opening build9 and read-only process inspection confirmed it running. Independent complete post-launch readback at October10 00:57:50 UTC (October9 8:57:50 PM EDT) verifies the same13 files/12,960,329 bytes unchanged, schema5/revision2167 and every original record including the paused set. Undo specifically while zoomed and sustained practice remain unverified. Both build9 traces completed but were effectively idle: the45-second trace has12 all-thread samples/5 main-thread CPU milliseconds; the120-second trace has15 all-thread samples/8 main-thread samples (8 milliseconds). Neither reports potential hangs, but neither proves active score gestures or a speedup; foreground lifecycle is unknown. The October10 user confirmation accepts the named actions separately from these inconclusive traces. Evidence: `docs/qa/ios/2.0.0/build9/personal-ipad-install.json`.

**Next steps:** continue practice with the accepted interactions; separately verify combined zoomed Undo, microphone/two-device paths and sustained use. Capture active-use profiling if a latency issue recurs. Preserve the paused set and keep installation/preservation separate from physical acceptance. No week-long or zero-defect claim is supported.

Evidence and planned checks: `docs/qa/ios/2.0.0/build9/responsiveness-regressions.md`; the separate Undo repair ledger is `docs/qa/ios/2.0.0/build9/undo-repair.md`.

## October 9 delivery status

**Build8 (2.0.0/build8/schema5) is installed; the user reports a confirmed native Undo crash after opening.** The guarded refresh installed build8, and the user confirmed opening it before reporting an unresolved failure. Phone1 completes242 native tests with1 live-account skip/0 failures; repaired iPad UI12 completes243/1 skip/0 failures and passes actual sticky edit/relaunch plus accessibility portrait/landscape. Phone2 actual passage rename passes52.388s and selection Done is reachable both ways, but later landscape annotation exposes a3-pixel tool viewport. Phone3 now passes the repaired accessibility portrait/landscape flow in 71.631 seconds, with independent screenshot acceptance. UI13 records new note-accessibility frame and triple-tap target failures; the subsequent repair passes actual sticky double/triple-tap and permission-denied recovery in UI14 (71.060 seconds). UI15 repeats the complete actual sticky triple-tap/recovery flow successfully in 59.539 seconds. Native245/1 live-account skip still has two frame assertions failing in one case, now with a zero frame. A detached test fixture is suspected; the test now asynchronously mounts a real UIWindowScene/window and asserts overlay.window identity before applying the transform. Only the test fixture changed after the UI15 production source. The final strict native run now passes245 tests/1 live-account skip/0 failures in16.881s; mounted-scene/window identity and crop/zoom assertions pass. These remain separate source checkpoints. Final source review, signed Release and guarded installation pass; the new physical failure remains open; the [build8 ledger](../../docs/qa/ios/2.0.0/build8/usability-review.md) separates these from installation, preservation and physical acceptance. Six physical build7 watchdog reports and one CPU report now identify the synchronous PDFKit/SwiftUI responder-cycle path; the deferred/coalesced candidate repair passes hosted tests but still needs physical repetition after installation. These reports do not attribute the separate microphone complaint. Never erase the app to troubleshoot them. Mac v11.1.0/schema21 stays unchanged.

When an exact uniquely named device has an on-demand connection, the helper now requests its details to activate Apple's tunnel before applying the normal readiness checks. This read-only probe does not select a different device, change pairing, terminate Praelude or bypass the backup. Three new regressions bring the helper suite to 57 tests. If the selected device remains unavailable, the helper still stops.

Use `npm run ios:refresh -- --device "YOUR IPAD NAME"` only after candidate gates pass. Recheck current signing/profile/device validity; the older recorded profile expiry is historical evidence, not permission to skip validation. Preserve the existing bundle/team, create the complete owned-file backup, refuse an active running set, install in place, and compare every pre/post filename, size and SHA-256 before launch. Keep installation, complete-file preservation, launch/readback and actual Pencil/audio acceptance as separate results. Never uninstall, reset, restore over data or terminate an active practice session as a workaround.

**Installed build8 — physical Undo crash remains open:** native2.0.0/build8/schema5 from `a23cdec4f4f9acf42e8e5c724b6a386430dddca5` is installed. Independent review verifies all13 owned files/12,788,247 bytes unchanged by filename, size and SHA-256 before launch. Automatic launch was declined; the user opened the app. The23:59:40 UTC readback retains schema5/revision2086 (from2079),6 pieces/51 passages/50 sets/31 sessions/304 attempts/255 ink records (199 active)/2 stamps/2 notes. Original records remain exact except one piece page bookmark; profile/privacy/account/score data are exact. This readback precedes the23:59:53 UTC crash and is not post-crash retention proof. The user reported failure at19:59:56 EDT. Matching build8 dSYM identifies main-thread `EXC_BAD_ACCESS` at0x10 in `PKTiledView.performUndo` tile update, reached through the two-finger Undo action; this is distinct from the build7 PDF watchdog. Exact user sequence remains pending and the crash is unclosed. Signed Release checks pass, with profile valid through October16 at23:56:11 UTC (7:56 PM EDT). Sanitized evidence: `docs/qa/ios/2.0.0/build8/personal-ipad-install.json`. Mac v11.1.0/schema21 is unchanged.

**Next steps:** obtain the exact user sequence and reproduce the confirmed native two-finger Undo crash before accepting its repair. Keep the23:59:40 UTC readback separate from post-crash retention. Keep physical Pencil, microphone, large-score and sustained-use acceptance open; do not treat installation as task completion.

**October 7 user confirmation:** Christian confirms the update reached the iPad. This confirms installation; sustained Pencil, audio, freeze recovery, refresh rate and real two-device behavior still require physical acceptance. The complete implementation, verification and deployment handoff is `docs/qa/ios/2.0.0/build7/session-handoff.md` (source `3e03330`, installation record `2227817`).

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
