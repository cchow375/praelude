import XCTest
import UIKit

final class MobileMarkupUITests: XCTestCase {
    @MainActor private func openScore(_ app: XCUIApplication, reset: Bool = true, largeText: Bool = false) {
        continueAfterFailure = false
        app.launchArguments = ["--uitesting"] + (reset ? ["--reset", "--seed"] : [])
        if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        app.launch()
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.press(forDuration: 0.15) }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Practice study", "4 pages")).firstMatch
        // Large Text can place the score row outside the List's realized cells.
        for _ in 0..<6 {
            if piece.exists, piece.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(piece.waitForExistence(timeout: 5), app.debugDescription)
        settle(piece, app: app)
        piece.tap()
        XCTAssertTrue(app.buttons["drawPassageOnScore"].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertTrue(app.otherElements["scorePDF"].textViews.firstMatch.waitForExistence(timeout: 8))
        settle(app.buttons["drawPassageOnScore"], app: app)
    }
    @MainActor private func settle(_ element: XCUIElement, app: XCUIApplication) {
        var previous = CGRect.zero
        var lastChange = Date.now
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard element.exists else { return false }
            let current = element.frame
            guard current.width > 1, current.height > 1, app.frame.contains(current), element.isHittable else { return false }
            if current != previous { previous = current; lastChange = .now; return false }
            return Date.now.timeIntervalSince(lastChange) >= 0.4
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 8), .completed, app.debugDescription)
    }
    @MainActor private func reveal(_ element: XCUIElement, app: XCUIApplication, towardTop: Bool = false) {
        for _ in 0..<12 {
            let form = app.collectionViews.firstMatch
            var visible = form.exists ? form.frame.intersection(app.frame) : app.frame
            if let bar = app.navigationBars.allElementsBoundByIndex.last(where: { $0.isHittable }) {
                let top = max(visible.minY, bar.frame.maxY + 8)
                visible = CGRect(x: visible.minX, y: top, width: visible.width, height: max(0, visible.maxY - top))
            }
            let frame = element.exists ? element.frame : .zero
            let hasFrame = frame.width > 1 && frame.height > 1
            if hasFrame, visible.insetBy(dx: 0, dy: 8).contains(frame), element.isHittable {
                settle(element, app: app); return
            }
            let down = hasFrame ? frame.minY < visible.minY : towardTop
            let base = app.coordinate(withNormalizedOffset: .zero)
            let firstY = visible.minY + visible.height * (down ? 0.35 : 0.7)
            let lastY = visible.minY + visible.height * (down ? 0.7 : 0.35)
            let first = base.withOffset(.init(dx: visible.midX, dy: firstY))
            let last = base.withOffset(.init(dx: visible.midX, dy: lastY))
            first.press(forDuration: 0.15, thenDragTo: last)
        }
        XCTFail("Control is not reachable: \(element)\n\(app.debugDescription)")
    }
    @MainActor private func drag(_ app: XCUIApplication, page: Int = 1, from: CGVector, to: CGVector) {
        // PDFKit exposes a page text view, not the overlay's UIKit subtree, to accessibility.
        let overlay = app.otherElements["scorePDF"].textViews.firstMatch
        XCTAssertTrue(overlay.waitForExistence(timeout: 8), app.debugDescription)
        overlay.coordinate(withNormalizedOffset: from).press(forDuration: 0.15, thenDragTo: overlay.coordinate(withNormalizedOffset: to))
    }
    @MainActor private func checkCount(_ app: XCUIApplication, _ count: Int) {
        let status = app.staticTexts["markupStatus"]
        let expected = "\(count) \(count == 1 ? "box" : "boxes")"
        let wait = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", expected), object: status)
        shot("box-count-diagnostic")
        XCTAssertEqual(XCTWaiter.wait(for: [wait], timeout: 5), .completed, "PDF: \(app.otherElements["scorePDF"].value ?? "none")\n\(app.debugDescription)")
    }
    @MainActor private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testMultipleVisualBoxesEditAndRelaunch() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["drawPassageOnScore"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["finishScoreMarkup"].waitForExistence(timeout: 5))
        drag(app, from: .init(dx: 0.17, dy: 0.24), to: .init(dx: 0.74, dy: 0.34))
        checkCount(app, 1)
        drag(app, from: .init(dx: 0.17, dy: 0.46), to: .init(dx: 0.74, dy: 0.56))
        checkCount(app, 2)
        shot("11-multiple-light-boxes")
        app.buttons["Next page"].press(forDuration: 0.15)
        drag(app, page: 2, from: .init(dx: 0.17, dy: 0.24), to: .init(dx: 0.74, dy: 0.34))
        checkCount(app, 3)
        app.buttons["removeBox"].press(forDuration: 0.15); checkCount(app, 2)
        app.buttons["undoBox"].press(forDuration: 0.15); checkCount(app, 3)
        app.buttons["finishScoreMarkup"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["startSet"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["passages"].label.contains("Passage"))
        app.buttons["Score options"].press(forDuration: 0.15)
        app.buttons["Edit passage boxes"].press(forDuration: 0.15)
        checkCount(app, 3)
        drag(app, page: 2, from: .init(dx: 0.45, dy: 0.29), to: .init(dx: 0.50, dy: 0.38))
        checkCount(app, 3)
        app.buttons["finishScoreMarkup"].press(forDuration: 0.15)
        app.terminate(); openScore(app, reset: false)
        settle(app.buttons["passages"], app: app)
        app.buttons["passages"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["3 boxes · 2 pages"].waitForExistence(timeout: 8), app.debugDescription)
        shot("12-saved-visual-passage")
    }
    @MainActor func testFingerInkUndoAndRelaunch() {
        let app = XCUIApplication(); openScore(app)
        let annotate = app.buttons["annotateScore"]
        XCTAssertTrue(annotate.waitForExistence(timeout: 8))
        settle(annotate, app: app)
        annotate.press(forDuration: 0.15)
        let toggle = app.switches["fingerDrawing"]
        shot("annotation-entry-diagnostic")
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "PDF: \(app.otherElements["scorePDF"].value ?? "none")\n\(app.debugDescription)")
        toggle.coordinate(withNormalizedOffset: .init(dx: 0.97, dy: 0.5)).press(forDuration: 0.15)
        XCTAssertEqual(toggle.value as? String, "1", "Tap the visible native switch at the trailing edge")
        drag(app, from: .init(dx: 0.24, dy: 0.32), to: .init(dx: 0.67, dy: 0.36))
        let undo = app.buttons["Undo ink"]
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: undo)
        let undoReady = XCTWaiter.wait(for: [enabled], timeout: 8)
        let diagnostic = XCTAttachment(string: "After stroke: \(app.otherElements["scorePDF"].value ?? "missing")")
        diagnostic.name = "stroke-result-geometry"; diagnostic.lifetime = .keepAlways; add(diagnostic)
        XCTAssertEqual(undoReady, .completed, app.debugDescription)
        let liveCanvas = XCTAttachment(string: "Live canvas: \(app.otherElements["scorePDF"].value ?? "missing")")
        liveCanvas.name = "live-ink-geometry"; liveCanvas.lifetime = .keepAlways; add(liveCanvas)
        shot("13-native-ink-tools")
        undo.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Redo ink"].isEnabled)
        app.buttons["Redo ink"].press(forDuration: 0.15)
        settle(app.buttons["finishScoreMarkup"], app: app)
        shot("13b-native-ink-after-redo")
        app.buttons["finishScoreMarkup"].press(forDuration: 0.15)
        app.terminate(); openScore(app, reset: false)
        let pdf = app.otherElements["scorePDF"]
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value CONTAINS %@", "inkPage1=1"), object: pdf)
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 8), .completed, app.debugDescription)
        shot("14-ink-after-relaunch")
    }
    @MainActor func testPracticeFeedbackAndMeterControls() {
        let app = XCUIApplication(); openScore(app)
        let start = app.buttons["startSet"]; settle(start, app: app); start.press(forDuration: 0.15)
        let confirm = app.buttons["confirmStartSet"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 8)); settle(confirm, app: app); confirm.press(forDuration: 0.15)
        let clean = app.buttons["verdict_clean"]
        XCTAssertTrue(clean.waitForExistence(timeout: 8)); settle(clean, app: app); clean.tap()
        XCTAssertTrue(app.staticTexts["1 of 5 clean · 60 BPM"].waitForExistence(timeout: 5), app.debugDescription)
        shot("15-earned-practice-feedback")
        app.buttons["undoRep"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["0 of 5 clean · 60 BPM"].exists)
        let click = app.buttons["openMetronome"]; settle(click, app: app); click.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["toggleMetronome"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.sliders["sliderTempo"].isEnabled, "An active set owns the click tempo")
        app.buttons["toggleMetronome"].press(forDuration: 0.15)
        XCTAssertEqual(app.buttons["toggleMetronome"].label, "Stop")
        shot("16-configured-metronome")
        app.buttons["toggleMetronome"].press(forDuration: 0.15)
        XCTAssertEqual(app.buttons["toggleMetronome"].label, "Start")
        let meter = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Beats per bar")).firstMatch
        reveal(meter, app: app)
        meter.press(forDuration: 0.15)
        app.buttons["7"].press(forDuration: 0.15)
        reveal(app.buttons["Reset accents"], app: app)
        app.buttons["Reset accents"].press(forDuration: 0.15)
        reveal(app.buttons["Beat 7, Beat"], app: app, towardTop: true)
        XCTAssertTrue(app.buttons["Beat 7, Beat"].exists, app.debugDescription)
        reveal(app.buttons["Beat 2, Beat"], app: app, towardTop: true)
        app.buttons["Beat 2, Beat"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Beat 2, Accent"].exists)
        app.buttons["Beat 2, Accent"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Beat 2, Silent"].exists)
        shot("17-custom-meter-accents")
        app.buttons["Done"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 8))
    }

    @MainActor func testMarkupLargestTextPortraitAndLandscape() {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication(); openScore(app, largeText: true)
        app.buttons["drawPassageOnScore"].press(forDuration: 0.15)
        drag(app, from: .init(dx: 0.2, dy: 0.3), to: .init(dx: 0.7, dy: 0.4))
        checkCount(app, 1)
        for (orientation, name) in [(UIDeviceOrientation.portrait, "portrait"), (.landscapeLeft, "landscape")] {
            XCUIDevice.shared.orientation = orientation
            let done = app.buttons["finishScoreMarkup"]
            settle(done, app: app)
            XCTAssertTrue(app.frame.contains(done.frame), app.debugDescription)
            XCTAssertGreaterThanOrEqual(done.frame.height, 44)
            XCTAssertTrue(app.buttons["undoBox"].isHittable)
            XCTAssertTrue(app.buttons["removeBox"].isHittable)
            XCTAssertGreaterThan(app.otherElements["scorePDF"].frame.height, 60, app.debugDescription)
            shot("18-accessible-selection-" + name)
        }
        app.buttons["finishScoreMarkup"].press(forDuration: 0.15)
        app.buttons["annotateScore"].press(forDuration: 0.15)
        XCTAssertTrue(app.switches["fingerDrawing"].waitForExistence(timeout: 8))
        for (orientation, name) in [(UIDeviceOrientation.landscapeLeft, "landscape"), (.portrait, "portrait")] {
            XCUIDevice.shared.orientation = orientation
            settle(app.buttons["finishScoreMarkup"], app: app)
            XCTAssertTrue(app.switches["fingerDrawing"].isHittable)
            XCTAssertTrue(app.frame.contains(app.buttons["finishScoreMarkup"].frame))
            XCTAssertGreaterThan(app.otherElements["scorePDF"].frame.height, 60, app.debugDescription)
            shot("19-accessible-ink-" + name)
        }
        app.buttons["finishScoreMarkup"].press(forDuration: 0.15)
    }

}
