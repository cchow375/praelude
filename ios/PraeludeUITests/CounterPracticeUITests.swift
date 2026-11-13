import XCTest
import UIKit

/// Uses the disposable DEBUG library. These interactions verify practice data and both layouts;
/// simulator audio, camera, haptics and playing-distance legibility remain physical checks.
final class CounterPracticeUITests: XCTestCase {
    private var requestedDisplay = "counter"
    @MainActor func testIndependentCardScoreCounterCleanUndoPreservesUngradedReview() {
        let app = launch(display: "automatic")
        let tab = app.tabBars.buttons["Passages"]
        if !tab.exists {
            let sidebar = app.buttons["showAppSidebar"]
            if sidebar.waitForExistence(timeout: 3), sidebar.isHittable { sidebar.tap() }
        }
        let destination = tab.exists ? tab : app.buttons["Passages"].firstMatch
        XCTAssertTrue(destination.waitForExistence(timeout: 8), app.debugDescription)
        destination.tap()
        XCTAssertTrue(app.buttons["addPhotoPassage"].waitForExistence(timeout: 8), app.debugDescription)

        // Bind later actions to the exact card whose image was opened, rather than selecting
        // another first-match row after navigating between reading and practice.
        let image = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'passageCardImage_'")).firstMatch
        XCTAssertTrue(image.waitForExistence(timeout: 10), app.debugDescription)
        let passageID = String(image.identifier.dropFirst("passageCardImage_".count))
        XCTAssertFalse(passageID.isEmpty)
        screenshot("independent-card-library", app: app)
        image.tap()
        XCTAssertTrue(app.navigationBars["Passage"].waitForExistence(timeout: 8), app.debugDescription)

        func revealInSheet(_ element: XCUIElement, identifier: String) {
            let scroll = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            XCTAssertTrue(scroll.exists, app.debugDescription)
            for _ in 0..<7 where !element.exists || !element.isHittable {
                let window = app.windows.firstMatch
                let navigationBottom = app.navigationBars.allElementsBoundByIndex.last?.frame.maxY ?? scroll.frame.minY
                let top = max(navigationBottom, scroll.frame.minY) + 16
                let bottom = min(window.frame.maxY, scroll.frame.maxY) - 24
                let above = element.exists && element.frame.midY < (top + bottom) / 2
                let origin = window.coordinate(withNormalizedOffset: .zero)
                origin.withOffset(CGVector(dx: window.frame.midX, dy: top + (bottom - top) * (above ? 0.3 : 0.8)))
                    .press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: window.frame.midX, dy: top + (bottom - top) * (above ? 0.8 : 0.3))))
            }
            XCTAssertTrue(element.exists && element.isHittable, app.debugDescription)
        }
        func assertUngradedReview(_ captureName: String) {
            let details = app.buttons["Review date & first-attempt history"]
            revealInSheet(details, identifier: "passageCardDetailScroll"); details.tap()
            XCTAssertTrue(app.navigationBars["Review details"].waitForExistence(timeout: 8), app.debugDescription)
            let noDate = app.staticTexts["No review date yet. Record your first attempt to begin the review ladder, or practice without grading."]
            revealInSheet(noDate, identifier: "passageReviewDetailList")
            let noGrades = app.staticTexts["No first-attempt grades saved."]
            revealInSheet(noGrades, identifier: "passageReviewDetailList")
            screenshot(captureName, app: app)
            app.navigationBars["Review details"].buttons["Done"].tap()
            XCTAssertTrue(app.navigationBars["Passage"].waitForExistence(timeout: 8), app.debugDescription)
        }
        assertUngradedReview("independent-review-before-practice")
        let open = app.buttons["Open score"]
        revealInSheet(open, identifier: "passageCardDetailScroll"); open.tap()
        let display = app.segmentedControls["practiceDisplayPicker"]
        XCTAssertTrue(display.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(display.buttons["Score"].isSelected, app.debugDescription)
        XCTAssertTrue(app.descendants(matching: .any)["scorePDF"].waitForExistence(timeout: 10), app.debugDescription)
        screenshot("independent-card-opens-actual-score", app: app)
        app.buttons["closeScore"].tap()

        let practice = app.buttons["practiceCard_" + passageID]
        XCTAssertTrue(practice.waitForExistence(timeout: 8), app.debugDescription)
        practice.tap()
        XCTAssertTrue(display.waitForExistence(timeout: 10), app.debugDescription)
        if !display.buttons["Counter"].isSelected { display.buttons["Counter"].tap() }
        XCTAssertTrue(app.scrollViews["counterWorkspace"].waitForExistence(timeout: 8), app.debugDescription)
        let ungradedStart = app.buttons["skipColdGrade"]
        XCTAssertTrue(ungradedStart.waitForExistence(timeout: 8), app.debugDescription)
        ungradedStart.tap()
        let clean = app.buttons["verdict_clean"]
        XCTAssertTrue(clean.waitForExistence(timeout: 10), app.debugDescription)
        reveal(clean, app: app); clean.tap()
        expectProgress("1 of", app: app)
        screenshot("independent-card-counter-clean-saved", app: app)
        let undo = app.buttons["undoRep"]
        reveal(undo, app: app); undo.tap()
        expectProgress("0 of", app: app)
        let pause = app.buttons["pausePractice"]
        reveal(pause, app: app); pause.tap()
        XCTAssertEqual(pause.label, "Resume practice", app.debugDescription)
        screenshot("independent-card-counter-undone-paused", app: app)
        app.buttons["closeScore"].tap()
        let sameImage = app.buttons["passageCardImage_" + passageID]
        XCTAssertTrue(sameImage.waitForExistence(timeout: 8), app.debugDescription)
        sameImage.tap()
        XCTAssertTrue(app.navigationBars["Passage"].waitForExistence(timeout: 8), app.debugDescription)
        assertUngradedReview("independent-review-after-clean-and-undo")
    }
    @MainActor func testCounterSessionAppearsInCalendarAndRecordedHistory() {
        let app = launch()
        openScore(app)
        startPassage(app)
        app.buttons["verdict_clean"].tap()
        expectProgress("1 of", app: app)
        let pause = app.buttons["pausePractice"]
        reveal(pause, app: app); pause.tap()
        app.buttons["closeScore"].tap()
        let progress = app.tabBars.buttons["Progress"]
        if progress.exists { progress.tap() }
        else {
            let show = app.buttons["Show Sidebar"]
            if show.exists { show.tap() }
            app.buttons["Progress"].firstMatch.tap()
        }
        let calendar = app.buttons["Practice calendar"]
        XCTAssertTrue(calendar.waitForExistence(timeout: 10), app.debugDescription)
        calendar.tap()
        XCTAssertTrue(app.navigationBars["Calendar"].waitForExistence(timeout: 8), app.debugDescription)
        let session = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'calendarSession_'")).firstMatch
        let list = app.collectionViews["practiceCalendarList"]
        for _ in 0..<5 where !session.isHittable { list.swipeUp() }
        XCTAssertTrue(session.isHittable, app.debugDescription)
        screenshot("calendar-recorded-day-and-session", app: app)
        session.tap()
        XCTAssertTrue(app.navigationBars["Session"].waitForExistence(timeout: 8), app.debugDescription)
        screenshot("calendar-saved-session-history", app: app)
    }
    @MainActor func testDefaultDisplayMatchesTheDeviceAndScoreRemainsAvailable() {
        let app = launch(display: "automatic")
        openScore(app)
        let mode = app.segmentedControls["practiceDisplayPicker"]
        let phone = UIDevice.current.userInterfaceIdiom == .phone
        XCTAssertTrue(mode.buttons[phone ? "Counter" : "Score"].isSelected, app.debugDescription)
        if phone {
            XCTAssertTrue(app.scrollViews["counterWorkspace"].exists, app.debugDescription)
            mode.buttons["Score"].tap()
        }
        XCTAssertTrue(app.descendants(matching: .any)["scorePDF"].waitForExistence(timeout: 10), app.debugDescription)
        screenshot("device-default-and-retained-score", app: app)
    }

    @MainActor private func launch(display: String = "counter") -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        requestedDisplay = display
        app.launchArguments = ["--uitesting", "--reset", "--seed"]
        app.launch()
        return app
    }

    @MainActor private func openScore(_ app: XCUIApplication) {
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.tap() }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Practice study")).firstMatch
        for _ in 0..<8 where !piece.exists || !piece.isHittable { app.swipeUp() }
        XCTAssertTrue(piece.waitForExistence(timeout: 10), app.debugDescription)
        piece.tap()
        XCTAssertTrue(app.segmentedControls["practiceDisplayPicker"].waitForExistence(timeout: 15), app.debugDescription)
        if requestedDisplay == "counter" || requestedDisplay == "score" {
            let target = app.segmentedControls["practiceDisplayPicker"].buttons[requestedDisplay == "counter" ? "Counter" : "Score"]
            if !target.isSelected { target.tap() }
        }
    }

    @MainActor private func startPassage(_ app: XCUIApplication) {
        let passages = app.buttons["passages"]
        XCTAssertTrue(passages.waitForExistence(timeout: 10), app.debugDescription)
        passages.tap()
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "savedPassage_")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), app.debugDescription)
        row.tap()
        let explore = app.buttons["skipColdGrade"]
        XCTAssertTrue(explore.waitForExistence(timeout: 10), app.debugDescription)
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !app.navigationBars["Passages"].exists && explore.isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 10), .completed, app.debugDescription)
        explore.tap()
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10), app.debugDescription)
    }

    @MainActor private func expectProgress(_ value: String, app: XCUIApplication) {
        let progress = app.staticTexts["repProgress"]
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", value), object: progress)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed, app.debugDescription)
    }

    @MainActor private func reveal(_ element: XCUIElement, app: XCUIApplication) {
        for _ in 0..<7 where !element.isHittable {
            // UIKit's scroll view extends behind the navigation bar. Its default swipeDown
            // starts under that bar in landscape and never scrolls the actual content.
            let scroll = app.scrollViews["counterWorkspace"]
            let above = element.exists && element.frame.midY < app.windows.firstMatch.frame.midY
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: above ? 0.48 : 0.82))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: above ? 0.82 : 0.48))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertTrue(element.isHittable, app.debugDescription)
    }

    @MainActor private func screenshot(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    @MainActor func testCounterPracticeSavesUndoRestAndModeSwitch() {
        let app = launch()
        openScore(app)
        XCTAssertTrue(app.scrollViews["counterWorkspace"].exists, app.debugDescription)
        XCTAssertFalse(app.descendants(matching: .any)["scorePDF"].exists, "Counter should release PDF rendering")
        startPassage(app)
        screenshot("counter-running-portrait", app: app)
        for value in ["clean", "sloppy", "again"] {
            let button = app.buttons["verdict_\(value)"]
            XCTAssertGreaterThanOrEqual(button.frame.height, 79.9, app.debugDescription)
            XCTAssertTrue(button.isHittable, app.debugDescription)
        }
        app.buttons["verdict_clean"].tap()
        expectProgress("1 of", app: app)
        app.buttons["undoRep"].tap()
        expectProgress("0 of", app: app)
        let nudge = app.buttons["counterTempoNudge_1"]
        reveal(nudge, app: app)
        XCTAssertGreaterThanOrEqual(nudge.frame.height, 43.9, app.debugDescription)
        let tempo = app.buttons["tempoDialValue"]
        let initialTempo = tempo.value as? String
        nudge.tap()
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in tempo.value as? String != initialTempo }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 10), .completed, app.debugDescription)
        let toolControl = app.buttons["counterPracticeTools"]
        reveal(toolControl, app: app)
        toolControl.tap()
        let rest = app.buttons["counterRest_30"]
        reveal(rest, app: app)
        XCTAssertGreaterThanOrEqual(rest.frame.height, 43.9, app.debugDescription)
        let percentage = app.buttons["counterTempoPercent_50"]
        reveal(percentage, app: app)
        XCTAssertGreaterThanOrEqual(percentage.frame.height, 43.9, app.debugDescription)
        reveal(rest, app: app)
        rest.tap()
        let resume = app.buttons["pausePractice"]
        reveal(resume, app: app)
        XCTAssertEqual(resume.label, "Resume practice", app.debugDescription)
        XCTAssertFalse(app.buttons["verdict_clean"].isEnabled, app.debugDescription)
        screenshot("counter-rest-paused", app: app)
        resume.tap()
        let mode = app.segmentedControls["practiceDisplayPicker"]
        mode.buttons["Score"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["scorePDF"].waitForExistence(timeout: 10), app.debugDescription)
        mode.buttons["Counter"].tap()
        XCTAssertTrue(app.scrollViews["counterWorkspace"].waitForExistence(timeout: 10), app.debugDescription)
        expectProgress("0 of", app: app)
        screenshot("counter-return-preserved", app: app)
    }

    @MainActor func testCounterControlsRemainReachableInLandscape() {
        let app = launch()
        openScore(app)
        startPassage(app)
        XCUIDevice.shared.orientation = .landscapeLeft
        let rotated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.windows.firstMatch.frame
            return frame.width > frame.height
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [rotated], timeout: 10), .completed, app.debugDescription)
        let verdict = app.buttons["verdict_clean"]
        reveal(verdict, app: app)
        verdict.tap()
        expectProgress("1 of", app: app)
        screenshot("counter-running-landscape", app: app)
    }
}
