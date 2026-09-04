#!/usr/bin/env bash
#
# migrate_keys.sh — migrate the Gemini API key from the legacy piano-coach
# secrets file into the macOS login Keychain.
#
# Contract:
#   - Idempotent. Prints nothing secret. Never writes the key to a file.
#   - Refuses to overwrite an existing, DIFFERING entry unless --force.
#   - Source secrets file is only read, never modified.
#   - Key lands in the legacy-compatible Keychain service "codakiller", account "gemini".
#
# The key is NEVER passed in argv (visible via `ps`) and the write path is
# genuinely tty-independent. It is fed to `security -i` (interactive command
# mode): the full `add-generic-password ... -w '<key>'` command line is piped
# to security over stdin, so the value rides security's internal command
# stream. This avoids the `-w`-with-no-value prompt, which reads from /dev/tty
# when a controlling terminal exists (readpassphrase(3) prefers /dev/tty and
# uses stdin only as a fallback) — from a real Terminal that path would PROMPT
# and ignore any piped value. The value is single-quote wrapped in the command;
# keys containing a single quote or backslash are rejected up front because
# security's tokenizer treats both as special even inside single quotes. The
# verify-after-write round-trip is the final byte-for-byte correctness gate.
# `printf` is a shell builtin, so no external process is spawned and the value
# never becomes any process's argv.
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

# Defensively disable command tracing as the very first executable line: an
# exported SHELLOPTS containing `xtrace` propagates `set -x` into this child
# bash, which would expand and print $key to stderr. `verbose` is disabled too.
{ set +o xtrace; set +o verbose; } 2>/dev/null

set -euo pipefail

SERVICE="${PRAELUDE_KC_SERVICE:-${CODAKILLER_KC_SERVICE:-codakiller}}"
ACCOUNT="${PRAELUDE_KC_ACCOUNT:-${CODAKILLER_KC_ACCOUNT:-gemini}}"
SRC="${PRAELUDE_SECRETS_FILE:-${CODAKILLER_SECRETS_FILE:-$HOME/piano-coach/data/secrets.env}}"
FORCE=0

usage() {
  cat <<'EOF'
Usage: migrate_keys.sh [--force] [--help]

Migrates GEMINI_API_KEY from the legacy secrets file into the macOS Keychain
(service "codakiller", account "gemini"). Idempotent and secret-safe.

  --force   Overwrite an existing Keychain entry even if it differs.
  --help    Show this help.

Environment overrides (for testing):
  PRAELUDE_KC_SERVICE      Keychain service name (default: legacy-compatible codakiller)
  PRAELUDE_KC_ACCOUNT      Keychain account name (default: gemini)
  PRAELUDE_SECRETS_FILE    Source secrets file (default: ~/piano-coach/data/secrets.env)

Legacy CODAKILLER_* overrides remain supported for existing automation.
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

# Collect every GEMINI_API_KEY assignment, tolerating leading whitespace and
# whitespace around the `=`. Each value is normalized (trailing CR, surrounding
# whitespace, then one layer of matching surrounding quotes are stripped);
# empty results are dropped.
vals=()
while IFS= read -r line; do
  val="${line#*=}"
  val="${val%$'\r'}"                                  # strip a stray CR
  val="${val#"${val%%[![:space:]]*}"}"                # strip leading whitespace
  val="${val%"${val##*[![:space:]]}"}"                # strip trailing whitespace
  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;        # strip surrounding "..."
    \'*\') val="${val#\'}"; val="${val%\'}" ;;        # strip surrounding '...'
  esac
  [ -n "$val" ] && vals+=("$val")
done < <(grep -E '^[[:space:]]*GEMINI_API_KEY[[:space:]]*=' "$SRC" || true)

[ "${#vals[@]}" -gt 0 ] || die "GEMINI_API_KEY not found (or empty) in $SRC"

# Dup detection: fail loudly on >1 distinct value; otherwise use the last
# occurrence (env-file last-wins semantics).
distinct=()
for v in "${vals[@]}"; do
  seen=0
  if [ "${#distinct[@]}" -gt 0 ]; then
    for d in "${distinct[@]}"; do [ "$d" = "$v" ] && { seen=1; break; }; done
  fi
  [ "$seen" -eq 0 ] && distinct+=("$v")
done
if [ "${#distinct[@]}" -gt 1 ]; then
  die "multiple differing GEMINI_API_KEY values in $SRC (${#distinct[@]} distinct); refusing to guess"
fi

key="${vals[$(( ${#vals[@]} - 1 ))]}"                 # last occurrence
[ -n "$key" ] || die "GEMINI_API_KEY is empty in $SRC"

# The interactive command line single-quotes the value; security's tokenizer
# treats ' and \ as special even inside single quotes, so reject them (real
# Gemini keys are [A-Za-z0-9._-] and never contain either).
case "$key" in
  *\'*) die "GEMINI_API_KEY contains a single quote; unsupported for safe keychain write" ;;
  *\\*) die "GEMINI_API_KEY contains a backslash; unsupported for safe keychain write" ;;
esac

# --- write helper (tty-independent; key travels via stdin only, never argv) --
write_key() {
  # Feed the whole add-generic-password command to `security -i` over stdin.
  # -U updates in place if the item already exists. security reads the value
  # from its own command stream, never from /dev/tty, so this does not prompt
  # under a controlling terminal. printf is a builtin: no argv exposure.
  if ! printf "add-generic-password -U -s '%s' -a '%s' -w '%s'\n" \
      "$SERVICE" "$ACCOUNT" "$key" \
      | security -i >/dev/null 2>&1; then
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
