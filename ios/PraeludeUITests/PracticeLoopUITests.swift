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
        _ = piece.waitForExistence(timeout: 2)
        for _ in 0..<8 where !piece.exists || !piece.isHittable { app.swipeUp() }
        XCTAssertTrue(piece.waitForExistence(timeout: 10), app.debugDescription)
        piece.press(forDuration: 0.15)
        if !app.buttons["passages"].waitForExistence(timeout: 3), piece.isHittable {
            piece.press(forDuration: 0.15)
        }
    }

    /// Tap 1 of §10a's "tap a passage outline, then Start": the seeded passage from the Passages
    /// list. (A direct on-score box tap exercises the same `selectPassage` call site; the list is
    /// used here because it does not depend on the synthetic fixture PDF's exact box geometry.)
    @MainActor private func choosePassage(_ app: XCUIApplication) {
        // The score (and its "passages" button) can still be mid-layout right after `openScore`'s own
        // tap lands — every other button this suite presses waits for existence first; this one
        // previously didn't, which is exactly the observed flake ("No matches found ... 'passages'").
        let passages = app.buttons["passages"]
        XCTAssertTrue(passages.waitForExistence(timeout: 15), app.debugDescription)
        passages.press(forDuration: 0.15)
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "savedPassage_")).firstMatch
        if !row.waitForExistence(timeout: 3), passages.isHittable { passages.press(forDuration: 0.15) }
        XCTAssertTrue(row.waitForExistence(timeout: 15), app.debugDescription)
        row.press(forDuration: 0.15)
        // The arm controls enter the accessibility tree during the picker dismissal animation.
        // Wait until the picker is gone and the underlying score footer accepts input before tap 2.
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !app.navigationBars["Passages"].exists &&
                (passages.isHittable || app.scrollViews["accessiblePracticeControls"].exists)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 10), .completed, app.debugDescription)
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

    // Native pixel rounding can report a44pt frame as43.999999pt; allow0.01pt numerical tolerance.
    @MainActor private func logCompactGeometry(_ state: String, orientation: String, dock: XCUIElement, score: XCUIElement) {
        print("compact-geometry state=\(state) orientation=\(orientation) dockWidth=\(dock.frame.width) dockHeight=\(dock.frame.height) scoreHeight=\(score.frame.height)")
    }

    private func tempoBPM(_ element: XCUIElement) -> Int? {
        guard let value = element.value as? String else { return nil }
        return Int(value.prefix { $0.isNumber })
    }

    // MARK: - Today's "Start session" (§15) must not skip R3's cold grade (blocker)

    /// Today's one-tap "Start session" used to call `store.startSet` directly for a review/learning/
    /// new item, bypassing `PracticeArmController` — the only writer of `coldGrades` — entirely. On
    /// the seeded New passage (never graded) that put a set straight into `.running` with zero
    /// attempts and no cold grade recorded, so R4 could never advance its schedule. See "(C) Audit.md".
    @MainActor func testTodayStartSessionGoesThroughColdGradeForANewPassage() {
        let app = launch()
        let startSession = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "startSessionItem_new_")).firstMatch
        XCTAssertTrue(startSession.waitForExistence(timeout: 15), app.debugDescription)
        startSession.press(forDuration: 0.15)
        // Landing on the score, the never-graded passage's cold-grade prompt must show — never a
        // running set with an unrecorded first attempt.
        let coldClean = app.buttons["coldGrade_clean"]
        XCTAssertTrue(coldClean.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.buttons["verdict_clean"].exists, "Starting from Today must not skip R3's cold grade.\n\(app.debugDescription)")
        screenshot("loop-06-today-start-session-cold-grade", app: app)
        coldClean.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        ensureExpanded(app)
        XCTAssertTrue(app.staticTexts["1 of 5 clean"].waitForExistence(timeout: 15), app.debugDescription)
    }

    @MainActor func testTodayStartSessionBeginsTheFirstWarmup() {
        let app = launch()
        let startSession = app.buttons["startSession"]
        XCTAssertTrue(startSession.waitForExistence(timeout: 15), app.debugDescription)
        startSession.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["closeWarmupPractice"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.staticTexts["warmupProgress"].exists, app.debugDescription)
        screenshot("loop-today-start-first-warmup", app: app)
    }

    @MainActor func testCompactNavigationKeepsPracticeTabsAndSecondaryViewsReachable() throws {
        let app = launch()
        let tabs = app.tabBars.firstMatch
        guard tabs.waitForExistence(timeout: 2) else { throw XCTSkip("Sidebar navigation is active on this form factor.") }
        for title in ["Today", "Pieces", "Warmups", "Progress", "More"] {
            XCTAssertTrue(tabs.buttons[title].isHittable, app.debugDescription)
        }
        tabs.buttons["More"].press(forDuration: 0.15)
        for title in ["Friends", "History", "Calendar", "Notebook", "Data", "Rewards"] {
            XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 10), app.debugDescription)
        }
        screenshot("loop-compact-more-navigation", app: app)
    }

    @MainActor func testMacTransferEntryExplainsScopeAndOpensFiles() {
        let app = launch()
        let settings = app.buttons["appSettings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 15), app.debugDescription)
        settings.press(forDuration: 0.15)
        let settingsTitle = app.navigationBars["Settings"]
        if !settingsTitle.waitForExistence(timeout: 3), settings.isHittable {
            settings.press(forDuration: 0.15)
        }
        XCTAssertTrue(settingsTitle.waitForExistence(timeout: 10), app.debugDescription)
        let entry = app.buttons["Import from Mac"]
        let settingsList = app.collectionViews.firstMatch
        for _ in 0..<8 where !entry.exists || !entry.isHittable { settingsList.swipeUp() }
        XCTAssertTrue(entry.waitForExistence(timeout: 10), app.debugDescription)
        entry.press(forDuration: 0.15)
        let choose = app.buttons["Choose Mac transfer"]
        XCTAssertTrue(choose.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(choose.isEnabled)
        screenshot("loop-mac-transfer-entry", app: app)
        choose.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 10), app.debugDescription)
        screenshot("loop-mac-transfer-files-picker", app: app)
    }

    /// Opt-in private audit: the export stays outside the repository and ordinary CI skips it.
    @MainActor func testPrivateDesktopTransferOpensARealScoreAndPassage() throws {
        let path = "/tmp/praelude-desktop-audit-transfer.json"
        guard FileManager.default.fileExists(atPath: path) else { throw XCTSkip("No private desktop audit transfer supplied.") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--desktop-transfer", path]
        app.launch()
        let piece = app.buttons.matching(NSPredicate(format: "label MATCHES %@", ".*[0-9]+ pages.*")).firstMatch
        XCTAssertTrue(piece.waitForExistence(timeout: 30), app.debugDescription)
        for _ in 0..<5 where !piece.isHittable { app.swipeUp() }
        piece.press(forDuration: 0.15)
        let passages = app.buttons["passages"]
        if !passages.waitForExistence(timeout: 3), piece.isHittable { piece.press(forDuration: 0.15) }
        XCTAssertTrue(passages.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.buttons["pageIndicator"].exists)
        screenshot("private-imported-score", app: app)
        let score = app.otherElements["scorePDF"].firstMatch
        let compactFrame = score.frame
        app.buttons["armToggleOptions"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["armGoal"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertLessThan(score.frame.height, compactFrame.height - 50)
        app.buttons["armToggleOptions"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["armStartSet"].isHittable)
        XCTAssertEqual(score.frame.height, compactFrame.height, accuracy: 1)
        choosePassage(app)
        XCTAssertTrue(app.buttons["coldGrade_clean"].waitForExistence(timeout: 15), app.debugDescription)
        screenshot("private-imported-passage", app: app)
        app.buttons["coldGrade_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        let initialPage = app.buttons["pageIndicator"].label
        app.buttons["verdict_sloppy"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["undoRep"].isEnabled)
        XCTAssertEqual(app.buttons["pageIndicator"].label, initialPage, "A retry must leave the multi-page passage on the same page by default.")
        screenshot("private-imported-running-passage", app: app)
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
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.buttons["coldGrade_clean"].exists, app.debugDescription)
        app.buttons["armStartSet"].press(forDuration: 0.15)
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
        XCTAssertTrue(app.staticTexts["0 of 5 clean"].waitForExistence(timeout: 15),
                      "A cold Shaky is recorded as the set's first attempt, but as Sloppy — it must not count toward the clean streak.\n\(app.debugDescription)")
    }

    // MARK: - Tempo drag (§10a: drag/scroll on the numeral, never a modal/keyboard)

    @MainActor func testTempoDragAdjustsTheArmedTempo() {
        let app = launch()
        openScore(app)
        // Whole-piece practice (no passage chosen yet) is armed immediately on opening the score,
        // and is never cold-gated — its tempo dial is interactive right away.
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 15), app.debugDescription)
        let tempo = app.descendants(matching: .any).matching(identifier: "tempoDialValue").element
        XCTAssertTrue(tempo.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(tempoBPM(tempo), 60, app.debugDescription)
        let start = tempo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = tempo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: -22))
        start.press(forDuration: 0.05, thenDragTo: end)
        let raised = tempoBPM(tempo)
        XCTAssertNotNil(raised, app.debugDescription)
        XCTAssertGreaterThan(raised ?? 0, 60, "Dragging up on the tempo numeral must raise it directly — no modal or keyboard.\n\(app.debugDescription)")
        screenshot("loop-03-tempo-drag", app: app)
        // Expanded options keep the full tempo controls inline, with no modal or keyboard.
        app.buttons["armToggleOptions"].press(forDuration: 0.15)
        let plusFive = app.buttons["Increase tempo by 5"]
        XCTAssertTrue(plusFive.waitForExistence(timeout: 15), app.debugDescription)
        let afterTap = raised ?? 0
        plusFive.press(forDuration: 0.15)
        XCTAssertEqual(tempoBPM(tempo), afterTap + 5, app.debugDescription)
    }

    // MARK: - Cold grading while the click is already at a different tempo

    /// The click is left running at some unrelated tempo (300 bpm, the metronome's own slider max),
    /// then a never-graded passage (armed at 60 bpm) is cold-graded Clean. This used to throw "The
    /// click was restored to your set tempo" on the set's own first attempt — a broken half-state
    /// (cold grade and schedule already saved, but the attempt itself lost, and every later "Clean"
    /// failing too) — because the metronome was only retuned *after* `PracticeArmController.start`
    /// had already tried (and failed) to record through the mismatched click. See "(C) Audit.md".
    @MainActor func testColdGradingWithTheClickAlreadyAtADifferentTempoStillRecordsTheFirstAttempt() {
        let app = launch()
        openScore(app)
        app.buttons["openMetronome"].press(forDuration: 0.15)
        let increase = app.buttons["Increase tempo by 5"]
        XCTAssertTrue(increase.waitForExistence(timeout: 10), app.debugDescription)
        increase.press(forDuration: 0.15) // A deliberate different tempo from the passage's default.
        app.buttons["toggleMetronome"].press(forDuration: 0.15)
        XCTAssertEqual(app.buttons["toggleMetronome"].label, "Stop", "The click must actually be playing for this to reproduce the bug.\n\(app.debugDescription)")
        screenshot("loop-09-metronome-forced-mismatch", app: app)
        app.buttons["Done"].press(forDuration: 0.15)
        choosePassage(app)
        let coldClean = app.buttons["coldGrade_clean"]
        XCTAssertTrue(coldClean.waitForExistence(timeout: 15), app.debugDescription)
        coldClean.press(forDuration: 0.15)
        let mismatch = app.staticTexts["The click was restored to your set tempo. Repeat the passage before recording it."]
        XCTAssertTrue(mismatch.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(coldClean.exists, "A mismatched first attempt must retain the grade prompt without saving a different BPM.")
        coldClean.press(forDuration: 0.15) // The player reports a new attempt after the click was restored.
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        ensureExpanded(app)
        XCTAssertTrue(app.staticTexts["1 of 5 clean"].waitForExistence(timeout: 15),
                      "The cold grade's own first attempt must actually be recorded, not lost to a tempo-mismatch throw.\n\(app.debugDescription)")
        screenshot("loop-10-cold-grade-survives-tempo-mismatch", app: app)
        // A follow-up voice-equivalent verdict (the regular touch path here) must keep working too —
        // the original bug also left every later "Clean" failing for the rest of the set.
        app.buttons["verdict_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["2 of 5 clean"].waitForExistence(timeout: 15), app.debugDescription)
    }

    // MARK: - Tempo while running (§10a: "never a modal", even mid-set)

    /// The HUD's own tempo dial used to be `locked` (no gesture, no ±5 buttons, 55% opacity) for the
    /// whole time a set was running — see "(C) Audit.md".
    @MainActor func testRunningSetTempoIsAdjustableViaTheHUDDial() {
        let app = launch()
        openScore(app)
        choosePassage(app)
        app.buttons["coldGrade_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        ensureExpanded(app)
        let tempo = app.descendants(matching: .any).matching(identifier: "tempoDialValue").element
        XCTAssertTrue(tempo.waitForExistence(timeout: 15), app.debugDescription)
        let before = tempoBPM(tempo)
        XCTAssertNotNil(before, app.debugDescription)
        let start = tempo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = tempo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: -22))
        start.press(forDuration: 0.05, thenDragTo: end)
        let dragged = tempoBPM(tempo)
        XCTAssertNotNil(dragged, app.debugDescription)
        XCTAssertGreaterThan(dragged ?? 0, before ?? 0,
                             "Dragging the HUD's tempo numeral must raise the running set's own tempo.\n\(app.debugDescription)")
        screenshot("loop-07-running-tempo-drag", app: app)
        let plusFive = app.buttons["Increase tempo by 5"]
        XCTAssertTrue(plusFive.waitForExistence(timeout: 15), app.debugDescription)
        let afterDrag = dragged ?? 0
        plusFive.press(forDuration: 0.15)
        XCTAssertEqual(tempoBPM(tempo), afterDrag + 5, app.debugDescription)
        // The set must still be running throughout — a tempo change is not a stop/reset.
        XCTAssertTrue(app.buttons["verdict_clean"].exists, app.debugDescription)
    }

    // MARK: - Score focus hides counting controls while preserving the current set

    @MainActor func testFocusModeHidesPracticeControlsPreservesCounterAndResumesCounting() {
        let app = launch()
        openScore(app); choosePassage(app)
        app.buttons["coldGrade_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        ensureExpanded(app)
        XCTAssertTrue(app.staticTexts["1 of 5 clean"].waitForExistence(timeout: 15), app.debugDescription)
        let progress = app.staticTexts["repProgress"]
        XCTAssertTrue(progress.exists, app.debugDescription)
        let before = progress.label
        app.buttons["Score options"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["enterScoreFocus"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["enterScoreFocus"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["exitScoreFocus"].waitForExistence(timeout: 10), app.debugDescription)
        screenshot("loop-08-focus-mode-counter-hidden", app: app)
        for identifier in ["verdict_clean", "verdict_sloppy", "verdict_again", "undoRep", "stopSet", "toggleMetronomeHUD"] {
            XCTAssertFalse(app.buttons[identifier].exists, "\(identifier) must be hidden while rep input is suspended.\n\(app.debugDescription)")
        }
        XCTAssertFalse(progress.exists, "The counter must leave the score visible in focus mode")
        app.buttons["exitScoreFocus"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10), app.debugDescription)
        ensureExpanded(app)
        XCTAssertEqual(progress.label, before, "Entering and leaving focus must preserve the same repetition count")
        app.buttons["verdict_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["2 of 5 clean"].waitForExistence(timeout: 15), app.debugDescription)
        app.buttons["undoRep"].press(forDuration: 0.15)
        XCTAssertEqual(progress.label, before, "Counting and Undo resume against the existing set")
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

    /// Saved-rep acknowledgement must not refit or shift the notation. Every fallback control
    /// must also fit completely inside the viewport, including the compact phone layout.
    @MainActor func testPracticeControlsFitAndFeedbackKeepsScoreStable() {
        let app = launch()
        let start = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "startSessionItem_new_")).firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 15), app.debugDescription)
        start.press(forDuration: 0.15)
        if !app.buttons["coldGrade_clean"].waitForExistence(timeout: 3), start.isHittable {
            start.press(forDuration: 0.15)
        }
        XCTAssertTrue(app.buttons["coldGrade_clean"].waitForExistence(timeout: 15), app.debugDescription)
        app.buttons["coldGrade_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        ensureExpanded(app)
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        let screen = app.frame
        for identifier in ["verdict_clean", "verdict_sloppy", "verdict_again", "undoRep", "pausePractice", "stopSet", "toggleMetronomeHUD", "quickSubPassage"] {
            let button = app.buttons[identifier]
            XCTAssertTrue(button.isHittable, identifier)
            XCTAssertGreaterThanOrEqual(button.frame.minX, screen.minX, identifier)
            XCTAssertLessThanOrEqual(button.frame.maxX, screen.maxX, identifier)
            XCTAssertGreaterThanOrEqual(button.frame.minY, screen.minY, identifier)
            XCTAssertLessThanOrEqual(button.frame.maxY, screen.maxY, identifier)
        }
        let score = app.otherElements["scorePDF"].firstMatch
        XCTAssertTrue(score.exists, app.debugDescription)
        let before = score.frame
        app.buttons["verdict_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["2 of 5 clean"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(score.frame.minY, before.minY, accuracy: 1)
        XCTAssertEqual(score.frame.height, before.height, accuracy: 1)
        app.buttons["verdict_sloppy"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["0 of 5 clean"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(score.frame.minY, before.minY, accuracy: 1)
        XCTAssertEqual(score.frame.height, before.height, accuracy: 1)
        screenshot("loop-practice-controls-and-stable-score", app: app)
    }

    // MARK: - HUD collapse (§10c: collapsible to a thin strip; §3d: controls always one tap)

    @MainActor func testHUDCollapseKeepsControlsReachable() {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launch(); openScore(app); choosePassage(app)
        // Declining the first-attempt grade leaves the ordinary HUD without a cold-review banner;
        // microphone/status and deliberate rule banners have their own additional space.
        app.buttons["skipColdGrade"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 15), app.debugDescription)
        ensureExpanded(app)
        let collapse = app.buttons["hudCollapse"]
        XCTAssertTrue(collapse.waitForExistence(timeout: 15), app.debugDescription)
        collapse.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["hudExpand"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.buttons["hudCollapse"].exists)
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let progress = app.staticTexts["repProgress"]
        let score = app.descendants(matching: .any).matching(identifier: "scorePDF").firstMatch
        let dock = app.descendants(matching: .any).matching(identifier: "scorePracticeDock").firstMatch
        for (orientation, name) in [(UIDeviceOrientation.portrait, "portrait"), (.landscapeLeft, "landscape")] {
            XCUIDevice.shared.orientation = orientation
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                app.buttons["verdict_clean"].isHittable &&
                    (name == "portrait" ? app.frame.height > app.frame.width : app.frame.width > app.frame.height)
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 10), .completed, app.debugDescription)
            XCTAssertLessThanOrEqual(dock.frame.height, isPad ? 140 : 220,
                                    "The ordinary collapsed HUD plus score modes must preserve score space.")
            for identifier in ["verdict_clean", "verdict_sloppy", "verdict_again", "undoRep", "pausePractice", "stopSet", "toggleMetronomeHUD"] {
                let button = app.buttons[identifier]
                // Undo is disabled until the first saved rep, but its hit area must already fit.
                if identifier != "undoRep" { XCTAssertTrue(button.isHittable, identifier + "\n" + app.debugDescription) }
                XCTAssertGreaterThanOrEqual(button.frame.width, 44 - 0.01, identifier)
                XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.01, identifier)
                XCTAssertTrue(dock.frame.insetBy(dx: -1, dy: -1).contains(button.frame), identifier)
            }
            let tempo = app.descendants(matching: .any).matching(identifier: "tempoDialValue").element
            XCTAssertTrue(tempo.isHittable, app.debugDescription)
            XCTAssertGreaterThanOrEqual(tempo.frame.width, 44 - 0.01)
            XCTAssertGreaterThanOrEqual(tempo.frame.height, 44 - 0.01)
            XCTAssertTrue(dock.frame.insetBy(dx: -1, dy: -1).contains(tempo.frame))
            XCTAssertEqual(progress.label, "0 of 5 clean")
            let before = score.frame
            logCompactGeometry("collapsed-HUD", orientation: name, dock: dock, score: score)
            app.buttons["verdict_clean"].press(forDuration: 0.15)
            let saved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "1 of 5 clean"), object: progress)
            XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 10), .completed, app.debugDescription)
            XCTAssertEqual(score.frame.minX, before.minX, accuracy: 1)
            XCTAssertEqual(score.frame.minY, before.minY, accuracy: 1)
            XCTAssertEqual(score.frame.width, before.width, accuracy: 1)
            XCTAssertEqual(score.frame.height, before.height, accuracy: 1)
            let undo = app.buttons["undoRep"]
            XCTAssertTrue(undo.isEnabled); XCTAssertTrue(undo.isHittable)
            undo.press(forDuration: 0.15)
            let reversed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "0 of 5 clean"), object: progress)
            XCTAssertEqual(XCTWaiter.wait(for: [reversed], timeout: 10), .completed, app.debugDescription)
            XCTAssertEqual(score.frame.minX, before.minX, accuracy: 1)
            XCTAssertEqual(score.frame.minY, before.minY, accuracy: 1)
            XCTAssertEqual(score.frame.width, before.width, accuracy: 1)
            XCTAssertEqual(score.frame.height, before.height, accuracy: 1)
            screenshot("compact-collapsed-HUD-verdict-undo-" + name, app: app)
        }
        app.buttons["hudExpand"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["hudCollapse"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.staticTexts["0 of 5 clean"].exists, "Undo must also be reflected in the expanded readout.")
    }
    @MainActor func testTechniqueChoicePreservesColdGateAndRepeatSettings() {
        let app = launch(); openScore(app); choosePassage(app)
        XCTAssertTrue(app.buttons["coldGrade_clean"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.staticTexts["armedConditions"].exists)
        app.buttons["armVariants"].press(forDuration: 0.15)
        let choice = app.buttons["technique_rhythmPair"]
        XCTAssertTrue(choice.waitForExistence(timeout: 10), app.debugDescription)
        choice.press(forDuration: 0.15)
        let decrease = app.steppers.firstMatch.buttons["Decrement"]
        XCTAssertTrue(decrease.waitForExistence(timeout: 10), app.debugDescription)
        decrease.press(forDuration: 0.15) // First stage 2; the other two remain 3.
        screenshot("practice-technique-editable-chain", app: app)
        app.buttons["Done"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["coldGrade_clean"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["armedConditions"].label.contains("3 stages"), app.debugDescription)
        app.buttons["More options"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["confirmStartSet"].waitForExistence(timeout: 10))
        app.buttons["confirmStartSet"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["coldGrade_clean"].waitForExistence(timeout: 10), "Editing settings must retain the first-attempt choice.")
        screenshot("practice-selected-technique-before-grading", app: app)
        app.buttons["skipColdGrade"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10), app.debugDescription)
        ensureExpanded(app)
        XCTAssertTrue(app.staticTexts["0 of 2 clean"].exists, "Starting without grading must not invent a repetition.")
        for _ in 0..<8 { app.buttons["verdict_clean"].press(forDuration: 0.15) }
        XCTAssertTrue(app.staticTexts["Set complete"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["Another set"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["coldGrade_clean"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["armedConditions"].label.contains("3 stages"))
        screenshot("practice-repeated-technique-settings", app: app)
    }

    @MainActor func testPassageSearchFindsTheCurrentSection() {
        let app = launch(); openScore(app)
        let passages = app.buttons["passages"]
        XCTAssertTrue(passages.waitForExistence(timeout: 10))
        passages.press(forDuration: 0.15)
        let search = app.searchFields.firstMatch
        if !search.waitForExistence(timeout: 3), passages.isHittable { passages.press(forDuration: 0.15) }
        XCTAssertTrue(search.waitForExistence(timeout: 10), app.debugDescription)
        search.press(forDuration: 0.15); search.typeText("Evenness")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "savedPassage_")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        screenshot("practice-search-current-page-section", app: app)
        row.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["coldGrade_clean"].waitForExistence(timeout: 10))
    }

    @MainActor func testSwitchingVisualSectionsRequiresFinishingTheCurrentSet() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--seed-sections"]
        app.launch(); openScore(app); choosePassage(app)
        app.buttons["skipColdGrade"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10))
        app.buttons["verdict_clean"].press(forDuration: 0.15)
        app.buttons["passages"].press(forDuration: 0.15)
        let next = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Phrase connection")).firstMatch
        XCTAssertTrue(next.waitForExistence(timeout: 10), app.debugDescription)
        next.press(forDuration: 0.15)
        let finish = app.buttons["Finish current set and switch"]
        XCTAssertTrue(finish.waitForExistence(timeout: 10), app.debugDescription)
        screenshot("practice-explicit-section-switch", app: app)
        app.buttons["Keep current passage"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10))
        app.buttons["passages"].press(forDuration: 0.15)
        XCTAssertTrue(next.waitForExistence(timeout: 10)); next.press(forDuration: 0.15)
        XCTAssertTrue(finish.waitForExistence(timeout: 10)); finish.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["coldGrade_clean"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Phrase connection"].exists)
        screenshot("practice-visual-next-section-ready", app: app)
    }

    @MainActor func testLargestTextDarkOpaquePracticeControlsRemainReachable() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--seed-sections", "--audit-dark", "--audit-accessibility",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch(); openScore(app); choosePassage(app)
        screenshot("practice-largest-text-dark-opaque-ready", app: app)
        let scroll = app.scrollViews["accessiblePracticeControls"]
        let ungraded = app.buttons["skipColdGrade"]
        for _ in 0..<6 where !ungraded.isHittable { scroll.swipeUp() }
        XCTAssertTrue(ungraded.isHittable, app.debugDescription)
        ungraded.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10))
        for identifier in ["verdict_clean", "verdict_sloppy", "verdict_again", "undoRep", "pausePractice", "stopSet"] {
            let button = app.buttons[identifier]
            for _ in 0..<6 where !button.isHittable { scroll.swipeUp() }
            XCTAssertTrue(button.isHittable, identifier + "\n" + app.debugDescription)
            XCTAssertGreaterThanOrEqual(button.frame.minX, app.frame.minX)
            XCTAssertLessThanOrEqual(button.frame.maxX, app.frame.maxX)
        }
        screenshot("practice-largest-text-dark-opaque-running", app: app)
    }

    @MainActor func testMetronomeIsImmediatelyEditableBeforeFirstAttempt() {
        let app = launch(); openScore(app); choosePassage(app)
        let toggle = app.buttons["armMetronome"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(toggle.isHittable, app.debugDescription)
        let initial = toggle.value as? String
        toggle.press(forDuration: 0.15)
        XCTAssertNotEqual(toggle.value as? String, initial)
        XCTAssertTrue(app.buttons["coldGrade_clean"].exists)
        screenshot("practice-metronome-before-first-attempt", app: app)
        app.buttons["More options"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["confirmStartSet"].waitForExistence(timeout: 10))
        app.buttons["confirmStartSet"].press(forDuration: 0.15)
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        XCTAssertNotEqual(toggle.value as? String, initial, "Advanced settings must retain the chosen click state.")
    }

    @MainActor func testHandTechniqueSheetKeepsItsHeightWhileScrolling() {
        let app = launch(); openScore(app); choosePassage(app)
        let techniques = app.buttons["armVariants"]
        XCTAssertTrue(techniques.waitForExistence(timeout: 10), app.debugDescription)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in techniques.isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed, app.debugDescription)
        techniques.press(forDuration: 0.15)
        let navigation = app.navigationBars["Practice techniques"]
        XCTAssertTrue(navigation.waitForExistence(timeout: 10), app.debugDescription)
        let initialTop = navigation.frame.minY
        let leftHand = app.buttons["technique_leftHand"]
        for _ in 0..<4 where !leftHand.isHittable { app.swipeUp() }
        XCTAssertTrue(leftHand.isHittable, app.debugDescription)
        XCTAssertEqual(navigation.frame.minY, initialTop, accuracy: 2, "Scrolling should move the list inside the sheet.")
        leftHand.press(forDuration: 0.15)
        screenshot("practice-left-hand-technique", app: app)
        app.buttons["Done"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["coldGrade_clean"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["armedConditions"].label.contains("1 stage"), app.debugDescription)
    }

    /// Run on both iPad and iPhone: normal text has a bounded dock in either orientation, and
    /// wide layouts use the second column instead of wasting the newly available score width.
    @MainActor func testPracticeArmKeepsScoreSpaceAndSecondaryActionsInline() {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launch(); openScore(app)
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        for (orientation, name) in [(UIDeviceOrientation.portrait, "portrait"), (.landscapeLeft, "landscape")] {
            XCUIDevice.shared.orientation = orientation
            let start = app.buttons["armStartSet"]
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                start.isHittable && (name == "portrait" ? app.frame.height > app.frame.width : app.frame.width > app.frame.height)
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 10), .completed, app.debugDescription)
            let dock = app.descendants(matching: .any).matching(identifier: "scorePracticeDock").firstMatch
            XCTAssertLessThanOrEqual(dock.frame.height, isPad ? 160 : 190,
                                    "Ordinary setup should keep Start and secondary actions compact.")
            for button in [start, app.buttons["armVariants"], app.buttons["More options"], app.buttons["armMetronome"]] {
                XCTAssertTrue(button.isHittable, app.debugDescription)
                XCTAssertGreaterThanOrEqual(button.frame.width, 44 - 0.01)
                XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.01)
                XCTAssertTrue(dock.frame.insetBy(dx: -1, dy: -1).contains(button.frame))
            }
            XCTAssertFalse(app.buttons["skipColdGrade"].exists)
            let score = app.descendants(matching: .any).matching(identifier: "scorePDF").firstMatch
            logCompactGeometry("idle-arm", orientation: name, dock: dock, score: score)
            screenshot("compact-arm-idle-" + name, app: app)
        }
        XCUIDevice.shared.orientation = .portrait
        choosePassage(app)
        for (orientation, name) in [(UIDeviceOrientation.portrait, "portrait"), (.landscapeLeft, "landscape")] {
            XCUIDevice.shared.orientation = orientation
            let clean = app.buttons["coldGrade_clean"]
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                clean.isHittable && (name == "portrait" ? app.frame.height > app.frame.width : app.frame.width > app.frame.height)
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 10), .completed, app.debugDescription)
            let dock = app.descendants(matching: .any).matching(identifier: "scorePracticeDock").firstMatch
            XCTAssertTrue(dock.exists, app.debugDescription)
            XCTAssertLessThanOrEqual(dock.frame.height, isPad ? 190 : 240,
                                    "Cold-attempt setup plus score modes must preserve score space.\n" + app.debugDescription)
            let identifiers = ["coldGrade_missed", "coldGrade_shaky", "coldGrade_clean", "skipColdGrade", "armVariants", "armMetronome", "armToggleOptions"]
            for identifier in identifiers {
                let button = app.buttons[identifier]
                XCTAssertTrue(button.isHittable, identifier + "\n" + app.debugDescription)
                XCTAssertGreaterThanOrEqual(button.frame.width, 44 - 0.01)
                XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.01)
                XCTAssertTrue(dock.frame.insetBy(dx: -1, dy: -1).contains(button.frame), identifier + " must fit in the dock")
            }
            let skip = app.buttons["skipColdGrade"], techniques = app.buttons["armVariants"], options = app.buttons["More options"]
            XCTAssertTrue(options.isHittable, app.debugDescription)
            XCTAssertEqual(skip.frame.midY, techniques.frame.midY, accuracy: 2)
            XCTAssertEqual(techniques.frame.midY, options.frame.midY, accuracy: 2)
            XCTAssertLessThanOrEqual(skip.frame.height, 46)
            XCTAssertLessThanOrEqual(techniques.frame.height, 46)
            XCTAssertLessThanOrEqual(options.frame.height, 46)
            if dock.frame.width >= 740 {
                let metadata = app.staticTexts["armedConditions"]
                XCTAssertGreaterThan(clean.frame.minX, metadata.frame.maxX,
                                     "A wide score should put cold verdicts beside the setup metadata.")
                let missed = app.buttons["coldGrade_missed"]
                XCTAssertLessThan(missed.frame.minY, skip.frame.maxY,
                                  "Wide columns should share vertical space instead of becoming separate blocks.")
                XCTAssertGreaterThan(missed.frame.maxY, metadata.frame.minY)
            }
            let pdf = app.descendants(matching: .any).matching(identifier: "scorePDF").firstMatch
            XCTAssertGreaterThan(pdf.frame.height, 0)
            XCTAssertLessThanOrEqual(pdf.frame.maxY, dock.frame.minY + 1, "Setup must not cover notation.")
            logCompactGeometry("cold-arm", orientation: name, dock: dock, score: pdf)
            screenshot("compact-arm-" + name, app: app)
        }
        app.buttons["coldGrade_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 10))
        ensureExpanded(app)
        XCTAssertTrue(app.staticTexts["1 of 5 clean"].waitForExistence(timeout: 10),
                      "The compact cold-grade control must still save the first actual repetition.")
    }

    @MainActor func testPracticeArmLargestTextPreservesCompleteReachableActions() {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch(); openScore(app); choosePassage(app)
        let panel = app.scrollViews["accessiblePracticeControls"]
        XCTAssertTrue(panel.waitForExistence(timeout: 10), app.debugDescription)
        for (orientation, name) in [(UIDeviceOrientation.portrait, "portrait"), (.landscapeLeft, "landscape")] {
            XCUIDevice.shared.orientation = orientation
            let rotated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                name == "portrait" ? app.frame.height > app.frame.width : app.frame.width > app.frame.height
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [rotated], timeout: 10), .completed)
            for (identifier, title) in [("coldGrade_missed", "Missed"), ("coldGrade_shaky", "Shaky"), ("coldGrade_clean", "Clean"),
                                        ("skipColdGrade", "Start without grading"), ("armVariants", "Techniques"),
                                        ("More options", "More options")] {
                let button = app.buttons[identifier]
                for _ in 0..<10 {
                    if button.isHittable && panel.frame.insetBy(dx: -1, dy: -1).contains(button.frame) { break }
                    if button.exists && button.frame.minY < panel.frame.minY { panel.swipeDown() }
                    else { panel.swipeUp() }
                }
                XCTAssertTrue(button.isHittable, identifier + "\n" + app.debugDescription)
                XCTAssertEqual(button.label, title)
                XCTAssertTrue(panel.frame.insetBy(dx: -1, dy: -1).contains(button.frame), "The complete action must be reachable.")
                XCTAssertGreaterThanOrEqual(button.frame.width, 44 - 0.01)
                XCTAssertGreaterThanOrEqual(button.frame.height, 44 - 0.01)
                let text = button.staticTexts[title]
                if text.exists { XCTAssertTrue(button.frame.insetBy(dx: -1, dy: -1).contains(text.frame), "The whole label must fit.") }
            }
            let pdf = app.descendants(matching: .any).matching(identifier: "scorePDF").firstMatch
            XCTAssertGreaterThan(min(pdf.frame.maxY, panel.frame.minY) - max(pdf.frame.minY, app.frame.minY), 0)
            let dock = app.descendants(matching: .any).matching(identifier: "scorePracticeDock").firstMatch
            logCompactGeometry("accessibility-arm", orientation: name, dock: dock, score: pdf)
            screenshot("compact-arm-largest-text-" + name, app: app)
        }
    }

}
