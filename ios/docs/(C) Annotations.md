# (C) Annotations — ink, stamps, text boxes, layers, and passage editing

## October 10 — build11 sticky-note candidate

Personal iPad remains build10; requested friend’s fresh empty build11 installation is pending final signing checks; Developer Mode/DDI are ready. Build11 adds `TextAnnotationStyle` and shared
`TextAnnotationRenderer` for readable text and vector PDF export. Size20 defaults use a595-point
canonical original-page width, with sizes12–48, four font families, bold/italic, five text colors
and three alignments. Font/layout dimensions remain canonical while the CGContext scales; this
avoids source-unit-dependent glyph layout. Overlay work adds eight-screen-point corner resizing; note editing keeps
formatting in a lower scrollable section. Move/resize must preserve ID, source page, text, style,
layer and timestamps except the explicit edit clock. Failed saves must not publish a new region.

Style decodes optionally in old libraries/backups, without rewriting files on opening. Existing
`annotations.region` JSONB carries nested `textStyle`; old readers understand geometry but can
lose unsupported style on rewrite. Core420 and final iPad5 native64 pass, including strict glyph comparison, styled vector export and authoritative saved-note receipts for consecutive gestures. The final oversized actual UI flow passes1131.493s; ordinary fails184.170s at pre-note navigation amid extreme host load. The whole UI run is not accepted. Physical note and broader layout acceptance remain open in [the build11 ledger](../../docs/qa/ios/2.0.0/build11/sticky-notes.md).

**Next steps:** complete the explicitly requested friend's fresh empty installation after target-specific signature checks, then verify physical note behavior. Optional phone checks remain unperformed, not passed.

## Historical initial annotation implementation

Build spec §7 annotation bullets and §8, implemented. Scope: `ios/Praelude/Views/ScorePageOverlay.swift`,
`ScoreMarkupState.swift`, `PassagePickerView.swift`, and the new annotation files listed below;
`ScoreWorkspace.swift` and `PagedScoreView.swift` touched only at the boundary these need. Schema3's
model (`InkStroke`, `StampAnnotation`, `TextBoxAnnotation`, `Passage.color`/`parentPassageID`/
`joinedFromPassageIDs`) already had homes for all of this; nothing here changes `Models.swift`.

## Per-stroke ink

`PagedScoreView`'s editable canvas still speaks one whole-page `Data` blob per page at its
`drawingData`/`saveDrawing` boundary (unchanged, still fully tested by `ScoreMarkupTests`/
`PendingInkLifecycleTests`) — but `ScoreWorkspace.persistInk` now turns a save into true per-stroke
storage underneath: `InkPerStroke.split` gives every on-screen `PKStroke` its own `InkStroke` row via
`PracticeStore.replaceInk`, and `InkPerStroke.merge` is the inverse for display/reload.

**The one non-obvious finding this track made:** `PKDrawing(strokes: [stroke]).dataRepresentation()`
embeds a fresh random 16-byte value on every independent construction, confirmed empirically (an
isolated test harness, not shipped) — re-encoding one already-built `PKDrawing` twice is stable;
building two _separate_ `PKDrawing` values from identical `PKStroke` content is not, including when
extracted by mutating a copy of an existing multi-stroke drawing rather than constructing fresh. A
first implementation that hashed those raw bytes directly would have made every stroke look "new" on
every single save — the opposite of the "an untouched stroke never looks updated" guarantee schema3
was built for — and would never have converged across devices either.

The fix separates identity from storage:

- `InkStroke.fingerprint: Data?` (new, optional field) is a caller-computed content key, distinct
  from `data` (the actual stored, still fully `PKDrawing`-decodable bytes).
- `InkPerStroke.fingerprint(_:)` manually extracts a stroke's ink type/color, transform and every
  path point's fields into a deterministic byte sequence — raw floating-point bit patterns and
  `String(describing:)` enum names, explicitly never PKDrawing's own serializer or Swift's
  per-process-randomized `hashValue`. Two calls with equal stroke content always produce
  byte-identical output, on one device or two.
- `PracticeStore.replaceInk` diffs and derives a new row's id from `fingerprint ?? data`; the
  original `[Data]`-only overload (still what the whole-page compatibility shim, `saveDrawing`, calls)
  is now a one-line wrapper delegating to the new one with `fingerprint: nil` — byte-for-byte
  unchanged behavior for that call site.
