import XCTest

/// Actual single-touch navigation over the separate synthetic UI-test library.
/// Every action has one fixed center tap, evidence, and a required resulting screen.
/// These cases deliberately omit the DEBUG direct-score starting point.
final class TapDeliveryUITests: XCTestCase {
    private let initialArguments = ["--uitesting", "--reset", "--seed", "--seed-sections",
                                    "--audit-review-priority"]

    @MainActor private func capture(_ name: String, app: XCUIApplication) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }

    @MainActor private func require(_ name: String, app: XCUIApplication, timeout: TimeInterval = 8,
                                    _ condition: @escaping @MainActor () -> Bool) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        let result = XCTWaiter.wait(for: [expectation], timeout: timeout)
        // Capture the final state even when the transition did not occur. No action is retried.
        capture(name, app: app)
        XCTAssertEqual(result, .completed, "Required transition: \(name)\n\(app.debugDescription)")
    }

    @MainActor private func centerTap(_ element: XCUIElement, name: String, app: XCUIApplication) {
        var previous = CGRect.zero
        var lastChange = Date.now
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard element.exists, element.isHittable else { return false }
            let frame = element.frame
            guard frame.width > 1, frame.height > 1, app.frame.contains(frame) else { return false }
            if frame != previous { previous = frame; lastChange = .now; return false }
            return Date.now.timeIntervalSince(lastChange) >= 0.4
        }, object: nil)
        let result = XCTWaiter.wait(for: [ready], timeout: 8)
        capture(name + "-before", app: app)
        XCTAssertEqual(result, .completed, "Target must be visible, hittable and settled: \(name)\n\(app.debugDescription)")
        let frame = element.frame
        let appFrame = app.frame
        let target = XCTAttachment(string: "identifier=\(element.identifier) frame=\(frame) appFrame=\(appFrame) center=(\(frame.midX),\(frame.midY))")
        target.name = name + "-target"; target.lifetime = .keepAlways; add(target)
        // Fix the recorded screen point before synthesizing exactly one single-touch tap.
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: frame.midX - appFrame.minX, dy: frame.midY - appFrame.minY)).tap()
        capture(name + "-immediately-after", app: app)
    }

    @MainActor private func launchToday(_ app: XCUIApplication, reset: Bool = true) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = reset ? initialArguments : ["--uitesting"]
        app.launch()
        require("launch-today", app: app) { app.navigationBars["Today"].exists }
        // Normalize a genuinely visible initial sidebar with one action and its postcondition.
        let hide = app.buttons["Hide Sidebar"]
        if hide.exists, hide.isHittable {
            centerTap(hide, name: "initial-hide-sidebar", app: app)
            require("initial-sidebar-hidden", app: app) {
                app.buttons["Show Sidebar"].exists && app.buttons["Show Sidebar"].isHittable
            }
        }
    }

    @MainActor private func openPieces(_ app: XCUIApplication) {
        centerTap(app.buttons["Show Sidebar"], name: "show-sidebar", app: app)
        require("sidebar-shown", app: app) {
            app.buttons["Hide Sidebar"].exists && app.buttons["Hide Sidebar"].isHittable &&
            app.buttons["Pieces"].exists && app.buttons["Pieces"].isHittable
        }
        centerTap(app.buttons["Pieces"], name: "sidebar-pieces", app: app)
        require("pieces-destination", app: app) { app.navigationBars["Pieces"].exists }
        centerTap(app.buttons["Hide Sidebar"], name: "hide-sidebar-in-pieces", app: app)
        require("pieces-with-sidebar-hidden", app: app) {
            app.navigationBars["Pieces"].exists && app.buttons["Show Sidebar"].exists &&
            app.buttons["Show Sidebar"].isHittable
        }
    }

    @MainActor private func openScore(_ app: XCUIApplication) {
        openPieces(app)
        let piece = app.buttons.matching(NSPredicate(format:
            "identifier == %@ AND label CONTAINS %@ AND label CONTAINS %@",
            "pieceRow", "Practice study", "Praelude test score")).firstMatch
        centerTap(piece, name: "practice-study-grid-center", app: app)
        require("practice-study-score-open", app: app) {
            app.buttons["annotateScore"].exists && app.buttons["annotateScore"].isHittable &&
            app.otherElements["scorePDF"].textViews.firstMatch.exists
        }
    }

    @MainActor private func openReviews(_ app: XCUIApplication, cycle: String) {
        centerTap(app.buttons["allPassageReviews"], name: cycle + "-all-reviews-center", app: app)
        require(cycle + "-review-queue-open", app: app) {
            app.navigationBars["Passage reviews"].exists &&
            app.staticTexts["Overdue synthetic review"].exists &&
            app.navigationBars["Passage reviews"].buttons["Done"].isHittable
        }
    }

    @MainActor private func closeReviews(_ app: XCUIApplication, cycle: String) {
        centerTap(app.navigationBars["Passage reviews"].buttons["Done"],
                  name: cycle + "-reviews-done", app: app)
        require(cycle + "-review-queue-dismissed", app: app) {
            !app.navigationBars["Passage reviews"].exists && app.navigationBars["Today"].exists &&
            app.buttons["allPassageReviews"].isHittable
        }
    }

    @MainActor private func openCamera(_ app: XCUIApplication, stage: String) {
        centerTap(app.buttons["Score options"], name: stage + "-score-options", app: app)
        let menu = app.collectionViews.containing(.button, identifier: "openCameraGestures").firstMatch
        require(stage + "-camera-menu-visible", app: app) {
            menu.exists && menu.buttons["openCameraGestures"].exists &&
            menu.buttons["openCameraGestures"].isHittable
        }
        centerTap(menu.buttons["openCameraGestures"], name: stage + "-camera-entry", app: app)
        require(stage + "-camera-settings-open", app: app) {
            app.navigationBars["Camera gestures"].exists && app.buttons["toggleFaceCamera"].exists &&
            app.buttons["toggleFaceCamera"].label == "Enable camera" &&
            app.staticTexts["faceCameraStatus"].label == "Camera is off"
        }
    }

    @MainActor private func closeCamera(_ app: XCUIApplication, stage: String) {
        centerTap(app.navigationBars["Camera gestures"].buttons["Done"],
                  name: stage + "-camera-done", app: app)
        require(stage + "-camera-settings-dismissed", app: app) {
            !app.navigationBars["Camera gestures"].exists && app.buttons["annotateScore"].isHittable
        }
    }

    @MainActor func testTodayAllPassageReviewsCenterTapOpensQueue() {
        let app = XCUIApplication(); launchToday(app)
        openReviews(app, cycle: "single")
        closeReviews(app, cycle: "single")
    }

    @MainActor func testTodayReviewQueueEightSingleTapOpenDoneCycles() {
        let app = XCUIApplication(); launchToday(app)
        for index in 1...8 {
            let cycle = "cycle-\(index)"
            openReviews(app, cycle: cycle)
            closeReviews(app, cycle: cycle)
        }
    }

    @MainActor func testSidebarShowPiecesHideUsesSingleTaps() {
        let app = XCUIApplication(); launchToday(app)
        openPieces(app)
    }

    @MainActor func testOwnedSidebarThirtyTwoCyclesAcrossFourProcessLaunches() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()

        // Keep successful cycles light: target geometry for each action, images/hierarchy
        // per launch and on failure. No trace, sidebar normalization, or action retry.
        func awaitState(_ name: String, _ condition: @escaping @MainActor () -> Bool) -> Bool {
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
            let result = XCTWaiter.wait(for: [ready], timeout: 8)
            if result != .completed { capture(name + "-failed", app: app) }
            XCTAssertEqual(result, .completed, "Required sidebar stress state: \(name)")
            return result == .completed
        }

        func singleSettledTap(_ button: XCUIElement, identifier: String, name: String) -> Bool {
            var previous = CGRect.zero
            var lastChange = Date.now
            guard awaitState(name + "-settled-target", {
                guard button.exists, button.identifier == identifier, button.isHittable else { return false }
                let frame = button.frame
                guard frame.width >= 44, frame.height >= 44, app.frame.contains(frame) else { return false }
                if frame != previous { previous = frame; lastChange = .now; return false }
                return Date.now.timeIntervalSince(lastChange) >= 0.4
            }) else { return false }
            let frame = button.frame
            let window = app.frame
            let point = CGPoint(x: frame.midX, y: frame.midY)
            let target = XCTAttachment(string: "identifier=\(button.identifier) frame=\(frame) center=\(point) app=\(window) hittable=\(button.isHittable) stableFrame=\(previous)")
            target.name = name + "-fixed-target"; target.lifetime = .keepAlways; add(target)
            guard button.identifier == identifier, frame.width >= 44, frame.height >= 44,
                  frame == previous, window.contains(frame), button.isHittable else {
                capture(name + "-target-changed-before-tap", app: app)
                XCTFail("The settled owned 44pt sidebar target changed before its one action: \(name)")
                return false
            }
            app.coordinate(withNormalizedOffset: .zero).withOffset(
                CGVector(dx: point.x - window.minX, dy: point.y - window.minY)).tap()
            return true
        }

        func todayRemainsDestination() -> Bool {
            app.navigationBars["Today"].exists && !app.buttons["annotateScore"].exists &&
            !app.buttons["verdict_clean"].exists && !app.buttons["pausePractice"].exists
        }

        for launch in 1...4 {
            app.terminate()
            guard awaitState("launch-\(launch)-previous-process-terminated", { app.state == .notRunning }) else { return }
            app.launchArguments = launch == 1 ?
                ["--uitesting", "--reset", "--seed", "--seed-sections"] : ["--uitesting"]
            XCTAssertFalse(app.launchArguments.contains("--audit-taps"))
            app.launch()
            let show = app.buttons["showAppSidebar"]
            let hide = app.buttons["hideAppSidebar"]
            let pieces = app.buttons["Pieces"]
            guard awaitState("launch-\(launch)-initial-today-sidebar-hidden", {
                app.state == .runningForeground && todayRemainsDestination() &&
                show.exists && show.isHittable && (!hide.exists || !hide.isHittable) &&
                (!pieces.exists || !pieces.isHittable)
            }) else { return }
            capture("owned-sidebar-launch-\(launch)-before-eight-cycles", app: app)
            for cycle in 1...8 {
                let stage = "owned-sidebar-launch-\(launch)-cycle-\(cycle)"
                guard singleSettledTap(show, identifier: "showAppSidebar", name: stage + "-show") else { return }
                guard awaitState(stage + "-sidebar-shown", {
                    todayRemainsDestination() && hide.exists && hide.isHittable &&
                    pieces.exists && pieces.isHittable && (!show.exists || !show.isHittable)
                }) else { return }
                guard singleSettledTap(hide, identifier: "hideAppSidebar", name: stage + "-hide") else { return }
                guard awaitState(stage + "-sidebar-hidden-today-unchanged", {
                    todayRemainsDestination() && show.exists && show.isHittable &&
                    (!hide.exists || !hide.isHittable) && (!pieces.exists || !pieces.isHittable)
                }) else { return }
            }
            capture("owned-sidebar-launch-\(launch)-after-eight-cycles", app: app)
        }
    }

    @MainActor func testOwnedSidebarRotationPreservesSavedInkScoreAndFocus() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--seed-sections"]
        app.launch()
        require("rotation-initial-today", app: app) {
            app.navigationBars["Today"].exists && app.buttons["showAppSidebar"].isHittable
        }
        openScore(app)
        let pdf = app.otherElements["scorePDF"]
        let indicator = app.buttons["pageIndicator"]
        require("rotation-initial-page-one-ready", app: app) {
            indicator.exists && indicator.label.contains("Page 1 of")
        }
        let originalPage = indicator.label

        func sourceBounds() throws -> [Double] {
            let value = pdf.value as? String ?? ""
            let patterns = [#"drawingBounds=\(([-0-9.eE+]+), ([-0-9.eE+]+), ([-0-9.eE+]+), ([-0-9.eE+]+)\)"#,
                            #"drawingBounds=\{\{([-0-9.eE+]+), ([-0-9.eE+]+)\}, \{([-0-9.eE+]+), ([-0-9.eE+]+)\}\}"#]
            let matches = try patterns.compactMap {
                try NSRegularExpression(pattern: $0).firstMatch(in: value, range: NSRange(value.startIndex..., in: value))
            }
            let match = try XCTUnwrap(matches.first, value)
            return try (1...4).map {
                let range = try XCTUnwrap(Range(match.range(at: $0), in: value))
                return try XCTUnwrap(Double(value[range]))
            }
        }

        centerTap(app.buttons["annotateScore"], name: "rotation-create-actual-ink", app: app)
        let finger = app.switches["fingerDrawing"]
        require("rotation-drawing-tools-visible", app: app) { finger.exists && finger.isHittable }
        let fingerWasOn = finger.value as? String == "1"
        if !fingerWasOn {
            let native = finger.switches.firstMatch
            centerTap(native.exists ? native : finger, name: "rotation-enable-observed-finger-switch", app: app)
            require("rotation-finger-drawing-enabled", app: app) { finger.value as? String == "1" }
        }
        centerTap(app.buttons["toggleAnnotationPalette"], name: "rotation-minimize-tools-before-stroke", app: app)
        let page = pdf.textViews.firstMatch
        require("rotation-paper-ready-for-one-stroke", app: app) {
            page.exists && page.isHittable && pdf.frame.insetBy(dx: -0.5, dy: -0.5).contains(page.frame)
        }
        page.coordinate(withNormalizedOffset: .init(dx: 0.25, dy: 0.65)).press(forDuration: 0.12,
            thenDragTo: page.coordinate(withNormalizedOffset: .init(dx: 0.65, dy: 0.67)))
        require("rotation-one-actual-stroke", app: app) { (pdf.value as? String)?.contains("inkPage1=1") == true }
        let originalInk = try sourceBounds()
        XCTAssertGreaterThan(originalInk[2], 50, "Require a nonempty actual stroke before sidebar preservation checks.")
        centerTap(app.buttons["toggleAnnotationPalette"], name: "rotation-expand-tools-after-stroke", app: app)
        if !fingerWasOn {
            let native = finger.switches.firstMatch
            centerTap(native.exists ? native : finger, name: "rotation-restore-original-finger-setting", app: app)
            require("rotation-finger-setting-restored", app: app) { finger.value as? String == "0" }
        }
        centerTap(app.buttons["finishScoreMarkup"], name: "rotation-save-ink-and-return-to-reading", app: app)

        func requireSameScore(_ stage: String) throws {
            func predicates() -> [String: Bool] {
                let paper = pdf.textViews.firstMatch
                let text = paper.exists ? paper.label + "\n" + (paper.value as? String ?? "") : ""
                let value = pdf.exists ? pdf.value as? String ?? "" : ""
                let focused = app.buttons["exitScoreFocus"].isHittable
                return ["pdfExists": pdf.exists, "paperExists": paper.exists,
                        "originalScoreIdentity": text.contains("Practice study") && text.contains("Praelude") && text.contains("original test score"),
                        "samePDFKitPage": value.split(separator: ";").contains("displayedPage=1"),
                        "readingPageIndicator": focused || (indicator.exists && indicator.isHittable && indicator.label == originalPage),
                        "oneSavedInkStroke": value.contains("inkPage1=1"),
                        // PDFKit stays in markup mode to render page overlays. App reading
                        // mode is established by its actual controls, including score focus.
                        "readingMode": !app.buttons["finishScoreMarkup"].exists &&
                            (app.buttons["annotateScore"].isHittable || focused),
                        "noVerdictControl": !app.buttons["verdict_clean"].exists,
                        "noPauseControl": !app.buttons["pausePractice"].exists,
                        "noRepProgress": !app.staticTexts["repProgress"].exists]
            }
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in predicates().values.allSatisfy { $0 } }, object: nil)
            let result = XCTWaiter.wait(for: [ready], timeout: 8)
            capture(stage, app: app)
            let paper = pdf.textViews.firstMatch
            let readout: [String: Any] = ["predicates": predicates(),
                "pdfValue": pdf.exists ? pdf.value as? String ?? "" : "absent",
                "paperLabel": paper.exists ? paper.label : "absent",
                "paperValue": paper.exists ? paper.value as? String ?? "" : "absent",
                "pageLabel": indicator.exists ? indicator.label : "absent", "originalPageLabel": originalPage,
                "originalSourceBounds": originalInk, "readiness": result.rawValue]
            let data = try JSONSerialization.data(withJSONObject: readout, options: [.prettyPrinted, .sortedKeys])
            let payload = String(decoding: data, as: UTF8.self)
            let attachment = XCTAttachment(string: payload)
            attachment.name = stage + "-complete-score-predicates"; attachment.lifetime = .keepAlways; add(attachment)
            XCTAssertEqual(result, .completed, "Same saved score, page, mode, ink and zero practice are required.\n\(payload)\n\(app.debugDescription)")
            let current = try sourceBounds()
            for index in 0..<4 {
                XCTAssertEqual(current[index], originalInk[index], accuracy: 0.5,
                               "Sidebar/rotation must retain the saved source-stroke location and extent.")
            }
        }

        func ownedSidebarCycle(_ stage: String) throws {
            let show = app.buttons["showAppSidebar"]
            require(stage + "-owned-show-44pt", app: app) {
                show.exists && show.isHittable && show.frame.width >= 43.99 && show.frame.height >= 43.99
            }
            centerTap(show, name: stage + "-owned-show-once", app: app)
            let hide = app.buttons["hideAppSidebar"]
            require(stage + "-actual-sidebar-visible", app: app) {
                app.buttons["Pieces"].isHittable && hide.isHittable &&
                hide.frame.width >= 43.99 && hide.frame.height >= 43.99 && (!show.exists || !show.isHittable)
            }
            try requireSameScore(stage + "-score-retained-with-sidebar")
            centerTap(hide, name: stage + "-owned-hide-once", app: app)
            require(stage + "-actual-sidebar-hidden", app: app) {
                show.isHittable && (!hide.exists || !hide.isHittable) &&
                (!app.buttons["Pieces"].exists || !app.buttons["Pieces"].isHittable)
            }
            try requireSameScore(stage + "-score-retained-after-hide")
        }

        try requireSameScore("rotation-saved-reading-baseline")
        XCUIDevice.shared.orientation = .landscapeLeft
        require("rotation-actual-landscape-required", app: app) { app.frame.width > app.frame.height }
        try ownedSidebarCycle("rotation-landscape")
        centerTap(app.buttons["Score options"], name: "rotation-open-focus-options", app: app)
        let focusMenu = app.collectionViews.containing(.button, identifier: "enterScoreFocus").firstMatch
        require("rotation-focus-menu-visible", app: app) { focusMenu.buttons["enterScoreFocus"].isHittable }
        centerTap(focusMenu.buttons["enterScoreFocus"], name: "rotation-enter-focus-once", app: app)
        require("rotation-landscape-focus-hides-sidebar-control", app: app) {
            app.buttons["exitScoreFocus"].isHittable &&
            (!app.buttons["showAppSidebar"].exists || !app.buttons["showAppSidebar"].isHittable) &&
            !app.buttons["annotateScore"].exists
        }
        XCUIDevice.shared.orientation = .portrait
        require("rotation-actual-portrait-focus-retained", app: app) {
            app.frame.height > app.frame.width && app.buttons["exitScoreFocus"].isHittable &&
            (!app.buttons["showAppSidebar"].exists || !app.buttons["showAppSidebar"].isHittable) &&
            !app.buttons["annotateScore"].exists
        }
        try requireSameScore("rotation-focus-retains-saved-score-and-ink")
        centerTap(app.buttons["exitScoreFocus"], name: "rotation-exit-focus-once", app: app)
        require("rotation-reading-controls-restored", app: app) {
            app.buttons["annotateScore"].isHittable && !app.buttons["exitScoreFocus"].exists
        }
        try ownedSidebarCycle("rotation-portrait")
        capture("rotation-final-same-score-page-ink-no-practice", app: app)
    }

    @MainActor func testUnselectedSavedBoxPreservesRealPinchPanAndArmsAtZoom() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--seed-sections", "--audit-gesture-preservation"]
        app.launch()
        XCTAssertFalse(app.launchArguments.contains("--audit-taps"))
        XCTAssertFalse(app.launchArguments.contains("--audit-reading-delivery"))
        XCTAssertFalse(app.launchArguments.contains("--audit-open-gesture-score"))
        require("unselected-zoom-normal-today", app: app) { app.navigationBars["Today"].exists }
        openScore(app)
        let pdf = app.otherElements["scorePDF"]
        let paper = pdf.textViews.firstMatch
        let overlay = app.otherElements["passageCanvas_page_1"]
        let arm = app.otherElements["practiceArmPanel"]
        let indicator = app.buttons["pageIndicator"]

        func readout() -> String { pdf.value as? String ?? "" }
        func nativeScale() -> Double? {
            guard let value = readout().components(separatedBy: ";scale=").dropFirst().first else { return nil }
            return Double(value.components(separatedBy: ",")[0])
        }
        func nativeOverlayFrame() -> CGRect? {
            let value = readout()
            // Associate the full native window rect with page one's own ink diagnostic.
            // AX frames may be clipped at zoom and cannot define source-normalized regions.
            let patterns = [#"inkPage1=[^;]*;noteOverlayWindow=\(([-0-9.eE+]+), ([-0-9.eE+]+), ([-0-9.eE+]+), ([-0-9.eE+]+)\)"#,
                            #"inkPage1=[^;]*;noteOverlayWindow=\{\{([-0-9.eE+]+), ([-0-9.eE+]+)\}, \{([-0-9.eE+]+), ([-0-9.eE+]+)\}\}"#]
            let matches = patterns.flatMap { pattern -> [NSTextCheckingResult] in
                guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
                return regex.matches(in: value, range: NSRange(value.startIndex..., in: value))
            }
            guard matches.count == 1, let match = matches.first else { return nil }
            let numbers = (1...4).compactMap { index -> Double? in
                guard let range = Range(match.range(at: index), in: value), let number = Double(value[range]), number.isFinite else { return nil }
                return number
            }
            guard numbers.count == 4, numbers[2] > 0, numbers[3] > 0 else { return nil }
            return CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
        }
        func savedBox() -> CGRect {
            guard let frame = nativeOverlayFrame() else { return .null }
            return CGRect(x: frame.minX + frame.width * 0.05, y: frame.minY + frame.height * 0.435,
                          width: frame.width * 0.9, height: frame.height * 0.13)
        }
        func untouched() -> Bool {
            let value = readout()
            return value.split(separator: ";").contains("displayedPage=1") && value.contains("inkPage1=0") &&
                indicator.exists && indicator.label.contains("Page 1 of") && app.buttons["annotateScore"].isHittable &&
                !app.buttons["finishScoreMarkup"].exists && !app.buttons["verdict_clean"].exists &&
                !app.buttons["pausePractice"].exists && !app.buttons["stopSet"].exists && !app.staticTexts["repProgress"].exists
        }
        func unselected() -> Bool {
            untouched() && arm.staticTexts["Whole piece"].exists && !arm.staticTexts["Evenness and pulse"].exists
        }
        func evidence(_ name: String, _ text: String) {
            let attachment = XCTAttachment(string: text)
            attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        }
        require("unselected-zoom-full-paper-and-original-state", app: app) {
            paper.exists && paper.isHittable && overlay.exists && nativeOverlayFrame() != nil &&
                pdf.frame.insetBy(dx: -0.5, dy: -0.5).contains(paper.frame) &&
                app.frame.insetBy(dx: -0.5, dy: -0.5).contains(paper.frame) && unselected()
        }
        // convert(bounds,to:nil) uses the root UIWindow's coordinates. This full-screen
        // simulator fixture must have the same origin as the recorded app coordinate space.
        XCTAssertEqual(app.frame.minX, 0, accuracy: 0.01)
        XCTAssertEqual(app.frame.minY, 0, accuracy: 0.01)
        let originalNativeOverlay = try XCTUnwrap(nativeOverlayFrame(), readout())
        for (native, accessible) in zip([originalNativeOverlay.minX, originalNativeOverlay.minY, originalNativeOverlay.width, originalNativeOverlay.height],
                                        [overlay.frame.minX, overlay.frame.minY, overlay.frame.width, overlay.frame.height]) {
            XCTAssertEqual(native, accessible, accuracy: 0.5, "The initially fully visible AX overlay must confirm native window coordinates.")
        }
        let initialScale = try XCTUnwrap(nativeScale(), readout())
        let initialPage = indicator.label
        let pinchCenter = CGPoint(x: paper.frame.midX, y: paper.frame.midY)
        XCTAssertTrue(savedBox().contains(pinchCenter) && pdf.frame.contains(pinchCenter),
                      "The real pinch midpoint must start inside the unselected saved box.")
        evidence("unselected-zoom-real-pinch-target", "paper=\(paper.frame) nativeOverlay=\(originalNativeOverlay) axOverlay=\(overlay.frame) box=\(savedBox()) midpoint=\(pinchCenter) pdf=\(pdf.frame) scale=\(initialScale)")
        capture("unselected-zoom-before-one-real-pinch", app: app)
        // XCTest starts its two fingers close together. This established spread crosses
        // native recognition threshold; the actual PDFKit scale is required below.
        paper.pinch(withScale: 5, velocity: 1)
        require("unselected-zoom-native-scale-increased-without-selection", app: app) {
            nativeScale().map { $0 > initialScale * 1.25 } == true && unselected()
        }
        let pinchedScale = try XCTUnwrap(nativeScale(), readout())
        var previousOverlay = CGRect.zero
        var changed = Date.now
        let panReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard overlay.exists, let frame = nativeOverlayFrame() else { return false }
            let visibleBox = savedBox().intersection(pdf.frame).intersection(app.frame)
            guard visibleBox.width > 100, visibleBox.height > 50 else { return false }
            if frame != previousOverlay { previousOverlay = frame; changed = .now; return false }
            return Date.now.timeIntervalSince(changed) >= 0.4 && unselected()
        }, object: nil)
        let panReadiness = XCTWaiter.wait(for: [panReady], timeout: 8)
        capture("unselected-zoom-before-one-real-inside-box-pan", app: app)
        evidence("unselected-zoom-pan-readiness", "result=\(panReadiness.rawValue) nativeOverlay=\(String(describing: nativeOverlayFrame())) axOverlay=\(overlay.frame) box=\(savedBox()) pdf=\(pdf.frame) value=\(readout())")
        XCTAssertEqual(panReadiness, .completed)
        let beforePan = try XCTUnwrap(nativeOverlayFrame(), readout())
        let visibleBox = savedBox().intersection(pdf.frame).intersection(app.frame).insetBy(dx: 8, dy: 8)
        let panStart = CGPoint(x: visibleBox.midX, y: visibleBox.midY)
        let panEnd = CGPoint(x: panStart.x + 60, y: panStart.y + 18)
        XCTAssertTrue(savedBox().contains(panStart) && pdf.frame.contains(panStart) && pdf.frame.contains(panEnd))
        let origin = app.frame.origin
        evidence("unselected-zoom-real-pan-target", "start=\(panStart) end=\(panEnd) nativeOverlay=\(beforePan) axOverlay=\(overlay.frame) box=\(savedBox())")
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: panStart.x - origin.x, dy: panStart.y - origin.y))
            .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: panEnd.x - origin.x, dy: panEnd.y - origin.y)),
                withVelocity: .slow, thenHoldForDuration: 0.1)
        require("unselected-zoom-real-pan-moved-page-without-selection", app: app) {
            overlay.exists && nativeOverlayFrame().map { abs($0.minX - beforePan.minX) > 10 || abs($0.minY - beforePan.minY) > 10 } == true &&
                nativeScale().map { abs($0 - pinchedScale) < 0.01 } == true && unselected()
        }
        var previousBox = CGRect.zero
        changed = .now
        let armReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard overlay.exists, nativeOverlayFrame() != nil else { return false }
            let box = savedBox().intersection(pdf.frame).intersection(app.frame).insetBy(dx: 8, dy: 8)
            guard box.width > 50, box.height > 30 else { return false }
            if box != previousBox { previousBox = box; changed = .now; return false }
            return Date.now.timeIntervalSince(changed) >= 0.4 && unselected()
        }, object: nil)
        let armReadiness = XCTWaiter.wait(for: [armReady], timeout: 8)
        capture("unselected-zoom-before-one-actual-arm-tap", app: app)
        let finalBox = savedBox().intersection(pdf.frame).intersection(app.frame).insetBy(dx: 8, dy: 8)
        let target = CGPoint(x: finalBox.midX, y: finalBox.midY)
        evidence("unselected-zoom-single-arm-target", "result=\(armReadiness.rawValue) target=\(target) box=\(savedBox()) nativeOverlay=\(String(describing: nativeOverlayFrame())) axOverlay=\(overlay.frame) pdf=\(pdf.frame) value=\(readout())")
        XCTAssertEqual(armReadiness, .completed)
        XCTAssertTrue(savedBox().contains(target) && pdf.frame.contains(target) && app.frame.contains(target))
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: target.x - origin.x, dy: target.y - origin.y)).tap()
        require("unselected-zoom-single-tap-arms-correct-passage", app: app) {
            untouched() && indicator.label == initialPage && arm.staticTexts["Evenness and pulse"].exists &&
                !arm.staticTexts["Whole piece"].exists && app.buttons["coldGrade_missed"].isHittable &&
                app.buttons["skipColdGrade"].isHittable && nativeScale().map { abs($0 - pinchedScale) < 0.01 } == true
        }
        evidence("unselected-zoom-final-full-readout", readout())
    }

    @MainActor func testPracticeStudyGridCenterTapOpensActualScore() {
        let app = XCUIApplication(); launchToday(app)
        openScore(app)
    }

    @MainActor func testLibraryCardPaddingIsPartOfTheTapTarget() {
        let app = XCUIApplication(); launchToday(app); openPieces(app)
        let piece = app.buttons.matching(NSPredicate(format:
            "identifier == %@ AND label CONTAINS %@ AND label CONTAINS %@",
            "pieceRow", "Practice study", "Praelude test score")).firstMatch
        require("padding-card-target-visible", app: app) { piece.exists && piece.isHittable }
        let frame = piece.frame
        let point = CGPoint(x: frame.minX + 5, y: frame.midY)
        XCTAssertTrue(app.frame.contains(frame) && frame.contains(point), app.debugDescription)
        let cover = piece.images.firstMatch
        XCTAssertTrue(cover.exists, app.debugDescription)
        XCTAssertFalse(cover.frame.contains(point), "The regression must tap card padding, outside the painted cover.")
        capture("library-card-padding-before", app: app)
        let target = XCTAttachment(string: "card=\(frame) cover=\(cover.frame) touch=\(point)")
        target.name = "library-card-padding-target"; target.lifetime = .keepAlways; add(target)
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y)).tap()
        capture("library-card-padding-immediately-after", app: app)
        require("library-card-padding-opens-score", app: app) {
            app.buttons["annotateScore"].isHittable && app.otherElements["scorePDF"].textViews.firstMatch.exists
        }
    }

    @MainActor func testPassagesSingleTapSelectsSavedRowAndArmsColdAttempt() {
        let app = XCUIApplication(); launchToday(app); openScore(app)
        centerTap(app.buttons["passages"], name: "score-passages", app: app)
        require("passages-list-open", app: app) { app.navigationBars["Passages"].exists }
        let row = app.buttons.matching(NSPredicate(format:
            "identifier BEGINSWITH %@ AND label CONTAINS %@", "savedPassage_", "Evenness and pulse")).firstMatch
        centerTap(row, name: "saved-evenness-row", app: app)
        require("evenness-cold-attempt-armed", app: app) {
            !app.navigationBars["Passages"].exists &&
            app.otherElements["practiceArmPanel"].staticTexts["Evenness and pulse"].exists &&
            app.buttons["coldGrade_missed"].exists && app.buttons["coldGrade_missed"].isHittable &&
            app.buttons["skipColdGrade"].exists
        }
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        XCTAssertFalse(app.buttons["stopSet"].exists)
        XCTAssertFalse(app.buttons["verdict_clean"].exists)
    }

    @MainActor func testCameraSettingsSingleTapDoneAndReopenAfterScoreCloseRelaunch() {
        let app = XCUIApplication(); launchToday(app); openScore(app)
        openCamera(app, stage: "first")
        closeCamera(app, stage: "first")
        centerTap(app.buttons["closeScore"], name: "close-score-before-relaunch", app: app)
        require("score-closed-to-pieces", app: app) {
            app.navigationBars["Pieces"].exists && !app.buttons["annotateScore"].exists
        }
        capture("before-actual-terminate", app: app)
        app.terminate()
        launchToday(app, reset: false)
        openScore(app)
        openCamera(app, stage: "relaunch")
        closeCamera(app, stage: "relaunch")
        XCTAssertFalse(app.otherElements["scoreCameraControls"].exists)
    }
}
