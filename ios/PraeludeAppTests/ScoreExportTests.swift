import PDFKit
import PencilKit
import UIKit
import XCTest
@testable import Praelude

final class ScoreExportTests: XCTestCase {
    @MainActor private func fixture() throws -> (PracticeStore, Piece, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-ExportTests-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let store = PracticeStore(directory: root.appendingPathComponent("Library"))
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { renderer in
            for page in 0..<5 {
                renderer.beginPage()
                "VECTOR_SCORE_\(page)".draw(at: CGPoint(x: 80, y: 100), withAttributes: [.font: UIFont.systemFont(ofSize: 18)])
            }
        }
        let document = try XCTUnwrap(PDFDocument(data: data))
        for index in 0..<5 {
            let page = try XCTUnwrap(document.page(at: index))
            if index == 4 { page.setBounds(CGRect(x: 20, y: 30, width: 612, height: 792), for: .mediaBox) }
            page.setBounds(CGRect(x: 40, y: 70, width: 500, height: 650), for: .cropBox)
            page.rotation = [0, 90, 180, 270, 0][index]
            let existing = PDFAnnotation(bounds: CGRect(x: 350, y: 200, width: 30, height: 30), forType: .square, withProperties: nil)
            existing.color = .blue; existing.interiorColor = .blue
            page.addAnnotation(existing)
        }
        let source = root.appendingPathComponent("source.pdf")
        XCTAssertTrue(document.write(to: source))
        let id = try NativeLibraryFiles(store: store).importPDF(source, title: "Export / study", composer: "Test")
        return (store, try XCTUnwrap(store.pieces.first { $0.id == id }), source)
    }

