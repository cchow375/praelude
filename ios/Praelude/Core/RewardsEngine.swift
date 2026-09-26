import Foundation

/// Qualifying reward-earning events (§14): "coins/progress only from completed reps/sets, on-time
/// reviews, performance-ready passages... Sloppy never punished." `RewardsEngine.ledgerEntry(for:)`
/// is the only place a `RewardLedgerEntry` gets built, and every branch is a fixed, non-negative
/// amount — there is no event here, or anywhere, that can construct a penalty. `PracticeStore
/// .validate` separately rejects a negative delta structurally (see "(C) Schema3.md" §Honesty).
public enum RewardEvent: Equatable, Sendable {
    case completedRep, completedSet, onTimeReview, performanceReadyPassage, pieceFullyReady
}

/// How loudly a moment should be celebrated (§14: "Big celebrations... small for set completion,
/// never mid-set"). `RewardsRuntime` is the only caller that turns `.big` into the full-screen
/// `CelebrationOverlayView`; `.small` reuses the existing set/chain completion tone
/// (`FeedbackService`) rather than a second, competing sound.
public enum CelebrationTier: Equatable, Sendable { case none, small, big }

/// A stable slug for `MilestoneEvent.kind`, plus the copy a celebration overlay/feed row shows.
public enum MilestoneKind: String, CaseIterable, Sendable {
    case passageReady = "passage_performance_ready"
    case pieceReady = "piece_fully_ready"
    case rankUp = "rank_up"
    case streakMilestone = "streak_milestone"

    public func detail(_ context: String) -> String {
        switch self {
        case .passageReady: return "\(context) is performance-ready."
        case .pieceReady: return "\(context) is fully ready."
        case .rankUp: return "New rank: \(context)."
        case .streakMilestone: return "\(context)-day streak."
        }
    }
}

public enum RewardsEngine {
    // MARK: - Coins/XP

    public static func ledgerEntry(for event: RewardEvent, at date: Date = Date()) -> RewardLedgerEntry {
        let coins: Int, xp: Int, reason: String
        switch event {
        case .completedRep: coins = 1; xp = 1; reason = "Completed repetition"
        case .completedSet: coins = 5; xp = 10; reason = "Completed set"
        case .onTimeReview: coins = 8; xp = 15; reason = "Reviewed on time"
        case .performanceReadyPassage: coins = 20; xp = 40; reason = "Passage performance-ready"
        case .pieceFullyReady: coins = 100; xp = 200; reason = "Piece fully ready"
        }
        return RewardLedgerEntry(date: date, coinsDelta: coins, xpDelta: xp, reason: reason)
    }

    public static func celebrationTier(for event: RewardEvent) -> CelebrationTier {
        switch event {
        case .completedRep, .onTimeReview: return .none
        case .completedSet: return .small
        case .performanceReadyPassage, .pieceFullyReady: return .big
        }
    }

    // MARK: - Rank & division
    //
    // Ported from the Mac's Studio economy (`src-tauri/src/store/studio/progress.rs`: `rank_start`,
    // its per-division requirement, and its ten rank names) so a musician who has used the Mac
    // recognizes the same ladder here. The honesty improvement is upstream of this: the Mac derives
    // its `total_xp` straight from raw focused-seconds/session counting, where this app instead
    // grows a discrete, auditable `rewardLedger` (see `ledgerEntry` above) and only *this* math —
    // turning a total XP number into a rank/division — is reused verbatim.

    public static let rankNames = ["Prelude", "Etude", "Arabesque", "Nocturne", "Scherzo",
                                   "Sonata", "Rhapsody", "Concerto", "Cadenza", "Opus"]

    public static func rankName(_ rank: Int) -> String {
        let index = rank - 1
        if index >= 0, index < rankNames.count { return rankNames[index] }
        return rank < 1 ? rankNames[0] : "Encore \(rank - rankNames.count)"
    }

    /// Total XP required to *start* `rank` (1-based). Ported formula: `250 * (rank-1) * (rank+2)`.
    static func rankStartXP(_ rank: Int) -> Int { 250 * (rank - 1) * (rank + 2) }
    /// XP required per division within `rank`. Ported formula: `100 + 50 * (rank-1)`.
    static func divisionXPRequired(_ rank: Int) -> Int { 100 + 50 * (rank - 1) }

    public struct RankProgress: Equatable, Sendable {
        public let rank: Int
        public let rankName: String
        public let division: Int
        public let divisionXP: Int
        public let divisionXPRequired: Int
    }

    /// Ported binary search over the monotonically increasing `rankStartXP`.
    public static func rankProgress(totalXP: Int) -> RankProgress {
        let totalXP = max(0, totalXP)
        var low = 1, high = 100_000
        while low < high {
            let middle = low + (high - low + 1) / 2
            if rankStartXP(middle) <= totalXP { low = middle } else { high = middle - 1 }
        }
        let remaining = totalXP - rankStartXP(low)
        let required = divisionXPRequired(low)
        return RankProgress(rank: low, rankName: rankName(low), division: remaining / required + 1,
                             divisionXP: remaining % required, divisionXPRequired: required)
    }

