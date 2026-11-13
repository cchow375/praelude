import Foundation
import XCTest
@testable import PraeludeCore

final class RecordedStreakTests: XCTestCase {
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "America/New_York")!
        return value
    }
    private func date(_ day: Int, month: Int = 3) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: 12))!
    }
    private func state(_ days: [Int]) -> LibraryState {
        var state = LibraryState()
        state.sessions = days.map { day in
            var session = PracticeSession(pieceID: UUID(), focus: "Pulse", startedAt: date(day))
            session.activeSeconds = 60
            return session
        }
        return state
    }
    func testSpringClockChangeAndDuplicateDaysKeepRunThroughYesterday() {
        let value = PracticeCalendarStats.recordedStreak(state: state([6, 7, 8, 8, 9]), calendar: calendar, now: date(10))
        XCTAssertEqual(value.currentDays, 4)
        XCTAssertEqual(value.longestDays, 4)
        XCTAssertFalse(value.practicedToday)
    }
    func testGapBreaksCurrentButRetainsBestAndIgnoresFuture() {
        let value = PracticeCalendarStats.recordedStreak(state: state([2, 3, 4, 7, 10, 11]), calendar: calendar, now: date(10))
        XCTAssertEqual(value.currentDays, 1)
        XCTAssertEqual(value.longestDays, 3)
        XCTAssertTrue(value.practicedToday)
        XCTAssertEqual(value.daysThisWeek, 1)
    }
    func testBlankOpenedSessionAndUndoneOrResetRepsDoNotCreateDay() {
        var state = state([])
        var session = PracticeSession(pieceID: UUID(), focus: "Pulse", startedAt: date(10))
        state.sessions = [session]
        XCTAssertEqual(PracticeCalendarStats.recordedStreak(state: state, calendar: calendar, now: date(10)).currentDays, 0)
        session.attempts = [Attempt(verdict: .clean, bpm: 60, undoneAt: date(10)), Attempt(verdict: .reset, bpm: 60)]
        state.sessions = [session]
        XCTAssertEqual(PracticeCalendarStats.recordedStreak(state: state, calendar: calendar, now: date(10)).currentDays, 0)
        session.attempts.append(Attempt(verdict: .again, bpm: 60))
        state.sessions = [session]
        XCTAssertEqual(PracticeCalendarStats.recordedStreak(state: state, calendar: calendar, now: date(10)).currentDays, 1)
        XCTAssertEqual(PracticeCalendarStats.dailyTotals(state: state, calendar: calendar)[calendar.startOfDay(for: date(10))]?.repetitions, 1)
    }
    func testFallClockChangeUsesCalendarDays() {
        var state = state([])
        for (month, day) in [(10, 31), (11, 1), (11, 2)] {
            var session = PracticeSession(pieceID: UUID(), focus: "Pulse", startedAt: date(day, month: month))
            session.activeSeconds = 60; state.sessions.append(session)
        }
        XCTAssertEqual(PracticeCalendarStats.recordedStreak(state: state, calendar: calendar, now: date(2, month: 11)).currentDays, 3)
    }
}
