# Work on Praelude iOS from another Mac

The complete native iPhone/iPad app lives in `ios/` in
[cchow375/praelude](https://github.com/cchow375/praelude). Keep this single Git repository:
it also carries the backend migrations, project manual, tests and development history.
The repository is public by Christian's explicit choice on November 13, 2026.

## Clone and open

Install full Xcode, select it in **Xcode → Settings → Locations → Command Line Tools**, complete
its first-launch setup, and install an iPhone/iPad simulator runtime through
**Xcode → Settings → Components**. Command Line Tools alone cannot compile the native app.
Xcode 26.6 with the iOS 26.5 SDK is the verified toolchain on the original Mac; the app targets
iOS/iPadOS 17+. Git and Python 3 are also needed for the commands below.

Run these commands in Terminal:

```sh
git clone https://github.com/cchow375/praelude.git
cd praelude
open ios/Praelude.xcodeproj
```

Choose the **Praelude** scheme, select an iPhone or iPad simulator, let Xcode resolve the pinned
Swift packages, then choose **Product → Run**. A fresh simulator install starts with an empty
library. Simulator builds need no Apple signing team. Node/npm and Rust are not needed for
iOS-only development.

If you already cloned this repository, commit or stash your work first, then use
`git switch main` and `git pull --ff-only origin main` instead of cloning again.

## Verify and continue development

From the repository root:

```sh
python3 ios/scripts/generate-project.py
bash ios/scripts/check.sh
python3 -m unittest discover -s ios/scripts -p 'test_*.py'
```

The check script runs core tests, deterministic service checks and an unsigned simulator build.
It does not execute the app-hosted or UI tests; choose **Product → Test** in Xcode for those.
Regenerate the Xcode project whenever you add Swift files; edit the generator for project or
version changes. `Package.resolved` is committed, while downloaded package checkouts are rebuilt.

Start coding with [ios/AGENTS.md](../AGENTS.md), the
[module and testing guide](DEVELOPMENT.md), and the checked-in
[project manual](../../docs/project/AGENTS.md). The focused editor workspace is
`ios/Praelude Mobile.code-workspace`. Backend contracts and migrations are under `supabase/`.
On a Mac without the original Obsidian vault, edit the manual under `docs/project/` and follow
its reconciliation instructions.

Commit and push your changes on the computer where you make them, then pull before working on
the other computer. GitHub write access requires signing in to the account with repository
permission; public cloning does not require it.

## Physical devices and local state

Configure your Apple account and signing team locally following
[INSTALL_ON_IPAD.md](INSTALL_ON_IPAD.md). `ios/Signing.xcconfig` reads the ignored
`ios/Signing.local.xcconfig`; put your `DEVELOPMENT_TEAM` there. Device updates must use the
documented guarded same-bundle refresh and preserve the existing practice library.

Git supplies source, tests, assets, dependency locks and documentation. It does not transfer the
installed app, practice library, private scores/photos/recordings, account sessions, signing
certificates, provisioning profiles or backups. Do not add those files to the repository.
The native library remains independent of the Mac app's database; cloning does not migrate it.

**Next steps:** clone or pull on the second Mac, run the simulator checks, then open the project
and continue development. Physical-device installation and feature acceptance are separate.
