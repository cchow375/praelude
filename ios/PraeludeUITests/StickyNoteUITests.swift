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

    @MainActor private func enterAnnotation(_ app: XCUIApplication) {
        let annotate = app.buttons["annotateScore"]
        var previous = CGRect.zero
        var lastChange = Date.now
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard annotate.exists else { return false }
            let current = annotate.frame
            guard current.width > 1, current.height > 1, app.frame.contains(current), annotate.isHittable else { return false }
            if current != previous { previous = current; lastChange = .now; return false }
            return Date.now.timeIntervalSince(lastChange) >= 0.4
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 8), .completed, app.debugDescription)
        shot("fresh-annotation-before-single-tap")
        let before = XCTAttachment(string: app.debugDescription)
        before.name = "fresh-annotation-before-single-tap-hierarchy"; before.lifetime = .keepAlways; add(before)
        annotate.tap()
        shot("fresh-annotation-after-single-tap")
        let after = XCTAttachment(string: app.debugDescription)
        after.name = "fresh-annotation-after-single-tap-hierarchy"; after.lifetime = .keepAlways; add(after)
        XCTAssertTrue(app.buttons["annotationTool_text"].waitForExistence(timeout: 8), app.debugDescription)
    }

    @MainActor private func revealNoteControl(_ element: XCUIElement, app: XCUIApplication) {
        let form = app.collectionViews.firstMatch
        let navigation = app.navigationBars["Note"]
        XCTAssertTrue(form.waitForExistence(timeout: 5) && navigation.exists, app.debugDescription)
        func viewport() -> CGRect {
            var visible = form.frame.intersection(app.frame)
            let scrollBar = form.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "Vertical scroll bar")).firstMatch
            let top = max(visible.minY, navigation.frame.maxY)
            let bottom = scrollBar.exists ? min(visible.maxY, scrollBar.frame.maxY) : visible.maxY
            visible = CGRect(x: visible.minX, y: top, width: visible.width, height: max(0, bottom - top))
            let keyboard = app.keyboards.firstMatch
            if keyboard.exists, visible.intersects(keyboard.frame) {
                visible.size.height = max(0, keyboard.frame.minY - visible.minY)
            }
            return visible.insetBy(dx: 8, dy: 8)
        }
        for _ in 0..<40 {
            let visible = viewport()
            let frame = element.exists ? element.frame : .zero
            let hasFrame = frame.width > 1 && frame.height > 1
            if hasFrame, visible.contains(frame), element.isHittable { return }
            guard visible.width > 1, visible.height > 24 else {
                XCTFail("The note sheet has no usable scrolling viewport.\n" + app.debugDescription)
                return
            }
            // Full app flicks can pass a virtualized Form row and continue away from it.
            // Move only this sheet, reverse when the target is above it, and stop momentum.
            let downward = hasFrame && frame.minY < visible.minY
            let gap = hasFrame ? (downward ? visible.minY - frame.minY : frame.maxY - visible.maxY) : 72
            let distance = min(96, max(24, gap + 12), visible.height * 0.35)
            let base = app.coordinate(withNormalizedOffset: .zero)
            let start = base.withOffset(.init(dx: visible.midX, dy: visible.midY + (downward ? -distance / 2 : distance / 2)))
            let end = base.withOffset(.init(dx: visible.midX, dy: visible.midY + (downward ? distance / 2 : -distance / 2)))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(element.exists && viewport().contains(element.frame) && element.isHittable,
                      "The note control must be fully visible and hittable after bounded sheet scrolling.\n" + app.debugDescription)
    }

    @MainActor private func requireLandscape(_ app: XCUIApplication) {
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.frame.width > app.frame.height }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 8), .completed,
                       "This case requires actual landscape geometry, not just an orientation request.")
    }

    @MainActor func testOrdinaryScoreNoteResizeAndFormattingPersist() { exercise(large: false) }
    @MainActor func testOversizedScoreNoteResizeAndFormattingPersist() { exercise(large: true) }

    @MainActor func testPhoneFormattingReachableInShortLandscape() {
        let app = XCUIApplication(); openScore(app, large: true)
        enterAnnotation(app)
        app.buttons["annotationTool_text"].tap()
        app.buttons["toggleAnnotationPalette"].tap()
        app.otherElements["scorePDF"].textViews.firstMatch
            .coordinate(withNormalizedOffset: .init(dx: 0.38, dy: 0.45)).tap()
        let editor = app.textViews["textAnnotationEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 8))
        editor.tap(); editor.typeText("Keep the pulse steady.")
        let formatting = app.buttons["noteFormatting"]
        revealNoteControl(formatting, app: app)
        XCTAssertTrue(formatting.isHittable)
        formatting.tap()
        let expanded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Expanded"), object: formatting)
        XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 5), .completed)
        let increase = app.buttons["increaseNoteTextSize"]
        revealNoteControl(increase, app: app)
        XCTAssertTrue(increase.isHittable); increase.tap()
        shot("build12-phone-portrait-formatting")
        XCUIDevice.shared.orientation = .landscapeLeft
        requireLandscape(app)
        let bold = app.buttons["textNoteBold"]
        revealNoteControl(bold, app: app)
        XCTAssertTrue(bold.isHittable); bold.tap()
        XCTAssertEqual(bold.value as? String, "On")
        XCTAssertTrue(app.buttons["saveTextAnnotation"].isHittable)
        XCTAssertTrue(app.buttons["Cancel"].isHittable)
        shot("build12-phone-short-landscape-formatting")
        app.buttons["saveTextAnnotation"].tap()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !editor.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 5), .completed)
    }

    @MainActor private func exercise(large: Bool) {
        let app = XCUIApplication(); openScore(app, large: large)
        enterAnnotation(app)
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
        shot("build12-\(large ? "large" : "ordinary")-note-selected")
        let corner = note.coordinate(withNormalizedOffset: .init(dx: 1, dy: 1))
        corner.press(forDuration: 0.15, thenDragTo: corner.withOffset(CGVector(dx: 30, dy: 50)))
        let resized = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in note.exists && note.frame.height > original.height + 25 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [resized], timeout: 5), .completed, app.debugDescription)
        let savedSize = note.frame.size
        shot("build12-\(large ? "large" : "ordinary")-note-resized")
        note.doubleTap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        // Formatting controls are below the text, inside the scrolling note sheet.
        let formatting = app.buttons["noteFormatting"]
        revealNoteControl(formatting, app: app)
        XCTAssertTrue(formatting.isHittable, app.debugDescription)
        formatting.tap()
        let expanded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Expanded"), object: formatting)
        XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 5), .completed, "The full formatting row must respond on the first tap")
        let increase = app.buttons["increaseNoteTextSize"]
        revealNoteControl(increase, app: app)
        XCTAssertTrue(increase.isHittable, app.debugDescription)
        increase.tap(); increase.tap()
        XCTAssertEqual(app.staticTexts["textNoteFontSize"].value as? String, "24 points", "Text size must update before saving")
        let bold = app.buttons["textNoteBold"]
        revealNoteControl(bold, app: app)
        XCTAssertTrue(bold.isHittable, app.debugDescription)
        bold.tap()
        XCTAssertEqual(bold.value as? String, "On")
        let transparent = app.buttons["textNoteTransparentBackground"]
        revealNoteControl(transparent, app: app)
        XCTAssertTrue(transparent.isHittable, "Background controls must remain reachable below text formatting")
        let yellow = app.buttons["textNoteYellowBackground"]
        XCTAssertTrue(yellow.isHittable, "Yellow paper remains a separate, reachable background choice")
        transparent.tap()
        XCTAssertEqual(transparent.value as? String, "On")
        XCTAssertEqual(yellow.value as? String, "Off", "Choosing transparency must not also fire the yellow-paper action")
        yellow.tap()
        XCTAssertEqual(yellow.value as? String, "On")
        XCTAssertEqual(transparent.value as? String, "Off", "Choosing yellow paper must restore an opaque background")
        transparent.tap()
        XCTAssertEqual(transparent.value as? String, "On")
        XCTAssertEqual(yellow.value as? String, "Off")
        shot("build12-\(large ? "large" : "ordinary")-note-transparent-formatting")
        app.buttons["saveTextAnnotation"].tap()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !editor.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 5), .completed, "Save must commit and dismiss the editor.\n\(app.debugDescription)")
        shot("build12-\(large ? "large" : "ordinary")-transparent-note-resized")
        XCTAssertTrue(app.buttons["closeScore"].isHittable)
        app.buttons["closeScore"].tap()
        app.terminate(); openScore(app, large: large, reset: false)
        XCTAssertTrue(note.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(note.frame.width, savedSize.width, accuracy: 2)
        XCTAssertEqual(note.frame.height, savedSize.height, accuracy: 2)
        shot("build12-\(large ? "large" : "ordinary")-transparent-note-relaunched")
        note.doubleTap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertEqual(editor.value as? String, "Listen to the bass. Keep the pulse steady.")
        revealNoteControl(formatting, app: app)
        formatting.tap()
        let size = app.staticTexts["textNoteFontSize"]
        revealNoteControl(size, app: app)
        XCTAssertEqual(size.value as? String, "24 points", "Saved text size must survive relaunch.\n\(app.debugDescription)")
        revealNoteControl(bold, app: app)
        XCTAssertEqual(bold.value as? String, "On", "Saved emphasis must survive relaunch")
        revealNoteControl(transparent, app: app)
        XCTAssertTrue(transparent.isHittable, app.debugDescription)
        XCTAssertEqual(transparent.value as? String, "On", "Transparent background must survive save and relaunch")
        XCTAssertEqual(yellow.value as? String, "Off")
        shot("build12-\(large ? "large" : "ordinary")-transparent-background-reopened")
        if app.frame.width < 600 {
            XCUIDevice.shared.orientation = .landscapeLeft
            requireLandscape(app)
            XCTAssertTrue(app.buttons["saveTextAnnotation"].isHittable)
            revealNoteControl(bold, app: app)
            XCTAssertTrue(bold.isHittable, "Formatting must remain reachable in short landscape")
            shot("build12-phone-short-landscape-formatting")
        }
        app.buttons["Cancel"].tap()
    }
}
