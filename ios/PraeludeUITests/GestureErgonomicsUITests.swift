import XCTest
import UIKit

/// Drive real UIKit recognizers through XCTest touches, including their competition with
/// PDFKit/PencilKit recognizers. These tests use only the disposable synthetic score library.
final class GestureErgonomicsUITests: XCTestCase {
    @MainActor private func openScore(_ app: XCUIApplication, reset: Bool = true) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--uitesting"] + (reset ? ["--reset", "--seed", "--seed-sections"] : [])
        app.launch()
        let pieces = app.tabBars.buttons["Pieces"]
        if pieces.exists, pieces.isHittable {
            pieces.tap()
        } else {
            let show = app.buttons["Show Sidebar"]
            if show.waitForExistence(timeout: 1), show.isHittable { show.tap() }
            let sidebarPieces = app.buttons["Pieces"].firstMatch
            XCTAssertTrue(sidebarPieces.waitForExistence(timeout: 5), app.debugDescription)
            sidebarPieces.tap()
        }
        XCTAssertTrue(app.navigationBars["Pieces"].waitForExistence(timeout: 8), app.debugDescription)
        let hide = app.buttons["Hide Sidebar"]
        if hide.exists, hide.isHittable { hide.tap() }
        let piece = app.buttons.matching(NSPredicate(format: "identifier == %@ AND label CONTAINS %@ AND label CONTAINS %@", "pieceRow", "Practice study", "Praelude test score")).firstMatch
        for _ in 0..<6 where !piece.isHittable { app.swipeUp() }
        XCTAssertTrue(piece.waitForExistence(timeout: 8), app.debugDescription)
        piece.tap()
        XCTAssertTrue(app.buttons["annotateScore"].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertTrue(app.otherElements["scorePDF"].textViews.firstMatch.waitForExistence(timeout: 8))
    }

