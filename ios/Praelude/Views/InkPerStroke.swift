import Foundation
import PencilKit

/// Deterministic `PKDrawing` <-> per-stroke `InkStroke` row conversion (§7 annotate track).
///
/// Core's `InkStroke.data` is an opaque, app-encoded blob (see "(C) Schema3.md" — "Ink: per-stroke
/// storage"); the compatibility shim (`PracticeStore.saveDrawing`/`drawing`, kept unchanged for
/// whatever still calls it) writes one row holding a whole page's `PKDrawing`, however many strokes
/// it has. This file is the "future PencilKit-aware call site" that doc predicted: it splits a live
/// canvas's drawing into one row per stroke, so `PracticeStore.replaceInk`'s content diff gives
/// every on-screen stroke its own stable row/id, and merges rows back into one drawing for
/// editing/export.
///
/// **`PKDrawing.dataRepresentation()` is not a stable content key.** Empirically (an isolated test
/// harness, not a documented guarantee): re-encoding one already-built `PKDrawing` value twice
/// reproduces the same bytes, but building two *separate* `PKDrawing` values from identical
/// `PKStroke` content — exactly what wrapping each extracted stroke in its own single-stroke
/// `PKDrawing` requires — embeds a fresh random 16-byte value each time and never matches. Hashing
/// that directly (as an earlier version of this file did) would make every stroke look "new" on
/// every save, defeating the one guarantee this storage design exists for ("(C) Schema3.md": *"an
/// untouched stroke never looks updated to a future sync engine"*) and never converging across
/// devices either. `fingerprint(_:)` below is the fix: a manually-extracted, deterministic encoding
/// of a stroke's own geometry and ink attributes that never goes through PencilKit's serializer, so
/// it is stable regardless of how many times or on how many devices the same content is split.
enum InkPerStroke {
    /// One row's `(data, fingerprint)` per stroke, in the drawing's own stroke order (`PKDrawing.
    /// strokes`, which PencilKit keeps in creation order — freehand drawing only ever appends, and
    /// erasing only ever removes). `data` is a freshly re-serialized single-stroke `PKDrawing`
    /// (still fully `PKDrawing(data:)`-decodable, exactly like every existing reader — `ScoreExport`
    /// — already expects); `fingerprint` is the stable identity key `PracticeStore.replaceInk`
    /// diffs and derives a new row's id from. `existing` (this page/layer's currently-stored rows,
    /// oldest first) lets an unchanged stroke reuse its own previously-stored `data` bytes verbatim
    /// instead of re-serializing (which would still be valid but pointlessly volatile) — purely a
    /// tidiness/stability nicety, since `fingerprint`, not `data`, is what identity is keyed on.
    static func split(_ drawing: PKDrawing, reusing existing: [InkStroke] = []) -> [PracticeStore.InkStrokeInput] {
        var reusable = existing
        return drawing.strokes.map { stroke in
            let key = fingerprint(stroke)
            if let index = reusable.firstIndex(where: { $0.fingerprint == key }) {
                let row = reusable.remove(at: index)
                return PracticeStore.InkStrokeInput(data: row.data, fingerprint: key)
            }
            return PracticeStore.InkStrokeInput(data: PKDrawing(strokes: [stroke]).dataRepresentation(), fingerprint: key)
        }
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

    /// A deterministic, PencilKit-serializer-independent encoding of one stroke's ink attributes,
    /// transform and every path point's fields. Built from raw floating-point bit patterns and enum
    /// case names (`String(describing:)`, which is just the case name — stable, unlike `hashValue`,
    /// which Swift deliberately randomizes per process), never from PencilKit's own archiver. Two
    /// calls with equal stroke content always produce byte-identical output, on one device or two.
    /// `stroke.mask` (a clipping path, rarely set by pen/highlighter/eraser drawing) is not included:
    /// two strokes differing only in mask would fingerprint as equal — an accepted, documented gap
    /// rather than hand-rolling a canonical `UIBezierPath` encoding for a path this app never sets.
    static func fingerprint(_ stroke: PKStroke) -> Data {
        var bytes = Data()
        // CGFloat is 64-bit (Double-backed) on every platform this app ships to, but is normalized
        // explicitly rather than relied upon, so this stays correct even if that ever changed.
        func append(_ value: CGFloat) { withUnsafeBytes(of: Double(value)) { bytes.append(contentsOf: $0) } }
        func append(_ value: Double) { withUnsafeBytes(of: value) { bytes.append(contentsOf: $0) } }
        func appendText(_ text: String) {
            withUnsafeBytes(of: Int64(text.utf8.count).littleEndian) { bytes.append(contentsOf: $0) }
            bytes.append(contentsOf: text.utf8)
        }
        appendText(String(describing: stroke.ink.inkType))
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        stroke.ink.color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        append(red); append(green); append(blue); append(alpha)
        let t = stroke.transform
        append(t.a); append(t.b); append(t.c); append(t.d); append(t.tx); append(t.ty)
        withUnsafeBytes(of: Int64(stroke.path.count).littleEndian) { bytes.append(contentsOf: $0) }
        for point in stroke.path {
            append(point.location.x); append(point.location.y)
            append(point.size.width); append(point.size.height)
            append(point.opacity); append(point.force)
            append(point.azimuth); append(point.altitude)
            append(point.timeOffset)
        }
        return bytes
    }
}
