# Build9 — physical Undo, score navigation and responsiveness repair

October 9, 2026. Build9 is installed after the guarded update; actual opening and physical acceptance remain pending. Build8 failed physical acceptance.

## Actual device evidence

The user opened the newly installed build8 and reported that something still fails. A new
Praelude crash report identifies build8 on iOS18.7.8 and a main-thread `EXC_BAD_ACCESS`
(`KERN_INVALID_ADDRESS` at `0x10`). The report was captured at23:59:53UTC and named at
19:59:56EDT. Its application image UUID exactly matches the privately archived, actual
post-refresh build8 dSYM. Symbolication and the recorded system frames show:

```text
twoFingerTapped -> undoFromTouch -> connectControls Undo closure
NSUndoManager.undoNestedGroup -> _NSUndoStack.popAndInvoke
PKTiledView.performUndo
PKTiledView.updateTilesForVisibleRectOffscreenOverrideAdditionalStrokes:withCallback:
```

This is a native Undo crash, distinct from the build7 SwiftUI/PDF navigation watchdog.
The later user report confirms drawing and passage-selection failures, independently panning ink and severe delays throughout practice. Missing
active-tool/attachment guards and native undo actions surviving drawing replacement are
source risks; the report alone does not prove which lifetime transition invalidated a tile.

Build8 installation and data preservation remain independently proved:13 files/12,788,247
bytes match exactly before launch. The full readback at23:59:40UTC precedes this crash;
it cannot establish post-crash retention. See the [build8 installation record](../build8/personal-ipad-install.json).
Private crash reports, complete backups and the exact build8 app/dSYM remain outside Git.

## Repair and verification plan

The repair replaces native tile undo actions with app-owned `PKDrawing` value history,
retaining two-finger, toolbar and system Undo/Redo. It must bound retained history, reset
at external drawing boundaries and protect active/canceled/late Pencil callbacks. The source implementation and independent review pass; physical acceptance remains open.

Apple's [Undo registration documentation](https://developer.apple.com/documentation/foundation/undomanager/disableundoregistration())
defines balanced disable/enable registration. The installed SDK's public `PKCanvasView.h`
documents that drawing changes can arrive after tool-end because final Pencil pressure is
delayed, or never arrive for a canceled interaction. Tests must model those cases rather
than treating tool-end as proof that the final drawing has arrived.

- [x] App-owned bounded history and lifecycle guards implemented and independently reviewed.
- [x] Native late/canceled drawing, eraser/lasso, replacement, zoom and detach regressions.
- [x] Actual two-finger Undo in Draw and reading; actual pinch, toolbar Undo/Redo at zoom and reopening saved ink.
- [ ] Physical two-finger Undo at zoom (XCTest cannot place its points on the clipped page).
- [x] Signed build9, release fixture exclusion and actual profile/signature verification.
- [x] Fresh guarded same-bundle update with complete owned-file preservation.
- [ ] Physical Pencil/Done/Undo/Redo retry and post-launch evidence.

**Next steps:** open installed build9, obtain a post-launch readback, then repeat physical
Pencil/Done/Undo/zoom and profile responsiveness on the actual iPad. Simulator success is
separate from physical iOS18.7.8 and does not establish a week of sustained reliability.

## Physical performance evidence

A 45-second Time Profiler attachment to the running build8 on the actual iPad8,5 /
iOS18.7.8 captured18.293 seconds of sampled main-thread CPU time. Inclusive stacks include
12.276 seconds in `SyncCoordinator.syncAll`,9.964 in full snapshot enqueue and5.922 in
per-byte `String(format:)` ink conversion. These nested timings overlap and must not be
added. Instruments records14 potential hangs above250ms, totaling16.805 seconds, with a
maximum2.019 seconds. This independently corroborates the reported interaction delays;
it is not a direct touch-to-frame latency measurement. Sanitized evidence is
[build8-physical-performance.json](build8-physical-performance.json). Raw traces and actual
score screenshots stay private outside Git.

The focused1MiB hex benchmark on this Mac measured5,489.068ms for the previous conversion
and14.950ms for the byte lookup, producing identical2,097,154-byte output. This is a
component benchmark, not a measured iPad improvement. The production date codec also keeps
private formatters behind one lock, retaining the existing wire representation while
avoiding repeated ICU construction. Full-library sync preparation now runs on an immutable
snapshot off the main actor; publication retains the durable queue/account guards. Practice
updates batch their ordered parent/set/attempt/Undo entries in one queue write.

## Verification ledger

- Initial core pass:407 tests, zero failures; preceded the final date/preparation additions.
- Initial native build failed compiling a complex expression in the new history test fixture.
  The fixture now uses explicit typed points, paths and strokes; no production change was
  made to hide a failing assertion.
- A concurrent intermediate core run was invalidated when its input SyncEngine source changed;
  it is not counted as a pass. Final runs use frozen source.
- Signed device Release and post-repair physical profile remain pending; subsequent native/core/UI results follow.

