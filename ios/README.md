# Praelude Mobile

**1.1.0/build2 · schema2 · DEVELOPMENT CANDIDATE · updated 2026-09-14.**
Native SwiftUI, PDFKit and PencilKit for iPhone/iPad on iOS/iPadOS 17+. The physical iPad now has
**1.1.0/build2 installed**, with all owned files verified unchanged before first launch. Automatic
launch was denied; the user launch/trust step and physical-feature acceptance remain pending. The Mac product remains **v11.1.0/schema21**; this work does
not replace its app or access its practice data.

The pianist supplies every verdict. Praelude keeps the score, counts repetitions, remembers targets
and runs the metronome. It never grades piano audio or invents practice progress. Normal launches
start blank; synthetic scores and practice exist only in the separate DEBUG UI-test store.

## Open the mobile project

Use this `ios/` folder inside the existing Git repository; do not create a nested repository.
Open [Praelude.xcodeproj](Praelude.xcodeproj) in Xcode, or the optional
[Praelude Mobile workspace](Praelude%20Mobile.code-workspace) in your editor. Workspace tasks are
explicit: generate, check/build, open Xcode, helper tests, read-only status and device refresh.
Nothing runs automatically when the workspace opens.

- [Agent context](AGENTS.md): native product and safety contracts.
- [Development guide](docs/DEVELOPMENT.md): prerequisites, module map and test commands.
- [Using Mobile](docs/USING_MOBILE.md): current candidate controls and musician workflows.
- [Install on iPad](docs/INSTALL_ON_IPAD.md): free Personal Team setup and seven-day refresh.
- [Mobile roadmap](docs/ROADMAP.md), [candidate changes](docs/CHANGELOG.md) and
  [design rationale](DESIGN.md): scope, native history and Apple/forScore research.
- [Current 1.1 QA](../docs/qa/ios/1.1.0/README.md): exact evidence and remaining gates.

Install full Xcode, the iOS SDK and a compatible simulator runtime. Mac bootstrap and Command Line
Tools alone do not supply those components. From this folder:

```sh
python3 scripts/generate-project.py
bash scripts/check.sh
open Praelude.xcodeproj
```

Select **Praelude** and an iPhone/iPad simulator, then Run. The check script runs the Foundation
core, deterministic services and simulator compilation. Use `bash scripts/check.sh --core-only`
for core/services, `python3 -m unittest discover -s scripts -p 'test_*.py'` for the fake-device
helper tests, and **Product → Test** for app-hosted/native UI tests. Full commands are in the
[development guide](docs/DEVELOPMENT.md).

## What the candidate does

Phone navigation uses **Today, Pieces, Progress** tabs; iPad uses an adaptive sidebar, with tabs at
accessibility text sizes. Plain system surfaces, readable notation, large touch controls and focused
sheets keep the score prominent. There are no decorative gradients or simulated desktop windows.

- **Scores:** import from Files, read page by page, pinch to zoom, enter Focus, and use two-page or
  separate score windows where the iPad layout supports them.
- **Passages and ink:** draw multiple boxes across systems/pages, move/resize them, add optional
  measure labels, and reopen cropped previews. Write with PencilKit tools or enable finger drawing;
  ink has its own Undo/Redo and remains editable separately from the PDF. Unsaved edits and
  simultaneous-window conflicts have explicit handling.
- **Practice:** Clean streak or Total plays, focus/hands, tempo, optional clean-streak ladders,
  ordered variants/routines, pause/resume and current-set Undo. A saved repetition precedes rewards;
  an active set cannot be silently replaced.
- **Metronome:** 20–300 BPM, Tap tempo, meter, per-beat accents/silence, subdivisions, Wood/Click/Bell,
  volume and optional haptics. Reward sounds/haptics have separate preferences.
- **History and organization:** real sessions, dates, repetitions and effort levels; optional goals,
  recent pieces, search, notes and Resting. A recorded visual target opens read-only from Progress
  even after its saved shortcut changes. Native effort levels are separate from Mac Studio.
- **Sharing:** Score options → **Share annotated score** creates a separate flattened-ink PDF for
  system Files/sharing/Print. Practice boxes are excluded; the original score and editable ink stay
  in the library. A native backup preserves the editable library instead.

For the complete flow, see [Using Mobile](docs/USING_MOBILE.md). Optional voice starts at
**Score options → Hands-free commands → Enable hands-free** and requires supported on-device US
English recognition. It never falls back to server recognition. Touch needs no microphone.
While the score is open, **←/→** change pages, **Space** toggles metronome, **1/2/3** record
Clean/Sloppy/Again, and **⌘Z** undoes. Keyboard-emulating pedals can use those keys; MIDI and
proprietary pedal protocols are not implemented.

## Independent data and safe device refresh

