import XCTest
import UIKit

/// Disposable multi-passage library only. Native tests verify finite ordering, saved-work clearing,
/// target/start separation and navigation on both form factors; no physical acceptance is inferred.
final class DailyPracticeUITests: XCTestCase {
    private let recallID = "00000000-0000-4000-8000-000000000141"

    @MainActor private func launch(largeText: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--audit-daily-plan"]
        if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        app.launch()
        let hide = app.buttons["hideAppSidebar"]
        if hide.waitForExistence(timeout: 1), hide.isHittable { hide.tap() }
        return app
    }

    @MainActor private func capture(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }

    @MainActor private func reveal(_ element: XCUIElement, app: XCUIApplication, scrollID: String? = nil, towardTop: Bool = false) {
        for _ in 0..<18 {
            let scroll = scrollID.map { app.descendants(matching: .any).matching(identifier: $0).firstMatch }
            let frame = scroll?.exists == true ? scroll!.frame : app.frame
            let barBottom = app.navigationBars.allElementsBoundByIndex.last(where: { $0.isHittable })?.frame.maxY ?? frame.minY
            let top = max(frame.minY, barBottom) + 8
            let bottom = min(frame.maxY, app.frame.maxY) - 12
            let viewport = CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, bottom - top))
            if element.exists, element.isHittable, viewport.contains(element.frame) { return }
            let above = element.exists ? element.frame.minY < top : towardTop
            let origin = app.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: viewport.midX, dy: top + viewport.height * (above ? 0.35 : 0.7)))
                .press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: viewport.midX, dy: top + viewport.height * (above ? 0.65 : 0.4))))
        }
        XCTAssertTrue(element.exists && element.isHittable, app.debugDescription)
    }

    @MainActor func testFiniteQueuePrioritizesRecallAndClearsSavedWork() {
        let app = launch()
        let rows = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'startSessionItem_'"))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 12), app.debugDescription)
        XCTAssertEqual(rows.count, 5, app.debugDescription)
        let first = rows.element(boundBy: 0)
        XCTAssertEqual(first.identifier, "startSessionItem_review_" + recallID)
        XCTAssertTrue(first.label.contains("Practice study"), app.debugDescription)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'URGENT'")).firstMatch.exists)
        capture("daily-plan-five-recall-first", app: app)
        let later = app.descendants(matching: .any).matching(identifier: "laterPassages").firstMatch
        reveal(later, app: app, scrollID: "todayPracticeList")

        let start = app.buttons["startNextPassage"]
        reveal(start, app: app, scrollID: "todayPracticeList", towardTop: true); start.tap()
        let display = app.segmentedControls["practiceDisplayPicker"]
        XCTAssertTrue(display.waitForExistence(timeout: 12), app.debugDescription)
        if !display.buttons["Counter"].isSelected { display.buttons["Counter"].tap() }
        let tempo = app.descendants(matching: .any).matching(identifier: "tempoDialValue").firstMatch
        XCTAssertTrue(tempo.waitForExistence(timeout: 8), app.debugDescription)
        XCTAssertTrue((tempo.value as? String ?? "").contains("75"), app.debugDescription)
        let atTarget = app.buttons["Play at target"]
        reveal(atTarget, app: app, scrollID: "counterWorkspace")
        XCTAssertGreaterThanOrEqual(atTarget.frame.height, 43.9)
        atTarget.tap()
        let shaky = app.buttons["coldGrade_shaky"]
        reveal(shaky, app: app, scrollID: "counterWorkspace")
        capture("daily-plan-target-visible-at-arm", app: app)
        shaky.tap()
        let clean = app.buttons["verdict_clean"]
        XCTAssertTrue(clean.waitForExistence(timeout: 8), app.debugDescription)
        for _ in 0..<5 {
            reveal(clean, app: app, scrollID: "counterWorkspace")
            XCTAssertTrue(clean.isEnabled, app.debugDescription)
            clean.tap()
        }
        capture("daily-plan-hard-won-target-saved", app: app)
        app.buttons["closeScore"].tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.buttons["startSessionItem_review_" + recallID].exists, app.debugDescription)
        XCTAssertLessThanOrEqual(rows.count, 4, "Completed work consumes today's finite quota instead of endlessly refilling it.")
        let tomorrow = app.descendants(matching: .any).matching(identifier: "tomorrowPassages").firstMatch
        reveal(tomorrow, app: app, scrollID: "todayPracticeList"); tomorrow.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Yesterday’s hard-won passage")).firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        capture("daily-plan-cleared-and-tomorrow-explicit", app: app)
    }

    @MainActor func testCompactNavigationAndGroupedPassagesRemainReachable() {
        let app = launch()
        let tabs = app.tabBars.firstMatch
        if tabs.exists {
            XCTAssertEqual(tabs.buttons.count, 4, app.debugDescription)
            for title in ["Today", "Passages", "Pieces", "More"] { XCTAssertTrue(tabs.buttons[title].isHittable, app.debugDescription) }
            tabs.buttons["More"].tap()
            XCTAssertTrue(app.buttons["Progress"].waitForExistence(timeout: 5), app.debugDescription)
            capture("daily-compact-more-navigation", app: app)
            tabs.buttons["Passages"].tap()
        } else {
            let show = app.buttons["showAppSidebar"]
            XCTAssertTrue(show.waitForExistence(timeout: 5), app.debugDescription); show.tap()
            XCTAssertFalse(app.buttons["Warmups"].firstMatch.isHittable, app.debugDescription)
            XCTAssertFalse(app.buttons["Progress"].firstMatch.isHittable, app.debugDescription)
            capture("daily-three-primary-sidebar-destinations", app: app)
            let more = app.descendants(matching: .any).matching(identifier: "sidebarMore").firstMatch
            XCTAssertTrue(more.exists, app.debugDescription); more.tap()
            XCTAssertTrue(app.buttons["Progress"].firstMatch.isHittable, app.debugDescription)
            more.tap()
            app.buttons["Passages"].firstMatch.tap()
            let hide = app.buttons["hideAppSidebar"]
            if hide.exists && hide.isHittable { hide.tap() }
        }
        XCTAssertTrue(app.buttons["addPhotoPassage"].waitForExistence(timeout: 8), app.debugDescription)
        capture("daily-grouped-compact-passage-library", app: app)
    }

    @MainActor func testLargeTextQueueAndToolsStayReachable() {
        let app = launch(largeText: true)
        let start = app.buttons["startNextPassage"]
        XCTAssertTrue(start.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(start.isHittable, app.debugDescription)
        XCTAssertGreaterThanOrEqual(start.frame.height, 43.9)
        let tools = app.buttons["todayPracticeTools"]
        XCTAssertTrue(tools.isHittable, app.debugDescription); tools.tap()
        let planner = app.buttons["Plan by available time"]
        XCTAssertTrue(planner.waitForExistence(timeout: 5), app.debugDescription); planner.tap()
        XCTAssertTrue(app.navigationBars["Plan by time"].waitForExistence(timeout: 6), app.debugDescription)
        let firstTitle = app.staticTexts["plannerTitle_" + recallID]
        reveal(firstTitle, app: app, scrollID: "timePlannerList")
        XCTAssertGreaterThan(firstTitle.frame.width, 200, "Large-text titles must retain a readable full row, rather than share a narrow column with Start.")
        capture("daily-accessibility-planner-first-item", app: app)
        let plannedStart = app.buttons["startSession"]
        reveal(plannedStart, app: app, scrollID: "timePlannerList", towardTop: true)
        XCTAssertTrue(plannedStart.exists, "The first planner presentation must contain the actual available work.\n\(app.debugDescription)")
        let done = app.navigationBars["Plan by time"].buttons["Done"]
        XCTAssertTrue(done.isHittable, app.debugDescription)
        capture("daily-accessibility-planner", app: app)
        done.tap()
        capture("daily-accessibility-finite-queue", app: app)
    }
}
