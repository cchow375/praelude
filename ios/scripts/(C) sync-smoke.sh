#!/usr/bin/env bash
# Live two-device sync smoke test (spec §17a: "two-device sync identical history") against the
# *hosted* Supabase project — the one thing the fake-transport unit tests (PraeludeCoreTests/
# SyncEngineTests.swift) cannot prove, since they never touch the real sync_upsert RPC, RLS, or a
# real access token. The actual test lives in
# ios/PraeludeAppTests/SyncSmokeTests.swift ("or Swift test gated by env var" — this script is the
# thin, documented entry point to it, not a reimplementation).
#
# ---------------------------------------------------------------------------------------------
# One-time setup: a single confirmed throwaway account
# ---------------------------------------------------------------------------------------------
# This test signs in for real (it exercises the actual client -> PostgREST -> RLS path, not SQL
# impersonation like supabase/tests/ does), so it needs an account whose email is already
# confirmed - this project's auth.email.enable_confirmations is on (see
# supabase/(C) Backend.md, "Auth configuration"), so a fresh signup has no usable session until
# then. Getting a confirmed throwaway account is a one-time, out-of-band step, the same
# constraint supabase/tests/run.sh documents for its own throwaway users:
#
#   1. Sign up once, e.g. with a real disposable-inbox address (a mailinator.com-style address
#      works; "example.com"/"example.org" are rejected by email validation):
#        curl -s -X POST "https://zotswpjyvmhnxdyibnnz.supabase.co/auth/v1/signup" \
#          -H "apikey: $(sed -n 's/.*publishableKey = "\(.*\)"/\1/p' "$(dirname "$0")/../Praelude/Config/SupabaseConfig.swift")" \
#          -H 'Content-Type: application/json' \
#          -d '{"email":"<your-throwaway>@mailinator.com","password":"<a-throwaway-password>"}'
#   2. Open that inbox and click the confirmation link.
#   3. Export the credentials in your OWN shell — never commit them, never put them in this repo:
#        export PRAELUDE_SMOKE_EMAIL="<your-throwaway>@mailinator.com"
#        export PRAELUDE_SMOKE_PASSWORD="<a-throwaway-password>"
#
# ---------------------------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------------------------
#   PRAELUDE_SMOKE_EMAIL=... PRAELUDE_SMOKE_PASSWORD=... ios/scripts/(C) sync-smoke.sh ["iPad (A16)"]
#
# The simulator name defaults to $PRAELUDE_SMOKE_SIMULATOR, then "iPad (A16)"; pass one explicitly
# as $1 to override both. Without PRAELUDE_SMOKE_EMAIL/PASSWORD set, the test skips itself (not a
# failure) — see SyncSmokeTests.requireCredentials. This test creates one real (tombstoned at the
# end, per this schema's own "deletions archive, never hard-delete from the client" contract) piece
# row under the given account; it does not sign up, confirm, or delete any account itself.

set -euo pipefail
ios_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
simulator="${1:-${PRAELUDE_SMOKE_SIMULATOR:-iPad (A16)}}"

: "${PRAELUDE_SMOKE_EMAIL:?Set PRAELUDE_SMOKE_EMAIL to a confirmed throwaway account's email (see this script's header) — or the test will just skip itself}"
: "${PRAELUDE_SMOKE_PASSWORD:?Set PRAELUDE_SMOKE_PASSWORD to that account's password}"

echo "Running SyncSmokeTests against the live hosted project as $PRAELUDE_SMOKE_EMAIL, on simulator \"$simulator\"..."
xcodebuild test \
  -project "$ios_root/Praelude.xcodeproj" -scheme Praelude \
  -sdk iphonesimulator -destination "platform=iOS Simulator,name=$simulator" \
  -derivedDataPath "$ios_root/DerivedData" CODE_SIGNING_ALLOWED=NO \
  -only-testing:PraeludeAppTests/SyncSmokeTests
