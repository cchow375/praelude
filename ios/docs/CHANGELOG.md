# Mobile candidate changes

## October 2, 2026 — 2.0 candidate transfer and practicality

**Mobile current source (2026-10-02): 2.0.0/build3, schema3, DEVELOPMENT CANDIDATE.** The current SwiftUI app includes a configured Supabase backend, accounts, mobile sync/private score storage, multi-instrument practice, expanded score tools, warmups, history, notebooks, rewards and social views. These source capabilities supersede the September 14 1.1 description; they do not establish a new physical installation or hardware acceptance.

**Mac library transfer:** a new read-only SQLite exporter and additive native importer preserve the complete original Mac database plus all 46 table projections. The private October 2 snapshot contains 11 piece rows (one system row), 13 distinct PDFs/14 edition paths, 140 passages, 31 goals, 3,313 repetitions, 370 sets and 67 sessions. One score, “Aolean Harp Contemporary,” is missing from the Mac; its records and missing reference are retained. Available stale-path scores are recovered through the current piece folders, with warnings. The original Mac database is not changed or uploaded.

Imported scores, equivalent passages/goals and matching pencil marks become native content; original Mac history/contracts/corrections remain readable under **Progress → Mac practice record** and travel with native backups. Old sets are not replayed through different mobile rules and do not grant new rewards. This is a reviewed snapshot transfer, not continuous Mac↔iOS sync or complete semantic parity. Supabase sync covers supported native records and private PDFs/recordings; goals/routines, custom cover bytes and the original Mac archive are not cloud-wired.

**Practicality fixes:** compact practice controls fit narrow screens; acknowledgements do not resize the score; passage-page turning after verdicts is opt-in; Today launches the first warmup in its plan; phone navigation has four main tabs plus a deliberate More; first voice-check dismissal starts requested hands-free listening; Performance mode explains its exit gesture. Native backup now includes recording files and preserved Mac archives. Sync gains paginated reads, guest-library catch-up, local-save retry, remote Undo, file retries and account isolation. Full source/core checks and scoped native evidence are in `docs/qa/ios/2.0.0/README.md`.

**Device boundary:** October 2 read-only status found no connected iPad/iPhone. No physical install, migration, Mac-data upload, real-account/two-device sync, or microphone-over-piano acceptance is claimed. The last documented physical install remains September 14 1.1/build2 with verified file preservation and a launch/trust boundary. Current app/account/device state must be rechecked when connected.

**Next steps:** connect/unlock the iPad for a guarded same-bundle update, then import the reviewed transfer from Files. Confirm score boxes/ink and history on hardware, sign into the intended account, and verify a real second-device sync before trusting cross-device continuity. Mac integration remains a separate adapter; Assistant remains on hold.


This is the mutable native development history. It does not change shipped Mac version records or
establish App Store/TestFlight shipment. See [current QA](../../docs/qa/ios/2.0.0/README.md) for exact
build/run evidence and [the roadmap](ROADMAP.md) for remaining scope.

## September 14, 20:56 EDT — update installed, data preservation verified

**Installed September 14 at 20:56 EDT:** after the user confirmed the iPad was ready, the
complete pre-update backup passed. The helper rebuilt/signed Release and installed **1.1.0/build2**
over the same app identifier. The complete post-install copy matches both owned files (one ledger
and one PDF) by name, size and SHA-256. The pre-launch ledger remains schema1 with no active set.
Both private backups are retained. Automatic launch was denied; the exact security/lock cause is
unproven. The user was asked to unlock and tap Praelude, completing Developer App trust only if
prompted. Launch, schema2 migration and physical-feature acceptance remain separate open gates.
No uninstall, restore, reset, termination, Mac app replacement or Mac data change occurred.

**Next steps:** finish the device launch/trust step and verify schema migration, then physical
feature acceptance. See the separate installed-artifact and preservation record in current QA.

## September 14, 20:50–20:52 EDT — historical attempts blocked before installation

**Update attempt, September 14 at 20:50–20:52 EDT:** the user-requested refresh stopped at
its full pre-install backup, before building, installing or launching. Xcode's **Download
Container** also failed with CoreDevice7000/POSIX1 while reading a SplashBoard snapshot cache;
its partial cache copy contains no verified practice folder. A subsequent read-only status check
then reported 1.0.0/build1. These failures did not prove the iPad was locked. The requested
unlock/open-app interaction preceded the later successful backup/update recorded above. No uninstall, restore, reset or termination was performed.

**Next steps at that boundary:** obtain device interaction and complete backup before installation.
The subsequent update above clears that gate; launch remains separate. Source is `124707d`.

## 1.1.0/build2 — development candidate, 2026-09-14

- Select passages with multiple translucent boxes across systems/pages, move/resize them, keep
  optional measure labels and reopen a cropped score preview.
- Write editable PencilKit ink, with explicit finger drawing and separate ink Undo/Redo. Keep
  unsaved drawings and present conflicts when two windows edit the same page. PDF navigation now
  waits for the drawing recognizer so finger strokes reach the canvas.
- Review the original recorded visual target from session history. Share a separate annotated
  PDF with flattened ink through the system Files/sharing/Print sheet; omit practice boxes and
  keep the original score and editable ink unchanged.
- Expand metronome meter, accents/silence, subdivisions, sounds, volume, haptics and Tap tempo.
  Show restrained earned feedback after a repetition saves; audio never gates durable practice.
- Improve touch areas, Focus, and portrait/landscape accessibility layouts while keeping the score
  visible. Native sidebar/tabs and sheets remain simple; no decorative gradients or fake windows.
- Use independent native schema2 storage, preserving the original schema1 ledger during migration.
  Blank normal launches and separate DEBUG fixture storage remain mandatory.
- Add the focused mobile workspace, module guide, installation/renewal guide and explicit safe
  helper. Existing-app updates retain full pre/post copies and compare every file hash before
  launch. PDF loss/mutation or failed verification blocks launch; no automatic restore/uninstall.

Scoped simulator/build verification passes: 36 hosted tests pass on each simulator; iPad9 passes its
three final-toolbar cases, with other iPad/phone scenarios accepted across recorded regressions.
Phone4 toolbar verification passes 2/2; final exact-source signing and byte-verified artifact preservation pass. The physical iPad was subsequently updated to 1.1.0/build2 with complete pre/post
file verification; automatic launch was denied. See the dated installation entry above. A signed 1.1 snapshot is preserved outside
Git, and includes the final gesture/toolbar changes with stable input hashes. Physical Pencil/audio/voice,
printing, device accessibility, migration/sync and full desktop/forScore parity are separate gates.

**Next steps:** finish launch/trust and verify migration/physical features. Installation and
complete pre-launch file preservation are recorded separately from those open gates. Keep the
QA ledger's failures and scoped simulator results visible.

## 1.0.0/build1 — historical native candidate, 2026-09-14

Introduced native Today/Pieces/Progress, Files/PDF reading, passages, deterministic practice,
variants/routines, optional on-device speech, metronome, goals/history/calendar and native backups.
It used independent schema1 storage. A free Personal Team build installed on the iPad at 17:51 EDT;
its initial launch request encountered developer trust. The historical signed app and acceptance
records remain unchanged at [the 1.0 ledger](../../docs/qa/ios/README.md#historical-10-candidate-evidence).

**Next steps:** retain the baseline as history and use the current candidate's QA and safe update
workflow; historical passes do not become new-version acceptance automatically.
