import PDFKit
import PencilKit
import SwiftUI
import XCTest
@testable import Praelude

final class ScoreMarkupTests: XCTestCase {
    @MainActor func testSelectionDraftUndoRedoAndFailedInkFlushPreserveWork() async throws {
        let state = ScoreMarkupState()
        let passage = Passage(pieceID: UUID(), title: "Draft")
        state.begin(passage, baseline: passage)
        let first = PassageRegion(page: 1, x: 0.1, y: 0.2, width: 0.5, height: 0.1)
        let second = PassageRegion(page: 2, x: 0.1, y: 0.4, width: 0.5, height: 0.1)
        state.rememberSelection(); state.update(first)
        state.rememberSelection(); state.update(second)
        XCTAssertEqual(state.regions, [first, second])
        state.undoSelection(); XCTAssertEqual(state.regions, [first])
        state.redoSelection(); XCTAssertEqual(state.regions, [first, second])
        state.selectedRegionID = first.id; state.removeSelected()
        XCTAssertEqual(state.regions, [second])
        state.undoSelection(); XCTAssertEqual(state.regions, [first, second])
        let before = state.draft
        state.flushInk = { false }
        state.begin(Passage(pieceID: UUID(), title: "Must not replace work"))
        XCTAssertEqual(state.draft, before)
        XCTAssertEqual(state.baseline, passage, "A failed transition must retain the original conflict-check baseline")
        XCTAssertEqual(state.mode, .selecting)
    }

