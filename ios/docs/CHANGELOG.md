# Mobile candidate changes

This is the mutable native development history. It does not change shipped Mac version records or
establish App Store/TestFlight shipment. See [current QA](../../docs/qa/ios/1.1.0/README.md) for exact
build/run evidence and [the roadmap](ROADMAP.md) for remaining scope.

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
Phone4 toolbar verification passes 2/2; final exact-source signing and byte-verified artifact preservation pass. The confirmed physical iPad installation remains 1.0.0/build1;
complete PDF backup access is required before updating. A signed 1.1 snapshot is preserved outside
Git, and includes the final gesture/toolbar changes with stable input hashes. Physical Pencil/audio/voice,
printing, device accessibility, migration/sync and full desktop/forScore parity are separate gates.

**Next steps:** verify complete device backup, then
record installation, file preservation and launch separately. Keep the QA ledger's failures and
scoped simulator results visible.

## 1.0.0/build1 — historical native candidate, 2026-09-14

Introduced native Today/Pieces/Progress, Files/PDF reading, passages, deterministic practice,
variants/routines, optional on-device speech, metronome, goals/history/calendar and native backups.
It used independent schema1 storage. A free Personal Team build installed on the iPad at 17:51 EDT;
its initial launch request encountered developer trust. The historical signed app and acceptance
records remain unchanged at [the 1.0 ledger](../../docs/qa/ios/README.md#historical-10-candidate-evidence).

**Next steps:** retain the baseline as history and use the current candidate's QA and safe update
workflow; historical passes do not become new-version acceptance automatically.
