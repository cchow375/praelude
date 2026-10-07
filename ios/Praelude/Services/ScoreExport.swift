import Foundation
import PDFKit
import PencilKit
import SwiftUI
import UIKit

/// Creates a separate, flattened sharing copy. Source PDFs and editable ink are never changed.
@MainActor enum ScoreExport {
    static let maximumOutputBytes = 200_000_000

    static func annotatedPDF(pieceID: UUID, store: PracticeStore) throws -> URL {
        let job = try prepare(pieceID: pieceID, store: store)
        do {
            while try job.appendNextPage() {}
            return try job.finish()
        } catch { job.cleanup(); throw error }
    }

    /// Captures the saved marks before rendering, then lets navigation/input run between pages.
    /// Each page remains on the main actor because stamp/text ImageRenderer requires it.
    static func annotatedPDFResponsive(pieceID: UUID, store: PracticeStore) async throws -> URL {
        try Task.checkCancellation()
        let job = try prepare(pieceID: pieceID, store: store)
        do {
            while true {
                try Task.checkCancellation()
                guard try job.appendNextPage() else { break }
                await Task.yield()
            }
            try Task.checkCancellation()
            return try job.finish()
        } catch { job.cleanup(); throw error }
    }

    private struct ExportJob {
        let appendNextPage: () throws -> Bool
        let finish: () throws -> URL
        let cleanup: () -> Void
    }

