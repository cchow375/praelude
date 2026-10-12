import XCTest

/// Repeated real recognition over one saved, selected source-page box. The explicit DEBUG
/// starting point isolates score gestures; this case makes no library-navigation claim.
final class SelectedPassageTapUITests: XCTestCase {
    @MainActor private func capture(_ name: String, app: XCUIApplication) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }

    @MainActor private func require(_ name: String, app: XCUIApplication, timeout: TimeInterval = 8,
                                    _ condition: @escaping @MainActor () -> Bool) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        let result = XCTWaiter.wait(for: [ready], timeout: timeout)
        capture(name, app: app)
        XCTAssertEqual(result, .completed, "Required state: \(name)\n\(app.debugDescription)")
    }

    @MainActor private func settled(_ element: XCUIElement, app: XCUIApplication, name: String) {
        var previous = CGRect.zero
        var changed = Date.now
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard element.exists, element.isHittable else { return false }
            let frame = element.frame
            guard frame.width > 1, frame.height > 1, app.frame.contains(frame) else { return false }
            if frame != previous { previous = frame; changed = .now; return false }
            return Date.now.timeIntervalSince(changed) >= 0.4
        }, object: nil)
        let result = XCTWaiter.wait(for: [ready], timeout: 8)
        capture(name + "-before", app: app)
        XCTAssertEqual(result, .completed, "Stable visible target required: \(name)\n\(app.debugDescription)")
        let frame = element.frame
        let target = XCTAttachment(string: "identifier=\(element.identifier) frame=\(frame) center=(\(frame.midX),\(frame.midY))")
        target.name = name + "-target"; target.lifetime = .keepAlways; add(target)
    }

    @MainActor private func pageGesture(_ count: Int, app: XCUIApplication, name: String) {
        let score = app.otherElements["scorePDF"]
        let page = score.textViews.firstMatch
        settled(page, app: app, name: name)
        XCTAssertTrue(score.frame.contains(page.frame), "The complete paper must be visible.\n\(app.debugDescription)")
        // Only --audit-gesture-preservation places Evenness at x=.05...95,y=.435...565.
        // A fully visible page's center (.5,.5) lies inside that saved box and below the other.
        XCTAssertGreaterThan(page.frame.height, 100)
        XCTAssertGreaterThan(page.frame.width, 100)
        page.tap(withNumberOfTaps: count, numberOfTouches: 1)
        capture(name + "-immediately-after", app: app)
    }

    @MainActor private func scoreReady(_ app: XCUIApplication, name: String) {
        require(name, app: app) {
            !app.navigationBars["Rename passage"].exists && app.keyboards.count == 0 &&
            app.otherElements["practiceArmPanel"].staticTexts["Evenness and pulse"].isHittable &&
            app.buttons["coldGrade_missed"].isHittable && app.buttons["skipColdGrade"].exists
        }
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        XCTAssertFalse(app.buttons["stopSet"].exists)
        XCTAssertFalse(app.buttons["verdict_clean"].exists)
    }

    @MainActor private func renameReady(_ app: XCUIApplication, name: String) {
        require(name, app: app) {
            app.navigationBars["Rename passage"].exists &&
            app.descendants(matching: .any).matching(identifier: "passageRenameField").firstMatch.exists &&
            app.navigationBars["Rename passage"].buttons["Cancel"].isHittable
        }
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "passageRenameField").firstMatch.value as? String,
                       "Evenness and pulse")
    }

    @MainActor private func cancelRename(_ app: XCUIApplication, name: String) {
        let cancel = app.navigationBars["Rename passage"].buttons["Cancel"]
        settled(cancel, app: app, name: name + "-cancel")
        cancel.tap()
        capture(name + "-cancel-immediately-after", app: app)
        scoreReady(app, name: name + "-score-restored")
    }

    @MainActor private func dictationFailure(in editor: XCUIElement) -> XCUIElement {
        editor.staticTexts.matching(NSPredicate(format:
            "label CONTAINS[c] 'permission is off' OR label CONTAINS[c] 'recognition is unavailable' OR label CONTAINS[c] 'recognition is temporarily unavailable' OR label BEGINSWITH 'Voice could not start:'")).firstMatch
    }

    @MainActor private func recoverOneDictationRequest(_ app: XCUIApplication) {
        let editor = app.collectionViews.containing(.any, identifier: "passageRenameField").firstMatch
        let dictate = app.buttons["dictatePassageName"]
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let failure = dictationFailure(in: editor)
        require("triple-request-observed", app: app) {
            editor.exists && (failure.exists || (dictate.exists && dictate.label.contains("Finish")) ||
                app.alerts.firstMatch.exists || springboard.alerts.firstMatch.exists)
        }
        let alert = app.alerts.firstMatch.exists ? app.alerts.firstMatch : springboard.alerts.firstMatch
        if alert.exists {
            capture("single-dictation-permission-prompt", app: app)
            let decline = alert.buttons.matching(NSPredicate(format:
                "label == %@ OR label == %@", "Don’t Allow", "Don't Allow")).firstMatch
            XCTAssertTrue(decline.exists && decline.isHittable, alert.debugDescription)
            decline.tap()
            require("dictation-permission-denied-recovery", app: app) { failure.exists }
        } else if dictate.exists, dictate.label.contains("Finish") {
            // If permissions were already allowed, finish this one real request explicitly.
            // No camera, speech accuracy, or microphone hardware acceptance is inferred.
            settled(dictate, app: app, name: "finish-single-dictation-request")
            dictate.tap()
        }
        require("dictation-editor-usable-again", app: app) {
            dictate.exists && dictate.label == "Dictate name" && app.buttons["savePassageName"].isEnabled
        }
    }

    @MainActor func testEightSelectedBoxDoubleTapCancelCyclesThenTripleAndOrdinaryDockEdit() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--seed-sections",
                               "--audit-gesture-preservation", "--audit-open-gesture-score"]
        app.launch()
        require("direct-score-fixture-open", app: app) {
            app.buttons["annotateScore"].isHittable && app.otherElements["scorePDF"].textViews.firstMatch.exists
        }
        pageGesture(1, app: app, name: "actual-center-single-arm")
        scoreReady(app, name: "saved-evenness-actually-selected")

        for index in 1...8 {
            let cycle = "box-double-cycle-\(index)"
            pageGesture(2, app: app, name: cycle)
            renameReady(app, name: cycle + "-rename-open")
            XCTAssertEqual(app.buttons["dictatePassageName"].label, "Dictate name")
            XCTAssertTrue(app.buttons["savePassageName"].isEnabled)
            cancelRename(app, name: cycle)
        }

        pageGesture(3, app: app, name: "selected-box-single-triple-gesture")
        renameReady(app, name: "triple-rename-open")
        recoverOneDictationRequest(app)
        cancelRename(app, name: "triple-recovery")

        let title = app.otherElements["practiceArmPanel"].staticTexts["Evenness and pulse"]
        settled(title, app: app, name: "ordinary-dock-double-after-triple-cancel")
        title.tap(withNumberOfTaps: 2, numberOfTouches: 1)
        capture("ordinary-dock-double-immediately-after", app: app)
        renameReady(app, name: "ordinary-dock-rename-open")
        XCTAssertEqual(app.buttons["dictatePassageName"].label, "Dictate name")
        XCTAssertTrue(app.buttons["savePassageName"].isEnabled)
        let editor = app.collectionViews.containing(.any, identifier: "passageRenameField").firstMatch
        XCTAssertTrue(editor.exists, app.debugDescription)
        let unexpected = dictationFailure(in: editor)
        let silent = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            unexpected.exists || app.buttons["dictatePassageName"].label != "Dictate name"
        }, object: nil)
        silent.isInverted = true
        let result = XCTWaiter.wait(for: [silent], timeout: 2)
        capture("ordinary-dock-editor-no-inherited-dictation", app: app)
        XCTAssertEqual(result, .completed,
                       "Ordinary editing must not inherit the earlier triple-tap dictation request.\n\(app.debugDescription)")
        cancelRename(app, name: "ordinary-dock-after-dictation")
    }
}
