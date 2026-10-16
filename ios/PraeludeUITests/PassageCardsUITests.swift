import XCTest
import UIKit

/// Explicit synthetic photo input skips hardware capture only. Cropping, saving, card artwork,
/// passage arming and relaunch all use the ordinary app flow and the disposable UI-test store.
final class PassageCardsUITests: XCTestCase {
    @MainActor func testImageReviewDetailsAndReversibleDeferralDoNotGradePassage() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed"]
        app.launch()
        passages(app)
        let image = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'passageCardImage_'")).firstMatch
        XCTAssertTrue(image.waitForExistence(timeout: 10), app.debugDescription)
        capture("passage-cards-image-library", app: app)
        image.tap()
        let details = app.buttons["Review date & first-attempt history"]
        reveal(details, app: app, scrollID: "passageCardDetailScroll"); details.tap()
        XCTAssertTrue(app.navigationBars["Review details"].waitForExistence(timeout: 8), app.debugDescription)
        assertVisibleReviewMusic(app, name: "review-music-before-deferral")
        let hide = app.buttons["Hide from reviews until tomorrow"]
        reveal(hide, app: app, scrollID: "passageReviewDetailList"); hide.tap()
        let show = app.buttons["Show in reviews today"]
        XCTAssertTrue(show.waitForExistence(timeout: 5), app.debugDescription)
        show.tap()
        XCTAssertTrue(hide.waitForExistence(timeout: 5), app.debugDescription)
        let emptyHistory = app.staticTexts["No first-attempt grades saved."]
        reveal(emptyHistory, app: app, scrollID: "passageReviewDetailList")
        XCTAssertTrue(emptyHistory.exists, app.debugDescription)
        assertVisibleReviewMusic(app, name: "review-music-after-reversible-deferral")
        capture("passage-review-explanation-and-history", app: app)
        app.navigationBars["Review details"].buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Passage"].waitForExistence(timeout: 8), app.debugDescription)
        let score = app.buttons["Open score"]
        reveal(score, app: app, scrollID: "passageCardDetailScroll"); score.tap()
        XCTAssertTrue(app.descendants(matching: .any)["scorePDF"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.segmentedControls["practiceDisplayPicker"].buttons["Score"].isSelected, app.debugDescription)
        capture("card-open-score-shows-reading", app: app)
        app.buttons["closeScore"].tap()
        let practice = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'practiceCard_'")).firstMatch
        XCTAssertTrue(practice.waitForExistence(timeout: 8), app.debugDescription)
        practice.tap()
        if UIDevice.current.userInterfaceIdiom == .phone {
            XCTAssertTrue(app.scrollViews["counterWorkspace"].waitForExistence(timeout: 8), app.debugDescription)
        }
    }

