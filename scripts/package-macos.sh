#!/bin/bash
set -euo pipefail

# Package an already-built Praelude.app without quitting, replacing, or
# launching the installed application. This is the safe path when a live
# practice session must remain untouched.
export LC_ALL=C
export LANG=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cd "$ROOT" && node -p "require('./package.json').version")"
IDENTIFIER="com.christian.codakiller"
BUILT_APP="$ROOT/src-tauri/target/release/bundle/macos/Praelude.app"
RELEASE_DIR="$ROOT/releases/v$VERSION"
DMG="$RELEASE_DIR/Praelude-$VERSION.dmg"
CHECKSUM="$DMG.sha256"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "package.json version is not semantic: $VERSION"
[[ -z "${VITE_DEV_MOCK:-}" ]] || fail "VITE_DEV_MOCK must be unset for a distributable package"
[[ -d "$BUILT_APP" ]] || fail "built app is missing; build the app bundle first"
[[ ! -e "$DMG" && ! -e "$CHECKSUM" ]] || fail "release artifact already exists: $DMG"

CARGO_VERSION="$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$ROOT/src-tauri/Cargo.toml" | head -n 1)"
TAURI_VERSION="$(node -p "require('$ROOT/src-tauri/tauri.conf.json').version")"
[[ "$CARGO_VERSION" == "$VERSION" ]] || fail "Cargo.toml is $CARGO_VERSION, expected $VERSION"
[[ "$TAURI_VERSION" == "$VERSION" ]] || fail "tauri.conf.json is $TAURI_VERSION, expected $VERSION"

WORK_DIR="$(mktemp -d "${TMPDIR:-/private/tmp}/praelude-package.XXXXXX")"
STAGE_DIR="$WORK_DIR/dmg-stage"
MOUNT_DIR="$WORK_DIR/mount"
mkdir -p "$STAGE_DIR" "$MOUNT_DIR" "$RELEASE_DIR"

cleanup() {
  hdiutil detach "$MOUNT_DIR" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

printf '1/4 Staging and sealing Praelude %s...\n' "$VERSION"
ditto "$BUILT_APP" "$STAGE_DIR/Praelude.app"
cp "$ROOT/START_HERE.txt" "$STAGE_DIR/START HERE.txt"
cp "$ROOT/THIRD_PARTY_NOTICES.txt" "$STAGE_DIR/Third-Party Notices.txt"
ln -s /Applications "$STAGE_DIR/Applications"
codesign --force --deep --sign "$SIGN_IDENTITY" --identifier "$IDENTIFIER" "$STAGE_DIR/Praelude.app"
codesign --verify --deep --strict --verbose=2 "$STAGE_DIR/Praelude.app"
bash "$ROOT/scripts/check-share-clean.sh" "$STAGE_DIR/Praelude.app"

BUILT_IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$STAGE_DIR/Praelude.app/Contents/Info.plist")"
BUILT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$STAGE_DIR/Praelude.app/Contents/Info.plist")"
MINIMUM_SYSTEM="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$STAGE_DIR/Praelude.app/Contents/Info.plist")"
ARCHITECTURES="$(lipo -archs "$STAGE_DIR/Praelude.app/Contents/MacOS/praelude")"
[[ "$BUILT_IDENTIFIER" == "$IDENTIFIER" ]] || fail "bundle identifier is $BUILT_IDENTIFIER"
[[ "$BUILT_VERSION" == "$VERSION" ]] || fail "bundle version is $BUILT_VERSION"
[[ "$MINIMUM_SYSTEM" == "13.0" ]] || fail "minimum macOS version is $MINIMUM_SYSTEM, expected 13.0"
[[ "$ARCHITECTURES" == "arm64" ]] || fail "unexpected app architecture: $ARCHITECTURES"

printf '2/4 Creating the drag-to-Applications disk image...\n'
hdiutil create -volname "Praelude $VERSION" -srcfolder "$STAGE_DIR" -format UDZO "$DMG" >/dev/null
(
  cd "$RELEASE_DIR"
  shasum -a 256 "$(basename "$DMG")" > "$(basename "$CHECKSUM")"
  shasum -a 256 -c "$(basename "$CHECKSUM")"
)

printf '3/4 Auditing the mounted disk image...\n'
hdiutil attach "$DMG" -readonly -nobrowse -mountpoint "$MOUNT_DIR" >/dev/null
[[ -d "$MOUNT_DIR/Praelude.app" ]] || fail "mounted DMG is missing Praelude.app"
[[ -L "$MOUNT_DIR/Applications" && "$(readlink "$MOUNT_DIR/Applications")" == "/Applications" ]] || fail "mounted DMG has the wrong Applications shortcut"
[[ -f "$MOUNT_DIR/START HERE.txt" ]] || fail "mounted DMG is missing START HERE.txt"
[[ -f "$MOUNT_DIR/Third-Party Notices.txt" ]] || fail "mounted DMG is missing Third-Party Notices.txt"
DMG_ENTRIES="$(find "$MOUNT_DIR" -mindepth 1 -maxdepth 1 -print | sed "s#^$MOUNT_DIR/##" | LC_ALL=C sort)"
EXPECTED_DMG_ENTRIES="$(printf '%s\n' Applications Praelude.app 'START HERE.txt' 'Third-Party Notices.txt' | LC_ALL=C sort)"
[[ "$DMG_ENTRIES" == "$EXPECTED_DMG_ENTRIES" ]] || fail "mounted DMG has unexpected top-level entries: $DMG_ENTRIES"
bash "$ROOT/scripts/check-share-clean.sh" "$MOUNT_DIR/Praelude.app"
MOUNTED_NOTICE="$(find "$MOUNT_DIR/Praelude.app/Contents/Resources" -type f -name 'THIRD_PARTY_NOTICES.txt' -print -quit)"
[[ -n "$MOUNTED_NOTICE" ]] || fail "mounted app is missing its bundled notices"
cmp -s "$MOUNT_DIR/Third-Party Notices.txt" "$MOUNTED_NOTICE" \
  || fail "top-level and app-bundled third-party notices differ"
codesign --verify --deep --strict --verbose=2 "$MOUNT_DIR/Praelude.app"
if grep -aF -e '/Users/c3/' -e 'Christian Chow' -e 'Molly Gebrian' -e 'Penelope Roskell' "$MOUNT_DIR/START HERE.txt" "$MOUNT_DIR/Third-Party Notices.txt" >/dev/null; then
  fail "personal or removed Knowledge/Resources marker found in a DMG text file"
fi
hdiutil detach "$MOUNT_DIR" >/dev/null

printf '4/4 Verifying the finished artifact...\n'
[[ -s "$DMG" ]] || fail "DMG is empty"
[[ -s "$CHECKSUM" ]] || fail "checksum is empty"

trap - EXIT
rm -rf "$WORK_DIR"

printf '\nPASS: Praelude %s is packaged without changing the installed app.\n' "$VERSION"
printf 'DMG: %s\n' "$DMG"
printf 'SHA-256: %s\n' "$CHECKSUM"
if [[ "$SIGN_IDENTITY" == "-" ]]; then
  printf 'Signature: ad-hoc local seal; not Developer ID signed or notarized.\n'
else
  printf 'Signature identity: %s (notarization was not performed).\n' "$SIGN_IDENTITY"
fi