    /// Blocker regression (design): the score's passage boxes must never carry a second accent hue
    /// (previously `.systemIndigo`/`.systemTeal`) — practiced/emphasized/selected states read by
    /// alpha weight only, matching the one-accent monochrome palette (§3a).
    @MainActor func testPassageBoxColorsStayMonochromeAcrossEveryState() throws {
        let ink = UIColor(PraeludeColor.scoreInk)
        var inkHue: CGFloat = 0, inkSaturation: CGFloat = 0, inkBrightness: CGFloat = 0, inkAlpha: CGFloat = 0
        XCTAssertTrue(ink.getHue(&inkHue, saturation: &inkSaturation, brightness: &inkBrightness, alpha: &inkAlpha))
        func assertSameHue(_ color: UIColor, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
            var hue: CGFloat = 0, saturation: CGFloat = 0, brightness: CGFloat = 0, alpha: CGFloat = 0
            XCTAssertTrue(color.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha), file: file, line: line)
            XCTAssertEqual(hue, inkHue, accuracy: 0.0001, message, file: file, line: line)
            XCTAssertEqual(saturation, inkSaturation, accuracy: 0.0001, message, file: file, line: line)
            XCTAssertEqual(brightness, inkBrightness, accuracy: 0.0001, message, file: file, line: line)
            // The score page is pinned paper-white in both appearances, so marks drawn on it must
            // stay dark ink in dark mode too (a dynamic ink would resolve to parchment and vanish).
            let dark = color.resolvedColor(with: UITraitCollection(userInterfaceStyle: .dark))
            var darkBrightness: CGFloat = 0
            XCTAssertTrue(dark.getHue(nil, saturation: nil, brightness: &darkBrightness, alpha: nil), file: file, line: line)
            XCTAssertLessThan(darkBrightness, 0.2, "\(message) (dark appearance)", file: file, line: line)
        }
        for practiced in [false, true] {
            for emphasized in [false, true] {
                assertSameHue(ScorePassageBoxStyle.fillColor(practiced: practiced, emphasized: emphasized),
                              "fill practiced=\(practiced) emphasized=\(emphasized) must stay ink-colored")
                for selected in [false, true] {
                    assertSameHue(ScorePassageBoxStyle.strokeColor(practiced: practiced, selected: selected),
                                  "stroke practiced=\(practiced) selected=\(selected) must stay ink-colored")
                }
            }
        }
        assertSameHue(ScorePassageBoxStyle.handleRingColor(), "corner handle ring must stay ink-colored")
    }

    @MainActor func testNormalizedBoxesClampToPageAndRemainStableAtNewSize() async throws {
        let size = CGSize(width: 1000, height: 1400)
        let box = try XCTUnwrap(PassageRegion.clamped(page: 3, rect: CGRect(x: -100, y: 140, width: 300, height: 280), size: size))
        XCTAssertEqual(box.page, 3)
        XCTAssertEqual(box.x, 0, accuracy: 0.000001)
        XCTAssertEqual(box.y, 0.1, accuracy: 0.000001)
        XCTAssertEqual(box.width, 0.2, accuracy: 0.000001)
        XCTAssertEqual(box.height, 0.2, accuracy: 0.000001)
        XCTAssertEqual(box.rect(in: CGSize(width: 500, height: 700)), CGRect(x: 0, y: 70, width: 100, height: 140))
        XCTAssertNil(PassageRegion.clamped(page: 1, rect: CGRect(x: 0, y: 0, width: 1, height: 1), size: size))
        XCTAssertNil(PassageRegion.clamped(page: 1, rect: CGRect(x: 2000, y: 2000, width: 100, height: 100), size: size))
        XCTAssertNil(PassageRegion.clamped(page: 1, rect: CGRect(x: 0, y: 0, width: 100, height: 100), size: .zero))
        let fractionalWidth = 772.269087267476
        let fractionalX = 150.0981827633861
        let edge = try XCTUnwrap(PassageRegion.clamped(page: 1, rect: CGRect(x: fractionalX, y: 0, width: fractionalWidth - fractionalX, height: 200), size: CGSize(width: fractionalWidth, height: 400)))
        XCTAssertLessThanOrEqual(edge.x + edge.width, 1, "A box touching the edge must remain valid after normalization")
    }

    @MainActor func testFingerHitRoutingSeparatesPageNavigationSelectionAndInk() async throws {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(x: 0, y: 0, width: 612, height: 792)
        overlay.layoutIfNeeded(); overlay.refresh()
        let point = CGPoint(x: 100, y: 100)
        XCTAssertNil(overlay.hitTest(point, with: nil), "Reading fingers must reach PDFKit")
        state.begin(Passage(pieceID: UUID(), title: "Select")); overlay.refresh()
        XCTAssertTrue(overlay.hitTest(point, with: nil) === overlay)
        state.finish(); state.mode = .writing; state.fingerDrawing = true; overlay.refresh()
        XCTAssertNotNil(overlay.hitTest(point, with: nil), "Finger writing explicitly enables the native canvas")
        overlay.inkReadOnly = true; overlay.refresh()
        XCTAssertNil(overlay.hitTest(point, with: nil), "Damaged saved ink must never accept replacement strokes")
    }

    @MainActor private func makePage() throws -> PDFPage {
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792)).pdfData { renderer in
            renderer.beginPage()
            "Synthetic score geometry".draw(at: CGPoint(x: 80, y: 100), withAttributes: [.font: UIFont.systemFont(ofSize: 20)])
        }
        return try XCTUnwrap(PDFDocument(data: data)?.page(at: 0))
    }

    @MainActor private func ink(at y: CGFloat) -> PKDrawing {
        let points = [CGPoint(x: 20, y: y), CGPoint(x: 200, y: y + 20)].enumerated().map { index, location in
            PKStrokePoint(location: location, timeOffset: Double(index) / 10, size: CGSize(width: 3, height: 3),
                          opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black),
                                           path: PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: 1_700_000_000)))])
    }

    @MainActor private func assertSameInk(_ actual: PKDrawing, _ expected: PKDrawing, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(actual.strokes.count, expected.strokes.count, file: file, line: line)
        for (left, right) in zip(actual.strokes, expected.strokes) {
            XCTAssertEqual(left.ink.inkType, right.ink.inkType, file: file, line: line)
            XCTAssertEqual(left.ink.color, right.ink.color, file: file, line: line)
            XCTAssertEqual(left.transform, right.transform, file: file, line: line)
            XCTAssertEqual(left.path.count, right.path.count, file: file, line: line)
            for index in 0..<min(left.path.count, right.path.count) {
                XCTAssertEqual(left.path[index].location, right.path[index].location, file: file, line: line)
                XCTAssertEqual(left.path[index].size, right.path[index].size, file: file, line: line)
                XCTAssertEqual(left.path[index].opacity, right.path[index].opacity, file: file, line: line)
                XCTAssertEqual(left.path[index].force, right.path[index].force, file: file, line: line)
            }
        }
    }

    @MainActor func testFailedWriteRetainsPageCanvasAndSuccessfulEvictionKeepsOtherPageInk() async throws {
        let state = ScoreMarkupState()
        var writesAllowed = false
        let secondPageInk = ink(at: 100).dataRepresentation()
        var saved: [Int: Data] = [2: secondPageInk]
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/unused-fixture.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { saved[$0] }, saveDrawing: { page, data, expected in
            guard writesAllowed, saved[page] == expected else { return false }
            saved[page] = data.isEmpty ? nil : data
            return true
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let document = PDFDocument(); document.insert(try makePage(), at: 0); document.insert(try makePage(), at: 1)
        let view = PDFView(); view.document = document
        let firstPage = try XCTUnwrap(document.page(at: 0)); let secondPage = try XCTUnwrap(document.page(at: 1))
        let first = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: firstPage) as? ScorePageOverlay)
        let second = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: secondPage) as? ScorePageOverlay)
        coordinator.loading = true; first.canvas.drawing = ink(at: 40); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(first.canvas)
        XCTAssertFalse(coordinator.flush())
        coordinator.pdfView(view, willEndDisplayingOverlayView: first, for: firstPage)
        XCTAssertTrue(coordinator.overlays[1] === first, "Never evict an unsaved page after a failed disk write")
        XCTAssertNil(saved[1]); XCTAssertEqual(saved[2], secondPageInk)
        writesAllowed = true
        coordinator.pdfView(view, willEndDisplayingOverlayView: first, for: firstPage)
        XCTAssertNil(coordinator.overlays[1])
        XCTAssertTrue(coordinator.overlays[2] === second)
        XCTAssertEqual(saved[1], first.canvas.drawing.dataRepresentation())
        XCTAssertEqual(saved[2], secondPageInk)
        let reopened = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: firstPage) as? ScorePageOverlay)
        assertSameInk(reopened.canvas.drawing, try PKDrawing(data: XCTUnwrap(saved[1])))
        coordinator.pdfView(view, willEndDisplayingOverlayView: first, for: firstPage)
        XCTAssertTrue(coordinator.overlays[1] === reopened, "An old overlay callback must not evict its replacement")
    }

    @MainActor func testExplicitInkConflictChoicesKeepTheChosenDrawing() async throws {
        let state = ScoreMarkupState()
        var saved: [Int: Data] = [1: ink(at: 20).dataRepresentation()]
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/unused-fixture.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { saved[$0] }, saveDrawing: { page, data, expected in
            guard saved[page] == expected else { state.conflictPage = page; return false }
            saved[page] = data.isEmpty ? nil : data
            return true
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let document = PDFDocument(); document.insert(try makePage(), at: 0)
        let view = PDFView(); view.document = document
        let overlay = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: XCTUnwrap(document.page(at: 0))) as? ScorePageOverlay)
        let local = ink(at: 50).dataRepresentation()
        coordinator.loading = true; overlay.canvas.drawing = try PKDrawing(data: local); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        saved[1] = ink(at: 80).dataRepresentation()
        XCTAssertFalse(coordinator.flush()); XCTAssertEqual(state.conflictPage, 1)
        state.resolveInkConflict(1, true)
        assertSameInk(try PKDrawing(data: XCTUnwrap(saved[1])), try PKDrawing(data: local))
        XCTAssertNil(state.conflictPage); XCTAssertFalse(coordinator.dirtyPages.contains(1))
        coordinator.loading = true; overlay.canvas.drawing = ink(at: 120); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        let remote = ink(at: 160).dataRepresentation(); saved[1] = remote
        XCTAssertFalse(coordinator.flush())
        state.resolveInkConflict(1, false)
        XCTAssertEqual(saved[1], remote)
        assertSameInk(overlay.canvas.drawing, try PKDrawing(data: remote))
        XCTAssertNil(state.conflictPage); XCTAssertFalse(coordinator.dirtyPages.contains(1))
    }

    @MainActor func testNativePDFOverlayCoordinatesMatchCroppedPageAtEveryRotation() async throws {
        let state = ScoreMarkupState()
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/unused-fixture.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator()
        let view = PDFView(frame: CGRect(x: 0, y: 0, width: 800, height: 1000))
        view.displayBox = .cropBox; view.displayMode = .singlePage; view.autoScales = true
        view.isInMarkupMode = true; view.pageOverlayViewProvider = coordinator
        coordinator.pdfView = view
        let window = UIWindow(frame: view.bounds)
        let controller = UIViewController(); controller.view.addSubview(view)
        window.rootViewController = controller; window.isHidden = false
        defer { window.isHidden = true; view.pageOverlayViewProvider = nil }
        for rotation in [0, 90, 180, 270] {
            coordinator.overlays.removeAll()
            let page = try makePage()
            let crop = CGRect(x: 40, y: 70, width: 500, height: 650)
            page.setBounds(crop, for: .cropBox); page.rotation = rotation
            let document = PDFDocument(); document.insert(page, at: 0)
            view.document = document; view.go(to: page)
            view.layoutDocumentView(); view.setNeedsLayout(); view.layoutIfNeeded()
            for _ in 0..<100 {
                if let overlay = coordinator.overlays[1], overlay.window != nil, overlay.bounds.width > 0 { break }
                try await Task.sleep(for: .milliseconds(20))
                view.layoutIfNeeded()
            }
            let overlay = try XCTUnwrap(coordinator.overlays[1], "PDFKit should request the visible page overlay")
            XCTAssertGreaterThan(overlay.bounds.width, 0)
            for normalized in [CGPoint(x: 0.2, y: 0.3), CGPoint(x: 0.7, y: 0.8)] {
                let overlayPoint = CGPoint(x: normalized.x * overlay.bounds.width, y: normalized.y * overlay.bounds.height)
                let pdfPoint = CGPoint(x: crop.minX + normalized.x * crop.width, y: crop.maxY - normalized.y * crop.height)
                let shown = overlay.convert(overlayPoint, to: view)
                let expected = view.convert(pdfPoint, from: page)
                XCTAssertEqual(shown.x, expected.x, accuracy: 1, "rotation \(rotation), x alignment")
                XCTAssertEqual(shown.y, expected.y, accuracy: 1, "rotation \(rotation), y alignment")
            }
        }
    }
}
