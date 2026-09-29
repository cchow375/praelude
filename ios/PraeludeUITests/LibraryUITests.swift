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
        let pieces = app.buttons["Pieces"]
        if !pieces.waitForExistence(timeout: 2) {
            // On this simulator host the split view's sidebar can start collapsed, and (as
            // PraeludeUITests's own comment on the same simulator notes) a single 150 ms press
            // is sometimes lost — retry a few times rather than assume one press lands.
            let showSidebar = app.buttons["Show Sidebar"]
            for _ in 0..<5 {
                if pieces.waitForExistence(timeout: 1) { break }
                if showSidebar.exists, showSidebar.isHittable { showSidebar.press(forDuration: 0.15) }
            }
        }
        XCTAssertTrue(pieces.waitForExistence(timeout: 5), app.debugDescription)
        // Same lost-press hazard as "Show Sidebar" above: on the first (cold) launch of a run, a
        // press on the just-revealed sidebar row can be dropped, leaving Today selected.
        let piecesBar = app.navigationBars["Pieces"]
        for _ in 0..<3 {
            if pieces.exists, pieces.isHittable { pieces.press(forDuration: 0.15) }
            if piecesBar.waitForExistence(timeout: 3) { break }
        }
        XCTAssertTrue(piecesBar.waitForExistence(timeout: 5), app.debugDescription)
        // The sidebar can remain open as a persistent column at this width, leaving its "On your
        // music stand" shortcut list (the same piece titles the tests below assert about) on
        // screen alongside the Pieces list it just navigated to. Collapse it so every assertion
        // below is scoped to the single, unambiguous Pieces screen — matching the Hide-Sidebar-
        // first convention every other UI test file in this target already uses.
        collapseSidebarIfShown(app)
        XCTAssertTrue(app.navigationBars["Pieces"].waitForExistence(timeout: 5), app.debugDescription)
    }
    /// Presenting/dismissing a `.sheet()` (Folders, Setlists, Add piece…) can re-expand the
    /// sidebar as a persistent column on this device width even after `goToLibrary` already
    /// collapsed it once — collapse it again wherever a test is about to check for a piece title
    /// that also appears in the sidebar's own "On your music stand" shortcut list.
    @MainActor private func collapseSidebarIfShown(_ app: XCUIApplication) {
        let hideSidebar = app.buttons["Hide Sidebar"]
        if hideSidebar.waitForExistence(timeout: 1), hideSidebar.isHittable { hideSidebar.press(forDuration: 0.15) }
    }
    @MainActor private func screenshot(_ name: String) {
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testGridAndListToggleShowTheSamePieces() {
        let app = launch()
        goToLibrary(app)
        // Identifier, not a "Practice study" text match: that text can also match the same
        // piece's row on Today or the sidebar's "On your music stand" shortcut list, which this
        // identifier — set only on `LibraryView`'s own list/grid rows — cannot. `.firstMatch`
        // (not a bare subscript) throughout this file: a SwiftUI transition can briefly render a
        // row twice, and a bracket lookup demands exactly one match at the instant it resolves.
        let pieceRow = app.buttons.matching(identifier: "pieceRow").firstMatch
        XCTAssertTrue(pieceRow.waitForExistence(timeout: 5), app.debugDescription)
        screenshot("library-list")
        app.buttons["Grid view"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["List view"].waitForExistence(timeout: 5), "Toggling to grid must flip the same button back to \u{201c}List view\u{201d}")
        XCTAssertTrue(pieceRow.waitForExistence(timeout: 5), "The same piece must still be visible in grid layout")
        screenshot("library-grid")
        app.buttons["List view"].press(forDuration: 0.15)
        XCTAssertTrue(app.buttons["Grid view"].waitForExistence(timeout: 5))
    }

    @MainActor func testThreeWayCollectionFilterSeparatesActiveCompletedAndResting() {
        let app = launch()
        goToLibrary(app)
        let pieceRow = app.buttons.matching(identifier: "pieceRow").firstMatch
        XCTAssertTrue(pieceRow.waitForExistence(timeout: 5))
        app.buttons["Completed"].press(forDuration: 0.15)
        XCTAssertFalse(pieceRow.exists, "A still-Active piece must not show under Completed")
        app.buttons["Resting"].press(forDuration: 0.15)
        XCTAssertFalse(pieceRow.exists, "A still-Active piece must not show under Resting")
        app.buttons["Active"].press(forDuration: 0.15)
        XCTAssertTrue(pieceRow.waitForExistence(timeout: 5))
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
        collapseSidebarIfShown(app)
        let pieceRow = app.buttons.matching(identifier: "pieceRow").firstMatch
        // Selecting an empty folder filters every piece out of the current (Active) tab.
        XCTAssertTrue(app.staticTexts["Recital"].waitForExistence(timeout: 5), "The active-filter chip must show the folder's name")
        XCTAssertFalse(pieceRow.exists, "No piece has been added to the new folder yet")
        screenshot("library-folder-filter")
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Clear Recital filter")).firstMatch.press(forDuration: 0.15)
        XCTAssertTrue(pieceRow.waitForExistence(timeout: 5), "Clearing the filter must restore the full Active list")
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
        // Distinct identifier from LibraryView's own, identically-labeled "Add piece" toolbar
        // button — a plain label lookup here is ambiguous once both can appear in the same
        // accessibility tree (the sheet's setlist detail screen sits over the Pieces list).
        app.buttons.matching(identifier: "addSetlistPiece").firstMatch.press(forDuration: 0.15)
        // Identifier, not a "Practice study" label match: that text is ambiguous with the same
        // piece's row on Today/the sidebar, which can still be present elsewhere in the tree
        // while this sheet is up (see `AddSetlistItemView`'s own comment on the same ambiguity).
        let pieceRow = app.buttons.matching(identifier: "addSetlistItem").firstMatch
        XCTAssertTrue(pieceRow.waitForExistence(timeout: 5), app.debugDescription)
        pieceRow.press(forDuration: 0.15)
        collapseSidebarIfShown(app)
        let start = app.buttons.matching(identifier: "Start").firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 5), "\u{201c}Open in order\u{201d} must offer Start once the setlist has a piece")
        screenshot("library-setlist")
        start.press(forDuration: 0.15)
        // Opening a setlist item hands off to the same score workspace `openScore` exercises: the
        // arm panel (§10a), not a separate "start set" tap — see `PraeludeUITests.openScore`.
        XCTAssertTrue(app.buttons["armStartSet"].waitForExistence(timeout: 10), app.debugDescription)
    }
}
