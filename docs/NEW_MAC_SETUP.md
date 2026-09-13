# Working on Praelude from another Mac

This guide covers a development checkout. It does not migrate the installed app or Christian's
personal practice library by default.

## 1. Get access and clone

Sign in to the GitHub account that can read the private repository. Use either HTTPS with a
credential helper or an SSH key registered with GitHub, then clone:

```bash
git clone https://github.com/cchow375/praelude.git
cd praelude
git status --short --branch
git remote -v
```

The expected branch is `main`, tracking `origin/main`. Do not copy an old working directory or
one of the historical `.ck-lanes` / `.claude` worktrees; clone the canonical repository.

## 2. Install the platform toolchain

Install Xcode Command Line Tools with `xcode-select --install` if they are absent. Install a
current Node/npm and Rust/Cargo toolchain. The 2026-09-13 verified development machine used:

- macOS 26.5.2;
- Xcode 26.6;
- Node 26.4.0 and npm 11.17.0; and
- Rust/Cargo 1.96.1.

These are evidence, not a claim that older supported macOS versions require those exact tool
versions. The packaged app's declared minimum is macOS 13. The repository commits both
`package-lock.json` and `src-tauri/Cargo.lock`; keep them authoritative. `.node-version` pins the
known-good Node 26.4.0 developer toolchain, while package engines accept the dependency-supported
`^20.19`, `^22.12` or `>=24` ranges with npm 10+.

Run:

```bash
npm run doctor
npm run setup:mac
npm run project:check
```

The setup script runs `npm ci`. Cargo downloads its locked dependencies on the first Rust build.
No global package install is performed by the script.

## 3. Prove the checkout

```bash
npm test
(cd src-tauri && cargo test --locked)
npm run build
npm run tauri dev
```

The native app may request Microphone, Speech Recognition, Camera or score-folder access when a
feature first needs it. Browser/devMock success is not native permission acceptance.

If a copied Cargo cache refers to an old `/Users/.../codakiller` checkout, do not restore the old
path or rename compatibility identifiers. Regenerate Tauri's cached package artifacts:

```bash
(cd src-tauri && cargo clean -p tauri)
(cd src-tauri && cargo clean --release -p tauri)
```

## 4. Understand what Git does not move

The repository deliberately excludes all personal and machine-local state. A normal development
clone starts without Christian's practice database, scores, covers, day photos, Keychain items,
installed app, backups and release artifacts.

If the second Mac only needs development and automated tests, stop here. The dev mock and test
fixtures are self-contained.

If the second Mac must operate on the same real practice environment, make a separate encrypted
transfer plan. Quit Praelude, confirm no session or practice block is open, make and hash a fresh
database backup, copy the score/library files while preserving their relationships, and retain a
rollback before opening a newer build. Never use a copied live database as an ordinary test
fixture. Exact locations and schema facts can change, so read the latest release QA and `NOTES.md`
before touching live data.

API keys are machine-specific. Configure them on the second Mac through the app or macOS Keychain;
never copy them into `.env`, documentation, shell history or Git. The legacy-compatible Keychain
service name is intentional.

## 5. Resume with current truth

The Git-backed project manual is under `docs/project/`. Read its `AGENTS.md`, portable `Praelude.md`,
Command Center, Roadmap, Flaws, Changelog and current version record. Release identities and test
counts in old records are historical; verify Git and the current machine before claiming a new
release or native acceptance.

On the original Mac, `npm run docs:sync` refreshes this mirror from the Obsidian vault and
`npm run docs:check` proves it matches. On another Mac the checked-in mirror is the safe fallback;
set `PRAELUDE_PROJECT_VAULT` only if an editable vault copy is also present.
