import Foundation

/// Today's status readouts (§15): due reviews, upcoming performances with countdowns, and daily
/// streak status. Pure reads over `RuleContext`/`RewardsState` — nothing here mutates the store or
/// fires a loggable `Decision`; Today displays these, it does not ask the player to accept/override
/// them (that one-tap-override surface belongs to the practice HUD, a different track's scope — see
/// "(C) Rules Engine.md").
public enum TodayOverview {
    /// A readout over saved dates and the pianist's latest cold report. Urgency changes ordering
    /// and copy only; being late never creates a Missed grade or changes the review ladder.
    public struct DueReview: Identifiable, Equatable, Sendable {
        public var id: UUID { passageID }
        public var passageID: UUID
        public var pieceID: UUID
        public var dueDate: Date?
        public var inFinalWeek: Bool
        public var overdueDays: Int
        public var isDue: Bool
        public var latestColdGrade: ColdGradeRecord?
        public var isTough: Bool { latestColdGrade.map { $0.grade != .clean } ?? false }
        public var isUrgent: Bool { overdueDays > 0 || (isDue && isTough) }
        public var label: String {
            if overdueDays > 0 { return "URGENT · \(PracticeRulesEngine.pluralize(overdueDays, "day")) overdue" }
            if isDue && isTough { return "URGENT · Tough passage due" }
            if inFinalWeek { return "Performance week · Review" }
            return isDue ? "Due today" : "Tough passage"
        }
        public var reason: String {
            let report = latestColdGrade.map { "Your last first attempt: \($0.grade.label)." }
            if let report { return report }
            return inFinalWeek ? "Your performance is within the final week." : "Your saved review date has arrived."
        }
    }

    /// Includes Learning passages after a lapse, as well as Review/PerformanceReady. A passage's
    /// due date survives skipping a session. Resting pieces, archived/deleted passages and parked
    /// passages are left off the actionable queue, matching the session builder.
    public static func dueReviews(context: RuleContext) -> [DueReview] {
        reviewStatuses(context: context).filter(\.isDue)
    }

    /// Latest self-reported Missed/Shaky cold checks remain visible until a later Clean cold check.
    /// They may have a future review date: surfacing them does not bring that date forward.
    public static func toughPassages(context: RuleContext) -> [DueReview] {
        reviewStatuses(context: context).filter(\.isTough)
    }

    private static func reviewStatuses(context: RuleContext) -> [DueReview] {
        let today = context.calendar.startOfDay(for: context.now)
        let pieces = Dictionary(context.pieces.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let finalWeekPieceIDs = Set(context.pieces.compactMap { piece -> UUID? in
            guard let decision = PracticeRulesEngine.evaluateR11PerformanceDate(pieceID: piece.id, context: context),
                  case let .performanceCaps(_, _, _, inFinalWeek) = decision.outcome, inFinalWeek else { return nil }
            return piece.id
        })
        var latestGrades: [UUID: ColdGradeRecord] = [:]
        for grade in context.coldGrades where grade.date <= context.now {
            if grade.date > (latestGrades[grade.passageID]?.date ?? .distantPast) { latestGrades[grade.passageID] = grade }
        }
        let values = context.passages.compactMap { passage -> DueReview? in
            guard !passage.archived, passage.deletedAt == nil,
                  let piece = pieces[passage.pieceID], piece.status != .resting, piece.deletedAt == nil,
                  passage.parkedUntil.map({ $0 <= context.now }) ?? true else { return nil }
            let finalWeek = finalWeekPieceIDs.contains(passage.pieceID)
            let dueDay = passage.schedule.dueDate.map { context.calendar.startOfDay(for: $0) }
            let overdue = dueDay.map { max(0, context.calendar.dateComponents([.day], from: $0, to: today).day ?? 0) } ?? 0
            return DueReview(passageID: passage.id, pieceID: passage.pieceID, dueDate: passage.schedule.dueDate,
                             inFinalWeek: finalWeek, overdueDays: overdue,
                             isDue: finalWeek || (dueDay.map { $0 <= today } ?? false), latestColdGrade: latestGrades[passage.id])
        }
        // Stable ties preserve the library order. Overdue dates come first, then due tough spots,
        // then approaching performances. This is a transparent queue preference, not a diagnosis.
        return values.enumerated().sorted { left, right in
            let a = left.element, b = right.element
            if a.isUrgent != b.isUrgent { return a.isUrgent }
            if a.overdueDays != b.overdueDays { return a.overdueDays > b.overdueDays }
            if a.inFinalWeek != b.inFinalWeek { return a.inFinalWeek }
            if a.isTough != b.isTough { return a.isTough }
            func performanceDate(_ value: DueReview) -> Date {
                pieces[value.pieceID]?.performanceDates.filter { context.calendar.startOfDay(for: $0) >= today }.min() ?? .distantFuture
            }
            if performanceDate(a) != performanceDate(b) { return performanceDate(a) < performanceDate(b) }
            if a.dueDate != b.dueDate { return (a.dueDate ?? .distantFuture) < (b.dueDate ?? .distantFuture) }
            return left.offset < right.offset
        }.map(\.element)
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
