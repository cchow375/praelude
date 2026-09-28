import XCTest

/// Independent native acceptance checks against the real SwiftUI interface and disposable library.
final class VerifierTests: XCTestCase {
    @MainActor private func launch(largeText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed"]
        if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        app.launch()
        return app
    }

    @MainActor private func screenshot(_ name: String, app: XCUIApplication) {
        // Pair native screenshots with the accessibility tree for reproducible review.
        let description = app.debugDescription
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: description)
        tree.name = name + "-accessibility"; tree.lifetime = .keepAlways; add(tree)
    }

    @MainActor private func openScore(_ app: XCUIApplication) {
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 2), hideSidebar.isHittable { hideSidebar.press(forDuration: 0.15) }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Practice study", "4 pages")).firstMatch
        reveal(piece, in: app)
        piece.press(forDuration: 0.15)
        // §10a: the arm panel is already showing with rule defaults filled.
        XCTAssertTrue(app.buttons["confirmStartSet"].waitForExistence(timeout: 10), app.debugDescription)
    }

    @MainActor private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        // SwiftUI may report rows under a safe-area footer as hittable. Scroll those rows
        // fully above the fixed Start button before tapping, just as a person must do.
        for _ in 0..<8 {
            let form = app.collectionViews.allElementsBoundByIndex.last
                ?? app.scrollViews.allElementsBoundByIndex.last
            var visible = form?.frame ?? app.frame
            let start = app.buttons["confirmStartSet"]
            if start.exists && element.exists && element.identifier != "confirmStartSet" {
                visible.size.height = max(0, min(visible.maxY, start.frame.minY - 12) - visible.minY)
            }
            if let keyboard = app.keyboards.allElementsBoundByIndex.first {
                visible.size.height = max(0, min(visible.maxY, keyboard.frame.minY) - visible.minY)
            }
            if element.exists && element.isHittable &&
                (element.identifier == "confirmStartSet" ||
                 (element.frame.minY >= visible.minY && element.frame.maxY <= visible.maxY)) { return }
            if let form {
                if element.exists && element.frame.minY < visible.minY { form.swipeDown() }
                else { form.swipeUp() }
            } else { app.swipeUp() }
        }
        XCTFail("Could not reveal the entire control above fixed overlays: \(element)\n\(app.debugDescription)")
    }

    @MainActor private func openComposer(_ app: XCUIApplication) {
        // The full manual editor is "More options" from the arm panel now, not the default path.
        app.buttons["More options"].press(forDuration: 0.15)
        waitForComposer(app)
    }

    @MainActor private func waitForComposer(_ app: XCUIApplication) {
        XCTAssertTrue(app.navigationBars["Practice set"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.buttons["confirmStartSet"].waitForExistence(timeout: 10), app.debugDescription)
    }

    @MainActor private func waitUntilGone(_ element: XCUIElement, app: XCUIApplication) {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed, app.debugDescription)
    }

    @MainActor private func startFromComposer(_ app: XCUIApplication) {
        waitForComposer(app)
        let start = app.buttons["confirmStartSet"]
        reveal(start, in: app); start.press(forDuration: 0.15)
        waitUntilGone(start, app: app)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10), app.debugDescription)
    }

    @MainActor func testTotalPlaysCountsEveryHumanVerdict() {
        let app = launch(); openScore(app)
        openComposer(app)
        let rules = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Set rules")).firstMatch
        reveal(rules, in: app); rules.press(forDuration: 0.15)
        screenshot("verifier-total-plays-rules", app: app)
        let picker = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Count")).firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 10), app.debugDescription)
        reveal(picker, in: app); picker.press(forDuration: 0.15)
        let total = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Total plays")).firstMatch
        XCTAssertTrue(total.waitForExistence(timeout: 3), app.debugDescription); total.press(forDuration: 0.15)
        screenshot("verifier-total-plays-setup", app: app)
        startFromComposer(app)
        app.buttons["verdict_clean"].press(forDuration: 0.15); app.buttons["verdict_sloppy"].press(forDuration: 0.15); app.buttons["verdict_again"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["3 of 5 plays"].exists, app.debugDescription)
        app.buttons["verdict_again"].press(forDuration: 0.15); app.buttons["verdict_sloppy"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["Set complete"].waitForExistence(timeout: 3), app.debugDescription)
        screenshot("verifier-total-plays-complete", app: app)
    }

    @MainActor func testVariantSetupAndAgainPreserveStageProgress() {
        let app = launch(); openScore(app); openComposer(app)
        let variants = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Variants")).firstMatch
        reveal(variants, in: app); variants.press(forDuration: 0.15)
        XCTAssertTrue(app.navigationBars["Variants"].waitForExistence(timeout: 10))
        let composerDeparted = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: app.buttons["confirmStartSet"])
        XCTAssertEqual(XCTWaiter.wait(for: [composerDeparted], timeout: 10), .completed)
        for name in ["Dotted", "Reverse dotted"] {
            let field = app.textFields["Name"]
            reveal(field, in: app); field.press(forDuration: 0.15); field.typeText(name)
            let add = app.buttons["Add stage"]
            reveal(add, in: app); add.press(forDuration: 0.15)
        }
        screenshot("verifier-variant-editor", app: app)
        app.navigationBars["Variants"].buttons.element(boundBy: 0).press(forDuration: 0.15)
        startFromComposer(app)
        for _ in 0..<3 { app.buttons["verdict_clean"].press(forDuration: 0.15) }
        XCTAssertTrue(app.staticTexts["Reverse dotted"].exists, app.debugDescription)
        XCTAssertFalse(app.staticTexts["Set complete"].exists)
        app.buttons["verdict_clean"].press(forDuration: 0.15); app.buttons["verdict_again"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["1 of 3 clean"].exists, app.debugDescription)
        XCTAssertTrue(app.staticTexts["Reverse dotted"].exists)
        screenshot("verifier-variant-again", app: app)
        app.buttons["verdict_clean"].press(forDuration: 0.15); app.buttons["verdict_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["Set complete"].waitForExistence(timeout: 3), app.debugDescription)
    }

    @MainActor private func revealPracticeControl(_ button: XCUIElement, app: XCUIApplication) {
        let panel = app.scrollViews["accessiblePracticeControls"]
        XCTAssertTrue(panel.waitForExistence(timeout: 10), app.debugDescription)
        for _ in 0..<8 {
            let viewport = panel.frame.intersection(app.frame)
            if button.exists, button.isHittable,
               viewport.insetBy(dx: -1, dy: -1).contains(button.frame) { return }
            if button.exists, button.frame.minY < viewport.minY { panel.swipeDown() }
            else { panel.swipeUp() }
        }
        XCTFail("The complete practice control must be reachable inside its own scroll panel.\n\(app.debugDescription)")
    }

    @MainActor private func verifyAccessiblePracticeControls(_ app: XCUIApplication, orientation: String) {
        let panel = app.scrollViews["accessiblePracticeControls"]
        for (identifier, title) in [("verdict_clean", "Clean"), ("verdict_sloppy", "Sloppy"), ("verdict_again", "Again")] {
            let button = app.buttons[identifier]
            revealPracticeControl(button, app: app)
            XCTAssertTrue(button.isHittable, app.debugDescription)
            XCTAssertGreaterThanOrEqual(button.frame.width, 44)
            XCTAssertGreaterThanOrEqual(button.frame.height, 44)
            XCTAssertEqual(button.label, title, "Every verdict must retain its full accessible name.")
            let text = button.staticTexts[title]
            // Text-only SwiftUI buttons expose a combined label rather than a separate
            // StaticText child. Retain child geometry checks when available; the paired
            // native screenshot is the visual containment evidence for combined labels.
            if text.exists {
                XCTAssertTrue(button.frame.insetBy(dx: -1, dy: -1).contains(text.frame),
                              "The entire verdict label must remain inside its button: \(title).\n\(app.debugDescription)")
            }
            let pdf = app.descendants(matching: .any).matching(identifier: "scorePDF").firstMatch
            XCTAssertTrue(pdf.exists, app.debugDescription)
            if pdf.exists {
                XCTAssertGreaterThan(pdf.frame.height, 0)
                let visibleScoreHeight = min(pdf.frame.maxY, panel.frame.minY) - max(pdf.frame.minY, app.frame.minY)
                XCTAssertGreaterThan(visibleScoreHeight, 0, "The PDF must retain visible space above the practice controls.")
            }
            let suffix = title == "Clean" ? "" : "-" + title.lowercased()
            screenshot("verifier-largest-text-active-" + orientation + suffix, app: app)
        }
    }

    @MainActor func testRotationLargeTextAndMetronomeLock() {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launch(largeText: true)
        screenshot("verifier-largest-text-today-portrait", app: app)
        openScore(app)
        screenshot("verifier-largest-text-score-portrait", app: app)
        openComposer(app)
        XCTAssertTrue(app.textFields["Practice focus"].waitForExistence(timeout: 5))
        screenshot("verifier-largest-text-setup-portrait", app: app)
        startFromComposer(app)
        verifyAccessiblePracticeControls(app, orientation: "portrait")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 3))
        verifyAccessiblePracticeControls(app, orientation: "landscape")
        revealPracticeControl(app.buttons["verdict_clean"], app: app)
        app.buttons["verdict_clean"].press(forDuration: 0.15)
        app.buttons["openMetronome"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["toggleMetronome"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.sliders["Tempo"].isEnabled)
        XCTAssertFalse(app.buttons["Increase tempo"].isEnabled)
        XCTAssertFalse(app.buttons["Tap tempo"].isEnabled)
        screenshot("verifier-largest-text-metronome-landscape", app: app)
        app.buttons["Done"].press(forDuration: 0.15)
        waitUntilGone(app.buttons["toggleMetronome"], app: app)
        revealPracticeControl(app.buttons["verdict_clean"], app: app)
        XCTAssertTrue(app.buttons["verdict_clean"].isHittable)
    }

    @MainActor func testFocusModeRetainsNativePinchZoom() throws {
        let app = launch(); openScore(app)
        app.buttons["Score options"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Focus on score"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["Focus on score"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Exit focus"].waitForExistence(timeout: 5), app.debugDescription)
        screenshot("verifier-focus-before-pinch", app: app)
        let pdf = app.descendants(matching: .any).matching(identifier: "scorePDF").firstMatch
        XCTAssertTrue(pdf.exists, app.debugDescription)
        func nativeScale() throws -> Double {
            let diagnostic = try XCTUnwrap(pdf.value as? String)
            XCTAssertTrue(diagnostic.hasPrefix("scale="), diagnostic)
            let field = try XCTUnwrap(diagnostic.split(separator: ",").first)
            return try XCTUnwrap(Double(field.dropFirst("scale=".count)), diagnostic)
        }
        let originalScale = try nativeScale()
        print("PDF_BEFORE_PINCH \(String(describing: pdf.value))")
        let nativeScroll = pdf.scrollViews.firstMatch
        XCTAssertTrue(nativeScroll.exists, app.debugDescription)
        // XCTest starts its synthesized fingers only a few points apart. A larger
        // requested spread crosses UIKit's recognition threshold before lifting.
        nativeScroll.pinch(withScale: 5, velocity: 1)
        print("PDF_AFTER_PINCH \(String(describing: pdf.value))")
        screenshot("verifier-focus-after-pinch", app: app)
        XCTAssertGreaterThan(try nativeScale(), originalScale * 1.25,
                             "The real PDFKit scale must increase after the delivered pinch.\n\(app.debugDescription)")
        XCTAssertTrue(app.buttons["Page 1 of 4"].exists)
        app.buttons["Exit focus"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["confirmStartSet"].waitForExistence(timeout: 3))
    }
}
