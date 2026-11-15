import Foundation
import XCTest
@testable import PraeludeCore

final class PassageReviewPriorityTests: XCTestCase {
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "America/New_York")!
        return value
    }
    private func date(_ day: Int, hour: Int = 12) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour))!
    }
    private func passage(_ piece: Piece, state: LearningState = .review, due: Int) -> Passage {
        Passage(pieceID: piece.id, title: "Saved spot", learningState: state,
                schedule: PassageSchedule(dueDate: date(due, hour: 0)))
    }

    func testMissedLearningPassageRemainsDueAndLeadsTheSameSessionQueueWithoutMutation() {
        let piece = Piece(title: "Synthetic score")
        let ordinary = passage(piece, due: 11)
        let lapsed = passage(piece, state: .learning, due: 9)
        let grade = ColdGradeRecord(passageID: lapsed.id, date: date(8), grade: .missed, tempo: 60)
        let context = RuleContext(now: date(11), calendar: calendar, pieces: [piece],
                                  passages: [ordinary, lapsed], coldGrades: [grade])
        let reviews = TodayOverview.dueReviews(context: context)
        XCTAssertEqual(reviews.map(\.passageID), [lapsed.id, ordinary.id])
        XCTAssertEqual(reviews[0].overdueDays, 2)
        XCTAssertEqual(reviews[0].label, "Build again")
        XCTAssertEqual(reviews[0].reason, "The first check needed work. Finish a practice set, then return tomorrow.")
        let plan = PracticeRulesEngine.buildSession(availableMinutes: 30, context: context)
        XCTAssertEqual(plan.items.compactMap(\.passageID), reviews.map(\.passageID))
        XCTAssertEqual(plan.items.map(\.kind), [.learning, .review])
        XCTAssertEqual(context.passages, [ordinary, lapsed])
        XCTAssertEqual(context.coldGrades, [grade], "An overdue date never creates a playing verdict.")
    }

    func testUnfinishedShakyReturnsNextDayEvenBeforeOldScheduleAndLaterCleanClearsTheLabel() {
        let piece = Piece(title: "Synthetic score")
        let spot = passage(piece, state: .learning, due: 12)
        let shaky = ColdGradeRecord(passageID: spot.id, date: date(10), grade: .shaky, tempo: 60)
        var context = RuleContext(now: date(11), calendar: calendar, pieces: [piece], passages: [spot], coldGrades: [shaky])
        XCTAssertEqual(TodayOverview.dueReviews(context: context).map(\.passageID), [spot.id])
        let tough = TodayOverview.toughPassages(context: context)
        XCTAssertEqual(tough.map(\.passageID), [spot.id])
        XCTAssertTrue(tough[0].isUrgent)
        XCTAssertEqual(tough[0].dueDate, spot.schedule.dueDate, "The derived rebuilding task preserves the saved schedule.")
        XCTAssertEqual(tough[0].nextActionDate, date(11, hour: 0))
        XCTAssertEqual(PracticeRulesEngine.buildSession(availableMinutes: 30, context: context).items.map(\.passageID), [spot.id])
        context.coldGrades.append(ColdGradeRecord(passageID: spot.id, date: date(11, hour: 9), grade: .clean, tempo: 60))
        XCTAssertTrue(TodayOverview.toughPassages(context: context).isEmpty)
    }

    func testDueToughPassageIsUrgentAndNoColdDataDoesNotInventDifficulty() {
        let piece = Piece(title: "Synthetic score")
        let due = passage(piece, due: 11), unreported = passage(piece, due: 11)
        let context = RuleContext(now: date(11), calendar: calendar, pieces: [piece], passages: [unreported, due],
                                  coldGrades: [ColdGradeRecord(passageID: due.id, date: date(10), grade: .shaky, tempo: 60)])
        let reviews = TodayOverview.dueReviews(context: context)
        XCTAssertEqual(reviews[0].passageID, due.id)
        XCTAssertEqual(reviews[0].label, "Build again")
        XCTAssertFalse(reviews[1].isTough)
        XCTAssertFalse(reviews[1].isUrgent)
        XCTAssertNil(reviews[1].latestColdGrade)
    }

    func testParkedRestingArchivedAndDeletedTargetsAreNotActionable() {
        let active = Piece(title: "Active"), resting = Piece(title: "Resting", status: .resting)
        var parked = passage(active, due: 8); parked.parkedUntil = date(12)
        var archived = passage(active, due: 8); archived.archived = true
        var deleted = passage(active, due: 8); deleted.deletedAt = date(10); deleted.archived = true
        let context = RuleContext(now: date(11), calendar: calendar, pieces: [active, resting],
                                  passages: [parked, archived, deleted, passage(resting, due: 8)])
        XCTAssertTrue(TodayOverview.dueReviews(context: context).isEmpty)
        XCTAssertTrue(PracticeRulesEngine.buildSession(availableMinutes: 30, context: context).items.isEmpty)
    }

    func testFinalWeekNewPassageAppearsOnlyOnceAndCalendarDaysRespectDST() {
        let piece = Piece(title: "Performance", performanceDates: [date(15)])
        let spot = Passage(pieceID: piece.id, title: "New")
        let context = RuleContext(now: date(11), calendar: calendar, pieces: [piece], passages: [spot])
        XCTAssertEqual(TodayOverview.dueReviews(context: context).map(\.passageID), [spot.id])
        XCTAssertEqual(PracticeRulesEngine.buildSession(availableMinutes: 30, context: context).items.filter { $0.passageID == spot.id }.count, 1)
        let now = calendar.date(from: DateComponents(year: 2026, month: 11, day: 2, hour: 1))!
        let beforeFallback = calendar.date(from: DateComponents(year: 2026, month: 10, day: 31, hour: 0))!
        let ordinary = Piece(title: "No performance")
        let overdue = Passage(pieceID: ordinary.id, title: "Saved spot", learningState: .review,
                              schedule: PassageSchedule(dueDate: beforeFallback))
        XCTAssertEqual(TodayOverview.dueReviews(context: RuleContext(now: now, calendar: calendar, pieces: [ordinary], passages: [overdue]))[0].overdueDays, 2)
    }

    @MainActor func testNameAndGoalEditsLeaveActiveHistoryAndFirstAttemptUntouchedAndApplyNextSet() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PracticeStore(directory: directory, now: { self.date(11) })
        let piece = Piece(title: "Synthetic score")
        let original = Passage(pieceID: piece.id, title: "Old name", performanceTempo: 100)
        try store.addPiece(piece); try store.savePassage(original)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: original.id, startBPM: 60, targetBPM: 100))
        try store.record(.clean)
        let active = try XCTUnwrap(store.activeSet), grades = store.state.coldGrades
        var edited = original; edited.title = "Recognizable name"; edited.performanceTempo = 112.5
        try store.savePassage(edited, replacing: original)
        XCTAssertEqual(store.activeSet, active)
        XCTAssertEqual(store.state.coldGrades, grades)
        try store.endSet()
        let saved = try XCTUnwrap(store.state.history.first)
        XCTAssertEqual(saved.configuration.passageSnapshot, original)
        XCTAssertEqual(saved.attempts, active.attempts)
        let next = try XCTUnwrap(PracticeRulesEngine.defaultConfiguration(for: edited.id, context: RuleContext(state: store.state)))
        XCTAssertEqual(next.targetBPM, 112.5)
        XCTAssertEqual(next.startBPM, 60)
        let reopened = PracticeStore(directory: directory)
        XCTAssertEqual(reopened.state.passages.first?.performanceTempo, 112.5)
        XCTAssertEqual(reopened.state.history.first, saved)
        let wire = PassageSyncRow(edited)
        XCTAssertEqual(wire.performance_tempo, 112.5)
    }
}
