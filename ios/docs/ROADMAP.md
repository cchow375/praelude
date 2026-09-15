# Praelude Mobile roadmap

**Updated 2026-09-14.** This is the mobile implementation map, not a claim of shipped desktop or
forScore parity. The installed Mac product remains v11.1.0/schema21. Exact candidate versions,
source digests and verification results belong to the [native QA ledger](../../docs/qa/ios/README.md).

## Established native foundation

The first 1.0.0/build1 candidate established SwiftUI iPhone tabs/iPad navigation, page-based PDF
practice, passage/set editors, ordered variants and saved routines, durable local repetitions,
goals/history, deterministic metronome/voice commands, and native backup tooling. Simulator checks
and physical installation are recorded separately. The complete iPhone backup UI scenario was
open in that baseline; the later Phone3 exporter/restore flow now closes it with simulator evidence.

The signed Personal Team candidate was installed on an iPad on September 14. The last verified
first-launch outcome was a trust/security denial; do not infer a new launch or hardware feature
verdict from an install or informal feedback. Follow the QA ledger for subsequent device evidence.

**Next steps:** retain those regression protections while evolving the native score workflow.

## Current work: score markup and a clearer mobile workspace

The 1.1.0/build2/schema2 candidate is implemented and undergoing final verification separately
from the baseline:

- Native score annotation with Apple Pencil/PencilKit, persistent per-page drawing data and safe
  schema migration, with focused tools that preserve normal page reading and zoom.
- Visual passage boxes with optional measure labels, saved previews, and read-only original-target
  review under Progress session history. Recorded targets retain their meaning after shortcut edits.
- A separate annotated PDF sharing/printing copy, with flattened ink and no practice boxes; editable
  ink and the source score remain in the native library. The three native hosted export tests pass on iPad; system share/Print UI and physical output
  acceptance are pending.
- Score-first navigation and larger, clearer practice interaction across iPhone/iPad sizes.
- Refined metronome/practice feedback with durable repetitions independent of playback.
- This mobile subproject's developer context, module map, reproducible checks, and explicit
  Personal Team install/refresh helper with full pre/post-install file hash comparison before launch
  and 28 passing fake-device safety tests.

Current evidence includes 36 hosted tests passing on both simulators. iPad9's final-toolbar
finger/meter/Focus run passes 3/3; iPad7 supplies boxes and accessibility markup. Phone3 passes
finger/backup/Focus, with four other phone UI cases from Phone2. These are five targeted iPad and
seven phone scenarios across regression runs, not one all-green full-scheme run. Phone4's final
toolbar recheck passes 2/2, and exact-source signing/artifact verification passes. The physical iPad is still 1.0.0/build1,
with full PDF backup blocked by EPERM after two probes. Simulator passes do not establish hardware
acceptance.

**Next steps:** obtain complete device backup before updating, then deliberate physical-device tests
for Pencil alignment/persistence, real touches, audio, voice and interruption behavior. Preserve
the original library through migration and verify an in-place update with disposable data.

## Follow-up acceptance and scope

| Work | Boundary |
| --- | --- |
| Physical iPhone/iPad validation | Actual imports, durable practice, rotation, VoiceOver/Dynamic Type, long-session audio, interruption and backup checks |
| Pencil precision | Test actual stylus marks, erasing/undo, zoom/rotation alignment, page transitions and reopening on supported hardware |
| Complete iPhone backup UI flow | Phone3 simulator flow passes; physical full-copy/restore preservation remains a separate gate |
| Mac/iOS data transfer | Explicit migration/sync design; native sandbox and Mac schema21 SQLite are separate |
| Annotated PDF sharing/printing | Three iPad hosted export tests pass; native share-sheet, Print workflow and physical output acceptance remain pending |
| Broader score-reader features | Layers, stamps/shapes, text annotations, page rearrangement/cropping, links and set lists each require their own scope and tests |
| Desktop features | Listen Back, Studio economy/furnishings, warmups and legacy history repair are separate ports |
| Assistant/cloud mapping | Remain on hold; neither is required for the deterministic practice loop |
| Distribution | Personal Team renewals are available for local testing; App Store/TestFlight needs a separate signing/release process |

forScore is a workflow reference, not a parity checklist silently marked complete. Its annotation
guide covers distinct features such as layers, symbols, typed notes and automatic Pencil entry.
Praelude should adopt useful musician workflows while keeping a clear practice focus.
[forScore annotation documentation](https://forscore.co/documentation/annotation/).

**Next steps:** prioritize the user's observed piano-session friction after the current milestone's
evidence is complete; document each remaining gap explicitly rather than calling the app a full port.
