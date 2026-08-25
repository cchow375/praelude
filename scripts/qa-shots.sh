#!/usr/bin/env bash
# Capture app screenshots at the 720x520 minimum-window floor.
#
# 720x520 is not hypothetical: it is the configured minWidth/minHeight in
# src-tauri/tauri.conf.json, so it is a size Christian can actually put the
# window at. Spec 2026-08-24-aug8-practice-overhaul-design.md §8.2 requires
# dense-fixture screenshots at this size for every new surface, and §4b
# requires that the screenshot show the AFFORDANCE, not just the feature in
# use.
#
# Usage:
#   npm run dev:mock &                       # serves http://localhost:1420
#   npm run qa:shots -- <name> [url-hash]    # e.g. `npm run qa:shots -- mic-toggle-rail`
#
# Drives the gstack headless browser CLI, which is installed at the user
# level. Deliberately NOT a repo devDependency: adding playwright/puppeteer
# here would pull a ~300 MB browser download onto an 8 GB machine for
# screenshots we take by hand a few times per release.
#
# Env overrides: QA_PORT (default 1420), QA_OUT (default docs/qa/v7.0.1),
# GSTACK_BROWSE (path to the browse CLI).
set -euo pipefail

NAME="${1:?usage: qa-shots.sh <name> [url-hash]}"
HASH="${2:-}"
PORT="${QA_PORT:-1420}"
OUT="${QA_OUT:-docs/qa/v7.0.1}"
B="${GSTACK_BROWSE:-$HOME/.claude/skills/gstack/browse/dist/browse}"

if [ ! -x "$B" ]; then
  echo "qa-shots: headless browser CLI not found at $B" >&2
  echo "qa-shots: set GSTACK_BROWSE=/path/to/browse, or capture by hand at exactly 720x520." >&2
  exit 1
fi

mkdir -p "$OUT"
"$B" viewport 720x520 >/dev/null
"$B" goto "http://localhost:$PORT/$HASH" >/dev/null
"$B" wait --networkidle >/dev/null || true
"$B" screenshot "$OUT/$NAME-720x520.png" >/dev/null
echo "wrote $OUT/$NAME-720x520.png"