- `InkPerStroke.split(_:reusing:)` also reuses an unchanged stroke's own previously-stored `data`
  bytes instead of re-serializing (a real save always has the page's prior rows on hand), so an
  untouched stroke's row is genuinely byte-stable across ordinary saves, not just id-stable.

`InkStroke.stableID` (from the stalled run this track resumed) hashes whatever `Data` it is given —
it doesn't know or care whether that is `fingerprint` or `data`; only the caller does.

Migrating a legacy whole-page blob into per-stroke rows is lazy, not proactive: the next time that
page is actually saved (the user draws or erases something), `persistInk` submits the _full current_
stroke set through `InkPerStroke.split`, which tombstones the old coarse row (its bytes never match a
fresh single-stroke blob) and creates one fine-grained row per stroke. A page that is only ever read,
never re-saved, keeps its coarse row indefinitely — harmless, since `InkPerStroke.merge` reads any mix
of coarse and fine rows identically.

New rows created in the same flush are spaced a microsecond apart in `createdAt` by their ordinal
(their position in the full current stroke array), so several strokes landing in one save — most
visibly the first time a multi-stroke legacy blob is split — redraw in their original relative order
deterministically, rather than depending on `Set`/dictionary iteration order for the tie.

## Tools, colors, layers

`ScoreMarkupState.tool: AnnotationTool` (pen/highlighter/eraser/lasso/stamp/text, each with the
curated `AnnotationColor` — graphite plus red/blue/green pencil, §7's named exception to the app's
otherwise strictly monochrome palette — and an `AnnotationWidth` preset) replaces the old, never-wired
`inkTool` property and now actually drives `canvas.tool`. `AnnotationToolbar` is the custom picker
(§3b: no stock component look) that replaces the system `PKToolPicker` as the primary way to choose a
tool; the system palette stays hidden so a person can never change a tool somewhere `markup.tool`
never hears about, but `canvas.becomeFirstResponder()` is still called for an inking tool, which alone
(not picker visibility) keeps Apple Pencil's own double-tap/squeeze shortcuts live. Lasso reuses
PencilKit's own native move/resize/duplicate/delete interaction entirely; eraser is `.vector` (removes
whole strokes, matching the per-stroke row model).

Layers (`InkLayer.mine/teacher/performance`) have an active layer (which one new ink/stamps/text are
captured into — switching it flushes and reloads through the exact same path a document switch
already used, so `PagedScoreView.Coordinator` needed no new per-layer state) and independent
visibility. A layer other than the active one, when visible, renders as a read-only merged image
underneath the editable canvas (`ScorePageOverlay.otherLayersImage`, computed and cached by content
signature in `PagedScoreView.Coordinator`) — a plain `UIImage`, not a second interactive
`PKCanvasView`, so another layer's ink is structurally impossible to edit from this device, not just a
UI convention.

## Stamps and text boxes

`StampAnnotation`/`TextBoxAnnotation` already had full Core CRUD; this track wired placement,
selection and rendering. `PraeludeStamp` renders fingerings (1–5), dynamics (pp–ff, built by placing
Bravura letterform glyphs side by side — SMuFL has no single combined glyph per dynamic marking),
breath marks and bowings (up/down bow) as Bravura/SMuFL glyphs; circles and "watch this" (SMuFL has no
glyph for either) are drawn shapes, the latter a custom two-lens mark matching `PraeludeIcon`'s
consistent-stroke house style. Every new `PraeludeMusicGlyph.Symbol` codepoint was independently
confirmed present (non-`.notdef`) in the bundled `Bravura.otf`'s cmap before use — the same
verification method "(C) Design System.md" documents for `gClef`/`noteQuarterUp`.

Placement is tap-based: an armed stamp/text tool claims taps on `ScorePageOverlay` (never drags — a
finger drag while placing must not fall through into passage-box drawing); tapping an existing stamp
selects it (for a toolbar "Remove stamp" action) instead of placing a second one, and only when it
belongs to the active layer; tapping an existing text box reopens `TextBoxEditorView`, a sheet editor
matching `PassageEditorView`'s established pattern rather than in-place WYSIWYG editing.

**Deliberately not built:** drag-to-reposition an existing stamp or text box (delete-and-replace is
the v1 path); resizing a text box after creation. Both are real gaps if extended annotation editing
becomes a priority, not attempted here to keep the gesture surface unambiguous within this track's
time.

## Passages: recolor, split, merge, rename, quick sub-passage

