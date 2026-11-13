# Build9 — named physical interactions accepted

Updated October10,2026. Source `2de2444a782cb54a5cd31966ecc33257e4511dd0`, tag
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

## Current acceptance

On October10 the user confirms that score pinch-zoom, Pencil marks → Done, two-finger
Undo, passage selection and button response **“work and feel responsive.”** Record this
as scoped physical user acceptance of build9, separate from the earlier test/profile
evidence. See `physical-user-acceptance.json` for the exact question and reply.

Opening/process inspection and the00:57:50UTC post-launch backup pass. Every one of the
13 files remains byte-identical to the guarded pre/post-install snapshots, including the
paused set, original history, annotations, account/privacy/preferences and score files.

Both physical traces remain effectively idle and cannot establish measured active-use
latency or speedup. The user report supplies physical acceptance for the named flows;
it does not prove a week of reliability, every gesture combination, audio/microphone
behavior or real-account two-device continuity. The specific zoomed two-finger Undo
combination was not separately confirmed in the reply.

## Next steps

1. Keep the accepted build9 installed for ordinary practice; no new deployment is needed.
2. Investigate any reproducible new regression, preserving user data and the prior evidence.
   Do not repeat idle profiling or create synthetic practice in the personal library.
3. Revalidate signing before the recorded October16 23:56:11UTC profile expiry if refreshing.
   Use the same bundle/team and the guarded update. No scheduled renewal was created.
4. Keep sustained-use, audio/microphone and actual two-device acceptance separate.

On this Mac the read-only helper `/tmp/praelude-build9-readback.py` and independent
`/tmp/praelude-build9-verify-preservation-independent.py` are prepared. Private refresh log:
`/tmp/praelude-build9-refresh.log`. These temporary tools are conveniences, not portable
project dependencies; the guarded supported deployment path remains `npm run ios:refresh`.
