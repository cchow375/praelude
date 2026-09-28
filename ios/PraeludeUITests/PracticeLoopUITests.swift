import XCTest

/// UI coverage for the practice-ux track (spec §9, §10, §3d, §8): §10a's ≤2-tap start — which, for
/// the seeded passage, runs straight through §9/R3's cold-grade gate, since a never-graded passage's
/// very first practice of the day always meets it — §10a's tempo drag gesture, a verdict plus undo,
/// and §10c's collapsible HUD.
final class PracticeLoopUITests: XCTestCase {
    @MainActor private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed"]
        app.launch()
        return app
    }

    @MainActor private func openScore(_ app: XCUIApplication) {
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 1), hideSidebar.isHittable { hideSidebar.press(forDuration: 0.15) }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Practice study")).firstMatch
        XCTAssertTrue(piece.waitForExistence(timeout: 10), app.debugDescription)
        for _ in 0..<5 where !piece.isHittable { app.swipeUp() }
        piece.press(forDuration: 0.15)
    }

    /// Tap 1 of §10a's "tap a passage outline, then Start": the seeded passage from the Passages
    /// list. (A direct on-score box tap exercises the same `selectPassage` call site; the list is
    /// used here because it does not depend on the synthetic fixture PDF's exact box geometry.)
    @MainActor private func choosePassage(_ app: XCUIApplication) {
        app.buttons["passages"].press(forDuration: 0.15)
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "savedPassage_")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), app.debugDescription)
        row.press(forDuration: 0.15)
    }

    /// `ios.hudCollapsed` is a deliberate cross-launch preference (the same pattern as the existing
    /// `ios.feedback` `@AppStorage`), so it persists in this simulator's UserDefaults from whatever
    /// an earlier test in this run last left it as. Tests that read the expanded readout normalize
    /// to expanded first rather than assuming a particular starting preference.
    @MainActor private func ensureExpanded(_ app: XCUIApplication) {
        let expand = app.buttons["hudExpand"]
        if expand.exists { expand.press(forDuration: 0.15) }
    }

    @MainActor private func screenshot(_ name: String, app: XCUIApplication) {
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }

    private func tempoBPM(_ element: XCUIElement) -> Int? {
        guard let value = element.value as? String else { return nil }
        return Int(value.prefix { $0.isNumber })
    }

    // MARK: - ≤2-tap start (through the cold-grade gate)

    @MainActor func testTwoTapStartThroughColdGrade() {
        let app = launch()
        openScore(app)
        // Tap 1: choose the passage.
        choosePassage(app)
        // A never-graded passage's cold-grade prompt replaces Start; no modal appears in between —
        // this is still the whole path, not a third step.
        XCTAssertFalse(app.navigationBars["Practice set"].exists, app.debugDescription)
        let coldClean = app.buttons["coldGrade_clean"]
        XCTAssertTrue(coldClean.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.buttons["coldGrade_shaky"].exists)
        XCTAssertTrue(app.buttons["coldGrade_missed"].exists)
        screenshot("loop-01-cold-grade-prompt", app: app)
        // Tap 2: grade cold, which both starts the set and records its first attempt.
        coldClean.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        ensureExpanded(app)
        XCTAssertTrue(app.staticTexts["1 of 5 clean"].exists, app.debugDescription)
        screenshot("loop-02-running-after-two-taps", app: app)
    }

    /// Once today's cold grade is already recorded, the *same* passage's next arm shows a plain
    /// Start — confirming the cold-grade prompt is a once-a-day substitute for Start, not an extra
    /// permanent step.
    @MainActor func testPlainStartAfterTodaysColdGradeIsAlreadyRecorded() {
        let app = launch()
        openScore(app)
        choosePassage(app)
        let coldClean = app.buttons["coldGrade_clean"]
        XCTAssertTrue(coldClean.waitForExistence(timeout: 15), app.debugDescription)
        coldClean.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        for _ in 0..<4 { app.buttons["verdict_clean"].press(forDuration: 0.15) }
        XCTAssertTrue(app.staticTexts["Set complete"].waitForExistence(timeout: 15), app.debugDescription)
        app.buttons["Another set"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["confirmStartSet"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.buttons["coldGrade_clean"].exists, app.debugDescription)
        app.buttons["confirmStartSet"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
    }

    // MARK: - Cold grade: Shaky maps to a Sloppy first attempt

    @MainActor func testColdGradeShakyRecordsSloppyFirstAttempt() {
        let app = launch()
        openScore(app)
        choosePassage(app)
        let shaky = app.buttons["coldGrade_shaky"]
        XCTAssertTrue(shaky.waitForExistence(timeout: 15), app.debugDescription)
        shaky.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        ensureExpanded(app)
        XCTAssertTrue(app.staticTexts["0 of 5 clean"].exists,
                      "A cold Shaky is recorded as the set's first attempt, but as Sloppy — it must not count toward the clean streak.\n\(app.debugDescription)")
    }

    // MARK: - Tempo drag (§10a: drag/scroll on the numeral, never a modal/keyboard)

    @MainActor func testTempoDragAdjustsTheArmedTempo() {
        let app = launch()
        openScore(app)
        // Whole-piece practice (no passage chosen yet) is armed immediately on opening the score,
        // and is never cold-gated — its tempo dial is interactive right away.
        XCTAssertTrue(app.buttons["confirmStartSet"].waitForExistence(timeout: 15), app.debugDescription)
        let tempo = app.staticTexts["tempoDialValue"]
        XCTAssertTrue(tempo.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(tempoBPM(tempo), 60, app.debugDescription)
        let start = tempo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = tempo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: -22))
        start.press(forDuration: 0.05, thenDragTo: end)
        let raised = tempoBPM(tempo)
        XCTAssertNotNil(raised, app.debugDescription)
        XCTAssertGreaterThan(raised ?? 0, 60, "Dragging up on the tempo numeral must raise it directly — no modal or keyboard.\n\(app.debugDescription)")
        screenshot("loop-03-tempo-drag", app: app)
        // ±5 stays a one-tap nudge alongside the drag.
        let plusFive = app.buttons["Increase tempo by 5"]
        XCTAssertTrue(plusFive.waitForExistence(timeout: 15), app.debugDescription)
        let afterTap = raised ?? 0
        plusFive.press(forDuration: 0.15)
        XCTAssertEqual(tempoBPM(tempo), afterTap + 5, app.debugDescription)
    }

    // MARK: - Verdict + Undo, always one tap during a set

    @MainActor func testVerdictAndUndo() {
        let app = launch()
        openScore(app)
        choosePassage(app)
        app.buttons["coldGrade_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        ensureExpanded(app)
        XCTAssertTrue(app.staticTexts["1 of 5 clean"].waitForExistence(timeout: 15), app.debugDescription)
        app.buttons["verdict_sloppy"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["0 of 5 clean"].waitForExistence(timeout: 15), app.debugDescription)
        let undo = app.buttons["undoRep"]
        XCTAssertTrue(undo.isEnabled, app.debugDescription)
        undo.press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["1 of 5 clean"].waitForExistence(timeout: 15), app.debugDescription)
        screenshot("loop-04-verdict-undo", app: app)
    }

    // MARK: - HUD collapse (§10c: collapsible to a thin strip; §3d: controls always one tap)

    @MainActor func testHUDCollapseKeepsControlsReachable() {
        let app = launch()
        openScore(app)
        choosePassage(app)
        app.buttons["coldGrade_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        ensureExpanded(app)
        XCTAssertTrue(app.staticTexts["repProgress"].exists, app.debugDescription)
        let collapse = app.buttons["hudCollapse"]
        XCTAssertTrue(collapse.waitForExistence(timeout: 15), app.debugDescription)
        collapse.press(forDuration: 0.15)
        let expand = app.buttons["hudExpand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.staticTexts["repProgress"].exists, "Collapsing must hide the big readout.\n\(app.debugDescription)")
        // Collapsing must never take Undo/Pause/Stop/metronome-toggle/verdicts below one tap.
        XCTAssertTrue(app.buttons["verdict_clean"].isHittable, app.debugDescription)
        XCTAssertTrue(app.buttons["undoRep"].exists)
        XCTAssertTrue(app.buttons["pausePractice"].exists)
        XCTAssertTrue(app.buttons["stopSet"].exists)
        XCTAssertTrue(app.buttons["toggleMetronomeHUD"].exists)
        screenshot("loop-05-hud-collapsed", app: app)
        // A verdict must still record while collapsed — expanding again afterward confirms it, since
        // the collapsed strip's own numeral uses a different, more compact format ("N/M").
        app.buttons["verdict_clean"].press(forDuration: 0.15)
        expand.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["hudCollapse"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.staticTexts["2 of 5 clean"].waitForExistence(timeout: 15), "A verdict must still record while collapsed.\n\(app.debugDescription)")
    }
}
