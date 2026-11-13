import XCTest

/// Independent checks over the disposable synthetic library. These do not exercise a physical
/// camera, speech recognition, Apple Pencil, or perceived click volume.
final class FreshBuild13UITests: XCTestCase {
    @MainActor private func openScore(_ app: XCUIApplication, reset: Bool = true, auditArguments: [String] = []) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--uitesting"] + (reset ? ["--reset", "--seed", "--seed-sections"] : []) + auditArguments
        app.launch()
        if auditArguments.contains("--audit-open-gesture-score") {
            // This explicit DEBUG starting point does not exercise library/sidebar opening.
            // All subsequent passage selection and editor gestures remain actual UI actions.
            XCTAssertTrue(app.buttons["annotateScore"].waitForExistence(timeout: 8), app.debugDescription)
            XCTAssertTrue(app.otherElements["scorePDF"].textViews.firstMatch.waitForExistence(timeout: 8), app.debugDescription)
            return
        }
        let pieces = app.tabBars.buttons["Pieces"]
        if pieces.exists, pieces.isHittable {
            tap(pieces, app: app)
        } else {
            let show = app.buttons["Show Sidebar"]
            if show.waitForExistence(timeout: 1), show.isHittable { tap(show, app: app) }
            let sidebarPieces = app.buttons["Pieces"]
            tap(sidebarPieces, app: app)
        }
        XCTAssertTrue(app.navigationBars["Pieces"].waitForExistence(timeout: 8), app.debugDescription)
        let hide = app.buttons["Hide Sidebar"]
        if hide.exists, hide.isHittable { tap(hide, app: app) }
        // The cover grid intentionally omits page count. Pieces navigation above plus the
        // library-only identifier distinguish this row from Today's Recent piece shortcut.
        let piece = app.buttons.matching(NSPredicate(format: "identifier == %@ AND label CONTAINS %@ AND label CONTAINS %@", "pieceRow", "Practice study", "Praelude test score")).firstMatch
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
        element.press(forDuration: 0.12)
    }

    @MainActor private func enablePassageGoal(_ app: XCUIApplication) {
        let row = app.switches["passageGoalEnabled"]
        if row.value as? String != "1" {
            // The row's AX frame includes its label and margins. Resolve the actual nested
            // UISwitch and require its frame to settle after keyboard/sheet movement.
            let control = row.switches.firstMatch
            var previous = CGRect.zero
            var lastChange = Date.now
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard control.exists, control.isHittable, app.frame.contains(control.frame) else { return false }
                if control.frame != previous { previous = control.frame; lastChange = .now; return false }
                return Date.now.timeIntervalSince(lastChange) >= 0.4
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 8), .completed, app.debugDescription)
            let frame = control.frame
            let target = XCTAttachment(string: "row=\(row.frame) control=\(frame) center=(\(frame.midX),\(frame.midY))")
            target.name = "passage-goal-native-switch-target"; target.lifetime = .keepAlways; add(target)
            shot("passage-goal-switch-before-single-tap", app: app)
            control.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.5)).tap()
        }
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "1"), object: row)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 5), .completed, app.debugDescription)
    }

    @MainActor private func shot(_ name: String, app: XCUIApplication) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }

    @MainActor private func armPassage(_ app: XCUIApplication, title: String = "Evenness and pulse") {
        tap(app.buttons["passages"], app: app)
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "savedPassage_", title)).firstMatch
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

    @MainActor private func chooseCameraExpression(_ title: String, app: XCUIApplication) {
        // The score's disabled page arrows remain in AX behind the sheet. Select only the
        // expression belonging to the open native Picker menu, never a global title match.
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
        try exerciseUndoNewStrokeAndReopen(traceTaps: false)
    }

    @MainActor func testDiagnosticSidebarAfterInkCheckpointAndRelaunch() throws {
        try exerciseUndoNewStrokeAndReopen(traceTaps: true)
    }

    @MainActor private func exerciseUndoNewStrokeAndReopen(traceTaps: Bool) throws {
        let auditArguments = traceTaps ? ["--audit-taps"] : []
        let app = XCUIApplication(); openScore(app, auditArguments: auditArguments)
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
        app.terminate(); openScore(app, reset: false, auditArguments: auditArguments)
        waitInk(1, app: app)
        let reopened = try drawingBounds(app)
        XCTAssertEqual(reopened.minY, branch.minY, accuracy: 1)
        XCTAssertEqual(reopened.maxY, branch.maxY, accuracy: 1)
        XCTAssertGreaterThan(reopened.minY, abandoned.maxY + 60)
        shot("fresh13-new-stroke-location-reopened", app: app)
    }

    @MainActor private func cameraSettingsList(_ app: XCUIApplication) -> XCUIElement {
        XCTAssertTrue(app.navigationBars["Camera gestures"].exists, app.debugDescription)
        let list = app.collectionViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 5), app.debugDescription)
        return list
    }

    @MainActor private func cameraViewport(_ app: XCUIApplication) -> CGRect {
        let list = cameraSettingsList(app)
        var visible = list.frame.intersection(app.frame)
        // The form sheet includes its navigation bar in the collection frame. Its scroll
        // bar reports the actual clipped content viewport (final1: y324...878).
        let bar = list.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "Vertical scroll bar")).firstMatch
        if bar.exists {
            let frame = bar.frame
            visible = CGRect(x: visible.minX, y: max(visible.minY, frame.minY), width: visible.width,
                             height: max(0, min(visible.maxY, frame.maxY) - max(visible.minY, frame.minY)))
        }
        return visible.insetBy(dx: 5, dy: 5)
    }

    @MainActor private func cameraControlVisible(_ element: XCUIElement, app: XCUIApplication) -> Bool {
        // List rows are virtualized; accessing frame before exists is itself an XCTest
        // failure. Every geometry read below follows a successful existence check.
        guard element.exists, element.isHittable else { return false }
        return cameraViewport(app).insetBy(dx: -0.5, dy: -0.5).contains(element.frame)
    }

    @MainActor private func scrollCamera(_ app: XCUIApplication, upwards: Bool) {
        let viewport = cameraViewport(app)
        XCTAssertGreaterThan(viewport.height, 100, app.debugDescription)
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let from = origin.withOffset(CGVector(dx: viewport.midX, dy: viewport.minY + viewport.height * (upwards ? 0.8 : 0.3)))
        let to = origin.withOffset(CGVector(dx: viewport.midX, dy: viewport.minY + viewport.height * (upwards ? 0.3 : 0.8)))
        from.press(forDuration: 0.08, thenDragTo: to)
    }

    @MainActor private func revealCameraControl(_ element: XCUIElement, app: XCUIApplication) {
        if cameraControlVisible(element, app: app) { return }
        // Return to a known top anchor before searching downward. This handles missing
        // virtualized rows without guessing their position from a nonexistent AX frame.
        let top = cameraSettingsList(app).buttons["toggleFaceCamera"]
        for _ in 0..<7 {
            if cameraControlVisible(top, app: app) { break }
            scrollCamera(app, upwards: false)
        }
        XCTAssertTrue(cameraControlVisible(top, app: app), app.debugDescription)
        for _ in 0..<7 {
            if cameraControlVisible(element, app: app) { return }
            scrollCamera(app, upwards: true)
        }
        XCTAssertTrue(cameraControlVisible(element, app: app), app.debugDescription)
    }

    @MainActor private func setCameraSwitch(_ identifier: String, enabled: Bool, receipt: String, app: XCUIApplication) {
        let row = cameraSettingsList(app).switches[identifier]
        revealCameraControl(row, app: app)
        let desired = enabled ? "1" : "0"
        if row.value as? String != desired {
            // A SwiftUI Toggle's AX row includes its label. Tap the actual nested UIKit
            // switch, whose final1 frame is 63x28pt, once after it settles.
            let control = row.switches.firstMatch
            let visible = cameraViewport(app)
            var previous = CGRect.zero
            var changed = Date.now
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard control.exists, control.isHittable else { return false }
                let frame = control.frame
                guard visible.contains(frame) else { return false }
                if frame != previous { previous = frame; changed = .now; return false }
                return Date.now.timeIntervalSince(changed) >= 0.25
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 5), .completed, app.debugDescription)
            let target = XCTAttachment(string: "row=\(row.frame) nativeSwitch=\(control.frame) desired=\(desired)")
            target.name = receipt; target.lifetime = .keepAlways; add(target)
            control.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.5)).press(forDuration: 0.12)
        }
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", desired), object: row)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed, app.debugDescription)
    }

    @MainActor private func waitCameraPreview(_ visible: Bool, app: XCUIApplication) {
        let preview = cameraSettingsList(app).descendants(matching: .any).matching(identifier: "faceCameraPreview").firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == %@", NSNumber(value: visible)), object: preview)
        XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 5), .completed, app.debugDescription)
    }

    @MainActor private func assertCameraExpression(_ expression: String, command: String, app: XCUIApplication) {
        let row = cameraSettingsList(app).buttons["faceCommand_" + command]
        revealCameraControl(row, app: app)
        let mapped = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", expression, expression), object: row)
        XCTAssertEqual(XCTWaiter.wait(for: [mapped], timeout: 5), .completed, app.debugDescription)
    }

    @MainActor private func assignCameraExpression(_ expression: String, command: String, app: XCUIApplication) {
        let row = cameraSettingsList(app).buttons["faceCommand_" + command]
        revealCameraControl(row, app: app)
        tap(row, app: app)
        chooseCameraExpression(expression, app: app)
        assertCameraExpression(expression, command: command, app: app)
    }

    @MainActor func testBuild18QuickDirectionalMappingsPersistAndRemainCustomizable() {
        let app = XCUIApplication(); openScore(app, auditArguments: ["--audit-gesture-preservation", "--audit-open-gesture-score"])
        openCameraSettings(app)
        XCTAssertEqual(app.buttons["toggleFaceCamera"].label, "Enable camera")
        for (command, expression) in [("nextPage", "Look right"), ("previousPage", "Look left"), ("clean", "Look down")] {
            let row = cameraSettingsList(app).buttons["faceCommand_" + command]
            revealCameraControl(row, app: app)
            assertCameraExpression(expression, command: command, app: app)
        }
        assignCameraExpression("Look down", command: "again", app: app)
        assertCameraExpression("Unassigned", command: "clean", app: app)
        assertCameraExpression("Look down", command: "again", app: app)
        shot("build18-directional-mappings-customized", app: app)
        tap(app.navigationBars["Camera gestures"].buttons["Done"], app: app)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        tap(app.buttons["closeScore"], app: app)
        app.terminate(); openScore(app, reset: false, auditArguments: ["--audit-gesture-preservation", "--audit-open-gesture-score"])
        openCameraSettings(app)
        for (command, expression) in [("nextPage", "Look right"), ("previousPage", "Look left"), ("again", "Look down"), ("clean", "Unassigned")] {
            let row = cameraSettingsList(app).buttons["faceCommand_" + command]
            revealCameraControl(row, app: app)
            assertCameraExpression(expression, command: command, app: app)
        }
        shot("build18-directional-mappings-reopened", app: app)
        tap(app.navigationBars["Camera gestures"].buttons["Done"], app: app)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
    }

    @MainActor func testCameraCommandFirstMappingsAndRecognitionSettingsPersistWithoutStartingSet() {
        let app = XCUIApplication(); openScore(app)
        XCTAssertFalse(app.otherElements["scoreCameraControls"].exists)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        openCameraSettings(app)
        XCTAssertEqual(app.buttons["toggleFaceCamera"].label, "Enable camera")
        XCTAssertEqual(app.staticTexts["faceCameraStatus"].label, "Camera is off")
        // Commands remain fixed. Assigning an occupied expression moves it explicitly;
        // an expression can never leave two hidden command mappings behind.
        assignCameraExpression("Nod", command: "clean", app: app)
        assignCameraExpression("Nod", command: "previousPage", app: app)
        assertCameraExpression("Unassigned", command: "clean", app: app)
        let feedback = cameraSettingsList(app).staticTexts["faceMappingFeedback"]
        revealCameraControl(feedback, app: app)
        XCTAssertTrue(feedback.label.contains("Clean is now unassigned"), app.debugDescription)
        assignCameraExpression("Grin", command: "nextPage", app: app)
        assignCameraExpression("Shake head", command: "sloppy", app: app)
        assignCameraExpression("Open mouth", command: "clean", app: app)
        assignCameraExpression("Close both eyes", command: "again", app: app)
        let verdicts = cameraSettingsList(app).switches["allowFaceVerdicts"]
        setCameraSwitch("allowFaceVerdicts", enabled: true, receipt: "camera-verdict-opt-in-native-target", app: app)
        let calibrate = cameraSettingsList(app).buttons["calibrateFaceCamera"]
        revealCameraControl(calibrate, app: app)
        XCTAssertFalse(calibrate.isEnabled)

        let sensitivity = cameraSettingsList(app).buttons["faceGestureSensitivity"]
        revealCameraControl(sensitivity, app: app)
        tap(sensitivity, app: app); chooseCameraExpression("Easy", app: app)
        let hold = cameraSettingsList(app).steppers["faceGestureHold"]
        let cooldown = cameraSettingsList(app).steppers["faceGestureCooldown"]
        revealCameraControl(hold, app: app)
        tap(hold.buttons["faceGestureHold-Increment"], app: app)
        let holdValue = hold.label + " " + (hold.value as? String ?? "")
        revealCameraControl(cooldown, app: app)
        tap(cooldown.buttons["faceGestureCooldown-Increment"], app: app)
        let cooldownValue = cooldown.label + " " + (cooldown.value as? String ?? "")
        XCTAssertTrue(holdValue.contains("0.5"), app.debugDescription)
        XCTAssertTrue(cooldownValue.contains("1.5"), app.debugDescription)
        shot("camera-command-first-mappings-and-recognition-settings", app: app)
        tap(app.navigationBars["Camera gestures"].buttons["Done"], app: app)
        XCTAssertFalse(app.otherElements["scoreCameraControls"].exists)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        tap(app.buttons["closeScore"], app: app)
        app.terminate(); openScore(app, reset: false)
        openCameraSettings(app)
        XCTAssertEqual(app.buttons["toggleFaceCamera"].label, "Enable camera")
        for (command, expression) in [("nextPage", "Grin"), ("previousPage", "Nod"), ("clean", "Open mouth"), ("sloppy", "Shake head"), ("again", "Close both eyes")] {
            let row = cameraSettingsList(app).buttons["faceCommand_" + command]
            revealCameraControl(row, app: app)
            assertCameraExpression(expression, command: command, app: app)
        }
        revealCameraControl(verdicts, app: app)
        XCTAssertEqual(verdicts.value as? String, "1")
        revealCameraControl(sensitivity, app: app)
        XCTAssertTrue(sensitivity.label.contains("Easy") || (sensitivity.value as? String ?? "").contains("Easy"), app.debugDescription)
        revealCameraControl(hold, app: app)
        XCTAssertEqual(hold.label + " " + (hold.value as? String ?? ""), holdValue)
        revealCameraControl(cooldown, app: app)
        XCTAssertEqual(cooldown.label + " " + (cooldown.value as? String ?? ""), cooldownValue)
        shot("camera-command-mappings-and-recognition-settings-reopened", app: app)
        tap(app.navigationBars["Camera gestures"].buttons["Done"], app: app)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
    }

    @MainActor func testSimulatedCameraRepeatedStartStopAndPreviewRemainsResponsive() {
        // DEBUG fixture supplies permission and steady synthetic frames. This checks actual
        // controls and lifecycle integration, not physical camera recognition or performance.
        let app = XCUIApplication()
        openScore(app, auditArguments: ["--audit-simulated-face"])
        openCameraSettings(app)
        let toggle = app.buttons["toggleFaceCamera"]
        for cycle in 0..<6 {
            tap(toggle, app: app)
            if cycle < 3 {
                // Cancel preparation immediately; late permission/capture completion must
                // not reopen the camera or leave the settings sheet frozen.
                if toggle.isEnabled && toggle.label == "Turn camera off" { tap(toggle, app: app) }
            } else {
                let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "Test mode"), object: app.staticTexts["faceCameraStatus"])
                XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 8), .completed, app.debugDescription)
                waitCameraPreview(true, app: app)
                for previewCycle in 0..<3 {
                    setCameraSwitch("showFacePreview", enabled: false, receipt: "camera-\(cycle)-preview-\(previewCycle)-off", app: app)
                    waitCameraPreview(false, app: app)
                    setCameraSwitch("showFacePreview", enabled: true, receipt: "camera-\(cycle)-preview-\(previewCycle)-on", app: app)
                    waitCameraPreview(true, app: app)
                }
                setCameraSwitch("showFaceMapping", enabled: false, receipt: "camera-\(cycle)-mapping-off", app: app)
                setCameraSwitch("showFaceMapping", enabled: true, receipt: "camera-\(cycle)-mapping-on", app: app)
                revealCameraControl(toggle, app: app)
                tap(toggle, app: app)
            }
            let stopped = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                toggle.exists && toggle.isEnabled && toggle.label == "Enable camera"
                    && app.staticTexts["faceCameraStatus"].label == "Camera is off"
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [stopped], timeout: 8), .completed, "Cycle \(cycle + 1)\n\(app.debugDescription)")
            waitCameraPreview(false, app: app)
        }
        shot("camera-six-synthetic-start-stop-cycles", app: app)
        tap(app.navigationBars["Camera gestures"].buttons["Done"], app: app)
        XCTAssertFalse(app.otherElements["scoreCameraControls"].exists)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        openCameraSettings(app)
        XCTAssertEqual(toggle.label, "Enable camera")
        XCTAssertEqual(app.staticTexts["faceCameraStatus"].label, "Camera is off")
        tap(app.navigationBars["Camera gestures"].buttons["Done"], app: app)
    }

    @MainActor func testDirectNameAndDecimalGoalSaveAndReopenWithoutStartingSet() {
        let app = XCUIApplication(); openScore(app); armPassage(app)
        let edit = app.buttons["armEditPassage"]
        var previous = CGRect.zero
        var changed = Date.now
        let editReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard edit.exists, edit.isHittable, edit.frame.width >= 44, edit.frame.height >= 44,
                  app.frame.contains(edit.frame), app.otherElements["practiceArmPanel"].frame.contains(edit.frame) else { return false }
            if edit.frame != previous { previous = edit.frame; changed = .now; return false }
            return Date.now.timeIntervalSince(changed) >= 0.4
        }, object: nil)
        let readiness = XCTWaiter.wait(for: [editReady], timeout: 8)
        let frame = edit.frame
        let paddingPoint = CGPoint(x: frame.midX, y: frame.midY + 15)
        let glyphExclusion = CGRect(x: frame.midX - 12, y: frame.midY - 12, width: 24, height: 24)
        let target = XCTAttachment(string: "button=\(frame) paddingPoint=\(paddingPoint) centralGlyphExclusion=\(glyphExclusion) panel=\(app.otherElements["practiceArmPanel"].frame) hittable=\(edit.isHittable) readiness=\(readiness.rawValue)")
        target.name = "fresh13-arm-edit-44pt-lower-padding-target"; target.lifetime = .keepAlways; add(target)
        shot("fresh13-arm-edit-before-single-lower-padding-tap", app: app)
        XCTAssertEqual(readiness, .completed, "The complete armed-passage Edit target must settle at least 44×44pt.\n\(app.debugDescription)")
        XCTAssertTrue(frame.contains(paddingPoint) && !glyphExclusion.contains(paddingPoint),
                      "The single tap must land inside the button's lower padding, outside the central pencil glyph.")
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
            dx: paddingPoint.x - app.frame.minX, dy: paddingPoint.y - app.frame.minY)).tap()
        let name = app.textViews["passageRenameField"].exists ? app.textViews["passageRenameField"] : app.textFields["passageRenameField"]
        XCTAssertTrue(name.waitForExistence(timeout: 5), app.debugDescription)
        tap(name, app: app)
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (name.value as? String ?? "").count) + "Fresh named passage")
        enablePassageGoal(app)
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
        let queue = app.collectionViews["passageReviewQueue"]
        XCTAssertTrue(queue.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(queue.staticTexts["Tough passages · Upcoming"].exists, app.debugDescription)
        XCTAssertTrue(queue.staticTexts["Evenness and pulse"].exists, app.debugDescription)
        XCTAssertTrue(queue.staticTexts["Your last first attempt: Missed."].exists, app.debugDescription)
        let priority = queue.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "reviewPriority_")).firstMatch
        XCTAssertEqual(priority.label, "Tough passage", "A Missed report due tomorrow must not be marked overdue or URGENT today")
        XCTAssertFalse(queue.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "URGENT ·")).firstMatch.exists)
        shot("fresh13-missed-upcoming-tough-review-reopened", app: app)
    }

    @MainActor private func editNameAndGoal(_ app: XCUIApplication, name: String, bpm: String) {
        XCTAssertTrue(app.navigationBars["Rename passage"].waitForExistence(timeout: 8), app.debugDescription)
        let field = app.descendants(matching: .any).matching(identifier: "passageRenameField").firstMatch
        tap(field, app: app)
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (field.value as? String ?? "").count) + name)
        enablePassageGoal(app)
        let tempo = app.textFields["passageGoalTempoField"]
        tap(tempo, app: app)
        tempo.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (tempo.value as? String ?? "").count) + bpm)
        tap(app.buttons["savePassageName"], app: app)
        XCTAssertTrue(app.otherElements["practiceArmPanel"].staticTexts[name].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertTrue(app.buttons["coldGrade_clean"].exists)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        XCTAssertFalse(app.buttons["stopSet"].exists)
    }

    @MainActor private func assertGoalEditor(_ app: XCUIApplication, name: String, bpm: String) {
        XCTAssertTrue(app.navigationBars["Rename passage"].waitForExistence(timeout: 8), app.debugDescription)
        let field = app.descendants(matching: .any).matching(identifier: "passageRenameField").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(field.value as? String, name)
        XCTAssertEqual(app.switches["passageGoalEnabled"].value as? String, "1")
        XCTAssertEqual(app.textFields["passageGoalTempoField"].value as? String, bpm)
    }

    @MainActor private func recoverPassageDictation(_ app: XCUIApplication) {
        let dictate = app.buttons["dictatePassageName"]
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let editor = app.collectionViews.containing(.any, identifier: "passageRenameField").firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        let failure = editor.staticTexts.matching(NSPredicate(format:
            "label CONTAINS[c] 'permission is off' OR label CONTAINS[c] 'recognition is unavailable' OR label CONTAINS[c] 'recognition is temporarily unavailable' OR label BEGINSWITH 'Voice could not start:'")).firstMatch
        let requested = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (dictate.exists && dictate.label.contains("Finish")) || failure.exists ||
                app.alerts.firstMatch.exists || springboard.alerts.firstMatch.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [requested], timeout: 8), .completed,
                       "Triple tap must actually request dictation, not just open the double-tap editor.\n\(app.debugDescription)")
        var denied = false
        do {
            let alert = app.alerts.firstMatch.exists ? app.alerts.firstMatch : springboard.alerts.firstMatch
            if alert.waitForExistence(timeout: 2) {
                let decline = alert.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Don’t Allow", "Don't Allow")).firstMatch
                XCTAssertTrue(decline.exists, alert.debugDescription)
                decline.tap(); denied = true
            }
        }
        if denied { XCTAssertTrue(failure.waitForExistence(timeout: 5), app.debugDescription) }
        else if dictate.exists, dictate.label.contains("Finish") { tap(dictate, app: app) }
        let usable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let save = app.buttons["savePassageName"]
            return save.exists && save.isEnabled && dictate.exists && !dictate.label.contains("Finish")
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [usable], timeout: 8), .completed,
                       "Dictation recovery must leave ordinary editing usable.\n\(app.debugDescription)")
    }

    @MainActor private func armGestureAuditPassage(_ app: XCUIApplication, title: String = "Evenness and pulse") {
        let score = app.otherElements["scorePDF"]
        let page = score.textViews.firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertTrue(page.isHittable && score.frame.contains(page.frame), app.debugDescription)
        // Only this explicit audit fixture centers Evenness at y=.435...565. A real single
        // touch at the visible page center selects that saved box without a picker sheet.
        page.tap()
        XCTAssertTrue(app.buttons["coldGrade_missed"].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertTrue(app.otherElements["practiceArmPanel"].staticTexts[title].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        XCTAssertFalse(app.buttons["stopSet"].exists)
    }

    @MainActor func testActualDoubleTapNameAndBoxGoalsPersistAndTripleTapDictationRecovers() {
        let auditArguments = ["--audit-gesture-preservation", "--audit-open-gesture-score"]
        let app = XCUIApplication(); openScore(app, auditArguments: auditArguments); armGestureAuditPassage(app)
        let title = app.otherElements["practiceArmPanel"].staticTexts["Evenness and pulse"]
        XCTAssertTrue(title.waitForExistence(timeout: 8) && title.isHittable, app.debugDescription)
        title.doubleTap()
        editNameAndGoal(app, name: "Double tap name", bpm: "108.5")
        shot("fresh13-double-tap-name-goal-saved", app: app)

        let page = app.otherElements["scorePDF"].textViews.firstMatch
        // This explicit audit seed places the selected box at y=.435...565. The actual page
        // center is inside that box; XCTest synthesizes touches, not accessibility actions.
        XCTAssertTrue(app.otherElements["scorePDF"].frame.contains(page.frame), app.debugDescription)
        page.doubleTap()
        assertGoalEditor(app, name: "Double tap name", bpm: "108.5")
        editNameAndGoal(app, name: "Double tap box", bpm: "112.5")
        shot("fresh13-double-tap-box-goal-saved", app: app)
        tap(app.buttons["closeScore"], app: app)
        app.terminate(); openScore(app, reset: false, auditArguments: auditArguments); armGestureAuditPassage(app, title: "Double tap box")
        app.otherElements["practiceArmPanel"].staticTexts["Double tap box"].doubleTap()
        assertGoalEditor(app, name: "Double tap box", bpm: "112.5")
        shot("fresh13-double-tap-goal-reopened", app: app)
        tap(app.navigationBars["Rename passage"].buttons["Cancel"], app: app)

        let reopenedPage = app.otherElements["scorePDF"].textViews.firstMatch
        XCTAssertTrue(app.otherElements["scorePDF"].frame.contains(reopenedPage.frame), app.debugDescription)
        reopenedPage.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        XCTAssertTrue(app.navigationBars["Rename passage"].waitForExistence(timeout: 8), app.debugDescription)
        recoverPassageDictation(app)
        assertGoalEditor(app, name: "Double tap box", bpm: "112.5")
        shot("fresh13-triple-tap-passage-dictation-recovery", app: app)
        tap(app.navigationBars["Rename passage"].buttons["Cancel"], app: app)
        XCTAssertTrue(app.buttons["coldGrade_clean"].exists)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        XCTAssertFalse(app.buttons["stopSet"].exists)
        app.otherElements["practiceArmPanel"].staticTexts["Double tap box"].doubleTap()
        assertGoalEditor(app, name: "Double tap box", bpm: "112.5")
        XCTAssertEqual(app.buttons["dictatePassageName"].label, "Dictate name")
        XCTAssertTrue(app.buttons["savePassageName"].isEnabled)
        // Scope this to the actual editor: a new failure there demonstrates an inherited
        // dictation request; the score's compact recovery indicator is a separate surface.
        let editor = app.collectionViews.containing(.any, identifier: "passageRenameField").firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 5), app.debugDescription)
        let unexpectedDictation = editor.staticTexts.matching(NSPredicate(format:
            "label CONTAINS[c] 'permission is off' OR label CONTAINS[c] 'recognition is unavailable' OR label CONTAINS[c] 'recognition is temporarily unavailable' OR label BEGINSWITH 'Voice could not start:'")).firstMatch
        let silent = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in unexpectedDictation.exists }, object: nil)
        silent.isInverted = true
        XCTAssertEqual(XCTWaiter.wait(for: [silent], timeout: 2), .completed,
                       "An ordinary double-tap after Cancel must not repeat the earlier triple-tap dictation request.\n\(app.debugDescription)")
        shot("fresh13-double-tap-after-dictation-cancel", app: app)
        tap(app.navigationBars["Rename passage"].buttons["Cancel"], app: app)
        let scoreFailure = app.staticTexts.matching(NSPredicate(format:
            "label CONTAINS[c] 'permission is off' OR label CONTAINS[c] 'recognition is unavailable' OR label CONTAINS[c] 'recognition is temporarily unavailable' OR label BEGINSWITH 'Voice could not start:'")).firstMatch
        XCTAssertFalse(scoreFailure.exists, "The score should expose a compact recovery indicator, not retain the long error caption.\n\(app.debugDescription)")
        let voice = app.buttons["scoreVoice"]
        let attention = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Needs attention"), object: voice)
        XCTAssertEqual(XCTWaiter.wait(for: [attention], timeout: 5), .completed, app.debugDescription)
        shot("fresh14-neutral-voice-attention-after-denial", app: app)
        tap(voice, app: app)
        XCTAssertTrue(app.navigationBars["Hands-free"].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertTrue(scoreFailure.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(scoreFailure.isHittable && app.frame.contains(scoreFailure.frame), app.debugDescription)
        XCTAssertTrue(app.buttons["enableHandsFree"].isHittable, app.debugDescription)
        shot("fresh14-voice-permission-recovery-details", app: app)
        tap(app.navigationBars["Hands-free"].buttons["Done"], app: app)
        XCTAssertFalse(scoreFailure.exists, app.debugDescription)
        XCTAssertEqual(voice.value as? String, "Needs attention")
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        XCTAssertFalse(app.buttons["stopSet"].exists)
        tap(app.buttons["closeScore"], app: app)
        app.terminate(); openScore(app, reset: false, auditArguments: auditArguments); armGestureAuditPassage(app, title: "Double tap box")
        app.otherElements["practiceArmPanel"].staticTexts["Double tap box"].doubleTap()
        assertGoalEditor(app, name: "Double tap box", bpm: "112.5")
        tap(app.navigationBars["Rename passage"].buttons["Cancel"], app: app)
    }

    @MainActor func testTodayPriorityRenderingShowsDueCountAndKeepsFutureToughNonurgent() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--seed-sections", "--audit-review-priority"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 8), app.debugDescription)
        let identities = ["00000000-0000-4000-8000-000000000131", "00000000-0000-4000-8000-000000000132", "00000000-0000-4000-8000-000000000133"]
        let labels = ["URGENT · 2 days overdue", "URGENT · Tough passage due", "Tough passage"]
        let offsets = [-2, 0, 2]
        let today = Calendar.current.startOfDay(for: Date())
        var previousY: CGFloat = -1
        for index in identities.indices {
            let priority = app.staticTexts["reviewPriority_\(identities[index])"]
            XCTAssertTrue(priority.waitForExistence(timeout: 8), app.debugDescription)
            XCTAssertEqual(priority.label, labels[index])
            XCTAssertTrue(priority.isHittable && app.frame.contains(priority.frame), app.debugDescription)
            XCTAssertGreaterThan(priority.frame.minY, previousY)
            previousY = priority.frame.minY
            let cell = app.cells.containing(.staticText, identifier: priority.identifier).firstMatch
            let date = Calendar.current.date(byAdding: .day, value: offsets[index], to: today)!
            XCTAssertTrue(cell.staticTexts["Scheduled \(date.formatted(date: .abbreviated, time: .omitted))"].exists,
                          "The displayed priority must retain its actual saved date.\n\(app.debugDescription)")
        }
        XCTAssertTrue(app.staticTexts["2 reviews due."].exists)
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label BEGINSWITH %@", "reviewPriority_", "URGENT")).count, 2)
        shot("fresh14-today-overdue-due-and-future-priorities", app: app)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        XCTAssertFalse(app.buttons["stopSet"].exists)
    }

    @MainActor func testUrgentOverdueAndDueToughQueueKeepsFutureReviewNonurgent() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--seed-sections", "--audit-review-priority"]
        app.launch()
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.tap() }
        let today = app.tabBars.buttons["Today"]
        if today.exists, today.isHittable { tap(today, app: app) }
        let all = app.buttons["allPassageReviews"]
        for _ in 0..<8 where !all.isHittable { app.swipeUp() }
        tap(all, app: app)
        XCTAssertTrue(app.navigationBars["Passage reviews"].waitForExistence(timeout: 8), app.debugDescription)
        let queue = app.collectionViews["passageReviewQueue"]
        XCTAssertTrue(queue.waitForExistence(timeout: 5), app.debugDescription)
        let overdue = queue.staticTexts["reviewPriority_00000000-0000-4000-8000-000000000131"]
        let due = queue.staticTexts["reviewPriority_00000000-0000-4000-8000-000000000132"]
        let future = queue.staticTexts["reviewPriority_00000000-0000-4000-8000-000000000133"]
        XCTAssertTrue(overdue.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(overdue.label, "URGENT · 2 days overdue")
        XCTAssertEqual(due.label, "URGENT · Tough passage due")
        XCTAssertLessThan(overdue.frame.minY, due.frame.minY)
        shot("fresh13-urgent-overdue-and-due-tough", app: app)
        let list = queue
        XCTAssertTrue(list.exists, app.debugDescription)
        for _ in 0..<8 {
            let visible = list.frame.intersection(app.frame).insetBy(dx: 0, dy: 8)
            if future.exists, future.isHittable, visible.contains(future.frame) { break }
            list.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.75)).press(forDuration: 0.1,
                thenDragTo: list.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.55)), withVelocity: .slow, thenHoldForDuration: 0.1)
        }
        XCTAssertTrue(future.exists && future.isHittable, app.debugDescription)
        XCTAssertEqual(future.label, "Tough passage")
        XCTAssertTrue(queue.staticTexts["Tough passages · Upcoming"].exists)
        shot("fresh13-future-tough-is-not-urgent", app: app)
        let edit = queue.buttons["Edit name and goal for Future tough synthetic review"]
        XCTAssertTrue(edit.exists && edit.isHittable, app.debugDescription)
        XCTAssertGreaterThanOrEqual(edit.frame.width, 43.99, app.debugDescription)
        XCTAssertGreaterThanOrEqual(edit.frame.height, 43.99, app.debugDescription)
        edit.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.85)).tap()
        XCTAssertTrue(app.navigationBars["Rename passage"].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "passageRenameField").firstMatch.value as? String,
                       "Future tough synthetic review")
        tap(app.navigationBars["Rename passage"].buttons["Cancel"], app: app)
        XCTAssertTrue(app.navigationBars["Passage reviews"].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertEqual(future.label, "Tough passage")
        tap(app.navigationBars["Passage reviews"].buttons["Done"], app: app)
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        XCTAssertFalse(app.buttons["stopSet"].exists)
    }
}
