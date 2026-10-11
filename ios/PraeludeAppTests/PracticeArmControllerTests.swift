import Foundation
import XCTest
@testable import Praelude

/// Coverage for `PracticeArmController`: §10a's arm-with-defaults flow, §9/R3's cold-grade gate,
/// and §11's accept/dismiss mechanics for the R1/R2/R6-R13 post-set suggestions.
final class PracticeArmControllerTests: XCTestCase {
    @MainActor
    private struct Fixture {
        let store: PracticeStore
        let runtime: PracticeRuntime
        let metronome: MetronomeService
        let arm: PracticeArmController
    }

    @MainActor
    private func fixture(now: @escaping () -> Date = Date.init,
                         writeData: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }) throws -> Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Arm-\(UUID().uuidString)", isDirectory: true)
        let suite = "Praelude-Arm-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = PracticeStore(directory: directory, now: now, writeData: writeData)
        let metronome = MetronomeService(defaults: defaults)
        let speech = SpeechCommandService()
        let feedback = FeedbackService(defaults: defaults)
        let recording = RecordingService(defaults: defaults)
        let runtime = PracticeRuntime(store: store, metronome: metronome, speech: speech, recording: recording, feedback: feedback)
        addTeardownBlock {
            await MainActor.run { feedback.stop(); metronome.stop(); speech.stop(); recording.stopPlayback() }
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        return Fixture(store: store, runtime: runtime, metronome: metronome, arm: PracticeArmController())
    }

    @MainActor
    private func addPassage(_ store: PracticeStore, learningState: LearningState = .new,
                             startMeasure: Int? = nil, endMeasure: Int? = nil,
                             performanceTempo: Double? = nil, schedule: PassageSchedule = PassageSchedule()) throws -> (Piece, Passage) {
        let piece = Piece(title: "Nocturne", composer: "Chopin", pdfFileName: "nocturne.pdf", pageCount: 4)
        try store.addPiece(piece)
        let passage = Passage(pieceID: piece.id, title: "Opening", startMeasure: startMeasure, endMeasure: endMeasure,
                               learningState: learningState, schedule: schedule, performanceTempo: performanceTempo)
        try store.savePassage(passage)
        return (piece, passage)
    }

    // MARK: - arm(...)

    @MainActor
    func testArmFillsRuleDefaultsForANewPassage() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        let configuration = try XCTUnwrap(fixture.arm.configuration)
        XCTAssertEqual(configuration.passageID, passage.id)
        XCTAssertEqual(configuration.basis, .cleanStreak)
        XCTAssertEqual(configuration.targetCount, RuleSettings().r5LearningStreak)
        XCTAssertEqual(configuration.hands, "Both hands")
        XCTAssertTrue(fixture.arm.awaitingColdGrade, "A never-graded passage is cold-eligible today")
    }

    @MainActor
    func testEditingSavedGoalRefreshesCachedDraftWithoutRewritingAnActiveSet() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store, performanceTempo: 100)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        var chosen = try XCTUnwrap(fixture.arm.configuration)
        chosen.startBPM = 60; chosen.targetBPM = 88
        fixture.arm.applyConfigurationOverride(chosen)
        var edited = passage; edited.title = "New name"; edited.performanceTempo = 112.5
        try fixture.store.savePassage(edited, replacing: passage)
        fixture.arm.arm(pieceID: piece.id, passage: edited, store: fixture.store)
        XCTAssertEqual(fixture.arm.configuration?.targetBPM, 112.5)
        XCTAssertEqual(fixture.arm.configuration?.startBPM, 60)
        XCTAssertEqual(fixture.arm.configuration?.passageSnapshot?.title, "New name")
        fixture.arm.arm(pieceID: piece.id, passage: nil, store: fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: edited, store: fixture.store)
        XCTAssertEqual(fixture.arm.configuration?.targetBPM, 112.5, "The refreshed goal survives leaving and returning.")
        chosen = try XCTUnwrap(fixture.arm.configuration)
        chosen.targetBPM = 92
        fixture.arm.applyConfigurationOverride(chosen)
        fixture.arm.arm(pieceID: piece.id, passage: edited, store: fixture.store)
        XCTAssertEqual(fixture.arm.configuration?.targetBPM, 92, "A deliberate draft target is preserved when the saved goal did not change.")
        try fixture.arm.start(skippingColdGrade: true, store: fixture.store, runtime: fixture.runtime)
        let originalSet = try XCTUnwrap(fixture.store.activeSet)
        var later = edited; later.performanceTempo = 120
        try fixture.store.savePassage(later, replacing: edited)
        XCTAssertEqual(fixture.store.activeSet, originalSet)
    }

    @MainActor
    func testArmForWholePieceSkipsColdGradeAndUsesPlainDefault() throws {
        let fixture = try fixture()
        let piece = Piece(title: "Etude")
        try fixture.store.addPiece(piece)
        fixture.arm.arm(pieceID: piece.id, passage: nil, store: fixture.store)
        XCTAssertFalse(fixture.arm.awaitingColdGrade)
        XCTAssertNil(fixture.arm.configuration?.passageID)
    }

    @MainActor
    func testArmDoesNotAwaitColdGradeOnceAlreadyGradedToday() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        try fixture.store.recordColdGrade(ColdGradeRecord(passageID: passage.id, grade: .clean, tempo: 60))
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertFalse(fixture.arm.awaitingColdGrade)
    }

    @MainActor
    func testPieceDefaultSeedsWholePieceAndNewPassageAfterRelaunch() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        try fixture.store.setDefaultPracticeTempo(76, for: piece.id)
        let reopened = PracticeStore(directory: fixture.store.fileURL.deletingLastPathComponent())
        let arm = PracticeArmController()
        arm.arm(pieceID: piece.id, passage: nil, store: reopened)
        XCTAssertEqual(arm.configuration?.startBPM, 76)
        XCTAssertEqual(arm.configuration?.targetBPM, 76)
        arm.arm(pieceID: piece.id, passage: passage, store: reopened)
        XCTAssertEqual(arm.configuration?.startBPM, 76)
        XCTAssertEqual(arm.configuration?.targetBPM, 76)
    }

    @MainActor
    func testPieceDefaultDoesNotReplaceChosenOrPreviouslyPracticedConditions() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        try fixture.store.setDefaultPracticeTempo(76, for: piece.id)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        var chosen = try XCTUnwrap(fixture.arm.configuration)
        chosen.startBPM = 64; chosen.targetBPM = 64; chosen.useMetronome = false
        fixture.arm.applyConfigurationOverride(chosen)
        try fixture.store.setDefaultPracticeTempo(90, for: piece.id)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertEqual(fixture.arm.configuration?.startBPM, 64)
        XCTAssertEqual(fixture.arm.configuration?.useMetronome, false)
        XCTAssertTrue(try fixture.arm.start(skippingColdGrade: true, store: fixture.store, runtime: fixture.runtime))
        try fixture.store.endSet()
        let freshArm = PracticeArmController()
        freshArm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertEqual(freshArm.configuration?.startBPM, 64)
        XCTAssertEqual(freshArm.configuration?.useMetronome, false)
    }

    // MARK: - start(grade:...)

    @MainActor
    func testStartWithoutAGradeIsANoOpWhileAwaitingColdGrade() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertTrue(fixture.arm.awaitingColdGrade)
        let started = try fixture.arm.start(store: fixture.store, runtime: fixture.runtime)
        XCTAssertFalse(started)
        XCTAssertNil(fixture.store.activeSet)
        XCTAssertTrue(fixture.arm.awaitingColdGrade, "Still waiting for an actual grade")
    }

    @MainActor
    func testStartWithCleanGradeStartsSetRecordsColdGradeAndFirstAttempt() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        let started = try fixture.arm.start(grade: .clean, store: fixture.store, runtime: fixture.runtime)
        XCTAssertTrue(started)
        XCTAssertFalse(fixture.arm.awaitingColdGrade)
        let active = try XCTUnwrap(fixture.store.activeSet)
        XCTAssertEqual(active.configuration.pieceID, piece.id)
        XCTAssertEqual(active.attempts.count, 1)
        XCTAssertEqual(active.attempts.first?.verdict, .clean)
        XCTAssertEqual(active.streak, 1)
        XCTAssertEqual(fixture.store.state.coldGrades.count, 1)
        XCTAssertEqual(fixture.store.state.coldGrades.first?.grade, .clean)
        let updatedPassage = try XCTUnwrap(fixture.store.state.passages.first { $0.id == passage.id })
        XCTAssertEqual(updatedPassage.learningState, .learning, "R4: Clean on a New passage moves it to Learning")
        // R3 + R4 both logged as accepted (never overridden — applying a cold grade *is* accepting it).
        XCTAssertEqual(fixture.store.state.ruleEvents.count, 2)
        XCTAssertTrue(fixture.store.state.ruleEvents.allSatisfy { !$0.overridden })
        XCTAssertEqual(Set(fixture.store.state.ruleEvents.map(\.ruleID)), [.r3ColdAttempt, .r4SpacedReview])
    }

    /// Regression for "(C) Audit.md": R3/R4 were logged but never surfaced anywhere for the player to
    /// see — `lastColdGradeDecision` is what `PracticeHUDView` now displays for the running set's own
    /// lifetime, and it must be R4's own line (not R3's plainer one) whenever R4 is enabled.
    @MainActor
    func testStartWithCleanGradeExposesR4sReasonAsTheLastColdGradeDecision() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertNil(fixture.arm.lastColdGradeDecision)
        _ = try fixture.arm.start(grade: .clean, store: fixture.store, runtime: fixture.runtime)
        let decision = try XCTUnwrap(fixture.arm.lastColdGradeDecision)
        XCTAssertEqual(decision.ruleID, .r4SpacedReview)
        XCTAssertEqual(decision.reason, "Clean. Next review in 1 day.")
        // Persists for the running set's own lifetime — re-arming a *different* target clears it,
        // the same rule `nextStep`/`suggestions` already follow.
        let (otherPiece, otherPassage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: otherPiece.id, passage: otherPassage, store: fixture.store)
        XCTAssertNil(fixture.arm.lastColdGradeDecision)
    }

    @MainActor
    func testSkipColdGradeStartsPlainlyWithoutRecordingAnything() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertTrue(fixture.arm.awaitingColdGrade)
        fixture.arm.skipColdGrade()
        XCTAssertFalse(fixture.arm.awaitingColdGrade)
        let started = try fixture.arm.start(store: fixture.store, runtime: fixture.runtime)
        XCTAssertTrue(started)
        XCTAssertEqual(fixture.store.activeSet?.attempts.count, 0, "Skipping records no grade and no attempt")
        XCTAssertTrue(fixture.store.state.coldGrades.isEmpty, "Skipping is local to this visit, not a standing decision")
        // Re-arming the same passage (e.g. navigating back to it later) must offer the gate again.
        try fixture.store.endSet()
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertTrue(fixture.arm.awaitingColdGrade)
    }

    @MainActor
    func testStartWithShakyGradeRecordsSloppyAttempt() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        _ = try fixture.arm.start(grade: .shaky, store: fixture.store, runtime: fixture.runtime)
        XCTAssertEqual(fixture.store.activeSet?.attempts.first?.verdict, .sloppy)
        XCTAssertEqual(fixture.store.activeSet?.streak, 0)
    }

    @MainActor
    func testStartWithMissedGradeRecordsAgainAttemptNeutralToStreak() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        _ = try fixture.arm.start(grade: .missed, store: fixture.store, runtime: fixture.runtime)
        XCTAssertEqual(fixture.store.activeSet?.attempts.first?.verdict, .again)
        XCTAssertEqual(fixture.store.activeSet?.streak, 0)
        XCTAssertEqual(fixture.store.activeSet?.totalPlays, 1)
        let updatedPassage = try XCTUnwrap(fixture.store.state.passages.first { $0.id == passage.id })
        XCTAssertEqual(updatedPassage.learningState, .learning, "R4: Missed is a full lapse back to Learning")
    }

    @MainActor
    func testStartWithoutColdEligibilityNeedsNoGrade() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        try fixture.store.recordColdGrade(ColdGradeRecord(passageID: passage.id, grade: .clean, tempo: 60))
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertFalse(fixture.arm.awaitingColdGrade)
        let started = try fixture.arm.start(store: fixture.store, runtime: fixture.runtime)
        XCTAssertTrue(started)
        XCTAssertEqual(fixture.store.activeSet?.attempts.count, 0, "No grade means no attempt is pre-recorded")
        XCTAssertEqual(fixture.store.state.coldGrades.count, 1, "Unchanged — already graded earlier today")
    }

    // MARK: - arm(...) preserves nextStep/suggestions for the same target

    /// Regression for "(C) Audit.md": `stopPractice()` calls `computeAfterSet` to populate §10c's
    /// headline and suggestions, then (via `store.endSet()`'s own `.onChange`-driven `rearmIfIdle`)
    /// immediately re-arms the very same passage — which used to unconditionally wipe both straight
    /// back out before the idle screen could ever show them. Re-arming the identical piece/passage
    /// (how every idle rearm after a set ends reaches `arm(...)`) must preserve them; arming something
    /// genuinely different must still clear them.
    @MainActor
    func testArmPreservesNextStepAndSuggestionsWhenReArmingTheSameTarget() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store, learningState: .review, performanceTempo: 100)
        // A real Start always goes through `arm(...)` first (`selectPassage` → `rearmIfIdle`) — the
        // controller's own `pieceID`/`passage` must already be this target for the re-arm below to
        // actually be "the same" one, not merely a first-ever arm that happens to match by chance.
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        var configuration = PracticeConfiguration(pieceID: piece.id, passageID: passage.id, targetCount: 1, startBPM: 100, targetBPM: 100)
        configuration.passageSnapshot = passage
        try fixture.store.startSet(configuration)
        _ = try fixture.runtime.record(.clean)
        let completed = try XCTUnwrap(fixture.store.activeSet)
        fixture.arm.computeAfterSet(completed, store: fixture.store)
        let headline = try XCTUnwrap(fixture.arm.nextStep)

        // Re-arming the *same* piece/passage (the Stop/idle path) must not clear it.
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertEqual(fixture.arm.nextStep?.id, headline.id, "Re-arming the same target must preserve the just-computed next step")

        // Arming a genuinely different passage must clear it — it no longer applies.
        let (otherPiece, otherPassage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: otherPiece.id, passage: otherPassage, store: fixture.store)
        XCTAssertNil(fixture.arm.nextStep, "Arming something else must clear a stale next step from a different passage")
    }

    // MARK: - accept(...) / dismiss(...)

    @MainActor
    func testAcceptJoinCreatesAJoinedPassageAndArchivesTheSources() throws {
        let fixture = try fixture()
        let piece = Piece(title: "Sonata")
        try fixture.store.addPiece(piece)
        let a = Passage(pieceID: piece.id, title: "A", startMeasure: 1, endMeasure: 8, learningState: .review)
        let b = Passage(pieceID: piece.id, title: "B", startMeasure: 9, endMeasure: 16, learningState: .review)
        try fixture.store.savePassage(a); try fixture.store.savePassage(b)
        let decision = Decision(ruleID: .r2JoinSeams, pieceID: piece.id, passageID: a.id, reason: "Join?", outcome: .suggestJoin(passageIDs: [a.id, b.id]))
        fixture.arm.accept(decision, store: fixture.store)
        let sourceA = try XCTUnwrap(fixture.store.state.passages.first { $0.id == a.id })
        let sourceB = try XCTUnwrap(fixture.store.state.passages.first { $0.id == b.id })
        XCTAssertTrue(sourceA.archived); XCTAssertTrue(sourceB.archived)
        let joined = try XCTUnwrap(fixture.store.state.passages.first { $0.joinedFromPassageIDs == [a.id, b.id] })
        XCTAssertFalse(joined.archived)
        XCTAssertEqual(joined.startMeasure, 1); XCTAssertEqual(joined.endMeasure, 16)
        XCTAssertEqual(fixture.store.state.ruleEvents.last?.overridden, false)
    }

    @MainActor
    func testAcceptSubPassageCreatesAChildPassageFromTheGivenRegion() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        var withRegion = passage
        withRegion.regions = [PassageRegion(page: 2, x: 0.1, y: 0.1, width: 0.5, height: 0.3)]
        try fixture.store.savePassage(withRegion, replacing: passage)
        let region = NormalizedRect(x: 0.2, y: 0.2, width: 0.1, height: 0.1)
        let decision = Decision(ruleID: .r8SplitWeakSpot, pieceID: piece.id, passageID: passage.id, reason: "Split?", outcome: .suggestSubPassage(region: region))
        fixture.arm.accept(decision, store: fixture.store)
        let child = try XCTUnwrap(fixture.store.state.passages.first { $0.parentPassageID == passage.id })
        XCTAssertEqual(child.page, 2)
        XCTAssertEqual(child.regions.first?.x, 0.2)
    }

    @MainActor
    func testAcceptParkSetsParkedUntilOnThePassage() throws {
        let fixture = try fixture()
        let (_, passage) = try addPassage(fixture.store)
        let until = Date().addingTimeInterval(86_400)
        let decision = Decision(ruleID: .r9StopGrinding, passageID: passage.id, reason: "Back tomorrow.", outcome: .park(until: until))
        fixture.arm.accept(decision, store: fixture.store)
        let updated = try XCTUnwrap(fixture.store.state.passages.first { $0.id == passage.id })
        XCTAssertEqual(updated.parkedUntil?.timeIntervalSince1970 ?? 0, until.timeIntervalSince1970, accuracy: 0.5)
    }

    @MainActor
    func testAcceptPerformanceReadyUpdatesLearningState() throws {
        let fixture = try fixture()
        let (_, passage) = try addPassage(fixture.store, learningState: .review)
        let decision = Decision(ruleID: .r10PerformanceReady, passageID: passage.id, reason: "Ready.", outcome: .performanceReady)
        fixture.arm.accept(decision, store: fixture.store)
        let updated = try XCTUnwrap(fixture.store.state.passages.first { $0.id == passage.id })
        XCTAssertEqual(updated.learningState, .performanceReady)
    }

    @MainActor
    func testAcceptTempoChangeCarriesForwardIntoTheNextArm() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store, learningState: .review)
        try fixture.store.recordColdGrade(ColdGradeRecord(passageID: passage.id, grade: .clean, tempo: 60)) // skip cold gate
        let decision = Decision(ruleID: .r6SlowDown, passageID: passage.id, reason: "Down to 54.", outcome: .tempoChange(newBPM: 54))
        fixture.arm.accept(decision, store: fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertEqual(fixture.arm.configuration?.startBPM, 54)
    }

    @MainActor
    func testDismissLogsOverriddenWithoutMutatingThePassage() throws {
        let fixture = try fixture()
        let (_, passage) = try addPassage(fixture.store, learningState: .review)
        let decision = Decision(ruleID: .r10PerformanceReady, passageID: passage.id, reason: "Ready.", outcome: .performanceReady)
        fixture.arm.dismiss(decision, store: fixture.store)
        let unchanged = try XCTUnwrap(fixture.store.state.passages.first { $0.id == passage.id })
        XCTAssertEqual(unchanged.learningState, .review, "A dismissed suggestion must never mutate data")
        XCTAssertEqual(fixture.store.state.ruleEvents.last?.overridden, true)
    }

    // MARK: - R7 speed-up: accept-only, cap actually enforced

    /// Regression for "(C) Audit.md": R7 used to be auto-baked into every `arm()` regardless of
    /// player choice, with nothing ever logged — so `r7MaxIncreasesPerDay` (default 2) never saw a
    /// single applied increase to count and the tempo silently climbed every set. This drives the
    /// full loop end to end: complete a set below performance tempo, accept the offered R7 suggestion
    /// (logging it and raising the *next* arm's tempo), twice — then confirms a third completed set
    /// offers nothing further today, and that declining instead never moves the tempo at all.
    @MainActor
    func testR7OnlyReachesTheNextSetThroughAnExplicitAcceptAndStopsAtTheDailyCap() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store, performanceTempo: 100)
        try fixture.store.recordColdGrade(ColdGradeRecord(passageID: passage.id, grade: .clean, tempo: 80)) // skip the cold gate below

        func completeASet(startBPM: Double) throws -> ActiveSet {
            fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
            var configuration = try XCTUnwrap(fixture.arm.configuration)
            configuration.startBPM = startBPM; configuration.targetBPM = startBPM; configuration.targetCount = 1
            fixture.arm.configuration = configuration
            _ = try fixture.arm.start(store: fixture.store, runtime: fixture.runtime)
            _ = try fixture.runtime.record(.clean)
            return try XCTUnwrap(fixture.store.activeSet)
        }
        // R7 may surface either as §10c's own headline (when nothing higher-priority also fires) or
        // as a dismissible suggestion (`PracticeArmController.computeAfterSet` never duplicates it
        // into both) — `RuleSuggestionsView`'s headline row now makes the former equally acceptable.
        func r7Decision() -> Decision? {
            if fixture.arm.nextStep?.ruleID == .r7SpeedUp { return fixture.arm.nextStep }
            return fixture.arm.suggestions.first { $0.ruleID == .r7SpeedUp }
        }

        // Set 1 (80 bpm, below the 100 bpm performance tempo): completes, R7 fires, accept it.
        var completed = try completeASet(startBPM: 80)
        fixture.arm.computeAfterSet(completed, store: fixture.store)
        var r7 = try XCTUnwrap(r7Decision())
        fixture.arm.accept(r7, store: fixture.store)
        try fixture.store.endSet()
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertEqual(fixture.arm.configuration?.startBPM, 84, "The accepted increase reaches the next arm")
        XCTAssertEqual(fixture.store.state.ruleEvents.filter { $0.ruleID == .r7SpeedUp }.count, 1)
        XCTAssertEqual(fixture.store.state.ruleEvents.last?.overridden, false)

        // Set 2 (now at 84): completes, accept again — the second of two allowed today.
        completed = try completeASet(startBPM: 84)
        fixture.arm.computeAfterSet(completed, store: fixture.store)
        r7 = try XCTUnwrap(r7Decision())
        fixture.arm.accept(r7, store: fixture.store)
        try fixture.store.endSet()
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertEqual(fixture.arm.configuration?.startBPM, 88)
        XCTAssertEqual(fixture.store.state.ruleEvents.filter { $0.ruleID == .r7SpeedUp && !$0.overridden }.count, 2)

        // Set 3 (now at 88): the cap (2/day) has been reached — R7 must not offer again today, and
        // the next arm must not have silently climbed on its own either.
        completed = try completeASet(startBPM: 88)
        fixture.arm.computeAfterSet(completed, store: fixture.store)
        XCTAssertNil(r7Decision(), "The daily cap must actually engage once two increases are logged")
        try fixture.store.endSet()
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertEqual(fixture.arm.configuration?.startBPM, 88, "No further, unlogged climb")
    }

    // MARK: - computeAfterSet(...)

    @MainActor
    func testComputeAfterSetPopulatesHeadlineAndExcludesItFromSuggestions() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store, learningState: .review, performanceTempo: 100)
        var configuration = PracticeConfiguration(pieceID: piece.id, passageID: passage.id, targetCount: 1, startBPM: 100, targetBPM: 100)
        configuration.passageSnapshot = passage
        try fixture.store.startSet(configuration)
        let eventID = UUID()
        _ = try fixture.runtime.record(.clean, eventID: eventID)
        let completed = try XCTUnwrap(fixture.store.activeSet)
        XCTAssertTrue(completed.isComplete)
        fixture.arm.computeAfterSet(completed, store: fixture.store)
        let headline = try XCTUnwrap(fixture.arm.nextStep)
        XCTAssertFalse(headline.reason.isEmpty)
        XCTAssertFalse(fixture.arm.suggestions.contains { $0.id == headline.id }, "The headline is never duplicated into the dismissible list")
        XCTAssertFalse(fixture.arm.suggestions.contains { $0.ruleID == headline.ruleID && $0.passageID == headline.passageID },
                       "Regression for the fixed bug: the old check compared `id`s, which are always fresh — the same rule (not merely the same `Decision` value) must never appear twice")
    }

    /// Regression: a rule urgent enough to *also* become §10c's own headline (nothing else fired
    /// ahead of it) must still be a rule a player can accept or decline, not become permanently
    /// un-actionable the moment it is excluded from `suggestions` above. `RuleSuggestionsView`'s
    /// headline row (not `PracticeArmController` itself) is what makes this reachable; this test
    /// exercises the same `accept`/`dismiss` calls that row now makes.
    @MainActor
    func testHeadlineRuleIsStillAcceptableAndDismissibleNotOnlyDisplayed() throws {
        let fixture = try fixture()
        // R9 stop-grinding (checked first in `nextStepLine`'s own priority order): one today's-set
        // without progress is already "1 consecutive set without progress" when `r9Sets` is 1 — the
        // simplest reliable way to make a single rule both the headline *and* the only thing that fired.
        var settings = RuleSettings(); settings.r9Sets = 1
        try fixture.store.updateRuleSettings(settings)
        let (piece, passage) = try addPassage(fixture.store)
        var configuration = PracticeConfiguration(pieceID: piece.id, passageID: passage.id, targetCount: 1, startBPM: 60, targetBPM: 60)
        configuration.passageSnapshot = passage
        try fixture.store.startSet(configuration)
        _ = try fixture.runtime.record(.sloppy)
        let completed = try XCTUnwrap(fixture.store.activeSet)
        fixture.arm.computeAfterSet(completed, store: fixture.store)
        let headline = try XCTUnwrap(fixture.arm.nextStep)
        XCTAssertEqual(headline.ruleID, .r9StopGrinding)
        XCTAssertFalse(fixture.arm.suggestions.contains { $0.ruleID == .r9StopGrinding }, "Excluded from suggestions, as the dedup above requires")

        fixture.arm.accept(headline, store: fixture.store)
        XCTAssertNil(fixture.arm.nextStep, "Accepting the headline clears it, the same as a suggestion disappearing once acted on")
        XCTAssertEqual(fixture.store.state.ruleEvents.last?.ruleID, .r9StopGrinding)
        XCTAssertEqual(fixture.store.state.ruleEvents.last?.overridden, false)
        let updated = try XCTUnwrap(fixture.store.state.passages.first { $0.id == passage.id })
        XCTAssertNotNil(updated.parkedUntil, "R9's own outcome (.park) must still apply when accepted from the headline")
    }
    @MainActor func testOneTapUngradedStartLogsNoInventedRepAndKeepsChosenConditions() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        var configuration = try XCTUnwrap(fixture.arm.configuration)
        configuration.targetCount = 7
        configuration.startBPM = 84; configuration.targetBPM = 84
        configuration.stages = PracticeTechnique.hands.stages(targetCount: 2)
        configuration.hands = "Left hand"
        fixture.arm.applyConfigurationOverride(configuration)
        XCTAssertTrue(try fixture.arm.start(skippingColdGrade: true, store: fixture.store, runtime: fixture.runtime))
        XCTAssertTrue(fixture.store.activeSet?.attempts.isEmpty == true)
        XCTAssertTrue(fixture.store.state.coldGrades.isEmpty)
        XCTAssertFalse(fixture.arm.awaitingColdGrade)
        try fixture.store.endSet()
        fixture.arm.arm(pieceID: piece.id, passage: nil, store: fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertEqual(fixture.arm.configuration?.targetCount, 7)
        XCTAssertEqual(fixture.arm.configuration?.stages, configuration.stages)
        XCTAssertEqual(fixture.arm.configuration?.hands, "Left hand")
        XCTAssertEqual(fixture.arm.configuration?.startBPM, 84)
        XCTAssertTrue(fixture.arm.awaitingColdGrade)
    }

    @MainActor func testDisabledColdRuleDoesNotLeaveAnImpossibleGradeGate() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        var settings = fixture.store.state.ruleSettings
        settings.r3Enabled = false
        try fixture.store.updateRuleSettings(settings)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        XCTAssertFalse(fixture.arm.awaitingColdGrade)
        XCTAssertTrue(try fixture.arm.start(store: fixture.store, runtime: fixture.runtime))
        XCTAssertTrue(fixture.store.state.coldGrades.isEmpty)
    }

    @MainActor func testFailedColdCommitRetainsPromptAndEmitsNoAcceptedGrade() throws {
        var fail = false
        let fixture = try fixture(writeData: { data, url in
            if fail { throw CocoaError(.fileWriteOutOfSpace) }; try data.write(to: url, options: .atomic)
        })
        let (piece, passage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        let state = fixture.store.state, bytes = try Data(contentsOf: fixture.store.fileURL)
        fail = true
        XCTAssertThrowsError(try fixture.arm.start(grade: .clean, store: fixture.store, runtime: fixture.runtime))
        XCTAssertTrue(fixture.arm.awaitingColdGrade)
        XCTAssertNil(fixture.arm.lastColdGradeDecision)
        XCTAssertEqual(fixture.store.state, state)
        XCTAssertEqual(try Data(contentsOf: fixture.store.fileURL), bytes)
        fail = false
        XCTAssertTrue(try fixture.arm.start(grade: .clean, store: fixture.store, runtime: fixture.runtime))
        XCTAssertEqual(fixture.store.activeSet?.attempts.count, 1)
        XCTAssertEqual(fixture.store.state.coldGrades.count, 1)
    }

    @MainActor func testColdGradeAtAMismatchedAudibleTempoKeepsEveryRecordUnchangedUntilRepeated() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store)
        fixture.metronome.setTempo(80); fixture.metronome.start()
        XCTAssertTrue(fixture.metronome.isPlaying, fixture.metronome.errorMessage ?? "Native click must start")
        let state = fixture.store.state, bytes = try Data(contentsOf: fixture.store.fileURL)
        XCTAssertThrowsError(try fixture.arm.start(grade: .clean, store: fixture.store, runtime: fixture.runtime))
        XCTAssertEqual(fixture.metronome.bpm, 60)
        XCTAssertTrue(fixture.arm.awaitingColdGrade)
        XCTAssertNil(fixture.arm.lastColdGradeDecision)
        XCTAssertEqual(fixture.store.state, state)
        XCTAssertEqual(try Data(contentsOf: fixture.store.fileURL), bytes)
        XCTAssertTrue(try fixture.arm.start(grade: .clean, store: fixture.store, runtime: fixture.runtime))
        XCTAssertEqual(fixture.store.activeSet?.attempts.map(\.bpm), [60])
        XCTAssertEqual(fixture.store.state.coldGrades.map(\.tempo), [60])
    }

    @MainActor func testMovementDraftsRemainSeparateAndStartWithoutPassageRules() throws {
        let fixture = try fixture()
        let (piece, passage) = try addPassage(fixture.store)
        let first = ScoreSection(id: passage.id, title: "I. Allegro", startPage: 1, endPage: 2)
        let second = ScoreSection(title: "II. Adagio", startPage: 3, endPage: 4)
        try fixture.store.setScoreSections([first, second], for: piece.id)
        let existingPassages = fixture.store.state.passages
        fixture.arm.arm(pieceID: piece.id, passage: nil, store: fixture.store, scoreSection: first)
        XCTAssertFalse(fixture.arm.awaitingColdGrade)
        var chosen = try XCTUnwrap(fixture.arm.configuration)
        chosen.startBPM = 72; chosen.targetBPM = 84; chosen.hands = "Left hand"
        fixture.arm.applyConfigurationOverride(chosen)
        fixture.arm.arm(pieceID: piece.id, passage: nil, store: fixture.store, scoreSection: second)
        XCTAssertEqual(fixture.arm.configuration?.startBPM, 60)
        XCTAssertEqual(fixture.arm.configuration?.passageSnapshot?.title, "II. Adagio · source pages 3–4")
        fixture.arm.arm(pieceID: piece.id, passage: nil, store: fixture.store, scoreSection: first)
        XCTAssertEqual(fixture.arm.configuration?.startBPM, 72)
        XCTAssertEqual(fixture.arm.configuration?.targetBPM, 84)
        XCTAssertEqual(fixture.arm.configuration?.hands, "Left hand")
        XCTAssertTrue(try fixture.arm.start(store: fixture.store, runtime: fixture.runtime))
        XCTAssertNil(fixture.store.activeSet?.configuration.passageID)
        XCTAssertEqual(fixture.store.activeSet?.configuration.passageSnapshot?.title, "I. Allegro · source pages 1–2")
        XCTAssertTrue(try XCTUnwrap(fixture.store.activeSet).attempts.isEmpty)
        XCTAssertTrue(fixture.store.state.coldGrades.isEmpty)
        XCTAssertEqual(fixture.store.state.passages, existingPassages)
        try fixture.store.endSet()
        fixture.arm.arm(pieceID: piece.id, passage: passage, store: fixture.store, scoreSection: first)
        XCTAssertNil(fixture.arm.scoreSection)
        XCTAssertEqual(fixture.arm.configuration?.hands, "Both hands", "A section and passage can share a UUID without sharing draft settings")
        XCTAssertTrue(fixture.arm.awaitingColdGrade)
        XCTAssertEqual(fixture.arm.configuration?.passageID, passage.id)
        fixture.arm.arm(pieceID: piece.id, passage: nil, store: fixture.store)
        XCTAssertNil(fixture.arm.configuration?.passageSnapshot)
        XCTAssertEqual(fixture.arm.configuration?.startBPM, 60)
    }

    @MainActor func testRemovedMovementRefusesStartWithoutFallingBackToWholePiece() throws {
        let fixture = try fixture()
        let (piece, _) = try addPassage(fixture.store)
        let section = ScoreSection(title: "Adagio", startPage: 2, endPage: 4)
        try fixture.store.setScoreSections([section], for: piece.id)
        fixture.arm.arm(pieceID: piece.id, passage: nil, store: fixture.store, scoreSection: section)
        try fixture.store.setScoreSections([], for: piece.id)
        let before = fixture.store.state
        XCTAssertThrowsError(try fixture.arm.start(store: fixture.store, runtime: fixture.runtime))
        XCTAssertEqual(fixture.store.state, before)
        XCTAssertNil(fixture.store.activeSet)
    }

}
