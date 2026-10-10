import PencilKit
import UIKit
import XCTest
@testable import Praelude

final class ScoreInkHistoryTests: XCTestCase {
    @MainActor private final class Fixture {
        let history = ScoreInkHistory()
        var value = PKDrawing()
        var allowed = true
        var stable = true
        var restores = 0
        init() {
            history.drawing = { [weak self] in self?.value ?? PKDrawing() }
            history.applyDrawing = { [weak self] in self?.value = $0 }
            history.acceptsRequest = { [weak self] in self?.allowed ?? false }
            history.mayRestore = { [weak self] in self?.stable ?? false }
            history.onRestored = { [weak self] in self?.restores += 1 }
        }
        func edit(_ drawing: PKDrawing) {
            history.beginTool(); value = drawing; history.drawingChanged(); history.endTool()
        }
    }
    @MainActor private func ink(_ count: Int, shift: CGFloat = 0) -> PKDrawing {
        var strokes: [PKStroke] = []
        for index in 0..<count {
            var points: [PKStrokePoint] = []
            for point in 0..<3 {
                let x: CGFloat = CGFloat(index * 20 + point * 8) + shift
                let y: CGFloat = 40 + CGFloat(point)
                let location = CGPoint(x: x, y: y)
                let sample = PKStrokePoint(location: location, timeOffset: Double(point) / 10,
                                           size: CGSize(width: 2, height: 2), opacity: 1,
                                           force: 1, azimuth: 0, altitude: CGFloat.pi / 2)
                points.append(sample)
            }
            let date = Date(timeIntervalSince1970: Double(index))
            let path = PKStrokePath(controlPoints: points, creationDate: date)
            let stroke = PKStroke(ink: PKInk(.pen, color: .black), path: path)
            strokes.append(stroke)
        }
        return PKDrawing(strokes: strokes)
    }
    @MainActor private func settle() async {
        for _ in 0..<3 {
            await withCheckedContinuation { continuation in DispatchQueue.main.async { continuation.resume() } }
        }
    }
    @MainActor func testNativeTargetsCannotRegisterButResponderUndoRedoRestoresDrawingValues() async {
        let fixture = Fixture(); let expected = ink(1); let manager = fixture.history.undoManager
        var privateActionInvoked = false
        manager.enableUndoRegistration()
        manager.registerUndo(withTarget: fixture) { _ in privateActionInvoked = true }
        manager.removeAllActions(); manager.enableUndoRegistration()
        XCTAssertFalse(manager.isUndoRegistrationEnabled)
        fixture.edit(expected); await settle()
        XCTAssertTrue(manager.canUndo)
        manager.undoNestedGroup(); await settle()
        XCTAssertTrue(fixture.value.strokes.isEmpty); XCTAssertTrue(manager.canRedo)
        manager.redo(); await settle()
        XCTAssertEqual(fixture.value, expected); XCTAssertFalse(privateActionInvoked)
    }
    @MainActor func testLateFirstCallbackCannotUndoPreviousStrokeAndLaterUndoRecovers() async {
        let fixture = Fixture(); let first = ink(1); let second = ink(2)
        fixture.edit(first); await settle()
        fixture.history.beginTool(); fixture.history.endTool()
        fixture.history.request(.undo); await settle()
        XCTAssertEqual(fixture.value, first, "Unpublished stroke must not make Undo remove the previous mark")
        fixture.value = second; fixture.history.drawingChanged(); await settle()
        fixture.history.request(.undo); await settle()
        XCTAssertEqual(fixture.value, first)
        fixture.history.request(.redo); await settle()
        XCTAssertEqual(fixture.value, second)
    }
    @MainActor func testLatePressureAfterEndAndRenderRemainsOneToolOperation() async {
        let fixture = Fixture(); let first = ink(1); let final = ink(1, shift: 4)
        fixture.history.beginTool(); fixture.value = first; fixture.history.drawingChanged()
        fixture.history.endTool(); await settle(); fixture.history.finishedRendering()
        fixture.value = final; fixture.history.drawingChanged(); await settle()
        fixture.history.request(.undo); await settle()
        XCTAssertTrue(fixture.value.strokes.isEmpty)
        fixture.history.request(.redo); await settle(); XCTAssertEqual(fixture.value, final)
        fixture.history.request(.undo); await settle(); XCTAssertFalse(fixture.history.canUndo)
    }
    @MainActor func testCancelledOrNoOpToolPreservesRedoWithoutRenderingCallback() async {
        let fixture = Fixture(); let expected = ink(1); fixture.edit(expected); await settle()
        fixture.history.request(.undo); await settle()
        fixture.history.beginTool(); fixture.history.endTool(cancelled: true); await settle()
        XCTAssertTrue(fixture.history.canRedo)
        fixture.history.request(.redo); await settle(); XCTAssertEqual(fixture.value, expected)
        fixture.history.request(.undo); await settle()
        fixture.history.beginTool(); fixture.history.endTool(); await settle()
        XCTAssertTrue(fixture.history.canRedo, "No-op selection must not disable Redo indefinitely")
        fixture.history.request(.redo); await settle() // Safe first no-op for ambiguous delayed publication.
        fixture.history.request(.redo); await settle(); XCTAssertEqual(fixture.value, expected)
    }
    @MainActor func testRapidToolsAndMultipleLassoOrEraserUpdatesKeepSeparateOperations() async {
        let fixture = Fixture(); let first = ink(1); let second = ink(2)
        fixture.edit(first); fixture.edit(second) // No run-loop turn between strokes.
        fixture.history.beginTool()
        fixture.value = ink(2, shift: 4); fixture.history.drawingChanged()
        fixture.value = ink(2, shift: 8); fixture.history.drawingChanged()
        fixture.history.endTool(); await settle()
        fixture.history.request(.undo); await settle(); XCTAssertEqual(fixture.value, second)
        fixture.history.request(.undo); await settle(); XCTAssertEqual(fixture.value, first)
        fixture.history.request(.undo); await settle(); XCTAssertTrue(fixture.value.strokes.isEmpty)
        fixture.history.request(.redo); await settle(); XCTAssertEqual(fixture.value, first)
    }
    @MainActor func testUndoDuringToolOrZoomWaitsAndCoalescesWithoutDroppingCurrentInk() async {
        let fixture = Fixture(); let expected = ink(1); fixture.history.beginTool()
        fixture.value = expected; fixture.history.drawingChanged()
        fixture.history.request(.undo); fixture.history.request(.undo); await settle()
        XCTAssertEqual(fixture.value, expected); XCTAssertEqual(fixture.restores, 0)
        fixture.stable = false; fixture.history.endTool(); await settle()
        XCTAssertEqual(fixture.restores, 0)
        fixture.stable = true; fixture.history.finishedRendering(); await settle()
        XCTAssertTrue(fixture.value.strokes.isEmpty); XCTAssertEqual(fixture.restores, 1)
        fixture.history.request(.redo); await settle(); XCTAssertEqual(fixture.value, expected)
    }
    @MainActor func testDetachDropsPendingCommandButRetainsInterruptedStrokeAndHistory() async {
        let fixture = Fixture(); let expected = ink(1); fixture.history.beginTool()
        fixture.value = expected; fixture.history.drawingChanged(); fixture.history.request(.undo)
        fixture.history.detach(); await settle()
        XCTAssertFalse(fixture.history.toolActive); XCTAssertEqual(fixture.value, expected)
        fixture.history.request(.undo); await settle(); XCTAssertTrue(fixture.value.strokes.isEmpty)
    }
    @MainActor func testReadonlyOrPageChangeRejectsPendingCommandAndReplacementClearsHistory() async {
        let fixture = Fixture(); let expected = ink(1); fixture.edit(expected); await settle()
        fixture.stable = false; fixture.history.request(.undo); await settle()
        fixture.allowed = false; fixture.stable = true; fixture.history.finishedRendering(); await settle()
        XCTAssertEqual(fixture.value, expected)
        fixture.allowed = true; fixture.history.finishedRendering(); await settle()
        XCTAssertEqual(fixture.value, expected, "A rejected read-only/other-page command must not replay later")
        let replacement = ink(3); fixture.value = replacement; fixture.history.reset(to: fixture.value)
        fixture.history.request(.undo); await settle()
        XCTAssertEqual(fixture.value, replacement); XCTAssertFalse(fixture.history.canUndo)
        XCTAssertFalse(fixture.history.canRedo)
    }
    @MainActor func testHistoryIsBoundedAndNativeClearDoesNotEraseAppRecords() async {
        let fixture = Fixture()
        let drawings = (1...50).map { ink(1, shift: CGFloat($0)) }
        for drawing in drawings { fixture.edit(drawing) }
        await settle(); XCTAssertEqual(fixture.history.historyLimit, 40)
        fixture.history.undoManager.removeAllActions()
        for _ in 0..<40 { fixture.history.request(.undo); await settle() }
        XCTAssertEqual(fixture.value, drawings[9]); XCTAssertFalse(fixture.history.canUndo)
        XCTAssertFalse(fixture.history.undoManager.isUndoRegistrationEnabled)
    }
    @MainActor func testNewEditAfterUndoDiscardsOnlyTheAbandonedRedoBranch() async {
        let fixture = Fixture(); let first = ink(1); let second = ink(2); let replacement = ink(1, shift: 30)
        fixture.edit(first); fixture.edit(second); await settle()
        fixture.history.request(.undo); await settle()
        XCTAssertEqual(fixture.value, first); XCTAssertTrue(fixture.history.canRedo)
        fixture.edit(replacement); await settle()
        XCTAssertFalse(fixture.history.canRedo)
        fixture.history.request(.undo); await settle(); XCTAssertEqual(fixture.value, first)
        fixture.history.request(.redo); await settle(); XCTAssertEqual(fixture.value, replacement)
        fixture.history.request(.undo); await settle()
        fixture.history.request(.undo); await settle(); XCTAssertTrue(fixture.value.strokes.isEmpty)
    }
}
