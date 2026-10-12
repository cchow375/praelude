import XCTest

/// Actual UI navigation plus explicitly injected final recognition results. Speech permissions
/// and capture are replaced only by --uitesting --audit-simulated-voice; this is not microphone,
/// piano-room recognition, or audible metronome acceptance.
final class VoiceContextUITests: XCTestCase {
    @MainActor private func capture(_ name: String, app: XCUIApplication) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }

    @MainActor private func fields(_ app: XCUIApplication, includeOccluded: Bool = false) -> [String: String]? {
        let visible = app.staticTexts.matching(identifier: "voiceAuditState").allElementsBoundByIndex.filter {
            includeOccluded || ($0.isHittable && app.frame.contains($0.frame))
        }
        guard visible.count == 1, let raw = visible[0].value as? String else { return nil }
        return Dictionary(uniqueKeysWithValues: raw.split(separator: ";", omittingEmptySubsequences: false).compactMap {
            let parts = $0.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2 else { return nil }
            return (String(parts[0]), String(parts[1]))
        })
    }

    @MainActor private func require(_ name: String, app: XCUIApplication, timeout: TimeInterval = 8,
                                    _ condition: @escaping @MainActor () -> Bool) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        let result = XCTWaiter.wait(for: [ready], timeout: timeout)
        capture(name, app: app)
        if name == "actual-saved-box-armed", app.launchArguments.contains("--audit-reading-delivery") {
            geometry("passive-reading-delivery-full-pdf-value-before-arm-assertion",
                     app.otherElements["scorePDF"].value as? String ?? "missing-pdf-value")
        }
        XCTAssertEqual(result, .completed, "Required state: \(name)\n\(app.debugDescription)")
    }

    @MainActor private func requireState(_ name: String, app: XCUIApplication,
                                         _ condition: @escaping @MainActor ([String: String]) -> Bool) throws -> [String: String] {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.fields(app).map(condition) == true
        }, object: nil)
        let result = XCTWaiter.wait(for: [ready], timeout: 8)
        capture(name, app: app)
        let state = fields(app)
        let readouts = app.staticTexts.matching(identifier: "voiceAuditState").allElementsBoundByIndex
            .filter(\.exists).map { element -> [String: String] in
                ["value": element.value as? String ?? "", "frame": String(describing: element.frame),
                 "hittable": String(element.isHittable)]
            }
        let payload: [String: Any] = ["foregroundFields": state ?? [:], "allSyntheticReadouts": readouts,
                                      "readiness": result.rawValue]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
        geometry(name + "-complete-synthetic-state", String(decoding: data, as: UTF8.self))
        // Attach complete values before asserting: continueAfterFailure=false can abort here.
        XCTAssertEqual(result, .completed, "Required state: \(name)\n\(app.debugDescription)")
        return try XCTUnwrap(state, "Exactly one visible audit readout is required.")
    }

    @MainActor private func geometry(_ name: String, _ text: String) {
        let attachment = XCTAttachment(string: text)
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    @MainActor private func tap(_ element: XCUIElement, name: String, app: XCUIApplication,
                                visibleRect: (@MainActor () -> CGRect?)? = nil, centered: Bool = false,
                                tapCount: Int = 1) {
        var previous = CGRect.zero
        var changed = Date.now
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard element.exists, element.isHittable else { return false }
            let frame = element.frame
            guard frame.width > 1, frame.height > 1, app.frame.contains(frame) else { return false }
            if let visibleRect {
                guard let viewport = visibleRect(), viewport.contains(frame) else { return false }
            }
            if frame != previous { previous = frame; changed = .now; return false }
            return Date.now.timeIntervalSince(changed) >= 0.4
        }, object: nil)
        let result = XCTWaiter.wait(for: [ready], timeout: 8)
        capture(name + "-before", app: app)
        let frame = element.frame
        geometry(name + "-target", "frame=\(frame) center=(\(frame.midX),\(frame.midY)) hittable=\(element.isHittable) app=\(app.frame) viewport=\(String(describing: visibleRect?())) readiness=\(result.rawValue) tapCount=\(tapCount)")
        XCTAssertEqual(result, .completed, "Stable visible target required: \(name)\n\(app.debugDescription)")
        guard result == .completed else { return }
        if tapCount > 1 {
            XCTAssertFalse(centered, "Multiple taps require the observed real element target.")
            element.tap(withNumberOfTaps: tapCount, numberOfTouches: 1)
        } else if centered {
            app.coordinate(withNormalizedOffset: .zero).withOffset(
                CGVector(dx: frame.midX - app.frame.minX, dy: frame.midY - app.frame.minY)).tap()
        } else { element.tap() }
        capture(name + "-immediately-after", app: app)
    }

    @MainActor private func auditTap(_ identifier: String, name: String, app: XCUIApplication) throws {
        let visible = app.buttons.matching(identifier: identifier).allElementsBoundByIndex.filter {
            $0.isHittable && app.frame.contains($0.frame)
        }
        XCTAssertEqual(visible.count, 1, "Exactly one foreground audit button required: \(identifier)\n\(app.debugDescription)")
        tap(try XCTUnwrap(visible.first), name: name, app: app)
    }

    @MainActor private func settingsViewport(_ list: XCUIElement, app: XCUIApplication) -> CGRect {
        let bar = app.navigationBars["Hands-free"].frame
        var viewport = list.frame.intersection(app.frame)
        viewport.origin.y = max(viewport.minY, bar.maxY)
        viewport.size.height = max(0, min(list.frame.maxY, app.frame.maxY) - viewport.minY)
        // The audit strip belongs to the sheet's safe-area inset, outside the scrollable list.
        let strips = app.otherElements.matching(identifier: "voiceAuditStrip").allElementsBoundByIndex
            .map(\.frame).filter { list.frame.contains($0) && $0.minY > bar.maxY }
        if let top = strips.map(\.minY).min() { viewport.size.height = max(0, top - viewport.minY) }
        return viewport.insetBy(dx: 5, dy: 5)
    }

    @MainActor private func foregroundSettingsLists(_ app: XCUIApplication) -> [XCUIElement] {
        let bars = app.navigationBars.matching(identifier: "Hands-free").allElementsBoundByIndex.filter {
            $0.exists && app.frame.contains($0.frame)
        }
        guard bars.count == 1 else { return [] }
        let bar = bars[0].frame
        return app.collectionViews.allElementsBoundByIndex.filter { list in
            let frame = list.frame
            guard frame.width > 100, frame.height > 100,
                  app.frame.insetBy(dx: -0.5, dy: -0.5).contains(frame),
                  frame.insetBy(dx: -0.5, dy: -0.5).contains(bar),
                  abs(frame.minX - bar.minX) <= 0.5, abs(frame.width - bar.width) <= 0.5 else { return false }
            let viewport = settingsViewport(list, app: app)
            return list.buttons.allElementsBoundByIndex.contains {
                $0.isHittable && viewport.contains($0.frame)
            }
        }
    }

    @MainActor private func settledSettingsList(_ app: XCUIApplication, name: String) -> XCUIElement? {
        var previous = CGRect.zero
        var changed = Date.now
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let lists = self.foregroundSettingsLists(app)
            guard lists.count == 1 else { return false }
            let viewport = self.settingsViewport(lists[0], app: app)
            guard viewport.width > 100, viewport.height > 100 else { return false }
            if viewport != previous { previous = viewport; changed = .now; return false }
            return Date.now.timeIntervalSince(changed) >= 0.4
        }, object: nil)
        let result = XCTWaiter.wait(for: [ready], timeout: 8)
        let lists = foregroundSettingsLists(app)
        geometry(name + "-list-geometry", "navigation=\(app.navigationBars["Hands-free"].frame) candidates=\(lists.map(\.frame)) viewports=\(lists.map { settingsViewport($0, app: app) }) containerHittable=\(lists.map(\.isHittable)) readiness=\(result.rawValue)")
        XCTAssertEqual(result, .completed, "One settled Hands-free list with a visible child is required.\n\(app.debugDescription)")
        guard result == .completed, lists.count == 1 else { return nil }
        return lists[0]
    }

    @MainActor private func reveal(_ element: XCUIElement, app: XCUIApplication, name: String, upward: Bool = true) {
        // Bounded view-finding scrolls precede the single action tap; a failed action is never retried.
        guard let list = settledSettingsList(app, name: name) else { return }
        for index in 0..<8 {
            let viewport = settingsViewport(list, app: app)
            geometry(name + "-scroll-\(index)-geometry", "list=\(list.frame) viewport=\(viewport) target=\(element.exists ? String(describing: element.frame) : "absent") targetHittable=\(element.isHittable)")
            if element.exists, element.isHittable, viewport.contains(element.frame) { break }
            let origin = app.frame.origin
            let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
                dx: viewport.midX - origin.x, dy: viewport.minY + viewport.height * (upward ? 0.75 : 0.35) - origin.y))
            let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
                dx: viewport.midX - origin.x, dy: viewport.minY + viewport.height * (upward ? 0.45 : 0.65) - origin.y))
            from.press(forDuration: 0.1, thenDragTo: to,
                withVelocity: .slow, thenHoldForDuration: 0.1)
        }
        tap(element, name: name, app: app, visibleRect: { self.settingsViewport(list, app: app) })
    }

    @MainActor private func openArmedScore(_ app: XCUIApplication, auditTaps: Bool = false,
                                         auditReadingDelivery: Bool = false) throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--uitesting", "--reset", "--seed", "--seed-sections",
                               "--audit-gesture-preservation", "--audit-open-gesture-score", "--audit-simulated-voice"]
        if auditTaps { app.launchArguments.append("--audit-taps") }
        if auditReadingDelivery { app.launchArguments.append("--audit-reading-delivery") }
        app.launch()
        require("simulated-voice-direct-score-open", app: app) {
            app.buttons["annotateScore"].isHittable && app.otherElements["scorePDF"].textViews.firstMatch.exists
        }
        let score = app.otherElements["scorePDF"]
        let page = score.textViews.firstMatch
        var previousPage = CGRect.zero
        var previousScore = CGRect.zero
        var previousApp = CGRect.zero
        var changed = Date.now
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard score.exists, page.exists, page.isHittable else { return false }
            let paper = page.frame, viewport = score.frame, window = app.frame
            // A half-point tolerance allows subpixel AX boundary rounding. The whole paper
            // still has to be visible; merely having its center on screen is insufficient.
            guard paper.width > 100, paper.height > 100,
                  viewport.insetBy(dx: -0.5, dy: -0.5).contains(paper),
                  window.insetBy(dx: -0.5, dy: -0.5).contains(paper) else { return false }
            if paper != previousPage || viewport != previousScore || window != previousApp {
                previousPage = paper; previousScore = viewport; previousApp = window
                changed = .now; return false
            }
            return Date.now.timeIntervalSince(changed) >= 0.4
        }, object: nil)
        let readiness = XCTWaiter.wait(for: [ready], timeout: 8)
        let paper = page.frame, viewport = score.frame, window = app.frame
        let center = CGPoint(x: paper.midX, y: paper.midY)
        // This explicit fixture puts the saved region at x=.05...95, y=.435...565.
        let savedBox = CGRect(x: paper.minX + paper.width * 0.05, y: paper.minY + paper.height * 0.435,
                              width: paper.width * 0.9, height: paper.height * 0.13)
        func exact(_ frame: CGRect) -> String {
            [frame.minX, frame.minY, frame.width, frame.height, frame.maxX, frame.maxY]
                .map { String(format: "%.17g", Double($0)) }.joined(separator: ",")
        }
        let geometry = XCTAttachment(string: "page[minX,minY,width,height,maxX,maxY]=\(exact(paper))\nscore=\(exact(viewport))\napp=\(exact(window))\nsavedBox=\(exact(savedBox))\npageHittable=\(page.isHittable)\nstrictScoreContains=\(viewport.contains(paper))\ntolerantScoreContains=\(viewport.insetBy(dx: -0.5, dy: -0.5).contains(paper))\nstrictAppContains=\(window.contains(paper))\ntolerantAppContains=\(window.insetBy(dx: -0.5, dy: -0.5).contains(paper))\ncenter=(\(String(format: "%.17g", Double(center.x))),\(String(format: "%.17g", Double(center.y))))\nreadiness=\(readiness.rawValue)")
        geometry.name = "actual-saved-box-arm-target-exact-geometry"; geometry.lifetime = .keepAlways; add(geometry)
        capture("actual-saved-box-arm-before-single-center-tap", app: app)
        XCTAssertEqual(readiness, .completed, "Complete visible, hittable paper must settle before the one arm tap.\n\(app.debugDescription)")
        XCTAssertTrue(viewport.contains(center) && window.contains(center) && savedBox.contains(center),
                      "The recorded center must lie in the viewport, app and explicit saved fixture box.")
        app.coordinate(withNormalizedOffset: .zero).withOffset(
            CGVector(dx: center.x - window.minX, dy: center.y - window.minY)).tap()
        capture("actual-saved-box-arm-immediately-after-single-center-tap", app: app)
        require("actual-saved-box-armed", app: app) {
            app.otherElements["practiceArmPanel"].staticTexts["Evenness and pulse"].exists &&
            app.buttons["coldGrade_missed"].isHittable
        }
        _ = try requireState("armed-with-no-recognition", app: app) {
            $0["attempts"] == "0" && $0["listening"] == "0" && Double($0["armedBPM"] ?? "") == 60
        }
    }

    /// Opt-in diagnostic of the unchanged single-center arming flow. This is kept separate
    /// from normal-flags acceptance and does not retry or directly select the passage.
    @MainActor func testDiagnosticSavedBoxSingleCenterTapDeliveryUnderTrace() throws {
        let app = XCUIApplication()
        try openArmedScore(app, auditTaps: true)
        XCTAssertTrue(app.launchArguments.contains("--audit-taps"))
        capture("diagnostic-single-center-armed-with-trace", app: app)
    }

    @MainActor func testPassiveSavedBoxSingleCenterTapDeliveryWithoutTraceHooks() throws {
        let app = XCUIApplication()
        try openArmedScore(app, auditReadingDelivery: true)
        XCTAssertFalse(app.launchArguments.contains("--audit-taps"))
        XCTAssertTrue(app.launchArguments.contains("--audit-reading-delivery"))
        let value = try XCTUnwrap(app.otherElements["scorePDF"].value as? String)
        XCTAssertTrue(value.contains("passiveReading=["))
        XCTAssertTrue(value.contains("reading.action"))
        XCTAssertTrue(value.contains("score.reading.assigned"))
        geometry("passive-reading-delivery-complete-full-pdf-value", value)
    }

    /// One unchanged helper tap per fresh disposable process, with no diagnostic tracing,
    /// action retry, or direct passage selection. The first failed launch ends the case.
    @MainActor func testSavedBoxSingleCenterTapArmsAcrossTenUntracedProcessLaunches() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        defer { app.terminate() }
        for launch in 1...10 {
            app.terminate()
            let stopped = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.state == .notRunning }, object: nil)
            let termination = XCTWaiter.wait(for: [stopped], timeout: 8)
            geometry("untraced-saved-box-launch-\(launch)-previous-process-terminated", "result=\(termination.rawValue) state=\(app.state.rawValue)")
            XCTAssertEqual(termination, .completed, "The preceding process must exit before a fresh reset launch.")
            try openArmedScore(app)
            XCTAssertFalse(app.launchArguments.contains("--audit-taps"))
            XCTAssertTrue(app.launchArguments.contains("--reset"))
            XCTAssertEqual(app.state, .runningForeground)
            let state = try requireState("untraced-saved-box-launch-\(launch)-armed-without-practice", app: app) {
                $0["attempts"] == "0" && $0["rawAttemptRows"] == "0" && $0["undoneRows"] == "0" &&
                $0["historySets"] == "0" && $0["sessions"] == "0" && $0["page"] == "1" &&
                $0["scoreOwner"] == "0" && $0["ownerPresent"] == "0" && $0["listening"] == "0" &&
                $0["muted"] == "0" && $0["click"] == "0" && Double($0["armedBPM"] ?? "") == 60 &&
                app.otherElements["practiceArmPanel"].staticTexts["Evenness and pulse"].exists &&
                app.buttons["coldGrade_missed"].isHittable && !app.buttons["verdict_clean"].exists
            }
            assertLedgerReadout(state)
            geometry("untraced-saved-box-launch-\(launch)-complete-state", String(describing: state))
        }
    }

    @MainActor private func enableScoreVoice(_ app: XCUIApplication) throws {
        tap(app.buttons["scoreVoice"], name: "enable-simulated-score-voice", app: app)
        _ = try requireState("simulated-score-listening", app: app) { $0["listening"] == "1" }
    }

    @MainActor private func protectedState(_ state: [String: String]) -> [String: String] {
        state.filter { ["attempts", "rawAttemptRows", "undoneRows", "historySets", "sessions",
                        "page", "clickBPM", "click", "armedBPM"].contains($0.key) }
    }

    @MainActor private func assertLedgerReadout(_ state: [String: String]) {
        for key in ["attempts", "rawAttemptRows", "undoneRows", "historySets", "sessions"] {
            XCTAssertNotNil(state[key].flatMap(Int.init), "Missing required ledger counter: \(key)")
        }
    }

    @MainActor private func assertUnchanged(_ before: [String: String], app: XCUIApplication, name: String) throws {
        assertLedgerReadout(before)
        let protected = protectedState(before)
        let mutation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.fields(app).map { self.protectedState($0) != protected } == true
        }, object: nil)
        mutation.isInverted = true
        let result = XCTWaiter.wait(for: [mutation], timeout: 1)
        capture(name, app: app)
        XCTAssertEqual(result, .completed, "Practice, page and click state must remain unchanged.")
        XCTAssertEqual(protectedState(try XCTUnwrap(fields(app))), protected)
    }

    @MainActor private func blockedCommands(_ app: XCUIApplication, stage: String) throws {
        let before = try requireState(stage + "-score-commands-suspended", app: app) {
            $0["root"] == "0" && $0["supported"] == "" && $0["listening"] == "1"
        }
        assertLedgerReadout(before)
        let protected = protectedState(before)
        for identifier in ["voiceAuditInjectClean", "voiceAuditInjectUndo", "voiceAuditInjectNext", "voiceAuditInjectMetronomeStart"] {
            try auditTap(identifier, name: stage + "-" + identifier, app: app)
            let mutation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                self.fields(app).map { self.protectedState($0) != protected } == true
            }, object: nil)
            mutation.isInverted = true
            let result = XCTWaiter.wait(for: [mutation], timeout: 1)
            capture(stage + "-" + identifier + "-unchanged", app: app)
            XCTAssertEqual(result, .completed, "A command must not mutate the score behind settings.")
            XCTAssertEqual(protectedState(try XCTUnwrap(fields(app))), protected)
        }
    }

    @MainActor private func back(_ title: String, to expected: String, app: XCUIApplication) {
        tap(app.navigationBars[title].buttons.element(boundBy: 0), name: "back-from-" + title, app: app)
        require("returned-to-" + expected, app: app) { app.navigationBars[expected].exists }
    }

    @MainActor private func menuViewport(_ menu: XCUIElement, app: XCUIApplication) -> CGRect? {
        guard menu.exists else { return nil }
        let content = menu.frame
        // The native menu can expose 1180pt virtual collection content inside a 520pt
        // surface. Query actual AX ancestors of its End row, including a public popover
        // when provided. The virtual content origin may move independently during scroll.
        let surfaces = app.descendants(matching: .popover).containing(.button, identifier: "End practice").allElementsBoundByIndex +
            app.otherElements.containing(.button, identifier: "End practice").allElementsBoundByIndex
        let candidates = surfaces.filter(\.exists).map(\.frame).filter {
            abs($0.minX - content.minX) <= 0.5 && abs($0.width - content.width) <= 0.5 &&
            $0.height > 100 && $0.intersection(content).height > 100 &&
            $0.height <= content.height + 0.5 && app.frame.insetBy(dx: -0.5, dy: -0.5).contains($0)
        }
        // Keep the true clip rectangle for full-row containment. Native menu rows can
        // span the complete surface width; insetting it would reject a visible row and
        // cause an unnecessary drag. Scroll coordinates below are independently interior.
        return candidates.min(by: { $0.height < $1.height })?
            .intersection(content).intersection(app.frame)
    }

    @MainActor private func openRunningPassageDictation(_ app: XCUIApplication, baseline: [String: String], stage: String) throws {
        let titles = app.staticTexts.matching(identifier: "Evenness and pulse").allElementsBoundByIndex.filter {
            $0.isHittable && app.frame.contains($0.frame)
        }
        capture(stage + "-observed-running-title", app: app)
        XCTAssertEqual(titles.count, 1, "Require one actual visible running passage name.")
        tap(try XCTUnwrap(titles.first), name: stage + "-one-hud-name-double-tap", app: app, tapCount: 2)
        try beginVisiblePassageDictation(app, baseline: baseline, stage: stage)
    }

    @MainActor private func beginVisiblePassageDictation(_ app: XCUIApplication, baseline: [String: String], stage: String) throws {
        let field = app.descendants(matching: .any).matching(identifier: "passageRenameField").firstMatch
        let dictate = app.buttons["dictatePassageName"]
        require(stage + "-ordinary-rename-open", app: app) {
            app.navigationBars["Rename passage"].exists && field.exists &&
            (field.value as? String) == "Evenness and pulse" && dictate.isHittable && dictate.label == "Dictate name"
        }
        tap(dictate, name: stage + "-actual-dictate-name", app: app)
        require(stage + "-editor-actually-owns-capture", app: app) {
            dictate.exists && dictate.label == "Finish dictation" &&
            self.fields(app, includeOccluded: true).map {
                $0["scoreOwner"] == "0" && $0["ownerPresent"] == "1" && $0["listening"] == "1" &&
                self.protectedState($0) == self.protectedState(baseline)
            } == true
        }
        let during = try XCTUnwrap(fields(app, includeOccluded: true))
        geometry(stage + "-complete-editor-owned-state", String(describing: during))
        XCTAssertEqual(protectedState(during), protectedState(baseline))
        XCTAssertEqual(field.value as? String, "Evenness and pulse", "No transcript or name edit is injected.")
    }

    @MainActor private func startRealUngradedSet(_ app: XCUIApplication, stage: String) throws {
        try openArmedScore(app)
        XCTAssertFalse(app.launchArguments.contains("--audit-taps"))
        tap(app.buttons["skipColdGrade"], name: stage + "-actual-start-without-grading", app: app)
        require(stage + "-real-set-running", app: app) {
            app.buttons["verdict_clean"].isHittable && app.staticTexts["repProgress"].label.hasPrefix("0 of ")
        }
    }

    @MainActor func testPassageDictationCancelRestoresPriorScoreVoiceAndPracticeContext() throws {
        let app = XCUIApplication(); try openArmedScore(app)
        XCTAssertFalse(app.launchArguments.contains("--audit-taps"))
        tap(app.buttons["skipColdGrade"], name: "dictation-return-start-real-ungraded-set", app: app)
        require("dictation-return-real-set-running", app: app) {
            app.buttons["verdict_clean"].isHittable && app.staticTexts["repProgress"].label.hasPrefix("0 of ")
        }
        try enableScoreVoice(app)
        let before = try requireState("dictation-return-score-owns-listening-before-editor", app: app) {
            $0["scoreOwner"] == "1" && $0["ownerPresent"] == "1" && $0["listening"] == "1" &&
            $0["muted"] == "0" && $0["attempts"] == "0" && $0["rawAttemptRows"] == "0" &&
            $0["undoneRows"] == "0" && $0["supported"]?.contains("clean") == true
        }
        assertLedgerReadout(before)
        let titles = app.staticTexts.matching(identifier: "Evenness and pulse").allElementsBoundByIndex.filter {
            $0.isHittable && app.frame.contains($0.frame)
        }
        capture("dictation-return-observed-running-passage-title", app: app)
        XCTAssertEqual(titles.count, 1, "Require the one actual visible running passage name.")
        tap(try XCTUnwrap(titles.first), name: "dictation-return-one-hud-name-double-tap", app: app, tapCount: 2)
        let field = app.descendants(matching: .any).matching(identifier: "passageRenameField").firstMatch
        let dictate = app.buttons["dictatePassageName"]
        require("dictation-return-ordinary-rename-editor-open", app: app) {
            app.navigationBars["Rename passage"].exists && field.exists &&
            (field.value as? String) == "Evenness and pulse" && dictate.isHittable &&
            dictate.label == "Dictate name"
        }
        tap(dictate, name: "dictation-return-actual-dictate-name", app: app)
        require("dictation-return-editor-actually-owns-capture", app: app) {
            dictate.exists && dictate.label == "Finish dictation" &&
            self.fields(app, includeOccluded: true).map {
                $0["scoreOwner"] == "0" && $0["ownerPresent"] == "1" && $0["listening"] == "1" &&
                self.protectedState($0) == self.protectedState(before)
            } == true
        }
        let during = try XCTUnwrap(fields(app, includeOccluded: true))
        XCTAssertEqual(protectedState(during), protectedState(before))
        XCTAssertEqual(field.value as? String, "Evenness and pulse", "No transcript or name edit is injected.")
        tap(app.navigationBars["Rename passage"].buttons["Cancel"],
            name: "dictation-return-one-actual-editor-cancel", app: app)
        let restored = try requireState("dictation-cancel-restores-prior-score-voice", app: app) {
            !app.navigationBars["Rename passage"].exists && app.buttons["verdict_clean"].isHittable &&
            $0["scoreOwner"] == before["scoreOwner"] && $0["ownerPresent"] == before["ownerPresent"] &&
            $0["listening"] == before["listening"] && $0["muted"] == before["muted"] &&
            $0["supported"]?.contains("clean") == true &&
            self.protectedState($0) == self.protectedState(before)
        }
        XCTAssertEqual(protectedState(restored), protectedState(before))
        XCTAssertTrue(app.staticTexts["Evenness and pulse"].exists)
        try auditTap("voiceAuditInjectClean", name: "dictation-return-fresh-clean-through-restored-owner", app: app)
        let counted = try requireState("dictation-return-fresh-clean-counts-exactly-one", app: app) {
            $0["scoreOwner"] == "1" && $0["listening"] == "1" && $0["muted"] == before["muted"] &&
            $0["attempts"] == "1" && $0["rawAttemptRows"] == "1" && $0["undoneRows"] == "0"
        }
        for key in ["historySets", "sessions", "page", "clickBPM", "click", "armedBPM"] {
            XCTAssertEqual(counted[key], before[key], "Only the fresh post-Cancel Clean may add an attempt.")
        }
    }

    @MainActor func testPassageDictationCancelPreservesPriorMuteUntilExplicitUnmute() throws {
        let app = XCUIApplication(); try startRealUngradedSet(app, stage: "dictation-muted")
        try enableScoreVoice(app)
        tap(app.buttons["scoreVoice"], name: "dictation-muted-open-hands-free", app: app)
        _ = try requireState("dictation-muted-root-listening", app: app) {
            app.navigationBars["Hands-free"].exists && $0["root"] == "1" && $0["scoreOwner"] == "1" && $0["listening"] == "1"
        }
        try auditTap("Mute", name: "dictation-muted-actual-mute", app: app)
        _ = try requireState("dictation-muted-prior-mute-recorded", app: app) { $0["muted"] == "1" && $0["scoreOwner"] == "1" }
        tap(app.navigationBars["Hands-free"].buttons["Done"], name: "dictation-muted-close-settings", app: app)
        let before = try requireState("dictation-muted-score-before-editor", app: app) {
            !app.navigationBars["Hands-free"].exists && $0["scoreOwner"] == "1" && $0["listening"] == "1" &&
            $0["muted"] == "1" && $0["attempts"] == "0" && $0["rawAttemptRows"] == "0"
        }
        try openRunningPassageDictation(app, baseline: before, stage: "dictation-muted")
        tap(app.navigationBars["Rename passage"].buttons["Cancel"], name: "dictation-muted-actual-cancel", app: app)
        let restored = try requireState("dictation-muted-owner-and-mute-restored", app: app) {
            !app.navigationBars["Rename passage"].exists && $0["scoreOwner"] == "1" && $0["ownerPresent"] == "1" &&
            $0["listening"] == "1" && $0["muted"] == "1" && self.protectedState($0) == self.protectedState(before)
        }
        try auditTap("voiceAuditInjectClean", name: "dictation-muted-fresh-clean-rejected", app: app)
        try assertUnchanged(restored, app: app, name: "dictation-muted-clean-does-not-count")
        tap(app.buttons["scoreVoice"], name: "dictation-muted-open-settings-to-unmute", app: app)
        _ = try requireState("dictation-muted-root-still-muted", app: app) {
            app.navigationBars["Hands-free"].exists && $0["root"] == "1" && $0["muted"] == "1"
        }
        try auditTap("Unmute", name: "dictation-muted-explicit-unmute", app: app)
        tap(app.navigationBars["Hands-free"].buttons["Done"], name: "dictation-muted-close-after-unmute", app: app)
        _ = try requireState("dictation-muted-score-explicitly-unmuted", app: app) {
            !app.navigationBars["Hands-free"].exists && $0["scoreOwner"] == "1" && $0["listening"] == "1" && $0["muted"] == "0"
        }
        try auditTap("voiceAuditInjectClean", name: "dictation-muted-fresh-clean-after-explicit-unmute", app: app)
        let counted = try requireState("dictation-muted-unmute-counts-exactly-one", app: app) {
            $0["attempts"] == "1" && $0["rawAttemptRows"] == "1" && $0["undoneRows"] == "0"
        }
        for key in ["historySets", "sessions", "page", "clickBPM", "click", "armedBPM"] {
            XCTAssertEqual(counted[key], before[key])
        }
    }

    @MainActor func testPassageDictationCancelDoesNotEnableOriginallyOffScoreVoice() throws {
        let app = XCUIApplication(); try startRealUngradedSet(app, stage: "dictation-originally-off")
        let before = try requireState("dictation-originally-off-score-before-editor", app: app) {
            $0["scoreOwner"] == "0" && $0["ownerPresent"] == "0" && $0["listening"] == "0" &&
            $0["muted"] == "0" && $0["attempts"] == "0" && $0["rawAttemptRows"] == "0"
        }
        try openRunningPassageDictation(app, baseline: before, stage: "dictation-originally-off")
        tap(app.navigationBars["Rename passage"].buttons["Cancel"], name: "dictation-originally-off-actual-cancel", app: app)
        let restored = try requireState("dictation-originally-off-remains-off", app: app) {
            !app.navigationBars["Rename passage"].exists && app.buttons["verdict_clean"].isHittable &&
            $0["scoreOwner"] == "0" && $0["ownerPresent"] == "0" && $0["listening"] == "0" &&
            $0["muted"] == before["muted"] && self.protectedState($0) == self.protectedState(before)
        }
        try auditTap("voiceAuditInjectClean", name: "dictation-originally-off-final-clean-inert", app: app)
        try assertUnchanged(restored, app: app, name: "dictation-originally-off-no-practice-mutation")
        _ = try requireState("dictation-originally-off-still-off-after-final", app: app) {
            $0["scoreOwner"] == "0" && $0["ownerPresent"] == "0" && $0["listening"] == "0"
        }
    }

    @MainActor func testNewTextDictationCancelRestoresScoreVoiceWithoutSavingNote() throws {
        let app = XCUIApplication(); try startRealUngradedSet(app, stage: "text-dictation-return")
        try enableScoreVoice(app)
        let before = try requireState("text-dictation-return-score-before-note", app: app) {
            $0["scoreOwner"] == "1" && $0["listening"] == "1" && $0["muted"] == "0" &&
            $0["attempts"] == "0" && $0["rawAttemptRows"] == "0"
        }
        let notes = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "scoreNote_"))
        let noteCount = notes.count
        XCTAssertEqual(noteCount, 0, "The disposable fixture starts without saved notes.")
        tap(app.buttons["annotateScore"], name: "text-dictation-return-actual-annotate", app: app)
        require("text-dictation-return-annotation-ready", app: app) { app.buttons["annotationTool_text"].isHittable }
        tap(app.buttons["annotationTool_text"], name: "text-dictation-return-select-text-tool", app: app)
        tap(app.buttons["toggleAnnotationPalette"], name: "text-dictation-return-minimize-palette", app: app)
        tap(app.otherElements["scorePDF"].textViews.firstMatch, name: "text-dictation-return-place-unsaved-note", app: app, centered: true)
        let editor = app.textViews["textAnnotationEditor"]
        let dictate = app.buttons["dictateTextAnnotation"]
        require("text-dictation-return-new-note-editor-open", app: app) {
            app.navigationBars["Note"].exists && editor.exists && (editor.value as? String ?? "").isEmpty &&
            dictate.isHittable && dictate.label == "Dictate note"
        }
        tap(dictate, name: "text-dictation-return-actual-dictate-note", app: app)
        require("text-dictation-return-note-owns-capture", app: app) {
            dictate.exists && dictate.label == "Finish dictating" && self.fields(app, includeOccluded: true).map {
                $0["scoreOwner"] == "0" && $0["ownerPresent"] == "1" && $0["listening"] == "1" &&
                self.protectedState($0) == self.protectedState(before)
            } == true
        }
        geometry("text-dictation-return-complete-editor-owned-state", String(describing: fields(app, includeOccluded: true)))
        tap(app.navigationBars["Note"].buttons["Cancel"], name: "text-dictation-return-one-actual-cancel", app: app)
        let restored = try requireState("text-dictation-return-score-owner-restored", app: app) {
            !app.navigationBars["Note"].exists && $0["scoreOwner"] == "1" && $0["ownerPresent"] == "1" &&
            $0["listening"] == "1" && $0["muted"] == before["muted"] &&
            self.protectedState($0) == self.protectedState(before)
        }
        XCTAssertEqual(notes.count, noteCount, "Cancel must not save a note.")
        tap(app.buttons["finishScoreMarkup"], name: "text-dictation-return-exit-annotation", app: app)
        _ = try requireState("text-dictation-return-reading-without-note", app: app) {
            app.buttons["annotateScore"].isHittable && app.buttons["verdict_clean"].isHittable &&
            $0["scoreOwner"] == "1" && $0["listening"] == "1" &&
            self.protectedState($0) == self.protectedState(restored)
        }
        XCTAssertEqual(notes.count, noteCount)
        try auditTap("voiceAuditInjectClean", name: "text-dictation-return-fresh-clean", app: app)
        let counted = try requireState("text-dictation-return-clean-counts-exactly-one", app: app) {
            $0["attempts"] == "1" && $0["rawAttemptRows"] == "1" && $0["undoneRows"] == "0" && $0["scoreOwner"] == "1"
        }
        for key in ["historySets", "sessions", "page", "clickBPM", "click", "armedBPM"] { XCTAssertEqual(counted[key], before[key]) }
    }

    @MainActor func testSavedNoteDictationCancelRestoresScoreVoiceAndPreservesStoredText() throws {
        let app = XCUIApplication(); try openArmedScore(app)
        XCTAssertFalse(app.launchArguments.contains("--audit-taps"))
        XCTAssertFalse(app.launchArguments.contains("--audit-reading-delivery"))
        try enableScoreVoice(app)
        let before = try requireState("saved-note-return-armed-score-before-note", app: app) {
            app.buttons["coldGrade_missed"].isHittable && $0["scoreOwner"] == "1" && $0["listening"] == "1" &&
            $0["muted"] == "0" && $0["attempts"] == "0" && $0["rawAttemptRows"] == "0"
        }
        let pdf = app.otherElements["scorePDF"]
        let notes = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "scoreNote_"))
        XCTAssertEqual(notes.count, 0, "Create the saved note through the actual UI, starting from an empty fixture.")
        XCTAssertTrue((pdf.value as? String)?.contains("inkPage1=0") == true)
        geometry("saved-note-return-pdf-before-create", pdf.value as? String ?? "missing-pdf-value")
        tap(app.buttons["annotateScore"], name: "saved-note-return-actual-annotate", app: app)
        require("saved-note-return-annotation-ready", app: app) { app.buttons["annotationTool_text"].isHittable }
        tap(app.buttons["annotationTool_text"], name: "saved-note-return-select-text-tool", app: app)
        tap(app.buttons["toggleAnnotationPalette"], name: "saved-note-return-minimize-palette", app: app)
        tap(pdf.textViews.firstMatch, name: "saved-note-return-place-new-note", app: app, centered: true)
        let editor = app.textViews["textAnnotationEditor"]
        let dictate = app.buttons["dictateTextAnnotation"]
        require("saved-note-return-ordinary-new-editor-open", app: app) {
            app.navigationBars["Note"].exists && editor.exists && (editor.value as? String ?? "").isEmpty &&
            dictate.label == "Dictate note"
        }
        let savedText = "Keep the pulse steady."
        tap(editor, name: "saved-note-return-focus-new-note-editor", app: app)
        editor.typeText(savedText)
        require("saved-note-return-exact-text-ready-to-save", app: app) {
            editor.value as? String == savedText && app.buttons["saveTextAnnotation"].isEnabled
        }
        tap(app.buttons["saveTextAnnotation"], name: "saved-note-return-actual-save-note", app: app)
        require("saved-note-return-saved-editor-dismissed", app: app) {
            !app.navigationBars["Note"].exists && app.buttons["finishScoreMarkup"].isHittable
        }
        tap(app.buttons["finishScoreMarkup"], name: "saved-note-return-exit-annotation", app: app)
        let note = notes.matching(NSPredicate(format: "label == %@", savedText)).firstMatch
        _ = try requireState("saved-note-return-stored-note-and-prior-voice-visible", app: app) {
            app.buttons["annotateScore"].isHittable && app.buttons["coldGrade_missed"].isHittable &&
            notes.count == 1 && note.isHittable && $0["scoreOwner"] == "1" && $0["listening"] == "1" &&
            $0["muted"] == before["muted"] && self.protectedState($0) == self.protectedState(before) &&
            (pdf.value as? String)?.contains("inkPage1=0") == true
        }
        let savedIdentifier = note.identifier
        tap(note, name: "saved-note-return-actual-existing-note-double-tap", app: app, tapCount: 2)
        require("saved-note-return-ordinary-existing-editor-open", app: app) {
            app.navigationBars["Note"].exists && editor.value as? String == savedText &&
            dictate.isHittable && dictate.label == "Dictate note"
        }
        tap(dictate, name: "saved-note-return-actual-dictate-existing-note", app: app)
        require("saved-note-return-editor-owns-capture", app: app) {
            dictate.label == "Finish dictating" && editor.value as? String == savedText &&
            self.fields(app, includeOccluded: true).map {
                $0["scoreOwner"] == "0" && $0["ownerPresent"] == "1" && $0["listening"] == "1" &&
                self.protectedState($0) == self.protectedState(before)
            } == true
        }
        geometry("saved-note-return-complete-editor-owned-state", String(describing: fields(app, includeOccluded: true)))
        tap(app.navigationBars["Note"].buttons["Cancel"], name: "saved-note-return-one-actual-dictation-cancel", app: app)
        let restored = try requireState("saved-note-return-score-owner-and-stored-note-restored", app: app) {
            !app.navigationBars["Note"].exists && app.buttons["coldGrade_missed"].isHittable &&
            $0["scoreOwner"] == "1" && $0["ownerPresent"] == "1" && $0["listening"] == "1" &&
            $0["muted"] == before["muted"] && self.protectedState($0) == self.protectedState(before) &&
            notes.count == 1 && note.isHittable && note.identifier == savedIdentifier && note.label == savedText &&
            (pdf.value as? String)?.contains("inkPage1=0") == true
        }
        XCTAssertEqual(protectedState(restored), protectedState(before))
        geometry("saved-note-return-pdf-after-dictation-cancel", pdf.value as? String ?? "missing-pdf-value")
        tap(app.buttons["skipColdGrade"], name: "saved-note-return-actual-start-without-grading", app: app)
        let started = try requireState("saved-note-return-real-set-started-without-attempts", app: app) {
            app.buttons["verdict_clean"].isHittable && $0["scoreOwner"] == "1" && $0["listening"] == "1" &&
            $0["muted"] == before["muted"] && $0["attempts"] == "0" && $0["rawAttemptRows"] == "0"
        }
        try auditTap("voiceAuditInjectClean", name: "saved-note-return-fresh-clean-through-restored-owner", app: app)
        let counted = try requireState("saved-note-return-fresh-clean-counts-exactly-one", app: app) {
            $0["scoreOwner"] == "1" && $0["listening"] == "1" && $0["muted"] == before["muted"] &&
            $0["attempts"] == "1" && $0["rawAttemptRows"] == "1" && $0["undoneRows"] == "0" &&
            notes.count == 1 && note.identifier == savedIdentifier && note.label == savedText &&
            (pdf.value as? String)?.contains("inkPage1=0") == true
        }
        for key in ["historySets", "sessions", "page", "clickBPM", "click", "armedBPM"] {
            XCTAssertEqual(counted[key], started[key], "Only the fresh post-Cancel Clean may add an attempt.")
        }
        try assertUnchanged(counted, app: app, name: "saved-note-return-one-clean-stays-exactly-one")
    }

    @MainActor func testPassagePickerDictationRestoresScoreVoiceOnlyAfterPickerCloses() throws {
        let app = XCUIApplication(); try startRealUngradedSet(app, stage: "picker-dictation-return")
        try enableScoreVoice(app)
        let before = try requireState("picker-dictation-return-score-before-picker", app: app) {
            $0["scoreOwner"] == "1" && $0["listening"] == "1" && $0["muted"] == "0" && $0["attempts"] == "0"
        }
        tap(app.buttons["passages"], name: "picker-dictation-return-actual-passages", app: app)
        require("picker-dictation-return-picker-open", app: app) { app.navigationBars["Passages"].exists }
        let edit = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label == %@",
                                                    "renamePassage_", "Edit name and goal for Evenness and pulse")).firstMatch
        tap(edit, name: "picker-dictation-return-actual-edit", app: app)
        try beginVisiblePassageDictation(app, baseline: before, stage: "picker-dictation-return")
        tap(app.navigationBars["Rename passage"].buttons["Cancel"], name: "picker-dictation-return-actual-editor-cancel", app: app)
        require("picker-dictation-return-still-blocked-inside-picker", app: app) {
            app.navigationBars["Passages"].exists && !app.navigationBars["Rename passage"].exists &&
            self.fields(app, includeOccluded: true).map {
                $0["scoreOwner"] == "0" && $0["ownerPresent"] == "0" && $0["listening"] == "0" &&
                self.protectedState($0) == self.protectedState(before)
            } == true
        }
        geometry("picker-dictation-return-complete-picker-state", String(describing: fields(app, includeOccluded: true)))
        tap(app.navigationBars["Passages"].buttons["Close"], name: "picker-dictation-return-actual-picker-close", app: app)
        let restored = try requireState("picker-dictation-return-score-owner-restored-after-close", app: app) {
            !app.navigationBars["Passages"].exists && app.buttons["verdict_clean"].isHittable &&
            $0["scoreOwner"] == "1" && $0["ownerPresent"] == "1" && $0["listening"] == "1" &&
            $0["muted"] == before["muted"] && self.protectedState($0) == self.protectedState(before)
        }
        XCTAssertEqual(protectedState(restored), protectedState(before))
        try auditTap("voiceAuditInjectClean", name: "picker-dictation-return-fresh-clean", app: app)
        let counted = try requireState("picker-dictation-return-fresh-clean-counts-exactly-one", app: app) {
            $0["attempts"] == "1" && $0["rawAttemptRows"] == "1" && $0["undoneRows"] == "0" && $0["scoreOwner"] == "1"
        }
        for key in ["historySets", "sessions", "page", "clickBPM", "click", "armedBPM"] { XCTAssertEqual(counted[key], before[key]) }
    }

    @MainActor func testArmedPassageDictationFinishAndSaveRestoresVoiceAndStoredName() throws {
        let app = XCUIApplication(); try openArmedScore(app)
        try enableScoreVoice(app)
        let before = try requireState("dictation-save-armed-score-before-editor", app: app) {
            app.buttons["coldGrade_missed"].isHittable && $0["scoreOwner"] == "1" && $0["listening"] == "1" &&
            $0["muted"] == "0" && $0["attempts"] == "0" && $0["rawAttemptRows"] == "0"
        }
        let originalName = "Evenness and pulse"
        let savedName = originalName + " verified"
        let title = app.otherElements["practiceArmPanel"].staticTexts[originalName]
        tap(title, name: "dictation-save-one-armed-name-double-tap", app: app, tapCount: 2)
        try beginVisiblePassageDictation(app, baseline: before, stage: "dictation-save")
        tap(app.buttons["dictatePassageName"], name: "dictation-save-actual-finish-dictation", app: app)
        // The injected capture has no acoustic result. Its existing four-second finalization
        // timeout releases the editor owner; this tests typed Save after that bounded recovery.
        require("dictation-save-finished-owner-released-editor-still-open", app: app) {
            app.navigationBars["Rename passage"].exists && app.buttons["dictatePassageName"].label == "Dictate name" &&
            app.buttons["savePassageName"].isEnabled && self.fields(app, includeOccluded: true).map {
                $0["scoreOwner"] == "0" && $0["ownerPresent"] == "0" && $0["listening"] == "0" &&
                self.protectedState($0) == self.protectedState(before)
            } == true
        }
        geometry("dictation-save-complete-finished-editor-state", String(describing: fields(app, includeOccluded: true)))
        let field = app.descendants(matching: .any).matching(identifier: "passageRenameField").firstMatch
        tap(field, name: "dictation-save-focus-actual-name-field", app: app)
        field.press(forDuration: 1)
        let selectAll = app.menuItems["Select All"].exists ? app.menuItems["Select All"] : app.buttons["Select All"]
        require("dictation-save-actual-select-all-menu", app: app) { selectAll.exists && selectAll.isHittable }
        tap(selectAll, name: "dictation-save-select-existing-name", app: app)
        field.typeText(savedName)
        require("dictation-save-typed-exact-name", app: app) { field.value as? String == savedName }
        tap(app.buttons["savePassageName"], name: "dictation-save-one-actual-save", app: app)
        let saved = try requireState("dictation-save-arm-name-and-score-voice-restored", app: app) {
            !app.navigationBars["Rename passage"].exists &&
            app.otherElements["practiceArmPanel"].staticTexts[savedName].isHittable &&
            $0["scoreOwner"] == "1" && $0["ownerPresent"] == "1" && $0["listening"] == "1" &&
            $0["muted"] == before["muted"] && self.protectedState($0) == self.protectedState(before)
        }
        XCTAssertEqual(protectedState(saved), protectedState(before))
        tap(app.otherElements["practiceArmPanel"].staticTexts[savedName],
            name: "dictation-save-reopen-stored-name-by-real-double-tap", app: app, tapCount: 2)
        require("dictation-save-stored-name-confirmed-in-editor", app: app) {
            app.navigationBars["Rename passage"].exists && field.exists && field.value as? String == savedName &&
            app.buttons["dictatePassageName"].label == "Dictate name"
        }
        tap(app.navigationBars["Rename passage"].buttons["Cancel"], name: "dictation-save-cancel-readback-editor", app: app)
        _ = try requireState("dictation-save-readback-cancel-preserves-owner-and-zero-practice", app: app) {
            !app.navigationBars["Rename passage"].exists && $0["scoreOwner"] == "1" && $0["listening"] == "1" &&
            self.protectedState($0) == self.protectedState(before)
        }
        tap(app.buttons["skipColdGrade"], name: "dictation-save-actual-start-without-grading", app: app)
        let started = try requireState("dictation-save-real-set-started-without-attempts", app: app) {
            app.buttons["verdict_clean"].isHittable && $0["scoreOwner"] == "1" && $0["listening"] == "1" &&
            $0["attempts"] == "0" && $0["rawAttemptRows"] == "0"
        }
        try auditTap("voiceAuditInjectClean", name: "dictation-save-fresh-clean-through-restored-owner", app: app)
        let counted = try requireState("dictation-save-fresh-clean-counts-exactly-one", app: app) {
            $0["attempts"] == "1" && $0["rawAttemptRows"] == "1" && $0["undoneRows"] == "0" &&
            $0["scoreOwner"] == "1" && $0["listening"] == "1"
        }
        for key in ["historySets", "sessions", "page", "clickBPM", "click", "armedBPM"] {
            XCTAssertEqual(counted[key], started[key])
        }
    }

    @MainActor func testOrdinaryVoiceCheckBackRestoresScoreListeningAndPreservesPractice() throws {
        let app = XCUIApplication(); try openArmedScore(app)
        tap(app.buttons["skipColdGrade"], name: "back-case-start-real-ungraded-set", app: app)
        require("back-case-real-set-running", app: app) { app.buttons["verdict_clean"].isHittable }
        try enableScoreVoice(app)
        tap(app.buttons["scoreVoice"], name: "back-case-open-hands-free", app: app)
        let before = try requireState("back-case-score-listening-before-check", app: app) {
            app.navigationBars["Hands-free"].exists && $0["root"] == "1" && $0["listening"] == "1" &&
            $0["muted"] == "0" && $0["attempts"] == "0" && $0["rawAttemptRows"] == "0"
        }
        assertLedgerReadout(before)
        reveal(app.buttons["Check voice recognition"], app: app, name: "back-case-push-recognition-check")
        require("back-case-recognition-check-ready", app: app) {
            app.navigationBars["Voice check"].exists && app.buttons["startVoiceCheck"].label == "Start checking"
        }
        tap(app.buttons["startVoiceCheck"], name: "back-case-start-checking", app: app)
        let checking = try requireState("back-case-check-owns-capture", app: app) {
            $0["root"] == "0" && $0["listening"] == "1" && $0["muted"] == "0" &&
            app.buttons["startVoiceCheck"].label == "Stop checking"
        }
        XCTAssertEqual(protectedState(checking), protectedState(before))
        try auditTap("voiceAuditInjectClean", name: "back-case-clean-owned-only-by-check", app: app)
        let count = app.descendants(matching: .any).matching(identifier: "voiceCheckCount_Clean").firstMatch
        require("back-case-check-counts-one-with-no-practice", app: app) {
            count.exists && ((count.value as? String) == "1" || count.staticTexts["1"].exists || count.label == "Clean, 1") &&
            self.fields(app).map { self.protectedState($0) == self.protectedState(before) } == true
        }
        // Done stops its owner explicitly. This case exercises the ordinary native Back button
        // instead, so ownership must be released by disappearance before score input resumes.
        let bar = app.navigationBars["Voice check"]
        let leading = bar.buttons.allElementsBoundByIndex.filter {
            $0.label != "Done" && $0.frame.midX < bar.frame.midX && $0.isHittable
        }
        capture("back-case-observed-native-navigation-button", app: app)
        XCTAssertEqual(leading.count, 1, "Require the one native leading Back button, never Done.\n\(app.debugDescription)")
        let backButton = try XCTUnwrap(leading.first)
        tap(backButton, name: "back-case-one-native-back-tap", app: app)
        let restored = try requireState("ordinary-back-restores-score-listening", app: app) {
            app.navigationBars["Hands-free"].exists && !app.navigationBars["Voice check"].exists &&
            $0["root"] == "1" && $0["listening"] == "1" && $0["muted"] == before["muted"] &&
            $0["supported"]?.contains("clean") == true
        }
        XCTAssertEqual(protectedState(restored), protectedState(before))
        try auditTap("voiceAuditInjectClean", name: "back-case-fresh-clean-resumes-score", app: app)
        let counted = try requireState("ordinary-back-fresh-clean-counts-one", app: app) {
            $0["attempts"] == "1" && $0["rawAttemptRows"] == "1" && $0["undoneRows"] == "0" &&
            $0["listening"] == "1" && $0["muted"] == before["muted"]
        }
        for key in ["historySets", "sessions", "page", "clickBPM", "click", "armedBPM"] {
            XCTAssertEqual(counted[key], before[key], "Only the fresh post-Back Clean may add a practice attempt.")
        }
    }

    @MainActor func testNestedVoiceSettingsSuspendPracticeAndOnboardingRestoresScoreListening() throws {
        let app = XCUIApplication(); try openArmedScore(app)
        tap(app.buttons["skipColdGrade"], name: "actual-start-without-grading", app: app)
        require("actual-running-set", app: app) { app.buttons["verdict_clean"].isHittable }
        try enableScoreVoice(app)
        tap(app.buttons["scoreVoice"], name: "open-enabled-hands-free-details", app: app)
        _ = try requireState("hands-free-root-active", app: app) {
            app.navigationBars["Hands-free"].exists && $0["root"] == "1" && $0["supported"]?.contains("clean") == true
        }
        try auditTap("voiceAuditInjectClean", name: "baseline-clean-through-real-dispatch", app: app)
        _ = try requireState("baseline-clean-counted", app: app) { $0["attempts"] == "1" }

        reveal(app.buttons["Customize command phrases"], app: app, name: "push-customize-phrases")
        require("phrases-screen", app: app) { app.navigationBars["Hands-free phrases"].exists }
        try blockedCommands(app, stage: "phrases-list")
        tap(app.buttons["voiceAlias_clean"], name: "push-clean-alias-editor", app: app)
        require("clean-alias-editor", app: app) { app.textFields["voiceExtraPhrase0"].exists }
        try blockedCommands(app, stage: "clean-alias-editor")
        back("Clean", to: "Hands-free phrases", app: app)
        back("Hands-free phrases", to: "Hands-free", app: app)
        _ = try requireState("score-context-restored-on-pop", app: app) {
            $0["root"] == "1" && $0["listening"] == "1" && $0["supported"]?.contains("clean") == true
        }
        try auditTap("voiceAuditInjectClean", name: "clean-resumes-after-settings", app: app)
        let beforeCheck = try requireState("second-clean-counted", app: app) { $0["attempts"] == "2" }

        reveal(app.buttons["Check voice recognition"], app: app, name: "push-voice-check-before-start")
        require("voice-check-not-started", app: app) {
            app.navigationBars["Voice check"].exists && app.buttons["startVoiceCheck"].label == "Start checking"
        }
        try blockedCommands(app, stage: "voice-check-before-start")
        tap(app.buttons["startVoiceCheck"], name: "actual-start-recognition-check", app: app)
        _ = try requireState("onboarding-listening-without-practice-mutation", app: app) {
            $0["root"] == "0" && $0["listening"] == "1" && $0["attempts"] == "2" &&
            app.buttons["startVoiceCheck"].label == "Stop checking"
        }
        try auditTap("voiceAuditInjectClean", name: "clean-owned-by-onboarding", app: app)
        let count = app.descendants(matching: .any).matching(identifier: "voiceCheckCount_Clean").firstMatch
        require("onboarding-counts-clean-only", app: app) {
            count.exists && ((count.value as? String) == "1" || count.staticTexts["1"].exists || count.label == "Clean, 1") &&
            self.fields(app).map { self.protectedState($0) == self.protectedState(beforeCheck) } == true
        }
        tap(app.navigationBars["Voice check"].buttons["Done"], name: "finish-onboarding-check", app: app)
        _ = try requireState("score-listening-restored-after-onboarding", app: app) {
            app.navigationBars["Hands-free"].exists && $0["root"] == "1" && $0["listening"] == "1" &&
            $0["attempts"] == "2" && $0["supported"]?.contains("clean") == true
        }
        try auditTap("voiceAuditInjectClean", name: "clean-after-onboarding-resume", app: app)
        _ = try requireState("third-clean-counted-by-score", app: app) { $0["attempts"] == "3" }
    }

    @MainActor func testVoiceMetronomeUsesArmedSixtyInsteadOfRetainedNinety() throws {
        let app = XCUIApplication(); try openArmedScore(app); try enableScoreVoice(app)
        try auditTap("voiceAuditRetain90", name: "retain-click-ninety-with-arm-sixty", app: app)
        _ = try requireState("retained-ninety-armed-sixty", app: app) {
            Double($0["clickBPM"] ?? "") == 90 && Double($0["armedBPM"] ?? "") == 60 &&
            $0["click"] == "0" && $0["attempts"] == "0"
        }
        try auditTap("voiceAuditInjectMetronomeStart", name: "voice-click-start-before-first-attempt", app: app)
        _ = try requireState("voice-click-follows-arm-sixty", app: app) {
            Double($0["clickBPM"] ?? "") == 60 && Double($0["armedBPM"] ?? "") == 60 &&
            $0["click"] == "1" && $0["attempts"] == "0" && app.buttons["coldGrade_missed"].exists
        }
        try auditTap("voiceAuditInjectMetronomeStop", name: "voice-click-stop-before-first-attempt", app: app)
        let stopped = try requireState("voice-click-stopped-without-grading", app: app) { $0["click"] == "0" && $0["attempts"] == "0" }
        XCTAssertFalse(app.buttons["pausePractice"].exists)
        XCTAssertFalse(app.buttons["stopSet"].exists)
        XCTAssertEqual(stopped["page"], "1")
        try auditTap("voiceAuditInjectNext", name: "allowed-bare-next-final-turns-page", app: app)
        let turned = try requireState("allowed-bare-next-actually-shows-page-two", app: app) {
            $0["page"] == "2" && app.buttons["pageIndicator"].exists &&
            app.buttons["pageIndicator"].label.contains("Page 2 of") && $0["listening"] == "1"
        }
        for key in ["attempts", "rawAttemptRows", "undoneRows", "historySets", "sessions", "clickBPM", "click", "armedBPM"] {
            XCTAssertEqual(turned[key], stopped[key], "Bare Next may only turn the page.")
        }
    }

    @MainActor func testVoiceUndoTracksFirstTouchVerdictAndUndoAllWithoutNavigation() throws {
        let app = XCUIApplication(); try openArmedScore(app)
        tap(app.buttons["skipColdGrade"], name: "undo-context-start-real-ungraded-set", app: app)
        require("undo-context-set-running-before-first-verdict", app: app) {
            app.buttons["verdict_clean"].isHittable && app.staticTexts["repProgress"].label.hasPrefix("0 of ")
        }
        try enableScoreVoice(app)
        let baseline = try requireState("voice-enabled-before-first-attempt-no-undo", app: app) {
            let actions = Set(($0["supported"] ?? "").split(separator: ",").map(String.init))
            return $0["attempts"] == "0" && $0["rawAttemptRows"] == "0" && $0["undoneRows"] == "0" &&
                $0["listening"] == "1" && actions.contains("clean") && !actions.contains("undo")
        }
        assertLedgerReadout(baseline)
        // Each cycle is new work, not a retry: one real verdict tap followed by one injected
        // final Undo. No navigation, sheet, pause or focus change can refresh the context for us.
        for cycle in 1...2 {
            tap(app.buttons["verdict_clean"], name: "cycle-\(cycle)-actual-first-clean", app: app)
            let counted = try requireState("cycle-\(cycle)-clean-immediately-enables-voice-undo", app: app) {
                let actions = Set(($0["supported"] ?? "").split(separator: ",").map(String.init))
                return $0["attempts"] == "1" && $0["rawAttemptRows"] == String(cycle) &&
                    $0["undoneRows"] == String(cycle - 1) && actions.contains("undo") &&
                    $0["listening"] == "1" && app.staticTexts["repProgress"].label.hasPrefix("1 of ")
            }
            XCTAssertEqual(counted["historySets"], baseline["historySets"])
            XCTAssertEqual(counted["sessions"], baseline["sessions"])
            try auditTap("voiceAuditInjectUndo", name: "cycle-\(cycle)-fresh-final-voice-undo", app: app)
            let undone = try requireState("cycle-\(cycle)-undo-all-disables-voice-undo", app: app) {
                let actions = Set(($0["supported"] ?? "").split(separator: ",").map(String.init))
                return $0["attempts"] == "0" && $0["rawAttemptRows"] == String(cycle) &&
                    $0["undoneRows"] == String(cycle) && !actions.contains("undo") && actions.contains("clean") &&
                    $0["listening"] == "1" && app.staticTexts["repProgress"].label.hasPrefix("0 of ") &&
                    app.buttons["verdict_clean"].isHittable
            }
            for key in ["historySets", "sessions", "page", "clickBPM", "click", "armedBPM"] {
                XCTAssertEqual(undone[key], baseline[key], "Clean/Undo must not change \(key).")
            }
        }
    }

    @MainActor func testRecognitionCheckRestoresPriorScoreMuteUntilExplicitUnmute() throws {
        let app = XCUIApplication(); try openArmedScore(app)
        tap(app.buttons["skipColdGrade"], name: "mute-case-start-real-set", app: app)
        require("mute-case-real-set-running", app: app) { app.buttons["verdict_clean"].isHittable }
        try enableScoreVoice(app)
        tap(app.buttons["scoreVoice"], name: "mute-case-open-hands-free", app: app)
        _ = try requireState("mute-case-hands-free-root", app: app) {
            app.navigationBars["Hands-free"].exists && $0["root"] == "1" && $0["muted"] == "0"
        }
        try auditTap("Mute", name: "actual-score-mute", app: app)
        let muted = try requireState("score-muted-before-recognition-check", app: app) {
            $0["muted"] == "1" && $0["listening"] == "1" && $0["attempts"] == "0"
        }
        try auditTap("voiceAuditInjectClean", name: "clean-while-originally-muted", app: app)
        try assertUnchanged(muted, app: app, name: "original-mute-rejects-clean")
        reveal(app.buttons["Check voice recognition"], app: app, name: "muted-score-push-recognition-check")
        require("muted-case-recognition-check-ready", app: app) {
            app.navigationBars["Voice check"].exists && app.buttons["startVoiceCheck"].label == "Start checking"
        }
        tap(app.buttons["startVoiceCheck"], name: "muted-case-start-checking", app: app)
        _ = try requireState("recognition-check-owns-unmuted-capture", app: app) {
            $0["root"] == "0" && $0["listening"] == "1" && $0["muted"] == "0" && $0["attempts"] == "0"
        }
        try auditTap("voiceAuditInjectClean", name: "muted-case-clean-counted-only-by-check", app: app)
        let count = app.descendants(matching: .any).matching(identifier: "voiceCheckCount_Clean").firstMatch
        require("muted-case-onboarding-count-one", app: app) {
            count.exists && ((count.value as? String) == "1" || count.staticTexts["1"].exists || count.label == "Clean, 1") &&
            self.fields(app).map { self.protectedState($0) == self.protectedState(muted) } == true
        }
        tap(app.navigationBars["Voice check"].buttons["Done"], name: "muted-case-done-checking", app: app)
        let restored = try requireState("prior-score-mute-restored-after-check", app: app) {
            app.navigationBars["Hands-free"].exists && $0["root"] == "1" && $0["listening"] == "1" &&
            $0["muted"] == "1" && $0["attempts"] == "0"
        }
        XCTAssertEqual(protectedState(restored), protectedState(muted))
        try auditTap("voiceAuditInjectClean", name: "fresh-clean-after-return-while-muted", app: app)
        try assertUnchanged(restored, app: app, name: "restored-mute-still-rejects-clean")
        let rootList = try XCTUnwrap(settledSettingsList(app, name: "muted-case-foreground-root-list"))
        reveal(rootList.buttons["Unmute"], app: app, name: "actual-explicit-unmute", upward: false)
        _ = try requireState("score-explicitly-unmuted", app: app) { $0["muted"] == "0" && $0["listening"] == "1" }
        try auditTap("voiceAuditInjectClean", name: "fresh-clean-after-explicit-unmute", app: app)
        _ = try requireState("fresh-clean-counts-after-unmute", app: app) {
            $0["attempts"] == "1" && $0["rawAttemptRows"] == "1" && $0["undoneRows"] == "0"
        }
    }

    @MainActor func testEndPracticeConfirmationRejectsQueuedVoiceBatchAndCancelRestoresCommands() throws {
        let app = XCUIApplication(); try openArmedScore(app)
        tap(app.buttons["skipColdGrade"], name: "confirmation-case-start-real-set", app: app)
        require("confirmation-case-real-set-running", app: app) { app.buttons["verdict_clean"].isHittable }
        try enableScoreVoice(app)
        try auditTap("voiceAuditInjectClean", name: "confirmation-case-baseline-clean", app: app)
        let before = try requireState("confirmation-case-baseline-counted", app: app) {
            $0["attempts"] == "1" && $0["rawAttemptRows"] == "1" && $0["ending"] == "0"
        }
        assertLedgerReadout(before)
        let initialBatch = try XCTUnwrap(before["dialogBatch"].flatMap(Int.init))
        try auditTap("voiceAuditQueueDialogCommands", name: "arm-one-delayed-dialog-recognition-batch", app: app)
        _ = try requireState("dialog-recognition-batch-pending", app: app) {
            $0["dialogPending"] == "1" && $0["ending"] == "0" &&
            Int($0["dialogBatch"] ?? "") == initialBatch
        }
        tap(app.buttons["Score options"], name: "confirmation-case-open-score-options", app: app)
        let menu = app.collectionViews.containing(.button, identifier: "End practice").firstMatch
        require("real-end-practice-menu", app: app) { menu.exists }
        require("end-practice-menu-viewport", app: app) { self.menuViewport(menu, app: app) != nil }
        let end = menu.buttons["End practice"]
        for index in 0..<8 {
            let observedViewport = menuViewport(menu, app: app)
            if observedViewport == nil {
                capture("end-practice-menu-disappeared-before-action-\(index)", app: app)
            }
            let viewport = try XCTUnwrap(observedViewport, "The actual End menu must remain present before its single action tap.")
            geometry("end-practice-menu-scroll-\(index)-geometry", "content=\(menu.frame) viewport=\(viewport) target=\(end.exists ? String(describing: end.frame) : "absent") targetHittable=\(end.isHittable)")
            if end.exists, end.isHittable, viewport.contains(end.frame) { break }
            let x = viewport.midX - app.frame.minX
            let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: viewport.minY + viewport.height * 0.75 - app.frame.minY))
            let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: viewport.minY + viewport.height * 0.35 - app.frame.minY))
            from.press(forDuration: 0.1, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.1)
        }
        tap(end, name: "actual-end-practice-opens-confirmation", app: app,
            visibleRect: { self.menuViewport(menu, app: app) }, centered: true)
        // UIKit may omit the cancel row from an iPad confirmation popover. The actual
        // foreground title and destructive action must still be present before dismissal.
        let confirmationTitle = app.staticTexts["End this practice session?"]
        func visibleEndActions() -> [XCUIElement] {
            app.buttons.matching(identifier: "End practice").allElementsBoundByIndex.filter {
                $0.isHittable && app.frame.contains($0.frame)
            }
        }
        func confirmationSurface() -> XCUIElement? {
            guard confirmationTitle.exists, app.frame.contains(confirmationTitle.frame),
                  visibleEndActions().count == 1, let action = visibleEndActions().first else { return nil }
            let surfaces = app.descendants(matching: .popover).allElementsBoundByIndex + app.sheets.allElementsBoundByIndex
            return surfaces.first {
                $0.frame.width > 1 && $0.frame.height > 1 && app.frame.contains($0.frame) &&
                $0.frame.contains(confirmationTitle.frame) && $0.frame.contains(action.frame)
            }
        }
        func visibleCancel() -> [XCUIElement] {
            app.buttons.matching(identifier: "Cancel").allElementsBoundByIndex.filter {
                $0.isHittable && app.frame.contains($0.frame)
            }
        }
        require("actual-end-practice-confirmation-visible", app: app) {
            confirmationSurface() != nil
        }
        // The readout is intentionally occluded by the real modal. Read it without tapping
        // through the dialog; the queued hook reports the confirmation state at delivery.
        require("queued-finals-delivered-during-confirmation", app: app) {
            guard let state = self.fields(app, includeOccluded: true) else { return false }
            return state["ending"] == "1" && state["dialogDeliveryEnding"] == "1" &&
                state["dialogPending"] == "0" && Int(state["dialogBatch"] ?? "") == initialBatch + 1 &&
                state["supported"] == "" && confirmationSurface() != nil
        }
        let during = try XCTUnwrap(fields(app, includeOccluded: true))
        assertLedgerReadout(during)
        XCTAssertEqual(protectedState(during), protectedState(before),
                       "Queued Clean/Undo/Next/click must not mutate even raw or undone attempt rows behind the confirmation.")
        let cancelActions = visibleCancel()
        XCTAssertLessThanOrEqual(cancelActions.count, 1, "At most one foreground Cancel action is allowed.")
        if let cancel = cancelActions.first {
            tap(cancel, name: "actual-cancel-end-practice", app: app)
        } else {
            var previous = CGRect.zero
            var changed = Date.now
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard let surface = confirmationSurface(), surface.elementType == .popover else { return false }
                let frame = surface.frame
                if frame != previous { previous = frame; changed = .now; return false }
                return Date.now.timeIntervalSince(changed) >= 0.4
            }, object: nil)
            let settledResult = XCTWaiter.wait(for: [settled], timeout: 8)
            capture("actual-popover-cancel-before", app: app)
            XCTAssertEqual(settledResult, .completed, "A settled actual iPad popover is required for outside cancellation.")
            guard settledResult == .completed else { return }
            let popover = try XCTUnwrap(confirmationSurface())
            XCTAssertEqual(popover.elementType, .popover)
            let dismissRegions = app.otherElements.matching(identifier: "PopoverDismissRegion").allElementsBoundByIndex
            let interactiveTypes: [XCUIElement.ElementType] = [.button, .textField, .secureTextField,
                .textView, .switch, .slider, .stepper, .picker, .link]
            let interactiveFrames = interactiveTypes.flatMap { app.descendants(matching: $0).allElementsBoundByIndex }
                .map(\.frame).filter { $0.width > 1 && $0.height > 1 && app.frame.intersects($0) }
            let bounds = app.frame
            let candidates = [CGPoint(x: bounds.minX + 20, y: bounds.midY),
                              CGPoint(x: bounds.maxX - 20, y: bounds.midY),
                              CGPoint(x: bounds.midX, y: bounds.minY + 150),
                              CGPoint(x: bounds.midX, y: bounds.minY + 80)]
            let point = try XCTUnwrap(candidates.first { point in
                bounds.contains(point) && !popover.frame.contains(point) &&
                dismissRegions.filter { $0.frame.contains(point) }.count == 1 &&
                !interactiveFrames.contains { $0.contains(point) }
            }, "A point inside the native dismiss region, outside the popover and other controls, is required.")
            geometry("actual-popover-cancel-target", "point=\(point) popover=\(popover.frame) app=\(bounds) dismissRegions=\(dismissRegions.map(\.frame)) interactiveFrames=\(interactiveFrames)")
            // One actual outside touch; no semantic dismiss action and no retry after a no-op.
            app.coordinate(withNormalizedOffset: .zero).withOffset(
                CGVector(dx: point.x - bounds.minX, dy: point.y - bounds.minY)).tap()
            capture("actual-popover-cancel-immediately-after", app: app)
        }
        let restored = try requireState("cancel-restores-running-score-context", app: app) {
            $0["ending"] == "0" && $0["listening"] == "1" && $0["supported"]?.contains("clean") == true &&
            app.buttons["verdict_clean"].isHittable && !confirmationTitle.exists
        }
        XCTAssertEqual(protectedState(restored), protectedState(before))
        try auditTap("voiceAuditInjectClean", name: "fresh-clean-after-confirmation-cancel", app: app)
        _ = try requireState("clean-counts-after-confirmation-cancel", app: app) {
            $0["attempts"] == "2" && $0["rawAttemptRows"] == "2" && $0["undoneRows"] == "0"
        }
    }
}
