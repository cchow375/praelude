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

    @MainActor func testDrawingSamplesDeferEncodingAndAutosaveUntilTheToolIsIdle() async throws {
        let state = ScoreMarkupState()
        state.mode = .writing
        var saved: Data?
        var writes = 0
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/sample-fixture.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in saved }, saveDrawing: { _, data, _ in
            writes += 1; saved = data.isEmpty ? nil : data; return true
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let page = try makePage(); let document = PDFDocument(); document.insert(page, at: 0)
        let view = PDFView(); view.document = document
        let overlay = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: page) as? ScorePageOverlay)
        coordinator.canvasViewDidBeginUsingTool(overlay.canvas)
        coordinator.loading = true; overlay.canvas.drawing = ink(at: 40); coordinator.loading = false
        for _ in 0..<120 { coordinator.canvasViewDrawingDidChange(overlay.canvas) }
        XCTAssertEqual(writes, 0, "Pencil sample callbacks must never perform durable ledger writes")
        XCTAssertTrue(state.pendingInk.isEmpty, "Movement callbacks must not repeatedly encode the whole drawing into observed state")
        XCTAssertNil(coordinator.autosave, "An active stroke must not create and cancel a save task at every sample")
        try await Task.sleep(for: .milliseconds(700))
        XCTAssertEqual(writes, 0, "Even a long stroke must not save or replace its active canvas")
        coordinator.canvasViewDidEndUsingTool(overlay.canvas)
        XCTAssertEqual(writes, 0, "Lifting the Pencil does not synchronously write the ledger")
        try await Task.sleep(for: .milliseconds(750))
        XCTAssertEqual(writes, 1)
        assertSameInk(try PKDrawing(data: XCTUnwrap(saved)), ink(at: 40))
        XCTAssertTrue(coordinator.dirtyPages.isEmpty)
        XCTAssertTrue(coordinator.flush()); XCTAssertEqual(writes, 1, "An unchanged lifecycle flush does not rewrite ink")
    }

    @MainActor func testPageEditSwitchMustSaveTheOriginalCanvasBeforeChangingItsGeometry() async throws {
        let state = ScoreMarkupState()
        var writesAllowed = false
        var saved: Data?
        let url = URL(fileURLWithPath: "/page-edit-fixture.pdf")
        func parent(edits: [PageEdit]) -> PagedScoreView {
            PagedScoreView(url: url, page: .constant(1), twoPages: false, markup: state, pageEdits: edits,
                           drawingData: { _ in saved }, saveDrawing: { _, data, _ in
                guard writesAllowed else { return false }; saved = data; return true
            }, onPageChanged: { _ in })
        }
        let coordinator = parent(edits: []).makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let page = try makePage(); let document = PDFDocument(); document.insert(page, at: 0)
        let view = PDFView(); view.document = document
        let overlay = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: page) as? ScorePageOverlay)
        coordinator.loading = true; overlay.canvas.drawing = ink(at: 80); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        var edit = PageEdit(pieceID: UUID(), sourcePage: 1, displayOrder: 1)
        edit.cropRect = NormalizedRect(x: 0.2, y: 0.2, width: 0.5, height: 0.5)
        XCTAssertFalse(coordinator.adoptParent(parent(edits: [edit])))
        XCTAssertTrue(coordinator.parent.pageEdits.isEmpty)
        XCTAssertTrue(coordinator.overlays[1] === overlay)
        XCTAssertNotNil(state.pendingInk[1], "Failed geometry changes keep the exact local drawing available")
        writesAllowed = true
        XCTAssertTrue(coordinator.adoptParent(parent(edits: [edit])))
        assertSameInk(try PKDrawing(data: XCTUnwrap(saved)), ink(at: 80))
        XCTAssertTrue(state.pendingInk.isEmpty)
    }

    @MainActor func testPendingInkFromAnotherLayerCannotBeFlushedIntoTheCurrentLayer() throws {
        let state = ScoreMarkupState()
        let url = URL(fileURLWithPath: "/layer-fixture.pdf")
        state.rememberInk(page: 1, data: ink(at: 20).dataRepresentation(), expected: nil, document: url, layer: .teacher)
        var writes = 0
        let parent = PagedScoreView(url: url, page: .constant(1), twoPages: false, markup: state,
                                   activeLayer: .mine, saveDrawing: { _, _, _ in writes += 1; return true }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator()
        XCTAssertFalse(coordinator.flush())
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(state.pendingInkLayer, .teacher)
        XCTAssertNotNil(state.pendingInk[1])
    }

    @MainActor func testKeepLocalConflictChoiceIncludesStrokesDrawnAfterTheFailedCheckpoint() async throws {
        let state = ScoreMarkupState()
        var saved = ink(at: 20).dataRepresentation()
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/updated-conflict-fixture.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: { _ in saved }, saveDrawing: { page, data, expected in
            guard expected == saved else { state.conflictPage = page; return false }
            saved = data; return true
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let page = try makePage(); let document = PDFDocument(); document.insert(page, at: 0)
        let view = PDFView(); view.document = document
        let overlay = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: page) as? ScorePageOverlay)
        coordinator.loading = true; overlay.canvas.drawing = ink(at: 50); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        saved = ink(at: 80).dataRepresentation()
        XCTAssertFalse(coordinator.flush())
        let checkpoint = try XCTUnwrap(state.pendingInk[1]?.data)
        let latest = PKDrawing(strokes: overlay.canvas.drawing.strokes + ink(at: 110).strokes)
        coordinator.loading = true; overlay.canvas.drawing = latest; coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        XCTAssertEqual(state.pendingInk[1]?.data, checkpoint, "The checkpoint deliberately precedes the newest stroke")
        state.resolveInkConflict(1, true)
        assertSameInk(try PKDrawing(data: saved), latest)
        XCTAssertNil(state.conflictPage)
        XCTAssertTrue(state.pendingInk.isEmpty)
    }

    @MainActor func testBackgroundPagePreviewMatchesCropRotationAndPreservesSourceBytes() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("score-preview-\(UUID()).pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        let source = PDFDocument(); source.insert(try makePage(), at: 0)
        XCTAssertTrue(source.write(to: url))
        let before = try Data(contentsOf: url)
        let effective = EffectivePage(id: UUID(), displayOrder: 1, sourcePage: 1, kind: .original,
                                      cropRect: NormalizedRect(x: 0.1, y: 0.2, width: 0.6, height: 0.5), rotationDegrees: 90)
        let size = CGSize(width: 360, height: 500)
        let rendered = await ScorePagePreviewRenderer.shared.render(url: url, page: effective, size: size)
        let preview = try XCTUnwrap(rendered)
        let expectedPage = try XCTUnwrap(ScorePageComposer.renderedPage(source: source, effective: effective,
                                                                       fallbackSize: CGSize(width: 612, height: 792)))
        let expected = expectedPage.thumbnail(of: size, for: .cropBox)
        XCTAssertEqual(preview.size.width, expected.size.width, accuracy: 0.01)
        XCTAssertEqual(preview.size.height, expected.size.height, accuracy: 0.01)
        XCTAssertEqual(preview.pngData(), expected.pngData(), "The worker preview must show the same rotated/cropped notation as the reader")
        let renderedLarge = await ScorePagePreviewRenderer.shared.render(url: url, page: effective, size: CGSize(width: 4000, height: 6000))
        let large = try XCTUnwrap(renderedLarge)
        let bitmap = try XCTUnwrap(large.cgImage)
        XCTAssertLessThanOrEqual(max(bitmap.width, bitmap.height), 1200)
        XCTAssertEqual(try Data(contentsOf: url), before)
        XCTAssertEqual(source.page(at: 0)?.rotation, 0)
    }

    @MainActor func testBackgroundPagePreviewHandlesGeneratedBlankAndStaffPages() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("generated-preview-\(UUID()).pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        let source = PDFDocument(); source.insert(try makePage(), at: 0)
        XCTAssertTrue(source.write(to: url))
        let before = try Data(contentsOf: url)
        let size = CGSize(width: 200, height: 300)
        let blankPage = EffectivePage(id: UUID(), displayOrder: 2, sourcePage: nil, kind: .blank, cropRect: nil, rotationDegrees: 0)
        let staffPage = EffectivePage(id: UUID(), displayOrder: 3, sourcePage: nil, kind: .staff, cropRect: nil, rotationDegrees: 0)
        let renderedBlank = await ScorePagePreviewRenderer.shared.render(url: url, page: blankPage, size: size)
        let renderedStaff = await ScorePagePreviewRenderer.shared.render(url: url, page: staffPage, size: size)
        let blank = try XCTUnwrap(renderedBlank)
        let staff = try XCTUnwrap(renderedStaff)
        XCTAssertEqual(blank.size, staff.size)
        XCTAssertNotEqual(blank.pngData(), staff.pngData(), "A manuscript preview must contain staff lines rather than showing another blank page")
        for (effective, preview) in [(blankPage, blank), (staffPage, staff)] {
            let expected = try XCTUnwrap(ScorePageComposer.renderedPage(source: source, effective: effective,
                                                                      fallbackSize: CGSize(width: 612, height: 792)))
            XCTAssertEqual(preview.pngData(), expected.thumbnail(of: size, for: .cropBox).pngData())
        }
        XCTAssertEqual(try Data(contentsOf: url), before)
    }

    @MainActor func testShortLandscapeAnnotationFitsLegibleWidthWithoutChangingInkCoordinates() async throws {
        let state = ScoreMarkupState(); state.mode = .writing
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/short-landscape-fixture.pdf"), page: .constant(1),
                                   twoPages: false, markup: state, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator()
        let view = ZoomableScorePDFView(frame: CGRect(x: 0, y: 0, width: 844, height: 120))
        view.displayMode = .singlePage; view.autoScales = true; view.isInMarkupMode = true
        view.pageOverlayViewProvider = coordinator; coordinator.pdfView = view
        let window = UIWindow(frame: view.bounds)
        let controller = UIViewController(); controller.view.addSubview(view)
        window.rootViewController = controller; window.isHidden = false
        defer { window.isHidden = true; view.pageOverlayViewProvider = nil; coordinator.autosave?.cancel() }
        let page = try makePage(); let document = PDFDocument(); document.insert(page, at: 0)
        view.document = document; view.go(to: page)
        view.layoutDocumentView(); view.layoutIfNeeded()
        var overlay: ScorePageOverlay?
        for _ in 0..<100 {
            if let found = coordinator.overlays[1], found.window != nil, found.bounds.width > 0 { overlay = found; break }
            try await Task.sleep(for: .milliseconds(20)); view.layoutIfNeeded()
        }
        let resolved = try XCTUnwrap(overlay)
        let canvasSize = resolved.canvas.bounds.size
        coordinator.loading = true; resolved.canvas.drawing = ink(at: 80); coordinator.loading = false
        let drawingBefore = resolved.canvas.drawing.dataRepresentation()
        let pageBoundsBefore = page.bounds(for: .cropBox)
        view.prefersShortLandscapeWidthFit = true
        view.layoutIfNeeded(); view.layoutDocumentView(); view.layoutIfNeeded()
        let rendered = view.convert(page.bounds(for: .cropBox), from: page)
        XCTAssertGreaterThan(rendered.width, view.bounds.width * 0.85, "A portrait score must not shrink to a tiny thumbnail in annotation landscape")
        XCTAssertGreaterThanOrEqual(view.maxScaleFactor, view.scaleFactor)
        // Leaving the automatic landscape zoom must restore fit-page rather than inheriting
        // a ten-times-fit ratio and unexpectedly clamping portrait to its maximum zoom.
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 640)
        view.frame = window.bounds
        view.layoutIfNeeded(); view.layoutDocumentView(); view.layoutIfNeeded()
        XCTAssertEqual(view.scaleFactor, view.minScaleFactor, accuracy: 0.001)
        window.frame = CGRect(x: 0, y: 0, width: 844, height: 120)
        view.frame = window.bounds
        view.layoutIfNeeded(); view.layoutDocumentView(); view.layoutIfNeeded()
        XCTAssertGreaterThan(view.convert(page.bounds(for: .cropBox), from: page).width, view.bounds.width * 0.85)
        let widthFitScale = view.scaleFactor
        view.scaleFactor = max(view.minScaleFactor, widthFitScale * 0.75)
        let manualScale = view.scaleFactor
        view.refreshScaleRange(); view.layoutIfNeeded()
        XCTAssertEqual(view.scaleFactor, manualScale, accuracy: 0.001, "A later refresh must preserve manual zoom instead of repeatedly imposing width fit")
        resolved.layoutIfNeeded()
        XCTAssertEqual(resolved.canvas.bounds.size.width, canvasSize.width, accuracy: 0.01)
        XCTAssertEqual(resolved.canvas.bounds.size.height, canvasSize.height, accuracy: 0.01)
        XCTAssertEqual(resolved.canvas.drawing.dataRepresentation(), drawingBefore)
        XCTAssertEqual(page.bounds(for: .cropBox), pageBoundsBefore)
    }

    @MainActor func testReadingHeightOnlyLayoutPreservesManualMagnificationAndFollowsFitWhenUnzoomed() async throws {
        let state = ScoreMarkupState()
        let savedInk = ink(at: 80).dataRepresentation()
        var writes = 0
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/reading-height-fixture.pdf"), page: .constant(1),
                                   twoPages: false, markup: state, drawingData: { _ in savedInk },
                                   saveDrawing: { _, _, _ in writes += 1; return true }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator()
        let view = ZoomableScorePDFView(frame: CGRect(x: 0, y: 0, width: 820, height: 927))
        view.displayBox = .cropBox; view.displayMode = .singlePage; view.autoScales = true
        view.isInMarkupMode = true; view.pageOverlayViewProvider = coordinator; coordinator.pdfView = view
        let window = UIWindow(frame: view.bounds)
        let controller = UIViewController(); controller.view.addSubview(view)
        window.rootViewController = controller; window.isHidden = false
        defer { window.isHidden = true; view.pageOverlayViewProvider = nil; coordinator.autosave?.cancel() }
        let page = try makePage(); let document = PDFDocument(); document.insert(page, at: 0)
        view.document = document; view.go(to: page)
        view.layoutDocumentView(); view.setNeedsLayout(); view.layoutIfNeeded()
        var mounted: ScorePageOverlay?
        for _ in 0..<100 {
            if let overlay = coordinator.overlays[1], overlay.window != nil, overlay.bounds.width > 0 {
                mounted = overlay; break
            }
            try await Task.sleep(for: .milliseconds(20)); view.layoutIfNeeded()
        }
        let overlay = try XCTUnwrap(mounted, "The native PDF must mount its real saved-ink overlay.")
        view.refreshScaleRange(); view.layoutIfNeeded(); overlay.layoutIfNeeded()
        XCTAssertGreaterThan(view.minScaleFactor, 0)
        XCTAssertEqual(view.scaleFactor, view.minScaleFactor, accuracy: 0.001)
        let initialFit = view.minScaleFactor
        let cropBounds = page.bounds(for: .cropBox)
        let mediaBounds = page.bounds(for: .mediaBox)
        let sourceFrame = overlay.sourceCanvasFrame
        let drawingBefore = overlay.canvas.sourceDrawing.dataRepresentation()
        XCTAssertFalse(overlay.canvas.sourceDrawing.strokes.isEmpty)
        assertSameInk(overlay.canvas.sourceDrawing, try PKDrawing(data: savedInk))
        func assertSourceUnchanged() {
            XCTAssertTrue(view.currentPage === page)
            XCTAssertEqual(page.bounds(for: .cropBox), cropBounds)
            XCTAssertEqual(page.bounds(for: .mediaBox), mediaBounds)
            XCTAssertEqual(overlay.sourceCanvasFrame, sourceFrame)
            XCTAssertEqual(overlay.canvas.sourceDrawing.dataRepresentation(), drawingBefore,
                           "Changing HUD height must preserve exact source ink values and stroke identities.")
            XCTAssertEqual(state.mode, .reading)
            XCTAssertTrue(state.pendingInk.isEmpty)
            XCTAssertEqual(writes, 0, "A viewport change must not write saved ink.")
        }
        func resize(height: CGFloat) {
            window.frame = CGRect(x: 0, y: 0, width: 820, height: height)
            view.frame = window.bounds
            view.setNeedsLayout(); view.layoutIfNeeded(); view.layoutDocumentView(); view.layoutIfNeeded()
            overlay.layoutIfNeeded()
            XCTAssertEqual(view.bounds.width, 820)
            XCTAssertEqual(view.bounds.height, height)
            assertSourceUnchanged()
        }
        view.scaleFactor = initialFit * 2.3
        view.layoutDocumentView(); view.layoutIfNeeded()
        let manualScale = view.scaleFactor
        XCTAssertEqual(manualScale / initialFit, 2.3, accuracy: 0.001)
        resize(height: 901)
        XCTAssertLessThan(view.minScaleFactor, initialFit, "The smaller height must actually change the page-fit scale.")
        XCTAssertEqual(view.scaleFactor, manualScale, accuracy: 0.001, "The cold-grade HUD height change must preserve absolute manual magnification.")
        resize(height: 1_000)
        XCTAssertGreaterThan(view.minScaleFactor, initialFit)
        XCTAssertEqual(view.scaleFactor, manualScale, accuracy: 0.001, "Growing the same-width viewport must preserve the chosen magnification too.")
        resize(height: 927)
        XCTAssertEqual(view.scaleFactor, manualScale, accuracy: 0.001)
        view.scaleFactor = view.minScaleFactor
        resize(height: 820)
        XCTAssertLessThan(view.minScaleFactor, initialFit)
        XCTAssertEqual(view.minScaleFactor, view.scaleFactorForSizeToFit, accuracy: 0.001)
        XCTAssertEqual(view.scaleFactor, view.minScaleFactor, accuracy: 0.001, "An unzoomed page must follow the new fit instead of keeping the old absolute scale.")
        resize(height: 927)
        XCTAssertEqual(view.scaleFactor, view.minScaleFactor, accuracy: 0.001)
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
        XCTAssertNotNil(overlay.hitTest(point, with: nil), "Unresolved initial UIKit hits must preserve the Pencil route")
        XCTAssertEqual(overlay.canvas.drawingPolicy, .pencilOnly, "Finger navigation is handled by ancestor PDF gestures; the canvas must reject finger ink")
        state.begin(Passage(pieceID: UUID(), title: "Select")); overlay.refresh()
        XCTAssertTrue(overlay.hitTest(point, with: nil) === overlay)
        state.finish(); state.mode = .writing; state.fingerDrawing = true; overlay.refresh()
        XCTAssertNotNil(overlay.hitTest(point, with: nil), "Finger writing explicitly enables the native canvas")
        overlay.inkReadOnly = true; overlay.refresh()
        XCTAssertNil(overlay.hitTest(point, with: nil), "Damaged saved ink must never accept replacement strokes")
    }

    /// §7 stamp/text placement and §8 quick-sub-passage must each claim taps the same way `.selecting`
    /// already does (reaching the overlay, not PDFKit navigation, and disabling the ink canvas), but
    /// a *drag* must never fall through into box-drawing while a placement tool is armed — that would
    /// silently create an unwanted passage box instead of doing nothing while the person taps to place
    /// a stamp.
    /// Major regression (verifier "reader lens", 2026-09-29): long-pressing a passage outline on the
    /// score did nothing — `PagedScoreView.Coordinator.longPressed` only ever called `onLongPress()`
    /// with no location, wired only to exit performance mode. `passageRegion(at:)` is the hit test
    /// that now backs the on-score quick-action menu (`PassageQuickActions.swift`); crop-aware like
    /// every other hit test in this file (`displayRect(for:)`).
    @MainActor func testPassageRegionAtPointFindsTheTopmostRegionAndRespectsActiveCrop() throws {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(x: 0, y: 0, width: 300, height: 400)
        overlay.layoutIfNeeded()
        let region = PassageRegion(page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.2)
        overlay.displayedRegions = [region]
        overlay.refresh()
        XCTAssertEqual(overlay.passageRegion(at: CGPoint(x: 90, y: 80)), region.id)
        XCTAssertNil(overlay.passageRegion(at: CGPoint(x: 280, y: 380)), "A point outside every region must find nothing")

        // Two overlapping regions: the topmost (last in the array, matching draw order) must win.
        let under = PassageRegion(page: 1, x: 0, y: 0, width: 1, height: 1)
        overlay.displayedRegions = [under, region]
        overlay.refresh()
        XCTAssertEqual(overlay.passageRegion(at: CGPoint(x: 90, y: 80)), region.id, "The topmost (last-drawn) overlapping region must win")

        // With an active crop that `region` falls entirely outside of, the hit test must use the
        // crop-remapped (empty) position, not the raw stored one.
        overlay.displayedRegions = [region]
        overlay.activeCrop = NormalizedRect(x: 0.5, y: 0.5, width: 0.5, height: 0.5)
        overlay.layoutIfNeeded()
        XCTAssertNil(overlay.passageRegion(at: CGPoint(x: 90, y: 80)), "A region entirely outside the active crop must no longer hit-test")
    }

    @MainActor func testSavedPassageFingerRouteHonorsInkNotesPermissionsAndCrops() {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(x: 0, y: 0, width: 600, height: 800); overlay.layoutIfNeeded()
        let selected = PassageRegion(page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.2)
        let other = PassageRegion(page: 1, x: 0.6, y: 0.2, width: 0.3, height: 0.2)
        overlay.displayedRegions = [selected, other]
        let point = CGPoint(x: 150, y: 240)
        XCTAssertTrue(overlay.emphasizedIDs.isEmpty)
        XCTAssertTrue(overlay.shouldClaimSavedPassage(at: point, touchType: .direct), "The first tap on an unselected saved passage must use the overlay route")
        overlay.emphasizedIDs = [selected.id]
        XCTAssertTrue(overlay.shouldClaimSavedPassage(at: point, touchType: .direct))
        XCTAssertTrue(overlay.shouldClaimSavedPassage(at: CGPoint(x: 450, y: 240), touchType: .direct), "Another saved passage must use the same route while one passage is selected")
        XCTAssertFalse(overlay.shouldClaimSavedPassage(at: CGPoint(x: 20, y: 600), touchType: .direct))
        XCTAssertFalse(overlay.shouldClaimSavedPassage(at: CGPoint(x: -1, y: 240), touchType: .direct))
        XCTAssertFalse(overlay.shouldClaimSavedPassage(at: point, touchType: .pencil))
        XCTAssertFalse(overlay.shouldClaimSavedPassage(at: point, touchType: nil))
        XCTAssertFalse(overlay.gestureRecognizerShouldBegin(overlay.selectionTap), "The installed overlay tap must reject ordinary reading without a note; the ancestor page tap selects the saved passage")
        XCTAssertFalse(overlay.gestureRecognizerShouldBegin(overlay.selectionDoubleTap))
        XCTAssertFalse(overlay.gestureRecognizerShouldBegin(overlay.selectionPan))
        XCTAssertNil(state.selectedRegionID, "Routing must not independently select a draft region")
        let unresolved = overlay.hitTest(point, with: nil)
        XCTAssertTrue(unresolved === overlay.canvas || unresolved?.isDescendant(of: overlay.canvas) == true,
                      "An unresolved first hit must preserve PencilKit input even over the selected passage")
        for mode: ScoreMarkupState.Mode in [.writing, .selecting] {
            state.mode = mode
            XCTAssertFalse(overlay.shouldClaimSavedPassage(at: point, touchType: .direct))
        }
        state.mode = .reading
        overlay.inkReadOnly = true
        XCTAssertFalse(overlay.shouldClaimSavedPassage(at: point, touchType: .direct))
        overlay.inkReadOnly = false; overlay.contentReadOnly = true
        XCTAssertFalse(overlay.shouldClaimSavedPassage(at: point, touchType: .direct))
        overlay.contentReadOnly = false; state.quickBoxArmed = true
        XCTAssertFalse(overlay.shouldClaimSavedPassage(at: point, touchType: .direct))
        state.quickBoxArmed = false; state.breakPointArmed = true
        XCTAssertFalse(overlay.shouldClaimSavedPassage(at: point, touchType: .direct))
        state.breakPointArmed = false
        let note = TextBoxAnnotation(pieceID: UUID(), page: 1,
            region: NormalizedRect(x: 0.15, y: 0.25, width: 0.2, height: 0.1), text: "The note owns its tap sequence")
        overlay.displayedTextBoxes = [note]
        XCTAssertFalse(overlay.shouldClaimSavedPassage(at: point, touchType: .direct))
        overlay.displayedTextBoxes = []; state.showPassageBoxes = false
        XCTAssertFalse(overlay.shouldClaimSavedPassage(at: point, touchType: .direct))
        state.showPassageBoxes = true
        overlay.activeCrop = NormalizedRect(x: 0.1, y: 0.2, width: 0.5, height: 0.5)
        XCTAssertTrue(overlay.shouldClaimSavedPassage(at: CGPoint(x: 100, y: 100), touchType: .direct))
        overlay.activeCrop = NormalizedRect(x: 0.5, y: 0.5, width: 0.5, height: 0.5)
        XCTAssertFalse(overlay.shouldClaimSavedPassage(at: point, touchType: .direct))
    }

    @MainActor func testStampAndTextPlacementAndQuickBoxClaimTapsButPlacementNeverClaimsDrags() async throws {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(x: 0, y: 0, width: 612, height: 792)
        overlay.layoutIfNeeded(); overlay.refresh()
        let point = CGPoint(x: 100, y: 100)

        state.mode = .writing; state.tool.kind = .stamp; overlay.refresh()
        XCTAssertTrue(overlay.hitTest(point, with: nil) === overlay, "An armed stamp tool must claim taps for placement, not PDFKit")
        XCTAssertTrue(overlay.canvas.isUserInteractionEnabled, "Stamp routing must not implicitly resign the PencilKit responder")
        XCTAssertTrue(overlay.gestureRecognizerShouldBegin(overlay.selectionTap), "Tap must be live for stamp placement/selection")
        XCTAssertFalse(overlay.gestureRecognizerShouldBegin(overlay.selectionPan), "A drag while placing a stamp must not fall through to box-drawing")

        state.tool.kind = .text; overlay.refresh()
        XCTAssertTrue(overlay.hitTest(point, with: nil) === overlay, "An armed text tool must claim taps for placement, not PDFKit")
        XCTAssertTrue(overlay.gestureRecognizerShouldBegin(overlay.selectionTap))
        XCTAssertFalse(overlay.gestureRecognizerShouldBegin(overlay.selectionPan))

        state.mode = .reading; state.tool.kind = .pen; state.quickBoxArmed = true; overlay.refresh()
        XCTAssertTrue(overlay.hitTest(point, with: nil) === overlay, "An armed quick box must claim the drag that draws it")
        XCTAssertTrue(overlay.canvas.isUserInteractionEnabled, "Box routing must retain the canvas responder eligibility")
        XCTAssertTrue(overlay.gestureRecognizerShouldBegin(overlay.selectionPan), "Quick box is drawn by dragging, unlike stamp/text placement")

        state.quickBoxArmed = false; overlay.refresh()
        XCTAssertNotNil(overlay.hitTest(point, with: nil), "Disarming restores the unresolved Pencil hit route")
        XCTAssertEqual(overlay.canvas.drawingPolicy, .pencilOnly)
    }

    /// Drives the same point-based logic `tap(_:)` calls (see `ScorePageOverlay.handleTap(at:)`) —
    /// placing a stamp, then tapping it again to select rather than place a second one, then
    /// confirming a tap outside the active layer cannot select at all.
    @MainActor func testStampTapPlacesThenSelectsOnSecondTapButOnlyOnTheActiveLayer() throws {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(x: 0, y: 0, width: 600, height: 800)
        overlay.layoutIfNeeded()
        state.mode = .writing; state.tool.kind = .stamp; state.armedStamp = (.circle, nil); state.activeLayer = .mine
        overlay.refresh()
        var placed: (Int, NormalizedRect)?
        overlay.onPlaceStamp = { placed = ($0, $1); return true }
        let point = CGPoint(x: 100, y: 120)
        overlay.handleTap(at: point)
        XCTAssertNil(placed, "Tapping previews a stamp, without writing it before confirmation")
        XCTAssertNotNil(state.stampDraft)
        state.stampSize = 0.09; state.resizeStampPreview(); overlay.refresh()
        overlay.commitStampDraft()
        let placedResult = try XCTUnwrap(placed)
        XCTAssertEqual(placedResult.1.width, 0.09, accuracy: 0.000001)
        XCTAssertNil(state.stampDraft)
        XCTAssertEqual(placedResult.0, 1)
        // The real placement (ScoreWorkspace.placeStamp) would now call store.saveStampAnnotation;
        // simulate that here so the *second* tap has something to hit.
        let stamp = StampAnnotation(pieceID: UUID(), page: 1, position: placedResult.1, kind: .circle, layer: .mine)
        overlay.displayedStamps = [stamp]
        state.armedStamp = nil
        overlay.refresh()
        placed = nil
        overlay.handleTap(at: point)
        XCTAssertNil(placed, "A second tap on the same spot must select the existing stamp, not place another")
        XCTAssertEqual(state.selectedStampID, stamp.id)

        state.selectedStampID = nil; state.activeLayer = .teacher; overlay.refresh()
        overlay.handleTap(at: point)
        XCTAssertNil(state.selectedStampID, "A stamp outside the active layer must never become selected")
    }
    /// The same point-based logic `tap(_:)` calls for text: an armed text tool places a new box on
    /// empty space and opens the editor immediately (`onPlaceTextBox`); tapping an *existing* box
    /// re-opens it for editing (`onEditTextBox`) instead of placing another.
    @MainActor func testTextTapPlacesThenReopensAnExistingBoxForEditing() throws {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(x: 0, y: 0, width: 600, height: 800)
        overlay.layoutIfNeeded()
        state.mode = .writing; state.tool.kind = .text
        overlay.refresh()
        var placed: (Int, NormalizedRect)?
        overlay.onPlaceTextBox = { placed = ($0, $1) }
        let point = CGPoint(x: 200, y: 300)
        overlay.handleTap(at: point)
        let region = try XCTUnwrap(placed?.1)
        let box = TextBoxAnnotation(pieceID: UUID(), page: 1, region: region, text: "Breathe here")
        overlay.displayedTextBoxes = [box]
        overlay.refresh()
        var edited: TextBoxAnnotation?
        overlay.onEditTextBox = { edited = $0 }
        placed = nil
        overlay.handleTap(at: point)
        XCTAssertNil(placed, "A tap on an existing text box must reopen it, not place another")
        XCTAssertEqual(edited?.id, box.id)
    }

    @MainActor func testFailedStampPlacementRetainsPreviewAndCropCoordinates() throws {
        let state = ScoreMarkupState()
        state.mode = .writing; state.tool.kind = .stamp; state.armedStamp = (.fingering, "3")
        let overlay = ScorePageOverlay(page: 7, markup: state)
        overlay.frame = CGRect(x: 0, y: 0, width: 400, height: 500)
        overlay.activeCrop = NormalizedRect(x: 0.25, y: 0.2, width: 0.5, height: 0.6)
        overlay.layoutIfNeeded(); overlay.refresh()
        overlay.handleTap(at: CGPoint(x: 200, y: 250))
        let original = try XCTUnwrap(state.stampDraft)
        XCTAssertEqual(original.position.x + original.position.width / 2, 0.5, accuracy: 0.000001)
        XCTAssertEqual(original.position.y + original.position.height / 2, 0.5, accuracy: 0.000001)
        overlay.onPlaceStamp = { _, _ in false }
        overlay.commitStampDraft()
        XCTAssertEqual(state.stampDraft?.position, original.position, "A failed durable write must leave the placed preview reviewable")
        var placed = 0
        overlay.onPlaceStamp = { _, _ in placed += 1; return true }
        overlay.commitStampDraft(); overlay.commitStampDraft()
        XCTAssertEqual(placed, 1, "A confirmed preview may write exactly once")
        XCTAssertNil(state.stampDraft)
    }

    @MainActor func testReadingStickyNoteExpandsWithoutEditingOrBlockingOtherScorePoints() {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(x: 0, y: 0, width: 600, height: 800)
        let note = TextBoxAnnotation(pieceID: UUID(), page: 1,
                                     region: NormalizedRect(x: 0.1, y: 0.1, width: 0.18, height: 0.035),
                                     text: "Remember the A natural before changing position")
        overlay.displayedTextBoxes = [note]; overlay.layoutIfNeeded(); overlay.refresh()
        let point = CGPoint(x: 100, y: 90)
        XCTAssertTrue(overlay.hitTest(point, with: nil) === overlay, "A note must be tappable while reading without changing tools")
        var edited = false
        overlay.onEditTextBox = { _ in edited = true }
        overlay.handleTap(at: point)
        XCTAssertEqual(overlay.expandedNoteID, note.id)
        XCTAssertFalse(edited, "Reading opens the reminder; editing is a separate explicit action")
        overlay.handleTap(at: point)
        XCTAssertNil(overlay.expandedNoteID)
        state.visibleLayers.remove(.mine); overlay.refresh()
        XCTAssertFalse(overlay.containsNote(at: point), "Hidden note layers must not intercept navigation")
    }

    @MainActor func testHidingPassageBoxesRemovesHitsButDoesNotHideSelectionDraft() {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(x: 0, y: 0, width: 600, height: 800)
        let region = PassageRegion(page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.2)
        overlay.displayedRegions = [region]
        state.showPassageBoxes = false; overlay.refresh()
        XCTAssertNil(overlay.passageRegion(at: CGPoint(x: 100, y: 100)))
        state.begin(Passage(pieceID: UUID(), title: "Draft", regions: [region])); overlay.refresh()
        XCTAssertEqual(overlay.passageRegion(at: CGPoint(x: 100, y: 100)), region.id)
        XCTAssertTrue(overlay.gestureRecognizerShouldBegin(overlay.selectionDoubleTap))
    }

    @MainActor func testCorruptPendingDrawingStaysReadOnlyAfterOrdinaryRefresh() throws {
        let markup = ScoreMarkupState()
        let url = URL(fileURLWithPath: "/fixture.pdf")
        markup.rememberInk(page: 1, data: Data([0xff, 0]), expected: nil, document: url)
        markup.mode = .writing
        let parent = PagedScoreView(url: url, page: .constant(1), twoPages: false, markup: markup,
                                   drawingData: { _ in nil }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator()
        let page = try makePage()
        let document = PDFDocument(); document.insert(page, at: 0)
        let pdf = PDFView(); pdf.document = document
        let overlay = try XCTUnwrap(coordinator.pdfView(pdf, overlayViewFor: page) as? ScorePageOverlay)
        XCTAssertTrue(overlay.contentReadOnly)
        coordinator.refreshOverlays()
        XCTAssertTrue(overlay.contentReadOnly, "A refresh cannot erase the corrupt-byte recovery boundary")
        overlay.frame = CGRect(x: 0, y: 0, width: 612, height: 792); overlay.layoutIfNeeded()
        XCTAssertTrue(overlay.canvas.isUserInteractionEnabled, "Read-only protection belongs to input routing, not responder teardown")
        XCTAssertNil(overlay.hitTest(CGPoint(x: 100, y: 100), with: nil), "Corrupt ink must never receive a replacement stroke")
        XCTAssertEqual(markup.pendingInk[1]?.data, Data([0xff, 0]), "Original unsaved bytes stay available for explicit recovery")
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

    @MainActor func testFailedWriteAndBoundedEvictionProtectDirtyCurrentAndOtherPageInk() async throws {
        let state = ScoreMarkupState()
        var writesAllowed = false; var currentPage = 1
        let secondPageInk = ink(at: 100).dataRepresentation()
        var saved: [Int: Data] = [2: secondPageInk]
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/unused-fixture.pdf"),
                                   page: Binding(get: { currentPage }, set: { currentPage = $0 }), twoPages: false,
                                   markup: state, drawingData: { saved[$0] }, saveDrawing: { page, data, expected in
            guard writesAllowed, saved[page] == expected else { return false }
            saved[page] = data.isEmpty ? nil : data
            return true
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let document = PDFDocument()
        for index in 0..<4 { document.insert(try makePage(), at: index) }
        let view = PDFView(); view.document = document
        let pages = try (0..<4).map { try XCTUnwrap(document.page(at: $0)) }
        let first = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: pages[0]) as? ScorePageOverlay)
        let second = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: pages[1]) as? ScorePageOverlay)
        let third = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: pages[2]) as? ScorePageOverlay)
        let fourth = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: pages[3]) as? ScorePageOverlay)
        coordinator.canvasViewDidBeginUsingTool(first.canvas)
        coordinator.loading = true; first.canvas.drawing = ink(at: 40); coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(first.canvas)
        coordinator.otherLayersDrawingCache[1] = []; coordinator.otherLayersDrawingCache[2] = []
        XCTAssertFalse(coordinator.flush())
        coordinator.pdfView(view, willEndDisplayingOverlayView: first, for: pages[0])
        XCTAssertTrue(coordinator.overlays[1] === first, "A failed write must pin its dirty canvas")
        XCTAssertTrue(coordinator.dirtyPages.contains(1)); XCTAssertNil(saved[1])
        for (overlay, page) in [(second, pages[1]), (third, pages[2]), (fourth, pages[3])] {
            coordinator.pdfView(view, willEndDisplayingOverlayView: overlay, for: page)
        }
        XCTAssertNil(coordinator.overlays[2], "A third clean detached page must evict the oldest eligible clean page")
        XCTAssertNil(coordinator.otherLayersDrawingCache[2], "Eviction must release that page's layer source bytes")
        XCTAssertTrue(coordinator.overlays[1] === first, "Clean-page pressure must never evict the unsaved page")
        XCTAssertTrue(coordinator.overlays[3] === third); XCTAssertTrue(coordinator.overlays[4] === fourth)
        XCTAssertEqual(saved[2], secondPageInk, "Eviction cannot rewrite another page's durable ink")
        writesAllowed = true
        coordinator.pdfView(view, willEndDisplayingOverlayView: first, for: pages[0])
        XCTAssertTrue(coordinator.overlays[1] === first, "The newly saved current page retains its Undo history")
        XCTAssertTrue(first.canvas.inkHistory.canUndo, "Saving a retained page must keep its original drawing history")
        XCTAssertFalse(coordinator.activeToolPages.contains(1), "Detachment ends activity even if PencilKit omits tool-end")
        XCTAssertEqual(saved[1], first.canvas.sourceDrawing.dataRepresentation())
        coordinator.pdfView(view, willEndDisplayingOverlayView: fourth, for: pages[3])
        let refreshedThird = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: pages[2]) as? ScorePageOverlay)
        coordinator.pdfView(view, willEndDisplayingOverlayView: refreshedThird, for: pages[2])
        XCTAssertTrue(coordinator.overlays[1] === first, "The oldest detached page must be protected while it is current")
        XCTAssertNil(coordinator.overlays[4], "An eligible noncurrent clean page is evicted instead")
        currentPage = 2
        let reopenedSecond = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: pages[1]) as? ScorePageOverlay)
        assertSameInk(reopenedSecond.canvas.sourceDrawing, try PKDrawing(data: secondPageInk))
        coordinator.pdfView(view, willEndDisplayingOverlayView: reopenedSecond, for: pages[1])
        XCTAssertNil(coordinator.overlays[1], "Once another page is current, the oldest clean page becomes eligible")
        XCTAssertNil(coordinator.otherLayersDrawingCache[1])
        XCTAssertTrue(coordinator.overlays[2] === reopenedSecond)
        let reopenedFirst = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: pages[0]) as? ScorePageOverlay)
        XCTAssertFalse(reopenedFirst === first)
        assertSameInk(reopenedFirst.canvas.sourceDrawing, try PKDrawing(data: XCTUnwrap(saved[1])))
        coordinator.pdfView(view, willEndDisplayingOverlayView: first, for: pages[0])
        XCTAssertTrue(coordinator.overlays[1] === reopenedFirst, "A stale callback cannot evict its replacement")
        XCTAssertEqual(saved[2], secondPageInk)
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

    /// Blocker regression (verifier "reader lens", 2026-09-29): a page that already has saved ink
    /// could never save again — every save after the first raised a false "Ink changed in another
    /// window" conflict, even with a single window open. Root cause: `InkPerStroke.merge` rebuilds a
    /// fresh `PKDrawing(strokes:)` on every call, which embeds a new random value each time regardless
    /// of content (see `InkPerStroke`'s own doc comment), so two back-to-back calls against the exact
    /// same stored rows never compare equal. Reproduces the mechanism with a real `PracticeStore` and
    /// real `InkPerStroke` — unlike this file's other ink tests, which back `drawingData` with a plain
    /// dictionary that is stable by construction and would never have caught this.
    @MainActor func testSecondSaveOnAPageWithExistingInkDoesNotFalselyConflictDespiteNonDeterministicMerge() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ink-conflict-\(UUID())")
        let practiceStore = PracticeStore(directory: directory)
        defer { try? FileManager.default.removeItem(at: directory) }
        var piece = Piece(title: "Test score", pageCount: 1); piece.pdfFileName = "fixture.pdf"
        try practiceStore.addPiece(piece)
        try practiceStore.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: InkPerStroke.split(ink(at: 20)))

        func rows() -> [InkStroke] { practiceStore.inkStrokes(pieceID: piece.id, page: 1, layer: .mine) }
        func rawMerge() -> Data? {
            let blobs = rows().map(\.data)
            return blobs.isEmpty ? nil : try? InkPerStroke.merge(blobs).dataRepresentation()
        }
        // The premise this fix depends on, proven directly (audit probe P1): merging the exact same
        // stored rows twice in a row, nothing else changed, produces different bytes.
        XCTAssertNotEqual(rawMerge(), rawMerge(),
                          "PKDrawing(strokes:) must be non-deterministic across independent constructions for this regression to be meaningful")

        // ScoreWorkspace.mergedInkData's fix, reproduced inline: cache the merge, invalidated only
        // when the stored rows' own identity (id + content) actually changes.
        var cache: (signature: Int, data: Data?)?
        func cachedMergedInkData(_ page: Int) -> Data? {
            let current = rows()
            var signature = current.count &* 31
            for row in current { signature ^= row.id.hashValue ^ (row.fingerprint ?? row.data).hashValue }
            if let cache, cache.signature == signature { return cache.data }
            let blobs = current.map(\.data)
            let data = blobs.isEmpty ? nil : try? InkPerStroke.merge(blobs).dataRepresentation()
            cache = (signature, data)
            return data
        }
        let state = ScoreMarkupState()
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/unused-fixture.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, drawingData: cachedMergedInkData, saveDrawing: { page, data, expected in
            guard cachedMergedInkData(page) == expected else { state.conflictPage = page; return false }
            let strokes = data.isEmpty ? [] : InkPerStroke.split(try! PKDrawing(data: data), reusing: rows())
            guard (try? practiceStore.replaceInk(pieceID: piece.id, page: page, layer: .mine, strokes: strokes)) != nil else { return false }
            cache = nil
            return true
        }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let document = PDFDocument(); document.insert(try makePage(), at: 0)
        let view = PDFView(); view.document = document
        let overlay = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: XCTUnwrap(document.page(at: 0))) as? ScorePageOverlay)
        XCTAssertEqual(overlay.canvas.drawing.strokes.count, 1, "The page must load with its already-saved stroke")

        // Draw a second stroke on top of the first (mirrors U1: "saved the first stroke, then the
        // second stroke showed the conflict dialog").
        coordinator.loading = true
        overlay.canvas.drawing = PKDrawing(strokes: overlay.canvas.drawing.strokes + ink(at: 60).strokes)
        coordinator.loading = false
        coordinator.canvasViewDrawingDidChange(overlay.canvas)
        XCTAssertTrue(coordinator.flush(), "Saving a second stroke on a page that already has saved ink must not raise a false conflict")
        XCTAssertNil(state.conflictPage)
        XCTAssertEqual(rows().count, 2, "Both strokes must be persisted")
    }

    /// Major regression (verifier "reader lens", 2026-09-29): after a non-destructive page-tool crop,
    /// existing marks used to shift off the music they were drawn on — `croppedForDisplay`/
    /// `uncroppedFromDisplay` (`GeometryTransforms.swift`) existed but were never called from any app
    /// code. Proves `ScorePageOverlay.activeCrop` actually remaps hit-testing, new-mark placement, and
    /// the ink canvas's own positioning.
    @MainActor func testActiveCropRemapsStoredMarksForDisplayAndNewMarksBackForStorage() throws {
        let state = ScoreMarkupState()
        let overlay = ScorePageOverlay(page: 1, markup: state)
        let crop = NormalizedRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5)
        overlay.activeCrop = crop
        overlay.frame = CGRect(x: 0, y: 0, width: 300, height: 400)
        overlay.layoutIfNeeded()

        // A box stored at the page's original center sits inside the crop's own middle — it must
        // hit-test at the crop-remapped position, not its raw stored coordinates.
        let region = PassageRegion(page: 1, x: 0.4, y: 0.4, width: 0.2, height: 0.2)
        overlay.displayedRegions = [region]
        overlay.refresh()
        overlay.handleTap(at: CGPoint(x: 150, y: 200))
        XCTAssertEqual(state.selectedRegionID, region.id, "A stored mark must hit-test at its crop-remapped position")

        // A mark stored entirely outside the active crop must never be selectable at all.
        let outside = PassageRegion(page: 1, x: 0, y: 0, width: 0.1, height: 0.1)
        overlay.displayedRegions = [outside]
        state.selectedRegionID = nil
        overlay.handleTap(at: CGPoint(x: 10, y: 10))
        XCTAssertNil(state.selectedRegionID, "A mark entirely outside the active crop must never be hit-testable")

        // Placing a *new* stamp at the crop's own center must be converted back to the page's
        // original basis before it reaches ScoreWorkspace/PracticeStore.
        state.mode = .writing; state.tool.kind = .stamp; state.armedStamp = (.circle, nil)
        overlay.refresh()
        var placedAt: NormalizedRect?
        overlay.onPlaceStamp = { _, position in placedAt = position; return true }
        overlay.handleTap(at: CGPoint(x: 150, y: 200))
        overlay.commitStampDraft()
        let placed = try XCTUnwrap(placedAt)
        XCTAssertEqual(placed.x + placed.width / 2, 0.5, accuracy: 0.01, "A stamp placed at the crop's own center must be stored at the page's original center")
        XCTAssertEqual(placed.y + placed.height / 2, 0.5, accuracy: 0.01)

        // Ink itself has no normalized-rect representation to remap — the canvas must instead stay
        // sized to the *original* page and be repositioned (offset, not scaled) so the crop window
        // fills the overlay; a stroke's raw points then keep meaning the same thing regardless of crop.
        XCTAssertEqual(overlay.canvas.frame.size, CGSize(width: 600, height: 800),
                       "The canvas must stay sized to the original page (bounds / crop fraction), not shrink to the crop")
        XCTAssertEqual(overlay.canvas.frame.origin, CGPoint(x: -150, y: -200),
                       "The canvas must be offset so the crop window, not the canvas's own origin, aligns with the overlay")
    }

    /// Major regression (verifier "reader lens", 2026-09-29): entering performance mode did not lock
    /// ink on a page whose overlay already existed — `inkReadOnly` was only ever set once, at overlay
    /// creation, so a page visited before entering performance mode stayed interactive.
    @MainActor func testEnteringPerformanceModeLocksInkOnAnAlreadyVisibleOverlay() async throws {
        let state = ScoreMarkupState()
        func parent(allowsInk: Bool) -> PagedScoreView {
            PagedScoreView(url: URL(fileURLWithPath: "/unused-fixture.pdf"), page: .constant(1), twoPages: false,
                          markup: state, allowsInk: allowsInk, onPageChanged: { _ in })
        }
        let coordinator = parent(allowsInk: true).makeCoordinator(); coordinator.connectControls()
        defer { coordinator.autosave?.cancel() }
        let document = PDFDocument(); document.insert(try makePage(), at: 0)
        let view = PDFView(); view.document = document
        let overlay = try XCTUnwrap(coordinator.pdfView(view, overlayViewFor: XCTUnwrap(document.page(at: 0))) as? ScorePageOverlay)
        state.mode = .writing; state.tool.kind = .pen
        overlay.refresh()
        XCTAssertFalse(overlay.inkReadOnly)
        XCTAssertTrue(overlay.canvas.isUserInteractionEnabled)

        // Enter performance mode: allowsInk flips false without this overlay being torn down and
        // recreated (performance mode is a plain state flip, not a document/layer change).
        _ = coordinator.adoptParent(parent(allowsInk: false))
        coordinator.refreshOverlays()
        XCTAssertTrue(overlay.inkReadOnly, "Performance mode must lock ink on a page that already has a live overlay")
        overlay.frame = CGRect(x: 0, y: 0, width: 612, height: 792); overlay.layoutIfNeeded()
        XCTAssertTrue(overlay.canvas.isUserInteractionEnabled)
        XCTAssertNil(overlay.hitTest(CGPoint(x: 100, y: 100), with: nil), "Performance mode must reject ink at the real input boundary")
    }

    /// Major regression (verifier "reader lens", 2026-09-29): after a page-tool reorder, `parent.page`
    /// (a *displayed* page number) no longer equals the *source* page `overlays` is keyed by — Undo/Redo
    /// ink silently targeted a nonexistent overlay and stayed disabled/no-op on the page actually shown.
    @MainActor func testUndoRedoTargetTheOverlayForTheDisplayedPageEvenAfterAPageToolReorder() async throws {
        let state = ScoreMarkupState()
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/unused-fixture.pdf"), page: .constant(1), twoPages: false, markup: state, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator()
        // `canvas.undoManager` (a `UIResponder` property) resolves through the responder chain, which
        // needs a real window — the same scaffolding `testNativePDFOverlayCoordinatesMatchCroppedPage
        // AtEveryRotation` below already uses for the identical reason.
        let view = PDFView(frame: CGRect(x: 0, y: 0, width: 400, height: 600))
        view.displayMode = .singlePage; view.autoScales = true; view.isInMarkupMode = true
        view.pageOverlayViewProvider = coordinator
        coordinator.pdfView = view
        let window = UIWindow(frame: view.bounds)
        let controller = UIViewController(); controller.view.addSubview(view)
        window.rootViewController = controller; window.isHidden = false
        defer { window.isHidden = true; view.pageOverlayViewProvider = nil }
        coordinator.connectControls()
        let document = PDFDocument(); document.insert(try makePage(), at: 0); document.insert(try makePage(), at: 1)
        // A page-tool reorder: the first *displayed* page now shows source page 2, not source page 1.
        coordinator.effectivePages = [
            EffectivePage(id: UUID(), displayOrder: 1, sourcePage: 2, kind: .original, cropRect: nil, rotationDegrees: 0),
            EffectivePage(id: UUID(), displayOrder: 2, sourcePage: 1, kind: .original, cropRect: nil, rotationDegrees: 0),
        ]
        view.document = document; view.go(to: try XCTUnwrap(document.page(at: 0)))
        view.layoutDocumentView(); view.setNeedsLayout(); view.layoutIfNeeded()
        var overlay: ScorePageOverlay?
        for _ in 0..<100 {
            if let found = coordinator.overlays[2], found.window != nil, found.bounds.width > 0 { overlay = found; break }
            try await Task.sleep(for: .milliseconds(20))
            view.layoutIfNeeded()
        }
        let resolved = try XCTUnwrap(overlay, "PDFKit should request the overlay for the first displayed page")
        XCTAssertEqual(resolved.pageNumber, 2, "The overlay for the first displayed page must be keyed by its actual source page")
        let manager = try XCTUnwrap(resolved.canvas.undoManager)
        XCTAssertFalse(manager.isUndoRegistrationEnabled, "PencilKit's private tile targets must not enter Undo history")
        let points = [CGPoint(x: 10, y: 20), CGPoint(x: 90, y: 30)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: Double(index) / 10, size: CGSize(width: 2, height: 2),
                          opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let drawing = PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black),
                                                   path: PKStrokePath(controlPoints: points, creationDate: .now))])
        coordinator.canvasViewDidBeginUsingTool(resolved.canvas)
        resolved.canvas.drawing = drawing; coordinator.canvasViewDrawingDidChange(resolved.canvas)
        coordinator.canvasViewDidEndUsingTool(resolved.canvas)
        for _ in 0..<20 { await Task.yield() }
        XCTAssertTrue(manager.canUndo)
        state.undoInk()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertTrue(resolved.canvas.drawing.strokes.isEmpty, "Undo must target displayed page 1's source page 2")
        state.redoInk()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(resolved.canvas.drawing, drawing)

    }

    /// Minor regression (verifier "reader lens", 2026-09-29): only the tap zones and buttons turned
    /// pages — a reading swipe did nothing. A swipe on a zoomed-in page must still pan, not turn.
    @MainActor func testSwipeTurnsPagesAtFitZoomButNotWhileZoomedIn() throws {
        let state = ScoreMarkupState()
        var turned: [Int] = []
        let parent = PagedScoreView(url: URL(fileURLWithPath: "/unused-fixture.pdf"), page: .constant(1), twoPages: false,
                                   markup: state, onTurnPage: { turned.append($0) }, onPageChanged: { _ in })
        let coordinator = parent.makeCoordinator()
        let view = ZoomableScorePDFView()
        let document = PDFDocument(); document.insert(try makePage(), at: 0); view.document = document
        view.minScaleFactor = 1; view.maxScaleFactor = 6; view.scaleFactor = 1 // at fit, unzoomed
        let swipe = UISwipeGestureRecognizer()
        view.addGestureRecognizer(swipe)

        swipe.direction = .left
        coordinator.swiped(swipe)
        XCTAssertEqual(turned, [1], "A left swipe at fit-to-page zoom must turn to the next page")
        swipe.direction = .right
        coordinator.swiped(swipe)
        XCTAssertEqual(turned, [1, -1], "A right swipe must turn back")

        // A zoomed-in page: the identical swipe must not also turn the page — the reader needs that
        // drag to pan the enlarged page instead.
        view.minScaleFactor = 1; view.maxScaleFactor = 6; view.scaleFactor = 2
        turned = []
        coordinator.swiped(swipe)
        XCTAssertTrue(turned.isEmpty, "A swipe on a zoomed-in page must not also turn the page")
    }

    /// Major regression (verifier "reader lens", 2026-09-29): in two-page mode, turning by one page
    /// (the "half-page turns" toggle's whole point) left the displayed spread unchanged on every
    /// other tap — `displaysAsBook` was hardcoded `false` forever, so PDFKit's own (1,2),(3,4),…
    /// pairing never moved no matter what page the `page` binding pointed at. `page` landing on an
    /// even number must flip the parity so that page pairs with the *next* page instead of snapping
    /// back to the page before it.
    func testHalfPageTurnParityTogglesPdfKitBookPaginationOnEvenPages() {
        XCTAssertFalse(scoreDisplaysAsBook(twoPages: true, page: 1), "Odd pages keep the fixed (1,2),(3,4)… pairing")
        XCTAssertTrue(scoreDisplaysAsBook(twoPages: true, page: 2), "Landing on page 2 must pair it with page 3, not fall back into (1,2)")
        XCTAssertFalse(scoreDisplaysAsBook(twoPages: true, page: 3), "Page 3 returns to the fixed pairing, now grouped with page 4")
        XCTAssertTrue(scoreDisplaysAsBook(twoPages: true, page: 4))
        // Single-page mode: parity is meaningless with only one page on screen; must stay false
        // regardless of the displayed page number so it never affects `.singlePage` layout.
        XCTAssertFalse(scoreDisplaysAsBook(twoPages: false, page: 2))
        XCTAssertFalse(scoreDisplaysAsBook(twoPages: false, page: 1))
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
