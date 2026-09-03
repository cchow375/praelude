#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/src-tauri/target/release/bundle/macos/Praelude.app}"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -d "$ROOT/dist" ]] || fail "frontend dist is missing"
[[ -d "$APP" ]] || fail "app bundle is missing: $APP"

for tree in "$ROOT/dist" "$APP"; do
  PRIVATE_FILE="$(find "$tree" -type f \( \
    -iname '*.db' -o -iname '*.sqlite' -o -iname '*.sqlite3' -o \
    -iname '*.db-wal' -o -iname '*.db-shm' -o \
    -iname '*.sqlite-wal' -o -iname '*.sqlite-shm' -o \
    -iname '*-wal' -o -iname '*-shm' -o -iname '*.pdf' -o \
    -iname '*.musicxml' -o -iname '*.mxl' -o -iname 'quotes.json' -o \
    -iname 'books.json' \
  \) -print -quit)"
  [[ -z "$PRIVATE_FILE" ]] || fail "private/content file found in distributable tree: $PRIVATE_FILE"

  SQLITE_PAYLOAD=""
  while IFS= read -r -d '' CANDIDATE; do
    if [[ "$(LC_ALL=C head -c 15 "$CANDIDATE" 2>/dev/null || true)" == "SQLite format 3" ]]; then
      SQLITE_PAYLOAD="$CANDIDATE"
      break
    fi
  done < <(find "$tree" -type f -print0)
  [[ -z "$SQLITE_PAYLOAD" ]] || fail "SQLite payload found under a disguised filename: $SQLITE_PAYLOAD"

  if [[ -n "${HOME:-}" ]] && grep -aR -F -q "$HOME/" "$tree"; then
    fail "build-host home path remains in distributable tree: $HOME"
  fi

  while IFS= read -r MARKER; do
    if grep -aR -F -q "$MARKER" "$tree"; then
      fail "removed Knowledge/Resources marker remains in distributable tree: $MARKER"
    fi
  done <<'MARKERS'
q-roskell-1
codakiller.practice_methods
codakiller.dev_mock.fixture
roskell-complete-pianist
gebrian-learn-faster
breth-effective-practicing
gieseking-leimer-technique
Penelope Roskell
The Complete Pianist
Molly Gebrian
Learn Faster, Perform Better
Nancy O'Neill Breth
The Piano Student's Guide to Effective Practicing
Walter Gieseking and Karl Leimer
Gebrian, Chapter 1: Pathways and practicing
Christian Chow
/Users/c3/Desktop/christian's universe/Piano Practice/Knowledge and Resources
/Users/c3/Desktop/christian's universe/Piano Practice/Pieces
MARKERS
done

NOTICE="$(find "$APP/Contents/Resources" -type f -name 'THIRD_PARTY_NOTICES.txt' -print -quit)"
[[ -n "$NOTICE" ]] || fail "third-party notices are missing from the app bundle"

while IFS= read -r NOTICE_MARKER; do
  grep -F -q "$NOTICE_MARKER" "$NOTICE" \
    || fail "third-party notices are incomplete; missing: $NOTICE_MARKER"
done <<'NOTICE_MARKERS'
Copyright (c) 2022-2026 Sveinbjorn Thordarson
Copyright Mozilla Foundation and contributors
Copyright (c) Meta Platforms, Inc. and affiliates.
Copyright (c) 2017 - Present Tauri Apps Contributors
Apache License, Version 2.0
NOTICE_MARKERS

printf 'PASS: distributable app contains no personal files or preloaded Knowledge/Resources content.\n'
