import XCTest
import UIKit

final class PraeludeUITests: XCTestCase {
    // Use single 150 ms presses after observing lost 50 ms touches on this simulator host.
    // No interaction retries: every action must produce its expected native state.

    @MainActor private func launch(seed: Bool = true, reset: Bool = true) -> XCUIApplication {
        continueAfterFailure = false
        // XCTest can abort a preceding rotation test without executing its Swift defer.
        // Every main smoke flow starts independently of that simulator orientation.
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting"] + (reset ? ["--reset"] : []) + (seed ? ["--seed"] : [])
        app.launch()
        return app
    }
    @MainActor private func openScore(_ app: XCUIApplication) {
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 1), hideSidebar.isHittable { hideSidebar.press(forDuration: 0.15) }

        // On phones, Today places recent pieces below its session plan and statistics. Those
        // List rows are virtualized, so waiting for a piece before scrolling cannot find it.
        // The visible Pieces tab provides the direct library route instead.
        let piecesTab = app.tabBars.buttons["Pieces"]
        if piecesTab.exists, piecesTab.isHittable {
            piecesTab.press(forDuration: 0.15)
            XCTAssertTrue(app.navigationBars["Pieces"].waitForExistence(timeout: 5), app.debugDescription)
        }
        let piece = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Practice study")).firstMatch
        func visibleViewport() -> CGRect {
            var viewport = app.frame
            if let bar = app.navigationBars.allElementsBoundByIndex.last(where: { $0.isHittable }) {
                let top = max(viewport.minY, bar.frame.maxY)
                viewport = CGRect(x: viewport.minX, y: top, width: viewport.width, height: max(0, viewport.maxY - top))
            }
            if app.tabBars.firstMatch.exists {
                viewport.size.height = max(0, min(viewport.maxY, app.tabBars.firstMatch.frame.minY) - viewport.minY)
            }
            return viewport
        }
        for _ in 0..<8 {
            if piece.exists, piece.isHittable, visibleViewport().contains(piece.frame) { break }
            let viewport = visibleViewport()
            XCTAssertGreaterThan(viewport.height, 60, app.debugDescription)
            let towardTop = piece.exists && piece.frame.minY < viewport.minY
            scroll(viewport, towardTop: towardTop, app: app)
        }
        XCTAssertTrue(piece.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(piece.isHittable && visibleViewport().contains(piece.frame), app.debugDescription)
        piece.press(forDuration: 0.15)
        // §10a: the arm panel is already showing with rule defaults filled — no separate "start set"
        // tap opens it first, that trip through a modal is exactly what this track removed.
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 5))
    }
    @MainActor private func scroll(_ viewport: CGRect, towardTop: Bool = false, app: XCUIApplication) {
        let base = app.coordinate(withNormalizedOffset: .zero)
        let start = base.withOffset(CGVector(dx: viewport.midX, dy: viewport.minY + viewport.height * (towardTop ? 0.35 : 0.75)))
        let end = base.withOffset(CGVector(dx: viewport.midX, dy: viewport.minY + viewport.height * (towardTop ? 0.75 : 0.35)))
        start.press(forDuration: 0.15, thenDragTo: end)
    }
    @MainActor private func startSet(_ app: XCUIApplication) {
        let start = app.buttons["armStartSet"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["verdict_clean"].waitForExistence(timeout: 5), app.debugDescription)
    }
    @MainActor private func screenshot(_ name: String) {
        RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testScorePracticeCorrectionAndRelaunch() {
        let app = launch()
        screenshot("01-today")
        openScore(app)
        screenshot("02-score")
        app.buttons["Next page"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Page 2 of 4"].exists)
        // The full manual editor is still reachable and still cancelable, one tap away.
        app.buttons["More options"].press(forDuration: 0.15)
        screenshot("03-set-sheet")
        app.buttons["Cancel"].press(forDuration: 0.15)
        startSet(app)
        app.buttons["verdict_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["1 of 5 clean"].exists)
        app.buttons["verdict_sloppy"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["0 of 5 clean"].exists)
        app.buttons["undoRep"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["1 of 5 clean"].exists)
        screenshot("04-practice")
        app.buttons["pausePractice"].press(forDuration: 0.15)
        XCTAssertFalse(app.buttons["verdict_clean"].isEnabled)
        app.terminate()
        app.launchArguments = ["--uitesting"]
        app.launch()
        let resume = app.buttons["resumePractice"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), app.debugDescription)
        resume.press(forDuration: 0.15)
        XCTAssertFalse(app.buttons["verdict_clean"].isEnabled)
        XCTAssertTrue(app.buttons["Page 2 of 4"].exists)
        app.buttons["pausePractice"].press(forDuration: 0.15)
        for _ in 0..<4 { app.buttons["verdict_clean"].press(forDuration: 0.15) }
        XCTAssertTrue(app.staticTexts["Set complete"].waitForExistence(timeout: 5))
        screenshot("05-completion")
        app.buttons["Finish"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 15), app.debugDescription)
    }
    @MainActor func testBlankInstallAndAddPaperPiece() {
        let app = launch(seed: false)
        XCTAssertFalse(app.staticTexts["Practice study"].exists)
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 1), hideSidebar.isHittable { hideSidebar.press(forDuration: 0.15) }
        let add = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Add your first piece")).firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 5), app.debugDescription)
        add.press(forDuration: 0.15)
        let title = app.textFields["pieceTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 5), app.debugDescription)
        title.press(forDuration: 0.15); title.typeText("My practice")
        app.buttons["savePiece"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 5), app.debugDescription)
        screenshot("06-paper-score")
    }
    @MainActor func testMetronomeAndPages() {
        let app = launch(); openScore(app)
        app.buttons["pageIndicator"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Page 3"].waitForExistence(timeout: 10))
        app.buttons["Page 3"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Page 3 of 4"].exists)
        app.buttons["openMetronome"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["toggleMetronome"].waitForExistence(timeout: 5))
        app.buttons["toggleMetronome"].press(forDuration: 0.15)
        screenshot("07-metronome")
        app.buttons["toggleMetronome"].press(forDuration: 0.15)
        app.buttons["Done"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 10))
    }
    @MainActor func testLandscapeLibraryPieceRemainsReachableAboveTabBar() {
        let app = launch()
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        // The seeded second library row begins below the narrow landscape list viewport.
        // openScore must scroll that list above the tab bar before performing its single tap.
        openScore(app)
        XCTAssertTrue(app.otherElements["scorePDF"].waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertTrue(app.buttons["armStartSet"].exists, app.debugDescription)
        screenshot("landscape-library-piece-opened")
    }
    @MainActor private func tapSettings(_ app: XCUIApplication) {
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 2), hideSidebar.isHittable { hideSidebar.press(forDuration: 0.15) }
        let query = app.buttons.matching(identifier: "appSettings")
        // Each tab owns a Settings toolbar; inactive tabs can expose zero-sized copies.
        // Asking those copies for hittability raises an XCTest activation-point error.
        func visibleSettings() -> XCUIElement? {
            query.allElementsBoundByIndex.first {
                let frame = $0.frame
                return frame.width > 1 && frame.height > 1 && app.frame.contains(frame) && $0.isHittable
            }
        }
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            visibleSettings() != nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 10), .completed, app.debugDescription)
        visibleSettings()?.press(forDuration: 0.15)
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), app.debugDescription)
    }
    @MainActor private func dismissFilePicker(_ app: XCUIApplication) {
        let picker = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "DOC.browsingRoot Source:")).firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 90), app.debugDescription)
        let cancel = app.buttons.matching(identifier: "Cancel").allElementsBoundByIndex.first { $0.isHittable }
        if let cancel {
            cancel.press(forDuration: 0.15)
        } else {
            // iOS 26's phone exporter presents a draggable sheet without a Cancel button.
            // Its phantom accessibility "Cancel" Other overlaps More and is not a control.
            let grabber = picker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.01))
            let bottom = picker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.88))
            grabber.press(forDuration: 0.15, thenDragTo: bottom)
        }
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: picker)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed, app.debugDescription)
    }
    @MainActor func testBackupDialogsAndDarkAppearance() {
        let app = launch()
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 1), hideSidebar.isHittable { hideSidebar.press(forDuration: 0.15) }
        tapSettings(app)
        let appearance = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Appearance")).firstMatch
        XCTAssertTrue(appearance.waitForExistence(timeout: 5), app.debugDescription)
        appearance.press(forDuration: 0.15)
        app.buttons["Dark"].press(forDuration: 0.15)
        app.buttons["Done"].press(forDuration: 0.15)
        openScore(app)
        startSet(app)
        screenshot("08-dark-practice")
        app.buttons.matching(identifier: "Close score").firstMatch.press(forDuration: 0.15)
        tapSettings(app)
        let exportBackup = app.buttons["Export backup"]
        // Scroll first, not a bare press or a plain wait: Settings is a fixed-height popover on
        // this iPad width, and the Instruments/Rewards sections added above it (after this test
        // was first written) now push this row below the fold — a row that far off-screen in a
        // lazily-rendered Form is not materialized in the accessibility tree at all, so waiting
        // alone never finds it; only scrolling does.
        for _ in 0..<8 where !exportBackup.exists || !exportBackup.isHittable { app.swipeUp() }
        XCTAssertTrue(exportBackup.waitForExistence(timeout: 5), app.debugDescription)
        exportBackup.press(forDuration: 0.15)
        let picker = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "DOC.browsingRoot Source:")).firstMatch
        // Both Browse and Recents expose this document root; the phone exporter has no Cancel button.
        XCTAssertTrue(picker.waitForExistence(timeout: 90), app.debugDescription)
        screenshot("09-backup-exporter")
        dismissFilePicker(app)
        tapSettings(app)
        // Same fixed-height-popover scroll as `exportBackup` above — each `tapSettings` call
        // reopens Settings at its default (top) scroll position.
        let restoreBackup = app.buttons["Restore backup"]
        for _ in 0..<8 where !restoreBackup.exists || !restoreBackup.isHittable { app.swipeUp() }
        XCTAssertTrue(restoreBackup.waitForExistence(timeout: 5), app.debugDescription)
        restoreBackup.press(forDuration: 0.15)
        XCTAssertTrue(picker.waitForExistence(timeout: 90), app.debugDescription)
        dismissFilePicker(app)
        XCTAssertTrue(app.buttons["resumePractice"].exists)
    }

    @MainActor func testWarmupsPracticeAndRewardsScreens() {
        let app = launch()
        // A plain button lookup, not `app.tabBars` — on this iPad width the destination switcher
        // is the split view's sidebar list, not a `UITabBar`, matching every other test in this
        // suite (see `openScore`'s "Pieces" lookup above). The sidebar can start collapsed on
        // this simulator host (see `LibraryUITests.goToLibrary`'s identical retry) — nothing else
        // in this test has waited for it to expand, unlike `openScore`'s "Hide Sidebar" check.
        let warmupsTab = app.buttons["Warmups"]
        if !warmupsTab.waitForExistence(timeout: 2) {
            let showSidebar = app.buttons["Show Sidebar"]
            for _ in 0..<5 {
                if warmupsTab.waitForExistence(timeout: 1) { break }
                if showSidebar.exists, showSidebar.isHittable { showSidebar.press(forDuration: 0.15) }
            }
        }
        XCTAssertTrue(warmupsTab.waitForExistence(timeout: 5), app.debugDescription)
        warmupsTab.press(forDuration: 0.15)
        let next = app.buttons["warmupNextInRotation"]
        XCTAssertTrue(next.waitForExistence(timeout: 10), app.debugDescription)
        screenshot("10-warmups-library")
        next.press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["warmupVerdict_clean"].waitForExistence(timeout: 10), app.debugDescription)
        screenshot("11-warmup-practice")
        app.buttons["warmupVerdict_clean"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["warmupProgress"].waitForExistence(timeout: 5))
        screenshot("12-warmup-one-rep")
        let closeWarmup = app.buttons["closeWarmupPractice"]
        closeWarmup.press(forDuration: 0.15)
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: closeWarmup)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed, app.debugDescription)
        guard let resume = app.buttons.matching(identifier: "resumePractice").allElementsBoundByIndex.first(where: {
            let frame = $0.frame
            return frame.width > 1 && frame.height > 1 && app.frame.contains(frame) && $0.isHittable
        }) else {
            XCTFail("Closing mid-set must leave a visible resumable set, not discard it.\n" + app.debugDescription)
            return
        }
        // Both layouts keep Rewards in More; iPad uses a collapsible sidebar group.
        let more = app.tabBars.buttons["More"]
        if more.exists, more.isHittable {
            XCTAssertLessThanOrEqual(resume.frame.maxY, app.tabBars.firstMatch.frame.minY + 1,
                                     "The resume strip must sit above the tab bar, so tab taps cannot resume the set.\n" + app.debugDescription)
            more.press(forDuration: 0.15)
            XCTAssertTrue(app.navigationBars["More"].waitForExistence(timeout: 5), app.debugDescription)
        }
        let sidebarMore = app.buttons["More"]
        if !app.tabBars.buttons["More"].exists, !app.buttons["Rewards"].exists,
           sidebarMore.exists, sidebarMore.isHittable { sidebarMore.tap() }
        let rewards = app.buttons["Rewards"]
        for _ in 0..<6 {
            if rewards.exists, rewards.isHittable, app.frame.contains(rewards.frame) { break }
            let top = app.navigationBars.allElementsBoundByIndex.last(where: { $0.isHittable })?.frame.maxY ?? app.frame.minY
            let bottom = app.tabBars.firstMatch.exists ? app.tabBars.firstMatch.frame.minY : app.frame.maxY
            scroll(CGRect(x: app.frame.minX, y: top, width: app.frame.width, height: max(0, bottom - top)), app: app)
        }
        XCTAssertTrue(rewards.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(rewards.isHittable && app.frame.contains(rewards.frame), app.debugDescription)
        rewards.press(forDuration: 0.15)
        XCTAssertTrue(app.navigationBars["Rewards"].waitForExistence(timeout: 10), app.debugDescription)
        RunLoop.current.run(until: Date().addingTimeInterval(0.3)) // let the List finish laying out before capturing it
        screenshot("13-rewards")
        XCTAssertTrue(app.staticTexts["Your rank grows with recorded practice."].exists, app.debugDescription)
    }

    @MainActor func testLandscapeWarmupControlsCloseAndRewardsRemainReachable() {
        let app = launch()
        defer { XCUIDevice.shared.orientation = .portrait }
        let warmups = app.buttons["Warmups"]
        if !warmups.exists, app.buttons["Show Sidebar"].exists { app.buttons["Show Sidebar"].press(forDuration: 0.15) }
        XCTAssertTrue(warmups.waitForExistence(timeout: 5) && warmups.isHittable, app.debugDescription)
        warmups.press(forDuration: 0.15)
        let next = app.buttons["warmupNextInRotation"]
        XCTAssertTrue(next.waitForExistence(timeout: 8) && next.isHittable, app.debugDescription)
        next.press(forDuration: 0.15)
        let close = app.buttons["closeWarmupPractice"]
        XCTAssertTrue(close.waitForExistence(timeout: 8), app.debugDescription)
        XCUIDevice.shared.orientation = .landscapeLeft
        for control in [close, app.buttons["Pause practice"], app.buttons["warmupVerdict_again"],
                        app.buttons["warmupVerdict_sloppy"], app.buttons["warmupVerdict_clean"]] {
            let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                control.exists && control.isHittable && app.frame.contains(control.frame)
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 5), .completed, app.debugDescription)
            XCTAssertGreaterThanOrEqual(control.frame.height, 43.99)
        }
        app.buttons["warmupVerdict_clean"].press(forDuration: 0.15)
        let recorded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "1 of 5 clean"), object: app.staticTexts["warmupProgress"])
        XCTAssertEqual(XCTWaiter.wait(for: [recorded], timeout: 5), .completed, app.debugDescription)
        screenshot("landscape-warmup-controls-after-clean")
        close.press(forDuration: 0.15)
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: close)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed, app.debugDescription)
        guard let resume = app.buttons.matching(identifier: "resumePractice").allElementsBoundByIndex.first(where: {
            let frame = $0.frame
            return frame.width > 1 && frame.height > 1 && app.frame.contains(frame) && $0.isHittable
        }) else { XCTFail("The saved warmup must remain visibly resumable.\n" + app.debugDescription); return }
        let more = app.tabBars.buttons["More"]
        if more.exists {
            XCTAssertTrue(more.isHittable, app.debugDescription)
            XCTAssertLessThanOrEqual(resume.frame.maxY, app.tabBars.firstMatch.frame.minY + 1, app.debugDescription)
            more.press(forDuration: 0.15)
            XCTAssertTrue(app.navigationBars["More"].waitForExistence(timeout: 5), app.debugDescription)
        }
        guard let currentResume = app.buttons.matching(identifier: "resumePractice").allElementsBoundByIndex.first(where: {
            let frame = $0.frame
            return frame.width > 1 && frame.height > 1 && app.frame.contains(frame) && $0.isHittable
        }) else { XCTFail("Navigation must preserve the visible resume strip.\n" + app.debugDescription); return }
        let sidebarMore = app.buttons["More"]
        if !app.tabBars.buttons["More"].exists, !app.buttons["Rewards"].exists,
           sidebarMore.exists, sidebarMore.isHittable { sidebarMore.tap() }
        let rewards = app.buttons["Rewards"]
        var viewport = CGRect.zero
        for _ in 0..<8 {
            let top = app.navigationBars.allElementsBoundByIndex.last(where: { $0.isHittable })?.frame.maxY ?? app.frame.minY
            let bottom = min(currentResume.frame.minY, app.tabBars.firstMatch.exists ? app.tabBars.firstMatch.frame.minY : app.frame.maxY)
            viewport = CGRect(x: app.frame.minX, y: top, width: app.frame.width, height: max(0, bottom - top))
            XCTAssertGreaterThan(viewport.height, 60, app.debugDescription)
            if rewards.exists, rewards.isHittable, viewport.contains(rewards.frame) { break }
            scroll(viewport, app: app)
        }
        XCTAssertTrue(rewards.exists && rewards.isHittable && viewport.contains(rewards.frame), app.debugDescription)
        rewards.press(forDuration: 0.15)
        XCTAssertTrue(app.navigationBars["Rewards"].waitForExistence(timeout: 8), app.debugDescription)
        guard let rewardsResume = app.buttons.matching(identifier: "resumePractice").allElementsBoundByIndex.first(where: {
            let frame = $0.frame
            return frame.width > 1 && frame.height > 1 && app.frame.contains(frame) && $0.isHittable
        }) else { XCTFail("Pushed Rewards must keep the saved set visibly resumable.\n" + app.debugDescription); return }
        if app.tabBars.firstMatch.exists {
            XCTAssertLessThanOrEqual(rewardsResume.frame.maxY, app.tabBars.firstMatch.frame.minY + 1, app.debugDescription)
        }
        screenshot("landscape-warmup-closed-rewards")
    }

}
