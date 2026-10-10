# Build9 — physical usability regressions and profiling

October9, 2026. Native2.0.0/build9/schema5 is installed from `2de2444a782cb54a5cd31966ecc33257e4511dd0`,
tag `ios-v2.0.0-build9-candidate`. Build8's physical failure remains historical evidence.
The repaired actual pinch and independent score/ink alignment
review pass below. Final gesture UI passes70.518s, including toolbar Undo/Redo at actual zoom and
saved ink after relaunch. Signed device Release and strict signing/fixture checks and independent
artifact verification pass. Independent installation review verifies13 owned files/12,960,329 bytes
unchanged by filename, size and SHA-256. After automatic launch was denied, the user confirmed opening
build9 and read-only inspection confirmed it running. Independent complete post-launch readback at
October10 00:57:50 UTC preserves all13 files/12,960,329 bytes, schema5/revision2167 and every original
record including the paused active set. Physical two-finger Undo at zoom remains pending. No build9 measured speedup is claimed. The Mac remains v11.1.0/schema21.

## Reported physical behavior

Device: iPad Pro12.9-inch, third generation (`iPad8,5`), iOS18.7.8.

| Flow | User observation on installed build8 |
| --- | --- |
| Score navigation | Score cannot zoom while ink pans separately. |
| Practice grading | Clean responds after about one second. |
| General interaction | Scrolling, menu opening, mode changes and warmup exit are delayed. |
| Passage selection | About one visible update every four seconds. |
| Pencil / Undo | Pencil use crashes; a matching build8 dSYM separately identifies a native two-finger Undo crash. The precise preceding user sequence remains pending. |

These are reported symptoms, not controlled latency benchmarks. The [Undo repair ledger](undo-repair.md)
retains the confirmed `PKTiledView.performUndo` crash and its lifecycle requirements. The
[build8 installation record](../build8/personal-ipad-install.json) proves installation and preservation;
its23:59:40 UTC readback precedes the later crash and is not post-crash retention evidence.

## Captured performance evidence

A45-second physical Time Profiler capture records **18.293 seconds of main-thread CPU time**.
Of that sampled main-thread time, `syncAll` has12.276 seconds inclusive. Instruments reports14
hang/microhang intervals, with a maximum of2.018702542 seconds. These are installed build8 results;
see [sanitized physical trace measurements](build8-physical-performance.json).
The leading sampled stack is:

```text
String(format:)
  Data.praeludeHexLiteral
    InkStrokeSyncRow
      enqueueLibrarySnapshot
        scheduled syncAll
```

This identifies expensive per-byte formatting while creating ink sync rows. CPU time in a sampled
trace is not the same measurement as an individual interaction's wall-clock latency, and this
stack does not prove a single cause for all reported failures. Inclusive function samples overlap
and cannot be added together. Private device traces stay outside Git. No build9 improvement is inferred.

A first45-second physical build9 trace is effectively idle:12 all-thread samples,5 milliseconds of
main-thread sampled CPU time and no potential hangs. Foreground lifecycle during that interval is
unknown, so this is not an active responsiveness test or evidence of a speedup. A21:01 EDT screenshot
shows Today with the paused set. The second120-second trace also completed effectively idle:
15 all-thread samples,8 main-thread samples (8 milliseconds) and no potential hangs. Neither trace
contains evidence of active score gestures; neither accepts responsiveness or demonstrates a speedup.
Independent review agrees with this boundary. User gesture feedback remains pending.

## Verification checkpoints and retained failures

| Run or flow | Result and boundary |
| --- | --- |
| Core |412 tests pass, zero failures; before the final gesture-priority change. |
| Full native iPad |258 executed,1 live-account skip,0 failures. Local log: `/tmp/praelude-build9-ipad-final.log`. This source checkpoint precedes the final gesture-priority change. |
| Practice / selection UI |2 cases pass: annotation during practice with Clean/resume, and passage Done/double-tap. |
| Earlier actual Undo/Redo and pinch |Undo/Redo passes its tested portion, but actual pinch fails: PDF scale stays at minimum and pinch unintentionally triggers two-finger Undo. This failed run remains failed. |
| Gesture-priority repair |Undo requires native pinch recognition to fail; the recognizers cannot succeed simultaneously.14 targeted native interaction tests and fresh source review pass after this change. |
| Actual UI5x pinch |PDF scale reaches2.3177427145 versus minimum1.0255516841; the one ink stroke is retained. Independent before/after pixel review accepts score/ink alignment. This is an actual gesture result, not a debug-set scale. |
| Two-finger Undo / zoom boundary |Actual two-finger Undo passes Draw and reading. Two XCTest attempts cannot place the zoomed two-finger tap on the clipped viewport. This automation limitation is neither production failure nor acceptance of physical two-finger Undo at zoom. |
| Final gesture / zoom / relaunch UI |PASS70.518s: actual stroke; two-finger Undo in Draw/reading; Redo; mode change; strict real PDF pinch (scale2.3177427145 vs minimum1.0255516841) with unchanged ink; toolbar Undo/Redo at zoom; Done and saved ink after relaunch. Local log: `/tmp/praelude-build9-gesture-final.log`. |
| Palette visual review |Independent settled-pixel review passes. The earlier clipped capture was taken during a transition and does not establish settled-layout clipping. |
| Signed device Release |PASS; strict app/profile/team/device/signer certificate trust and Release fixture/debug-exclusion checks pass. Same bundle; profile expires October16 at23:56:11 UTC (7:56 PM EDT). Independent signed-artifact verification also passes. |
| Guarded installation / preservation |PASS:13 files/12,960,329 bytes identical by filename, size and SHA-256. Schema5/revision2167;6 pieces/53 passages/54 set IDs (53 historical plus1 paused active set)/35 sessions/317 attempts/259 ink records (202 active)/2 stamps/2 notes. The paused set remains active and preserved; no running set. See [sanitized build9 installation evidence](personal-ipad-install.json). |
| Actual post-helper signed artifact |PASS strict signing/profile/fixture checks. Executable SHA-256 `cde90889055e808e7c9463dd8b54dea5aa9a283410f45585a072db5b3764a100`; profile expires October16 at23:56:11 UTC. Actual arm64 app/dSYM UUID match. |
| Launch / post-launch preservation |PASS after user-confirmed opening: read-only process inspection confirms running. Independent complete October10 00:57:50 UTC backup retains all13 files/12,960,329 bytes exactly, schema5/revision2167, all original records and the paused active set. The earlier automatic-launch denial remains recorded. |
| Completed build9 physical traces |45 seconds, effectively idle:12 all-thread samples,5 main-thread CPU milliseconds, no potential hangs; foreground lifecycle unknown. This cannot establish active responsiveness or a speedup. The completed120-second trace is also effectively idle:15 all-thread samples,8 main-thread samples/8 milliseconds, no potential hangs. Neither trace establishes active score gestures. User feedback and physical acceptance remain pending. |

