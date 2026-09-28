import XCTest

/// §7 library: grid/list toggle, folders, and setlists, driven through the real `LibraryView`
/// (reached via the "Pieces" sidebar/tab destination, not the sidebar's own "on your music stand"
/// shortcut list that `PraeludeUITests`'s `openScore` uses).
final class LibraryUITests: XCTestCase {
    @MainActor private func launch(seed: Bool = true, reset: Bool = true) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting"] + (reset ? ["--reset"] : []) + (seed ? ["--seed"] : [])
        app.launch()
        return app
    }
    @MainActor private func goToLibrary(_ app: XCUIApplication) {
        if !app.buttons["Pieces"].waitForExistence(timeout: 2) {
            let showSidebar = app.buttons["Show Sidebar"]
            if showSidebar.waitForExistence(timeout: 1), showSidebar.isHittable { showSidebar.press(forDuration: 0.15) }
        }
        let pieces = app.buttons["Pieces"]
        XCTAssertTrue(pieces.waitForExistence(timeout: 5), app.debugDescription)
        pieces.press(forDuration: 0.15)
        XCTAssertTrue(app.navigationBars["Pieces"].waitForExistence(timeout: 5), app.debugDescription)
    }
    @MainActor private func screenshot(_ name: String) {
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testGridAndListToggleShowTheSamePieces() {
        let app = launch()
        goToLibrary(app)
        XCTAssertTrue(app.staticTexts["Practice study"].waitForExistence(timeout: 5), app.debugDescription)
        screenshot("library-list")
        app.buttons["Grid view"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["List view"].waitForExistence(timeout: 5), "Toggling to grid must flip the same button back to \u{201c}List view\u{201d}")
        XCTAssertTrue(app.staticTexts["Practice study"].waitForExistence(timeout: 5), "The same piece must still be visible in grid layout")
        screenshot("library-grid")
        app.buttons["List view"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Grid view"].waitForExistence(timeout: 5))
    }

    @MainActor func testThreeWayCollectionFilterSeparatesActiveCompletedAndResting() {
        let app = launch()
        goToLibrary(app)
        XCTAssertTrue(app.staticTexts["Practice study"].waitForExistence(timeout: 5))
        app.buttons["Completed"].press(forDuration: 0.15)
        XCTAssertFalse(app.staticTexts["Practice study"].exists, "A still-Active piece must not show under Completed")
        app.buttons["Resting"].press(forDuration: 0.15)
        XCTAssertFalse(app.staticTexts["Practice study"].exists, "A still-Active piece must not show under Resting")
        app.buttons["Active"].press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["Practice study"].waitForExistence(timeout: 5))
    }

    @MainActor func testCreateFolderFilterByItThenClearTheFilter() {
        let app = launch()
        goToLibrary(app)
        app.buttons["Sort and organize"].press(forDuration: 0.15)
        app.buttons["Folders"].press(forDuration: 0.15)
        let newFolderName = app.textFields["newFoldersName"]
        XCTAssertTrue(newFolderName.waitForExistence(timeout: 5), app.debugDescription)
        newFolderName.press(forDuration: 0.15); newFolderName.typeText("Recital")
        app.buttons["Add"].press(forDuration: 0.15)
        let recitalRow = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Recital")).firstMatch
        XCTAssertTrue(recitalRow.waitForExistence(timeout: 5), app.debugDescription)
        recitalRow.press(forDuration: 0.15)
        // Selecting an empty folder filters every piece out of the current (Active) tab.
        XCTAssertTrue(app.staticTexts["Recital"].waitForExistence(timeout: 5), "The active-filter chip must show the folder's name")
        XCTAssertFalse(app.staticTexts["Practice study"].exists, "No piece has been added to the new folder yet")
        screenshot("library-folder-filter")
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Clear Recital filter")).firstMatch.press(forDuration: 0.15)
        XCTAssertTrue(app.staticTexts["Practice study"].waitForExistence(timeout: 5), "Clearing the filter must restore the full Active list")
    }

    @MainActor func testCreateSetlistAddAPieceAndOpenIt() {
        let app = launch()
        goToLibrary(app)
        app.buttons["Sort and organize"].press(forDuration: 0.15)
        app.buttons["Setlists"].press(forDuration: 0.15)
        let newSetlistName = app.textFields["newSetlistName"]
        XCTAssertTrue(newSetlistName.waitForExistence(timeout: 5), app.debugDescription)
        newSetlistName.press(forDuration: 0.15); newSetlistName.typeText("Spring recital")
        app.buttons["Add setlist"].press(forDuration: 0.15)
        let setlistRow = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Spring recital")).firstMatch
        XCTAssertTrue(setlistRow.waitForExistence(timeout: 5), app.debugDescription)
        setlistRow.press(forDuration: 0.15)
        app.buttons["Add piece"].press(forDuration: 0.15)
        let pieceRow = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Practice study")).firstMatch
        XCTAssertTrue(pieceRow.waitForExistence(timeout: 5), app.debugDescription)
        pieceRow.press(forDuration: 0.15)
        let start = app.buttons["Start"]
        XCTAssertTrue(start.waitForExistence(timeout: 5), "\u{201c}Open in order\u{201d} must offer Start once the setlist has a piece")
        screenshot("library-setlist")
        start.press(forDuration: 0.15)
        // Opening a setlist item hands off to the same score workspace `openScore` exercises.
        XCTAssertTrue(app.buttons["startSet"].waitForExistence(timeout: 10), app.debugDescription)
    }
}