    /// A Ready accessibility state proves only that a bitmap loaded. Inspect its actual on-screen
    /// pixels too: this catches a white/zero-sized List image even when PDF rendering succeeded.
    @MainActor private func assertVisibleReviewMusic(_ app: XCUIApplication, name: String) {
        let list = app.descendants(matching: .any).matching(identifier: "passageReviewDetailList").firstMatch
        let artwork = list.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'passageArtwork_'")).firstMatch
        reveal(artwork, app: app, scrollID: "passageReviewDetailList", towardTop: true)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            artwork.exists && artwork.isHittable && artwork.value as? String == "Ready" && artwork.frame.height > 100
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed, app.debugDescription)
        capture(name, app: app)
        let screen = XCUIScreen.main.screenshot().image
        guard let bitmap = screen.cgImage else { XCTFail("Screenshot bitmap unavailable"); return }
        // A tablet sheet may leave part of this row under its glass navigation bar after
        // scrolling. Sample only exposed artwork, so title/button ink cannot pass for music.
        let barBottom = app.navigationBars["Review details"].frame.maxY
        let exposed = CGRect(x: app.frame.minX, y: barBottom, width: app.frame.width,
                             height: max(0, app.frame.maxY - barBottom))
        let frame = artwork.frame.intersection(exposed).insetBy(dx: 4, dy: 4)
        XCTAssertGreaterThan(frame.height, 40, "Enough music must be exposed for the pixel check.\n\(app.debugDescription)")
        XCTAssertTrue(app.frame.contains(frame), "Artwork sampling must stay inside the screen bitmap.")
        let scaleX = CGFloat(bitmap.width) / app.frame.width, scaleY = CGFloat(bitmap.height) / app.frame.height
        let pixels = CGRect(x: (frame.minX - app.frame.minX) * scaleX, y: (frame.minY - app.frame.minY) * scaleY,
                            width: frame.width * scaleX, height: frame.height * scaleY).integral
        guard let crop = bitmap.cropping(to: pixels) else { XCTFail("Artwork screenshot crop unavailable"); return }
        var values = [UInt8](repeating: 0, count: crop.width * crop.height * 4)
        guard let context = CGContext(data: &values, width: crop.width, height: crop.height,
                                      bitsPerComponent: 8, bytesPerRow: crop.width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            XCTFail("Artwork screenshot context unavailable"); return
        }
        context.draw(crop, in: CGRect(x: 0, y: 0, width: crop.width, height: crop.height))
        let inkPixels = stride(from: 0, to: values.count, by: 4).filter {
            values[$0] < 150 && values[$0 + 1] < 150 && values[$0 + 2] < 150 && values[$0 + 3] > 200
        }.count
        XCTAssertGreaterThan(inkPixels, 40, "The loaded score must visibly draw notes; a blank white image is a failure.")
    }

    @MainActor private func capture(_ name: String, app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name; shot.lifetime = .keepAlways; add(shot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }

    @MainActor private func passages(_ app: XCUIApplication) {
        let tab = app.tabBars.buttons["Passages"]
        if !tab.exists {
            let sidebar = app.buttons["showAppSidebar"]
            if sidebar.exists && sidebar.isHittable { sidebar.tap() }
        }
        let button = tab.exists ? tab : app.buttons["Passages"].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 8), app.debugDescription)
        button.tap()
        XCTAssertTrue(app.buttons["addPhotoPassage"].waitForExistence(timeout: 8), app.debugDescription)
    }

    @MainActor private func reveal(_ element: XCUIElement, app: XCUIApplication, scrollID: String = "passageCaptureScroll", towardTop: Bool = false) {
        for _ in 0..<8 {
            if element.exists && element.isHittable { return }
            let scroll = app.descendants(matching: .any).matching(identifier: scrollID).firstMatch
            XCTAssertTrue(scroll.exists, app.debugDescription)
            let window = app.windows.firstMatch
            let navBottom = app.navigationBars.allElementsBoundByIndex.last?.frame.maxY ?? scroll.frame.minY
            let top = max(scroll.frame.minY, navBottom) + 12
            let keyboardTop = app.keyboards.firstMatch.exists ? app.keyboards.firstMatch.frame.minY : window.frame.maxY
            let bottom = min(scroll.frame.maxY, keyboardTop, window.frame.maxY) - 24
            let above = towardTop || (element.exists && element.frame.midY < (top + bottom) / 2)
            let startY = top + (bottom - top) * (above ? 0.3 : 0.8)
            let endY = top + (bottom - top) * (above ? 0.8 : 0.3)
            let origin = window.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: window.frame.midX, dy: startY)).press(forDuration: 0.05,
                thenDragTo: origin.withOffset(CGVector(dx: window.frame.midX, dy: endY)))
        }
        XCTAssertTrue(element.exists && element.isHittable, app.debugDescription)
    }

    @MainActor func testCropPhotoSaveCardPracticeAndRetainAfterRelaunch() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--audit-passage-photo"]
        app.launch()
        passages(app)
        app.buttons["addPhotoPassage"].tap()
        let canvas = app.descendants(matching: .any)["passageCropCanvas"].firstMatch
        XCTAssertTrue(canvas.waitForExistence(timeout: 12), app.debugDescription)
        capture("photo-crop-source", app: app)
        let start = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.58)))
        let work = app.textFields["photoPassageWorkTitle"]
        reveal(work, app: app); work.tap(); work.typeText("Paper audit")
        let name = app.textFields["photoPassageName"]
        reveal(name, app: app); name.tap(); name.typeText("Photo passage audit")
        capture("photo-crop-metadata", app: app)
        app.buttons["savePhotoPassage"].tap()
        XCTAssertTrue(app.buttons["addPhotoPassage"].waitForExistence(timeout: 12), app.debugDescription)
        let search = app.searchFields.firstMatch
        if !search.exists {
            let showSearch = app.buttons["Search"].firstMatch
            if showSearch.exists && showSearch.isHittable { showSearch.tap() }
        }
        if !search.isHittable { app.scrollViews["passageCardLibraryScroll"].swipeDown() }
        XCTAssertTrue(search.waitForExistence(timeout: 5), app.debugDescription)
        search.tap(); search.typeText("Photo passage audit")
        let practice = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'practiceCard_'")).firstMatch
        XCTAssertTrue(practice.waitForExistence(timeout: 8), app.debugDescription)
        if app.keyboards.count > 0 { app.buttons["Search"].firstMatch.tap() }
        capture("photo-passage-card", app: app)
        practice.tap()
        XCTAssertTrue(app.buttons["skipColdGrade"].waitForExistence(timeout: 8), app.debugDescription)
        capture("photo-passage-practice-ready", app: app)
        app.terminate()
        app.launchArguments = ["--uitesting"]
        app.launch()
        passages(app)
        XCTAssertTrue(app.staticTexts["Photo passage audit"].waitForExistence(timeout: 8), app.debugDescription)
        capture("photo-passage-retained", app: app)
    }
}
