#!/usr/bin/env python3
"""Explicit, data-preserving Personal Team deployment using Apple's tools.

No arguments prints help without contacting Xcode or a device. Device identifiers,
profiles, signing output, and raw command logs stay in private temporary storage.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile
import uuid

IOS_ROOT = Path(__file__).resolve().parents[1]
BUNDLE_ID = "com.christian.praelude.ios"
UTC = dt.timezone.utc
TRUST_HELP = (
    "If iPad/iPhone reports an untrusted developer, open Settings > General > "
    "VPN & Device Management > Developer App and trust your own developer. "
    "Then run the launch command again."
)


class DeviceError(Exception):
    """A deliberately sanitized, user-actionable failure."""


class Runner:
    def run(self, command: list[str], failure: str, timeout: int = 120) -> bytes:
        # No shell expansion, inherited test environment, or raw tool output.
        environment = {
            key: value for key, value in os.environ.items()
            if not key.startswith(("DEVICECTL_CHILD_", "SIMCTL_CHILD_"))
        }
        try:
            completed = subprocess.run(
                command, capture_output=True, timeout=timeout, env=environment,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise DeviceError(f"{failure} The Apple tool timed out.") from None
        except OSError:
            raise DeviceError(f"{failure} Check that full Xcode is installed and selected.") from None
        if completed.returncode:
            raise DeviceError(failure)
        return completed.stdout

    def device(self, arguments: list[str], failure: str, timeout: int = 90) -> dict:
        # devicectl documents JSON as its only supported scripting interface.
        with tempfile.TemporaryDirectory(prefix="praelude-device-") as directory:
            output = Path(directory) / "result.json"
            self.run(
                ["xcrun", "devicectl", *arguments, "--json-output", str(output),
                 "--timeout", str(timeout)], failure, timeout + 15,
            )
            try:
                document = json.loads(output.read_text())
                if document["info"]["outcome"] != "success":
                    raise DeviceError(failure)
                result = document["result"]
                if not isinstance(result, dict):
                    raise ValueError()
                return result
            except (OSError, ValueError, KeyError, TypeError):
                raise DeviceError(f"{failure} Apple returned an unexpected JSON result.") from None


def device_name(device: dict) -> str:
    return str(device.get("deviceProperties", {}).get("name", "Unnamed device"))


def physical_devices(result: dict) -> list[dict]:
    devices = result.get("devices")
    if not isinstance(devices, list):
        raise DeviceError("Apple returned an unexpected device list.")
    return [device for device in devices if isinstance(device, dict)
            and device.get("hardwareProperties", {}).get("deviceType") in ("iPad", "iPhone")
            and device.get("hardwareProperties", {}).get("platform") == "iOS"]


def select_device(devices: list[dict], name: str | None) -> dict:
    # A named disconnected device must never silently select another destination.
    if name:
        matches = [device for device in devices if device_name(device) == name]
        if len(matches) != 1:
            raise DeviceError("Device name must match exactly one iPad/iPhone. Run devices; "
                              "rename duplicate device names in Settings > General > About.")
        selected = matches[0]
    else:
        connected = [device for device in devices if device.get("connectionProperties", {})
                     .get("tunnelState") == "connected"]
        if len(connected) > 1:
            raise DeviceError("More than one iPad/iPhone is connected. Choose one explicitly "
                              "with --device \"exact device name\".")
        if not connected:
            raise DeviceError("No connected iPad/iPhone. Connect by cable, unlock it, accept "
                              "Trust This Computer, and open Xcode's Devices and Simulators.")
        selected = connected[0]
    if selected.get("connectionProperties", {}).get("tunnelState") != "connected":
        raise DeviceError("The selected device is unavailable. Connect and unlock that device, "
                          "then retry; another device will not be substituted.")
    if not selected.get("identifier"):
        raise DeviceError("Apple did not supply a usable device connection.")
    return selected


def require_device_ready(details: dict) -> None:
    connection = details.get("connectionProperties", {})
    properties = details.get("deviceProperties", {})
    if connection.get("pairingState") != "paired":
        raise DeviceError("Pair the device with Xcode and accept Trust This Computer first.")
    if properties.get("developerModeStatus") != "enabled":
        raise DeviceError("Enable Settings > Privacy & Security > Developer Mode on the device, "
                          "restart, confirm enablement after restarting, then reconnect.")
    if properties.get("bootState") != "booted" or not properties.get("ddiServicesAvailable"):
        raise DeviceError("Device development services are not ready. Unlock the device and "
                          "let Xcode's Devices and Simulators finish preparing it.")
    if not details.get("hardwareProperties", {}).get("udid"):
        raise DeviceError("Apple did not supply the device information needed to verify signing.")


def read_local_team(ios_root: Path) -> str:
    try:
        content = (ios_root / "Signing.local.xcconfig").read_text()
    except OSError:
        raise DeviceError("Create ios/Signing.local.xcconfig with your local DEVELOPMENT_TEAM "
                          "selection. See ios/docs/INSTALL_ON_IPAD.md.") from None
    matches = re.findall(r"^\s*DEVELOPMENT_TEAM\s*=\s*([A-Z0-9]{10})\s*(?://[^\n]*)?$",
                         content, re.MULTILINE)
    if len(matches) != 1:
        raise DeviceError("Local signing needs one DEVELOPMENT_TEAM = your team identifier "
                          "line. Keep this value only in ignored Signing.local.xcconfig.")
    return matches[0]


def validate_profile(profile: dict, team: str, udid: str | None,
                     now: dt.datetime | None = None) -> dt.datetime:
    now = now or dt.datetime.now(UTC)
    expiry = profile.get("ExpirationDate")
    if not isinstance(expiry, dt.datetime):
        raise DeviceError("The signing profile has no valid expiration date.")
    expiry = expiry.replace(tzinfo=UTC) if expiry.tzinfo is None else expiry.astimezone(UTC)
    if expiry <= now:
        raise DeviceError("The provisioning profile has expired. Rebuild with the same Personal "
                          "Team in Xcode, then run refresh again. Do not delete the app.")
    entitlements = profile.get("Entitlements", {})
    if team not in profile.get("TeamIdentifier", []):
        raise DeviceError("The profile does not match local signing. Keep the same original "
                          "Personal Team when refreshing an existing installation.")
    if entitlements.get("application-identifier") != f"{team}.{BUNDLE_ID}":
        raise DeviceError("The profile is not for this app's stable identifier. Check Xcode "
                          "signing; this helper never changes the bundle identifier.")
    if not entitlements.get("get-task-allow"):
        raise DeviceError("Use a development profile from your Personal Team for cable installation.")
    if udid is not None and udid not in profile.get("ProvisionedDevices", []):
        raise DeviceError("The profile does not include the selected device. Select it in Xcode "
                          "and let automatic signing register it, then retry.")
    return expiry


def verify_app(runner: Runner, app: Path, team: str,
               udid: str | None = None) -> tuple[dict, dt.datetime]:
    try:
        info = plistlib.loads((app / "Info.plist").read_bytes())
        if info.get("CFBundleIdentifier") != BUNDLE_ID:
            raise DeviceError("Built app identifier differs from Praelude. No installation attempted.")
        executable_name = info.get("CFBundleExecutable")
        if not isinstance(executable_name, str) or Path(executable_name).name != executable_name:
            raise DeviceError("Built app has an invalid executable name.")
        executable = (app / executable_name).read_bytes()
        if b"--uitesting" in executable or b"--seed" in executable or list(app.rglob("*.xctest")):
            raise DeviceError("The app contains UI-test fixtures or plug-ins. Use a normal Release build.")
    except (OSError, ValueError, plistlib.InvalidFileException):
        raise DeviceError("No valid signed Release app was found. Run install or refresh to build it.") from None
    runner.run(["codesign", "--verify", "--deep", "--strict", str(app)],
               "Code-signature verification failed. Open Xcode's Signing & Capabilities to repair it.")
    raw = runner.run(["security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")],
                     "A valid embedded development profile is required; unsigned builds cannot install.")
    try:
        profile = plistlib.loads(raw)
    except (ValueError, plistlib.InvalidFileException):
        raise DeviceError("The embedded development profile could not be decoded.") from None
    return info, validate_profile(profile, team, udid)


def print_expiry(expiry: dt.datetime) -> None:
    remaining = max(0, int((expiry - dt.datetime.now(UTC)).total_seconds() / 3600))
    print(f"Provisioning expires {expiry:%Y-%m-%d %H:%M:%S} UTC ({remaining} hours remaining).")
    print("Personal Team profiles last seven days from issuance. Refresh with the same team and app ID.")


def app_path(ios_root: Path) -> Path:
    return ios_root / "DeviceDerivedData/Build/Products/Release-iphoneos/Praelude.app"


def build_app(runner: Runner, ios_root: Path, udid: str) -> Path:
    print("Building and signing Release with Xcode; this may take a few minutes…", flush=True)
    runner.run([
        "xcodebuild", "-project", str(ios_root / "Praelude.xcodeproj"), "-scheme", "Praelude",
        "-configuration", "Release", "-sdk", "iphoneos", "-destination", f"id={udid}",
        "-jobs", "2", "OTHER_SWIFT_FLAGS=$(inherited) -j2 -driver-batch-count 2",
        "-derivedDataPath", str(ios_root / "DeviceDerivedData"),
        "-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration", "build",
    ], "Release build/signing failed. Open Praelude.xcodeproj, sign in under Xcode > Settings > "
       "Apple Accounts, then inspect Signing & Capabilities for the same Personal Team. "
       "Raw signing output is deliberately not printed.", timeout=1800)
    return app_path(ios_root)


def installed_app(runner: Runner, identifier: str) -> dict | None:
    result = runner.device([
        "device", "info", "apps", "--device", identifier, "--bundle-id", BUNDLE_ID,
    ], "Could not check the installed app. Unlock the device and reconnect before retrying.")
    apps = result.get("apps")
    if not isinstance(apps, list):
        raise DeviceError("Apple returned an unexpected installed-app result.")
    return next((app for app in apps if app.get("bundleIdentifier") == BUNDLE_ID), None)


def remote_library_files(runner: Runner, identifier: str) -> dict[str, dict]:
    result = runner.device([
        "device", "info", "files", "--device", identifier,
        "--domain-type", "appDataContainer", "--domain-identifier", BUNDLE_ID,
    ], "Cannot inspect Praelude's data container. Unlock the device; no update will proceed without a backup.")
    if not isinstance(result.get("files"), list):
        raise DeviceError("Apple returned an unexpected file listing. No update attempted.")
    prefix = "Library/Application Support/Praelude"
    files = {}
    for entry in result["files"]:
        path = str(entry.get("relativePath", "")).removeprefix("./").rstrip("/")
        if path == prefix or path.startswith(prefix + "/"):
            relative = path[len(prefix):].lstrip("/")
            if ".." in Path(relative).parts or entry.get("resources", {}).get("isSymbolicLink"):
                raise DeviceError("Unexpected link or path in the app library. No update attempted.")
            files[relative] = entry
    return files


def validate_library(data: bytes) -> dict:
    try:
        state = json.loads(data)
        if not isinstance(state, dict) or type(state.get("schemaVersion")) is not int or state.get("schemaVersion") not in (1, 2, 3, 4):
            raise ValueError()
        active = state.get("activeSet")
        if active is not None and (not isinstance(active, dict) or
                                   active.get("status") not in ("running", "paused", "completed")):
            raise ValueError()
    except (ValueError, TypeError):
        raise DeviceError("The saved library is unreadable or uses an unsupported format. "
                          "Its local copy is preserved; repair/review it before an update.") from None
    if active and active.get("status") == "running":
        raise DeviceError("A practice set is running. Pause or end it in Praelude, then run refresh again. "
                          "The helper will not interrupt a running set.")
    return state


def copy_from_device(runner: Runner, identifier: str, source: str, destination: Path) -> None:
    runner.device([
        "device", "copy", "from", "--device", identifier,
        "--domain-type", "appDataContainer", "--domain-identifier", BUNDLE_ID,
        "--source", source, "--destination", str(destination),
    ], "Could not copy Praelude's data safely. Unlock the device and retry; no installation attempted.",
        timeout=180)


def backup_library(runner: Runner, identifier: str, ios_root: Path, current: dict) -> tuple[Path, bytes | None]:
    remote = remote_library_files(runner, identifier)
    backups = ios_root.parent / "releases/ios-device-backups"
    backups.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory = backups / (dt.datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:8])
    directory.mkdir(mode=0o700)
    manifest = {"bundleIdentifier": BUNDLE_ID, "version": current.get("version"),
                "build": current.get("bundleVersion"), "createdUTC": dt.datetime.now(UTC).isoformat(),
                "libraryPresent": bool(remote), "files": {}}
    data = None
    if remote:
        destination = directory / "Praelude"
        copy_from_device(runner, identifier, "Library/Application Support/Praelude", destination)
        # Directory copies target this path; never silently accept an extra nesting level.
        files = {path.relative_to(destination).as_posix(): path for path in destination.rglob("*")
                 if path.is_file()}
        expected = {path: entry for path, entry in remote.items()
                    if not entry.get("resources", {}).get("isDirectory")}
        if set(files) != set(expected) or any(path.is_symlink() for path in destination.rglob("*")):
            raise DeviceError("Backup contents differ from the device file listing. Copy preserved; no update attempted.")
        for relative, path in files.items():
            path.chmod(0o600)
            content = path.read_bytes()
            if len(content) != expected[relative].get("metadata", {}).get("size"):
                raise DeviceError("A backup file has an unexpected size. Copy preserved; no update attempted.")
            manifest["files"][relative] = {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
        if "library.json" in files:
            data = files["library.json"].read_bytes()
            validate_library(data)
        elif files:
            raise DeviceError("The existing library has files but no ledger. Copy preserved; review before updating.")
        after = remote_library_files(runner, identifier)
        def revision(entries: dict) -> dict:
            return {key: (entry.get("metadata", {}).get("size"), entry.get("metadata", {}).get("lastModDate"))
                    for key, entry in entries.items()}
        if revision(remote) != revision(after):
            raise DeviceError("The library changed during backup. Pause practice, leave Praelude idle, and retry.")
    (directory / "backup.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (directory / "backup.json").chmod(0o600)
    print(f"Local backup verified: {directory.relative_to(ios_root.parent)}")
    return directory, data


def confirm_library_unchanged(runner: Runner, identifier: str, saved: bytes | None) -> None:
    remote = remote_library_files(runner, identifier)
    if "library.json" not in remote:
        if saved is not None:
            raise DeviceError("The device ledger disappeared after backup. No update attempted.")
        return
    with tempfile.TemporaryDirectory(prefix="praelude-ledger-check-") as directory:
        path = Path(directory) / "library.json"
        copy_from_device(runner, identifier, "Library/Application Support/Praelude/library.json", path)
        try:
            data = path.read_bytes()
        except OSError:
            raise DeviceError("The final ledger check failed. No update attempted.") from None
        validate_library(data)
        if data != saved:
            raise DeviceError("Practice data changed after backup. Leave Praelude paused and idle, "
                              "then retry to make a fresh backup before updating.")



def confirm_installed_library_unchanged(runner: Runner, identifier: str, ios_root: Path,
                                       backup: Path, current: dict) -> None:
    """Make the second and final full copy; no launch until every saved byte matches.

    Both copies remain in ignored local backup folders for review. Comparing only
    library.json would miss deletion or same-size mutation of a score PDF.
    """
    try:
        before = json.loads((backup / "backup.json").read_text())["files"]
        after_directory, _ = backup_library(runner, identifier, ios_root, current)
        after = json.loads((after_directory / "backup.json").read_text())["files"]
        if before != after:
            raise DeviceError("Installed library file inventory or hashes differ.")
    except (DeviceError, OSError, ValueError, KeyError, TypeError):
        raise DeviceError("The app installed, but its complete library and score files could not be "
                          "confirmed unchanged. The pre-update local backup and any post-install "
                          "copy are retained. No launch was requested. Do not launch or restore over "
                          "the device library until the difference is reviewed.") from None
    print("Installed app's complete library and score file hashes match the pre-update backup.")


def launch_app(runner: Runner, identifier: str) -> None:
    runner.device([
        "device", "process", "launch", "--device", identifier,
        "--environment-variables", "{}", BUNDLE_ID,
    ], "The app did not launch. Unlock the device and check its security message. " + TRUST_HELP)
    print("Praelude launched. Installation does not establish hardware feature acceptance.")


def execute(action: str, name: str | None, runner: Runner, ios_root: Path = IOS_ROOT) -> None:
    if action not in ("devices", "status", "install", "refresh", "launch"):
        raise DeviceError("Choose an explicit supported action; use --help for available commands.")
    devices = physical_devices(runner.device(["list", "devices"],
        "Could not read devices. Select full Xcode and open Devices and Simulators."))
    if action == "devices":
        if not devices:
            print("No known iPad/iPhone. Connect and unlock one, then open Xcode's Devices and Simulators.")
        for device in devices:
            properties = device.get("deviceProperties", {})
            connection = device.get("connectionProperties", {})
            print(f"{device_name(device)} — {device.get('hardwareProperties', {}).get('deviceType')} "
                  f"{properties.get('osVersionNumber', '?')} — "
                  f"{connection.get('tunnelState', 'unavailable')} — "
                  f"Developer Mode: {properties.get('developerModeStatus', 'unknown')}")
        return
    selected = select_device(devices, name)
    identifier = selected["identifier"]
    details = runner.device(["device", "info", "details", "--device", identifier],
                            "Could not read the selected device. Connect and unlock it.")
    print(f"Selected: {device_name(selected)}")
    properties = details.get("deviceProperties", {})
    print(f"Developer Mode: {properties.get('developerModeStatus', 'unknown')}")
    if action == "status":
        current = installed_app(runner, identifier)
        print(f"Installed: {current.get('version', '?')} (build {current.get('bundleVersion', '?')})"
              if current else "Praelude is not installed on the selected device.")
        candidate = app_path(ios_root)
        if not candidate.exists():
            candidate = ios_root.parent / "releases/ios-personal/Praelude.app"
        if candidate.exists():
            _, expiry = verify_app(runner, candidate, read_local_team(ios_root),
                                   details.get("hardwareProperties", {}).get("udid"))
            print_expiry(expiry)
            print("Expiry belongs to the local signed app; the installed profile may differ.")
        else:
            print("No local signed app to inspect. The installed profile expiry is not exposed here.")
        print("Developer App trust is checked by an explicit launch, not by this read-only status.")
        return
    require_device_ready(details)
    if action == "launch":
        launch_app(runner, identifier)
        return
    team = read_local_team(ios_root)
    current = installed_app(runner, identifier)
    if action == "refresh" and current is None:
        raise DeviceError("Refresh expects an existing Praelude installation. Use install for the first install.")
    print("The existing app and its data will not be deleted. Keep practice paused and the app idle.")
    saved = None
    backup = None
    if current:
        backup, saved = backup_library(runner, identifier, ios_root, current)
    udid = details["hardwareProperties"]["udid"]
    candidate = build_app(runner, ios_root, udid)
    info, expiry = verify_app(runner, candidate, team, udid)
    print_expiry(expiry)
    # A long build can outlast the cable connection or a Developer Mode restart.
    require_device_ready(runner.device(["device", "info", "details", "--device", identifier],
                                       "Device disconnected after the build. No installation attempted."))
    if current:
        confirm_library_unchanged(runner, identifier, saved)
    print("Installing over the same app identifier…", flush=True)
    runner.device(["device", "install", "app", "--device", identifier, str(candidate)],
                  "Installation failed. The helper did not uninstall the existing app. Unlock/reconnect "
                  "the device and check Xcode's signing message; do not delete Praelude.", timeout=180)
    current = installed_app(runner, identifier)
    if current is None or (str(current.get("version")), str(current.get("bundleVersion"))) != (
            str(info.get("CFBundleShortVersionString")), str(info.get("CFBundleVersion"))):
        raise DeviceError("The install command completed, but the expected installed version was not "
                          "confirmed. Check Xcode's device listing before retrying.")
    print(f"Installed Praelude {current['version']} (build {current['bundleVersion']}).")
    if backup is not None:
        confirm_installed_library_unchanged(runner, identifier, ios_root, backup, current)
    launch_app(runner, identifier)


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build/re-sign and install Praelude on your own iPad/iPhone using Xcode. "
                    "No arguments or --help is read-only and does not contact Xcode/devices.",
        epilog="Setup and seven-day refresh: ios/docs/INSTALL_ON_IPAD.md. "
               "No uninstall, data reset, fixture arguments, paid account, or stored Apple password.",
    )
    parser.add_argument("action", nargs="?", choices=("devices", "status", "install", "refresh", "launch"),
                        help="devices/status read only; install/refresh build, sign, install and launch; "
                             "launch opens the installed app without rebuilding")
    parser.add_argument("--device", metavar="NAME", help="exact device name; required when multiple are connected")
    args = parser.parse_args(arguments)
    if not args.action:
        parser.print_help()
        return 0
    try:
        execute(args.action, args.device, Runner())
    except DeviceError as error:
        print(f"Praelude: {error}", file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError):
        print("Praelude: Could not safely read/write local deployment files or decode an Apple result. "
              "Review local permissions and Xcode status before retrying. No uninstall was requested.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Stopped. No uninstall or data reset was requested.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
