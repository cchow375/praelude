import Foundation

/// Today's status readouts (§15): due reviews, upcoming performances with countdowns, and daily
/// streak status. Pure reads over `RuleContext`/`RewardsState` — nothing here mutates the store or
/// fires a loggable `Decision`; Today displays these, it does not ask the player to accept/override
/// them (that one-tap-override surface belongs to the practice HUD, a different track's scope — see
/// "(C) Rules Engine.md").
public enum TodayOverview {
    /// A due review: a Review/PerformanceReady passage whose own schedule says it's due, or any
    /// passage belonging to a piece R11 has flagged as being in its final week before a performance
    /// (R15 treats both the same way — see "(C) Rules Engine.md"'s R15/R11 section).
    public struct DueReview: Identifiable, Equatable, Sendable {
        public var id: UUID { passageID }
        public var passageID: UUID
        public var pieceID: UUID
        public var dueDate: Date?
        public var inFinalWeek: Bool
    }

    /// Every review-state (or performance-ready) passage that is due today or overdue, plus every
    /// passage of a piece in its final week (R11) — mirrors R15's own `isDue` filter exactly, so
    /// "due reviews" never disagrees with what a built session would actually offer.
    public static func dueReviews(context: RuleContext) -> [DueReview] {
        var finalWeekPieceIDs: Set<UUID> = []
        for piece in context.pieces {
            if let decision = PracticeRulesEngine.evaluateR11PerformanceDate(pieceID: piece.id, context: context),
               case let .performanceCaps(_, _, _, inFinalWeek) = decision.outcome, inFinalWeek {
                finalWeekPieceIDs.insert(piece.id)
            }
        }
        return context.passages.filter { passage in
            guard !passage.archived else { return false }
            guard passage.learningState == .review || passage.learningState == .performanceReady else { return false }
            if finalWeekPieceIDs.contains(passage.pieceID) { return true }
            guard let due = passage.schedule.dueDate else { return false }
            return due <= context.now
        }.map {
            DueReview(passageID: $0.id, pieceID: $0.pieceID, dueDate: $0.schedule.dueDate,
                      inFinalWeek: finalWeekPieceIDs.contains($0.pieceID))
        }
    }

    public struct UpcomingPerformance: Identifiable, Equatable, Sendable {
        public var id: UUID { pieceID }
        public var pieceID: UUID
        public var date: Date
        public var daysRemaining: Int
    }

    /// Every piece's nearest upcoming performance date (today or later), nearest first.
    public static func upcomingPerformances(context: RuleContext, limit: Int = 5) -> [UpcomingPerformance] {
        let today = context.calendar.startOfDay(for: context.now)
        let results: [UpcomingPerformance] = context.pieces.compactMap { piece in
            let nearest = piece.performanceDates.map { context.calendar.startOfDay(for: $0) }.filter { $0 >= today }.min()
            guard let nearest else { return nil }
            let days = context.calendar.dateComponents([.day], from: today, to: nearest).day ?? 0
            return UpcomingPerformance(pieceID: piece.id, date: nearest, daysRemaining: days)
        }.sorted { $0.date < $1.date }
        return Array(results.prefix(max(0, limit)))
    }

    public struct StreakStatus: Equatable, Sendable {
        public var currentDays: Int
        public var practicedToday: Bool
        public var freezesAvailable: Int
        /// One dry line, matching §3a copy: no exclamation points, no manufactured urgency.
        public var message: String
    }

    public static func streakStatus(rewardsState: RewardsState, calendar: Calendar, now: Date) -> StreakStatus {
        let practicedToday = rewardsState.lastPracticeDate.map { calendar.isDate($0, inSameDayAs: now) } ?? false
        let message: String
        if rewardsState.streakDays <= 0 {
            message = "No streak yet. Practice today to start one."
        } else if practicedToday {
            message = "\(PracticeRulesEngine.pluralize(rewardsState.streakDays, "day")) — today's practice counted."
        } else {
            message = "\(PracticeRulesEngine.pluralize(rewardsState.streakDays, "day")). Practice today to keep it."
        }
        return StreakStatus(currentDays: rewardsState.streakDays, practicedToday: practicedToday,
                             freezesAvailable: rewardsState.streakFreezesAvailable, message: message)
    }
}
