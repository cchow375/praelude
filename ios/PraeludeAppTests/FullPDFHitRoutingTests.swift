import PDFKit
import PencilKit
import SwiftUI
import XCTest
@testable import Praelude

private struct PDFHitRoutingHost: View {
    let url: URL
    let markup: ScoreMarkupState
    var body: some View {
        // Match ScoreWorkspace's observation of edit mode so the real representable refreshes.
        let _ = markup.mode
        let _ = markup.fingerDrawing
        let _ = markup.tool
        return PagedScoreView(url: url, page: .constant(1), twoPages: false, markup: markup, onPageChanged: { _ in })
    }
}

final class FullPDFHitRoutingTests: XCTestCase {
    @MainActor private func descendants<T: UIView>(_ root: UIView, matching type: T.Type) -> [T] {
        (root as? T).map { [$0] } ?? root.subviews.flatMap { descendants($0, matching: type) }
    }

    @MainActor private func diagnostic(_ overlay: UIView, through pdf: PDFView) -> String {
        var chain: [String] = []
        var current: UIView? = overlay
        while let view = current {
            chain.append("\(type(of: view)): interactive=\(view.isUserInteractionEnabled), hidden=\(view.isHidden), alpha=\(view.alpha), frame=\(view.frame)")
            if view === pdf { break }
            current = view.superview
        }
        return "PDF markup mode: \(pdf.isInMarkupMode)\n" + chain.joined(separator: "\n")
    }

    @MainActor
    func testActualHostedPDFRoutesSelectionAndFingerInkThroughTheLoadedPageHierarchy() async throws {
        try await verifyLoadedPageRouting(viewport: CGSize(width: 820, height: 1100))
    }

    @MainActor
    func testPhoneSizedHostedPDFKeepsReadingNavigationAndPinchAvailableAcrossInkModes() async throws {
        try await verifyLoadedPageRouting(viewport: CGSize(width: 402, height: 874))
    }

    @MainActor private func verifyLoadedPageRouting(viewport: CGSize) async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-HitRouting-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = directory.appendingPathComponent("synthetic-score.pdf")
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { context in
            context.beginPage()
            "Synthetic page for native touch routing".draw(at: CGPoint(x: 48, y: 100), withAttributes: [.font: UIFont.systemFont(ofSize: 18)])
        }
        try data.write(to: source)
        let markup = ScoreMarkupState()
        let host = UIHostingController(rootView: PDFHitRoutingHost(url: source, markup: markup))
        let window = UIWindow(frame: CGRect(origin: .zero, size: viewport))
        window.rootViewController = host
        window.isHidden = false
        defer { window.isHidden = true; window.rootViewController = nil }
        host.view.frame = window.bounds
        host.view.setNeedsLayout(); host.view.layoutIfNeeded()
        var pdf: ZoomableScorePDFView?
        var overlay: ScorePageOverlay?
        for _ in 0..<100 {
            pdf = descendants(host.view, matching: ZoomableScorePDFView.self).first
            if let pdf {
                pdf.layoutDocumentView(); pdf.layoutIfNeeded()
                overlay = descendants(pdf, matching: ScorePageOverlay.self).first { $0.pageNumber == 1 }
            }
            if let overlay, overlay.window != nil, overlay.bounds.width > 0, overlay.bounds.height > 0 { break }
            try await Task.sleep(for: .milliseconds(20))
            host.view.layoutIfNeeded()
        }
        let loadedPDF = try XCTUnwrap(pdf, "The actual UIViewRepresentable must create PDFKit")
        let pageOverlay = try XCTUnwrap(overlay, "PDFKit must attach its provided overlay to the loaded page")
        XCTAssertNotNil(pageOverlay.window)
        XCTAssertGreaterThan(pageOverlay.bounds.width, 0)
        var pdfScrollViews: [UIScrollView] = []
        var ancestor = pageOverlay.superview
        while let view = ancestor, view !== loadedPDF {
            if let scroll = view as? UIScrollView { pdfScrollViews.append(scroll) }
            ancestor = view.superview
        }
        XCTAssertFalse(pdfScrollViews.isEmpty, "Exercise the actual PDF scroll ancestors, not an isolated canvas")
        let pinch = try XCTUnwrap(pdfScrollViews.compactMap(\.pinchGestureRecognizer).first { $0.isEnabled },
                                 "The loaded score must retain native pinch zoom")
        for scroll in pdfScrollViews {
            XCTAssertTrue(scroll.panGestureRecognizer.isEnabled, "Reading page navigation must remain enabled")
            XCTAssertEqual(scroll.panGestureRecognizer.allowedTouchTypes, [NSNumber(value: UITouch.TouchType.direct.rawValue)],
                           "A PDF pan must not claim Apple Pencil input")
        }
        XCTAssertEqual(pageOverlay.canvas.drawingPolicy, .pencilOnly)
        let local = CGPoint(x: pageOverlay.bounds.width * 0.3, y: pageOverlay.bounds.height * 0.35)
        let point = pageOverlay.convert(local, to: loadedPDF)
        XCTAssertTrue(loadedPDF.bounds.contains(point), "Choose a point visibly inside the score")
        let readingHit = loadedPDF.hitTest(point, with: nil)
        XCTAssertNotNil(readingHit)
        XCTAssertTrue(readingHit === pageOverlay.canvas || readingHit?.isDescendant(of: pageOverlay.canvas) == true,
                      "An unresolved UIKit hit must reach PencilKit; its pencilOnly recognizer rejects finger ink while ancestor PDF navigation remains enabled")