Native schema2 lives in the app's own `Library/Application Support/Praelude/library.json`, with
owned PDFs under `Scores/`. It includes editable ink and original visual-target snapshots. Migrating
a schema1 native ledger preserves its original first. Writes validate and save atomically before
observable state and rewards change. Unreadable/newer data remains read-only; deliberate validated
recovery preserves and byte-verifies the original before replacement. An unreadable empty fallback
cannot be exported. Settings backup/restore includes the native library, PDFs and editable drawings.

This is not Mac SQLite migration, Mac-export conversion or automatic sync. Cloud measure mapping,
Listen Back, full Studio furnishings/coin economy, desktop warmups/history repair and advanced
practice policies remain separate scope. Assistant is off/on hold. PencilKit annotation is not a
claim of complete forScore parity; layers, stamps, text tools and its broader document/library
workflows remain outside this candidate.

A paid developer membership is unnecessary for personal testing. Follow the
[installation guide](docs/INSTALL_ON_IPAD.md) for Xcode sign-in, ignored `Signing.local.xcconfig`,
Developer Mode, conditional Developer App trust and rebuilding when the free profile expires.
From the repository root:

```sh
npm run ios:device -- --help
npm run ios:status -- --device "YOUR IPAD NAME"
# Explicit update of an existing installation after setup and preservation checks:
npm run ios:refresh -- --device "YOUR IPAD NAME"
```

Help/status are read-only. Refresh refuses a running set, makes a verified full pre-update copy,
rechecks the ledger, then installs over the same identifier. A second complete copy must match every
file name, length and SHA-256 before launch. There are at most two full copies per update, retained
in ignored private folders. A failed post-install check reports installed-but-unverified status;
it never launches, restores or uninstalls automatically on that failure.

**Installed September 14 at 20:56 EDT:** after the user confirmed the iPad was ready, the
complete pre-update backup passed. The helper rebuilt/signed Release and installed **1.1.0/build2**
over the same app identifier. The complete post-install copy matches both owned files (one ledger
and one PDF) by name, size and SHA-256. The pre-launch ledger remains schema1 with no active set.
Both private backups are retained. Automatic launch was denied; the exact security/lock cause is
unproven. The user was asked to unlock and tap Praelude, completing Developer App trust only if
prompted. Launch, schema2 migration and physical-feature acceptance remain separate open gates.
No uninstall, restore, reset, termination, Mac app replacement or Mac data change occurred.

## Current acceptance, with history kept separate

| 1.1 gate | Confirmed result |
| --- | --- |
| Core / services / deployment helper | 29 tests / 2,166 assertions / 28 fake-device tests pass |
| Native app-hosted | 36/36 pass on each simulator: iPad8 and Phone3 |
| Latest iPad selected UI (`ipad9`) | **3/3 pass**: finger 59.497 s, meter 61.653 s, Focus 23.719 s. iPad7 supplies boxes and accessibility markup; five targeted scenarios pass across runs. Failed earlier bundles remain evidence |
| Live ink | Newer iPad pre-Undo capture visibly shows the stroke, independently reviewed; an earlier blank capture remains unexplained. Phone3 pre-Undo/after-Redo images also show ink; physical Pencil acceptance remains pending |
| Phone current regression | `phone3`: 36/36 hosted and all 3 selected UI pass; Phone2 supplies the other 4 UI passes. All 7 distinct phone scenarios have passing evidence across runs; Phone4 final-toolbar finger 91.652 s/meter 84.624 s also passes 2/2 |
| Signed Release | Final frozen-source 1.1 build passes signature/profile, arm64/iOS17/both-family and fixture exclusion checks; production inputs stayed stable and all preserved app files match |
| Physical update | Installed 1.1.0/build2; complete two-file pre/post preservation passed; automatic launch denied and user launch/trust step pending |

The final verified signed candidate is preserved outside Git at
`releases/ios-personal-1.1.0/Praelude.app`; its [manifest](../docs/qa/ios/1.1.0/signed-release.json)
records source hashes and the dirty-working-tree boundary. The profile expires **2026-09-21 at
21:24:58 UTC**. The older signed 1.0 app remains unchanged. No current all-green full-suite,
physical-feature, App Store or TestFlight acceptance is claimed.

The [historical 1.0 ledger](../docs/qa/ios/README.md#historical-10-candidate-evidence) retains its
22 core / 2,041 service / 13 hosted checks on each simulator and 8/8 distinct iPad / 7/8 phone UI
scenarios across runs. Those results are not counted as new 1.1 passes. Its then-open complete phone backup
UI gap is now closed by the Phone3 simulator flow. Physical in-place update preservation now
passes separately; backup export/restore and broader device workflows retain their own acceptance
gates. Newer evidence is tracked in the [1.1 ledger](../docs/qa/ios/1.1.0/README.md).

**Next steps:** finish opening the installed update and verify schema2 migration/preserved original.
Installation and full pre-launch file preservation already pass. Physical Pencil precision, sharing/printing, VoiceOver, keyboard/pedals, sustained audio,
interruptions and voice over an acoustic piano still require their own acceptance.
