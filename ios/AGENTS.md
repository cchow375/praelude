# Praelude Mobile — task entry point

This directory is the native iPhone/iPad subproject of the existing Praelude Git repository.
Open `ios/` for focused mobile work. **Do not initialize a nested Git repository or copy the
application into another checkout.** The parent [operating manual](../docs/project/AGENTS.md)
and [repository entry point](../AGENTS.md) remain binding, including the living-document protocol.

Start with [README.md](README.md), [the module map and checks](docs/DEVELOPMENT.md),
[the mobile roadmap](docs/ROADMAP.md), and [native acceptance evidence](../docs/qa/ios/README.md).
Device installation and seven-day Personal Team renewal are in
[INSTALL_ON_IPAD.md](docs/INSTALL_ON_IPAD.md). Use that guide for device work; Mac release scripts
do not install this target.

## Product contract

- The pianist supplies every verdict. No piano recognition, automatic musical grading, or
  invented practice statistics. Counting and metronome control stay deterministic and offline.
- Keep the score prominent and page-based. Reading/zoom, annotation, and practice controls must
  coexist without accidental marks or lost page context. Prefer PencilKit/PDFKit public APIs.
- Use native adaptive navigation, system typography and materials, generous hit targets, focused
  sheets, and restrained feedback. No gradients, decorative dashboards, or simulated desktop windows.
- iPhone, iPad, narrow windows, landscape, and accessibility text sizes are distinct review cases.
  A control's 44-point frame alone does not prove its text fits or the score remains usable.
- Write valid practice data before feedback. Preserve durable state if storage or audio fails.
  Migration and backup restore need explicit data-preservation tests.

## Engineering boundaries

- SwiftUI app: `Praelude/`; Foundation-only package: `Praelude/Core/`; generated Xcode project:
  `Praelude.xcodeproj`; generator: `scripts/generate-project.py`.
- Regenerate the project after adding Swift files. Edit the generator for project/version changes;
  avoid hand-edited project changes that regeneration would erase.
- `Signing.xcconfig` includes optional ignored `Signing.local.xcconfig`. Never commit team IDs,
  personal names/emails, device IDs, certificates, profiles, app data, or raw device logs.
- `scripts/device.py` defaults to help. `devices` and `status` are read-only; `install` and
  `refresh` explicitly build/sign/install/launch. Never call those actions during a read-only audit.
  It uses Apple's tools, checks signing, backs up existing data, and refuses a running set.
  Do not add an uninstall, data reset, silent bundle-ID change, or active-set termination workaround.
- The mobile sandbox is independent of the installed Mac app and schema21 SQLite database.
  A mobile install does not authorize changes to `/Applications/Praelude.app` or Mac practice data.
- Normal launches are blank. Synthetic scores/practice belong only to the separate DEBUG UI-test
  store. Release builds must exclude fixture arguments and test plug-ins.

## Completion evidence

Run checks appropriate to the change; see [DEVELOPMENT.md](docs/DEVELOPMENT.md). For changed UI,
inspect actual native screenshots and interaction on both form factors. For Pencil, sound, speech,
touch/pedal input, and interruptions, distinguish simulator evidence from physical-device acceptance.
An installed app or successful launch is not proof that these features work at a piano.

Record exact source/build/test boundaries in the QA ledger. Do not call the native app shipped,
claim complete desktop/forScore parity, or close a physical-device gap without the corresponding
evidence. Update the editable vault first on the original Mac, then run root `docs:sync` and
`docs:check`; a fresh clone without the vault uses the checked-in manual as fallback. Coordinate
with the parent task before changing another agent's source files or finalizing shared docs.
