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

    private func finiteFrame(_ frame: CGRect) -> Bool {
        !frame.isNull && !frame.isInfinite && frame.width > 0 && frame.height > 0 &&
            [frame.minX, frame.minY, frame.maxX, frame.maxY].allSatisfy { $0.isFinite }
    }

    @discardableResult
    @MainActor private func reveal(_ element: XCUIElement, app: XCUIApplication, centerInForm: Bool = false) -> CGRect? {
        // iPad presents this sheet inside the screen. Its clipped Form viewport, rather than
        // the app's full-height window, determines both visibility and scroll direction.
        var searchDown = true
        for attempt in 0..<14 {
            let form = app.collectionViews["metronomeSettingsForm"]
            guard form.exists else {
                XCTFail("The presented metronome form is missing. " + app.debugDescription); return nil
            }
            let formFrame = form.frame
            guard finiteFrame(formFrame), finiteFrame(app.frame) else {
                capture("metronome-form-invalid-geometry", app: app)
                XCTFail("The presented form has invalid geometry. " + app.debugDescription); return nil
            }
            let viewport = formFrame.intersection(app.frame).insetBy(dx: 4, dy: 10)
            if element.exists {
                // Read a concrete rectangle once. XCTest can disagree about Menu's automation
                // type on a later coordinate refetch even when this snapshot is valid.
                let frame = element.frame
                if finiteFrame(frame) {
                    // Keep the acceptable band wider than one 34% scroll step, avoiding an
                    // oscillation across its edges when the row starts near the bottom.
                    let centered = !centerInForm || (frame.midY >= viewport.minY + viewport.height * 0.30 &&
                                                    frame.midY <= viewport.minY + viewport.height * 0.70)
                    if viewport.contains(frame) && centered && element.isHittable { return frame }
                    if centerInForm { searchDown = frame.midY > viewport.midY }
                    else if frame.minY < viewport.minY { searchDown = false }
                    else if frame.maxY > viewport.maxY { searchDown = true }
                }
            } else if attempt == 7 {
                searchDown.toggle()
            }
            let start = form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: searchDown ? 0.72 : 0.28))
            let end = form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: searchDown ? 0.38 : 0.62))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        capture("metronome-control-unreachable", app: app)
        XCTFail("The metronome control is outside its form or has no finite hittable frame. " + app.debugDescription)
        return nil
    }

    @MainActor private func tapSavedFrame(_ frame: CGRect, app: XCUIApplication) {
        let window = app.frame
        guard finiteFrame(frame), finiteFrame(window), window.contains(frame) else {
            XCTFail("The saved control rectangle is not a finite visible target")
            return
        }
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: frame.midX - window.minX, dy: frame.midY - window.minY)).tap()
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
        XCUIDevice.shared.orientation = .portrait
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
        let presets = app.descendants(matching: .any).matching(identifier: "meterPresets").firstMatch
        // Give the native popup space around its anchor instead of opening it from the
        // Form's final visible row, where its menu may be clipped during presentation.
        guard let presetFrame = reveal(presets, app: app, centerInForm: true) else { return }
        // Anchor to the application coordinate space using the verified rectangle above. A
        // coordinate attached to the Menu node itself triggers XCTest's inconsistent type/frame
        // resolution during event synthesis and can turn a valid rectangle into an infinite point.
        capture("metronome-meter-control-before-tap", app: app)
        tapSavedFrame(presetFrame, app: app)
        let compoundPreset = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "6/8 · dotted-quarter pulse")).firstMatch
        if !compoundPreset.waitForExistence(timeout: 5) {
            capture("metronome-meter-menu-missing", app: app)
            XCTFail("Common meters did not expose the 6/8 preset. " + app.debugDescription)
            return
        }
        let presetReady = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: compoundPreset)
        XCTAssertEqual(XCTWaiter.wait(for: [presetReady], timeout: 5), .completed,
                       "The visible native meter menu must expose a tappable 6/8 option.\n" + app.debugDescription)
        compoundPreset.tap()
        let compound = app.switches["compoundPulse"]
        reveal(compound, app: app)
        XCTAssertTrue(compound.exists, app.debugDescription)
        if compound.value as? String != "1" { compound.press(forDuration: 0.15) }
        capture("metronome-compound-meter-native-phone", app: app)
        let countIn = app.buttons["countInBars"]
        reveal(countIn, app: app); countIn.tap()
        let oneBar = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "1 bar")).firstMatch
        XCTAssertTrue(oneBar.waitForExistence(timeout: 5) && oneBar.isHittable, app.debugDescription)
        oneBar.tap()
        let locked = app.switches["keepMetronomeRunning"]
        reveal(locked, app: app)
        XCTAssertTrue(locked.isEnabled && locked.isHittable, app.debugDescription)
        if locked.value as? String != "1" {
            // SwiftUI exposes the whole label row as a Switch. Its center can fall outside
            // UIKit's trailing toggle, so use the nested native switch's verified bounds.
            let nativeSwitch = locked.switches.firstMatch
            XCTAssertTrue(nativeSwitch.waitForExistence(timeout: 5), app.debugDescription)
            var previousFrame = CGRect.zero
            var lastMovement = Date.now
            let stable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard nativeSwitch.exists else { return false }
                let frame = nativeSwitch.frame
                guard self.finiteFrame(frame), locked.frame.contains(frame),
                      app.frame.contains(frame), nativeSwitch.isHittable else { return false }
                if frame != previousFrame { previousFrame = frame; lastMovement = .now; return false }
                return Date.now.timeIntervalSince(lastMovement) >= 0.4
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [stable], timeout: 8), .completed,
                           "The native toggle must settle after the count-in menu relayout.\n" + app.debugDescription)
            nativeSwitch.tap()
        }
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "1"), object: locked)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 5), .completed,
                       "Keep click when locked must actually be enabled before testing background playback.\n" + app.debugDescription)
        reveal(toggle, app: app)
        XCTAssertEqual(toggle.label, "Stop", "Playback must still be running before leaving the metronome")
        capture("metronome-count-in-lock-native-phone", app: app)
        app.buttons["Done"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.staticTexts["1 of 5 clean"].exists, "Settings edits must keep the saved practice repetition")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["openMetronome"].waitForExistence(timeout: 10), app.debugDescription)
        openMetronome(app)
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), app.debugDescription)
        reveal(toggle, app: app)
        XCTAssertEqual(toggle.label, "Stop", "Keeping the click when locked also survives the practice set's background pause")
        capture("metronome-background-continuation-native-phone", app: app)
        toggle.press(forDuration: 0.15)

    }
    @MainActor func testLargestTextKeepsMaximumTempoAndEveryNudgeReadable() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
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
