import XCTest

final class PraeludeUITests: XCTestCase {
    // Use single 150 ms presses after observing lost 50 ms touches on this simulator host.
    // No interaction retries: every action must produce its expected native state.

    @MainActor private func launch(seed: Bool = true, reset: Bool = true) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting"] + (reset ? ["--reset"] : []) + (seed ? ["--seed"] : [])
        app.launch()
        return app
    }
    @MainActor private func openScore(_ app: XCUIApplication) {
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 1), hideSidebar.isHittable { hideSidebar.press(forDuration: 0.15) }

        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Practice study")).firstMatch
        XCTAssertTrue(piece.waitForExistence(timeout: 10), app.debugDescription)
        for _ in 0..<5 where !piece.isHittable { app.swipeUp() }
        piece.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["startSet"].waitForExistence(timeout: 5))
    }
    @MainActor private func startSet(_ app: XCUIApplication) {
        app.buttons["startSet"].press(forDuration: 0.15)
        let start = app.buttons["confirmStartSet"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 5), app.debugDescription)
    }
    @MainActor private func screenshot(_ name: String) {
        RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testScorePracticeCorrectionAndRelaunch() {
        let app = launch()
        screenshot("01-today")
        openScore(app)
        screenshot("02-score")
        app.buttons["Next page"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Page 2 of 4"].exists)
        app.buttons["startSet"].press(forDuration: 0.15)
        screenshot("03-set-sheet")
        app.buttons["Cancel"].press(forDuration: 0.15)
        startSet(app)
        app.buttons["verdict_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["1 of 5 clean · 60 BPM"].exists)
        app.buttons["verdict_sloppy"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["0 of 5 clean · 60 BPM"].exists)
        app.buttons["undoRep"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["1 of 5 clean · 60 BPM"].exists)
        screenshot("04-practice")
        app.buttons["pausePractice"].press(forDuration: 0.15)
        XCTAssertFalse(app.buttons["verdict_clean"].isEnabled)
        app.terminate()
        app.launchArguments = ["--uitesting"]
        app.launch()
        let resume = app.buttons["resumePractice"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), app.debugDescription)
        resume.press(forDuration: 0.15)
        XCTAssertFalse(app.buttons["verdict_clean"].isEnabled)
        XCTAssertTrue(app.buttons["Page 2 of 4"].exists)
        app.buttons["pausePractice"].press(forDuration: 0.15)
        for _ in 0..<4 { app.buttons["verdict_clean"].press(forDuration: 0.15) }
        XCTAssertTrue(app.staticTexts["Set complete"].waitForExistence(timeout: 5))
        screenshot("05-completion")
        app.buttons["Finish"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["startSet"].waitForExistence(timeout: 10))
    }
    @MainActor func testBlankInstallAndAddPaperPiece() {
        let app = launch(seed: false)
        XCTAssertFalse(app.staticTexts["Practice study"].exists)
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 1), hideSidebar.isHittable { hideSidebar.press(forDuration: 0.15) }
        let add = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Add your first piece")).firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 5), app.debugDescription)
        add.press(forDuration: 0.15)
        let title = app.textFields["pieceTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 5), app.debugDescription)
        title.press(forDuration: 0.15); title.typeText("My practice")
        app.buttons["savePiece"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["startSet"].waitForExistence(timeout: 5), app.debugDescription)
        screenshot("06-paper-score")
    }
    @MainActor func testMetronomeAndPages() {
        let app = launch(); openScore(app)
        app.buttons["pageIndicator"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Page 3"].waitForExistence(timeout: 10))
        app.buttons["Page 3"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Page 3 of 4"].exists)
        app.buttons["openMetronome"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["toggleMetronome"].waitForExistence(timeout: 5))
        app.buttons["toggleMetronome"].press(forDuration: 0.15)
        screenshot("07-metronome")
        app.buttons["toggleMetronome"].press(forDuration: 0.15)
        app.buttons["Done"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["startSet"].waitForExistence(timeout: 10))
    }
    @MainActor private func tapSettings(_ app: XCUIApplication) {
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 2), hideSidebar.isHittable { hideSidebar.press(forDuration: 0.15) }
        let query = app.buttons.matching(identifier: "appSettings")
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            query.allElementsBoundByIndex.contains { $0.isHittable }
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 10), .completed, app.debugDescription)
        query.allElementsBoundByIndex.first { $0.isHittable }?.press(forDuration: 0.15)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), app.debugDescription)
    }
    @MainActor private func dismissFilePicker(_ app: XCUIApplication) {
        let picker = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "DOC.browsingRoot Source:")).firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 90), app.debugDescription)
        let cancel = app.buttons.matching(identifier: "Cancel").allElementsBoundByIndex.first { $0.isHittable }
        if let cancel {
            cancel.press(forDuration: 0.15)
        } else {
            // iOS 26's phone exporter presents a draggable sheet without a Cancel button.
            // Its phantom accessibility "Cancel" Other overlaps More and is not a control.
            let grabber = picker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.01))
            let bottom = picker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.88))
            grabber.press(forDuration: 0.15, thenDragTo: bottom)
        }
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: picker)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed, app.debugDescription)
    }
    @MainActor func testBackupDialogsAndDarkAppearance() {
        let app = launch()
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 1), hideSidebar.isHittable { hideSidebar.press(forDuration: 0.15) }
        tapSettings(app)
        let appearance = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Appearance")).firstMatch
        XCTAssertTrue(appearance.waitForExistence(timeout: 5), app.debugDescription)
        appearance.press(forDuration: 0.15)
        app.buttons["Dark"].press(forDuration: 0.15)
        app.buttons["Done"].press(forDuration: 0.15)
        openScore(app)
        startSet(app)
        screenshot("08-dark-practice")
        app.buttons.matching(identifier: "Close score").firstMatch.press(forDuration: 0.15)
        tapSettings(app)
        app.buttons["Export backup"].press(forDuration: 0.15)
        let picker = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "DOC.browsingRoot Source:")).firstMatch
        // Both Browse and Recents expose this document root; the phone exporter has no Cancel button.
        XCTAssertTrue(picker.waitForExistence(timeout: 90), app.debugDescription)
        screenshot("09-backup-exporter")
        dismissFilePicker(app)
        tapSettings(app)
        app.buttons["Restore backup"].press(forDuration: 0.15)
        XCTAssertTrue(picker.waitForExistence(timeout: 90), app.debugDescription)
        dismissFilePicker(app)
        XCTAssertTrue(app.buttons["resumePractice"].exists)
    }

}
