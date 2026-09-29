import Foundation

/// §4c profile stats, computed entirely from local data (no backend/sync — that half of §4 is a
/// separate, unstarted track): current streak, longest streak, total practice time, pieces
/// performance-ready, rank/division/badges.
public struct LocalProfileStats: Equatable, Sendable {
    public var currentStreakDays: Int
    public var longestStreakDays: Int
    public var totalActiveSeconds: TimeInterval
    public var performanceReadyPieceCount: Int
    public var rank: String
    public var division: Int
    public var badgeCount: Int
}

public enum PracticeStats {
    /// The longest run of consecutive calendar days with at least one session, derived from
    /// `sessions`. §4c asks for this alongside the *current* streak, but schema3's `RewardsState`
    /// only ever stores the live running one (`streakDays`) — there is no dedicated "longest streak"
    /// field to read, and adding one would mean reshaping an existing Core type rather than adding a
    /// file. It doesn't need one: every session already carries its own `startedAt`, so the longest
    /// streak is fully derivable, and stays correct automatically as more sessions are recorded.
    public static func longestStreakDays(state: LibraryState, calendar: Calendar) -> Int {
        let days = Set(state.sessions.map { calendar.startOfDay(for: $0.startedAt) }).sorted()
        guard !days.isEmpty else { return 0 }
        var longest = 1
        var current = 1
        for index in 1..<days.count {
            let expectedNext = calendar.date(byAdding: .day, value: 1, to: days[index - 1])
            if let expectedNext, calendar.isDate(expectedNext, inSameDayAs: days[index]) {
                current += 1
            } else {
                current = 1
            }
            longest = max(longest, current)
        }
        return longest
    }

    /// Every §4c stat this app can show without an account: `context` supplies the same
    /// pieces/passages `PieceReadiness` already reads, so "pieces performance-ready" agrees exactly
    /// with what the Data screen's own readiness list calls ready.
    public static func localStats(state: LibraryState, context: RuleContext) -> LocalProfileStats {
        let readyPieceCount = state.pieces.filter { $0.status != .resting }
            .compactMap { PieceReadiness.evaluate(pieceID: $0.id, context: context) }
            .filter { $0.state == .performanceReady }
            .count
        let totalSeconds = state.sessions.reduce(0) { $0 + $1.activeSeconds }
        return LocalProfileStats(currentStreakDays: state.rewardsState.streakDays,
                                  longestStreakDays: longestStreakDays(state: state, calendar: context.calendar),
                                  totalActiveSeconds: totalSeconds,
                                  performanceReadyPieceCount: readyPieceCount,
                                  rank: state.rewardsState.rank, division: state.rewardsState.division,
                                  badgeCount: state.badges.count)
    }
}