    @MainActor private func waitForInk(_ count: Int, app: XCUIApplication) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value CONTAINS %@", "inkPage1=\(count)"),
                                             object: app.otherElements["scorePDF"])
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 8), .completed, app.debugDescription)
    }

    @MainActor private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    @MainActor private func finishOrDenyNoteDictation(_ app: XCUIApplication) {
        let dictate = app.buttons["dictateTextAnnotation"]
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let failure = app.staticTexts.matching(NSPredicate(format:
            "label CONTAINS[c] 'permission is off' OR label CONTAINS[c] 'recognition is unavailable' OR label CONTAINS[c] 'recognition is temporarily unavailable' OR label BEGINSWITH 'Voice could not start:'")).firstMatch
        let started = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (dictate.exists && dictate.label.contains("Finish")) || failure.exists ||
                app.alerts.firstMatch.exists || springboard.alerts.firstMatch.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [started], timeout: 8), .completed,
                       "Triple tap must request dictation, not merely open the ordinary double-tap editor.\n\(app.debugDescription)")
        var denied = false
        for _ in 0..<2 {
            let alert = app.alerts.firstMatch.exists ? app.alerts.firstMatch : springboard.alerts.firstMatch
            guard alert.waitForExistence(timeout: 2) else { break }
            let decline = alert.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Don’t Allow", "Don't Allow")).firstMatch
            XCTAssertTrue(decline.exists, "Only deny the actual system permission prompt.\n\(alert.debugDescription)")
            decline.tap(); denied = true
        }
        if denied {
            let permissionFailure = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'permission is off'")).firstMatch
            XCTAssertTrue(permissionFailure.waitForExistence(timeout: 5), app.debugDescription)
        } else if dictate.exists, dictate.label.contains("Finish") {
            dictate.tap()
        }
        let save = app.buttons["saveTextAnnotation"]
        let recoverable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            save.exists && save.isEnabled && dictate.exists && !dictate.label.contains("Finish")
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [recoverable], timeout: 8), .completed,
                       "Denied or unavailable dictation must leave ordinary note editing usable.\n\(app.debugDescription)")
    }

    @MainActor func testActualTwoFingerTapUndoesOneStrokeAndRedoRestoresIt() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["annotateScore"].tap()
        let finger = app.switches["fingerDrawing"]
        XCTAssertTrue(finger.waitForExistence(timeout: 5), app.debugDescription)
        if finger.value as? String != "1" {
            finger.coordinate(withNormalizedOffset: .init(dx: 0.97, dy: 0.5)).tap()
        }
        app.buttons["toggleAnnotationPalette"].tap()
        let page = app.otherElements["scorePDF"].textViews.firstMatch
        let from = page.coordinate(withNormalizedOffset: .init(dx: 0.25, dy: 0.60))
        let to = page.coordinate(withNormalizedOffset: .init(dx: 0.68, dy: 0.63))
        from.press(forDuration: 0.1, thenDragTo: to)
        waitForInk(1, app: app)

        // This calls the two-touch system synthesizer, not the coordinator's undo helper.
        page.tap(withNumberOfTaps: 1, numberOfTouches: 2)
        waitForInk(0, app: app)
        XCTAssertTrue(app.buttons["toggleAnnotationPalette"].exists, "Undo must keep annotation open")
        app.buttons["toggleAnnotationPalette"].tap()
        let redo = app.buttons["Redo ink"]
        XCTAssertTrue(redo.isEnabled, app.debugDescription)
        redo.tap()
        waitForInk(1, app: app)
        shot("build8-real-two-finger-undo-redo")
        // Undo must retain value history after leaving drawing and must not invoke a stale
        // PencilKit tile action when the native canvas is resized by PDF zoom.
        app.buttons["finishScoreMarkup"].tap()
        page.tap(withNumberOfTaps: 1, numberOfTouches: 2)
        waitForInk(0, app: app)
        app.buttons["annotateScore"].tap()
        XCTAssertTrue(redo.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(redo.isEnabled, "Leaving and returning to Draw must preserve Redo")
        redo.tap()
        waitForInk(1, app: app)
        app.buttons["toggleAnnotationPalette"].tap()
        let pdf = app.otherElements["scorePDF"]
        // XCTest starts fingers only a few points apart. Cross the native recognition
        // threshold before lifting, as in the existing focus-mode pinch regression.
        page.pinch(withScale: 5, velocity: 1)
        shot("build9-score-pinch-with-ink")
        print("After actual pinch: \(pdf.value as? String ?? "missing PDF diagnostics")")
        waitForInk(1, app: app)
        let zoomed = XCTNSPredicateExpectation(predicate: NSPredicate { object, _ in
            guard let value = (object as? XCUIElement)?.value as? String,
                  let scalePart = value.components(separatedBy: ";scale=").dropFirst().first,
                  let scale = Double(scalePart.components(separatedBy: ",")[0]),
                  let minimumPart = value.components(separatedBy: ",min=").dropFirst().first,
                  let minimum = Double(minimumPart.components(separatedBy: ",")[0]) else { return false }
            return scale > minimum * 1.2
        }, object: pdf)
        XCTAssertEqual(XCTWaiter.wait(for: [zoomed], timeout: 5), .completed,
                       "The regression must exercise an actually zoomed canvas: \(pdf.value as? String ?? "missing PDF diagnostics")")
        // XCTest cannot place its two widely separated tap points on this clipped page.
        // Real two-finger Undo is exercised above in Draw and reading; at actual zoom,
        // exercise the same value-history operation through its visible toolbar button.
        // Physical two-finger Undo at zoom remains a separate device acceptance check.
        app.buttons["toggleAnnotationPalette"].tap()
        app.buttons["Undo ink"].tap()
        waitForInk(0, app: app)
        XCTAssertTrue(redo.isEnabled, "Zoomed Undo must retain Redo")
        redo.tap()
        waitForInk(1, app: app)
        shot("build9-real-undo-after-mode-change-and-zoom")
        app.buttons["finishScoreMarkup"].tap()
        app.buttons["closeScore"].tap()
        app.terminate(); openScore(app, reset: false)
        waitForInk(1, app: app)
    }

    @MainActor func testActualDrawUndoDrawKeepsOnlyTheNewBranchAfterZoomAndReopen() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["annotateScore"].tap()
        let finger = app.switches["fingerDrawing"]
        XCTAssertTrue(finger.waitForExistence(timeout: 5), app.debugDescription)
        if finger.value as? String != "1" {
            finger.coordinate(withNormalizedOffset: .init(dx: 0.97, dy: 0.5)).tap()
        }
        let toggle = app.buttons["toggleAnnotationPalette"]
        toggle.tap()
        let page = app.otherElements["scorePDF"].textViews.firstMatch
        page.coordinate(withNormalizedOffset: .init(dx: 0.25, dy: 0.55)).press(forDuration: 0.1,
            thenDragTo: page.coordinate(withNormalizedOffset: .init(dx: 0.65, dy: 0.58)))
        waitForInk(1, app: app)
        page.tap(withNumberOfTaps: 1, numberOfTouches: 2)
        waitForInk(0, app: app)
        // A real second native stroke is essential: assigning PKDrawing values in a history
        // fixture cannot expose PencilKit republishing the abandoned stroke with this mark.
        page.coordinate(withNormalizedOffset: .init(dx: 0.30, dy: 0.72)).press(forDuration: 0.1,
            thenDragTo: page.coordinate(withNormalizedOffset: .init(dx: 0.70, dy: 0.74)))
        waitForInk(1, app: app)
        print("Draw-Undo-draw native branch: \(app.otherElements["scorePDF"].value as? String ?? "missing diagnostics")")
        toggle.tap()
        XCTAssertFalse(app.buttons["Redo ink"].isEnabled, "The new stroke must discard the abandoned redo branch")
        app.buttons["Undo ink"].tap(); waitForInk(0, app: app)
        app.buttons["Redo ink"].tap(); waitForInk(1, app: app)
        toggle.tap()
        page.pinch(withScale: 5, velocity: 1)
        waitForInk(1, app: app)
        let pdf = app.otherElements["scorePDF"]
        let zoomed = XCTNSPredicateExpectation(predicate: NSPredicate { object, _ in
            guard let value = (object as? XCUIElement)?.value as? String,
                  let scalePart = value.components(separatedBy: ";scale=").dropFirst().first,
                  let scale = Double(scalePart.components(separatedBy: ",")[0]),
                  let minimumPart = value.components(separatedBy: ",min=").dropFirst().first,
                  let minimum = Double(minimumPart.components(separatedBy: ",")[0]) else { return false }
            return scale > minimum * 1.2
        }, object: pdf)
        XCTAssertEqual(XCTWaiter.wait(for: [zoomed], timeout: 5), .completed,
                       "The new branch must survive an actually zoomed canvas: \(pdf.value as? String ?? "missing diagnostics")")
        shot("build13-draw-undo-new-branch-after-zoom")
        toggle.tap()
        app.buttons["Undo ink"].tap(); waitForInk(0, app: app)
        app.buttons["Redo ink"].tap(); waitForInk(1, app: app)
        app.buttons["finishScoreMarkup"].tap()
        app.buttons["closeScore"].tap()
        app.terminate(); openScore(app, reset: false)
        waitForInk(1, app: app)
        shot("build13-draw-undo-new-branch-reopened")
    }

    @MainActor func testActualDoubleTapSelectedPassageOpensRenameAndPersists() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["passages"].tap()
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "savedPassage_", "Evenness and pulse")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 8), app.debugDescription)
        row.tap()
        XCTAssertTrue(app.buttons["coldGrade_clean"].waitForExistence(timeout: 8))
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !app.navigationBars["Passages"].exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 5), .completed)

        // The seeded selected region is x=.05...95, y=.16...29 in the real PDF page.
        let page = app.otherElements["scorePDF"].textViews.firstMatch
        page.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.225)).doubleTap()
        let diagnostics = app.otherElements["scorePDF"].value as? String ?? "missing score diagnostics"
        print("Selected-passage double-tap diagnostics: \(diagnostics)")
        XCTAssertTrue(app.navigationBars["Rename passage"].waitForExistence(timeout: 5), app.debugDescription)
        let field = app.textViews["passageRenameField"].exists ? app.textViews["passageRenameField"] : app.textFields["passageRenameField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), app.debugDescription)
        field.tap()
        let old = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + "Gesture renamed passage")
        app.buttons["savePassageName"].tap()
        XCTAssertTrue(app.staticTexts["Gesture renamed passage"].waitForExistence(timeout: 5), app.debugDescription)
        shot("build8-real-double-tap-rename")
        app.buttons["closeScore"].tap()
        app.terminate(); openScore(app, reset: false)
        app.buttons["passages"].tap()
        XCTAssertTrue(app.staticTexts["Gesture renamed passage"].waitForExistence(timeout: 8), app.debugDescription)
    }

    @MainActor func testActualDoubleTapDockPassageNameRenamesAndPersistsWithoutStartingPractice() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["passages"].tap()
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "savedPassage_", "Evenness and pulse")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 8), app.debugDescription); row.tap()
        let title = app.otherElements["practiceArmPanel"].staticTexts["Evenness and pulse"]
        XCTAssertTrue(title.waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertTrue(app.buttons["coldGrade_clean"].exists)
        title.doubleTap()
        XCTAssertTrue(app.navigationBars["Rename passage"].waitForExistence(timeout: 5), app.debugDescription)
        let field = app.textViews["passageRenameField"].exists ? app.textViews["passageRenameField"] : app.textFields["passageRenameField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), app.debugDescription); field.tap()
        let old = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + "Named from the practice dock")
        app.buttons["savePassageName"].tap()
        XCTAssertTrue(app.otherElements["practiceArmPanel"].staticTexts["Named from the practice dock"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(app.buttons["coldGrade_clean"].exists, "Renaming keeps the passage armed without starting a set")
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        shot("build12-double-tap-dock-passage-name")
        app.buttons["closeScore"].tap(); app.terminate(); openScore(app, reset: false)
        app.buttons["passages"].tap()
        let saved = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "savedPassage_", "Named from the practice dock")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 8), app.debugDescription); saved.tap()
        XCTAssertTrue(app.otherElements["practiceArmPanel"].staticTexts["Named from the practice dock"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
    }

    @MainActor func testStickyNoteHoldDragAndDoubleTapEditSurviveRelaunch() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["annotateScore"].tap()
        app.buttons["annotationTool_text"].tap()
        app.buttons["toggleAnnotationPalette"].tap()
        let page = app.otherElements["scorePDF"].textViews.firstMatch
        page.coordinate(withNormalizedOffset: .init(dx: 0.3, dy: 0.56)).tap()
        let editor = app.textViews["textAnnotationEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 8), app.debugDescription)
        editor.tap(); editor.typeText("Listen to the bass")
        app.buttons["saveTextAnnotation"].tap()
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !editor.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed)
        app.buttons["finishScoreMarkup"].tap()
        func routingEvidence(_ stage: String) {
            let pdf = app.otherElements["scorePDF"]
            let detail: String
            if pdf.exists, page.exists {
                detail = "stage=\(stage);pageFrame=\(page.frame);pdfFrame=\(pdf.frame);from=.3,.56;to=.57,.72;\(pdf.value as? String ?? "no diagnostics")"
            } else { detail = "stage=\(stage);editorPresented=\(editor.exists);scoreNotAccessibleBehindPresentation=true" }
            let attachment = XCTAttachment(string: detail)
            attachment.name = "note-routing-\(stage)"; attachment.lifetime = .keepAlways; add(attachment)
            print("PraeludeNoteGestureEvidence \(detail)")
        }
        routingEvidence("before-drag")
        let from = page.coordinate(withNormalizedOffset: .init(dx: 0.3, dy: 0.56))
        let to = page.coordinate(withNormalizedOffset: .init(dx: 0.57, dy: 0.72))
        from.press(forDuration: 0.6, thenDragTo: to)
        routingEvidence("after-drag")
        shot("build8-note-after-hold-drag")
        to.doubleTap()
        routingEvidence("after-double-tap")
        XCTAssertTrue(editor.waitForExistence(timeout: 5), "The moved note must open at its new location.\n\(app.debugDescription)")
        XCTAssertEqual(editor.value as? String, "Listen to the bass")
        shot("build8-note-moved-and-edited")
        app.buttons["Cancel"].tap()
        app.buttons["closeScore"].tap()
        app.terminate(); openScore(app, reset: false)
        app.otherElements["scorePDF"].textViews.firstMatch.coordinate(withNormalizedOffset: .init(dx: 0.57, dy: 0.72)).doubleTap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5), "Moved note location must persist through relaunch")
        XCTAssertEqual(editor.value as? String, "Listen to the bass")
        app.buttons["Cancel"].tap()
        let movedNote = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
                                                        "scoreNote_", "Listen to the bass")).firstMatch
        XCTAssertTrue(movedNote.waitForExistence(timeout: 5), app.debugDescription)
        // The accessibility element identifies the real moved chip. XCTest synthesizes the
        // three physical taps at its frame; no accessibility action or app helper is invoked.
        movedNote.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        finishOrDenyNoteDictation(app)
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(editor.value as? String, "Listen to the bass", "Starting or denying dictation must retain the saved note")
        shot("build8-note-triple-tap-dictation-recovery")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["closeScore"].waitForExistence(timeout: 5), "Cancel must return to the usable score")
    }
}