## Source frozen for final verification

| Change | Required contract and remaining verification |
| --- | --- |
| PDFKit-only page pan/zoom; fixed drawing canvas | Actual UI5x pinch and independently reviewed score/ink alignment pass after recognizer-priority repair. Physical gesture acceptance remains pending. |
| Bounded app-owned `PKDrawing` value history | Native tile Undo registration stays disabled. Native checkpoint,14 post-priority interaction tests and final gesture UI pass, including two-finger Undo in Draw/reading and toolbar Undo/Redo at zoom/relaunch. Physical two-finger Undo at zoom remains pending. |
| Batched durable practice sync | Session/set/new-attempt/Undo queue entries retain parent-before-child order; local cursors advance only after persistence succeeds. Native checkpoint passes; final review and physical responsiveness remain pending. |
| Byte lookup for `praeludeHexLiteral` | Keep lowercase hex, the `\x` prefix, empty input and every byte value. Core checkpoint passes; physical performance verification remains pending. |

Relevant modules: `PagedScoreView`, `ScorePageOverlay`, `ScoreInkHistory`, `SyncCoordinator`
and `SyncCoding`. Source is frozen; verification scopes above do not establish physical acceptance.

## Regression gates

- [x] Core412/0 failures and native258/1 live-account skip/0 failures at the recorded source checkpoint.
- [x] Two iPad practice/selection UI cases pass; actual Undo/Redo passes its tested portion.
- [x] Actual UI5x pinch raises PDF scale while retaining ink; independent before/after score/ink alignment review passes.14 native interaction tests and fresh source review cover the final priority change.
- [x] Final gesture UI passes70.518s, including toolbar Undo/Redo at actual zoom and saved ink after relaunch.
- [ ] Physical two-finger Undo at zoom; two XCTest placement attempts are limited by the clipped viewport.
- [ ] Core/native tests cover all bytes, wire round trips and unchanged sync payloads.
- [ ] Practice sync tests cover durable ordering, failed batch persistence, debounce, explicit reconciliation, account switches and revision reuse. A pending full-reconciliation request must survive profile initialization or snapshot-enqueue failure without leaking across accounts or causing an immediate retry loop.
- [ ] Native drawing tests cover crop/zoom alignment, late/canceled callbacks, eraser/lasso, replacement, mode/page changes and detached overlays.
- [ ] Actual touch UI flows verify shared score/ink zoom and pan, passage selection, two-finger Undo/Redo and warmup exit.
- [x] Fresh source, actual pinch alignment and settled-palette visual review pass at the frozen source checkpoint; remaining touch/physical gates stay open above.
- [ ] Compare the same physical Clean, scroll/menu/mode, selection, zoom and drawing flows with a repeat profile; report observed results rather than an assumed speedup.
- [x] Signed build9 Release and strict app/profile/team/device/signer trust and fixture/debug-exclusion checks pass.
- [x] Independent signed-artifact verification passes.
- [x] Build9 installed through guarded same-bundle refresh; all13 files/12,960,329 bytes and the paused set preserved exactly.
- [x] User opening, running-process inspection and independent complete post-launch readback pass; all13 files and the paused set remain exact.
- [ ] Physical Pencil/Undo and sustained practice acceptance; no week-long trial is implied by shorter tests.

**Next steps:** obtain actual practice/Pencil/zoom/Undo feedback and capture verified active-use profiling if needed. Physical lag and zoomed two-finger Undo remain open. Preserve the paused practice set. Keep source tests,
profiling, installation/preservation and musician acceptance separate; build8's reported failures
are not closed by installation alone.
