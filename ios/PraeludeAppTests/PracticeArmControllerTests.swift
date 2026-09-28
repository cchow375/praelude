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
        let arm: PracticeArmController
    }

    @MainActor
    private func fixture(now: @escaping () -> Date = Date.init) throws -> Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Arm-\(UUID().uuidString)", isDirectory: true)
        let suite = "Praelude-Arm-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = PracticeStore(directory: directory, now: now)
        let metronome = MetronomeService(defaults: defaults)
        let speech = SpeechCommandService()
        let feedback = FeedbackService(defaults: defaults)
        let runtime = PracticeRuntime(store: store, metronome: metronome, speech: speech, feedback: feedback)
        addTeardownBlock {
            await MainActor.run { feedback.stop(); metronome.stop(); speech.stop() }
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        return Fixture(store: store, runtime: runtime, arm: PracticeArmController())
    }

    @MainActor
    private func addPassage(_ store: PracticeStore, learningState: LearningState = .new,
                             startMeasure: Int? = nil, endMeasure: Int? = nil,
                             performanceTempo: Double? = nil, schedule: PassageSchedule = PassageSchedule()) throws -> (Piece, Passage) {
        let piece = Piece(title: "Nocturne", composer: "Chopin")
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
    }
}
