import XCTest
import UIKit

/// Native regressions for annotation transitions during a live set and low-friction passage save.
final class ScoreWorkflowUITests: XCTestCase {
    @MainActor private func openScore(_ app: XCUIApplication) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--uitesting", "--reset", "--seed"]
        app.launch()
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.press(forDuration: 0.15) }
        let pieces = app.tabBars.buttons["Pieces"]
        if pieces.exists, pieces.isHittable {
            pieces.tap()
            XCTAssertTrue(app.navigationBars["Pieces"].waitForExistence(timeout: 5))
        }
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

    @MainActor func testAnnotationControlsPreserveScoreAndReturnAfterRotation() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["annotateScore"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["annotationTool_pen"].waitForExistence(timeout: 8))
        func renderedWidth(_ score: XCUIElement) -> Double? {
            guard let diagnostics = score.value as? String,
                  let field = diagnostics.split(separator: ";").first(where: { $0.hasPrefix("renderedPageWidth=") }),
                  let width = Double(field.dropFirst("renderedPageWidth=".count)), width.isFinite else { return nil }
            return width
        }
        var portraitWidth: Double?
        for orientation: UIDeviceOrientation in [.portrait, .landscapeLeft, .portrait] {
            XCUIDevice.shared.orientation = orientation
            let score = app.otherElements["scorePDF"]
            var lastFrame = CGRect.zero
            var lastChange = Date.now
            let layout = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                let window = app.frame
                guard (orientation == .portrait ? window.height > window.width : window.width > window.height),
                      score.exists, score.frame.height > 100, score.frame.width > 100 else { return false }
                let current = score.frame
                if current != lastFrame { lastFrame = current; lastChange = .now; return false }
                return Date.now.timeIntervalSince(lastChange) >= 0.4
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [layout], timeout: 8), .completed)
            if orientation == .landscapeLeft, score.frame.height < 300 {
                let readable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    guard let width = renderedWidth(score) else { return false }
                    return width >= min(300, score.frame.width * 0.6)
                }, object: nil)
                XCTAssertEqual(XCTWaiter.wait(for: [readable], timeout: 8), .completed,
                               "Landscape annotation must keep notation readable, not merely a large empty PDF container")
            }
            if orientation == .portrait {
                if let before = portraitWidth {
                    let restored = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                        guard let width = renderedWidth(score) else { return false }
                        return abs(width - before) < max(2, before * 0.02)
                    }, object: nil)
                    XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 8), .completed,
                                   "Automatic landscape width fit must restore the original portrait zoom")
                } else { portraitWidth = renderedWidth(score); XCTAssertNotNil(portraitWidth) }
            }
            let controls = app.descendants(matching: .any).matching(identifier: "annotationControls").firstMatch
            let done = app.buttons["finishScoreMarkup"]
            for _ in 0..<8 {
                if done.exists, done.isHittable, controls.frame.intersection(app.frame).contains(done.frame) { break }
                controls.swipeUp()
            }
            XCTAssertTrue(done.isHittable && controls.frame.intersection(app.frame).contains(done.frame), app.debugDescription)
            XCTAssertTrue(app.frame.contains(controls.frame), "The annotation tray must stay completely within the window")
            XCTAssertGreaterThanOrEqual(done.frame.height, 43.99)
            XCTAssertLessThanOrEqual(controls.frame.height, app.frame.width > 600 ? 200 : 240,
                                     "The ordinary pen tray must fit its controls instead of reserving blank space")
            shot("build7-annotation-\(orientation.rawValue)")
        }
        app.buttons["finishScoreMarkup"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 8), app.debugDescription)
        XCUIDevice.shared.orientation = .portrait
    }
}