        markup.begin(Passage(pieceID: UUID(), title: "Draw target"))
        try await Task.sleep(for: .milliseconds(100))
        host.view.layoutIfNeeded(); loadedPDF.layoutIfNeeded()
        let selectionHit = loadedPDF.hitTest(point, with: nil)
        let chain = diagnostic(pageOverlay, through: loadedPDF)
        let evidence = XCTAttachment(string: chain + "\nSelection hit: \(String(describing: selectionHit))")
        evidence.name = "Actual PDF overlay hit route"; evidence.lifetime = .keepAlways; add(evidence)
        XCTAssertTrue(loadedPDF.isInMarkupMode, "Document assignment must not reset markup routing")
        XCTAssertTrue(selectionHit === pageOverlay || selectionHit?.isDescendant(of: pageOverlay) == true,
                      "Selection must reach the page overlay through PDFKit, not just direct overlay.hitTest.\n\(chain)")
        let windowPoint = pageOverlay.convert(local, to: window)
        let windowHit = window.hitTest(windowPoint, with: nil)
        XCTAssertTrue(windowHit === pageOverlay || windowHit?.isDescendant(of: pageOverlay) == true,
                      "The full hosting-window route must reach the same selection overlay")

        markup.finish(); markup.mode = .writing; markup.fingerDrawing = true
        // updateUIView now queues PDF work outside SwiftUI's update transaction. Drive the
        // native layout and await that actual mode change before inspecting touch routing.
        for _ in 0..<100 {
            host.view.setNeedsLayout(); host.view.layoutIfNeeded(); loadedPDF.layoutIfNeeded()
            if pageOverlay.canvas.drawingPolicy == .anyInput { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(pageOverlay.canvas.drawingPolicy, .anyInput)
        XCTAssertTrue(pageOverlay.canvas.drawingGestureRecognizer.isEnabled)
        XCTAssertTrue(pinch.isEnabled, "Ink routing must not disable the PDF's two-finger zoom")
        let inkHit = loadedPDF.hitTest(point, with: nil)
        XCTAssertTrue(inkHit === pageOverlay.canvas || inkHit?.isDescendant(of: pageOverlay.canvas) == true,
                      "Explicit finger ink must reach the real canvas through all PDF ancestors.\n\(diagnostic(pageOverlay, through: loadedPDF))")
        // Native freeze regression: disabling this attached first-responder canvas to switch
        // tools enters an infinite UIKit resign/become responder loop. Exercise the real loaded
        // PDF hierarchy while preserving a stroke, not an unattached UIView with no responder.
        XCTAssertTrue(pageOverlay.canvas.becomeFirstResponder())
        XCTAssertTrue(pageOverlay.canvas.isFirstResponder)
        let points = [CGPoint(x: 120, y: 180), CGPoint(x: 200, y: 200)].enumerated().map { index, location in
            PKStrokePoint(location: location, timeOffset: Double(index) / 10, size: CGSize(width: 3, height: 3),
                          opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        pageOverlay.canvas.drawing = PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black),
            path: PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: 1_700_000_000)))])
        let inkBefore = pageOverlay.canvas.drawing.dataRepresentation()
        for kind in [AnnotationToolKind.stamp, .text] {
            markup.tool.kind = kind
            try await Task.sleep(for: .milliseconds(100))
            host.view.layoutIfNeeded(); loadedPDF.layoutIfNeeded()
            XCTAssertTrue(pageOverlay.canvas.isUserInteractionEnabled)
            XCTAssertTrue(pageOverlay.canvas.isFirstResponder, "Changing tools must not invoke an implicit PDFKit responder handoff")
            let placementHit = loadedPDF.hitTest(point, with: nil)
            XCTAssertTrue(placementHit === pageOverlay, "Placement belongs to the overlay instead of the retained PencilKit responder")
            XCTAssertEqual(pageOverlay.canvas.drawing.dataRepresentation(), inkBefore)
        }
        markup.tool.kind = .pen
        try await Task.sleep(for: .milliseconds(100))
        host.view.layoutIfNeeded(); loadedPDF.layoutIfNeeded()
        XCTAssertTrue(pageOverlay.canvas.isFirstResponder)
        let restoredHit = loadedPDF.hitTest(point, with: nil)
        XCTAssertTrue(restoredHit === pageOverlay.canvas || restoredHit?.isDescendant(of: pageOverlay.canvas) == true)
        XCTAssertEqual(pageOverlay.canvas.drawing.dataRepresentation(), inkBefore)
        markup.fingerDrawing = false
        try await Task.sleep(for: .milliseconds(100))
        host.view.layoutIfNeeded(); loadedPDF.layoutIfNeeded()
        XCTAssertEqual(pageOverlay.canvas.drawingPolicy, .pencilOnly)
        XCTAssertTrue(pinch.isEnabled)
        XCTAssertTrue(pdfScrollViews.allSatisfy { $0.panGestureRecognizer.isEnabled })
        let navigationHit = loadedPDF.hitTest(point, with: nil)
        XCTAssertTrue(navigationHit === pageOverlay.canvas || navigationHit?.isDescendant(of: pageOverlay.canvas) == true,
                      "A nil-event first hit must keep Apple Pencil eligible without enabling finger drawing")
    }
}
