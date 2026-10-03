import XCTest

/// Native regressions for annotation transitions during a live set and low-friction passage save.
final class ScoreWorkflowUITests: XCTestCase {
    @MainActor private func openScore(_ app: XCUIApplication) {
        continueAfterFailure = false
        app.launchArguments = ["--uitesting", "--reset", "--seed"]
        app.launch()
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.press(forDuration: 0.15) }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Practice study", "4 pages")).firstMatch
        for _ in 0..<5 where !piece.isHittable { app.swipeUp() }
        XCTAssertTrue(piece.waitForExistence(timeout: 10), app.debugDescription)
        piece.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 10), app.debugDescription)
    }
    @MainActor private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testAnnotationDuringSetReturnsToSavedProgressAndLibrary() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["armStartSet"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["verdict_clean"].press(forDuration: 0.15)
        shot("build5-score-running")
        app.buttons["annotateScore"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["annotationTool_pen"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.switches["fingerDrawing"].exists)
        shot("build5-score-annotation")
        app.buttons["finishScoreMarkup"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["verdict_clean"].press(forDuration: 0.15)
        if app.buttons["hudExpand"].exists { app.buttons["hudExpand"].press(forDuration: 0.15) }
        XCTAssertTrue(app.staticTexts["2 of 5 clean"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["closeScore"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["resumePractice"].waitForExistence(timeout: 10), app.debugDescription)
        shot("build5-library-return")
    }
    @MainActor func testBottomDoneAndDoubleTapCommitPassage() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["drawPassageOnScore"].press(forDuration: 0.15)
        let done = app.buttons["finishScoreMarkup"]
        XCTAssertTrue(done.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertGreaterThan(done.frame.midY, app.frame.midY)
        let pdfPage = app.otherElements["scorePDF"].textViews.firstMatch
        XCTAssertTrue(pdfPage.waitForExistence(timeout: 10), app.debugDescription)
        let from = pdfPage.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.3))
        let to = pdfPage.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.42))
        from.press(forDuration: 0.15, thenDragTo: to)
        XCTAssertTrue(done.isEnabled, app.debugDescription)
        shot("build5-bottom-selection-done")
        pdfPage.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55)).doubleTap()
        XCTAssertTrue(app.buttons["annotateScore"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["passages"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "savedPassage_")).count >= 2, app.debugDescription)
        shot("build5-grouped-passages")
    }
}
