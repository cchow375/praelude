#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

bash scripts/bootstrap-macos.sh --check
bash scripts/sync-project-docs.sh --check

node <<'NODE'
const fs = require('node:fs');

const packageVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const tauriVersion = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

if (!cargoVersion || packageVersion !== tauriVersion || packageVersion !== cargoVersion) {
  console.error(`Version disagreement: package=${packageVersion} tauri=${tauriVersion} cargo=${cargoVersion ?? 'missing'}`);
  process.exit(1);
}
console.log(`Version agreement: ${packageVersion}`);
NODE

required_files=(
  "AGENTS.md"
  "README.md"
  "CLAUDE.md"
  "NOTES.md"
  "package-lock.json"
  "src-tauri/Cargo.lock"
  "docs/NEW_MAC_SETUP.md"
  "docs/project/AGENTS.md"
  "docs/project/Praelude.md"
  "docs/project/(C) Praelude Command Center.md"
  "docs/project/(C) Roadmap.md"
  "docs/project/(C) Flaws.md"
  "docs/project/(C) Changelog.md"
  "docs/project/(C) How To Use.md"
  "docs/project/(C) Motivation.md"
  "docs/project/(C) Book-to-Mechanic Evidence Catalogue.md"
  "docs/project/(C) v2 Acceptance Matrix.md"
  "docs/project/(C) v2 Transformation Brief.md"
  "docs/project/coda killer notes.md"
  "docs/project/PianoCoach/(C) Coach App.md"
)

for required_file in "${required_files[@]}"; do
  [[ -s "$required_file" ]] || {
    echo "Missing or empty portability file: $required_file" >&2
    exit 1
  }
done

forbidden_tracked="$(git ls-files '*.db' '*.sqlite' '*.sqlite3' '*.p12' '*.pem' '*.key' '*.mobileprovision' '*.dmg' '*.exe')"
if [[ -n "$forbidden_tracked" ]]; then
  echo "Forbidden personal/release/signing files are tracked:" >&2
  echo "$forbidden_tracked" >&2
  exit 1
fi

if git grep -n -E "v10\.0\.4 / schema 21 is shipped|Installed Mac remains.*v8|Piano Practice/CodaKiller" -- README.md AGENTS.md CLAUDE.md; then
  echo "A current entry point contains a known stale project boundary." >&2
  exit 1
fi

if git grep -n -E "/Users/c3/(codakiller|praelude|piano-coach)" -- 'scripts/*.py' '.workflow/*.js'; then
  echo "Active executable tooling contains an original-Mac absolute project path." >&2
  exit 1
fi

echo "Project portability checks passed."
