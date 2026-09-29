import Foundation

/// A shareable 7-day rollup (§16): computed once as of a given moment, so a View can render it and
/// hand it to `ImageRenderer` without re-deriving anything from `PracticeStore` at render time.
public struct WeeklyRecapData: Equatable, Sendable {
    public var startDate: Date
    public var endDate: Date
    public var focusedSeconds: TimeInterval
    public var repetitions: Int
    public var completedSets: Int
    public var practiceDays: Int
    public var streakDays: Int
    public var piecesPracticed: Int
    public var newlyPerformanceReadyCount: Int
}

public enum WeeklyRecap {
    /// The 7 calendar days ending on `asOf`'s own day, inclusive.
    public static func compute(state: LibraryState, asOf: Date, calendar: Calendar) -> WeeklyRecapData {
        let today = calendar.startOfDay(for: asOf)
        let start = calendar.date(byAdding: .day, value: -6, to: today) ?? today
        let end = calendar.date(byAdding: .day, value: 1, to: today) ?? today // exclusive upper bound
        let sessions = state.sessions.filter { $0.startedAt >= start && $0.startedAt < end }
        let seconds = sessions.reduce(0) { $0 + $1.activeSeconds }
        let reps = sessions.reduce(0) { $0 + $1.attempts.count }
        let completed = sessions.reduce(0) { $0 + $1.completedSets }
        let days = Set(sessions.map { calendar.startOfDay(for: $0.startedAt) }).count
        let pieces = Set(sessions.map(\.pieceID)).count
        // `MilestoneEvent` (§14) is the purpose-built log for exactly this ("passage/piece ready" is
        // named first among its own examples); nothing populates it yet (the rewards economy is a
        // separate, not-yet-wired track), so this reads an honest 0 today and becomes accurate the
        // moment that track appends real milestones — no change needed here.
        let newlyReady = state.milestoneEvents.filter {
            $0.date >= start && $0.date < end && $0.kind.localizedCaseInsensitiveContains("ready")
        }.count
        return WeeklyRecapData(startDate: start, endDate: today, focusedSeconds: seconds, repetitions: reps,
                                completedSets: completed, practiceDays: days, streakDays: state.rewardsState.streakDays,
                                piecesPracticed: pieces, newlyPerformanceReadyCount: newlyReady)
    }
}
