# Mobile 2.0 overview and October 2 verification

**Development candidate: 2.0.0/build3/schema3.** Base before this session: `8c87409`.
The [verification manifest](verification.json) records exact Release input/binary fingerprints and scoped check results.
User request: bring Mac scores/practice data to iOS and review current Supabase/native app for real pianist practicality.
No Mac application replacement, source-database rewrite, hosted backend mutation, user-account signup/upload,
or physical-device installation occurred. Read-only device status found no connected hardware.

## What is present now

The current source is much broader than the historical 1.1 README. SwiftUI/PDFKit/PencilKit supply
page-first scores, multi-box passages, ink layers, page tools, links, score scan import, organization,
setlists, bookmarks and performance mode. Practice includes explicit verdicts, tempo/variants,
learning rules, multi-instrument configuration, warmups, metronome, optional tuner/drone/recording,
fixed on-device voice commands, history/insights/notebook, rewards and social surfaces. Supabase config,
pinned SDK and migrations exist; this session does not infer hosted acceptance from their existence.

The score-first structure and deterministic verdict loop suit pianist practice. Touch-only use works
without mic/account/network. Significant friction was found by source and actual native reviews.

## Findings and resulting changes

| Finding | Consequence at a piano | Current candidate behavior | Verification boundary |
| --- | --- | --- | --- |
| Idle setup occupied nearly half the score screen | Music too small before practice starts | Compact passage/tempo/Start dock; full configuration expands on demand | Real Beethoven native screenshot inspected |
| Eight controls in one fixed-width row | Controls fall outside narrow phone/windows | Adaptive full row or stacked transport/verdict rows | Native phone/iPad geometry checks; hardware touch pending |
| Feedback added height to score inset | Notation rescaled/repositioned after repetitions | Acknowledgements occupy existing dock bounds | Native Clean/Sloppy frame checks and visual inspection |
| Multi-page passage turned after every verdict | Retry could begin on a middle page | Explicit opt-in, initially off | Source/helper tests; musical passage hardware check pending |
| Start session skipped planned warmups | Plan's first action silently changed | Launches first planned warmup | Native plan-start checks |
| Ten phone tabs | UIKit More obscured destinations unpredictably | Four main tabs plus deliberate More list | Native phone navigation check |
| First hands-free check did not start listening | Pianist needed a second enable action | Requested listening starts after initial check dismissal | Source/native build; physical mic/permission/interruption acceptance pending |
| Performance exit hidden | Player could be stranded during performance | Menu wording plus brief exit hint | Source/native build; physical page-turn performance pending |
| Backup contained recording metadata without bytes | Restore could leave missing recordings | Audio bytes included; incomplete old backups refuse replacement | Hosted regression checks below |
| Sync cap/client timestamps/ignored saves | Large or offline practice histories could disappear from device view | Paginated reads, complete log reconciliation, throwing durable apply, persisted catches/retries | Fake transport/Core checks; hosted two-device acceptance pending |
| First-device completed-set ordering | Set validated before reps, or session closed before active set moved | Atomic sessions/sets/reps reconstruction, with durable validation and retry | 41 sync checks; independent standalone completion/closure/reopen/failure reproductions pass |

The optional R6 tempo-drop and R14 pulse-drop rules are explicitly authorized by current Build Spec v2 §11;
their defaults were not changed. They can be disabled in Practice rules. They are still musician-authored
practice structure, not piano audio grading.

## Mac library transfer and fidelity

`ios/scripts/export_desktop.py` reads SQLite through a read-only connection and SQLite backup API,
verifies integrity/foreign keys and refuses unfinished practice. It exports every table with exact
values, retains the original database bytes and gathers actual score editions without directory-symlink
following. JSON tables were independently compared with all 46 tables in the preserved snapshot.
Original score names/paths/fingerprints are retained privately; no real data belongs in Git.

October 2 private complete archive: **158,357,571 bytes**, SHA256
`c4b303c37d43bbfbe129976681cb47674f3dceeeff9c8ca4c70d26b9afb5c2b8`.
Database SHA256 `afd5d18d74d619654d329754944f6be97e1d27133bc7ce0f2a6ce761c8f000e8`.
Snapshot: 11 piece rows (one system), 140 regions, 31 goals, 3,313 reps, 370 sets, 67 sessions,
14 PDF edition paths/13 distinct PDFs (39,495,428 bytes). The live DB was not changed by export.
One score, “Aolean Harp Contemporary,” is unavailable; all its records remain. Stale original paths
for two pieces resolve through available current-folder editions with explicit warnings. Related
unsupported tutorial/video or other filesystem assets are reported; this is not a full vault backup.

Settings → Import from Mac previews counts/warnings and adds native scores, edition-aware boxes,
matching pencil marks and goals. Integer identities use a stable separate namespace. Existing native
records/preferences/history/rewards win; identical import preserves edits and repairs missing identical
files. Original Mac sets retain their actual contracts, verdict vocabulary and correction events in
Progress → Mac practice record. Replaying them through different native rules would invent mastery,
so they do not grant rewards or populate native insight projections. All original table rows remain readable.
System Warm-ups is kept in the archive rather than creating a duplicate repertoire piece.

