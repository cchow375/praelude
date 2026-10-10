import UIKit
import XCTest
@testable import Praelude

final class PassageSelectionInteractionTests: XCTestCase {
    @MainActor private func fixture(size: CGSize = CGSize(width: 5609.6, height: 7764.01)) -> (ScoreMarkupState, ScorePageOverlay) {
        let state = ScoreMarkupState()
        state.begin(Passage(pieceID: UUID(), title: "Draft"))
        let overlay = ScorePageOverlay(page: 1, markup: state)
        overlay.frame = CGRect(origin: .zero, size: size)
        overlay.layoutIfNeeded()
        overlay.updateInkResolution(displayScale: 700 / size.width)
        return (state, overlay)
    }

    @MainActor func testOversizedPageAndCropKeepBackingBoundedWithoutChangingInkCoordinates() {
        for size in [CGSize(width: 626.76, height: 874.92), CGSize(width: 5609.6, height: 7764.01)] {
            let (_, overlay) = fixture(size: size)
            for crop in [nil, NormalizedRect(x: 0.1, y: 0.2, width: 0.5, height: 0.5)] {
                overlay.activeCrop = crop
                overlay.layoutIfNeeded()
                let source = overlay.sourceCanvasFrame
                for displayScale in [700 / size.width, 1400 / size.width, 4] {
                    overlay.updateInkResolution(displayScale: displayScale)
                    XCTAssertLessThanOrEqual(source.width * source.height * pow(overlay.renderedInkScale, 2), 4_000_001)
                    XCTAssertLessThanOrEqual(size.width * size.height * pow(overlay.contentScaleFactor, 2), 4_000_001)
                    XCTAssertEqual(overlay.canvas.frame.minX, source.minX, accuracy: 0.000001)
                    XCTAssertEqual(overlay.canvas.frame.minY, source.minY, accuracy: 0.000001)
                    XCTAssertEqual(overlay.canvas.frame.width, source.width, accuracy: 0.000001)
                    XCTAssertEqual(overlay.canvas.frame.height, source.height, accuracy: 0.000001)
                    XCTAssertEqual(overlay.canvas.zoomScale, 1)
                    XCTAssertEqual(overlay.canvas.contentOffset, .zero)
                    XCTAssertEqual(overlay.selectionHandleDiameter * overlay.pageDisplayScale, 8, accuracy: 0.001)
                    XCTAssertEqual(overlay.selectionLineWidth * overlay.pageDisplayScale, 1.25, accuracy: 0.001)
                    XCTAssertEqual(overlay.selectionHitRadius * overlay.pageDisplayScale, 22, accuracy: 0.001)
                }
            }
        }
    }

    @MainActor func testLongDragCommitsOnceAndUndoRedoRestoreWholeGesture() throws {
        let (state, overlay) = fixture()
        let start = CGPoint(x: overlay.bounds.width * 0.2, y: overlay.bounds.height * 0.3)
        let end = CGPoint(x: overlay.bounds.width * 0.7, y: overlay.bounds.height * 0.45)
        overlay.handleSelectionPan(state: .began, location: start)
        for sample in 1...120 {
            let fraction = CGFloat(sample) / 120
            overlay.handleSelectionPan(state: .changed, location: CGPoint(x: start.x + (end.x-start.x)*fraction, y: start.y + (end.y-start.y)*fraction))
            XCTAssertTrue(state.regions.isEmpty, "Movement must stay local instead of invalidating the entire score workspace")
            XCTAssertFalse(state.canUndoSelection)
        }
        XCTAssertNotNil(overlay.selectionPreviewRect)
        overlay.handleSelectionPan(state: .ended, location: end)
        XCTAssertNil(overlay.selectionPreviewRect)
        let region = try XCTUnwrap(state.regions.first)
        XCTAssertEqual(region.x, 0.2, accuracy: 0.00001)
        XCTAssertEqual(region.width, 0.5, accuracy: 0.00001)
        XCTAssertEqual(state.selectedRegionID, region.id)
        state.undoSelection()
        XCTAssertTrue(state.regions.isEmpty)
        XCTAssertFalse(state.canUndoSelection, "A drag contributes one undo entry")
        state.redoSelection()
        XCTAssertEqual(state.regions, [region])
    }

