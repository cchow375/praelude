import PDFKit
import PencilKit
import SwiftUI
import XCTest
@testable import Praelude

@MainActor @Observable private final class FocusedPDFNavigationModel {
    var page = 1
    var twoPages = false
    var shown = true
    var url: URL
    var stored: [Int: Data] = [:]
    init(url: URL) { self.url = url }
}
private struct FocusedPDFNavigationHost: View {
    let model: FocusedPDFNavigationModel
    let markup: ScoreMarkupState
    var body: some View {
        if model.shown {
            PagedScoreView(url: model.url, page: Binding(get: { model.page }, set: { model.page = $0 }),
                           twoPages: model.twoPages, markup: markup, drawingData: { model.stored[$0] },
                           saveDrawing: { number, data, expected in
                guard model.stored[number] == expected else { return false }
                model.stored[number] = data; return true
            }, onPageChanged: { _ in })
        } else { Text("Score closed").accessibilityIdentifier("closedSyntheticScore") }
    }
}

final class FocusedPDFNavigationTests: XCTestCase {
    @MainActor private weak var hostedView: UIView?
    @MainActor private func descendants<T: UIView>(_ root: UIView, matching type: T.Type) -> [T] {
        (root as? T).map { [$0] } ?? root.subviews.flatMap { descendants($0, matching: type) }
    }
    @MainActor private func waitFor(file: StaticString = #filePath, line: UInt = #line, _ condition: () -> Bool) async throws {
        for _ in 0..<100 {
            hostedView?.setNeedsLayout(); hostedView?.layoutIfNeeded()
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("The native PDF transition did not finish", file: file, line: line)
    }
    @MainActor func testFocusedCanvasPageTurnsDocumentReplacementAndExitOutsideSwiftUIUpdate() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("focused-pdf-\(UUID())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in
            for index in 1...4 { context.beginPage(); "Synthetic page \(index)".draw(at: CGPoint(x: 40, y: 80)) }
        }
        let url = directory.appendingPathComponent("score.pdf"); try data.write(to: url)
        let replacement = directory.appendingPathComponent("replacement.pdf"); try data.write(to: replacement)
        let model = FocusedPDFNavigationModel(url: url)
        let markup = ScoreMarkupState(); markup.mode = .writing; markup.fingerDrawing = true
        let host = UIHostingController(rootView: FocusedPDFNavigationHost(model: model, markup: markup))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 820, height: 1100))
        window.rootViewController = host; window.isHidden = false; host.view.frame = window.bounds
        hostedView = host.view
        defer { window.isHidden = true; window.rootViewController = nil }
        host.view.layoutIfNeeded()
        try await waitFor { self.descendants(host.view, matching: ScorePageOverlay.self).contains { $0.pageNumber == 1 && $0.window != nil } }
        let pdf = try XCTUnwrap(descendants(host.view, matching: ZoomableScorePDFView.self).first)
        let coordinator = try XCTUnwrap(pdf.pageOverlayViewProvider as? PagedScoreView.Coordinator)
        for cycle in 0..<8 {
            let page = model.page
            let overlay = try XCTUnwrap(descendants(pdf, matching: ScorePageOverlay.self).first { $0.pageNumber == page })
            XCTAssertTrue(overlay.canvas.becomeFirstResponder(), "Exercise the exact focused-overlay condition from the physical crash")
            let points = [CGPoint(x: 80, y: CGFloat(100 + cycle * 10)), CGPoint(x: 180, y: CGFloat(105 + cycle * 10))].enumerated().map { step, point in
                PKStrokePoint(location: point, timeOffset: Double(step) / 10, size: CGSize(width: 1, height: 1),
                              opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
            }
            let stroke = PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: .now))
            coordinator.loading = true; overlay.canvas.drawing = PKDrawing(strokes: overlay.canvas.drawing.strokes + [stroke]); coordinator.loading = false
            coordinator.canvasViewDrawingDidChange(overlay.canvas)
            let before = overlay.canvas.drawing.dataRepresentation()
            let target = page == 1 ? 2 : 1
            model.page = target
            host.view.setNeedsLayout(); host.view.layoutIfNeeded()
            try await waitFor {
                pdf.layoutIfNeeded()
                return pdf.currentPage.map { pdf.document?.index(for: $0) == target - 1 } == true
                    && self.descendants(pdf, matching: ScorePageOverlay.self).contains { $0.pageNumber == target && $0.window != nil }
            }
            XCTAssertEqual(model.stored[page], before, "The focused page must checkpoint before PDFKit removes its canvas")
        }
        // PDFKit briefly selects its first page during mode/document replacement. Keep a
        // noninitial requested page so those notifications cannot silently reset the binding.
        model.page = 3
        try await waitFor {
            pdf.layoutIfNeeded()
            return pdf.currentPage === pdf.document?.page(at: 2)
                && self.descendants(pdf, matching: ScorePageOverlay.self).contains { $0.pageNumber == 3 && $0.window != nil }
        }
        let current = try XCTUnwrap(descendants(pdf, matching: ScorePageOverlay.self).first { $0.pageNumber == model.page })
        XCTAssertTrue(current.canvas.becomeFirstResponder())
        model.twoPages = true
        try await waitFor { pdf.displayMode == .twoUp && pdf.currentPage === pdf.document?.page(at: 2) }
        XCTAssertEqual(model.page, 3, "Transient PDFKit layout pages must not overwrite the requested page")
        model.twoPages = false
        try await waitFor {
            pdf.layoutIfNeeded()
            return pdf.displayMode == .singlePage
                && pdf.currentPage === pdf.document?.page(at: 2)
                && self.descendants(pdf, matching: ScorePageOverlay.self).contains { $0.window != nil }
        }
        XCTAssertEqual(model.page, 3)
        let focused = try XCTUnwrap(descendants(pdf, matching: ScorePageOverlay.self).first)
        XCTAssertTrue(focused.canvas.becomeFirstResponder())
        let oldDocument = pdf.document
        model.url = replacement
        try await waitFor {
            pdf.layoutIfNeeded()
            return pdf.document !== oldDocument && pdf.document != nil
                && pdf.currentPage === pdf.document?.page(at: 2)
                && self.descendants(pdf, matching: ScorePageOverlay.self).contains { $0.pageNumber == 3 && $0.window != nil }
        }
        XCTAssertEqual(model.page, 3, "Replacing the document must retain the explicit target page")
        let final = try XCTUnwrap(descendants(pdf, matching: ScorePageOverlay.self).first)
        // The host never reads these values in its body. Deferred coordinator observation must
        // propagate live tool changes and externally saved ink without a coincidental re-render.
        markup.fingerDrawing = false
        markup.tool.width = .bold
        markup.tool.color = .red
        try await waitFor {
            final.canvas.drawingPolicy == .pencilOnly
                && (final.canvas.tool as? PKInkingTool)?.width == AnnotationWidth.bold.penPoints
                && (final.canvas.tool as? PKInkingTool)?.color == AnnotationColor.red.uiColor
        }
        let importedPoints = [CGPoint(x: 40, y: 60), CGPoint(x: 100, y: 160)].enumerated().map { step, point in
            PKStrokePoint(location: point, timeOffset: Double(step) / 10, size: CGSize(width: 2, height: 2),
                          opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let imported = PKStroke(ink: PKInk(.pen, color: .blue), path: PKStrokePath(controlPoints: importedPoints, creationDate: .now))
        model.stored[3] = PKDrawing(strokes: [imported]).dataRepresentation()
        try await waitFor { final.canvas.drawing.strokes.map(InkPerStroke.fingerprint) == [InkPerStroke.fingerprint(imported)] }
        XCTAssertTrue(final.canvas.becomeFirstResponder())
        model.shown = false
        try await waitFor { self.descendants(host.view, matching: ZoomableScorePDFView.self).isEmpty }
        try await waitFor { pdf.pageOverlayViewProvider == nil }
    }

    @MainActor func testQueuedPageChangesCoalesceAndCannotApplyAfterDismantling() async throws {
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in
            for _ in 0..<3 { context.beginPage() }
        }
        let markup = ScoreMarkupState(); let url = URL(fileURLWithPath: "/queued-page-fixture.pdf")
        func parent(_ page: Int) -> PagedScoreView {
            PagedScoreView(url: url, page: .constant(page), twoPages: false, markup: markup, onPageChanged: { _ in })
        }
        let coordinator = parent(1).makeCoordinator(); coordinator.loadedURL = url
        let view = ZoomableScorePDFView(); view.document = try XCTUnwrap(PDFDocument(data: data))
        coordinator.pdfView = view
        let first = try XCTUnwrap(view.document?.page(at: 0)); view.go(to: first)
        coordinator.enqueueViewUpdate(parent(2), view: view)
        coordinator.enqueueViewUpdate(parent(3), view: view)
        XCTAssertTrue(view.currentPage === first, "Enqueue must not remove a focused page within updateUIView")
        try await waitFor { view.currentPage === view.document?.page(at: 2) }
        coordinator.enqueueViewUpdate(parent(1), view: view)
        coordinator.cancelPendingViewUpdate()
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertTrue(view.currentPage === view.document?.page(at: 2), "A removed score must not receive a previously queued page turn")
    }

    @MainActor func testFailedCheckpointBlocksPageLayoutAndDocumentChangesBeforePDFMutation() async throws {
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in
            for _ in 0..<3 { context.beginPage() }
        }
        let markup = ScoreMarkupState(); markup.mode = .writing
        let url = URL(fileURLWithPath: "/failed-navigation-fixture.pdf")
        var attempts = 0
        func parent(_ page: Int, twoPages: Bool = false, source: URL? = nil) -> PagedScoreView {
            PagedScoreView(url: source ?? url, page: .constant(page), twoPages: twoPages, markup: markup,
                           saveDrawing: { _, _, _ in attempts += 1; return false }, onPageChanged: { _ in })
        }
        let coordinator = parent(1).makeCoordinator(); coordinator.loadedURL = url
        defer { coordinator.autosave?.cancel() }
        let view = ZoomableScorePDFView(); view.document = try XCTUnwrap(PDFDocument(data: data))
        view.displayMode = .singlePage
        view.displaysAsBook = scoreDisplaysAsBook(twoPages: false, page: 1)
        coordinator.pdfView = view
        let document = try XCTUnwrap(view.document)
        let first = try XCTUnwrap(document.page(at: 0)); view.go(to: first)
        let overlay = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: first) as? ScorePageOverlay)
        let points = [CGPoint(x: 20, y: 40), CGPoint(x: 100, y: 80)].enumerated().map { step, point in
            PKStrokePoint(location: point, timeOffset: Double(step) / 10, size: CGSize(width: 2, height: 2),
                          opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let stroke = PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: .now))
        coordinator.loading = true; overlay.canvas.drawing = PKDrawing(strokes: [stroke]); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        let expected = overlay.canvas.drawing.dataRepresentation()
        let requests = [parent(1, twoPages: true), parent(2), parent(1, source: URL(fileURLWithPath: "/replacement.pdf"))]
        for request in requests {
            let previousAttempts = attempts
            coordinator.enqueueViewUpdate(request, view: view)
            try await waitFor { attempts > previousAttempts }
            XCTAssertTrue(view.document === document)
            XCTAssertTrue(view.currentPage === first)
            XCTAssertEqual(view.displayMode, .singlePage)
            XCTAssertFalse(coordinator.parent.twoPages)
            XCTAssertEqual(coordinator.parent.url, url)
            XCTAssertEqual(markup.pendingInk[1]?.data, expected)
            XCTAssertTrue(coordinator.dirtyPages.contains(1))
        }
    }
}
