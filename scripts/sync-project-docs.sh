#!/usr/bin/env bash
set -euo pipefail

mode="${1:---sync}"
if [[ "$mode" != "--sync" && "$mode" != "--check" ]]; then
  echo "usage: $0 [--sync|--check]" >&2
  exit 64
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
default_vault_root="$HOME/Desktop/christian's universe/Piano Practice/Praelude"
vault_root="${PRAELUDE_PROJECT_VAULT:-$default_vault_root}"
mirror_root="$repo_root/docs/project"

root_docs=(
  "AGENTS.md"
  "Praelude.md"
  "(C) Praelude Command Center.md"
  "(C) Roadmap.md"
  "(C) Flaws.md"
  "(C) Changelog.md"
  "(C) How To Use.md"
  "(C) Motivation.md"
  "(C) Book-to-Mechanic Evidence Catalogue.md"
  "(C) v2 Acceptance Matrix.md"
  "(C) v2 Transformation Brief.md"
  "coda killer notes.md"
)

if [[ ! -d "$vault_root" ]]; then
  if [[ "$mode" == "--sync" ]]; then
    echo "Project vault not found: $vault_root" >&2
    echo "Set PRAELUDE_PROJECT_VAULT to its absolute path." >&2
    exit 1
  fi

  for relative_path in "${root_docs[@]}"; do
    [[ -s "$mirror_root/$relative_path" ]] || {
      echo "Missing mirrored document: $mirror_root/$relative_path" >&2
      exit 1
    }
  done
  mirror_count="$(find "$mirror_root/versions" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$mirror_count" -gt 0 ]] || {
    echo "No mirrored version records found." >&2
    exit 1
  }
  lineage_count="$(find "$mirror_root/PianoCoach" -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$lineage_count" -gt 0 ]] || {
    echo "No mirrored PianoCoach lineage documents found." >&2
    exit 1
  }
  echo "Source vault unavailable; checked mirror structure only ($mirror_count version records, $lineage_count lineage documents)."
  exit 0
fi

# Prove the complete approved source set before changing the checked-in mirror. This is
# especially important for PRAELUDE_PROJECT_VAULT overrides: an incomplete vault must fail
# without deleting the portable fallback.
for relative_path in "${root_docs[@]}"; do
  [[ -f "$vault_root/$relative_path" ]] || {
    echo "Missing source document: $vault_root/$relative_path" >&2
    exit 1
  }
done

[[ -d "$vault_root/versions" ]] || {
  echo "Missing source version-record directory: $vault_root/versions" >&2
  exit 1
}
source_version_count="$(find "$vault_root/versions" -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' ')"
[[ "$source_version_count" -gt 0 ]] || {
  echo "No source version records found in $vault_root/versions" >&2
  exit 1
}

[[ -d "$vault_root/PianoCoach" ]] || {
  echo "Missing source lineage directory: $vault_root/PianoCoach" >&2
  exit 1
}
source_lineage_count="$(find "$vault_root/PianoCoach" -type f -name '*.md' | wc -l | tr -d ' ')"
[[ "$source_lineage_count" -gt 0 ]] || {
  echo "No source PianoCoach lineage documents found in $vault_root/PianoCoach" >&2
  exit 1
}

compare_file() {
  local relative_path="$1"
  local source_path="$vault_root/$relative_path"
  local target_path="$mirror_root/$relative_path"
  [[ -f "$source_path" ]] || {
    echo "Missing source document: $source_path" >&2
    return 1
  }
  [[ -f "$target_path" ]] || {
    echo "Missing mirrored document: $target_path" >&2
    return 1
  }
  cmp -s "$source_path" "$target_path" || {
    echo "Out of sync: $relative_path" >&2
    return 1
  }
}

if [[ "$mode" == "--check" ]]; then
  status=0
  for relative_path in "${root_docs[@]}"; do
    compare_file "$relative_path" || status=1
  done

  while IFS= read -r -d '' source_path; do
    relative_path="versions/$(basename "$source_path")"
    compare_file "$relative_path" || status=1
  done < <(find "$vault_root/versions" -maxdepth 1 -type f -name '*.md' -print0 | sort -z)

  while IFS= read -r -d '' relative_path; do
    compare_file "$relative_path" || status=1
  done < <(cd "$vault_root" && find PianoCoach -type f -name '*.md' -print0 | sort -z)

  source_count="$source_version_count"
  mirror_count="$(find "$mirror_root/versions" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$source_count" != "$mirror_count" ]]; then
    echo "Version-record count differs: vault=$source_count mirror=$mirror_count" >&2
    status=1
  fi

  mirror_lineage_count="$(find "$mirror_root/PianoCoach" -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$source_lineage_count" != "$mirror_lineage_count" ]]; then
    echo "PianoCoach lineage count differs: vault=$source_lineage_count mirror=$mirror_lineage_count" >&2
    status=1
  fi

  [[ "$status" -eq 0 ]] || exit 1
  echo "Project documentation mirror is current ($source_count version records, $source_lineage_count lineage documents)."
  exit 0
fi

mkdir -p "$mirror_root/versions"
for relative_path in "${root_docs[@]}"; do
  install -m 0644 "$vault_root/$relative_path" "$mirror_root/$relative_path"
done

find "$mirror_root/versions" -maxdepth 1 -type f -name '*.md' -delete
while IFS= read -r -d '' source_path; do
  install -m 0644 "$source_path" "$mirror_root/versions/$(basename "$source_path")"
done < <(find "$vault_root/versions" -maxdepth 1 -type f -name '*.md' -print0 | sort -z)

mkdir -p "$mirror_root/PianoCoach"
find "$mirror_root/PianoCoach" -type f -name '*.md' -delete
while IFS= read -r -d '' relative_path; do
  mkdir -p "$mirror_root/$(dirname "$relative_path")"
  install -m 0644 "$vault_root/$relative_path" "$mirror_root/$relative_path"
done < <(cd "$vault_root" && find PianoCoach -type f -name '*.md' -print0 | sort -z)

echo "Synced the approved Markdown project manual into docs/project/."
