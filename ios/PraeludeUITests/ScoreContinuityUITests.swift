import XCTest
import UIKit

/// End-to-end regressions for the reported "Done freezes" and disappearing practice dock.
final class ScoreContinuityUITests: XCTestCase {
    @MainActor private func openScore(_ app: XCUIApplication, reset: Bool = true) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--uitesting"] + (reset ? ["--reset", "--seed"] : [])
        app.launch()
        let pieces = app.tabBars.buttons["Pieces"]
        if pieces.exists, pieces.isHittable {
            pieces.tap()
        } else {
            let show = app.buttons["Show Sidebar"]
            if show.waitForExistence(timeout: 1), show.isHittable { show.tap() }
            let sidebarPieces = app.buttons["Pieces"].firstMatch
            XCTAssertTrue(sidebarPieces.waitForExistence(timeout: 5), app.debugDescription)
            sidebarPieces.tap()
        }
        XCTAssertTrue(app.navigationBars["Pieces"].waitForExistence(timeout: 8), app.debugDescription)
        let hide = app.buttons["Hide Sidebar"]
        if hide.exists, hide.isHittable { hide.tap() }
        let piece = app.buttons.matching(NSPredicate(format: "identifier == %@ AND label CONTAINS %@ AND label CONTAINS %@", "pieceRow", "Practice study", "Praelude test score")).firstMatch
        for _ in 0..<6 where !piece.isHittable { app.swipeUp() }
        XCTAssertTrue(piece.waitForExistence(timeout: 8), app.debugDescription)
        piece.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["annotateScore"].waitForExistence(timeout: 8), app.debugDescription)
    }
    @MainActor private func shot(_ name: String) {
        let item = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        item.name = name; item.lifetime = .keepAlways; add(item)
    }

    @MainActor func testDrawingPaletteKeepsLivePracticeAndSurvivesRepeatedDone() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["armStartSet"].tap()
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 8))
        for cycle in 0..<4 {
            app.buttons["annotateScore"].tap()
            XCTAssertTrue(app.buttons["annotationTool_pen"].waitForExistence(timeout: 5), "Annotation entry \(cycle)")
            XCTAssertTrue(app.buttons["verdict_clean"].isHittable, "Practice remains available while marking the score")
            if cycle == 0 {
                let toggle = app.switches["fingerDrawing"]
                toggle.coordinate(withNormalizedOffset: .init(dx: 0.97, dy: 0.5)).tap()
                let pdfPage = app.otherElements["scorePDF"].textViews.firstMatch
                let from = pdfPage.coordinate(withNormalizedOffset: .init(dx: 0.25, dy: 0.60))
                let to = pdfPage.coordinate(withNormalizedOffset: .init(dx: 0.68, dy: 0.63))
                from.press(forDuration: 0.1, thenDragTo: to)
                let undoReady = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: app.buttons["Undo ink"])
                XCTAssertEqual(XCTWaiter.wait(for: [undoReady], timeout: 5), .completed, app.debugDescription)
                shot("build8-drawing-and-practice")
                app.buttons["toggleAnnotationPalette"].tap()
                XCTAssertTrue(app.buttons["verdict_clean"].isHittable)
                app.buttons["verdict_clean"].tap()
                app.buttons["toggleAnnotationPalette"].tap()
            }
            app.buttons["annotationTool_stamp"].tap()
            app.buttons["annotationTool_text"].tap()
            app.buttons["annotationTool_pen"].tap()
            app.buttons["finishScoreMarkup"].tap()
            XCTAssertFalse(app.buttons["annotationTool_pen"].exists, "Done must close the tools")
            XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 5), "Done must return without freezing on cycle \(cycle)")
            app.buttons["Next page"].tap()
            app.buttons["Previous page"].tap()
        }
        app.buttons["closeScore"].tap()
        XCTAssertTrue(app.buttons["resumePractice"].waitForExistence(timeout: 8))
        app.terminate(); openScore(app, reset: false)
        let preserved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value CONTAINS %@", "inkPage1=1"), object: app.otherElements["scorePDF"])
        XCTAssertEqual(XCTWaiter.wait(for: [preserved], timeout: 8), .completed, "The new stroke survives Done, navigation and relaunch")
        shot("build8-preserved-ink-after-relaunch")
    }

    @MainActor func testFloatingToolsMoveMinimizeAndRotateWithinScore() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["annotateScore"].tap()
        let palette = app.otherElements["annotationControls"]
        XCTAssertTrue(palette.waitForExistence(timeout: 8), app.debugDescription)
        let handle = app.images["moveAnnotationPalette"]
        let before = palette.frame
        let source = handle.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.5))
        source.press(forDuration: 0.1, thenDragTo: source.withOffset(.init(dx: -60, dy: 80)))
        XCTAssertGreaterThan(palette.frame.minY, before.minY + 30)
        app.buttons["toggleAnnotationPalette"].tap()
        let collapsed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in palette.frame.height <= 45 }, object: nil)
        let collapseResult = XCTWaiter.wait(for: [collapsed], timeout: 5)
        shot("build8-palette-after-minimize")
        XCTAssertEqual(collapseResult, .completed, app.debugDescription)
        XCTAssertTrue(app.buttons["armStartSet"].isHittable)
        XCUIDevice.shared.orientation = .landscapeLeft
        app.buttons["toggleAnnotationPalette"].tap()
        XCTAssertTrue(app.buttons["finishScoreMarkup"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.frame.contains(palette.frame), app.debugDescription)
        shot("build8-floating-tools-landscape")
        app.buttons["finishScoreMarkup"].tap()
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .portrait
    }
}
