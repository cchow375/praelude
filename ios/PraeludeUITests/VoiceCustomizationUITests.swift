import XCTest

/// Exercises phrase editing and read-only diagnostics in the disposable test library.
/// It never enables a microphone or claims successful speech recognition.
final class VoiceCustomizationUITests: XCTestCase {
    @MainActor private func reveal(_ element: XCUIElement, in app: XCUIApplication, upward: Bool = true) {
        for _ in 0..<8 {
            if element.exists && element.isHittable { break }
            if upward { app.swipeUp() } else { app.swipeDown() }
        }
        XCTAssertTrue(element.waitForExistence(timeout: 5) && element.isHittable, app.debugDescription)
    }

    @MainActor private func replace(_ field: XCUIElement, with text: String, in app: XCUIApplication) {
        let below = field.exists && field.frame.midY > app.frame.midY
        reveal(field, in: app, upward: below)
        field.tap()
        let old = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + text)
    }

    @MainActor private func back(from title: String, in app: XCUIApplication) {
        let bar = app.navigationBars[title]
        XCTAssertTrue(bar.waitForExistence(timeout: 5), app.debugDescription)
        bar.buttons.element(boundBy: 0).tap()
    }

    @MainActor func testScoreVoiceAliasesRejectTempoCollisionRecoverAndExposeDiagnostics() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed"]
        app.launch()
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 1), hideSidebar.isHittable { hideSidebar.tap() }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Practice study")).firstMatch
        reveal(piece, in: app)
        piece.tap()
        let options = app.buttons["Score options"]
        XCTAssertTrue(options.waitForExistence(timeout: 15), app.debugDescription)
        options.tap()
        let voice = app.collectionViews.buttons["Hands-free commands"]
        XCTAssertTrue(voice.waitForExistence(timeout: 5), app.debugDescription)
        voice.tap()
        XCTAssertTrue(app.navigationBars["Hands-free"].waitForExistence(timeout: 10), app.debugDescription)
        let customize = app.buttons["Customize command phrases"]
        reveal(customize, in: app)
        customize.tap()
        let clean = app.buttons["voiceAlias_clean"]
        reveal(clean, in: app, upward: false)
        clean.tap()
        let first = app.textFields["voiceExtraPhrase0"]
        XCTAssertTrue(first.waitForExistence(timeout: 5), app.debugDescription)
        // Preserve any simulator-local customization and restore it through the real editor.
        let original = (0..<3).map { index -> String in
            let field = app.textFields["voiceExtraPhrase\(index)"]
            let value = field.value as? String ?? ""
            return value == field.placeholderValue ? "" : value
        }
        for index in 0..<3 { replace(app.textFields["voiceExtraPhrase\(index)"], with: "", in: app) }
        replace(first, with: "tempo sixty", in: app)
        app.buttons["saveVoiceAliases"].tap()
        let failure = app.staticTexts["voiceAliasError"]
        XCTAssertTrue(failure.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(failure.label.contains("Set tempo"), app.debugDescription)
        XCTAssertTrue(app.navigationBars["Clean"].exists, "Rejected aliases must leave the editor recoverable")
        replace(first, with: "velvet cadence", in: app)
        app.buttons["saveVoiceAliases"].tap()
        XCTAssertTrue(app.navigationBars["Hands-free phrases"].waitForExistence(timeout: 5), app.debugDescription)
        clean.tap()
        XCTAssertTrue(first.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(first.value as? String, "velvet cadence", app.debugDescription)
        for index in 0..<3 { replace(app.textFields["voiceExtraPhrase\(index)"], with: original[index], in: app) }
        app.buttons["saveVoiceAliases"].tap()
        XCTAssertTrue(app.navigationBars["Hands-free phrases"].waitForExistence(timeout: 5), app.debugDescription)
        back(from: "Hands-free phrases", in: app)
        let diagnostics = app.buttons["Microphone & recognition checks"]
        reveal(diagnostics, in: app)
        diagnostics.tap()
        XCTAssertTrue(app.navigationBars["Voice checks"].waitForExistence(timeout: 5), app.debugDescription)
        let refresh = app.buttons["Refresh checks"]
        reveal(refresh, in: app)
        XCTAssertGreaterThanOrEqual(refresh.frame.height, 43.99, app.debugDescription)
        refresh.tap()
        let permissions = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Microphone ", "; speech ")).firstMatch
        XCTAssertTrue(permissions.waitForExistence(timeout: 5), app.debugDescription)
        let recovery = app.buttons["Open permission settings"]
        reveal(recovery, in: app)
        XCTAssertGreaterThanOrEqual(recovery.frame.height, 43.99, app.debugDescription)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "voice-customization-recovery-and-diagnostics"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        back(from: "Voice checks", in: app)
        let enable = app.buttons["enableHandsFree"]
        reveal(enable, in: app, upward: false)
        XCTAssertEqual(enable.label, "Enable hands-free", "Editing phrases or refreshing diagnostics must not activate voice")
        app.navigationBars["Hands-free"].buttons["Done"].tap()
        XCTAssertTrue(options.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["verdict_clean"].exists, "Voice setup must not begin a practice set")
    }
}
