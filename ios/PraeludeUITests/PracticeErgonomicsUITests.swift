import XCTest

/// Exercises the controls that were missing from real practice, including their resulting
/// persisted actions. These use the isolated test library and never touch a musician's data.
final class PracticeErgonomicsUITests: XCTestCase {
    @MainActor private func launch() -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed"]
        app.launch()
        return app
    }

    @MainActor private func selectPassage(_ app: XCUIApplication) {
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.tap() }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Practice study")).firstMatch
        for _ in 0..<8 where !piece.exists || !piece.isHittable { app.swipeUp() }
        XCTAssertTrue(piece.waitForExistence(timeout: 10), app.debugDescription)
        piece.tap()
        let picker = app.buttons["passages"]
        XCTAssertTrue(picker.waitForExistence(timeout: 15), app.debugDescription)
        picker.tap()
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "savedPassage_")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), app.debugDescription)
        row.tap()
        XCTAssertTrue(app.buttons["armTempoGoal"].waitForExistence(timeout: 10), app.debugDescription)
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !app.navigationBars["Passages"].exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed)
    }

    @MainActor private func replace(_ field: XCUIElement, with text: String) {
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        let old = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + text)
    }

    @MainActor private func enterTempo(_ app: XCUIApplication, value: String, dial: XCUIElement) {
        dial.tap()
        let field = app.textFields["tempoExactEntry"]
        replace(field, with: value)
        XCTAssertEqual(field.value as? String, value, app.debugDescription)
        let apply = app.buttons["tempoApply"]
        XCTAssertTrue(apply.isEnabled && apply.isHittable, app.debugDescription)
        let entryShot = XCTAttachment(screenshot: app.screenshot())
        entryShot.name = "exact-tempo-\(value)-entry"; entryShot.lifetime = .keepAlways; add(entryShot)
        apply.tap()
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !app.textFields["tempoExactEntry"].exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed, app.debugDescription)
    }

    @MainActor func testDirectTempoGoalAndLeftHandReachRunningSet() {
        let app = launch()
        selectPassage(app)
        let left = app.buttons["practiceHands_L"]
        XCTAssertTrue(left.isHittable, app.debugDescription)
        left.tap()
        let tempo = app.descendants(matching: .any).matching(identifier: "tempoDialValue").firstMatch
        enterTempo(app, value: "72", dial: tempo)
        let tempoSaved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "72 beats per minute"), object: tempo)
        XCTAssertEqual(XCTWaiter.wait(for: [tempoSaved], timeout: 5), .completed, app.debugDescription)
        app.buttons["armTempoGoal"].tap()
        XCTAssertTrue(app.navigationBars["Tempo goal"].waitForExistence(timeout: 5), app.debugDescription)
        let start = app.descendants(matching: .any).matching(identifier: "tempoGoalStart").element
        let goal = app.descendants(matching: .any).matching(identifier: "tempoGoalTarget").element
        XCTAssertEqual(start.value as? String, "72 beats per minute", app.debugDescription)
        enterTempo(app, value: "88", dial: goal)
        XCTAssertEqual(start.value as? String, "72 beats per minute", app.debugDescription)
        XCTAssertEqual(goal.value as? String, "88 beats per minute", app.debugDescription)
        let goalShot = XCTAttachment(screenshot: app.screenshot())
        goalShot.name = "tempo-goal-72-to-88"; goalShot.lifetime = .keepAlways; add(goalShot)
        app.buttons["applyTempoGoal"].tap()
        XCTAssertTrue(app.buttons["skipColdGrade"].waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["skipColdGrade"].tap()
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10), app.debugDescription)
        if app.buttons["hudCollapse"].exists { app.buttons["hudCollapse"].tap() }
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "tempoDialValue").firstMatch.value as? String, "72 beats per minute", app.debugDescription)
        let context = app.staticTexts["activePracticeContext"]
        XCTAssertTrue(context.label.contains("Left hand"), app.debugDescription)
        XCTAssertTrue(context.label.contains("Goal 88 BPM"), app.debugDescription)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "direct-tempo-goal-left-hand"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["verdict_clean"].tap()
        app.buttons["undoRep"].tap()
        XCTAssertTrue(app.staticTexts["repProgress"].label.contains("0 of"), app.debugDescription)
    }

    @MainActor func testInvalidTempoCannotApplyAndCancelKeepsSavedTempo() {
        let app = launch()
        selectPassage(app)
        let tempo = app.descendants(matching: .any).matching(identifier: "tempoDialValue").firstMatch
        let original = tempo.value as? String
        tempo.tap()
        replace(app.textFields["tempoExactEntry"], with: "999")
        XCTAssertFalse(app.buttons["tempoApply"].isEnabled)
        app.buttons["Cancel"].tap()
        XCTAssertEqual(tempo.value as? String, original)
    }

    @MainActor func testPassageDirectRenameSavesAndReopens() {
        let app = launch()
        selectPassage(app)
        app.buttons["passages"].tap()
        let rename = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "renamePassage_")).firstMatch
        XCTAssertTrue(rename.waitForExistence(timeout: 10), app.debugDescription)
        rename.tap()
        let field = app.textViews["passageRenameField"]
        let single = app.textFields["passageRenameField"]
        replace(field.exists ? field : single, with: "Left hand join")
        app.buttons["savePassageName"].tap()
        XCTAssertTrue(app.staticTexts["Left hand join"].waitForExistence(timeout: 5), app.debugDescription)
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "savedPassage_")).firstMatch
        row.tap()
        XCTAssertTrue(app.staticTexts["Left hand join"].waitForExistence(timeout: 5), app.debugDescription)
    }

    @MainActor func testWarmupFinishIsVisibleAndReturnsToLibrary() {
        let app = launch()
        app.buttons["todayPracticeTools"].tap()
        app.buttons["Plan by available time"].tap()
        let start = app.buttons["startSession"]
        for _ in 0..<6 where !start.isHittable { app.swipeUp() }
        XCTAssertTrue(start.waitForExistence(timeout: 10), app.debugDescription)
        start.tap()
        let finish = app.buttons["finishWarmupPractice"]
        XCTAssertTrue(finish.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(finish.isHittable)
        app.buttons["warmupVerdict_clean"].tap()
        finish.tap()
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !app.buttons["closeWarmupPractice"].exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed, app.debugDescription)
        XCTAssertFalse(app.staticTexts["warmupProgress"].exists)
    }
}
