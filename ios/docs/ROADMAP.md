# Praelude Mobile roadmap

## October 2 follow-up — build4 practice polish

Current source is **2.0.0/build4/schema4**, a development candidate. Search saved passages by name;
passages on the current source page appear first. Switching away from a running set requires an
explicit Finish and switch; Cancel keeps the current target. Setup and optional Techniques are
available before the first-attempt grade. Editable choices include rhythm pairs, hands separately
then together, passage joins, slow connected playing, touch contrast and memory checkpoints.
They suggest actions and never grade piano audio or change tempo without your choice.

More options carries the entire current draft; Use settings returns to the arm screen. Another set
and voice Next retain your chosen target count, hands, stages, tempo and metronome choices. Start
without grading records no invented attempt. Cold grading and visual passage joins now commit
atomically, retaining the original state on failed saves. Active tempo edits retain earlier attempt
BPM, stage/streak and Undo history instead of replaying from a rewritten starting tempo.

Metronome exposes Count-in Off/1–4 bars and Keep playing when locked, custom beat accents, sound,
subdivision and grouped compound pulse. In 6/8, 9/8 and 12/8 the optional dotted-quarter pulse is
labeled explicitly; triplet subdivisions supply the written eighths. Muted patterns still have audible
main-beat count-in. Count-in changes apply on next Start. Ordinary click edits retain bar phase;
route/session interruptions remain a physical-device acceptance gate.

Practice controls use native SF text and one system Liquid Glass layer on iOS26+, system material
on older iOS and an opaque accessibility fallback. Music stays opaque. Schema4 preserves the exact
older ledger before migrating; tempo histories require backup version3. Older apps refuse newer
local formats; participating sync clients must be current. See the [follow-up QA](../../docs/qa/ios/2.0.0/practice-polish.md)
for verification and remaining hardware/backend limits.

**Next steps:** finish current-source native/Release checks, guarded same-bundle update, then the
musician-controlled Mac import and actual piano-session/two-device acceptance.

## October 2, 2026 — 2.0 candidate transfer and practicality

**Mobile current source (2026-10-02): 2.0.0/build4, schema4, DEVELOPMENT CANDIDATE.** The current SwiftUI app includes a configured Supabase backend, accounts, mobile sync/private score storage, multi-instrument practice, expanded score tools, warmups, history, notebooks, rewards and social views. These source capabilities supersede the September 14 1.1 description; they do not establish a new physical installation or hardware acceptance.

**Mac library transfer:** a new read-only SQLite exporter and additive native importer preserve the complete original Mac database plus all 46 table projections. The private October 2 snapshot contains 11 piece rows (one system row), 13 distinct PDFs/14 edition paths, 140 passages, 31 goals, 3,313 repetitions, 370 sets and 67 sessions. One score, “Aolean Harp Contemporary,” is missing from the Mac; its records and missing reference are retained. Available stale-path scores are recovered through the current piece folders, with warnings. The original Mac database is not changed or uploaded.

Imported scores, equivalent passages/goals and matching pencil marks become native content; original Mac history/contracts/corrections remain readable under **Progress → Mac practice record** and travel with native backups. Old sets are not replayed through different mobile rules and do not grant new rewards. This is a reviewed snapshot transfer, not continuous Mac↔iOS sync or complete semantic parity. Supabase sync covers supported native records and private PDFs/recordings; goals/routines and the original Mac archive are not cloud-wired.

**Practicality fixes:** compact practice controls fit narrow screens; acknowledgements do not resize the score; passage-page turning after verdicts is opt-in; Today launches the first warmup in its plan; phone navigation has four main tabs plus a deliberate More; first voice-check dismissal starts requested hands-free listening; Performance mode explains its exit gesture. Native backup now includes recording files and preserved Mac archives. Sync gains paginated reads, guest-library catch-up, local-save retry, remote Undo, file retries and account isolation. Full source/core checks and scoped native evidence are in `docs/qa/ios/2.0.0/README.md`.

**Device boundary:** October 2 initially found no connected device. After Xcode preparation, the plugged-in iPad is ready and its installed 2.0.0/build3 is confirmed. No physical install, migration, Mac-data upload, real-account/two-device sync, or microphone-over-piano acceptance is claimed. The current installed build3 was observed read-only after Xcode preparation; this does not establish current hardware or account acceptance. The prior September14 installation/preservation record remains historical.

**Next steps:** connect/unlock the iPad for a guarded same-bundle update, then import the reviewed transfer from Files. Confirm score boxes/ink and history on hardware, sign into the intended account, and verify a real second-device sync before trusting cross-device continuity. Mac integration remains a separate adapter; Assistant remains on hold.


**Historical September14 foundation.** This is the mobile implementation map, not a claim of shipped desktop or
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

The 1.1.0/build2/schema2 candidate has completed its scoped simulator/build verification separately
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
toolbar recheck passes 2/2, and exact-source signing/artifact verification passes. The physical iPad now has 1.1.0/build2 installed (September 14, 20:56 EDT). After user readiness,
complete pre/post copies matched both owned files; earlier failed attempts remain historical.
Automatic launch was denied, so user launch/trust, migration and physical-feature checks remain
pending. Simulator passes do not establish hardware acceptance.

**Next steps:** finish opening the installed update (Developer App trust if prompted), verify
schema2 migration and the preserved original, then check Pencil alignment/persistence, real
touches, audio, voice and interruptions with disposable data. The in-place update and pre-launch
file preservation are already verified.

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

## October2 physical update at19:14 EDT

2.0.0/build4 is installed over the existing iPad app. All seven original library files match complete
pre/post-install copies exactly. The pre-launch ledger is schema3; current-data migration rehearsal
preserved all3,447 scalar values and the exact original file. iOS denied automatic launch: unlock and
tap Praelude, completing Developer App trust only if prompted. Actual launch/schema4 migration and
physical piano acceptance remain pending. No Mac import. Further phone acceptance is deferred at
Christian's explicit request to get the app onto the iPad now. Signed Release excludes test fixtures;
Core356, service2211, Python53, native runtime12 and largest-text300BPM checks pass.

**Next steps:** open the installed app and practice; import the reviewed Mac transfer afterward.

**First-open follow-up:** Christian opened the installed app without a trust prompt. Read-only verification confirms2.0.0/build4, schema4, three existing mobile pieces and ten historical sets. Mac import remains pending; piano/audio/two-device acceptance remains separate.