- Final core pass:412 tests, zero failures in36.244 seconds, including exact/concurrent
  date wire coding, large sliced-data ink encoding, async snapshot account/cancellation guards
  and durable account-bind retry.
- Native2 caught a real repair defect: drawing-value history's private UndoManager attempted
  reciprocal registration without an open group. The hosted mode/focus/Undo test threw
  `NSInternalInconsistencyException`. The run was interrupted after evidence capture.
  The history implementation was replaced with direct bounded drawing stacks; the
  public responder bridge still rejects native PencilKit registrations. The exact failing case
  passes in the later native3 and full native runs.

- Native3 (final direct-stack history and pre-publication revision guard):53 focused hosted
  tests pass with zero failures in3.827 seconds. Coverage includes all10 history cases, the
  exact prior crash case,7 async checkpoint cases,28 score markup/source geometry cases and
 7 sync coordinator cases. This is simulator evidence, not physical Pencil acceptance.

- Full native run:258 tests,1 live-account skip, zero failures in26.772 seconds.
  Actual iPad-simulator UI workflows also pass annotation during a practice set with Clean
  and resumed progress, plus passage selection committed by Done or double-tap.
- The first actual gesture run encountered an automation targeting failure on the PDF
  container; targeting its visible native page fixes that obstruction. A second gesture
  run exposes a real conflict: a pinch begins, but the two-finger Undo tap also recognizes,
  removes the stroke and leaves PDF scale at its minimum. Native availability checks did
  not catch it. This remains an installation blocker until the actual pinch/retained-ink
  regression passes. The test keeps its zoom threshold and now checks ink preservation.

- Pinch-priority repair makes the two-finger Undo recognizer wait for the native PDF
  pinch to fail and forbids simultaneous recognition. Fourteen annotation native tests
  pass, including the new policy regression in all three modes; independent source review
  finds no issue. The repeated actual gesture retains its ink, but the1.8x synthesized
  spread still leaves zoom unchanged. Existing focus-mode regression documents XCTest's
  few-point starting distance and uses5x to cross the native threshold. The next replay
  uses that same spread without weakening the minimum zoom or retained-ink assertions.
- The repeated practice/annotation UI flow passes in33.545 seconds. A settled capture
  after palette expansion confirms the pen, graphite and Fine controls are not clipped;
  the earlier partial expansion screenshot was a transition capture.

- The5x synthesized pinch succeeds: actual PDF scale2.3177427145 versus minimum
 1.0255516841; ink remains one stroke. The subsequent two-finger tap cannot be located
  by XCTest because the zoomed page extends outside the viewport. The replay now targets
  the visible native PDF scroll container for that tap, keeping the same real two-touch
  synthesis and Undo/Redo/persistence assertions. Production source is unchanged.
- Independent settled-palette pixel review passes: six tools, graphite swatch, full
  Fine/Medium/Bold labels, drag grip/title, collapse and Done are visible; practice tempo,
  transport and verdict controls remain unobscured.

- A second zoomed two-finger tap target (the native PDF scroll viewport) hits the same
  XCTest coordinate-computation limitation before any touch is delivered. The final test
  therefore keeps actual two-finger Undo in Draw and reading, strict actual pinch scale
  and ink retention, then uses the visible Undo/Redo toolbar at zoom and verifies saved
  ink after relaunch. This is narrower automated coverage: physical two-finger Undo at
  zoom remains explicitly pending. The two failed automation runs remain in this ledger.
- Independent before/after pinch pixel review confirms the stroke's relationships to
  the same staff and note remain aligned, as do the passage boxes. No visual blocker
  remains in these portrait simulator captures.

- Final gesture replay passes in70.518 seconds: actual finger stroke, two-finger Undo,
  toolbar Redo, Done, two-finger Undo in reading, return to Draw/Redo, actual PDF pinch
  with unchanged ink, toolbar Undo/Redo at zoom, Done and saved ink after relaunch.
  The PDF's actual scale is2.3177427145 versus minimum1.0255516841. All failed attempts
  above remain recorded; this does not establish physical Pencil or two-finger Undo at zoom.

- Signed arm64 device Release2.0.0/build9 passes strict signature, same bundle/team,
  device inclusion, signer membership/private-key identity/trust and fixture/debug/test
  exclusion. Profile expires October16 at23:56:11UTC. This is a local package gate,
  separate from installation and physical acceptance. Sanitized details:
  [signed-release.json](signed-release.json).

- Guarded build9 installation completes at00:45UTC October10 (October9 local). All13
  owned files/12,960,329 bytes match exactly by filename, size and SHA-256. Schema5/
  revision2167 retains6 pieces,53 passages,54 set IDs including the paused active set,
 35 sessions,317 unique attempts,259 ink rows (202 active),2 stamps and2 notes.
  The helper-rebuilt installed binary passes independent strict signing again; its
  actual executable hash is recorded in [personal-ipad-install.json](personal-ipad-install.json),
  distinct from the earlier package-only hash. Automatic launch was declined by iOS;
  user opening, post-launch readback and physical profiling remain pending.
