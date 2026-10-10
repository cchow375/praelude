# Build9 opened — data preserved; active-use acceptance pending

October9,2026. Source `2de2444a782cb54a5cd31966ecc33257e4511dd0`, tag
`ios-v2.0.0-build9-candidate`. Installed native2.0.0/build9/schema5 on the actual
third-generation12.9-inch iPad Pro, iPad8,5, iOS18.7.8. Mac remains unchanged.

## What is proved

- Actual build8 trace:45seconds,18.293seconds sampled main CPU,12.276seconds inclusive
  in sync,14 potential hangs, longest2.019seconds. See the sanitized performance JSON.
- Build9 removes per-byte NSString formatting, reuses locked wire-date codecs, prepares
  immutable sync snapshots off-main, batches durable practice pushes and debounces drains.
- Fixed-source drawing canvas has no independent navigation; PDFKit owns score zoom.
  Bounded drawing-value stacks replace the native tile Undo path in the confirmed crash.
  Two-finger Undo waits for native pinch failure and cannot share its gesture sequence.
- Core412 pass; full native258/1 live-account skip/zero failures before final gesture
  priority change;14 annotation native tests pass afterward. Two practice/selection UI
  workflows pass. Final actual gesture replay passes70.518seconds: two-finger Undo in
  Draw and reading, Redo, mode changes, actual pinch with retained ink, toolbar Undo/Redo
  at zoom, Done and saved ink after relaunch. Independent scoped pixel/source review passes.
- Actual PDF scale increases from minimum1.02555 to2.31774. Two attempts to synthesize
  two-finger Undo on the clipped zoomed page fail before touch delivery; the toolbar path
  at zoom passes. Physical two-finger Undo at zoom is still required.
- Guarded update and independent recomputation prove all13 files/12,960,329bytes exact.
  The paused active set is preserved. See `personal-ipad-install.json` for full sanitized
  counts, actual post-helper binary hash and signing checks. Profile expires October16
  at23:56:11UTC. Exact installed app/dSYM and full backups remain ignored outside Git.

## Current stop point

The user confirms build9 is open; read-only process inspection confirms it running.
The00:57:50UTC post-launch backup is still byte-identical to pre-install and post-install
snapshots across all13 files. All original records and the paused set remain exact.

Two physical Time Profiler attachments complete but are essentially idle:45seconds has
12 total samples/5 main CPU ms;120seconds has15 total samples/8 main CPU ms at15-second
timer intervals. Neither records a potential hang or identifiable affected-flow activity.
Lifecycle stays Unknown in both attachments. No active responsiveness, speedup or physical
crash-repair claim is supported. A device screenshot separately shows Today with the paused
set. The user has been asked to try zoom, Pencil→Done, Undo, selection and button response;
that feedback is pending. Stop repeating idle captures until active interaction is available.

## Next steps after user feedback

1. Obtain the pending physical flow result and address any reported defect. Opening and
   post-launch preservation already pass. Keep any later legitimate user edits separate
   from installation loss; do not replay synthetic practice into the personal library.
2. Attach a45-second Time Profiler recording to the actual running Praelude process. Use
   the installed build9 dSYM. Inspect main-thread samples and potential hangs; compare
   with build8 without treating unequal interaction workloads as controlled latency tests.
3. Have the user try real Pencil marks → Done, pinch score, two-finger Undo at zoom,
   passage selection, Clean, menus, scrolling and leaving warmup. Do not create synthetic
   practice records in the personal library. Inspect any new crash evidence.
4. Record the physical result honestly, update the living docs and commit the checkpoint.
   Follow-up defects remain active work. Never uninstall/reset/restore-over or terminate
   the app as a workaround.

On this Mac the read-only helper `/tmp/praelude-build9-readback.py` and independent
`/tmp/praelude-build9-verify-preservation-independent.py` are prepared. Private refresh log:
`/tmp/praelude-build9-refresh.log`. These temporary tools are conveniences, not portable
project dependencies; the guarded supported deployment path remains `npm run ios:refresh`.
