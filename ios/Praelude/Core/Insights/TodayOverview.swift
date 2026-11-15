import Foundation

/// Today's status readouts (§15): due reviews, upcoming performances with countdowns, and daily
/// streak status. Pure reads over `RuleContext`/`RewardsState` — nothing here mutates the store or
/// fires a loggable `Decision`; Today displays these, it does not ask the player to accept/override
/// them (that one-tap-override surface belongs to the practice HUD, a different track's scope — see
/// "(C) Rules Engine.md").
public enum TodayOverview {
    public enum ReviewPriority: Int, Equatable, Sendable {
        case recall, rebuild, scheduled, new
    }

    /// A passage's next action, derived only from saved work and the pianist's reports.
    /// Saved schedules remain untouched: a warm success earns a delayed check, never mastery.
    public struct DueReview: Identifiable, Equatable, Sendable {
        public var id: UUID { passageID }
        public var passageID: UUID
        public var pieceID: UUID
        public var dueDate: Date?
        public var inFinalWeek: Bool
        public var overdueDays: Int
        public var isDue: Bool
        public var latestColdGrade: ColdGradeRecord?
        public var priority: ReviewPriority = .scheduled
        public var nextActionDate: Date? = nil
        public var workedToday: Bool = false
        public var explanation: String = ""
        public var isTough: Bool { latestColdGrade.map { $0.grade != .clean } ?? false }
        public var isUrgent: Bool { priority == .recall || priority == .rebuild }
        public var label: String {
            switch priority {
            case .recall: return "Recall first"
            case .rebuild: return "Build again"
            case .scheduled: return inFinalWeek ? "Performance check" : "Check retention"
            case .new: return "Start learning"
            }
        }
        public var reason: String {
            if !explanation.isEmpty { return explanation }
            return "Play once before working on it, then report how it held."
        }
    }

    public struct DailyPassagePlan: Equatable, Sendable {
        public var items: [DueReview]
        public var completedToday: [DueReview]
        public var tomorrow: [DueReview]
        public var laterCount: Int
        public var dailyLimit: Int
    }

    /// A finite daily round. Every unique passage already worked today occupies a slot, including
    /// work started elsewhere. Finishing five does not silently refill the round with five more.
    /// The remaining library stays available for deliberate practice, without manufacturing debt.
    public static func dailyPlan(context: RuleContext, limit: Int = 5) -> DailyPassagePlan {
        let statuses = reviewStatuses(context: context)
        let completed = statuses.filter(\.workedToday)
        let allCandidates = statuses.filter { !$0.workedToday && ($0.isDue || $0.priority == .new) }
        var newCount = 0
        let candidates = allCandidates.filter { value in
            if value.priority == .new && !value.isDue {
                guard newCount < max(0, context.settings.r15MaxNewPerSession) else { return false }
                newCount += 1
            }
            return true
        }
        let boundedLimit = max(0, limit)
        let items = Array(candidates.prefix(max(0, boundedLimit - completed.count)))
        let tomorrowDay = context.calendar.startOfDay(afterAdding: 1, to: context.now)
        let tomorrow = statuses.filter {
            guard let action = $0.nextActionDate else { return false }
            return context.calendar.isDate(action, inSameDayAs: tomorrowDay)
        }
        return DailyPassagePlan(items: items, completedToday: completed, tomorrow: tomorrow,
                                laterCount: max(0, allCandidates.count - items.count), dailyLimit: boundedLimit)
    }

    /// Exhaustive actionable review list for the library. Today uses `dailyPlan`'s smaller round.
    /// A failed first check stays actionable until a meaningful set finishes. Completed work and
    /// successful first checks leave today's list, even during performance week.
    public static func dueReviews(context: RuleContext) -> [DueReview] {
        reviewStatuses(context: context).filter { $0.isDue && !$0.workedToday }
    }

    public static func toughPassages(context: RuleContext) -> [DueReview] {
        reviewStatuses(context: context).filter { $0.isTough && !$0.workedToday }
    }

    private struct CompletedWork {
        var set: ActiveSet
        var date: Date
    }

