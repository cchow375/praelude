import Foundation

/// Calendar aggregates (§15): which days had practice, how many minutes each, and every piece's
/// performance dates in range — the three things the Calendar screen draws per day cell.
public enum PracticeCalendarStats {
    public struct DayTotal: Equatable, Sendable {
        public var date: Date
        public var seconds: TimeInterval
        public var sessionCount: Int
        public var repetitions: Int = 0
        public var hasPractice: Bool { seconds > 0 || repetitions > 0 }
    }

    /// One entry per calendar day that had at least one session starting on it, keyed by that day's
    /// own start-of-day — a sparse map, since most days in a long-lived library have none.
    public static func dailyTotals(state: LibraryState, calendar: Calendar) -> [Date: DayTotal] {
        var totals: [Date: DayTotal] = [:]
        for session in state.sessions {
            let day = calendar.startOfDay(for: session.startedAt)
            var total = totals[day] ?? DayTotal(date: day, seconds: 0, sessionCount: 0)
            total.seconds += session.activeSeconds
            total.sessionCount += 1
            total.repetitions += session.attempts.filter(\.isEffective).count
            totals[day] = total
        }
        return totals
    }

    public struct RecordedStreak: Equatable, Sendable {
        public var currentDays: Int
        public var longestDays: Int
        public var practicedToday: Bool
        public var daysThisWeek: Int
    }

    /// Derived from synced practice, rather than a device's reward cache. A blank opened session
    /// is not practice. Attribute recorded work to the session's start day, like the calendar.
    /// Calendar arithmetic handles daylight-saving days; a day is never assumed to be 86,400s.
    public static func recordedStreak(state: LibraryState, calendar: Calendar, now: Date) -> RecordedStreak {
        let today = calendar.startOfDay(for: now)
        let days = Set(dailyTotals(state: state, calendar: calendar).values
            .filter { $0.hasPractice && $0.date <= today }.map(\.date))
        let practicedToday = days.contains(today)
        var current = 0
        var cursor = practicedToday ? today : calendar.date(byAdding: .day, value: -1, to: today)
        while let day = cursor, days.contains(day) {
            current += 1
            cursor = calendar.date(byAdding: .day, value: -1, to: day)
        }
        var longest = 0, run = 0
        var previous: Date?
        for day in days.sorted() {
            run = previous.flatMap { calendar.date(byAdding: .day, value: 1, to: $0) } == day ? run + 1 : 1
            longest = max(longest, run); previous = day
        }
        let weekStart = calendar.dateInterval(of: .weekOfYear, for: today)?.start ?? today
        return RecordedStreak(currentDays: current, longestDays: longest, practicedToday: practicedToday,
                              daysThisWeek: days.filter { $0 >= weekStart }.count)
    }

    public struct PerformanceDay: Identifiable, Equatable, Sendable {
        public var id: String { "\(pieceID)-\(date.timeIntervalSince1970)" }
        public var pieceID: UUID
        public var date: Date
    }

    /// Every piece's performance dates, flattened to one row per (piece, date) pair, for marking a
    /// month grid — pieces can share a performance date (a recital) without special-casing it here.
    public static func performanceDays(state: LibraryState, calendar: Calendar) -> [PerformanceDay] {
        state.pieces.filter { $0.deletedAt == nil }.flatMap { piece in
            piece.performanceDates.map { PerformanceDay(pieceID: piece.id, date: calendar.startOfDay(for: $0)) }
        }
    }
}
