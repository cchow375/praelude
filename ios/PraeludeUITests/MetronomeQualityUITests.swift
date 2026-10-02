import XCTest

/// Exercises the real native controls with a disposable library. Audio timing is separately
/// checked in the sample domain; screenshots are not proof of loudness or a hardware route.
final class MetronomeQualityUITests: XCTestCase {
    @MainActor private func openScore(_ app: XCUIApplication) {
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Practice study")).firstMatch
        _ = piece.waitForExistence(timeout: 3)
        for _ in 0..<8 where !piece.exists || !piece.isHittable { app.swipeUp() }
        XCTAssertTrue(piece.waitForExistence(timeout: 10), app.debugDescription)
        piece.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 10), app.debugDescription)
    }

    @MainActor private func reveal(_ element: XCUIElement, app: XCUIApplication) {
        for _ in 0..<10 {
            if element.exists && element.isHittable && element.frame.minY >= app.frame.minY + 60 && element.frame.maxY <= app.frame.maxY - 35 { return }
            // The covered Today/Pieces list remains in the AX tree under this sheet.
            let form = app.collectionViews.allElementsBoundByIndex.first { $0.frame.minY > 120 }!
            if element.exists && element.frame.minY < app.frame.minY + 60 { form.swipeDown() }
            else { form.swipeUp() }
        }
        XCTAssertTrue(element.exists && element.isHittable, app.debugDescription)
    }

    @MainActor private func openMetronome(_ app: XCUIApplication) {
        let button = app.buttons["openMetronome"]
        XCTAssertTrue(button.waitForExistence(timeout: 10) && button.isHittable, app.debugDescription)
        button.tap()
        XCTAssertTrue(app.navigationBars["Metronome"].waitForExistence(timeout: 10), app.debugDescription)
    }

    @MainActor private func presentedTempo(_ app: XCUIApplication) -> XCUIElement {
        // Select the exposed native text rather than a covered HUD or an untyped descendant.
        let values = app.staticTexts.matching(identifier: "tempoDialValue").allElementsBoundByIndex
        return values.first { $0.isHittable }!
    }

    @MainActor private func exposedButton(_ name: String, app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(identifier: name).allElementsBoundByIndex.first { $0.isHittable }!
    }

    @MainActor private func capture(_ name: String, app: XCUIApplication) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-accessibility"; tree.lifetime = .keepAlways; add(tree)
    }

    @MainActor func testActiveTempoEditsAndMetronomeCustomizationAreReachable() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed"]
        app.launch()
        openScore(app)
        app.buttons["More options"].press(forDuration: 0.15)
        let start = app.buttons["confirmStartSet"]
        XCTAssertTrue(start.waitForExistence(timeout: 10), app.debugDescription)
        start.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["armStartSet"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["verdict_clean"].press(forDuration: 0.15)
        openMetronome(app)
        let toggle = app.buttons["toggleMetronome"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), app.debugDescription)
        let value = presentedTempo(app)
        XCTAssertTrue(value.exists, app.debugDescription)
        let before = Int((value.value as? String ?? "").prefix { $0.isNumber })!
        let increase = exposedButton("Increase tempo by 1", app: app)
        XCTAssertTrue(increase.isEnabled && increase.isHittable, app.debugDescription)
        increase.press(forDuration: 0.15)
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "\(before + 1) beats per minute"), object: value)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed, app.debugDescription)
        capture("metronome-active-tempo-native-phone", app: app)
        toggle.press(forDuration: 0.15)
        XCTAssertEqual(toggle.label, "Stop")
        increase.press(forDuration: 0.15)
        XCTAssertEqual(toggle.label, "Stop", "A live tempo edit keeps playback running")
        let presets = app.buttons["meterPresets"]
        reveal(presets, app: app); presets.press(forDuration: 0.15)
        app.buttons["6/8 · dotted-quarter pulse"].press(forDuration: 0.15)
        let compound = app.switches["compoundPulse"]
        reveal(compound, app: app)
        XCTAssertTrue(compound.exists, app.debugDescription)
        if compound.value as? String != "1" { compound.press(forDuration: 0.15) }
        capture("metronome-compound-meter-native-phone", app: app)
        let countIn = app.buttons["countInBars"]
        reveal(countIn, app: app); countIn.press(forDuration: 0.15)
        app.buttons["1 bar"].press(forDuration: 0.15)
        let locked = app.switches["keepMetronomeRunning"]
        reveal(locked, app: app)
        XCTAssertTrue(locked.isEnabled && locked.isHittable, app.debugDescription)
        if locked.value as? String != "1" { locked.press(forDuration: 0.15) }
        capture("metronome-count-in-lock-native-phone", app: app)
        app.buttons["Done"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.staticTexts["1 of 5 clean"].exists, "Settings edits must keep the saved practice repetition")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["openMetronome"].waitForExistence(timeout: 10), app.debugDescription)
        openMetronome(app)
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(toggle.label, "Stop", "Keeping the click when locked also survives the practice set's background pause")
        capture("metronome-background-continuation-native-phone", app: app)
        toggle.press(forDuration: 0.15)

    }
    @MainActor func testLargestTextKeepsMaximumTempoAndEveryNudgeReadable() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--audit-max-tempo", "--audit-dark", "--audit-accessibility",
                               "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        let pieces = app.tabBars.buttons["Pieces"]
        if pieces.waitForExistence(timeout: 5) { pieces.press(forDuration: 0.15) }
        openScore(app)
        openMetronome(app)
        XCTAssertTrue(app.buttons["toggleMetronome"].waitForExistence(timeout: 10), app.debugDescription)
        let value = presentedTempo(app)
        XCTAssertEqual(value.value as? String, "300 beats per minute")
        XCTAssertGreaterThan(value.frame.width, 0)
        XCTAssertGreaterThanOrEqual(value.frame.minX, app.frame.minX)
        XCTAssertLessThanOrEqual(value.frame.maxX, app.frame.maxX)
        for name in ["Decrease tempo by 5", "Decrease tempo by 1", "Increase tempo by 1", "Increase tempo by 5", "Tap tempo"] {
            let button = exposedButton(name, app: app)
            reveal(button, app: app)
            XCTAssertTrue(button.isHittable && button.isEnabled, app.debugDescription)
            XCTAssertGreaterThanOrEqual(button.frame.width, 44)
            XCTAssertGreaterThanOrEqual(button.frame.minX, app.frame.minX)
            XCTAssertLessThanOrEqual(button.frame.maxX, app.frame.maxX)
        }
        capture("metronome-300-largest-text-dark-opaque-fallback", app: app)
        exposedButton("Decrease tempo by 1", app: app).tap()
        XCTAssertEqual(value.value as? String, "299 beats per minute")
    }

}