    private static func prepare(pieceID: UUID, store: PracticeStore) throws -> ExportJob {
        guard !store.isReadOnly else { throw PracticeError.unavailable("The saved library cannot be read safely. Restore it before exporting a score.") }
        guard let piece = store.pieces.first(where: { $0.id == pieceID }),
              let source = NativeLibraryFiles(store: store).scoreURL(for: piece) else {
            throw PracticeError.invalid("Attach a PDF before exporting this score.")
        }
        let snapshot = store.state
        try PracticeStore.validate(snapshot)
        let sourceValues = try source.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard sourceValues.isRegularFile == true, let bytes = sourceValues.fileSize, bytes > 0, bytes <= 100_000_000,
              let document = PDFDocument(url: source), !document.isLocked, document.pageCount == piece.pageCount,
              (1...2000).contains(document.pageCount) else {
            throw PracticeError.invalid("This score could not be exported. Choose an unlocked PDF smaller than 100 MB.")
        }
        // §7 page tools: export walks the same effective reading order the reader shows — crop,
        // rotation, reordering, deletion and blank/staff insertions all included. A piece with no
        // page edits yet gets back exactly `1...pageCount` in order, so this is a no-op for the
        // overwhelmingly common score that has never touched a page tool.
        let effectivePages = PageLayout.effectivePages(pageEdits: snapshot.pageEdits, pieceID: pieceID, sourcePageCount: piece.pageCount)
        guard (1...2000).contains(effectivePages.count) else {
            throw PracticeError.invalid("This score's page count cannot be exported safely.")
        }
        let referenceSize = ScorePageComposer.referenceSize(document)
        // Several stroke rows can now share a page (§4d); group them so each page still exports as
        // one merged drawing. Ink stays anchored to the *source* page regardless of page-tool
        // reordering (see "(C) Schema3.md"), so the lookup key here is `effective.sourcePage`, not
        // the page's position in the reading order. Every layer is included, not only `.mine` — an
        // "annotated score" export is supposed to be what a teacher or the player actually marked up,
        // and a teacher's own markings living only on the `.teacher` layer is the whole point of a
        // separate layer existing at all.
        let inkByPage = Dictionary(grouping: snapshot.inkStrokes.filter { $0.pieceID == pieceID && $0.deletedAt == nil }, by: \.page)
        let stampsByPage = Dictionary(grouping: snapshot.stampAnnotations.filter { $0.pieceID == pieceID && $0.deletedAt == nil }, by: \.page)
        let textBoxesByPage = Dictionary(grouping: snapshot.textAnnotations.filter { $0.pieceID == pieceID && $0.deletedAt == nil }, by: \.page)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Export-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        do {
            let renderedURL = directory.appendingPathComponent("rendering.pdf")
            let outputURL = directory.appendingPathComponent(exportName(piece.title))
            guard let context = CGContext(renderedURL as CFURL, mediaBox: nil,
                                          [kCGPDFContextTitle: piece.title, kCGPDFContextCreator: "Praelude"] as CFDictionary) else {
                throw PracticeError.unavailable("A PDF export could not be created.")
            }
            var rotations: [Int] = []
            var nextIndex = 0
            var closed = false
            return ExportJob(appendNextPage: {
                guard nextIndex < effectivePages.count else { return false }
                let effective = effectivePages[nextIndex]
                try autoreleasepool {
                    guard let page = ScorePageComposer.renderedPage(source: document, effective: effective, fallbackSize: referenceSize) else {
                        throw PracticeError.invalid("A score page could not be read.")
                    }
                    let media = page.bounds(for: .mediaBox), crop = page.bounds(for: .cropBox)
                    guard validBox(media), validBox(crop), media.contains(crop), page.rotation.isMultiple(of: 90) else {
                        throw PracticeError.invalid("This score contains page dimensions that cannot be exported safely.")
                    }
                    let rotation = page.rotation
                    rotations.append(rotation)
                    var pageInfo: [CFString: Any] = [kCGPDFContextMediaBox: boxData(media), kCGPDFContextCropBox: boxData(crop)]
                    for (box, key) in [(PDFDisplayBox.bleedBox, kCGPDFContextBleedBox), (.trimBox, kCGPDFContextTrimBox), (.artBox, kCGPDFContextArtBox)] {
                        let bounds = page.bounds(for: box)
                        if validBox(bounds), media.contains(bounds) { pageInfo[key] = boxData(bounds) }
                    }
                    context.beginPDFPage(pageInfo as CFDictionary)
                    // PDFKit draws relative to the selected box and applies page rotation.
                    // Render once in the original, unrotated PDF coordinates, then preserve
                    // /Rotate on the output page. The score remains vector PDF content.
                    page.rotation = 0
                    context.saveGState()
                    context.translateBy(x: media.minX, y: media.minY)
                    page.draw(with: .mediaBox, to: context)
                    context.restoreGState()
                    page.rotation = rotation
                    // Every normalized mark this app stores is defined against a page's original,
                    // uncropped bounds (`media`) *whenever a page-tool crop is actually in play* —
                    // see `GeometryTransforms.swift` and `ScorePageOverlay.activeCrop`, which this
                    // mirrors exactly. Without an active page-tool crop, `crop` (this page's own,
                    // permanently fixed display box — a scanned PDF's native `/CropBox` can differ
                    // from `/MediaBox` with nothing to do with page tools) is what marks have
                    // *always* been positioned against, live, since a page's own native crop never
                    // changes — using `media` unconditionally here would misplace marks on such a
                    // page even though nothing about a page-tool crop is involved.
                    let reference = (effective.cropRect?.isValid == true) ? media : crop
                    if let sourcePage = effective.sourcePage {
                        if let rows = inkByPage[sourcePage], !rows.isEmpty {
                            try drawInk(rows.map(\.data), reference: reference, crop: crop, context: context)
                        }
                        if let stamps = stampsByPage[sourcePage], !stamps.isEmpty { drawStamps(stamps, reference: reference, crop: crop, context: context) }
                        if let boxes = textBoxesByPage[sourcePage], !boxes.isEmpty { drawTextBoxes(boxes, reference: reference, crop: crop, context: context) }
                    }
                    context.endPDFPage()
                }
                nextIndex += 1
                return true
            }, finish: {
                context.closePDF(); closed = true
                try checkSize(renderedURL)
                guard let rendered = PDFDocument(url: renderedURL), rendered.pageCount == effectivePages.count else {
                    throw PracticeError.unavailable("The exported score could not be verified.")
                }
                for (index, rotation) in rotations.enumerated() { rendered.page(at: index)?.rotation = rotation }
                guard rendered.write(to: outputURL) else { throw PracticeError.unavailable("The exported PDF could not be saved.") }
                try checkSize(outputURL)
                try FileManager.default.setAttributes([.posixPermissions: 0o600, .protectionKey: FileProtectionType.completeUnlessOpen], ofItemAtPath: outputURL.path)
                try FileManager.default.removeItem(at: renderedURL)
                return outputURL
            }, cleanup: {
                if !closed { context.closePDF(); closed = true }
                try? FileManager.default.removeItem(at: directory)
            })
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    /// Merges one page's stroke rows (each an app-encoded, possibly multi-stroke `PKDrawing` blob)
    /// into a single drawing before rendering, so a page ink now spans several sync-ready rows
    /// exports exactly as it would have as one schema2 blob.
    ///
    /// Positioned relative to `reference` (see its call site's own doc comment), then clipped to
    /// `crop`'s own window within that same space — not relative to `crop` directly whenever
    /// `reference` is `media`, which would misplace ink drawn before a page-tool crop existed.
    private static func drawInk(_ blobs: [Data], reference: CGRect, crop: CGRect, context: CGContext) throws {
        var strokes: [PKStroke] = []
        for data in blobs {
            guard !data.isEmpty, data.count <= PracticeStore.maximumDrawingBytes else { throw PracticeError.invalid("This page contains ink that is too large to export.") }
            let piece: PKDrawing
            do { piece = try PKDrawing(data: data) }
            catch { throw PracticeError.invalid("This page contains damaged ink. Its saved data has been preserved.") }
            strokes.append(contentsOf: piece.strokes)
        }
        guard !strokes.isEmpty else { throw PracticeError.invalid("This page contains no readable ink strokes. Its saved data has been preserved.") }
        let drawing = PKDrawing(strokes: strokes)
        let bounds = drawing.bounds
        guard validCoordinates(bounds), drawing.strokes.count <= 100_000 else { throw PracticeError.invalid("This page contains ink that cannot be exported safely.") }
        let cropWindow = CGRect(x: crop.minX - reference.minX, y: reference.maxY - crop.maxY, width: crop.width, height: crop.height)
        let clipped = bounds.intersection(cropWindow)
        guard !clipped.isNull, !clipped.isEmpty else { return }
        // At most 16 million pixels per page (64 MB RGBA), released after that page.
        // Ordinary printed music gets 288 dpi ink; the underlying score stays vector.
        let scale = min(4, sqrt(16_000_000 / (clipped.width * clipped.height)), 8192 / max(clipped.width, clipped.height))
        guard scale.isFinite, scale > 0 else { throw PracticeError.invalid("This page’s ink dimensions are invalid.") }
        let image = drawing.image(from: clipped, scale: scale)
        guard let cgImage = image.cgImage else { throw PracticeError.unavailable("The ink on this page could not be rendered.") }
        // PencilKit uses top-left, page-local coordinates relative to `reference`; PDFs use bottom-left.
        let destination = CGRect(x: reference.minX + clipped.minX, y: reference.maxY - clipped.maxY,
                                 width: clipped.width, height: clipped.height)
        context.saveGState()
        context.clip(to: crop)
        context.draw(cgImage, in: destination)
        context.restoreGState()
    }
    /// Stamps and text boxes render the same way `ScorePageOverlay` does on screen (`PraeludeStamp`/
    /// `Text`, rasterized off-screen and composited — SwiftUI content cannot draw into a raw
    /// `CGContext`), positioned relative to `reference` the same way ink above is.
    private static func drawStamps(_ stamps: [StampAnnotation], reference: CGRect, crop: CGRect, context: CGContext) {
        for stamp in stamps {
            let box = stamp.position.rect(in: reference.size)
            guard box.width > 1, box.height > 1, validCoordinates(box) else { continue }
            let destination = CGRect(x: reference.minX + box.minX, y: reference.maxY - box.maxY, width: box.width, height: box.height)
            guard crop.intersects(destination) else { continue }
            guard let cgImage = renderedImage(PraeludeStamp(kind: stamp.kind, label: stamp.label, size: box.width), size: box.size) else { continue }
            context.saveGState(); context.clip(to: crop); context.draw(cgImage, in: destination); context.restoreGState()
        }
    }
    private static func drawTextBoxes(_ boxes: [TextBoxAnnotation], reference: CGRect, crop: CGRect, context: CGContext) {
        for box in boxes {
            let rect = box.region.rect(in: reference.size)
            guard rect.width > 4, rect.height > 4, validCoordinates(rect) else { continue }
            let destination = CGRect(x: reference.minX + rect.minX, y: reference.maxY - rect.maxY, width: rect.width, height: rect.height)
            guard crop.intersects(destination) else { continue }
            context.saveGState()
            context.clip(to: crop)
            context.setFillColor(UIColor(PraeludeColor.scorePaper).withAlphaComponent(0.92).cgColor)
            context.fill(destination)
            context.setStrokeColor(UIColor(PraeludeColor.scoreInk).withAlphaComponent(0.4).cgColor)
            context.setLineWidth(0.75); context.stroke(destination)
            if !box.text.isEmpty {
                let inset = destination.insetBy(dx: 2, dy: 2)
                if inset.width > 0, inset.height > 0,
                   let cgImage = renderedImage(Text(box.text).font(.system(size: max(9, rect.height * 0.32)))
                       .foregroundStyle(PraeludeColor.scoreInk).lineLimit(3).minimumScaleFactor(0.55).padding(2), size: inset.size) {
                    context.draw(cgImage, in: inset)
                }
            }
            context.restoreGState()
        }
    }
    private static func renderedImage<V: View>(_ view: V, size: CGSize) -> CGImage? {
        guard size.width > 0, size.height > 0, size.width.isFinite, size.height.isFinite else { return nil }
        let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height).environment(\.colorScheme, .light))
        renderer.scale = min(3, sqrt(4_000_000 / (size.width * size.height)), 4096 / max(size.width, size.height))
        return renderer.cgImage
    }

    private static func validCoordinates(_ rect: CGRect) -> Bool {
        [rect.minX, rect.minY, rect.width, rect.height].allSatisfy { $0.isFinite && abs($0) <= 1_000_000 }
            && rect.width >= 0 && rect.height >= 0
    }
    private static func validBox(_ rect: CGRect) -> Bool {
        validCoordinates(rect) && rect.width >= 1 && rect.height >= 1 && rect.width <= 14_400 && rect.height <= 14_400
    }
    private static func boxData(_ rect: CGRect) -> Data {
        var rect = rect
        return withUnsafeBytes(of: &rect) { Data($0) }
    }
    private static func checkSize(_ url: URL) throws {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= maximumOutputBytes else { throw PracticeError.invalid("This score exceeds the supported 200 MB export size.") }
    }
    private static func exportName(_ title: String) -> String {
        let cleaned = title.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) || "/\\:".unicodeScalars.contains($0) ? " " : String($0) }.joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var base = ""
        for character in cleaned.isEmpty ? "Score" : cleaned {
            guard base.utf8.count + String(character).utf8.count <= 200 else { break }
            base.append(character)
        }
        return (base.isEmpty ? "Score" : base) + " — annotated.pdf"
    }
}
