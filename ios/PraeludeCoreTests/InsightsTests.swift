import Foundation
import XCTest
@testable import PraeludeCore

/// Staged-data tests for `Core/Insights/*.swift` (§15/§16 Today, History, Calendar, Notebook, Data
/// views): each function is exercised directly against hand-built fixtures, the same "stage only the
/// slice under test" pattern `PracticeRulesEngineTests` uses for the rules façade.
final class InsightsTests: XCTestCase {
    // MARK: - Fixtures

    private func makeCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }

    private func makeDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12, calendar: Calendar) -> Date {
        var components = DateComponents()
        components.year = year; components.month = month; components.day = day
        components.hour = hour; components.timeZone = calendar.timeZone
        return calendar.date(from: components)!
    }

    private func makePiece(title: String = "Nocturne", performanceDates: [Date] = []) -> Piece {
        Piece(title: title, composer: "Chopin", performanceDates: performanceDates)
    }

    private func makePassage(pieceID: UUID, title: String = "Passage", learningState: LearningState = .new,
                              schedule: PassageSchedule = PassageSchedule(), archived: Bool = false,
                              parkedUntil: Date? = nil) -> Passage {
        Passage(pieceID: pieceID, title: title, archived: archived, learningState: learningState,
                schedule: schedule, parkedUntil: parkedUntil)
    }

    private func makeConfiguration(pieceID: UUID, passageID: UUID?, startBPM: Double = 60, targetBPM: Double = 60,
                                    snapshot: Passage? = nil) -> PracticeConfiguration {
        PracticeConfiguration(pieceID: pieceID, passageID: passageID, startBPM: startBPM, targetBPM: targetBPM,
                               passageSnapshot: snapshot)
    }

    private func makeSet(sessionID: UUID, configuration: PracticeConfiguration, attempts: [Attempt] = [],
                          startedAt: Date, currentBPM: Double? = nil, status: SetStatus = .ended) -> ActiveSet {
        var set = ActiveSet(id: UUID(), sessionID: sessionID, configuration: configuration, startedAt: startedAt)
        set.attempts = attempts
        set.status = status
        if let currentBPM { set.currentBPM = currentBPM }
        return set
    }

    private func attempt(_ verdict: Verdict, bpm: Double = 60, date: Date, undoneAt: Date? = nil) -> Attempt {
        Attempt(verdict: verdict, date: date, bpm: bpm, undoneAt: undoneAt)
    }

    private func makeContext(now: Date, calendar: Calendar, pieces: [Piece] = [], passages: [Passage] = []) -> RuleContext {
        RuleContext(now: now, calendar: calendar, pieces: pieces, passages: passages)
    }

    // MARK: - TodayOverview.dueReviews

    func testDueReviewsIncludesDueReviewStatePassageAndExcludesNewOrFuture() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        let piece = makePiece()
        let due = makePassage(pieceID: piece.id, title: "Due", learningState: .review,
                               schedule: PassageSchedule(dueDate: makeDate(2026, 6, 14, calendar: calendar)))
        let future = makePassage(pieceID: piece.id, title: "Future", learningState: .review,
                                  schedule: PassageSchedule(dueDate: makeDate(2026, 6, 20, calendar: calendar)))
        let untouched = makePassage(pieceID: piece.id, title: "New", learningState: .new)
        let archived = makePassage(pieceID: piece.id, title: "Archived", learningState: .review,
                                    schedule: PassageSchedule(dueDate: makeDate(2026, 6, 1, calendar: calendar)), archived: true)
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [due, future, untouched, archived])
        let reviews = TodayOverview.dueReviews(context: context)
        XCTAssertEqual(reviews.map(\.passageID), [due.id])
    }

    func testDueReviewsIncludesEveryPassageOfAFinalWeekPiece() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        // A performance 3 days out puts the piece in its final week (R11 default: 7 days).
        let piece = makePiece(performanceDates: [makeDate(2026, 6, 18, calendar: calendar)])
        let reviewPassage = makePassage(pieceID: piece.id, learningState: .review)
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [reviewPassage])
        let reviews = TodayOverview.dueReviews(context: context)
        XCTAssertEqual(reviews.map(\.passageID), [reviewPassage.id])
        XCTAssertTrue(reviews[0].inFinalWeek)
    }

    // MARK: - TodayOverview.upcomingPerformances

    func testUpcomingPerformancesSortsNearestFirstAndExcludesPast() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        let past = makePiece(title: "Past recital", performanceDates: [makeDate(2026, 6, 1, calendar: calendar)])
        let near = makePiece(title: "Near recital", performanceDates: [makeDate(2026, 6, 20, calendar: calendar)])
        let far = makePiece(title: "Far recital", performanceDates: [makeDate(2026, 7, 15, calendar: calendar)])
        let context = makeContext(now: now, calendar: calendar, pieces: [past, near, far])
        let upcoming = TodayOverview.upcomingPerformances(context: context)
        XCTAssertEqual(upcoming.map(\.pieceID), [near.id, far.id])
        XCTAssertEqual(upcoming[0].daysRemaining, 5)
    }

    func testUpcomingPerformancesRespectsLimit() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        let pieces = (1...4).map { makePiece(title: "Piece \($0)", performanceDates: [makeDate(2026, 6, 15 + $0, calendar: calendar)]) }
        let context = makeContext(now: now, calendar: calendar, pieces: pieces)
        XCTAssertEqual(TodayOverview.upcomingPerformances(context: context, limit: 2).count, 2)
    }

    // MARK: - TodayOverview.streakStatus

    func testStreakStatusMessages() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        var zero = RewardsState(); zero.streakDays = 0
        XCTAssertEqual(TodayOverview.streakStatus(rewardsState: zero, calendar: calendar, now: now).message,
                       "No streak yet. Practice today to start one.")

        var practicedToday = RewardsState(); practicedToday.streakDays = 5; practicedToday.lastPracticeDate = now
        let today = TodayOverview.streakStatus(rewardsState: practicedToday, calendar: calendar, now: now)
        XCTAssertTrue(today.practicedToday)
        XCTAssertTrue(today.message.contains("5 days"))

        var yesterday = RewardsState(); yesterday.streakDays = 1
        yesterday.lastPracticeDate = calendar.date(byAdding: .day, value: -1, to: now)
        let notYet = TodayOverview.streakStatus(rewardsState: yesterday, calendar: calendar, now: now)
        XCTAssertFalse(notYet.practicedToday)
        XCTAssertEqual(notYet.message, "1 day. Practice today to keep it.")
    }

    // MARK: - PassageHistory.timeline

    func testPassageHistoryMergesColdGradesAndEffectiveAttemptsSortedByDate() {
        let calendar = makeCalendar()
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id)
        let earlyGrade = ColdGradeRecord(passageID: passage.id, date: makeDate(2026, 6, 1, calendar: calendar), grade: .clean, tempo: 70)
        let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id)
        let set = makeSet(sessionID: UUID(), configuration: configuration, attempts: [
            attempt(.clean, bpm: 72, date: makeDate(2026, 6, 2, calendar: calendar)),
            attempt(.sloppy, bpm: 72, date: makeDate(2026, 6, 3, calendar: calendar), undoneAt: makeDate(2026, 6, 3, 13, calendar: calendar)),
            attempt(.reset, bpm: 72, date: makeDate(2026, 6, 4, calendar: calendar)),
        ], startedAt: makeDate(2026, 6, 2, calendar: calendar))
        var state = LibraryState()
        state.coldGrades = [earlyGrade]; state.history = [set]
        let timeline = PassageHistory.timeline(passageID: passage.id, state: state)
        XCTAssertEqual(timeline.count, 2, "the undone attempt and the reset must be excluded")
        XCTAssertEqual(timeline[0].kind, .coldGrade(.clean))
        XCTAssertEqual(timeline[1].kind, .attempt(.clean))
        XCTAssertLessThan(timeline[0].date, timeline[1].date)
    }

    // MARK: - PracticeHeatmap.passageLevel

    func testPassageLevelPrefersRecentColdGradeOverAttempts() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        let passage = makePassage(pieceID: UUID())
        var state = LibraryState()
        state.coldGrades = [ColdGradeRecord(passageID: passage.id, date: makeDate(2026, 6, 14, calendar: calendar), grade: .missed, tempo: 60)]
        XCTAssertEqual(PracticeHeatmap.passageLevel(passageID: passage.id, state: state, now: now, calendar: calendar), .failing)
    }

    func testPassageLevelIgnoresColdGradeOutsideRecencyWindowAndFallsBackToAttempts() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        let passage = makePassage(pieceID: UUID())
        var state = LibraryState()
        // 20 days old: outside the 14-day recency window.
        state.coldGrades = [ColdGradeRecord(passageID: passage.id, date: makeDate(2026, 5, 26, calendar: calendar), grade: .missed, tempo: 60)]
        let configuration = makeConfiguration(pieceID: UUID(), passageID: passage.id)
        let set = makeSet(sessionID: UUID(), configuration: configuration, attempts: [
            attempt(.clean, date: makeDate(2026, 6, 14, calendar: calendar)),
            attempt(.clean, date: makeDate(2026, 6, 14, 13, calendar: calendar)),
        ], startedAt: makeDate(2026, 6, 14, calendar: calendar))
        state.history = [set]
        XCTAssertEqual(PracticeHeatmap.passageLevel(passageID: passage.id, state: state, now: now, calendar: calendar), .solid)
    }

    func testPassageLevelAttemptThresholds() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        let passageID = UUID()
        func level(_ verdicts: [Verdict]) -> HeatLevel? {
            let configuration = makeConfiguration(pieceID: UUID(), passageID: passageID)
            let attempts = verdicts.enumerated().map { attempt($1, date: makeDate(2026, 6, 14, 10 + $0, calendar: calendar)) }
            var state = LibraryState()
            state.history = [makeSet(sessionID: UUID(), configuration: configuration, attempts: attempts, startedAt: now)]
            return PracticeHeatmap.passageLevel(passageID: passageID, state: state, now: now, calendar: calendar)
        }
        XCTAssertEqual(level([.clean, .clean, .clean, .clean, .sloppy]), .solid) // 80% clean
        XCTAssertEqual(level([.clean, .clean, .sloppy, .sloppy, .sloppy]), .shaky) // 40% clean
        XCTAssertEqual(level([.sloppy, .sloppy, .sloppy, .again, .again]), .failing) // 0% clean
    }

    func testPassageLevelIsNilWithNoEvidence() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        XCTAssertNil(PracticeHeatmap.passageLevel(passageID: UUID(), state: LibraryState(), now: now, calendar: calendar))
    }

    func testTapOpacityFadesWithAgeAndIsFloored() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let fresh = BreakPointTap(passageID: UUID(), date: now)
        XCTAssertEqual(PracticeHeatmap.tapOpacity(fresh, now: now), 1.0, accuracy: 0.001)
        let old = BreakPointTap(passageID: UUID(), date: now.addingTimeInterval(-90 * 86400))
        XCTAssertEqual(PracticeHeatmap.tapOpacity(old, now: now), 0.35, accuracy: 0.001)
    }

    // MARK: - PieceReadiness.evaluate

    func testPieceReadinessIsNilForMissingPiece() {
        let context = makeContext(now: Date(), calendar: makeCalendar())
        XCTAssertNil(PieceReadiness.evaluate(pieceID: UUID(), context: context))
    }

    func testPieceReadinessNotStartedWithNoPassages() {
        let calendar = makeCalendar()
        let piece = makePiece()
        let context = makeContext(now: makeDate(2026, 6, 15, calendar: calendar), calendar: calendar, pieces: [piece])
        let summary = PieceReadiness.evaluate(pieceID: piece.id, context: context)
        XCTAssertEqual(summary?.state, .notStarted)
    }

    func testPieceReadinessPerformanceReadyWhenEveryPassageIs() {
        let calendar = makeCalendar()
        let piece = makePiece()
        let passages = [makePassage(pieceID: piece.id, learningState: .performanceReady),
                         makePassage(pieceID: piece.id, learningState: .performanceReady)]
        let context = makeContext(now: makeDate(2026, 6, 15, calendar: calendar), calendar: calendar, pieces: [piece], passages: passages)
        let summary = PieceReadiness.evaluate(pieceID: piece.id, context: context)
        XCTAssertEqual(summary?.state, .performanceReady)
        XCTAssertEqual(summary?.readyFraction, 1.0)
    }

    func testPieceReadinessAtRiskInFinalWeekWithUnreadyPassages() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        let piece = makePiece(performanceDates: [makeDate(2026, 6, 17, calendar: calendar)]) // 2 days out: final week
        let passage = makePassage(pieceID: piece.id, learningState: .learning)
        let context = makeContext(now: now, calendar: calendar, pieces: [piece], passages: [passage])
        let summary = PieceReadiness.evaluate(pieceID: piece.id, context: context)
        XCTAssertEqual(summary?.state, .atRisk)
        XCTAssertEqual(summary?.daysToPerformance, 2)
    }

    func testPieceReadinessLearningWhenPracticedButNoneReady() {
        let calendar = makeCalendar()
        let piece = makePiece()
        let passage = makePassage(pieceID: piece.id, learningState: .learning)
        let context = makeContext(now: makeDate(2026, 6, 15, calendar: calendar), calendar: calendar, pieces: [piece], passages: [passage])
        XCTAssertEqual(PieceReadiness.evaluate(pieceID: piece.id, context: context)?.state, .learning)
    }

    // MARK: - SessionSummary.summarize

    func testSessionSummaryIsNilForMissingSession() {
        XCTAssertNil(SessionSummary.summarize(sessionID: UUID(), state: LibraryState(), calendar: makeCalendar(), now: Date()))
    }

    func testSessionSummaryCountsMovedUpDroppedBackParkedAndDueTomorrow() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        let piece = makePiece()
        let movedUpPassage = makePassage(pieceID: piece.id, title: "Moved up")
        let droppedBackPassage = makePassage(pieceID: piece.id, title: "Dropped back",
                                              schedule: PassageSchedule(dueDate: makeDate(2026, 6, 16, calendar: calendar)),
                                              parkedUntil: makeDate(2026, 6, 16, calendar: calendar))
        let session = PracticeSession(id: UUID(), pieceID: piece.id, focus: "Pulse", startedAt: now)
        var finishedSession = session
        finishedSession.activeSeconds = 900; finishedSession.attempts = []; finishedSession.completedSets = 2

        // Passage 1: two sets, tempo goes 60 -> 66 (currentBPM), next set starts at 66: moved up.
        let firstSet = makeSet(sessionID: session.id, configuration: makeConfiguration(pieceID: piece.id, passageID: movedUpPassage.id, startBPM: 60, targetBPM: 80),
                                startedAt: now, currentBPM: 66)
        let secondSet = makeSet(sessionID: session.id, configuration: makeConfiguration(pieceID: piece.id, passageID: movedUpPassage.id, startBPM: 70, targetBPM: 80),
                                 startedAt: now.addingTimeInterval(600), currentBPM: 70)
        // Passage 2: first set reaches 80, second set (later, after a slip) starts back down at 70: dropped back.
        let thirdSet = makeSet(sessionID: session.id, configuration: makeConfiguration(pieceID: piece.id, passageID: droppedBackPassage.id, startBPM: 60, targetBPM: 80),
                                startedAt: now.addingTimeInterval(200), currentBPM: 80)
        let fourthSet = makeSet(sessionID: session.id, configuration: makeConfiguration(pieceID: piece.id, passageID: droppedBackPassage.id, startBPM: 70, targetBPM: 80),
                                 startedAt: now.addingTimeInterval(800), currentBPM: 70)

        var state = LibraryState()
        state.sessions = [finishedSession]
        state.history = [firstSet, secondSet, thirdSet, fourthSet]
        state.passages = [movedUpPassage, droppedBackPassage]

        let summary = SessionSummary.summarize(sessionID: session.id, state: state, calendar: calendar, now: now)
        XCTAssertEqual(summary?.movedUp, 1)
        XCTAssertEqual(summary?.droppedBack, 1)
        XCTAssertEqual(summary?.parked, 1)
        XCTAssertEqual(summary?.dueTomorrow, 1)
        XCTAssertEqual(summary?.focusedSeconds, 900)
        XCTAssertEqual(summary?.completedSets, 2)
    }

    // MARK: - WeeklyRecap.compute

    func testWeeklyRecapWindowIsSevenDaysInclusiveAndExcludesOutsideSessions() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        let pieceA = UUID(), pieceB = UUID()
        func session(_ pieceID: UUID, daysAgo: Int, seconds: TimeInterval = 300) -> PracticeSession {
            var session = PracticeSession(pieceID: pieceID, focus: "Pulse",
                                           startedAt: calendar.date(byAdding: .day, value: -daysAgo, to: now)!)
            session.activeSeconds = seconds
            return session
        }
        var state = LibraryState()
        state.sessions = [session(pieceA, daysAgo: 0), session(pieceB, daysAgo: 6), session(pieceA, daysAgo: 7) /* excluded */]
        let recap = WeeklyRecap.compute(state: state, asOf: now, calendar: calendar)
        XCTAssertEqual(recap.practiceDays, 2)
        XCTAssertEqual(recap.piecesPracticed, 2)
        XCTAssertEqual(recap.focusedSeconds, 600)
    }

    func testWeeklyRecapCountsReadyMilestonesCaseInsensitively() {
        let calendar = makeCalendar()
        let now = makeDate(2026, 6, 15, calendar: calendar)
        var state = LibraryState()
        state.milestoneEvents = [
            MilestoneEvent(kind: "passageReady", date: now),
            MilestoneEvent(kind: "PIECE_READY", date: now.addingTimeInterval(-86400)),
            MilestoneEvent(kind: "streakMilestone", date: now),
            MilestoneEvent(kind: "passageReady", date: now.addingTimeInterval(-10 * 86400)), // outside window
        ]
        XCTAssertEqual(WeeklyRecap.compute(state: state, asOf: now, calendar: calendar).newlyPerformanceReadyCount, 2)
    }

    // MARK: - HistoryExport

    func testHistoryExportRowsExcludesUndoneAndResetSortedByDate() {
        let calendar = makeCalendar()
        let piece = makePiece(title: "Étude")
        let passage = makePassage(pieceID: piece.id, title: "Opening")
        let configuration = makeConfiguration(pieceID: piece.id, passageID: passage.id, snapshot: passage)
        let session = PracticeSession(id: UUID(), pieceID: piece.id, focus: "Pulse", startedAt: makeDate(2026, 6, 1, calendar: calendar))
        let set = makeSet(sessionID: session.id, configuration: configuration, attempts: [
            attempt(.clean, bpm: 72, date: makeDate(2026, 6, 2, calendar: calendar)),
            attempt(.again, bpm: 72, date: makeDate(2026, 6, 1, calendar: calendar)),
            attempt(.sloppy, bpm: 72, date: makeDate(2026, 6, 1, 8, calendar: calendar), undoneAt: makeDate(2026, 6, 1, 9, calendar: calendar)),
        ], startedAt: makeDate(2026, 6, 1, calendar: calendar))
        var state = LibraryState()
        state.pieces = [piece]; state.passages = [passage]; state.sessions = [session]; state.history = [set]
        let rows = HistoryExport.rows(state: state)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].verdict, .again)
        XCTAssertEqual(rows[1].verdict, .clean)
        XCTAssertEqual(rows[0].pieceTitle, "Étude")
        XCTAssertEqual(rows[0].passageTitle, "Opening")
    }

    func testHistoryExportCSVEscapesCommasAndHasHeader() {
        let piece = makePiece(title: "Waltz, Op. 1")
        let configuration = makeConfiguration(pieceID: piece.id, passageID: nil)
        let session = PracticeSession(id: UUID(), pieceID: piece.id, focus: "Pulse", startedAt: Date(timeIntervalSince1970: 1_700_000_000))
        let set = makeSet(sessionID: session.id, configuration: configuration,
                           attempts: [attempt(.clean, bpm: 88, date: Date(timeIntervalSince1970: 1_700_000_100))],
                           startedAt: Date(timeIntervalSince1970: 1_700_000_000))
        var state = LibraryState()
        state.pieces = [piece]; state.sessions = [session]; state.history = [set]
        let csv = HistoryExport.csv(state: state)
        let lines = csv.components(separatedBy: "\r\n").filter { !$0.isEmpty }
        XCTAssertEqual(lines.first, "Date,Piece,Passage,Focus,Verdict,BPM")
        XCTAssertEqual(lines.count, 2)
        XCTAssertTrue(lines[1].contains("\"Waltz, Op. 1\""))
        XCTAssertTrue(lines[1].hasSuffix("clean,88"))
    }

    func testHistoryExportJSONRoundTrips() throws {
        let piece = makePiece(title: "Prelude")
        let configuration = makeConfiguration(pieceID: piece.id, passageID: nil)
        let session = PracticeSession(id: UUID(), pieceID: piece.id, focus: "Pulse", startedAt: Date(timeIntervalSince1970: 1_700_000_000))
        let set = makeSet(sessionID: session.id, configuration: configuration,
                           attempts: [attempt(.sloppy, bpm: 90, date: Date(timeIntervalSince1970: 1_700_000_050))],
                           startedAt: Date(timeIntervalSince1970: 1_700_000_000))
        var state = LibraryState()
        state.pieces = [piece]; state.sessions = [session]; state.history = [set]
        let data = try HistoryExport.json(state: state)
        let decoded = try JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        XCTAssertEqual(decoded?.count, 1)
        XCTAssertEqual(decoded?.first?["piece"] as? String, "Prelude")
        XCTAssertEqual(decoded?.first?["verdict"] as? String, "sloppy")
        XCTAssertEqual(decoded?.first?["bpm"] as? Double, 90)
    }

    // MARK: - PracticeCalendarStats

    func testDailyTotalsAggregatesMultipleSessionsOnTheSameDay() {
        let calendar = makeCalendar()
        let day = makeDate(2026, 6, 15, calendar: calendar)
        var first = PracticeSession(pieceID: UUID(), focus: "Pulse", startedAt: day); first.activeSeconds = 300
        var second = PracticeSession(pieceID: UUID(), focus: "Pulse", startedAt: day.addingTimeInterval(3600)); second.activeSeconds = 400
        var otherDay = PracticeSession(pieceID: UUID(), focus: "Pulse", startedAt: makeDate(2026, 6, 16, calendar: calendar)); otherDay.activeSeconds = 100
        var state = LibraryState()
        state.sessions = [first, second, otherDay]
        let totals = PracticeCalendarStats.dailyTotals(state: state, calendar: calendar)
        XCTAssertEqual(totals[calendar.startOfDay(for: day)]?.seconds, 700)
        XCTAssertEqual(totals[calendar.startOfDay(for: day)]?.sessionCount, 2)
        XCTAssertEqual(totals.count, 2)
    }

    func testPerformanceDaysFlattensAndExcludesDeletedPieces() {
        let calendar = makeCalendar()
        let live = makePiece(title: "Live", performanceDates: [makeDate(2026, 6, 20, calendar: calendar), makeDate(2026, 7, 1, calendar: calendar)])
        var deleted = makePiece(title: "Gone", performanceDates: [makeDate(2026, 6, 21, calendar: calendar)])
        deleted.deletedAt = Date()
        var state = LibraryState()
        state.pieces = [live, deleted]
        let days = PracticeCalendarStats.performanceDays(state: state, calendar: calendar)
        XCTAssertEqual(days.count, 2)
        XCTAssertTrue(days.allSatisfy { $0.pieceID == live.id })
    }

    // MARK: - NotebookShareComposer

    func testNotebookShareComposerFormatsEachKind() {
        let piece = makePiece(title: "Ballade")
        let daily = NotebookEntry(kind: .daily, pieceID: piece.id, text: "Left hand still rushing.")
        XCTAssertEqual(NotebookShareComposer.summary(for: daily, pieceTitle: piece.title), "Practice note · Ballade\nLeft hand still rushing.")

        let prep = NotebookEntry(kind: .lessonPrep, text: "")
        XCTAssertEqual(NotebookShareComposer.summary(for: prep, pieceTitle: nil), "Lesson prep")

        let lesson = NotebookEntry(kind: .lessonNote, text: "  Slow the coda.  ")
        XCTAssertEqual(NotebookShareComposer.summary(for: lesson, pieceTitle: nil), "Lesson note\nSlow the coda.")
    }
}