    @MainActor private func redInk() -> Data {
        let points = [CGPoint(x: 100, y: 195), CGPoint(x: 175, y: 205)].enumerated().map { index, location in
            PKStrokePoint(location: location, timeOffset: Double(index) / 10, size: CGSize(width: 8, height: 8),
                          opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .red),
                                           path: PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: 1_700_000_000)))]).dataRepresentation()
    }

    /// Read normalized image coordinates from a deliberately simple color marker.
    @MainActor private func centroid(_ image: UIImage, red: Bool) throws -> CGPoint? {
        let cg = try XCTUnwrap(image.cgImage)
        let width = cg.width, height = cg.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        try bytes.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: width, height: height,
                                                  bitsPerComponent: 8, bytesPerRow: width * 4,
                                                  space: CGColorSpaceCreateDeviceRGB(),
                                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue))
            context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        var totalX = 0.0, totalY = 0.0, count = 0.0
        for y in 0..<height {
            for x in 0..<width {
                let offset = (y * width + x) * 4
                let matches = red ? bytes[offset] > 180 && bytes[offset + 1] < 100 && bytes[offset + 2] < 100
                                  : bytes[offset + 2] > 180 && bytes[offset] < 100 && bytes[offset + 1] < 100
                if matches { totalX += Double(x) + 0.5; totalY += Double(y) + 0.5; count += 1 }
            }
        }
        guard count > 0 else { return nil }
        return CGPoint(x: totalX / count / Double(width), y: totalY / count / Double(height))
    }

    @MainActor func testAnnotatedExportKeepsVectorContentAndAlignsInkForCropRotationAndOffsetMedia() async throws {
        let (store, piece, original) = try fixture()
        let files = NativeLibraryFiles(store: store)
        let storedURL = try XCTUnwrap(files.scoreURL(for: piece))
        let originalBytes = try Data(contentsOf: original), storedBytes = try Data(contentsOf: storedURL)
        let ink = redInk()
        for page in 1...5 { try files.saveDrawing(pieceID: piece.id, page: page, data: ink) }
        let before = store.state, ledger = try Data(contentsOf: store.fileURL)
        let exportedURL = try ScoreExport.annotatedPDF(pieceID: piece.id, store: store)
        addTeardownBlock { try? FileManager.default.removeItem(at: exportedURL.deletingLastPathComponent()) }
        let exported = try XCTUnwrap(PDFDocument(url: exportedURL)), source = try XCTUnwrap(PDFDocument(url: storedURL))
        XCTAssertEqual(exported.pageCount, 5)
        XCTAssertNotEqual(exportedURL, storedURL)
        XCTAssertFalse(exportedURL.lastPathComponent.contains("/"))
        // Verify the pixel reader's top-left convention independently of PDF rendering.
        let marker = UIGraphicsImageRenderer(size: CGSize(width: 100, height: 100)).image { context in
            UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 100, height: 100))
            UIColor.red.setFill(); context.fill(CGRect(x: 20, y: 30, width: 20, height: 10))
        }
        let markerCenter = try XCTUnwrap(centroid(marker, red: true))
        XCTAssertEqual(markerCenter.x, 0.3, accuracy: 0.01); XCTAssertEqual(markerCenter.y, 0.35, accuracy: 0.01)
        for index in 0..<5 {
            let page = try XCTUnwrap(exported.page(at: index)), originalPage = try XCTUnwrap(source.page(at: index))
            XCTAssertEqual(page.rotation, originalPage.rotation)
            XCTAssertEqual(page.bounds(for: .mediaBox), originalPage.bounds(for: .mediaBox))
            XCTAssertEqual(page.bounds(for: .cropBox), originalPage.bounds(for: .cropBox))
            // PDFKit can extract the underscores as separate trailing lines even in
            // the original PDF. Compare actual extracted content, not drawing-call text.
            let originalText = try XCTUnwrap(originalPage.string)
            let exportedText = try XCTUnwrap(page.string)
            XCTAssertTrue(originalText.contains("VECTOR") && originalText.contains("SCORE"))
            XCTAssertFalse(exportedText.isEmpty)
            XCTAssertEqual(exportedText, originalText, "Export must retain the source's searchable text")
            let thumbnail = page.thumbnail(of: CGSize(width: 1000, height: 1000), for: .cropBox)
            let red = try XCTUnwrap(centroid(thumbnail, red: true), "Exported page must contain the actual saved ink")
            let x = 137.5 / 500.0, y = 200.0 / 650.0
            let expected: CGPoint
            switch page.rotation {
            case 90: expected = CGPoint(x: 1 - y, y: x)
            case 180: expected = CGPoint(x: 1 - x, y: 1 - y)
            case 270: expected = CGPoint(x: y, y: 1 - x)
            default: expected = CGPoint(x: x, y: y)
            }
            XCTAssertEqual(red.x, expected.x, accuracy: 0.015, "Ink x on rotation \(page.rotation)")
            XCTAssertEqual(red.y, expected.y, accuracy: 0.015, "Ink y on rotation \(page.rotation)")
            let originalBlue = try XCTUnwrap(centroid(originalPage.thumbnail(of: CGSize(width: 1000, height: 1000), for: .cropBox), red: false))
            let exportedBlue = try XCTUnwrap(centroid(thumbnail, red: false))
            XCTAssertEqual(exportedBlue.x, originalBlue.x, accuracy: 0.005)
            XCTAssertEqual(exportedBlue.y, originalBlue.y, accuracy: 0.005, "Existing PDF annotation must stay aligned")
            let attachment = XCTAttachment(image: thumbnail); attachment.name = "annotated-export-rotation-\(page.rotation)-page-\(index + 1)"; attachment.lifetime = .keepAlways; add(attachment)
        }
        XCTAssertEqual(store.state, before)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), ledger)
        XCTAssertEqual(try Data(contentsOf: original), originalBytes)
        XCTAssertEqual(try Data(contentsOf: storedURL), storedBytes)
        XCTAssertEqual(store.drawing(pieceID: piece.id, page: 1), ink)
    }

    @MainActor func testExportOmitsPracticeBoxesAndUsesUniqueCopies() async throws {
        let (store, piece, _) = try fixture()
        try store.savePassage(Passage(pieceID: piece.id, title: "Private practice target", regions: [PassageRegion(page: 1, x: 0, y: 0, width: 1, height: 1)]))
        let first = try ScoreExport.annotatedPDF(pieceID: piece.id, store: store)
        let second = try ScoreExport.annotatedPDF(pieceID: piece.id, store: store)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: first.deletingLastPathComponent())
            try? FileManager.default.removeItem(at: second.deletingLastPathComponent())
        }
        XCTAssertNotEqual(first, second)
        let page = try XCTUnwrap(PDFDocument(url: first)?.page(at: 0))
        XCTAssertFalse(page.string?.contains("Private practice target") == true)
        XCTAssertNil(try centroid(page.thumbnail(of: CGSize(width: 300, height: 400), for: .cropBox), red: true))
        XCTAssertTrue(store.state.passages[0].regions.count == 1)
    }

    @MainActor func testDamagedInkAndUnavailableLibraryCannotExportOrMutateOriginals() async throws {
        let (store, piece, _) = try fixture()
        try store.saveDrawing(pieceID: piece.id, page: 1, data: Data("damaged saved ink".utf8))
        let bytes = try Data(contentsOf: store.fileURL), state = store.state
        XCTAssertThrowsError(try ScoreExport.annotatedPDF(pieceID: piece.id, store: store))
        XCTAssertThrowsError(try ScoreExport.annotatedPDF(pieceID: UUID(), store: store))
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes); XCTAssertEqual(store.state, state)
        try Data("unreadable library".utf8).write(to: store.fileURL)
        let unreadable = PracticeStore(directory: store.directory)
        XCTAssertTrue(unreadable.isReadOnly)
        XCTAssertThrowsError(try ScoreExport.annotatedPDF(pieceID: piece.id, store: unreadable))
    }
}
