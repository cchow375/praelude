import XCTest

final class ScoreFocusUITests: XCTestCase {
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

    @MainActor private func trace(_ name: String, app: XCUIApplication) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }

    @MainActor private func openScore(_ app: XCUIApplication, reset: Bool = true) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--uitesting"] + (reset ? ["--reset", "--seed"] : [])
        app.launch()
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.tap() }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Practice study")).firstMatch
        for _ in 0..<6 where !piece.isHittable { app.swipeUp() }
        XCTAssertTrue(piece.waitForExistence(timeout: 8), app.debugDescription)
        piece.tap()
        XCTAssertTrue(app.buttons["annotateScore"].waitForExistence(timeout: 8), app.debugDescription)
    }

    @MainActor func testFocusHidesCounterPreservesSetAndRestoresCountingWithHands() {
        let app = XCUIApplication(); openScore(app)
        app.buttons["passages"].tap()
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "savedPassage_")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 8)); row.tap()
        XCTAssertTrue(app.buttons["skipColdGrade"].waitForExistence(timeout: 8)); app.buttons["skipColdGrade"].tap()
        let clean = app.buttons["verdict_clean"]
        XCTAssertTrue(clean.waitForExistence(timeout: 8))
        app.buttons["practiceHands_L"].tap(); clean.tap()
        let progress = app.staticTexts["repProgress"]
        let before = progress.label
        let runningShot = XCTAttachment(screenshot: app.screenshot()); runningShot.name = "running-dock-direct-hand-controls"
        runningShot.lifetime = .keepAlways; add(runningShot)
        let options = app.buttons["Score options"]
        settle(options, app: app); options.tap()
        let enter = app.buttons["enterScoreFocus"]
        settle(enter, app: app)
        trace("fresh-focus-before-single-tap", app: app)
        enter.tap()
        trace("fresh-focus-after-single-tap", app: app)
        XCTAssertTrue(app.buttons["exitScoreFocus"].waitForExistence(timeout: 5))
        XCTAssertFalse(clean.exists); XCTAssertFalse(progress.exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "focus-score-with-preserved-set"
        screenshot.lifetime = .keepAlways; add(screenshot)
        // The same direct score gesture restores controls; no set is started or finished.
        app.otherElements["scorePDF"].coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.95)).tap()
        XCTAssertTrue(clean.waitForExistence(timeout: 5)); XCTAssertEqual(progress.label, before)
        app.buttons["practiceHands_R"].tap(); clean.tap()
        XCTAssertNotEqual(progress.label, before)
        app.buttons["undoRep"].tap(); XCTAssertEqual(progress.label, before)
    }

    @MainActor func testControlPositionPersistsAfterRelaunch() {
        let app = XCUIApplication(); openScore(app)
        let swap = app.buttons["swapScoreControls"]
        let wasTop = swap.label == "Move controls to bottom"
        swap.tap()
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", wasTop ? "Move controls to top" : "Move controls to bottom"), object: swap)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed)
        let screen = app.otherElements["scorePDF"].frame
        let dock = app.otherElements["scorePracticeDock"].frame
        XCTAssertTrue(wasTop ? dock.midY > screen.midY : dock.midY < screen.midY)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "swapped-score-controls"
        attachment.lifetime = .keepAlways; add(attachment)
        let expected = swap.label
        app.buttons["closeScore"].tap(); app.terminate(); openScore(app, reset: false)
        XCTAssertEqual(app.buttons["swapScoreControls"].label, expected)
    }

    @MainActor func testWhiteSideMarginsTurnTheCorrectPage() {
        let app = XCUIApplication(); openScore(app)
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let pdf = app.otherElements["scorePDF"]
        let settledAfter = Date().addingTimeInterval(1)
        let landscape = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            Date() >= settledAfter && app.frame.width > app.frame.height && pdf.frame.width > pdf.frame.height
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 8), .completed, app.debugDescription)
        let indicator = app.buttons["pageIndicator"]
        XCTAssertTrue(indicator.label.contains("Page 1 of"), app.debugDescription)
        let margins = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value CONTAINS %@", "leftIsMargin=true,rightIsMargin=true"), object: pdf)
        XCTAssertEqual(XCTWaiter.wait(for: [margins], timeout: 5), .completed,
                       "Both test touches must actually be outside PDF paper: \(pdf.value ?? "")")
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = "landscape-white-page-turn-margins-settled"
        shot.lifetime = .keepAlways; add(shot)
        // Height-fit portrait paper leaves genuine white side gutters in landscape.
        pdf.coordinate(withNormalizedOffset: .init(dx: 0.97, dy: 0.5)).tap()
        let next = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "Page 2 of"), object: indicator)
        XCTAssertEqual(XCTWaiter.wait(for: [next], timeout: 5), .completed, app.debugDescription)
        pdf.coordinate(withNormalizedOffset: .init(dx: 0.03, dy: 0.5)).tap()
        let previous = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "Page 1 of"), object: indicator)
        XCTAssertEqual(XCTWaiter.wait(for: [previous], timeout: 5), .completed, app.debugDescription)
    }

    @MainActor func testTodayPassageNamesSaveWithoutStartingPractice() {
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed"]
        app.launch(); continueAfterFailure = false
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.tap() }
        app.buttons["todayPracticeTools"].tap()
        let organize = app.buttons["organizePassagesToday"]
        XCTAssertTrue(organize.waitForExistence(timeout: 5), app.debugDescription); organize.tap()
        let rename = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Edit name and goal for ")).firstMatch
        XCTAssertTrue(rename.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertGreaterThanOrEqual(rename.frame.width, 43.99, app.debugDescription)
        XCTAssertGreaterThanOrEqual(rename.frame.height, 43.99, app.debugDescription)
        // Touch the 44-point target below the pencil glyph, not only the painted symbol.
        rename.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.85)).tap()
        let field = app.textViews["passageRenameField"].exists ? app.textViews["passageRenameField"] : app.textFields["passageRenameField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap()
        let old = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + "Bass transition")
        app.buttons["savePassageName"].tap()
        XCTAssertTrue(app.staticTexts["Bass transition"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["verdict_clean"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "today-passage-renamed-without-practice"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["Done"].tap()
        XCTAssertFalse(app.buttons["resumePractice"].exists)
    }

    @MainActor func testTodaySessionEditPaddingSavesNameAndGoalWithoutStartingPractice() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        // The existing opt-in fixture also retains fresh13-audit-before.json for a host-side
        // exact comparison of history, sessions and cold grades after this actual UI flow.
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--seed-sections", "--audit-gesture-preservation"]
        app.launch()
        let hide = app.buttons["Hide Sidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.tap() }
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 8), app.debugDescription)

        func assertNoPractice() {
            XCTAssertFalse(app.buttons["verdict_clean"].exists, app.debugDescription)
            XCTAssertFalse(app.buttons["coldGrade_clean"].exists, app.debugDescription)
            XCTAssertFalse(app.buttons["resumePractice"].exists, app.debugDescription)
            XCTAssertFalse(app.buttons["stopSet"].exists, app.debugDescription)
            XCTAssertTrue(app.staticTexts["Your recorded work will appear here after practice."].exists, app.debugDescription)
            XCTAssertTrue(app.staticTexts["0, Repetitions"].exists, app.debugDescription)
            XCTAssertTrue(app.staticTexts["0, Completed sets"].exists, app.debugDescription)
        }
        assertNoPractice()
        let row = app.cells.containing(.staticText, identifier: "Evenness and pulse · Practice study").firstMatch
        let edit = row.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "editSessionPassage_")).firstMatch
        for _ in 0..<6 where !edit.isHittable { app.swipeUp() }
        settle(edit, app: app)
        XCTAssertGreaterThanOrEqual(edit.frame.width, 43.99, app.debugDescription)
        XCTAssertGreaterThanOrEqual(edit.frame.height, 43.99, app.debugDescription)
        let editIdentifier = edit.identifier
        trace("today-session-edit-padding-before", app: app)
        // A single touch 15 points below the centered glyph must hit the button's padding.
        edit.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.85)).tap()
        XCTAssertTrue(app.navigationBars["Rename passage"].waitForExistence(timeout: 8), app.debugDescription)
        let name = app.descendants(matching: .any).matching(identifier: "passageRenameField").firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(name.value as? String, "Evenness and pulse", "The session card must edit its own passage.")
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Evenness and pulse".count) + "Today padded edit")

        let goal = app.switches["passageGoalEnabled"]
        if goal.value as? String != "1" {
            let nativeSwitch = goal.switches.firstMatch
            settle(nativeSwitch, app: app)
            nativeSwitch.coordinate(withNormalizedOffset: .init(dx: 0.5, dy: 0.5)).tap()
        }
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "1"), object: goal)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 5), .completed, app.debugDescription)
        let tempo = app.textFields["passageGoalTempoField"]
        settle(tempo, app: app); tempo.tap()
        tempo.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (tempo.value as? String ?? "").count) + "112.5")
        let save = app.buttons["savePassageName"]
        settle(save, app: app); save.tap()
        XCTAssertTrue(app.staticTexts["Today padded edit · Practice study"].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertTrue(app.staticTexts["Goal 112.5 BPM"].exists, app.debugDescription)
        XCTAssertTrue(app.staticTexts["Phrase connection · Practice study"].exists, "The other session passage must keep its name.")
        assertNoPractice()
        trace("today-session-edit-padding-saved", app: app)

        app.terminate()
        app.launchArguments = ["--uitesting"]
        app.launch()
        let hideAfterRelaunch = app.buttons["Hide Sidebar"]
        if hideAfterRelaunch.waitForExistence(timeout: 1), hideAfterRelaunch.isHittable { hideAfterRelaunch.tap() }
        let reopenedEdit = app.buttons[editIdentifier]
        for _ in 0..<6 where !reopenedEdit.isHittable { app.swipeUp() }
        settle(reopenedEdit, app: app); reopenedEdit.tap()
        XCTAssertTrue(app.navigationBars["Rename passage"].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "passageRenameField").firstMatch.value as? String, "Today padded edit")
        XCTAssertEqual(app.switches["passageGoalEnabled"].value as? String, "1")
        XCTAssertEqual(app.textFields["passageGoalTempoField"].value as? String, "112.5")
        trace("today-session-edit-padding-reopened", app: app)
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5), app.debugDescription)
        assertNoPractice()
    }
}
