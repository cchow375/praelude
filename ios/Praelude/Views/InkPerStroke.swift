import Foundation
import PencilKit

/// Deterministic `PKDrawing` <-> per-stroke `InkStroke.data` blob conversion (§7 annotate track).
///
/// Core's `InkStroke.data` is an opaque, app-encoded blob (see "(C) Schema3.md" — "Ink: per-stroke
/// storage"); the compatibility shim (`PracticeStore.saveDrawing`/`drawing`, kept unchanged for
/// whatever still calls it) writes one row holding a whole page's `PKDrawing`, however many strokes
/// it has. This file is the "future PencilKit-aware call site" that doc predicted: it splits a live
/// canvas's drawing into one single-stroke `PKDrawing` per row, so `PracticeStore.replaceInk`'s
/// content diff gives every on-screen stroke its own stable row/id, and merges rows back into one
/// drawing for editing/export. `PagedScoreView.Coordinator` is the one call site that uses this for
/// its live editing canvas; `ScoreExport` already merges a page's rows the same general way.
///
/// Splitting the *same* strokes the *same* way always produces the *same* bytes (`PKStroke`'s own
/// `Codable` encoding is deterministic for identical points/ink/transform), which is what lets
/// `InkStroke.stableID` — derived from those bytes — converge across two independent replicas that
/// split identical content, with no coordination between them.
enum InkPerStroke {
    /// One `Data` blob per stroke, in the drawing's own stroke order (`PKDrawing.strokes`, which
    /// PencilKit keeps in creation order: freehand drawing only ever appends, and erasing only ever
    /// removes — see the "(C) Schema3.md" note that a future per-`PKStroke` call site needs no
    /// further Core change). Each blob is a single-stroke `PKDrawing`'s `dataRepresentation()`, so
    /// every existing reader that already decodes a row's `data` as `PKDrawing(data:)` (`ScoreExport`)
    /// keeps working unchanged — a row simply holds one stroke instead of many.
    static func split(_ drawing: PKDrawing) -> [Data] {
        drawing.strokes.map { PKDrawing(strokes: [$0]).dataRepresentation() }
    }

    /// The inverse of `split`: rebuilds one drawing from an ordered list of row blobs (as
    /// `PracticeStore.inkStrokes` already returns them, oldest first). Mirrors the whole-page shim's
    /// existing "any corruption fails the whole page" contract (`PagedScoreView.decodeDrawing`) —
    /// deliberately not "skip the bad row," so a partially-unreadable page still surfaces as damaged
    /// rather than silently redrawing with strokes missing.
    static func merge(_ blobs: [Data]) throws -> PKDrawing {
        guard !blobs.isEmpty else { return PKDrawing() }
        var strokes: [PKStroke] = []
        for blob in blobs { strokes.append(contentsOf: try PKDrawing(data: blob).strokes) }
        guard !strokes.isEmpty else { throw PracticeError.invalid("The saved ink contains no readable strokes.") }
        return PKDrawing(strokes: strokes)
    }
}
