import Foundation
import XCTest
@testable import PraeludeCore

final class DailyPassagePlanTests: XCTestCase {
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "America/New_York")!
        return value
    }
    private func date(_ day: Int, hour: Int = 12) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour))!
    }
    private func passage(_ piece: Piece, title: String = "Recognizable phrase", due: Int = 1) -> Passage {
        Passage(pieceID: piece.id, title: title, learningState: .review,
                schedule: PassageSchedule(dueDate: date(due, hour: 0), intervalDays: 7, reviewStep: 3))
    }
    private func completedSet(_ passage: Passage, on day: Int, start: Double = 75, target: Double = 100,
                              verdicts: [Verdict] = [.clean, .clean], basis: CompletionBasis = .cleanStreak) -> ActiveSet {
        let configuration = PracticeConfiguration(pieceID: passage.pieceID, passageID: passage.id,
            basis: basis, targetCount: 1, startBPM: start, targetBPM: target, tempoStep: .fixed(25))
        var set = ActiveSet(sessionID: UUID(), configuration: configuration, startedAt: date(day, hour: 9))
        set.attempts = verdicts.enumerated().map { index, verdict in
            Attempt(verdict: verdict, date: date(day, hour: 9).addingTimeInterval(Double(index + 1)),
                    bpm: index == 0 ? start : target)
        }
        return PracticeEngine.project(set)
    }
    private func context(_ piece: Piece, passages: [Passage], day: Int = 15,
                         history: [ActiveSet] = [], grades: [ColdGradeRecord] = [], active: ActiveSet? = nil) -> RuleContext {
        RuleContext(now: date(day), calendar: calendar, pieces: [piece], passages: passages,
                    coldGrades: grades, history: history, activeSet: active)
    }

    func testFiveCompletedPassagesEndTheRoundInsteadOfRefillingFromTheBacklog() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let passages = (0..<13).map { passage(piece, title: "Phrase \($0)") }
        let initial = TodayOverview.dailyPlan(context: context(piece, passages: passages))
        XCTAssertEqual(initial.items.count, 5)
        let selected = initial.items.compactMap { item in passages.first { $0.id == item.passageID } }
        let sets = selected.prefix(3).map { completedSet($0, on: 15) }
        let middle = TodayOverview.dailyPlan(context: context(piece, passages: passages, history: sets))
        XCTAssertEqual(middle.completedToday.count, 3)
        XCTAssertEqual(middle.items.map(\.passageID), Array(initial.items.dropFirst(3)).map(\.passageID))
        XCTAssertEqual(middle.tomorrow.count, 3)
        let finished = TodayOverview.dailyPlan(context: context(piece, passages: passages,
            history: selected.map { completedSet($0, on: 15) }))
        XCTAssertTrue(finished.items.isEmpty)
        XCTAssertEqual(finished.completedToday.count, 5)
        XCTAssertEqual(finished.laterCount, 8)
    }

    func testHardWonTargetLeadsNextDayBeforeOldBacklogAndPersistsWhenADayIsSkipped() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let backlog = passage(piece, title: "Old reminder")
        var recovered = passage(piece, title: "Hard won", due: 28)
        recovered.performanceTempo = 100
        let set = completedSet(recovered, on: 14, verdicts: [.sloppy, .clean, .clean])
        XCTAssertEqual(set.status, .completed)
        let before = context(piece, passages: [backlog, recovered], history: [set])
        let plan = TodayOverview.dailyPlan(context: before)
        XCTAssertEqual(plan.items.first?.passageID, recovered.id)
        XCTAssertEqual(plan.items.first?.priority, .recall)
        XCTAssertEqual(plan.items.first?.label, "Recall first")
        XCTAssertEqual(plan.items.first?.nextActionDate, date(15, hour: 0))
        XCTAssertEqual(recovered.schedule.dueDate, date(28, hour: 0), "The read model must not rewrite the old schedule.")
        XCTAssertEqual(TodayOverview.dailyPlan(context: context(piece, passages: [backlog, recovered], day: 19,
            history: [set])).items.first?.passageID, recovered.id)
    }

    func testFailedCheckStaysForRebuildingUntilActualCompletionThenLeavesUntilTomorrow() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let spot = passage(piece, due: 16)
        let grade = ColdGradeRecord(passageID: spot.id, date: date(15, hour: 8), grade: .shaky, tempo: 100)
        let failed = TodayOverview.dailyPlan(context: context(piece, passages: [spot], grades: [grade]))
        XCTAssertEqual(failed.items.first?.priority, .rebuild)
        XCTAssertTrue(failed.completedToday.isEmpty)
        let done = TodayOverview.dailyPlan(context: context(piece, passages: [spot],
            history: [completedSet(spot, on: 15)], grades: [grade]))
        XCTAssertTrue(done.items.isEmpty)
        XCTAssertEqual(done.completedToday.map(\.passageID), [spot.id])
        XCTAssertEqual(done.tomorrow.first?.priority, .recall)
    }

    func testSlowAndTotalPlayCompletionEarnWorkAndTomorrowRebuildWithoutMastery() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let slow = passage(piece), total = passage(piece)
        let sets = [completedSet(slow, on: 15, start: 60, target: 60, verdicts: [.clean]),
                    completedSet(total, on: 15, start: 100, target: 100, verdicts: [.sloppy], basis: .totalPlays)]
        let plan = TodayOverview.dailyPlan(context: context(piece, passages: [slow, total], history: sets))
        XCTAssertEqual(plan.completedToday.count, 2)
        XCTAssertEqual(plan.tomorrow.map(\.priority), [.rebuild, .rebuild])
        XCTAssertTrue(plan.items.isEmpty)
        XCTAssertTrue(TodayOverview.dailyPlan(context: context(piece, passages: [slow, total], day: 16,
            history: sets)).items.allSatisfy { $0.priority == .rebuild })
        XCTAssertEqual(slow.learningState, .review, "Warm work never writes a mastery state.")
    }

    func testUndoneFinalRepEmptyCompletionEndedSetAndPartialActiveDoNotClear() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let spots = (0..<4).map { _ in passage(piece) }
        var undone = completedSet(spots[0], on: 15)
        undone.attempts[1].undoneAt = date(15, hour: 10)
        var empty = completedSet(spots[1], on: 15); empty.attempts = []
        var ended = completedSet(spots[2], on: 15); ended.status = .ended
        var partial = completedSet(spots[3], on: 15); partial.attempts.removeLast(); partial.status = .running
        let plan = TodayOverview.dailyPlan(context: context(piece, passages: spots, history: [undone, empty, ended], active: partial))
        XCTAssertTrue(plan.completedToday.isEmpty)
        XCTAssertEqual(Set(plan.items.map(\.passageID)), Set(spots.map(\.id)))
        XCTAssertTrue(plan.tomorrow.isEmpty)
    }

    func testSuccessfulTargetColdCheckResolvesRecallAndClearsEvenPerformanceWeek() {
        let piece = Piece(title: "Performance", performanceDates: [date(18)], fullTempoBPM: 100)
        let spot = passage(piece, due: 28)
        let prior = completedSet(spot, on: 14)
        let grade = ColdGradeRecord(passageID: spot.id, date: date(15, hour: 8), grade: .clean, tempo: 100)
        let plan = TodayOverview.dailyPlan(context: context(piece, passages: [spot], history: [prior], grades: [grade]))
        XCTAssertTrue(plan.items.isEmpty)
        XCTAssertEqual(plan.completedToday.count, 1)
        XCTAssertTrue(plan.tomorrow.isEmpty)
        XCTAssertTrue(TodayOverview.dueReviews(context: context(piece, passages: [spot], history: [prior], grades: [grade])).isEmpty)
    }

    func testLowTempoCleanDoesNotClimbLadderOrClearTargetWorkAndPassageOverrideWins() throws {
        let piece = Piece(title: "Score", fullTempoBPM: 120)
        var spot = passage(piece); spot.performanceTempo = 100
        let source = context(piece, passages: [spot])
        let application = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: spot.id, grade: .clean, tempo: 75, context: source))
        XCTAssertEqual(application.newSchedule.reviewStep, spot.schedule.reviewStep)
        XCTAssertEqual(application.newSchedule.intervalDays, 1)
        XCTAssertEqual(application.newSchedule.dueDate, date(16, hour: 0))
        XCTAssertEqual(application.newLearningState, .review)
        let plan = TodayOverview.dailyPlan(context: context(piece, passages: [spot], grades: [application.record]))
        XCTAssertEqual(plan.items.first?.priority, .rebuild)
        XCTAssertTrue(plan.completedToday.isEmpty)
        let atOverride = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: spot.id, grade: .clean, tempo: 100, context: source))
        XCTAssertEqual(atOverride.newSchedule.intervalDays, 14)
        XCTAssertEqual(atOverride.newSchedule.reviewStep, 4)
    }

    func testPieceWideTargetGatesPerformanceReadinessAndCalendarRecallCrossesDST() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let spot = passage(piece)
        var settings = RuleSettings(); settings.r10RequiresFirstInSession = false
        let low = [12, 13, 14].map { ColdGradeRecord(passageID: spot.id, date: date($0), grade: .clean, tempo: 75) }
        var source = context(piece, passages: [spot], grades: low); source.settings = settings
        XCTAssertNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: spot.id, context: source))
        source.coldGrades = [12, 13, 14].map { ColdGradeRecord(passageID: spot.id, date: date($0), grade: .clean, tempo: 100) }
        XCTAssertNotNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: spot.id, context: source))
        let set = completedSet(spot, on: 1)
        let plan = TodayOverview.dailyPlan(context: context(piece, passages: [spot], day: 2, history: [set]))
        XCTAssertEqual(plan.items.first?.nextActionDate, date(2, hour: 0))
    }

    func testInactiveHiddenAndDeletedPassagesStayOutAndDuplicateSetIDsCountOnce() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        var parked = passage(piece); parked.parkedUntil = date(16)
        var archived = passage(piece); archived.archived = true
        var deleted = passage(piece); deleted.deletedAt = date(14)
        let active = passage(piece)
        let set = completedSet(active, on: 15)
        let plan = TodayOverview.dailyPlan(context: context(piece, passages: [parked, archived, deleted, active],
            history: [set], active: set))
        XCTAssertTrue(plan.items.isEmpty)
        XCTAssertEqual(plan.completedToday.count, 1)
        XCTAssertEqual(plan.tomorrow.count, 1)
    }
    func testSessionPlanUsesSameFiniteRoundAndDoesNotReinsertUngradedNewCompletion() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let spots = (0..<8).map { _ in Passage(pieceID: piece.id, title: "New phrase") }
        let completed = completedSet(spots[0], on: 15)
        let source = context(piece, passages: spots, history: [completed])
        let daily = TodayOverview.dailyPlan(context: source)
        let session = PracticeRulesEngine.buildSession(availableMinutes: 90, context: source)
        XCTAssertEqual(session.items.compactMap(\.passageID), daily.items.map(\.passageID))
        XCTAssertFalse(session.items.contains { $0.passageID == spots[0].id })
        XCTAssertLessThanOrEqual(session.items.count, source.settings.r15MaxNewPerSession)
        XCTAssertEqual(daily.laterCount, 4, "New passages outside the introduction cap still remain in the library.")
    }

    func testLaterFailedRecallStaysRebuildOnFollowingDaysAndSyncedOrderDoesNotChangeTies() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        var first = passage(piece), second = passage(piece)
        first.createdAt = date(1); second.createdAt = first.createdAt
        first.id = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!
        second.id = UUID(uuidString: "00000000-0000-4000-8000-000000000002")!
        let a = TodayOverview.dailyPlan(context: context(piece, passages: [second, first]))
        let b = TodayOverview.dailyPlan(context: context(piece, passages: [first, second]))
        XCTAssertEqual(a.items, b.items)
        let work = completedSet(first, on: 13)
        let failure = ColdGradeRecord(passageID: first.id, date: date(14), grade: .missed, tempo: 100)
        let afterFailure = TodayOverview.dailyPlan(context: context(piece, passages: [first], history: [work], grades: [failure]))
        XCTAssertEqual(afterFailure.items.first?.priority, .rebuild)
    }

    func testUnfinishedShakyAndBelowTargetChecksRemainNextDayUntilLaterCompletion() throws {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        for (grade, tempo) in [(ColdGrade.shaky, 100.0), (.clean, 75.0)] {
            var spot = passage(piece, due: 28)
            let application = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: spot.id,
                grade: grade, tempo: tempo, context: context(piece, passages: [spot], day: 14)))
            spot.schedule = application.newSchedule
            let nextDay = TodayOverview.dailyPlan(context: context(piece, passages: [spot], grades: [application.record]))
            XCTAssertEqual(nextDay.items.first?.passageID, spot.id)
            XCTAssertEqual(nextDay.items.first?.priority, .rebuild)
            XCTAssertEqual(nextDay.items.first?.nextActionDate, date(15, hour: 0))
            let skipped = TodayOverview.dailyPlan(context: context(piece, passages: [spot], day: 19,
                grades: [application.record]))
            XCTAssertEqual(skipped.items.first?.priority, .rebuild)
            let finished = TodayOverview.dailyPlan(context: context(piece, passages: [spot],
                history: [completedSet(spot, on: 15)], grades: [application.record]))
            XCTAssertTrue(finished.items.isEmpty)
            XCTAssertEqual(finished.completedToday.count, 1)
            XCTAssertEqual(finished.tomorrow.count, 1)
        }
    }

    func testFailedCheckAfterEarlierWorkReopensTodayUntilANewerSetCompletes() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let spot = passage(piece)
        let early = completedSet(spot, on: 15)
        let failure = ColdGradeRecord(passageID: spot.id, date: date(15, hour: 10), grade: .shaky, tempo: 100)
        let reopened = TodayOverview.dailyPlan(context: context(piece, passages: [spot], history: [early], grades: [failure]))
        XCTAssertTrue(reopened.completedToday.isEmpty)
        XCTAssertEqual(reopened.items.first?.priority, .rebuild)
        var later = completedSet(spot, on: 15)
        later.startedAt = date(15, hour: 11)
        for index in later.attempts.indices { later.attempts[index].date = date(15, hour: 11).addingTimeInterval(Double(index + 1)) }
        let done = TodayOverview.dailyPlan(context: context(piece, passages: [spot], history: [early, later], grades: [failure]))
        XCTAssertTrue(done.items.isEmpty)
        XCTAssertEqual(done.completedToday.count, 1)
    }

    func testReadinessIgnoresFutureAndPreFailureEvidenceThenAcceptsThreeNewDays() throws {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        var spot = passage(piece); spot.learningState = .performanceReady
        var settings = RuleSettings(); settings.r10RequiresFirstInSession = false
        let oldClean = [8, 9, 10].map { ColdGradeRecord(passageID: spot.id, date: date($0), grade: .clean, tempo: 100) }
        let future = [16, 17, 18].map { ColdGradeRecord(passageID: spot.id, date: date($0), grade: .clean, tempo: 100) }
        var source = context(piece, passages: [spot], grades: future); source.settings = settings
        XCTAssertNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: spot.id, context: source))
        for (grade, tempo) in [(ColdGrade.shaky, 100.0), (.missed, 100.0), (.clean, 75.0)] {
            let failure = ColdGradeRecord(passageID: spot.id, date: date(12), grade: grade, tempo: tempo)
            let freshClean = [13, 14].map { ColdGradeRecord(passageID: spot.id, date: date($0), grade: .clean, tempo: 100) }
            source.coldGrades = oldClean + [failure] + freshClean + future
            XCTAssertNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: spot.id, context: source))
            source.coldGrades.append(ColdGradeRecord(passageID: spot.id, date: date(15), grade: .clean, tempo: 100))
            XCTAssertNotNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: spot.id, context: source))
            let application = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: spot.id, grade: grade, tempo: tempo,
                context: context(piece, passages: [spot])))
            XCTAssertEqual(application.newLearningState, grade == .missed ? .learning : .review)
        }
    }

    func testUngradedWarmupCannotBecomeAColdSuccessAndEraseTomorrowRecall() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let spot = passage(piece)
        let completed = completedSet(spot, on: 15)
        let source = context(piece, passages: [spot], history: [completed])
        XCTAssertFalse(PracticeRulesEngine.isColdAttemptEligible(passageID: spot.id, context: source))
        XCTAssertNil(PracticeRulesEngine.applyColdGrade(passageID: spot.id, grade: .clean, tempo: 100, context: source))
        XCTAssertEqual(TodayOverview.dailyPlan(context: source).tomorrow.first?.priority, .recall)
        XCTAssertTrue(PracticeRulesEngine.isColdAttemptEligible(passageID: spot.id,
            context: context(piece, passages: [spot], day: 16, history: [completed])))
    }

    func testTimePlannerKeepsTheMusiciansConfiguredNewPassageLimit() {
        let piece = Piece(title: "New score")
        let passages = (1...8).map { Passage(pieceID: piece.id, title: "New phrase \($0)") }
        var source = context(piece, passages: passages)
        source.settings.r15MaxNewPerSession = 1
        XCTAssertEqual(TodayOverview.dailyPlan(context: source).items.count, 1)
        XCTAssertEqual(PracticeRulesEngine.buildSession(availableMinutes: 30, context: source).items.filter { $0.kind == .new }.count, 1)
        source.settings.r15MaxNewPerSession = 0
        XCTAssertTrue(PracticeRulesEngine.buildSession(availableMinutes: 30, context: source).items.isEmpty)
    }

    func testColdEligibilityIgnoresOtherPassagesUnstartedUndoneResetAndFutureEvents() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let spot = passage(piece), other = passage(piece)
        let configuration = PracticeConfiguration(pieceID: piece.id, passageID: spot.id, targetCount: 3,
            startBPM: 75, targetBPM: 100)
        var set = ActiveSet(sessionID: UUID(), configuration: configuration, startedAt: date(15, hour: 9))
        let otherWork = completedSet(other, on: 15)
        XCTAssertTrue(PracticeRulesEngine.isColdAttemptEligible(passageID: spot.id,
            context: context(piece, passages: [spot, other], history: [otherWork], active: set)))
        set.attempts = [Attempt(verdict: .clean, date: date(15, hour: 9), bpm: 75, undoneAt: date(15, hour: 10)),
                        Attempt(verdict: .reset, date: date(15, hour: 10), bpm: 75),
                        Attempt(verdict: .clean, date: date(16, hour: 9), bpm: 75)]
        let futureGrade = ColdGradeRecord(passageID: spot.id, date: date(15, hour: 20), grade: .clean, tempo: 100)
        XCTAssertTrue(PracticeRulesEngine.isColdAttemptEligible(passageID: spot.id,
            context: context(piece, passages: [spot, other], history: [otherWork], grades: [futureGrade], active: set)))
        set.attempts.append(Attempt(verdict: .again, date: date(15, hour: 11), bpm: 75))
        XCTAssertFalse(PracticeRulesEngine.isColdAttemptEligible(passageID: spot.id,
            context: context(piece, passages: [spot], active: set)), "An ungraded repeat is still actual work.")
    }

    func testFirstRecallEarnedYesterdayLeadsOldRecallBacklogAndSkippedRecallsRemainActionable() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let old = (0..<8).map { passage(piece, title: "Earlier work \($0)", due: 28) }
        let oldSets = zip(old, [1, 2, 8, 9, 10, 11, 12, 13]).map { completedSet($0.0, on: $0.1) }
        let recovered = passage(piece, title: "Yesterday’s recovered phrase", due: 28)
        let yesterday = completedSet(recovered, on: 14, verdicts: [.sloppy, .clean, .clean])
        let source = context(piece, passages: old + [recovered], history: oldSets + [yesterday])
        let today = TodayOverview.dailyPlan(context: source)
        XCTAssertEqual(today.items.count, 5)
        XCTAssertEqual(today.items.first?.passageID, recovered.id)
        XCTAssertEqual(today.items.dropFirst().map(\.passageID), Array(old.prefix(4)).map(\.id))
        XCTAssertEqual(today.laterCount, 4)
        let skippedDay = context(piece, passages: old + [recovered], day: 16, history: oldSets + [yesterday])
        let remaining = TodayOverview.dueReviews(context: skippedDay)
        XCTAssertEqual(remaining.count, 9)
        XCTAssertTrue(remaining.contains { $0.passageID == recovered.id })
        XCTAssertEqual(remaining.first?.passageID, old.first?.id, "Carried-over recalls retain oldest-first ordering within their cohort.")
    }

    func testMatureShakyRecoveryAndLowTempoCleanRestartShortConfidenceAtTarget() throws {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        for (grade, tempo) in [(ColdGrade.shaky, 100.0), (.clean, 75.0)] {
            var spot = passage(piece, due: 28)
            spot.schedule = PassageSchedule(dueDate: date(28, hour: 0), intervalDays: 30, reviewStep: 4)
            let report = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: spot.id, grade: grade,
                tempo: tempo, context: context(piece, passages: [spot], day: 14)))
            XCTAssertEqual(report.newSchedule.reviewStep, grade == .shaky ? 0 : 4)
            spot.schedule = report.newSchedule; spot.learningState = report.newLearningState
            let work = completedSet(spot, on: 14, verdicts: [.sloppy, .clean, .clean])
            let next = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: spot.id, grade: .clean,
                tempo: 100, context: context(piece, passages: [spot], history: [work], grades: [report.record])))
            XCTAssertEqual(next.newSchedule.intervalDays, 1, "One recovered cold success cannot reuse a mature thirty-day interval.")
            XCTAssertEqual(next.newSchedule.reviewStep, 1)
            XCTAssertEqual(next.newSchedule.dueDate, date(16, hour: 0))
            XCTAssertEqual(next.newLearningState, .review)
            spot.schedule = next.newSchedule
            let another = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: spot.id, grade: .clean,
                tempo: 100, context: context(piece, passages: [spot], day: 16, history: [work], grades: [report.record, next.record])))
            XCTAssertEqual(another.newSchedule.intervalDays, 3)
            XCTAssertEqual(another.newSchedule.reviewStep, 2)
        }
    }

    func testWarmCorrectedOrSlowMatureWorkStartsConfiguredConfidenceLadderAgain() throws {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        for (start, verdicts) in [(100.0, [Verdict.sloppy, .clean]), (75.0, [.clean, .clean])] {
            var spot = passage(piece, due: 28)
            spot.learningState = .performanceReady
            spot.schedule = PassageSchedule(dueDate: date(28, hour: 0), intervalDays: 30, reviewStep: 4)
            let priorClean = ColdGradeRecord(passageID: spot.id, date: date(14, hour: 8), grade: .clean, tempo: 100)
            let work = completedSet(spot, on: 14, start: start, verdicts: verdicts)
            var source = context(piece, passages: [spot], history: [work], grades: [priorClean])
            source.settings.r4CleanIntervalsDays = [2, 5, 9, 20, 40]
            XCTAssertEqual(TodayOverview.dueReviews(context: source).first?.priority, .recall)
            let renewed = try XCTUnwrap(PracticeRulesEngine.applyColdGrade(passageID: spot.id, grade: .clean, tempo: 100, context: source))
            XCTAssertEqual(renewed.newSchedule.intervalDays, 2, "Recovery uses the player's configured first rung.")
            XCTAssertEqual(renewed.newSchedule.reviewStep, 1)
            XCTAssertEqual(renewed.newLearningState, .review)
            XCTAssertEqual(spot.schedule.reviewStep, 4, "The pure rule does not mutate the saved source.")
        }
    }

    func testWarmSloppyResetsReadinessEvidenceButUndoneFutureAndSlowStartsDoNotInventFailure() {
        let piece = Piece(title: "Score", fullTempoBPM: 100)
        let spot = passage(piece)
        let oldClean = [8, 9, 10, 14, 15].map {
            ColdGradeRecord(passageID: spot.id, date: date($0, hour: 8), grade: .clean, tempo: 100)
        }
        var corrected = completedSet(spot, on: 14, start: 100, verdicts: [.sloppy, .clean])
        var source = context(piece, passages: [spot], history: [corrected], grades: oldClean)
        source.settings.r10RequiresFirstInSession = false
        XCTAssertNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: spot.id, context: source),
                     "Old cold successes cannot immediately restore readiness after a real warm correction.")
        source.now = date(17)
        source.coldGrades += [16, 17].map { ColdGradeRecord(passageID: spot.id, date: date($0, hour: 8), grade: .clean, tempo: 100) }
        XCTAssertNotNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: spot.id, context: source),
                        "Three genuine post-correction target checks restore readiness.")
        source.now = date(15)
        corrected.attempts[0].undoneAt = date(14, hour: 11)
        source.history = [corrected]
        XCTAssertNotNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: spot.id, context: source))
        corrected.attempts[0].undoneAt = nil
        corrected.attempts[0].date = date(16, hour: 9)
        source.history = [corrected]
        XCTAssertNotNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: spot.id, context: source))
        source.history = [completedSet(spot, on: 14, start: 75, verdicts: [.clean, .clean])]
        XCTAssertNotNil(PracticeRulesEngine.evaluateR10PerformanceReady(passageID: spot.id, context: source),
                        "Choosing a slower warm start alone does not report a playing failure.")
    }

}
