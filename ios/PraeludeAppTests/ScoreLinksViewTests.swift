import PDFKit
import UIKit
import XCTest
@testable import Praelude

/// Major regression (verifier "reader lens", 2026-09-29): the link editor measured a drawn tap
/// region against its whole preview frame instead of the page thumbnail actually shown inside it —
/// `PageThumbnail` renders with `.scaledToFit()`, which letterboxes (centers, does not stretch)
/// whenever the page's own aspect ratio does not match the container's. `PageThumbnail.fitFrame`
/// is the fix: the single source of truth for where the page actually sits, that both the drag
/// gesture and the region overlay in `ScoreLinksView.swift` now measure against.
final class ScoreLinksViewTests: XCTestCase {
    @MainActor private func fixture(width: CGFloat, height: CGFloat) throws -> (PracticeStore, UUID) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-LinksTests-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let store = PracticeStore(directory: root.appendingPathComponent("Library"))
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: width, height: height)).pdfData { renderer in
            renderer.beginPage()
        }
        let source = root.appendingPathComponent("source.pdf")
        XCTAssertTrue(try XCTUnwrap(PDFDocument(data: data)).write(to: source))
        let id = try NativeLibraryFiles(store: store).importPDF(source, title: "Links test", composer: "Test")
        return (store, id)
    }

    @MainActor func testFitFrameLetterboxesAWiderThanTallPageWithinATallerContainer() throws {
        // A landscape page (1000x400) inside a portrait container (400x600): the image must be
        // letterboxed top/bottom, centered, at the container's own width — matching what
        // `.scaledToFit()` actually renders.
        let (store, id) = try fixture(width: 1000, height: 400)
        let fit = try XCTUnwrap(PageThumbnail.fitFrame(pieceID: id, page: 1, store: store, in: CGSize(width: 400, height: 600)))
        XCTAssertEqual(fit.width, 400, accuracy: 0.01)
        XCTAssertEqual(fit.height, 160, accuracy: 0.01) // 400 * (400/1000)
        XCTAssertEqual(fit.minX, 0, accuracy: 0.01)
        XCTAssertEqual(fit.minY, 220, accuracy: 0.01) // (600 - 160) / 2
    }

    @MainActor func testFitFrameLetterboxesATallerThanWidePageWithinAWiderContainer() throws {
        let (store, id) = try fixture(width: 400, height: 1000)
        let fit = try XCTUnwrap(PageThumbnail.fitFrame(pieceID: id, page: 1, store: store, in: CGSize(width: 600, height: 400)))
        XCTAssertEqual(fit.height, 400, accuracy: 0.01)
        XCTAssertEqual(fit.width, 160, accuracy: 0.01)
        XCTAssertEqual(fit.minY, 0, accuracy: 0.01)
        XCTAssertEqual(fit.minX, 220, accuracy: 0.01)
    }

    @MainActor func testFitFrameFillsAnExactlyMatchingAspectRatioWithNoLetterboxing() throws {
        let (store, id) = try fixture(width: 600, height: 800)
        let fit = try XCTUnwrap(PageThumbnail.fitFrame(pieceID: id, page: 1, store: store, in: CGSize(width: 300, height: 400)))
        XCTAssertEqual(fit, CGRect(x: 0, y: 0, width: 300, height: 400))
    }

    @MainActor func testFitFrameReturnsNilForAnOutOfRangePageOrMissingPiece() throws {
        let (store, id) = try fixture(width: 600, height: 800)
        XCTAssertNil(PageThumbnail.fitFrame(pieceID: id, page: 99, store: store, in: CGSize(width: 300, height: 400)))
        XCTAssertNil(PageThumbnail.fitFrame(pieceID: UUID(), page: 1, store: store, in: CGSize(width: 300, height: 400)))
    }
}
