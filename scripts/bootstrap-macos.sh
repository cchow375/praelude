#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

mode="${1:-setup}"
if [[ "$mode" != "setup" && "$mode" != "--check" ]]; then
  echo "usage: $0 [--check]" >&2
  exit 64
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Praelude's Mac bootstrap must run on macOS." >&2
  exit 1
fi

missing=0
for command_name in git node npm rustc cargo xcode-select; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing: $command_name" >&2
    missing=1
  fi
done

if ! xcode-select -p >/dev/null 2>&1; then
  echo "missing: active Xcode Command Line Tools (run xcode-select --install)" >&2
  missing=1
fi

if [[ ! -f package-lock.json || ! -f src-tauri/Cargo.lock ]]; then
  echo "missing: committed dependency lockfiles" >&2
  missing=1
fi

if [[ ! -x vendor/bin/hear ]]; then
  echo "missing or non-executable: vendor/bin/hear" >&2
  missing=1
fi

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

if ! node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  const supported = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 24;
  if (!supported) process.exit(1);
'; then
  echo "unsupported Node $(node --version): use ^20.19, ^22.12, or >=24" >&2
  exit 1
fi

npm_major="$(npm --version | cut -d. -f1)"
if [[ ! "$npm_major" =~ ^[0-9]+$ ]] || (( npm_major < 10 )); then
  echo "unsupported npm $(npm --version): use npm 10 or newer" >&2
  exit 1
fi

echo "macOS: $(sw_vers -productVersion) ($(uname -m))"
echo "Node: $(node --version)"
echo "npm: $(npm --version)"
echo "Rust: $(rustc --version)"
echo "Cargo: $(cargo --version)"
echo "Xcode tools: $(xcode-select -p)"
echo "Lockfiles and universal hear helper: present"

if [[ "$mode" == "--check" ]]; then
  echo "Doctor check passed. No files were changed."
  exit 0
fi

echo "Installing exact JavaScript dependencies with npm ci..."
npm ci
echo "Setup complete. Next: npm test && (cd src-tauri && cargo test --locked)"
