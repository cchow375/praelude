import Foundation

/// Calendar aggregates (§15): which days had practice, how many minutes each, and every piece's
/// performance dates in range — the three things the Calendar screen draws per day cell.
public enum PracticeCalendarStats {
    public struct DayTotal: Equatable, Sendable {
        public var date: Date
        public var seconds: TimeInterval
        public var sessionCount: Int
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
            totals[day] = total
        }
        return totals
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
