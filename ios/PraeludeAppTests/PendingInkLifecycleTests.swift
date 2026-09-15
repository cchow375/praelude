import PDFKit
import PencilKit
import SwiftUI
import XCTest
@testable import Praelude

final class PendingInkLifecycleTests: XCTestCase {
    @MainActor private func drawing(at y: CGFloat) -> PKDrawing {
        let points = [CGPoint(x: 20, y: y), CGPoint(x: 200, y: y + 20)].enumerated().map { index, location in
            PKStrokePoint(location: location, timeOffset: Double(index) / 10, size: CGSize(width: 3, height: 3),
                          opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black),
                                           path: PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: 1_700_000_000)))])
    }

    @MainActor private func document() throws -> PDFDocument {
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in
            context.beginPage()
            "Synthetic ink lifecycle score".draw(at: CGPoint(x: 40, y: 40))
        }
        return try XCTUnwrap(PDFDocument(data: data))
    }

    @MainActor
    func testFailedInkSurvivesCoordinatorTeardownAndRestoresItsOriginalCASBaseline() async throws {
        let markup = ScoreMarkupState()
        let source = URL(fileURLWithPath: "/synthetic-ink-recovery.pdf")
        let original = drawing(at: 60).dataRepresentation()
        let edited = drawing(at: 140)
        var saved: Data? = original
        var allowWrite = false
        var expectedAtWrite: Data?
        let parent = PagedScoreView(url: source, page: .constant(1), twoPages: false, markup: markup,
                                   drawingData: { _ in saved }, saveDrawing: { _, data, expected in
            expectedAtWrite = expected
            guard allowWrite, expected == saved else { return false }
            saved = data.isEmpty ? nil : data; return true
        }, onPageChanged: { _ in })
        var first: PagedScoreView.Coordinator? = parent.makeCoordinator()
        first?.connectControls()
        let view = ZoomableScorePDFView(); view.document = try document()
        let page = try XCTUnwrap(view.document?.page(at: 0))
        var oldOverlay: ScorePageOverlay? = try XCTUnwrap(first?.pdfView(view, overlayViewFor: page) as? ScorePageOverlay)
        first?.loading = true; oldOverlay?.canvas.drawing = edited; first?.loading = false
        first?.canvasViewDrawingDidChange(try XCTUnwrap(oldOverlay?.canvas))
        XCTAssertFalse(try XCTUnwrap(first).flush())
        XCTAssertEqual(markup.pendingInk[1]?.expected, original, "Recovery must keep the original raw CAS bytes")
        XCTAssertEqual(markup.pendingInkDocument, source)
        PagedScoreView.dismantleUIView(view, coordinator: try XCTUnwrap(first))
        oldOverlay = nil; first = nil
        XCTAssertFalse(markup.flushInk(), "A detached failed canvas must never pretend its ink was saved")
        XCTAssertEqual(saved, original)

        let second = parent.makeCoordinator(); second.connectControls()
        defer { second.autosave?.cancel() }
        let restored = try XCTUnwrap(second.pdfView(view, overlayViewFor: page) as? ScorePageOverlay)
        XCTAssertEqual(restored.canvas.drawing.strokes.count, edited.strokes.count)
        XCTAssertEqual(restored.canvas.drawing.strokes.first?.path.first?.location, edited.strokes.first?.path.first?.location)
        XCTAssertTrue(second.dirtyPages.contains(1))
        XCTAssertEqual(second.committed[1], original)
        XCTAssertFalse(markup.flushInk())
        XCTAssertEqual(expectedAtWrite, original, "Recreation must not silently accept a changed save baseline")
        allowWrite = true
        XCTAssertTrue(markup.flushInk())
        XCTAssertTrue(markup.pendingInk.isEmpty)
        XCTAssertNil(markup.pendingInkDocument)
        let reopened = try PKDrawing(data: XCTUnwrap(saved))
        XCTAssertEqual(reopened.strokes.first?.path.first?.location, edited.strokes.first?.path.first?.location)
    }

    @MainActor
    func testReturningToEmptyCanvasBaselineRemovesPendingInkWithoutWriting() async throws {
        let markup = ScoreMarkupState()
        var writes = 0
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/synthetic-empty-baseline.pdf"), page: .constant(1), twoPages: false,
                                   markup: markup, saveDrawing: { _, _, _ in writes += 1; return false }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let view = PDFView(); view.document = try document()
        let overlay = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: XCTUnwrap(view.document?.page(at: 0))) as? ScorePageOverlay)
        coordinator.loading = true; overlay.canvas.drawing = drawing(at: 100); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        XCTAssertNotNil(markup.pendingInk[1])
        coordinator.loading = true; overlay.canvas.drawing = PKDrawing(); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        XCTAssertTrue(markup.pendingInk.isEmpty)
        XCTAssertTrue(coordinator.dirtyPages.isEmpty)
        XCTAssertTrue(markup.flushInk())
        XCTAssertEqual(writes, 0, "Undoing unsaved strokes back to their baseline needs no disk mutation")
    }

    @MainActor
    func testReusedCoordinatorFlushesOldPieceBeforeAdoptingNewSaveCallbacks() async throws {
        let oldMarkup = ScoreMarkupState(), newMarkup = ScoreMarkupState()
        let oldURL = URL(fileURLWithPath: "/synthetic-old-score.pdf"), newURL = URL(fileURLWithPath: "/synthetic-new-score.pdf")
        var allowOldWrite = false
        var oldWrites = 0, newWrites = 0
        let oldParent = PagedScoreView(url: oldURL, page: .constant(1), twoPages: false, markup: oldMarkup,
                                      saveDrawing: { _, _, _ in guard allowOldWrite else { return false }; oldWrites += 1; return true }, onPageChanged: { _ in })
        let newParent = PagedScoreView(url: newURL, page: .constant(1), twoPages: false, markup: newMarkup,
                                      saveDrawing: { _, _, _ in newWrites += 1; return true }, onPageChanged: { _ in })
        let coordinator = oldParent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let data = drawing(at: 120).dataRepresentation()
        oldMarkup.rememberInk(page: 1, data: data, expected: nil, document: oldURL)
        XCTAssertFalse(coordinator.adoptParent(newParent))
        XCTAssertEqual(coordinator.parent.url, oldURL)
        XCTAssertEqual(newWrites, 0)
        XCTAssertNotNil(oldMarkup.pendingInk[1])
        allowOldWrite = true
        XCTAssertTrue(coordinator.adoptParent(newParent))
        coordinator.clearOverlays()
        XCTAssertEqual(oldWrites, 1, "Old score ink must use the old piece's callback")
        XCTAssertEqual(newWrites, 0)
        XCTAssertTrue(oldMarkup.pendingInk.isEmpty)
        newMarkup.rememberInk(page: 1, data: data, expected: nil, document: newURL)
        XCTAssertTrue(newMarkup.flushInk())
        XCTAssertEqual(newWrites, 1, "The new markup must reconnect to the reused coordinator")
        XCTAssertTrue(newMarkup.pendingInk.isEmpty)
    }
}
