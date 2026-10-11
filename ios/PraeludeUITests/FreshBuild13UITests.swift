import XCTest

/// Independent checks over the disposable synthetic library. These do not exercise a physical
/// camera, speech recognition, Apple Pencil, or perceived click volume.
final class FreshBuild13UITests: XCTestCase {
    @MainActor private func openScore(_ app: XCUIApplication, reset: Bool = true) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--uitesting"] + (reset ? ["--reset", "--seed", "--seed-sections"] : [])
        app.launch()
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.tap() }
        let pieces = app.tabBars.buttons["Pieces"]
        if pieces.exists, pieces.isHittable { pieces.tap() }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Practice study", "4 pages")).firstMatch
        for _ in 0..<6 where !piece.isHittable { app.swipeUp() }
        XCTAssertTrue(piece.waitForExistence(timeout: 8), app.debugDescription)
        tap(piece, app: app)
        XCTAssertTrue(app.buttons["annotateScore"].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertTrue(app.otherElements["scorePDF"].textViews.firstMatch.waitForExistence(timeout: 8))
    }

    @MainActor private func tap(_ element: XCUIElement, app: XCUIApplication) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            element.exists && element.isHittable && element.frame.width > 1 && element.frame.height > 1 && app.frame.contains(element.frame)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 8), .completed, app.debugDescription)
        element.tap()
    }

    @MainActor private func shot(_ name: String, app: XCUIApplication) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }

    @MainActor private func armPassage(_ app: XCUIApplication) {
        tap(app.buttons["passages"], app: app)
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "savedPassage_", "Evenness and pulse")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 8), app.debugDescription)
        tap(row, app: app)
        XCTAssertTrue(app.buttons["coldGrade_missed"].waitForExistence(timeout: 8), app.debugDescription)
    }

    @MainActor private func openCameraSettings(_ app: XCUIApplication) {
        tap(app.buttons["Score options"], app: app)
        let camera = app.buttons["openCameraGestures"]
        let menu = app.collectionViews.firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5), app.debugDescription)
        // The CollectionView AX frame describes its full content (1180pt), not the visible
        // 472pt viewport. Its vertical scroll bar exposes the actual clipping rectangle.
        // Camera is now a primary Reading menu entry and must be visible without a scroll.
        let bar = menu.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "Vertical scroll bar")).firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 5), app.debugDescription)
        let visible = CGRect(x: menu.frame.minX, y: bar.frame.minY, width: menu.frame.width, height: bar.frame.height)
            .intersection(app.frame).insetBy(dx: 0, dy: 5)
        XCTAssertTrue(camera.exists && camera.isHittable && visible.contains(camera.frame), app.debugDescription)
        shot("fresh13-camera-primary-menu-entry", app: app)
        tap(camera, app: app)
        XCTAssertTrue(app.navigationBars["Camera gestures"].waitForExistence(timeout: 8), app.debugDescription)
    }

    @MainActor private func waitInk(_ count: Int, app: XCUIApplication) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value CONTAINS %@", "inkPage1=\(count)"), object: app.otherElements["scorePDF"])
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 8), .completed, app.debugDescription)
    }

    @MainActor private func chooseCameraAction(_ title: String, app: XCUIApplication) {
        // The score's disabled page arrows remain in AX behind the sheet. Select only the
        // action belonging to the open native Picker menu, never a global title match.
        let menu = app.collectionViews.containing(.button, identifier: title).firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5), app.debugDescription)
        tap(menu.buttons[title], app: app)
    }

    @MainActor private func drawingBounds(_ app: XCUIApplication) throws -> CGRect {
        let value = app.otherElements["scorePDF"].value as? String ?? ""
        let patterns = [#"drawingBounds=\(([-0-9.eE+]+), ([-0-9.eE+]+), ([-0-9.eE+]+), ([-0-9.eE+]+)\)"#,
                        #"drawingBounds=\{\{([-0-9.eE+]+), ([-0-9.eE+]+)\}, \{([-0-9.eE+]+), ([-0-9.eE+]+)\}\}"#]
        let matches = try patterns.compactMap { pattern in
            try NSRegularExpression(pattern: pattern).firstMatch(in: value, range: NSRange(value.startIndex..., in: value))
        }
        let match = try XCTUnwrap(matches.first, value)
        let numbers = try (1...4).map { index -> Double in
            let range = try XCTUnwrap(Range(match.range(at: index), in: value))
            return try XCTUnwrap(Double(value[range]))
        }
        return CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
    }

    @MainActor func testIndependentUndoNewStrokeRetainsNewLocationThroughSaveAndRelaunch() throws {
        let app = XCUIApplication(); openScore(app)
        tap(app.buttons["annotateScore"], app: app)
        let finger = app.switches["fingerDrawing"]
        XCTAssertTrue(finger.waitForExistence(timeout: 5), app.debugDescription)
        if finger.value as? String != "1" { finger.coordinate(withNormalizedOffset: .init(dx: 0.97, dy: 0.5)).tap() }
        tap(app.buttons["toggleAnnotationPalette"], app: app)
        let page = app.otherElements["scorePDF"].textViews.firstMatch
        page.coordinate(withNormalizedOffset: .init(dx: 0.25, dy: 0.50)).press(forDuration: 0.12,
            thenDragTo: page.coordinate(withNormalizedOffset: .init(dx: 0.65, dy: 0.52)))
        waitInk(1, app: app)
        let abandoned = try drawingBounds(app)
        page.tap(withNumberOfTaps: 1, numberOfTouches: 2)
        waitInk(0, app: app)
        page.coordinate(withNormalizedOffset: .init(dx: 0.30, dy: 0.73)).press(forDuration: 0.12,
            thenDragTo: page.coordinate(withNormalizedOffset: .init(dx: 0.70, dy: 0.75)))
        waitInk(1, app: app)
        let branch = try drawingBounds(app)
        XCTAssertGreaterThan(branch.minY, abandoned.maxY + 60,
                             "One stroke is insufficient: the retained stroke must occupy the new lower location.")
        shot("fresh13-undo-new-stroke-location", app: app)
        tap(app.buttons["toggleAnnotationPalette"], app: app)
        XCTAssertFalse(app.buttons["Redo ink"].isEnabled)
        tap(app.buttons["Undo ink"], app: app); waitInk(0, app: app)
        tap(app.buttons["Redo ink"], app: app); waitInk(1, app: app)
        XCTAssertEqual(try drawingBounds(app).minY, branch.minY, accuracy: 1)
        tap(app.buttons["finishScoreMarkup"], app: app)
        tap(app.buttons["closeScore"], app: app)
        app.terminate(); openScore(app, reset: false)
        waitInk(1, app: app)
        let reopened = try drawingBounds(app)
        XCTAssertEqual(reopened.minY, branch.minY, accuracy: 1)
        XCTAssertEqual(reopened.maxY, branch.maxY, accuracy: 1)
        XCTAssertGreaterThan(reopened.minY, abandoned.maxY + 60)
        shot("fresh13-new-stroke-location-reopened", app: app)
    }

    @MainActor func testCameraStartsOffWithMinimizedPreviewAndPersistsExplicitMapping() {
        let app = XCUIApplication(); openScore(app)
        XCTAssertFalse(app.otherElements["scoreCameraControls"].exists)
        openCameraSettings(app)
        XCTAssertTrue(app.navigationBars["Camera gestures"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(app.buttons["toggleFaceCamera"].label, "Enable camera")
        XCTAssertEqual(app.staticTexts["faceCameraStatus"].label, "Camera is off")
        XCTAssertEqual(app.switches["showFacePreview"].value as? String, "0")
        XCTAssertEqual(app.switches["showFaceMapping"].value as? String, "1")
        XCTAssertFalse(app.buttons["calibrateFaceCamera"].isEnabled)
        let nod = app.buttons["faceNodAction"]
        for _ in 0..<4 where !nod.isHittable { app.swipeUp() }
        let titles = ["Off", "Next page", "Previous page", "Clean", "Sloppy", "Again"]
        let original = titles.first { nod.label.contains($0) || (nod.value as? String ?? "").contains($0) } ?? "Clean"
        let chosen = original == "Previous page" ? "Clean" : "Previous page"
        tap(nod, app: app)
        chooseCameraAction(chosen, app: app)
        let mapped = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", chosen, chosen), object: nod)
        XCTAssertEqual(XCTWaiter.wait(for: [mapped], timeout: 5), .completed, app.debugDescription)
        shot("fresh13-camera-off-explicit-mapping", app: app)
        tap(app.navigationBars["Camera gestures"].buttons["Done"], app: app)
        XCTAssertFalse(app.otherElements["scoreCameraControls"].exists)
        tap(app.buttons["closeScore"], app: app)
        app.terminate(); openScore(app, reset: false)
        openCameraSettings(app)
        XCTAssertEqual(app.buttons["toggleFaceCamera"].label, "Enable camera")
        XCTAssertEqual(app.switches["showFacePreview"].value as? String, "0")
        let savedNod = app.buttons["faceNodAction"]
        for _ in 0..<4 where !savedNod.isHittable { app.swipeUp() }
        XCTAssertTrue(savedNod.label.contains(chosen) || (savedNod.value as? String ?? "").contains(chosen), app.debugDescription)
        shot("fresh13-camera-off-mapping-reopened", app: app)
        tap(savedNod, app: app); chooseCameraAction(original, app: app)
    }

    @MainActor func testDirectNameAndDecimalGoalSaveAndReopenWithoutStartingSet() {
        let app = XCUIApplication(); openScore(app); armPassage(app)
        tap(app.buttons["armEditPassage"], app: app)
        let name = app.textViews["passageRenameField"].exists ? app.textViews["passageRenameField"] : app.textFields["passageRenameField"]
        XCTAssertTrue(name.waitForExistence(timeout: 5), app.debugDescription)
        tap(name, app: app)
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (name.value as? String ?? "").count) + "Fresh named passage")
        let enabled = app.switches["passageGoalEnabled"]
        if enabled.value as? String != "1" {
            // SwiftUI exposes the entire form row as the Switch AX frame. Target the visible
            // UISwitch control on its right edge, then require the actual state change.
            XCTAssertTrue(enabled.exists && enabled.isHittable, app.debugDescription)
            enabled.coordinate(withNormalizedOffset: .init(dx: 0.95, dy: 0.5)).tap()
        }
        let goalEnabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "1"), object: enabled)
        XCTAssertEqual(XCTWaiter.wait(for: [goalEnabled], timeout: 5), .completed, app.debugDescription)
        let tempo = app.textFields["passageGoalTempoField"]
        tap(tempo, app: app)
        tempo.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (tempo.value as? String ?? "").count) + "112.5")
        tap(app.buttons["savePassageName"], app: app)
        XCTAssertTrue(app.otherElements["practiceArmPanel"].staticTexts["Fresh named passage"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(app.buttons["coldGrade_missed"].exists)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        shot("fresh13-direct-name-decimal-goal-saved", app: app)
        tap(app.buttons["closeScore"], app: app)
        app.terminate(); openScore(app, reset: false)
        tap(app.buttons["passages"], app: app)
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "savedPassage_", "Fresh named passage")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 8), app.debugDescription); tap(row, app: app)
        tap(app.buttons["armEditPassage"], app: app)
        XCTAssertEqual(app.switches["passageGoalEnabled"].value as? String, "1")
        XCTAssertEqual(app.textFields["passageGoalTempoField"].value as? String, "112.5")
        shot("fresh13-direct-name-decimal-goal-reopened", app: app)
    }

    @MainActor func testFirstAttemptClickStateAndMissedFutureToughQueueSurviveRelaunch() {
        let app = XCUIApplication(); openScore(app); armPassage(app)
        let click = app.buttons["armMetronome"]
        XCTAssertEqual(click.value as? String, "Off")
        tap(click, app: app)
        let on = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "On"), object: click)
        XCTAssertEqual(XCTWaiter.wait(for: [on], timeout: 5), .completed, app.debugDescription)
        XCTAssertTrue(app.buttons["coldGrade_missed"].exists, "Preview must leave the first attempt ungraded")
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        shot("fresh13-first-attempt-click-on-before-grade", app: app)
        tap(click, app: app)
        let off = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Off"), object: click)
        XCTAssertEqual(XCTWaiter.wait(for: [off], timeout: 5), .completed, app.debugDescription)
        tap(app.buttons["coldGrade_missed"], app: app)
        XCTAssertTrue(app.buttons["stopSet"].waitForExistence(timeout: 8), app.debugDescription)
        tap(app.buttons["stopSet"], app: app)
        tap(app.buttons["closeScore"], app: app)
        app.terminate(); app.launchArguments = ["--uitesting"]; app.launch()
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.tap() }
        let today = app.tabBars.buttons["Today"]
        if today.exists, today.isHittable { tap(today, app: app) }
        let all = app.buttons["allPassageReviews"]
        for _ in 0..<8 where !all.isHittable { app.swipeUp() }
        tap(all, app: app)
        XCTAssertTrue(app.navigationBars["Passage reviews"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(app.staticTexts["Tough passages · Upcoming"].exists, app.debugDescription)
        XCTAssertTrue(app.staticTexts["Evenness and pulse"].exists, app.debugDescription)
        XCTAssertTrue(app.staticTexts["Your last first attempt: Missed."].exists, app.debugDescription)
        let priority = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "reviewPriority_")).firstMatch
        XCTAssertEqual(priority.label, "Tough passage", "A Missed report due tomorrow must not be marked overdue or URGENT today")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "URGENT ·")).firstMatch.exists)
        shot("fresh13-missed-upcoming-tough-review-reopened", app: app)
    }
}