Files stage first, prior ledger is preserved and byte-verified, atomic ledger save commits last.
Failures remove only newly staged files. Original Mac archives travel in native backup/restore along
with score/cover/ink/recording data. Payload is bounded to 210 MB and encoded JSON to 280 MB; very large
existing libraries or repeated whole snapshots can exceed this limit and are refused. This is a one-time
reviewed snapshot bridge; subsequent continuous Mac↔iOS synchronization is not implemented.

## Checks and evidence

- Final Core suite: 343 tests, zero failures.41 focused sync tests include the independent verifier’s graph-ordering cases.
- Python helper/exporter suite: 52 tests, zero failures (30 device helpers + 22 exporter tests). Schema3 guarded updates preserve archives/recordings and still refuse running practice/unknown formats.
- Exporter real PDFKit page count and exact 46-table snapshot parity pass.
- Final current-source iPad hosted run: 175 tests executed, one live Supabase smoke test skipped, zero failures. Standard Xcode scheme/build settings, without the isolated linker override.
- Deterministic service harness: 2,199 voice/metronome/tap-tempo/reward/PCM assertions pass.
- iPad scoped native UI: four selected scenarios pass, covering transfer navigation, adaptive HUD/stable PDF geometry, warmup-first plan start and compact idle tempo. The later exact-source run also passes the private real-library import/start/Sloppy probe (47.320 seconds), including unchanged multi-page passage page and durable Undo.
- Phone transfer-entry and adaptive geometry scenarios pass; final isolated compact-tempo drag/one-tap expand scenario passes (59.478 seconds), using one score-row press. These are scoped passes across runs, not an all-green full UI scheme.
- Unsigned arm64 iOS Release build succeeds for 2.0.0/build3/iOS17. Binary inspection finds no DEBUG UI-test flags, desktop-transfer test entry or private transfer path. This is compilation, not signed distribution or physical launch.
- Native screenshots were visually inspected. Synthetic screenshots may be committed; personal score/library
  screenshots and transferred archives remain only in private simulator/temp directories.
- Failed UI setup attempts are retained: passage picker did not open in first geometry probe; Settings list
  virtualization/timing prevented first transfer-entry probes; scroll-adjacent Today taps sometimes did not invoke the row action. The final tempo run used one tap successfully, but the cause of those earlier ignored taps remains unproven. Their failures are not counted as passes.
- Sandbox SwiftPM/CoreSimulator failures were environment restrictions; authorized host runs supplied actual evidence.
- One isolated native build with a different derived-data directory hit the existing Helpers-framework
  workaround and passed only with a linker override. Standard configured builds, rather than that override,
  are required for the final acceptance record.

**Independent fresh review:** no remaining P1 found in reviewed scope. Remote complete-set/session closure and missing-rep failures were independently reproduced, then fixed and rechecked against real persistence/reopen behavior. Native backup version2 compatibility was reviewed: archives/audio use version2 so older readers refuse before replacement; ordinary backups without those new fields retain version1. Final hosted run covers that exact source.

## Real native Mac import (private simulator probe)

The 158 MB actual transfer imports into the separate DEBUG test store successfully: 14 native piece/edition
entries, 140 passages, 31 goals, 32 ink strokes, 13 owned PDFs and one original archive. Independently inspected
Beethoven movement 2 page 1/9 is legible and passage boxes align with the staves. Original history/database
remains local. Import itself grants no practice/rewards; interaction probes stay in the disposable DEBUG test store.
The final compact idle dock leaves substantially more room for the score; full settings remain one tap away.
The actual score, aligned multi-system boxes and compact controls were independently inspected in private native screenshots.

## Explicit remaining gaps

- Physical device was absent: no in-place install/import, new schema acceptance, touch/Pencil/Steinway voice,
  sustained audio, page-turn interruption, printing/accessibility or real practice motivation verdict.
- User's intended account and actual two-device hosted synchronization were not exercised. Hosted migrations,
  RLS/privacy regressions and deployment were not independently rerun; prior backend documents are historical evidence.
- Cloud goals/routines/custom cover bytes, raw Mac archives and ongoing desktop adapter are absent. Account switching on one local
  library is deliberately refused instead of mixing owners.
- Backend generic piece upsert can overwrite an independent newer page clock; backend receive sequence and
  remote file-content versions are absent. Full pulls favor correctness over network efficiency.
- Original-history viewer exposes only the latest receipt; preserved snapshots remain in local backups.
  Mac history is readable, with original corrections, but not integrated into mobile reward/insight computation.
- Intermittent simulator Today-row first-tap/navigation failures after scrolling remain unexplained; final isolated phone navigation/tempo succeeds without retry. Retest cold navigation on hardware.
- Some score aliases reference identical PDFs; native duplicate editions are deduplicated by content. Unsupported
  raw Mac data is preserved/readable, not represented as new native features.

**Next steps:** connect/unlock iPad, perform guarded same-bundle update and reviewed transfer import; verify
score selection/ink/history on hardware; then intended-account/real second-device synchronization and desktop adapter.
