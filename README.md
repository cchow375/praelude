# Praelude

Praelude is a native piano practice and repertoire tracker for macOS, built with Tauri v2,
Rust, React and TypeScript. The pianist supplies every Clean, Sloppy or Again verdict;
Praelude counts, times, remembers, runs the metronome and organizes local scores. It does
not grade piano audio.

**Current release:** v11.1.0 / schema 21, shipped and installed on the original development
Mac on 2026-09-08. The installed app is ad-hoc signed and not notarized. Native microphone /
Steinway acceptance, real-provider score mapping, cover-picker acceptance and Windows 10/11
acceptance remain open. See [the portable project summary](docs/project/Praelude.md) for the
complete current boundary.

## Start on another Mac

Requirements:

- macOS 13 or newer;
- Xcode Command Line Tools;
- Node.js `^20.19`, `^22.12` or `>=24` and npm 10+ (`.node-version` pins the known-good
  Node 26.4.0 checkout toolchain);
- Rust and Cargo (verified here with Rust 1.96.1); and
- access to the private `cchow375/praelude` GitHub repository.

```bash
git clone https://github.com/cchow375/praelude.git
cd praelude
npm run doctor
npm run setup:mac
npm test
(cd src-tauri && cargo test --locked)
npm run tauri dev
```

`npm run doctor` only inspects the machine. `npm run setup:mac` checks the same prerequisites
and runs the lockfile-exact `npm ci`; it does not install Homebrew, Xcode, Rust, credentials,
API keys or an app into `/Applications`.

Read these before changing the product:

1. [AGENTS.md](AGENTS.md) — binding process and safety rules.
2. [New Mac setup](docs/NEW_MAC_SETUP.md) — credentials, local data and verification.
3. [Command Center](docs/project/%28C%29%20Praelude%20Command%20Center.md) — current work and
   open acceptance lanes.
4. [NOTES.md](NOTES.md) — engineering decisions and gotchas, newest first.
5. [v11.1 QA](docs/qa/v11.1.0/README.md) — latest release evidence.

The full living project manual is mirrored under [`docs/project/`](docs/project/README.md),
including the Changelog, Roadmap, tutorial, flaw registry and version records. A clone is
therefore sufficient to resume work even when the original Obsidian vault is unavailable.

## Everyday commands

```bash
npm run tauri dev                       # native development app
npm run dev:mock                        # browser design-review harness
npm test                                # frontend suite
npm run build                           # TypeScript + production frontend
(cd src-tauri && cargo test --locked)    # Rust suite
npm run tauri build -- --bundles app    # build only the .app
```

Release and install commands are intentionally separate from ordinary development. Do not run
`npm run release:mac` until the data-safety gates in `AGENTS.md`, `NOTES.md` and the current
release plan have been followed. The release path can replace the installed app; it must never
run through an open practice set/session.

## Local-only state

Git contains source, lockfiles, engineering evidence and the privacy-safe project manual. It
does **not** contain:

- the live SQLite database or practice history;
- score PDFs, cover images or day photos;
- macOS Keychain items or API keys;
- `/Applications/Praelude.app`, release backups or rollback archives; or
- generated `node_modules`, Cargo targets, bundles or DMGs.

Those items must be transferred or backed up separately if the second Mac also needs the same
personal practice environment. See [New Mac setup](docs/NEW_MAC_SETUP.md). Never commit them.

## Compatibility boundary

Visible branding is Praelude. The bundle identifier `com.christian.codakiller`, database name
`codakiller.db`, legacy Keychain service and durable storage keys are intentional compatibility
contracts. Renaming them without a designed and verified migration could strand existing data or
macOS permissions.

## Documentation mirror

On the original Mac, the editable Obsidian project folder remains:

`~/Desktop/christian's universe/Piano Practice/Praelude`

After updating its living documents, refresh the Git-backed mirror:

```bash
npm run docs:sync
npm run docs:check
npm run project:check
```

Override the source folder with `PRAELUDE_PROJECT_VAULT=/absolute/path` when needed. The sync
script copies only the approved Markdown manual and version records; it excludes databases,
scores, output files and non-Markdown legacy assets. The small bannered v2/PianoCoach Markdown
lineage is retained as historical evidence because the current manual refers to its lessons.
