"""Deployment safety checks. All Apple/device commands are replaced by fakes."""
import contextlib
import copy
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("device", Path(__file__).with_name("device.py"))
device = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(device)
TEAM = "TESTTEAM01"
UDID = "synthetic-device-id"
DETAILS = {
    "identifier": "synthetic-connection", "connectionProperties": {"tunnelState": "connected", "pairingState": "paired"},
    "deviceProperties": {"name": "Practice iPad", "developerModeStatus": "enabled", "bootState": "booted", "ddiServicesAvailable": True},
    "hardwareProperties": {"deviceType": "iPad", "platform": "iOS", "udid": UDID},
}
PROFILE = {"ExpirationDate": dt.datetime.now(device.UTC) + dt.timedelta(days=6), "TeamIdentifier": [TEAM],
           "ProvisionedDevices": [UDID], "Entitlements": {"application-identifier": f"{TEAM}.{device.BUNDLE_ID}", "get-task-allow": True}}


class FakeRunner:
    def __init__(self, root, existing=True, state=None):
        self.root = root
        self.commands = []
        self.details = copy.deepcopy(DETAILS)
        self.existing = existing
        self.version = "1.0.0"
        self.state = state or {"schemaVersion": 1, "activeSet": None, "pieces": []}
        self.files = {"library.json": json.dumps(self.state).encode(), "Scores/example.pdf": b"%PDF-synthetic"}
        self.profile = copy.deepcopy(PROFILE)
        self.fail_copy = False
        self.mutate_during_build = False
        self.fixture = False
        self.mutate_during_install = False
        self.pdf_change_during_install = None
        self.fail_copy_after_install = False
        self.did_install = False

    def run(self, command, failure, timeout=120):
        self.commands.append(command)
        if command[0] == "xcodebuild":
            app = device.app_path(self.root)
            app.mkdir(parents=True)
            (app / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": device.BUNDLE_ID,
                "CFBundleExecutable": "Praelude", "CFBundleShortVersionString": "1.1.0", "CFBundleVersion": "2"}))
            (app / "Praelude").write_bytes(b"--uitesting" if self.fixture else b"release binary")
            if self.mutate_during_build:
                self.files["library.json"] = json.dumps({"schemaVersion": 1, "activeSet": None, "revision": 2}).encode()
        if command[0] == "security":
            profile = copy.deepcopy(self.profile)
            profile["ExpirationDate"] = profile["ExpirationDate"].replace(tzinfo=None)
            return plistlib.dumps(profile)
        return b""

    def device(self, args, failure, timeout=90):
        self.commands.append(args)
        if args[:2] == ["list", "devices"]:
            return {"devices": [self.details]}
        if args[1:3] == ["info", "details"]:
            return self.details
        if args[1:3] == ["info", "apps"]:
            return {"apps": [{"bundleIdentifier": device.BUNDLE_ID, "version": self.version,
                "bundleVersion": "2" if self.version == "1.1.0" else "1"}] if self.existing else []}
        if args[1:3] == ["info", "files"]:
            prefix = "Library/Application Support/Praelude"
            return {"files": [{"relativePath": prefix, "resources": {"isDirectory": True}, "metadata": {"size": 0}}] + [
                {"relativePath": f"{prefix}/{name}", "resources": {"isDirectory": False},
                 "metadata": {"size": len(data), "lastModDate": "synthetic"}} for name, data in self.files.items()]}
        if args[1:3] == ["copy", "from"]:
            if self.fail_copy or (self.fail_copy_after_install and self.did_install):
                raise device.DeviceError(failure)
            target = Path(args[args.index("--destination") + 1])
            source = args[args.index("--source") + 1]
            if source.endswith("library.json"):
                target.write_bytes(self.files["library.json"])
            else:
                for relative, data in self.files.items():
                    path = target / relative
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
            return {}
        if args[1:3] == ["install", "app"]:
            self.existing = True
            self.did_install = True
            self.version = "1.1.0"
            if self.mutate_during_install:
                self.files["library.json"] = json.dumps({"schemaVersion": 1, "activeSet": None, "revision": 3}).encode()
            if self.pdf_change_during_install == "delete":
                del self.files["Scores/example.pdf"]
            elif self.pdf_change_during_install == "mutate":
                self.files["Scores/example.pdf"] = b"%PDF-SYNTHETIC"
            elif self.pdf_change_during_install == "add":
                self.files["Scores/extra.pdf"] = b"%PDF-added"
            return {}
        if args[1:3] == ["process", "launch"]:
            return {"processIdentifier": 123}
        raise AssertionError("Unexpected fake command")


class DeviceSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "ios"
        self.root.mkdir()
        (self.root / "Signing.local.xcconfig").write_text(f"DEVELOPMENT_TEAM = {TEAM}\n")
        self.runner = FakeRunner(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def execute(self, action="refresh"):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            device.execute(action, None, self.runner, self.root)
        return output.getvalue()

    def assert_no_install(self):
        self.assertFalse(any(command[1:3] == ["install", "app"] for command in self.runner.commands))

    def test_no_arguments_is_help_without_any_command(self):
        with patch.object(device, "Runner", side_effect=AssertionError("No tool should run")), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(device.main([]), 0)

    def test_explicit_help_is_without_any_command(self):
        with patch.object(device, "Runner", side_effect=AssertionError("No tool should run")), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as result:
                device.main(["--help"])
            self.assertEqual(result.exception.code, 0)

    def test_multiple_connected_requires_name(self):
        with self.assertRaisesRegex(device.DeviceError, "More than one"):
            device.select_device([DETAILS, DETAILS], None)

    def test_duplicate_named_device_is_rejected(self):
        with self.assertRaisesRegex(device.DeviceError, "exactly one"):
            device.select_device([DETAILS, DETAILS], "Practice iPad")

    def test_explicit_unavailable_device_never_falls_back(self):
        other = copy.deepcopy(DETAILS)
        other["deviceProperties"]["name"] = "Other iPad"
        other["connectionProperties"]["tunnelState"] = "disconnected"
        with self.assertRaisesRegex(device.DeviceError, "unavailable"):
            device.select_device([DETAILS, other], "Other iPad")

    def test_unavailable_only_device_is_rejected(self):
        self.runner.details["connectionProperties"]["tunnelState"] = "disconnected"
        with self.assertRaises(device.DeviceError):
            self.execute()
        self.assert_no_install()

    def test_disabled_developer_mode_stops_before_build(self):
        self.runner.details["deviceProperties"]["developerModeStatus"] = "disabled"
        with self.assertRaisesRegex(device.DeviceError, "Developer Mode"):
            self.execute()
        self.assertFalse(any(command[0] == "xcodebuild" for command in self.runner.commands))

    def test_unready_device_services_are_rejected(self):
        self.runner.details["deviceProperties"]["ddiServicesAvailable"] = False
        with self.assertRaisesRegex(device.DeviceError, "not ready"):
            self.execute()

    def test_refresh_requires_existing_app(self):
        self.runner.existing = False
        with self.assertRaisesRegex(device.DeviceError, "first install"):
            self.execute()

    def test_first_install_does_not_copy_nonexistent_data(self):
        self.runner.existing = False
        self.execute("install")
        self.assertFalse(any(command[1:3] == ["copy", "from"] for command in self.runner.commands))

    def test_existing_install_backs_up_all_owned_files_then_installs(self):
        output = self.execute()
        backups = list((self.root.parent / "releases/ios-device-backups").glob("*/backup.json"))
        self.assertEqual(len(backups), 2)
        manifest = json.loads(backups[0].read_text())
        self.assertEqual(set(manifest["files"]), set(self.runner.files))
        self.assertEqual((backups[0].parent / "Praelude/library.json").read_bytes(), self.runner.files["library.json"])
        for secret in (TEAM, UDID, DETAILS["identifier"]):
            self.assertNotIn(secret, output)
            self.assertNotIn(secret, backups[0].read_text())
        self.assertFalse(any("uninstall" in command or "--terminate-existing" in command for command in self.runner.commands))
        launch = next(command for command in self.runner.commands if command[1:3] == ["process", "launch"])
        self.assertEqual(launch[-1], device.BUNDLE_ID)
        self.assertNotIn("--uitesting", launch)
        manifests = [json.loads(path.read_text())["files"] for path in backups]
        self.assertEqual(manifests[0], manifests[1])
        copies = [index for index, command in enumerate(self.runner.commands)
                  if command[1:3] == ["copy", "from"] and
                  command[command.index("--source") + 1] == "Library/Application Support/Praelude"]
        self.assertEqual(len(copies), 2)
        install_index = next(index for index, command in enumerate(self.runner.commands)
                             if command[1:3] == ["install", "app"])
        launch_index = next(index for index, command in enumerate(self.runner.commands)
                            if command[1:3] == ["process", "launch"])
        self.assertLess(copies[0], install_index)
        self.assertLess(install_index, copies[1])
        self.assertLess(copies[1], launch_index)

    def test_running_set_blocks_build_and_update(self):
        self.runner.files["library.json"] = json.dumps({"schemaVersion": 2, "activeSet": {"status": "running"}}).encode()
        with self.assertRaisesRegex(device.DeviceError, "practice set is running"):
            self.execute()
        self.assert_no_install()
        self.assertFalse(any(command[0] == "xcodebuild" for command in self.runner.commands))

    def test_paused_set_can_be_preserved_and_updated(self):
        self.runner.files["library.json"] = json.dumps({"schemaVersion": 2, "activeSet": {"status": "paused"}}).encode()
        self.execute()
        self.assertEqual(self.runner.version, "1.1.0")

    def test_schema3_archive_and_ink_are_preserved_by_refresh(self):
        state = {"schemaVersion": 3, "activeSet": None, "desktopImports": [{"id": "synthetic"}], "inkStrokes": []}
        self.runner.files["library.json"] = json.dumps(state).encode()
        self.runner.files["DesktopImports/snapshot.json"] = b"private original practice snapshot"
        self.runner.files["Recordings/take-test.m4a"] = b"private original recording"
        before = dict(self.runner.files)
        self.execute()
        self.assertEqual(self.runner.files, before)
        manifests = list((self.root.parent / "releases/ios-device-backups").glob("*/backup.json"))
        self.assertEqual(len(manifests), 2)
        for path in manifests:
            self.assertEqual(set(json.loads(path.read_text())["files"]), set(before))

    def test_schema3_running_practice_and_unknown_schema_still_block_update(self):
        self.runner.files["library.json"] = json.dumps({"schemaVersion": 3, "activeSet": {"status": "running"}}).encode()
        with self.assertRaisesRegex(device.DeviceError, "practice set is running"):
            self.execute()
        self.assert_no_install()
        for schema in (True, 6):
            with self.assertRaisesRegex(device.DeviceError, "unsupported format"):
                device.validate_library(json.dumps({"schemaVersion": schema}).encode())

    def test_schema4_tempo_library_is_preserved_and_running_set_still_blocks(self):
        state = {"schemaVersion": 4, "activeSet": None, "history": [{"configuration": {"tempoChanges": [{"afterAttemptCount": 2, "bpm": 65}]}}]}
        original = json.dumps(state).encode()
        self.runner.files["library.json"] = original
        self.execute()
        self.assertEqual(self.runner.files["library.json"], original)
        copies = list((self.root.parent / "releases/ios-device-backups").glob("*/Praelude/library.json"))
        self.assertEqual(len(copies), 2)
        self.assertTrue(all(path.read_bytes() == original for path in copies))
        self.runner.files["library.json"] = json.dumps({"schemaVersion": 4, "activeSet": {"status": "running"}}).encode()
        with self.assertRaisesRegex(device.DeviceError, "practice set is running"):
            self.execute()

    def test_schema5_organized_library_is_preserved_and_running_set_still_blocks(self):
        state = {"schemaVersion": 5, "activeSet": None, "pieces": [{"scoreSections": [{"title": "II", "startPage": 3, "endPage": 4}], "measureAnchors": [], "defaultPracticeBPM": 65}]}
        original = json.dumps(state).encode()
        self.runner.files["library.json"] = original
        self.execute()
        self.assertEqual(self.runner.files["library.json"], original)
        copies = list((self.root.parent / "releases/ios-device-backups").glob("*/Praelude/library.json"))
        self.assertEqual(len(copies), 2)
        self.assertTrue(all(path.read_bytes() == original for path in copies))
        self.runner.files["library.json"] = json.dumps({"schemaVersion": 5, "activeSet": {"status": "running"}}).encode()
        with self.assertRaisesRegex(device.DeviceError, "practice set is running"):
            self.execute()

    def test_corrupt_ledger_is_preserved_and_blocks_update(self):
        self.runner.files["library.json"] = b"broken ledger"
        with self.assertRaisesRegex(device.DeviceError, "unreadable"):
            self.execute()
        self.assert_no_install()
        paths = list((self.root.parent / "releases/ios-device-backups").glob("*/Praelude/library.json"))
        self.assertEqual(paths[0].read_bytes(), b"broken ledger")

    def test_copy_failure_blocks_build_and_install(self):
        self.runner.fail_copy = True
        with self.assertRaises(device.DeviceError):
            self.execute()
        self.assert_no_install()
        self.assertFalse(any(command[0] == "xcodebuild" for command in self.runner.commands))

    def test_ledger_change_during_build_blocks_install(self):
        self.runner.mutate_during_build = True
        with self.assertRaisesRegex(device.DeviceError, "changed after backup"):
            self.execute()
        self.assert_no_install()

    def test_expired_profile_blocks_install(self):
        self.runner.profile["ExpirationDate"] = dt.datetime.now(device.UTC) - dt.timedelta(seconds=1)
        with self.assertRaisesRegex(device.DeviceError, "expired"):
            self.execute()
        self.assert_no_install()

    def test_unregistered_target_blocks_install(self):
        self.runner.profile["ProvisionedDevices"] = []
        with self.assertRaisesRegex(device.DeviceError, "does not include"):
            self.execute()
        self.assert_no_install()

    def test_changed_team_blocks_install(self):
        self.runner.profile["TeamIdentifier"] = ["OTHERTEAM1"]
        with self.assertRaisesRegex(device.DeviceError, "original Personal Team"):
            self.execute()
        self.assert_no_install()

    def test_wrong_bundle_profile_blocks_install(self):
        self.runner.profile["Entitlements"]["application-identifier"] = f"{TEAM}.other.app"
        with self.assertRaisesRegex(device.DeviceError, "stable identifier"):
            self.execute()
        self.assert_no_install()

    def test_fixture_binary_blocks_install(self):
        self.runner.fixture = True
        with self.assertRaisesRegex(device.DeviceError, "UI-test fixtures"):
            self.execute()
        self.assert_no_install()

    def test_postinstall_ledger_change_blocks_launch_and_reports_install_happened(self):
        self.runner.mutate_during_install = True
        with self.assertRaisesRegex(device.DeviceError, "app installed, but"):
            self.execute()
        self.assertEqual(self.runner.version, "1.1.0")
        self.assertFalse(any(command[1:3] == ["process", "launch"] for command in self.runner.commands))

    def assert_installed_but_not_launched(self):
        self.assertEqual(self.runner.version, "1.1.0")
        self.assertFalse(any(command[1:3] == ["process", "launch"] for command in self.runner.commands))
        self.assertFalse(any("uninstall" in command or "restore" in command for command in self.runner.commands))

    def test_postinstall_pdf_same_size_mutation_blocks_launch(self):
        original = self.runner.files["Scores/example.pdf"]
        self.assertEqual(len(original), len(b"%PDF-SYNTHETIC"))
        self.runner.pdf_change_during_install = "mutate"
        with self.assertRaisesRegex(device.DeviceError, "app installed, but its complete library"):
            self.execute()
        self.assert_installed_but_not_launched()
        copies = list((self.root.parent / "releases/ios-device-backups").glob("*/Praelude/Scores/example.pdf"))
        self.assertEqual({path.read_bytes() for path in copies}, {original, b"%PDF-SYNTHETIC"})

    def test_postinstall_pdf_deletion_blocks_launch(self):
        original = self.runner.files["Scores/example.pdf"]
        self.runner.pdf_change_during_install = "delete"
        with self.assertRaisesRegex(device.DeviceError, "app installed, but its complete library"):
            self.execute()
        self.assert_installed_but_not_launched()
        copies = list((self.root.parent / "releases/ios-device-backups").glob("*/Praelude/Scores/example.pdf"))
        self.assertEqual(len(copies), 1)
        self.assertEqual(copies[0].read_bytes(), original)

    def test_postinstall_copy_failure_reports_installed_and_blocks_launch(self):
        self.runner.fail_copy_after_install = True
        with self.assertRaisesRegex(device.DeviceError, "app installed, but") as error:
            self.execute()
        self.assert_installed_but_not_launched()
        self.assertNotIn("no installation attempted", str(error.exception))
        self.assertTrue(list((self.root.parent / "releases/ios-device-backups").glob("*/Praelude/library.json")))

    def test_empty_existing_library_also_rejects_new_postinstall_files(self):
        self.runner.files = {}
        self.runner.pdf_change_during_install = "add"
        with self.assertRaisesRegex(device.DeviceError, "app installed, but"):
            self.execute()
        self.assert_installed_but_not_launched()

    def test_readonly_status_never_installs_builds_or_launches(self):
        self.execute("status")
        self.assert_no_install()
        self.assertFalse(any(command[0] == "xcodebuild" or command[1:3] in (["copy", "from"], ["process", "launch"])
                             for command in self.runner.commands))

    def test_tool_failures_do_not_echo_signing_output(self):
        failure = __import__("subprocess").CompletedProcess([], 1, b"private profile", b"private Apple account")
        with patch.object(device.subprocess, "run", return_value=failure):
            with self.assertRaisesRegex(device.DeviceError, "safe message") as error:
                device.Runner().run(["xcodebuild"], "safe message")
            self.assertNotIn("private", str(error.exception))


if __name__ == "__main__":
    unittest.main()
