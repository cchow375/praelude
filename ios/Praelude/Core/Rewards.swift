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
///
/// `pieceID`/`passageID` identify the source of a passage/piece-readiness milestone so a later
/// scan for "has this already been celebrated" can match by stable id instead of by `detail` text,
/// which is free-form display copy and not guaranteed unique (two different passages can share a
/// generic title like "mm. 1–4"). Both are plain `Optional`s on a struct with no custom `Codable`
/// implementation, so an already-stored event missing either key decodes it as `nil` for free — no
/// migration needed — and, like every other append-only log's foreign key in this file, neither is
/// checked for existence in `PracticeStore.validate`: a milestone must outlive whatever it
/// happened to point to (`deletePassage` still hard-removes), never block the library from loading.
public struct MilestoneEvent: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var kind: String
    public var date: Date
    public var detail: String
    public var pieceID: UUID?
    public var passageID: UUID?
    public init(id: UUID = UUID(), kind: String, date: Date = Date(), detail: String = "",
                pieceID: UUID? = nil, passageID: UUID? = nil) {
        self.id = id; self.kind = kind; self.date = date; self.detail = detail
        self.pieceID = pieceID; self.passageID = passageID
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
