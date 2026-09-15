import Foundation
import PDFKit
import PencilKit
import UIKit

/// Creates a separate, flattened sharing copy. Source PDFs and editable ink are never changed.
@MainActor enum ScoreExport {
    static let maximumOutputBytes = 200_000_000

    static func annotatedPDF(pieceID: UUID, store: PracticeStore) throws -> URL {
        guard !store.isReadOnly else { throw PracticeError.unavailable("The saved library cannot be read safely. Restore it before exporting a score.") }
        guard let piece = store.pieces.first(where: { $0.id == pieceID }),
              let source = NativeLibraryFiles(store: store).scoreURL(for: piece) else {
            throw PracticeError.invalid("Attach a PDF before exporting this score.")
        }
        try PracticeStore.validate(store.state)
        let sourceValues = try source.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard sourceValues.isRegularFile == true, let bytes = sourceValues.fileSize, bytes > 0, bytes <= 100_000_000,
              let document = PDFDocument(url: source), !document.isLocked, document.pageCount == piece.pageCount,
              (1...2000).contains(document.pageCount) else {
            throw PracticeError.invalid("This score could not be exported. Choose an unlocked PDF smaller than 100 MB.")
        }
        let drawings = store.state.scoreDrawings.filter { $0.pieceID == pieceID }
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
            do {
                for index in 0..<document.pageCount {
                    try autoreleasepool {
                        guard let page = document.page(at: index) else { throw PracticeError.invalid("A score page could not be read.") }
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
                        if let saved = drawings.first(where: { $0.page == index + 1 }) {
                            try drawInk(saved.data, crop: crop, context: context)
                        }
                        context.endPDFPage()
                    }
                }
                context.closePDF()
            } catch {
                context.closePDF()
                throw error
            }
            try checkSize(renderedURL)
            guard let rendered = PDFDocument(url: renderedURL), rendered.pageCount == document.pageCount else {
                throw PracticeError.unavailable("The exported score could not be verified.")
            }
            for (index, rotation) in rotations.enumerated() { rendered.page(at: index)?.rotation = rotation }
            guard rendered.write(to: outputURL) else { throw PracticeError.unavailable("The exported PDF could not be saved.") }
            try checkSize(outputURL)
            try FileManager.default.setAttributes([.posixPermissions: 0o600, .protectionKey: FileProtectionType.completeUnlessOpen], ofItemAtPath: outputURL.path)
            try FileManager.default.removeItem(at: renderedURL)
            return outputURL
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    private static func drawInk(_ data: Data, crop: CGRect, context: CGContext) throws {
        guard !data.isEmpty, data.count <= PracticeStore.maximumDrawingBytes else { throw PracticeError.invalid("This page contains ink that is too large to export.") }
        let drawing: PKDrawing
        do { drawing = try PKDrawing(data: data) }
        catch { throw PracticeError.invalid("This page contains damaged ink. Its saved data has been preserved.") }
        guard !drawing.strokes.isEmpty else { throw PracticeError.invalid("This page contains no readable ink strokes. Its saved data has been preserved.") }
        let bounds = drawing.bounds
        guard validCoordinates(bounds), drawing.strokes.count <= 100_000 else { throw PracticeError.invalid("This page contains ink that cannot be exported safely.") }
        let clipped = bounds.intersection(CGRect(origin: .zero, size: crop.size))
        guard !clipped.isNull, !clipped.isEmpty else { return }
        // At most 16 million pixels per page (64 MB RGBA), released after that page.
        // Ordinary printed music gets 288 dpi ink; the underlying score stays vector.
        let scale = min(4, sqrt(16_000_000 / (clipped.width * clipped.height)), 8192 / max(clipped.width, clipped.height))
        guard scale.isFinite, scale > 0 else { throw PracticeError.invalid("This page’s ink dimensions are invalid.") }
        let image = drawing.image(from: clipped, scale: scale)
        guard let cgImage = image.cgImage else { throw PracticeError.unavailable("The ink on this page could not be rendered.") }
        // PencilKit uses top-left, page-local coordinates; PDFs use bottom-left.
        let destination = CGRect(x: crop.minX + clipped.minX, y: crop.maxY - clipped.maxY,
                                 width: clipped.width, height: clipped.height)
        context.saveGState()
        context.clip(to: crop)
        context.draw(cgImage, in: destination)
        context.restoreGState()
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