    // MARK: - Streak (§14: "Daily practice streak (15 min or 1 set counts), earnable streak freezes")

    public static let streakQualifyingMinutes = 15.0
    /// Every 7-day extension earns one freeze, capped so a freeze stays a rare save, not a currency.
    public static let maxStreakFreezes = 3

    public static func dayQualifies(focusedSeconds: TimeInterval, completedSets: Int) -> Bool {
        focusedSeconds >= streakQualifyingMinutes * 60 || completedSets >= 1
    }

    /// Commits a qualifying day's streak progress. Call only once `dayQualifies` is true for `today`
    /// — a non-qualifying day is never written here, so a later call the same day (once the player
    /// crosses the bar) always measures the gap against the same, still-accurate `lastPracticeDate`;
    /// see `currentStreakDisplay` for the safe-to-call-anytime read side of this split.
    public static func recordQualifyingDay(_ state: RewardsState, today: Date, calendar: Calendar = .current) -> RewardsState {
        var state = state
        let todayStart = calendar.startOfDay(for: today)
        guard let last = state.lastPracticeDate.map({ calendar.startOfDay(for: $0) }) else {
            state.streakDays = 1; state.lastPracticeDate = today
            return state
        }
        let gap = calendar.dateComponents([.day], from: last, to: todayStart).day ?? Int.max
        switch gap {
        case ..<1:
            break // already recorded today, or the clock moved backward: leave the count untouched
        case 1:
            extend(&state, today: today)
        case 2 where state.streakFreezesAvailable > 0:
            state.streakFreezesAvailable -= 1
            extend(&state, today: today)
        default:
            state.streakDays = 1; state.lastPracticeDate = today
        }
        return state
    }

    private static func extend(_ state: inout RewardsState, today: Date) {
        state.streakDays += 1
        state.lastPracticeDate = today
        if state.streakDays % 7 == 0 { state.streakFreezesAvailable = min(maxStreakFreezes, state.streakFreezesAvailable + 1) }
    }

    /// Read-only "as of now" display: zero once the grace window (and any available freeze) has
    /// genuinely lapsed, without writing anything, so a view may call this on every render.
    public static func currentStreakDisplay(_ state: RewardsState, asOf date: Date = Date(), calendar: Calendar = .current) -> Int {
        guard let last = state.lastPracticeDate.map({ calendar.startOfDay(for: $0) }) else { return 0 }
        let gap = calendar.dateComponents([.day], from: last, to: calendar.startOfDay(for: date)).day ?? Int.max
        if gap <= 1 { return state.streakDays }
        if gap == 2, state.streakFreezesAvailable > 0 { return state.streakDays }
        return 0
    }

    public static func isStreakMilestone(_ streakDays: Int) -> Bool { [7, 14, 30, 60, 100, 200, 365].contains(streakDays) }

    // MARK: - Badges (§14: extensible, code-defined conditions over already-recorded state)

    public struct BadgeDefinition: Sendable { public let key: String; public let title: String; public let detail: String }

    public static let badgeCatalog: [BadgeDefinition] = [
        BadgeDefinition(key: "first_set", title: "First set", detail: "Completed your first practice set."),
        BadgeDefinition(key: "streak_7", title: "First week", detail: "A 7-day practice streak."),
        BadgeDefinition(key: "streak_30", title: "Thirty days", detail: "A 30-day practice streak, reviews on time."),
        BadgeDefinition(key: "first_performance_ready", title: "Stage ready", detail: "Your first performance-ready passage."),
        BadgeDefinition(key: "all_keys_month", title: "All twelve keys", detail: "Warmed up in all 12 keys within a month."),
    ]

    /// Pure evaluation over already-recorded state; never mutates anything. Callers persist a newly
    /// earned key with `PracticeStore.awardBadge`, after skipping whatever `alreadyEarned` already has.
    public static func evaluateBadges(history: [ActiveSet], passages: [Passage], warmups: [WarmupExercise],
                                       streakDays: Int, alreadyEarned: Set<String>, asOf now: Date = Date()) -> [String] {
        var earned: [String] = []
        func award(_ key: String) { if !alreadyEarned.contains(key) { earned.append(key) } }
        if history.contains(where: { $0.status == .completed }) { award("first_set") }
        if streakDays >= 7 { award("streak_7") }
        if streakDays >= 30 { award("streak_30") }
        if passages.contains(where: { $0.learningState == .performanceReady }) { award("first_performance_ready") }
        let monthAgo = now.addingTimeInterval(-30 * 24 * 60 * 60)
        let keysThisMonth = Set(warmups.filter { ($0.lastUsedAt ?? .distantPast) >= monthAgo && $0.deletedAt == nil }.map(\.key))
        if Set(WarmupCatalog.circleOfFifths).isSubset(of: keysThisMonth) { award("all_keys_month") }
        return earned
    }
}