`Passage.color`/`parentPassageID`/`joinedFromPassageIDs` already existed; `PracticeStore.splitPassage`/
`mergePassages` (from the stalled run) needed a compile fix and had zero test coverage — both are
now covered (region bookkeeping, learning-state reset on split vs. carried-over color, provenance on
merge, archived-not-erased secondaries, rejection of empty/all/cross-piece/archived selections).
`PassagePickerView`'s long-press menu gained Rename (alert), Recolor (a submenu of the same curated
`AnnotationColor` palette ink uses), Split off boxes… and Merge with… (new `PassageSplitView`/
`PassageMergeView` sheets, listing regions/candidate passages respectively).

**A real, separate bug fixed in passing:** neither `ScoreWorkspace.savedPassages` nor
`PassagePickerView.passages` filtered `archived` — flagged as a known gap in "(C) Schema3.md" ("What
is deliberately not here yet") once `deletePassage` became archive-not-erase, and squarely this
track's to close. Both now do.

Quick-create sub-passage while practicing: a "Mark a spot" button in the practice dock (enabled only
while a set is actually running) arms `ScoreMarkupState.quickBoxArmed`, which does **not** change
`mode` — the practice dock, HUD, verdict buttons and music stay exactly as they are. One drag on the
score commits a `PassageRegion` into a brand-new child passage (inheriting the practicing passage's
focus/color, starting its own fresh learning history) via `markup.pendingQuickBox`, observed by
`ScoreWorkspace`; `ScoreMarkupState` never touches `PracticeStore` directly, matching the existing
draft/baseline pattern for ordinary passage selection.

## Coordinate transforms (annotation alignment across rotation/zoom/crop)

Rotation and zoom were already correct by construction: `PDFPageOverlayViewProvider` hands
`ScorePageOverlay` bounds and gestures in the page's own unrotated, crop-box-relative basis and
applies rotation itself — proved by the pre-existing
`ScoreMarkupTests.testNativePDFOverlayCoordinatesMatchCroppedPageAtEveryRotation`, which this track
left untouched and still passes. Stamps, text boxes and quick-sub-passage boxes reuse the exact same
`rect(in:)` idiom passage regions already used, so they inherit that correctness with no new math.

Crop needed real work: `NormalizedRect.croppedForDisplay(within:)`/`uncroppedFromDisplay(within:)`
(new, pure-`Double`, in Core) map a mark's original-page-basis coordinates into and out of a
non-destructive crop's own frame. The non-destructive crop _tool_ itself (§7 "page tools") is a
different, unimplemented spec bullet — out of this track's scope — but the transform pair is written
and tested now, so when that tool is built, marks display and get created correctly against a cropped
page from day one instead of needing a coordinate-system retrofit. `CGRect.normalizedRotatedForDisplay`
(extracted from `PassagePickerView`'s inline thumbnail rotation-correction switch, a
behavior-preserving refactor) is the separate, already-solved half: placing a normalized mark onto an
already-_rendered_ (rotation-baked-in) raster image, the one case the live overlay's own
rotation-invariance doesn't cover.

## What is deliberately not here yet

- Teacher/performance layer editing is unverified end-to-end on a device — the read-only underlay and
  active-layer switch are implemented and unit-tested (`AnnotationAppTests`,
  `ScoreMarkupTests`), but no one has watched two layers' ink actually composite correctly on real
  hardware.
- Drag-to-move for stamps and text boxes (see above).
- Non-destructive crop's actual page-tool UI (only the coordinate transform it will need).
- Persisting layer-visibility/active-layer choice across app launches — it is session-only
  (`ScoreMarkupState`, in-memory), matching how `markup.tool`/`markup.mode` already work.
- A `MobileMarkupUITests.testFingerInkUndoAndRelaunch` finding: `canvas.undoManager?.undo()` — one
  unchanged, pre-existing line this track never touched — itself reports `canRedo == false`
  immediately after `undo()` returns, on the assigned simulator/PencilKit/OS build (confirmed via an
  isolated NSLog + `simctl log stream` capture, not checked in, with zero app code running between the
  call and that reading). Not a regression; the most recent audit never ran UI tests at all, so this
  was never proven reliable before either. Recorded via `XCTExpectFailure` rather than silently
  skipped or weakened, so the suite is honest about it and a platform fix or a real-device run would
  surface as newly-passing. Redo-after-undo on this specific canvas remains **unverified**.