    @MainActor func testCanceledDragRetainsDraftAndRedoHistory() {
        let (state, overlay) = fixture()
        let first = PassageRegion(page: 1, x: 0.2, y: 0.3, width: 0.5, height: 0.1)
        state.rememberSelection(); state.update(first)
        state.undoSelection()
        XCTAssertTrue(state.canRedoSelection)
        overlay.handleSelectionPan(state: .began, location: CGPoint(x: 100, y: 200))
        overlay.handleSelectionPan(state: .changed, location: CGPoint(x: 2000, y: 2500))
        overlay.handleSelectionPan(state: .cancelled, location: CGPoint(x: 2000, y: 2500))
        XCTAssertTrue(state.regions.isEmpty)
        XCTAssertTrue(state.canRedoSelection)
        XCTAssertFalse(state.canUndoSelection)
        XCTAssertNil(overlay.selectionPreviewRect)
    }

    @MainActor func testMoveResizeAndCropPreserveNormalizedStorage() throws {
        let (state, overlay) = fixture(size: CGSize(width: 3000, height: 4000))
        overlay.activeCrop = NormalizedRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5)
        overlay.layoutIfNeeded()
        let original = PassageRegion(page: 1, x: 0.35, y: 0.4, width: 0.2, height: 0.1)
        state.update(original); overlay.refresh()
        // Source region shows at x600,y1200,width1200,height800 inside this crop.
        overlay.handleSelectionPan(state: .began, location: CGPoint(x: 1200, y: 1600))
        overlay.handleSelectionPan(state: .changed, location: CGPoint(x: 1500, y: 2000))
        XCTAssertEqual(state.regions, [original])
        overlay.handleSelectionPan(state: .ended, location: CGPoint(x: 1500, y: 2000))
        let moved = try XCTUnwrap(state.regions.first)
        XCTAssertEqual(moved.x, 0.4, accuracy: 0.00001)
        XCTAssertEqual(moved.y, 0.45, accuracy: 0.00001)
        XCTAssertEqual(moved.width, original.width, accuracy: 0.00001)
        XCTAssertEqual(moved.height, original.height, accuracy: 0.00001)
        overlay.handleSelectionPan(state: .began, location: CGPoint(x: 2100, y: 2400))
        overlay.handleSelectionPan(state: .ended, location: CGPoint(x: 2400, y: 2800))
        let resized = try XCTUnwrap(state.regions.first)
        XCTAssertEqual(resized.x, moved.x, accuracy: 0.00001)
        XCTAssertEqual(resized.width, 0.25, accuracy: 0.00001)
        XCTAssertEqual(resized.height, 0.15, accuracy: 0.00001)
        state.undoSelection(); XCTAssertEqual(state.regions, [moved])
        state.undoSelection(); XCTAssertEqual(state.regions, [original])
    }

    @MainActor func testModeExitAndReplacementDraftRejectLateGestureCommit() {
        let (state, overlay) = fixture()
        let baseline = state.draft
        overlay.handleSelectionPan(state: .began, location: CGPoint(x: 100, y: 200))
        overlay.handleSelectionPan(state: .changed, location: CGPoint(x: 2000, y: 2500))
        state.finish(); overlay.refresh()
        XCTAssertNil(overlay.selectionPreviewRect)
        let replacement = Passage(pieceID: UUID(), title: "Another draft")
        state.begin(replacement)
        overlay.handleSelectionPan(state: .ended, location: CGPoint(x: 2100, y: 2600))
        XCTAssertEqual(state.draft, replacement)
        XCTAssertTrue(baseline?.regions.isEmpty == true)
    }

    @MainActor func testQuickBoxUsesSamePreviewAndCannotOverrideNormalSelection() {
        let (state, overlay) = fixture()
        state.finish(); state.quickBoxArmed = true
        overlay.handleSelectionPan(state: .began, location: CGPoint(x: 100, y: 200))
        overlay.handleSelectionPan(state: .changed, location: CGPoint(x: 2000, y: 2500))
        XCTAssertNotNil(overlay.selectionPreviewRect)
        XCTAssertEqual(overlay.selectionHandleDiameter * overlay.pageDisplayScale, 8, accuracy: 0.001)
        XCTAssertNil(state.pendingQuickBox)
        overlay.handleSelectionPan(state: .ended, location: CGPoint(x: 2000, y: 2500))
        XCTAssertNotNil(state.pendingQuickBox)
        XCTAssertFalse(state.quickBoxArmed)
        state.quickBoxArmed = true; state.breakPointArmed = true
        state.begin(Passage(pieceID: UUID(), title: "Normal selection"))
        XCTAssertFalse(state.quickBoxArmed)
        XCTAssertFalse(state.breakPointArmed)
        XCTAssertNil(state.pendingQuickBox)
    }
}
