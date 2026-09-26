import Foundation

/// One append-only coin/xp award (§14). Honesty: deltas are non-negative by construction and
/// `PracticeStore.validate` rejects a negative entry, so Sloppy (or anything else) can never be
/// modeled as a penalty here — only completed reps/sets, on-time reviews and performance-ready
/// passages ever append an entry. Never edited after creation; replicas merge by union.
public struct RewardLedgerEntry: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var date: Date
    public var coinsDelta: Int
    public var xpDelta: Int
    public var reason: String
    public init(id: UUID = UUID(), date: Date = Date(), coinsDelta: Int = 0, xpDelta: Int = 0, reason: String) {
        self.id = id; self.date = date; self.coinsDelta = coinsDelta; self.xpDelta = xpDelta; self.reason = reason
    }
}

/// A stable, extensible slug (e.g. "thirty_days_on_time") rather than a closed enum, so new badges
/// never require another Core change. Never edited after creation.
public struct Badge: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var key: String
    public var earnedAt: Date
    public init(id: UUID = UUID(), key: String, earnedAt: Date = Date()) {
        self.id = id; self.key = key; self.earnedAt = earnedAt
    }
}

/// An append-only record of a celebration-worthy moment (passage/piece ready, new rank, streak
/// milestone), for the feed and for "never celebrate mid-set" bookkeeping.
public struct MilestoneEvent: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var kind: String
    public var date: Date
    public var detail: String
    public init(id: UUID = UUID(), kind: String, date: Date = Date(), detail: String = "") {
        self.id = id; self.kind = kind; self.date = date; self.detail = detail
    }
}

/// Current standing (§14), derived by a future rewards engine from `rewardLedger` history and kept
/// here as the fast-path snapshot the UI reads. A single settings-like record: record-level
/// last-write-wins.
public struct RewardsState: Codable, Equatable, Sendable {
    public var rank: String = "Unranked"
    public var division: Int = 1
    public var streakDays: Int = 0
    public var streakFreezesAvailable: Int = 0
    public var lastPracticeDate: Date?
    public var updatedAt: Date = Date()
    public init() {}
}
