import XCTest
import UIKit

/// Real touches against the same score renderer at ordinary and oversized PDF coordinates.
final class StickyNoteUITests: XCTestCase {
    @MainActor private func openScore(_ app: XCUIApplication, large: Bool, reset: Bool = true) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--uitesting"] + (reset ? ["--reset", "--seed"] + (large ? ["--seed-large-page"] : []) : [])
        app.launch()
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.tap() }
        let pieces = app.tabBars.buttons["Pieces"]
        if pieces.exists, pieces.isHittable { pieces.tap() }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Practice study", "4 pages")).firstMatch
        for _ in 0..<6 where !piece.isHittable { app.swipeUp() }
        XCTAssertTrue(piece.waitForExistence(timeout: 8), app.debugDescription)
        piece.tap()
        XCTAssertTrue(app.buttons["annotateScore"].waitForExistence(timeout: 8), app.debugDescription)
    }

    @MainActor private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    @MainActor func testOrdinaryScoreNoteResizeAndFormattingPersist() { exercise(large: false) }
    @MainActor func testOversizedScoreNoteResizeAndFormattingPersist() { exercise(large: true) }

    @MainActor func testPhoneFormattingReachableInShortLandscape() {
        let app = XCUIApplication(); openScore(app, large: true)
        app.buttons["annotateScore"].tap()
        app.buttons["annotationTool_text"].tap()
        app.buttons["toggleAnnotationPalette"].tap()
        app.otherElements["scorePDF"].textViews.firstMatch
            .coordinate(withNormalizedOffset: .init(dx: 0.38, dy: 0.45)).tap()
        let editor = app.textViews["textAnnotationEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 8))
        editor.tap(); editor.typeText("Keep the pulse steady.")
        let formatting = app.buttons["noteFormatting"]
        for _ in 0..<5 where !formatting.isHittable { app.swipeUp() }
        XCTAssertTrue(formatting.isHittable)
        formatting.tap()
        let expanded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Expanded"), object: formatting)
        XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 5), .completed)
        let increase = app.buttons["increaseNoteTextSize"]
        for _ in 0..<5 where !increase.isHittable { app.swipeUp() }
        XCTAssertTrue(increase.isHittable); increase.tap()
        shot("build11-phone-portrait-formatting")
        XCUIDevice.shared.orientation = .landscapeLeft
        let bold = app.buttons["textNoteBold"]
        for _ in 0..<5 where !bold.isHittable { app.swipeUp() }
        XCTAssertTrue(bold.isHittable); bold.tap()
        XCTAssertEqual(bold.value as? String, "On")
        XCTAssertTrue(app.buttons["saveTextAnnotation"].isHittable)
        XCTAssertTrue(app.buttons["Cancel"].isHittable)
        shot("build11-phone-short-landscape-formatting")
        app.buttons["saveTextAnnotation"].tap()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !editor.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 5), .completed)
    }

    @MainActor private func exercise(large: Bool) {
        let app = XCUIApplication(); openScore(app, large: large)
        app.buttons["annotateScore"].tap()
        app.buttons["annotationTool_text"].tap()
        app.buttons["toggleAnnotationPalette"].tap()
        let page = app.otherElements["scorePDF"].textViews.firstMatch
        page.coordinate(withNormalizedOffset: .init(dx: 0.38, dy: 0.45)).tap()
        let editor = app.textViews["textAnnotationEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 8), app.debugDescription)
        editor.tap(); editor.typeText("Listen to the bass. Keep the pulse steady.")
        app.buttons["saveTextAnnotation"].tap()
        XCTAssertTrue(app.buttons["finishScoreMarkup"].waitForExistence(timeout: 5))
        app.buttons["finishScoreMarkup"].tap()
        let note = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "scoreNote_", "Listen to the bass")).firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 5), app.debugDescription)
        let original = note.frame
        XCTAssertGreaterThan(original.width, 180); XCTAssertGreaterThan(original.height, 70)
        note.tap()
        XCTAssertTrue(app.buttons["editScoreNote"].waitForExistence(timeout: 5), "A single tap must reveal readable text and editing controls")
        shot("build11-\(large ? "large" : "ordinary")-note-selected")
        let corner = note.coordinate(withNormalizedOffset: .init(dx: 1, dy: 1))
        corner.press(forDuration: 0.15, thenDragTo: corner.withOffset(CGVector(dx: 30, dy: 50)))
        let resized = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in note.exists && note.frame.height > original.height + 25 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [resized], timeout: 5), .completed, app.debugDescription)
        let savedSize = note.frame.size
        shot("build11-\(large ? "large" : "ordinary")-note-resized")
        note.doubleTap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        // Formatting controls are below the text, inside the scrolling note sheet.
        let formatting = app.buttons["noteFormatting"]
        for _ in 0..<5 where !formatting.isHittable { app.swipeUp() }
        XCTAssertTrue(formatting.isHittable, app.debugDescription)
        formatting.tap()
        let expanded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Expanded"), object: formatting)
        XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 5), .completed, "The full formatting row must respond on the first tap")
        let increase = app.buttons["increaseNoteTextSize"]
        for _ in 0..<5 where !increase.isHittable { app.swipeUp() }
        XCTAssertTrue(increase.isHittable, app.debugDescription)
        increase.tap(); increase.tap()
        XCTAssertEqual(app.staticTexts["textNoteFontSize"].value as? String, "24 points", "Text size must update before saving")
        let bold = app.buttons["textNoteBold"]
        for _ in 0..<5 where !bold.isHittable { app.swipeUp() }
        XCTAssertTrue(bold.isHittable, app.debugDescription)
        bold.tap()
        XCTAssertEqual(bold.value as? String, "On")
        shot("build11-\(large ? "large" : "ordinary")-note-formatting")
        app.buttons["saveTextAnnotation"].tap()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !editor.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 5), .completed, "Save must commit and dismiss the editor.\n\(app.debugDescription)")
        XCTAssertTrue(app.buttons["closeScore"].isHittable)
        app.buttons["closeScore"].tap()
        app.terminate(); openScore(app, large: large, reset: false)
        XCTAssertTrue(note.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(note.frame.width, savedSize.width, accuracy: 2)
        XCTAssertEqual(note.frame.height, savedSize.height, accuracy: 2)
        note.doubleTap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertEqual(editor.value as? String, "Listen to the bass. Keep the pulse steady.")
        for _ in 0..<5 where !formatting.isHittable { app.swipeUp() }
        formatting.tap()
        let size = app.staticTexts["textNoteFontSize"]
        for _ in 0..<4 where !size.isHittable { app.swipeUp() }
        XCTAssertEqual(size.value as? String, "24 points", "Saved text size must survive relaunch.\n\(app.debugDescription)")
        for _ in 0..<4 where !bold.isHittable { app.swipeUp() }
        XCTAssertEqual(bold.value as? String, "On", "Saved emphasis must survive relaunch")
        if app.frame.width < 600 {
            XCUIDevice.shared.orientation = .landscapeLeft
            XCTAssertTrue(app.buttons["saveTextAnnotation"].isHittable)
            for _ in 0..<4 where !bold.isHittable { app.swipeUp() }
            XCTAssertTrue(bold.isHittable, "Formatting must remain reachable in short landscape")
            shot("build11-phone-short-landscape-formatting")
        }
        app.buttons["Cancel"].tap()
    }
}
