# Working on Praelude from another Mac

This guide covers a development checkout. It does not migrate the installed app or Christian's
personal practice library by default.

For **iPhone/iPad-only development**, follow the [native iOS setup guide](../ios/docs/NEW_MAC_SETUP.md).
It skips the desktop Node/Rust bootstrap and opens the same repository's Xcode project directly.

## 1. Get access and clone

The repository is public by Christian's explicit November 13, 2026 choice. Clone over HTTPS;
sign in with a credential helper or a registered SSH key when you need to push:

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

### Native iPhone/iPad development

The separate SwiftUI candidate in `ios/` requires **full Xcode**, its **iOS SDK**, and a compatible
**iOS simulator runtime**. Command Line Tools alone cannot build or run it. Install the needed
runtime through [Xcode Settings → Components](https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components).
`npm run setup:mac` prepares the Mac/Tauri checkout;
it does not install Xcode or iOS runtimes.

Open the focused [Praelude Mobile workspace](../ios/Praelude%20Mobile.code-workspace), or the
[Xcode project](../ios/Praelude.xcodeproj), inside this same Git repository. Follow the
[current mobile guide](../ios/README.md) and [module/check guide](../ios/docs/DEVELOPMENT.md)
for generation, native tests and simulator work. No workspace task runs automatically. The target
supports iOS/iPadOS17+ and uses an independent schema5 sandbox library; this handoff does not
migrate installed Mac practice data.

A paid Developer Program membership is not required for personal cable testing. The dedicated
[installation and seven-day renewal guide](../ios/docs/INSTALL_ON_IPAD.md) explains Xcode Personal
Team sign-in, Developer Mode, conditional developer trust and the explicit safe refresh helper.
Use `npm run ios:device -- --help` or `npm run ios:status -- --device "YOUR IPAD NAME"` for read-only
setup checks; `npm run ios:refresh -- --device "YOUR IPAD NAME"` is an explicit build/install action.
It refuses running sets and requires complete pre/post-install file preservation before launch.

The generated project reads `ios/Signing.xcconfig`, which optionally includes ignored
`ios/Signing.local.xcconfig`. Keep your own `DEVELOPMENT_TEAM` only in that local file; it is not
needed for simulator/unsigned work and survives generation. Do not transfer another Mac's
credentials, certificates, profiles or device identifiers through Git. Signed artifacts and
private backups are excluded from a clone. See the [current native QA](qa/ios/README.md)
for signed-snapshot, installed-version and device-backup boundaries; a signed build is not physical
feature acceptance.

## 3. Prove the checkout

```bash
npm test -- --maxWorkers=4
(cd src-tauri && RUST_TEST_THREADS=4 cargo test --locked)
npm run build
npm run dev:mock
```

The browser preview uses disposable fixtures and does not open the native practice database. Stop
it before running the native Vite server because both use port 1420. A default `npm run tauri dev`
uses `com.christian.codakiller` and opens the existing per-app `codakiller.db`; a source clone does
not isolate that runtime data. Before a native development launch on a Mac with existing personal
state, follow the backup/data-safety boundary in section 4. Do not use the live DB as a smoke-test
fixture. This Mac's setup used browser preview and compilation/tests without a native launch.

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

## 6. Earlier Mac setup evidence — 2026-11-13

The checkout is `/Users/christian/praelude`, originally imported at `6447c65`. At that earlier
check, GitHub omitted the mobile source described in the local notes. The published `00cf2b0`
handoff now resolves that gap and supplies native 2.0.0/build21/schema5. Follow
`ios/docs/NEW_MAC_SETUP.md` and [this Mac's mobile QA](qa/ios/second-mac-setup-2026-11-13.md).

This Mac's editable vault is `~/Desktop/christians universe/Piano Practice/Praelude` (no apostrophe).
Its local `.zshenv` sets the supported `PRAELUDE_PROJECT_VAULT` override, so ordinary
`npm run docs:sync`, `npm run docs:check` and `npm run project:check` use that folder. These paths
are observations about this Mac, not new hardcoded script defaults.

Doctor, lockfile-exact setup, frontend/native tests, frontend build, debug native compilation and
fresh-context live browser preview pass. No application was installed or native personal-state
launch performed. Existing app-data byte counts and SHA-256 match before/after. The existing npm
lockfile has 10 current advisories (3 moderate, 7 high); dependency remediation is separate.
See [the setup QA record](qa/setup-2026-11-13.md) for exact evidence and limits.
