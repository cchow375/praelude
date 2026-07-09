#!/usr/bin/env bash
#
# migrate_keys.sh — migrate the Gemini API key from the legacy piano-coach
# secrets file into the macOS login Keychain.
#
# Contract:
#   - Idempotent. Prints nothing secret. Never writes the key to a file.
#   - Refuses to overwrite an existing, DIFFERING entry unless --force.
#   - Source secrets file is only read, never modified.
#   - Key lands in Keychain: service "codakiller", account "gemini".
#
# The key is NEVER passed in argv (visible via `ps`): it is fed to the
# `security` prompt via stdin using the bash builtin `printf` (no external
# process is spawned for printf, so the value never appears in any argv).
#
# Output (stdout is the ONLY status channel; one word):
#   migrated   key was written (fresh, forced, or refreshed)
#   present    key already stored and identical to source (no-op)
#   refused    stored key differs from source and --force was not given
#
# Exit codes:
#   0  success (migrated | present)
#   2  usage error
#   3  refused (existing entry differs; rerun with --force)
#   1  operational error (missing source, empty key, keychain read/write fail)

set -euo pipefail

SERVICE="${CODAKILLER_KC_SERVICE:-codakiller}"
ACCOUNT="${CODAKILLER_KC_ACCOUNT:-gemini}"
SRC="${CODAKILLER_SECRETS_FILE:-$HOME/piano-coach/data/secrets.env}"
FORCE=0

usage() {
  cat <<'EOF'
Usage: migrate_keys.sh [--force] [--help]

Migrates GEMINI_API_KEY from the legacy secrets file into the macOS Keychain
(service "codakiller", account "gemini"). Idempotent and secret-safe.

  --force   Overwrite an existing Keychain entry even if it differs.
  --help    Show this help.

Environment overrides (for testing):
  CODAKILLER_KC_SERVICE    Keychain service name (default: codakiller)
  CODAKILLER_KC_ACCOUNT    Keychain account name (default: gemini)
  CODAKILLER_SECRETS_FILE  Source secrets file (default: ~/piano-coach/data/secrets.env)
EOF
}

die() { printf 'error: %s\n' "$1" >&2; exit "${2:-1}"; }

# --- parse args -------------------------------------------------------------
while [ "$#" -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" 2 ;;
  esac
  shift
done

# --- read key from source (value never printed) -----------------------------
[ -r "$SRC" ] || die "secrets file not readable: $SRC"

raw="$(grep -E '^GEMINI_API_KEY=' "$SRC" | head -n1 || true)"
[ -n "$raw" ] || die "GEMINI_API_KEY not found in $SRC"

key="${raw#GEMINI_API_KEY=}"
key="${key%$'\r'}"                                  # strip a stray CR
case "$key" in \"*\") key="${key#\"}"; key="${key%\"}";; esac  # strip quotes
case "$key" in \'*\') key="${key#\'}"; key="${key%\'}";; esac
[ -n "$key" ] || die "GEMINI_API_KEY is empty in $SRC"

# --- write helper (key travels via stdin only, never argv) ------------------
write_key() {
  # `security add-generic-password -w` with no value prompts twice
  # (password + retype); feed the value twice over stdin. -U updates if present.
  if ! printf '%s\n%s\n' "$key" "$key" \
      | security add-generic-password -U -s "$SERVICE" -a "$ACCOUNT" -w \
        >/dev/null 2>&1; then
    die "keychain write failed for service=$SERVICE account=$ACCOUNT"
  fi
}

verify_key() {
  local stored
  if ! stored="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null)"; then
    die "verification failed: entry not found after write"
  fi
  [ "$stored" = "$key" ] || die "verification failed: stored value does not match source"
}

# --- decide action ----------------------------------------------------------
if existing="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null)"; then
  if [ "$FORCE" -eq 1 ]; then
    write_key; verify_key
    echo migrated
  elif [ "$existing" = "$key" ]; then
    echo present
  else
    echo refused
    exit 3
  fi
else
  write_key; verify_key
  echo migrated
fi