    private static func reviewStatuses(context: RuleContext) -> [DueReview] {
        let today = context.calendar.startOfDay(for: context.now)
        let tomorrow = context.calendar.startOfDay(afterAdding: 1, to: context.now)
        let pieces = Dictionary(context.pieces.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let finalWeekPieceIDs = Set(context.pieces.compactMap { piece -> UUID? in
            guard let decision = PracticeRulesEngine.evaluateR11PerformanceDate(pieceID: piece.id, context: context),
                  case let .performanceCaps(_, _, _, inFinalWeek) = decision.outcome, inFinalWeek else { return nil }
            return piece.id
        })
        var latestGrades: [UUID: ColdGradeRecord] = [:]
        for grade in context.coldGrades where grade.date <= context.now {
            let previous = latestGrades[grade.passageID]
            if previous == nil || grade.date > previous!.date ||
                (grade.date == previous!.date && grade.id.uuidString < previous!.id.uuidString) {
                latestGrades[grade.passageID] = grade
            }
        }
        // Replay completion so an undone final rep, an empty/stale completed flag, a merely ended
        // set or an unfinished active set cannot clear the round. Deduplicate the live/history ID.
        var sets: [UUID: ActiveSet] = [:]
        for set in context.history + [context.activeSet].compactMap({ $0 }) { sets[set.id] = set }
        var completedWork: [UUID: CompletedWork] = [:]
        for original in sets.values where original.status == .completed {
            guard let passageID = original.configuration.passageID,
                  original.attempts.allSatisfy({ $0.date <= context.now }),
                  let date = original.effectiveAttempts.map(\.date).max(),
                  PracticeEngine.project(original).status == .completed else { continue }
            let previous = completedWork[passageID]
            if previous == nil || date > previous!.date ||
                (date == previous!.date && original.id.uuidString < previous!.set.id.uuidString) {
                completedWork[passageID] = CompletedWork(set: original, date: date)
            }
        }
        let values = context.passages.compactMap { passage -> DueReview? in
            guard !passage.archived, passage.deletedAt == nil,
                  let piece = pieces[passage.pieceID], piece.status != .resting, piece.deletedAt == nil else { return nil }
            let grade = latestGrades[passage.id]
            let goal = PracticeRulesEngine.targetTempo(for: passage, context: context)
            // Keep the explicit comparison outside nested shorthand closures for clarity.
            let successfulCheck = grade.map { report in
                report.grade == .clean && (goal.map { report.tempo >= $0 } ?? true)
            } ?? false
            let checkedToday = grade.map { context.calendar.isDate($0.date, inSameDayAs: context.now) } ?? false
            let completed = completedWork[passage.id]
            let completedToday = completed.map { context.calendar.isDate($0.date, inSameDayAs: context.now) } ?? false
            // An unfinished failed check remains a task even if the old Shaky schedule points two
            // days away. Only work completed after that report can close its rebuilding step.
            let unresolvedCheck = !successfulCheck && grade.map { report in
                completed.map { $0.date < report.date } ?? true
            } == true
            let workedToday = (completedToday && !unresolvedCheck) || (checkedToday && successfulCheck)
            // A later-day first check resolves a warm practice recall. A later warm set creates
            // another recall only if it needed building/error correction or lacked an at-target check.
            var needsRecall = false
            var reachedTarget = false
            var failedAfterWork = false
            if let completed {
                let set = completed.set
                reachedTarget = set.configuration.basis == .cleanStreak &&
                    (goal.map { set.currentBPM >= $0 } ?? true)
                let successfulLaterDay = successfulCheck && grade.map {
                    context.calendar.startOfDay(for: $0.date) > context.calendar.startOfDay(for: completed.date)
                } == true
                failedAfterWork = !successfulCheck && grade.map { $0.date > completed.date } == true
                let sameDayCheckedAtTarget = successfulCheck && grade.map {
                    context.calendar.isDate($0.date, inSameDayAs: completed.date)
                } == true
                let rebuilt = set.configuration.startBPM < (goal ?? set.effectiveTargetBPM) ||
                    set.attempts.contains { $0.undoneAt == nil && $0.verdict == .sloppy }
                needsRecall = !successfulLaterDay && (!sameDayCheckedAtTarget || rebuilt || !reachedTarget)
            }
            let finalWeek = finalWeekPieceIDs.contains(passage.pieceID)
            let dueDay = passage.schedule.dueDate.map { context.calendar.startOfDay(for: $0) }
            let overdue = dueDay.map { max(0, context.calendar.dateComponents([.day], from: $0, to: today).day ?? 0) } ?? 0
            let parked = passage.parkedUntil.map { $0 > context.now } ?? false
            var priority: ReviewPriority = .scheduled
            var action = passage.schedule.dueDate
            var due = finalWeek || (dueDay.map { $0 <= today } ?? false)
            var reason = "Play once before working on it, then report how it held."
            if needsRecall, let completed {
                priority = reachedTarget && !failedAfterWork ? .recall : .rebuild
                action = context.calendar.startOfDay(afterAdding: 1, to: completed.date)
                due = action.map { $0 <= today } ?? false
                reason = failedAfterWork
                    ? "The later first check needed work. Rebuild comfortably, then check the target."
                    : reachedTarget
                        ? "You built this to target. Check it once before warming it up."
                        : "Your earlier work counted. Build comfortably, then check the target."
            } else if grade?.grade != .clean && grade != nil && due {
                priority = .rebuild
                reason = "Your last first attempt was \(grade!.grade.label). Start comfortably and rebuild."
            } else if passage.learningState == .new && grade == nil && completed == nil {
                priority = .new
                reason = "A new passage. Start slowly and learn a small, clear section."
            }
            if unresolvedCheck, let grade {
                priority = .rebuild
                action = checkedToday ? today : context.calendar.startOfDay(afterAdding: 1, to: grade.date)
                due = action.map { $0 <= today } ?? false
                reason = grade.grade == .clean
                    ? "Clean below target. Finish your practice set; check retention tomorrow."
                    : "The first check needed work. Finish a practice set, then return tomorrow."
            }
            if workedToday {
                due = false
                if completedToday && needsRecall {
                    action = tomorrow
                    reason = reachedTarget
                        ? "Work complete. Your first check tomorrow will test whether the target held."
                        : "Work complete. Return tomorrow to keep building toward target."
                }
            }
            if parked { due = false; if !workedToday { return nil } }
            return DueReview(passageID: passage.id, pieceID: passage.pieceID, dueDate: passage.schedule.dueDate,
                             inFinalWeek: finalWeek, overdueDays: overdue, isDue: due, latestColdGrade: grade,
                             priority: priority, nextActionDate: action, workedToday: workedToday, explanation: reason)
        }
        let performanceDates = Dictionary(context.pieces.map { piece in
            (piece.id, piece.performanceDates.filter { context.calendar.startOfDay(for: $0) >= today }.min() ?? .distantFuture)
        }, uniquingKeysWith: { min($0, $1) })
        let creationDates = Dictionary(context.passages.map { ($0.id, $0.createdAt) }, uniquingKeysWith: { min($0, $1) })
        return values.sorted { a, b in
            if a.priority != b.priority { return a.priority.rawValue < b.priority.rawValue }
            if a.priority == .recall {
                // Protect the next-day check earned yesterday from an accumulated recall backlog.
                // Older unresolved recalls remain actionable and retain oldest-first fairness.
                let firstDueTodayA = a.nextActionDate.map { context.calendar.isDate($0, inSameDayAs: today) } ?? false
                let firstDueTodayB = b.nextActionDate.map { context.calendar.isDate($0, inSameDayAs: today) } ?? false
                if firstDueTodayA != firstDueTodayB { return firstDueTodayA }
                if a.nextActionDate != b.nextActionDate {
                    return (a.nextActionDate ?? .distantFuture) < (b.nextActionDate ?? .distantFuture)
                }
            }
            if a.inFinalWeek != b.inFinalWeek { return a.inFinalWeek }
            if performanceDates[a.pieceID] != performanceDates[b.pieceID] {
                return (performanceDates[a.pieceID] ?? .distantFuture) < (performanceDates[b.pieceID] ?? .distantFuture)
            }
            if a.nextActionDate != b.nextActionDate { return (a.nextActionDate ?? .distantFuture) < (b.nextActionDate ?? .distantFuture) }
            if creationDates[a.passageID] != creationDates[b.passageID] {
                return (creationDates[a.passageID] ?? .distantFuture) < (creationDates[b.passageID] ?? .distantFuture)
            }
            return a.passageID.uuidString < b.passageID.uuidString
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
