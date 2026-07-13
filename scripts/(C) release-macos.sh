#!/bin/bash
set -euo pipefail

# Stock macOS tools (notably hdiutil's Perl helper) do not provide C.UTF-8.
# Pin the release process to the portable C locale instead of inheriting a
# shell/package-manager locale that can make DMG creation abort after install.
export LC_ALL=C
export LANG=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cd "$ROOT" && node -p "require('./package.json').version")"
IDENTIFIER="com.christian.codakiller"
BUILT_APP="$ROOT/src-tauri/target/release/bundle/macos/CodaKiller.app"
INSTALLED_APP="/Applications/CodaKiller.app"
STAGED_APP="/Applications/.CodaKiller-$VERSION.staged.app"
BACKUP_APP="/Applications/.CodaKiller.previous.app"
RELEASE_DIR="$ROOT/releases/v$VERSION"
STAGE_DIR="$RELEASE_DIR/dmg-stage"
DMG="$RELEASE_DIR/CodaKiller-$VERSION.dmg"
CHECKSUM="$DMG.sha256"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "package.json version is not semantic: $VERSION"

cd "$ROOT"

printf 'Release gate: CodaKiller %s\n' "$VERSION"
printf '1/8 Checking version agreement...\n'
CARGO_VERSION="$(sed -n 's/^version = "\([^"]*\)"/\1/p' src-tauri/Cargo.toml | head -n 1)"
TAURI_VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
[[ "$CARGO_VERSION" == "$VERSION" ]] || fail "Cargo.toml is $CARGO_VERSION, expected $VERSION"
[[ "$TAURI_VERSION" == "$VERSION" ]] || fail "tauri.conf.json is $TAURI_VERSION, expected $VERSION"

printf '2/8 Running frontend tests and build...\n'
npm test
npm run build

printf '3/8 Running Rust tests and strict lint...\n'
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings

printf '4/8 Building the native app...\n'
npm run tauri build -- --bundles app
[[ -d "$BUILT_APP" ]] || fail "native app bundle was not produced"

BUILT_IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$BUILT_APP/Contents/Info.plist")"
BUILT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$BUILT_APP/Contents/Info.plist")"
[[ "$BUILT_IDENTIFIER" == "$IDENTIFIER" ]] || fail "bundle identifier is $BUILT_IDENTIFIER"
[[ "$BUILT_VERSION" == "$VERSION" ]] || fail "bundle version is $BUILT_VERSION"

printf '5/8 Installing and sealing the canonical app...\n'
osascript -e 'tell application id "com.christian.codakiller" to quit' >/dev/null 2>&1 || true
rm -rf "$STAGED_APP" "$BACKUP_APP"
ditto "$BUILT_APP" "$STAGED_APP"
codesign --force --deep --sign "$SIGN_IDENTITY" --identifier "$IDENTIFIER" "$STAGED_APP"
codesign --verify --deep --strict --verbose=2 "$STAGED_APP"

rollback_install() {
  rm -rf "$STAGED_APP"
  if [[ -d "$BACKUP_APP" && ! -d "$INSTALLED_APP" ]]; then
    mv "$BACKUP_APP" "$INSTALLED_APP"
  fi
}
trap rollback_install EXIT
if [[ -d "$INSTALLED_APP" ]]; then
  mv "$INSTALLED_APP" "$BACKUP_APP"
fi
if ! mv "$STAGED_APP" "$INSTALLED_APP"; then
  rollback_install
  fail "could not replace the canonical app; the previous app was restored"
fi
rm -rf "$BACKUP_APP"
trap - EXIT

printf '6/8 Creating a clean drag-to-Applications disk image...\n'
rm -rf "$RELEASE_DIR"
mkdir -p "$STAGE_DIR"
ditto "$INSTALLED_APP" "$STAGE_DIR/CodaKiller.app"
ln -s /Applications "$STAGE_DIR/Applications"
hdiutil create -volname "CodaKiller $VERSION" -srcfolder "$STAGE_DIR" -ov -format UDZO "$DMG" >/dev/null
shasum -a 256 "$DMG" > "$CHECKSUM"
shasum -a 256 -c "$CHECKSUM"
rm -rf "$STAGE_DIR"

printf '7/8 Enforcing the one-copy rule...\n'
"$LSREGISTER" -u "$BUILT_APP" >/dev/null 2>&1 || true
rm -rf "$BUILT_APP"
"$LSREGISTER" -f "$INSTALLED_APP" >/dev/null 2>&1 || true
FOUND=""
while IFS= read -r -d '' CANDIDATE; do
  CANDIDATE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$CANDIDATE/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$CANDIDATE_ID" == "$IDENTIFIER" ]]; then
    FOUND="${FOUND}${FOUND:+$'\n'}${CANDIDATE}"
  fi
done < <(find /Applications "$HOME" /Users/Shared -type d -name '*.app' -prune -print0 2>/dev/null)
[[ "$FOUND" == "$INSTALLED_APP" ]] || fail "expected exactly $INSTALLED_APP across /Applications, the user home, and /Users/Shared; found: ${FOUND:-none}"
SPOTLIGHT="$(mdfind 'kMDItemCFBundleIdentifier == "com.christian.codakiller"' || true)"
[[ "$SPOTLIGHT" == "$INSTALLED_APP" ]] || fail "Spotlight does not resolve to exactly the installed app: ${SPOTLIGHT:-none}"

printf '8/8 Verifying release artifacts...\n'
[[ -s "$DMG" ]] || fail "DMG is empty"
[[ -s "$CHECKSUM" ]] || fail "checksum is empty"

printf '\nPASS: CodaKiller %s is installed, sealed, and packaged.\n' "$VERSION"
printf 'App: %s\n' "$INSTALLED_APP"
printf 'DMG: %s\n' "$DMG"
printf 'SHA-256: %s\n' "$CHECKSUM"
if [[ "$SIGN_IDENTITY" == "-" ]]; then
  printf 'Signature: ad-hoc local seal; not Developer ID signed or notarized.\n'
else
  printf 'Signature identity: %s (notarization is not performed by this script).\n' "$SIGN_IDENTITY"
fi
