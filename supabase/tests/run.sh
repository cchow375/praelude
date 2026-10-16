#!/usr/bin/env bash
# Praelude backend tests runner (spec 5c: prove isolation, privacy, blocks, and complete account
# deletion against the *hosted* project - no local Postgres, no DB password).
#
# 1. Create two (or three, for 04) throwaway users via the public signup path:
#      curl -s -X POST "https://<ref>.supabase.co/auth/v1/signup" \
#        -H "apikey: <publishable key, from ios/Praelude/Config/SupabaseConfig.swift>" \
#        -H 'Content-Type: application/json' \
#        -d '{"email":"<unique>@mailinator.com","password":"<throwaway>"}'
#    Note: "example.com"/"example.org" addresses are rejected by email validation; a real
#    disposable-inbox domain such as mailinator.com passes. If [auth.email] enable_confirmations is
#    true, signup itself sends a confirmation email, and auth.rate_limit.email_sent defaults to only
#    2/hour - either confirm the throwaway address for real, or temporarily flip enable_confirmations
#    to false in supabase/config.toml and `supabase config push --project-ref <ref> --yes` for the
#    run, then flip it back and push again afterwards. These tests never sign in as the throwaway
#    user for real; they impersonate by uuid via request.jwt.claims (see each file's header), so
#    confirmation status otherwise makes no difference to what is being tested.
# 2. Take each response's .user.id as that user's uuid, then:
#      USER_A=<uuid> USER_B=<uuid> [USER_C=<uuid>] ./supabase/tests/run.sh --project-ref <ref>
#
# USER_C is only read by 04_account_deletion.sql, which is destructive: it deletes that account for
# real, on COMMIT (not rolled back, unlike 01-03). Never pass USER_A or USER_B as USER_C. Omit USER_C
# to skip 04 and only run the non-destructive suite.

set -euo pipefail

project_ref=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-ref) project_ref="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
: "${project_ref:?--project-ref is required}"
: "${USER_A:?set USER_A to a throwaway test user's auth uuid}"
: "${USER_B:?set USER_B to a throwaway test user's auth uuid}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

run_one() {
  local src="$1" rendered
  rendered="$tmp/$(basename "$src")"
  sed -e "s/__USER_A_ID__/$USER_A/g" -e "s/__USER_B_ID__/$USER_B/g" -e "s/__USER_C_ID__/${USER_C:-}/g" \
    "$src" > "$rendered"
  echo "==> ${src##*/}"
  supabase db query --linked --project-ref "$project_ref" -f "$rendered"
}

run_one "$here/01_rls_policy_coverage.sql"
run_one "$here/02_owner_isolation_and_sync_rpc.sql"
run_one "$here/03_social_privacy_blocks_notes_storage.sql"
run_one "$here/05_presence_and_note_privacy.sql"
run_one "$here/06_account_preferences_and_metadata.sql"
run_one "$here/07_piece_practice_balance.sql"

if [[ -n "${USER_C:-}" ]]; then
  echo "==> 04_account_deletion.sql (DESTRUCTIVE - permanently deletes USER_C's account)"
  run_one "$here/04_account_deletion.sql"
else
  echo "skipping 04_account_deletion.sql (set USER_C to a THIRD throwaway user, never A or B, to run it)"
fi
