#!/bin/bash
set -euo pipefail

# Cross-build and stage the Windows x64 installer from macOS. This script never
# installs, launches, quits, or replaces CodaKiller and never reads the live app
# database. It also never installs build dependencies: missing tools are a hard
# failure with an actionable message. Keep the locale deterministic but UTF-8:
# Homebrew NSIS 3.12 aborts while parsing Tauri's Unicode script under plain C.
export LC_ALL=C.UTF-8
export LANG=C.UTF-8

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TARGET="x86_64-pc-windows-msvc"
WINDOWS_CONFIG="$ROOT/src-tauri/tauri.windows.conf.json"
BUNDLE_DIR="$ROOT/src-tauri/target/$TARGET/release/bundle/nsis"
BUILT_EXE="$ROOT/src-tauri/target/$TARGET/release/codakiller.exe"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

find_brew() {
  local candidate
  for candidate in "${HOMEBREW_PREFIX:-}/bin/brew" /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "this cross-packager must run on macOS"
[[ "$(locale charmap)" == "UTF-8" ]] \
  || fail "the cross-packager requires a UTF-8 locale for the Unicode NSIS script"
[[ -z "${VITE_DEV_MOCK:-}" ]] || fail "VITE_DEV_MOCK must be unset for a distributable package"
[[ -z "${RUSTFLAGS:-}" ]] || fail "RUSTFLAGS must be unset; this script supplies the release path remap"
[[ -z "${CARGO_ENCODED_RUSTFLAGS:-}" ]] \
  || fail "CARGO_ENCODED_RUSTFLAGS must be unset; this script supplies the release path remap"

BREW="$(find_brew)" || fail "Homebrew is required, but brew was not found"
BREW_PREFIX="$($BREW --prefix)"
LLVM_PREFIX="$($BREW --prefix llvm 2>/dev/null)" \
  || fail "Homebrew LLVM is missing; install it separately before packaging"
RUSTUP_PREFIX="$($BREW --prefix rustup 2>/dev/null)" \
  || fail "Homebrew rustup is missing; install it separately before packaging"
TASK_CARGO_HOME="${CARGO_HOME:-${HOME:?HOME must be set}/.cargo}"

LLVM_BIN="$LLVM_PREFIX/bin"
RUSTUP_BIN="$RUSTUP_PREFIX/bin"
CARGO_BIN="$TASK_CARGO_HOME/bin"
TOOLCHAIN_PATH="$LLVM_BIN:$CARGO_BIN:$RUSTUP_BIN:$BREW_PREFIX/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH="$TOOLCHAIN_PATH"

RUSTUP="$RUSTUP_BIN/rustup"
CARGO_XWIN="$CARGO_BIN/cargo-xwin"
LLVM_RC="$LLVM_BIN/llvm-rc"
CLANG_CL="$LLVM_BIN/clang-cl"
LLVM_LIB="$LLVM_BIN/llvm-lib"
MAKENSIS="$BREW_PREFIX/bin/makensis"
SEVEN_ZIP="$BREW_PREFIX/bin/7zz"
NODE="$BREW_PREFIX/bin/node"
NPM="$BREW_PREFIX/bin/npm"

[[ -x "$RUSTUP" ]] || fail "rustup is missing at $RUSTUP"
[[ -x "$CARGO_XWIN" ]] || fail "cargo-xwin is missing at $CARGO_XWIN"
[[ -x "$LLVM_RC" ]] || fail "LLVM resource compiler is missing at $LLVM_RC"
[[ -x "$CLANG_CL" ]] || fail "LLVM clang-cl is missing at $CLANG_CL"
[[ -x "$LLVM_LIB" ]] || fail "LLVM library manager is missing at $LLVM_LIB"
[[ -x "$MAKENSIS" ]] || fail "NSIS makensis is missing at $MAKENSIS"
[[ -x "$SEVEN_ZIP" ]] || fail "7-Zip is missing at $SEVEN_ZIP"
[[ -x "$NODE" && -x "$NPM" ]] || fail "Homebrew Node.js/npm are required"
[[ -x "$ROOT/node_modules/.bin/tauri" ]] \
  || fail "frontend dependencies are missing; run npm ci separately before packaging"
[[ -f "$WINDOWS_CONFIG" ]] || fail "Windows Tauri config is missing: $WINDOWS_CONFIG"
[[ -f "$ROOT/scripts/check-share-clean-windows.mjs" ]] \
  || fail "Windows share-clean scanner is missing"

STABLE_SYSROOT="$("$RUSTUP" run stable rustc --print sysroot 2>/dev/null)" \
  || fail "the stable Rust toolchain is not installed"
[[ "$STABLE_SYSROOT" == /* && -d "$STABLE_SYSROOT/bin" ]] \
  || fail "rustup returned an invalid stable toolchain sysroot"
STABLE_BIN="$STABLE_SYSROOT/bin"
[[ -x "$STABLE_BIN/cargo" && -x "$STABLE_BIN/rustc" && -x "$STABLE_BIN/cargo-clippy" ]] \
  || fail "the stable Rust toolchain is missing cargo, rustc, or clippy"

# Keep the rustup-selected cargo/rustc/clippy ahead of Homebrew. cargo-xwin is
# still resolved from the task-specific Cargo bin directory immediately after
# the stable toolchain.
export PATH="$STABLE_BIN:$TOOLCHAIN_PATH"
[[ "$(command -v cargo)" == "$STABLE_BIN/cargo" ]] \
  || fail "cargo does not resolve to the rustup stable toolchain"
[[ "$(command -v rustc)" == "$STABLE_BIN/rustc" ]] \
  || fail "rustc does not resolve to the rustup stable toolchain"
[[ "$(command -v cargo-clippy)" == "$STABLE_BIN/cargo-clippy" ]] \
  || fail "cargo-clippy does not resolve to the rustup stable toolchain"

STABLE_HOST="$("$RUSTUP" run stable rustc -vV | sed -n 's/^host: //p')"
[[ "$STABLE_HOST" =~ ^[A-Za-z0-9_.-]+$ ]] \
  || fail "rustup returned an invalid stable host triple"
RUST_LLD="$STABLE_SYSROOT/lib/rustlib/$STABLE_HOST/bin/rust-lld"
RUST_LLD_LINK="$STABLE_SYSROOT/lib/rustlib/$STABLE_HOST/bin/gcc-ld/lld-link"
[[ -x "$RUST_LLD" && -x "$RUST_LLD_LINK" ]] \
  || fail "stable rust-lld is incomplete; repair or reinstall the stable rustup toolchain"
# lld-link is the Windows-target launcher for the host rust-lld binary. Unlike
# invoking the generic driver directly, --version has a successful exit status.
if ! RUST_LLD_OUTPUT="$("$RUST_LLD_LINK" --version 2>&1)"; then
  if [[ "$RUST_LLD_OUTPUT" == *libLLVM* || "$RUST_LLD_OUTPUT" == *"Library not loaded"* ]]; then
    fail "stable rust-lld cannot load libLLVM; repair or reinstall the stable rustup toolchain, then rerun"
  fi
  fail "stable rust-lld could not start; repair or reinstall the stable rustup toolchain, then rerun"
fi

"$RUSTUP" run stable rustc --version >/dev/null \
  || fail "the stable Rust compiler could not start"
"$RUSTUP" target list --toolchain stable --installed | grep -Fxq "$TARGET" \
  || fail "stable Rust target $TARGET is not installed"
"$CARGO_XWIN" --version >/dev/null || fail "cargo-xwin could not start"
"$CLANG_CL" --version >/dev/null || fail "Homebrew LLVM could not start"
"$MAKENSIS" -VERSION >/dev/null || fail "makensis could not start"
"$SEVEN_ZIP" i >/dev/null || fail "7-Zip could not start"
"$NODE" --version >/dev/null || fail "Node.js could not start"
"$NPM" --version >/dev/null || fail "npm could not start"

VERSION="$($NODE -p "require(process.argv[1]).version" "$ROOT/package.json")"
LOCK_VERSION="$($NODE -p "require(process.argv[1]).version" "$ROOT/package-lock.json")"
LOCK_ROOT_VERSION="$($NODE -p "require(process.argv[1]).packages[''].version" "$ROOT/package-lock.json")"
TAURI_VERSION="$($NODE -p "require(process.argv[1]).version" "$ROOT/src-tauri/tauri.conf.json")"
CARGO_VERSION="$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$ROOT/src-tauri/Cargo.toml" | head -n 1)"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "package.json version is not semantic: $VERSION"
[[ "$LOCK_VERSION" == "$VERSION" && "$LOCK_ROOT_VERSION" == "$VERSION" ]] \
  || fail "package-lock.json version does not match $VERSION"
[[ "$TAURI_VERSION" == "$VERSION" ]] \
  || fail "tauri.conf.json is $TAURI_VERSION, expected $VERSION"
[[ "$CARGO_VERSION" == "$VERSION" ]] \
  || fail "Cargo.toml is $CARGO_VERSION, expected $VERSION"

SOURCE_COMMIT="$(git -C "$ROOT" rev-parse --verify HEAD)"
git -C "$ROOT" diff --quiet || fail "tracked source changes are present; commit them before packaging"
git -C "$ROOT" diff --cached --quiet \
  || fail "staged source changes are present; commit them before packaging"
[[ -z "$(git -C "$ROOT" ls-files --others --exclude-standard)" ]] \
  || fail "untracked source files are present; commit or remove them before packaging"

RELEASE_PARENT="$ROOT/releases/v$VERSION"
RELEASE_DIR="$RELEASE_PARENT/windows"
ARTIFACT_NAME="CodaKiller-$VERSION-Windows-x64-Setup.exe"
[[ ! -e "$RELEASE_DIR" ]] \
  || fail "release directory already exists; refusing to overwrite it: $RELEASE_DIR"

export XWIN_ARCH=x86_64
export XWIN_VARIANT=desktop
export XWIN_CACHE_DIR="${XWIN_CACHE_DIR:-/private/tmp/codakiller-xwin-cache}"
[[ "$XWIN_CACHE_DIR" == /* ]] || fail "XWIN_CACHE_DIR must be an absolute path"
mkdir -p "$XWIN_CACHE_DIR"
XWIN_CACHE_DIR="$(cd "$XWIN_CACHE_DIR" && pwd -P)"
export XWIN_CACHE_DIR
case "$XWIN_CACHE_DIR/" in
  "$ROOT/"*) fail "XWIN_CACHE_DIR must stay outside the repository" ;;
esac

# The repository currently lives directly below the user's home directory. Derive
# that prefix from the repository rather than baking a personal username into the
# build, then remap it out of Rust debug and panic metadata.
SOURCE_PREFIX="$(cd "$ROOT/.." && pwd -P)"
[[ "$SOURCE_PREFIX" != "/" ]] || fail "refusing to remap the filesystem root"
case "$SOURCE_PREFIX" in
  *[[:space:]]*) fail "the source parent contains whitespace and cannot be safely remapped" ;;
esac
export RUSTFLAGS="--remap-path-prefix=$SOURCE_PREFIX=/build-user"
export CODAKILLER_SEVEN_ZIP="$SEVEN_ZIP"
unset CC CXX AR

printf '1/4 Cross-building CodaKiller %s for Windows x64...\n' "$VERSION"
(
  cd "$ROOT"
  "$RUSTUP" run stable "$NPM" run tauri build -- \
    --runner cargo-xwin \
    --target "$TARGET" \
    --bundles nsis \
    --config "$WINDOWS_CONFIG" \
    --ci \
    --no-sign
)

shopt -s nullglob
INSTALLERS=("$BUNDLE_DIR"/*-setup.exe)
shopt -u nullglob
[[ "${#INSTALLERS[@]}" -eq 1 ]] \
  || fail "expected exactly one NSIS setup executable, found ${#INSTALLERS[@]}"
INSTALLER="${INSTALLERS[0]}"
[[ -s "$INSTALLER" ]] || fail "NSIS installer is empty: $INSTALLER"
[[ -s "$BUILT_EXE" ]] || fail "built Windows application executable is missing: $BUILT_EXE"
APP_FILE_DESCRIPTION="$(/usr/bin/file -b "$BUILT_EXE")"
[[ "$APP_FILE_DESCRIPTION" == *PE32+* && "$APP_FILE_DESCRIPTION" == *x86-64* ]] \
  || fail "built application is not a Windows x64 PE32+ executable: $APP_FILE_DESCRIPTION"

printf '2/4 Auditing the frontend and recursively extracted installer...\n'
"$NODE" "$ROOT/scripts/check-share-clean-windows.mjs" "$ROOT/dist" "$INSTALLER"

printf '3/4 Staging the normalized installer and handoff files...\n'
mkdir -p "$RELEASE_PARENT"
STAGING_DIR="$(mktemp -d "$RELEASE_PARENT/.windows-stage.XXXXXX")"
cleanup() {
  if [[ -n "${STAGING_DIR:-}" && -d "$STAGING_DIR" ]]; then
    rm -rf -- "$STAGING_DIR"
  fi
}
trap cleanup EXIT

STAGED_INSTALLER="$STAGING_DIR/$ARTIFACT_NAME"
cp "$INSTALLER" "$STAGED_INSTALLER"
cmp -s "$INSTALLER" "$STAGED_INSTALLER" || fail "staged installer differs from build output"
(
  cd "$STAGING_DIR"
  shasum -a 256 "$ARTIFACT_NAME" > "$ARTIFACT_NAME.sha256"
  shasum -a 256 -c "$ARTIFACT_NAME.sha256" >/dev/null
)
SHA256="$(awk '{print $1}' "$STAGED_INSTALLER.sha256")"
ARTIFACT_BYTES="$(stat -f '%z' "$STAGED_INSTALLER")"
BUILT_AT_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

printf '%s\n' \
  'CODAKILLER FOR WINDOWS 10/11 (64-BIT)' \
  '' \
  "1. Double-click $ARTIFACT_NAME." \
  '2. This first Windows package is unsigned. If Windows SmartScreen appears, choose More info, then Run anyway.' \
  '3. CodaKiller opens with a blank Pieces Library. Choose Add Piece to import one of your own PDF scores.' \
  '4. The app installs for the current Windows user and normally does not need an administrator password.' \
  '5. If WebView2 is missing, the installer needs an internet connection to download the Microsoft WebView2 bootstrapper.' \
  '' \
  'Pieces, folders, PDF scores, keyboard/mouse practice tracking, History, Calendar, and the metronome are included.' \
  'Hands-free voice, Listen Back, the Mac system voice, and automatic system-volume boost are unavailable in this Windows build.' \
  '' \
  "Verify the download with the SHA-256 value in $ARTIFACT_NAME.sha256 if desired." \
  > "$STAGING_DIR/START_HERE.txt"

printf '%s\n' \
  'CodaKiller Windows package status' \
  "Version: $VERSION" \
  "Target: $TARGET" \
  'Bundle: NSIS current-user installer' \
  "Source commit: $SOURCE_COMMIT" \
  "Built at (UTC): $BUILT_AT_UTC" \
  "Artifact bytes: $ARTIFACT_BYTES" \
  "SHA-256: $SHA256" \
  'Share-clean audit: PASS (frontend plus recursively extracted NSIS payload)' \
  'Compatibility boundary: schema/migration metadata is present for compatible upgrades; no personal files, database, scores, Pieces Library, or practice history are bundled' \
  "Application payload: $APP_FILE_DESCRIPTION" \
  'Signing step: none (unsigned package)' \
  'Authenticode verification: PENDING on Windows' \
  'SmartScreen: an unsigned download is expected to show a warning' \
  'WebView2: installer downloads Microsoft WebView2 bootstrapper only if the runtime is missing' \
  'Interactive Windows 10/11 acceptance: PENDING; a cross-build is not a native-use test' \
  > "$STAGING_DIR/BUILD-STATUS.txt"

shopt -s nullglob dotglob
STAGED_ENTRIES=("$STAGING_DIR"/*)
shopt -u nullglob dotglob
[[ "${#STAGED_ENTRIES[@]}" -eq 4 ]] \
  || fail "expected exactly four staged files, found ${#STAGED_ENTRIES[@]}"
for staged_entry in "${STAGED_ENTRIES[@]}"; do
  [[ -f "$staged_entry" && ! -L "$staged_entry" ]] \
    || fail "unexpected non-regular staged entry: $staged_entry"
done

mv "$STAGING_DIR" "$RELEASE_DIR"
STAGING_DIR=""
trap - EXIT

printf '4/4 Verifying the finished handoff...\n'
[[ -s "$RELEASE_DIR/$ARTIFACT_NAME" ]] || fail "finished installer is missing"
[[ -s "$RELEASE_DIR/$ARTIFACT_NAME.sha256" ]] || fail "finished checksum is missing"
[[ -s "$RELEASE_DIR/START_HERE.txt" ]] || fail "finished start guide is missing"
[[ -s "$RELEASE_DIR/BUILD-STATUS.txt" ]] || fail "finished build status is missing"
(
  cd "$RELEASE_DIR"
  shasum -a 256 -c "$ARTIFACT_NAME.sha256" >/dev/null
)

printf '\nPASS: CodaKiller %s Windows x64 package is staged without touching the installed app or data.\n' "$VERSION"
printf 'Installer: %s\n' "$RELEASE_DIR/$ARTIFACT_NAME"
printf 'SHA-256: %s\n' "$SHA256"
printf 'Signature: unsigned; Windows-native Authenticode and interactive acceptance remain pending.\n'
