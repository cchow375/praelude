import XCTest

/// Uses only the disposable DEBUG UI-test library. It creates one real UI-recorded rep before
/// setting a target, so the current-reference provenance and sparse state are tested together.
final class PracticeBalanceUITests: XCTestCase {
    @MainActor private func openScore(_ app: XCUIApplication, reset: Bool) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--uitesting"] + (reset ? ["--reset", "--seed"] : [])
        app.launch()
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.tap() }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Practice study")).firstMatch
        for _ in 0..<8 where !piece.exists || !piece.isHittable { app.swipeUp() }
        XCTAssertTrue(piece.waitForExistence(timeout: 10), app.debugDescription)
        piece.tap()
        XCTAssertTrue(app.buttons["Score options"].waitForExistence(timeout: 10), app.debugDescription)
    }
    @MainActor private func openBalance(_ app: XCUIApplication) {
        app.buttons["Score options"].tap()
        let balance = app.buttons["Practice balance & full-tempo target"]
        XCTAssertTrue(balance.waitForExistence(timeout: 5), app.debugDescription); balance.tap()
        XCTAssertTrue(app.buttons["editFullTempoTarget"].waitForExistence(timeout: 8), app.debugDescription)
    }
    @MainActor private func text(_ fragment: String, app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", fragment)).firstMatch
    }
    @MainActor private func reveal(_ element: XCUIElement, app: XCUIApplication) {
        for _ in 0..<10 where !element.exists || !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.waitForExistence(timeout: 5), app.debugDescription)
    }
    @MainActor private func shot(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testFullTempoPersistsAndOldRepShowsQuarterTempoProvenanceAndSparseSignal() {
        let app = XCUIApplication(); openScore(app, reset: true)
        let start = app.buttons["armStartSet"]
        XCTAssertTrue(start.waitForExistence(timeout: 8), app.debugDescription); start.tap()
        let clean = app.buttons["verdict_clean"]
        XCTAssertTrue(clean.waitForExistence(timeout: 8), app.debugDescription); clean.tap()
        app.buttons["pausePractice"].tap()
        openBalance(app)
        app.buttons["editFullTempoTarget"].tap()
        let field = app.textFields["fullTempoBPM"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), app.debugDescription)
        field.tap(); field.typeText("240")
        // A chosen slow-work check enables the signal, which must remain insufficient for one rep.
        let slow = app.steppers.matching(NSPredicate(format: "label CONTAINS %@", "At or below 30% tempo")).firstMatch
        XCTAssertTrue(slow.waitForExistence(timeout: 5), app.debugDescription)
        for _ in 0..<4 where !slow.isHittable { app.swipeUp() }
        slow.buttons["Increment"].tap()
        let save = app.buttons["saveFullTempoTarget"]
        XCTAssertTrue(save.isEnabled, app.debugDescription); save.tap()
        XCTAssertTrue(app.buttons["editFullTempoTarget"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(text("Quarter tempo is 60.0 BPM", app: app).exists, app.debugDescription)
        shot("history-full-tempo-240-quarter-60", app: app)
        let quarter = text("Around quarter tempo", app: app); reveal(quarter, app: app)
        let quarterCell = app.cells.containing(.staticText, identifier: "Around quarter tempo · 20–30%").firstMatch
        XCTAssertTrue(quarterCell.staticTexts["1 reps · 1 sessions"].exists, app.debugDescription)
        let provenance = text("older reps had no saved full-tempo target", app: app); reveal(provenance, app: app)
        XCTAssertTrue(provenance.label.contains("1 older reps"), app.debugDescription)
        shot("history-quarter-tempo-current-reference", app: app)
        let sparse = text("Not enough information", app: app); reveal(sparse, app: app)
        XCTAssertFalse(text("Good · chosen checks met", app: app).exists)
        shot("history-sparse-suggested-signal", app: app)
        app.buttons["Done"].tap()
        app.buttons["closeScore"].tap(); app.terminate()
        openScore(app, reset: false); openBalance(app)
        app.buttons["editFullTempoTarget"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(field.value as? String, "240", app.debugDescription)
        XCTAssertTrue(app.steppers.matching(NSPredicate(format: "label CONTAINS %@", "At or below 30% tempo: 5%")).firstMatch.exists, app.debugDescription)
        shot("history-reference-and-coverage-reopened", app: app)
        app.buttons["Cancel"].tap()
    }
}
