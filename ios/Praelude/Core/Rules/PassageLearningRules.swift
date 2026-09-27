import Foundation

/// R3 cold grading, R4 spaced review, R10 performance-ready, R11 performance date — the rules that
/// move a passage through `LearningState` (New → Learning → Review → PerformanceReady) and its
/// `PassageSchedule`.
extension PracticeRulesEngine {
    // MARK: - R3 cold attempt

    /// R3: "the first attempt of the day on a passage before any work" — true exactly when no
    /// `ColdGradeRecord` has been logged yet for this passage on `context.now`'s calendar day.
    public static func isColdAttemptEligible(passageID: UUID, context: RuleContext) -> Bool {
        !context.coldGrades.contains { $0.passageID == passageID && context.calendar.isDate($0.date, inSameDayAs: context.now) }
    }

    /// R3 grades the day's first attempt; that grade immediately drives R4's schedule update, so
    /// both fire from this one call. Returns `nil` when R3 is disabled or the passage already has a
    /// cold grade today (§11: at most one cold attempt per passage per day).
    public static func applyColdGrade(passageID: UUID, grade: ColdGrade, tempo: Double, context: RuleContext) -> ColdGradeApplication? {
        guard context.settings.r3Enabled, isColdAttemptEligible(passageID: passageID, context: context),
              let passage = context.passages.first(where: { $0.id == passageID }) else { return nil }
        let record = ColdGradeRecord(passageID: passageID, date: context.now, grade: grade, tempo: tempo)
        let r3 = Decision(ruleID: .r3ColdAttempt, pieceID: passage.pieceID, passageID: passageID,
                           reason: "First attempt today: graded \(grade.label).", firedAt: context.now)
        guard context.settings.r4Enabled else {
            return ColdGradeApplication(record: record, newLearningState: passage.learningState,
                                         newSchedule: passage.schedule, decisions: [r3])
        }
        let (state, schedule, reason) = advanceSchedule(current: passage.learningState, schedule: passage.schedule,
                                                          grade: grade, settings: context.settings,
                                                          now: context.now, calendar: context.calendar)
        let r4 = Decision(ruleID: .r4SpacedReview, pieceID: passage.pieceID, passageID: passageID, reason: reason,
                           firedAt: context.now, outcome: .schedule(schedule, learningState: state))
        return ColdGradeApplication(record: record, newLearningState: state, newSchedule: schedule, decisions: [r3, r4])
    }

    // MARK: - R4 spaced review

    /// The state machine (§4/§11 R4): Clean climbs the configured ladder (default 1→3→7→14→30
    /// days), graduating New/Learning to Review once it reaches that ladder's third rung (7 days by
    /// default) — the spec names the four states and the five-step ladder but does not pin the
    /// exact crossover rung, so this is this engine's documented choice, guarded against a
    /// shorter custom ladder. Shaky reschedules at `r4ShakyIntervalDays` without losing ladder
    /// position (a quick recheck, not a lapse). Missed is a full lapse: back to Learning, due
    /// tomorrow, ladder restarts from its first rung next time.
    private static func advanceSchedule(current: LearningState, schedule: PassageSchedule, grade: ColdGrade,
                                         settings: RuleSettings, now: Date, calendar: Calendar) -> (LearningState, PassageSchedule, String) {
        switch grade {
        case .missed:
            let due = calendar.startOfDay(afterAdding: 1, to: now)
            return (.learning, PassageSchedule(dueDate: due, intervalDays: 1, reviewStep: 0),
                    "Missed. Back to Learning, due tomorrow.")
        case .shaky:
            let days = max(1, settings.r4ShakyIntervalDays)
            let due = calendar.startOfDay(afterAdding: days, to: now)
            let newState: LearningState = current == .new ? .learning : current
            return (newState, PassageSchedule(dueDate: due, intervalDays: days, reviewStep: schedule.reviewStep),
                    "Shaky. Review in \(pluralize(days, "day")).")
        case .clean:
            let intervals = settings.r4CleanIntervalsDays.sorted()
            guard !intervals.isEmpty else { return (current, schedule, "Clean, but no review ladder is configured.") }
            let stepIndex = min(max(0, schedule.reviewStep), intervals.count - 1)
            let days = intervals[stepIndex]
            let due = calendar.startOfDay(afterAdding: days, to: now)
            var newState = current
            if newState == .new { newState = .learning }
            let reviewThreshold = min(2, intervals.count - 1)
            if newState == .learning && stepIndex >= reviewThreshold { newState = .review }
            let newReviewStep = min(stepIndex + 1, intervals.count - 1)
            return (newState, PassageSchedule(dueDate: due, intervalDays: days, reviewStep: newReviewStep),
                    "Clean. Next review in \(pluralize(days, "day")).")
        }
    }

    // MARK: - R10 performance-ready

    /// R10: clean cold at (or above) performance tempo on `r10DistinctDays` different calendar days,
    /// including — when required — one where the qualifying cold grade was the first timestamped
    /// activity of that whole day (approximated from data: it precedes every other attempt and every
    /// other passage's cold grade logged that day; Core has no separate "session opened" event to
    /// check against). Requires `passage.performanceTempo` to be set.
    public static func evaluateR10PerformanceReady(passageID: UUID, context: RuleContext) -> Decision? {
        guard context.settings.r10Enabled, let passage = context.passages.first(where: { $0.id == passageID }),
              let performanceTempo = passage.performanceTempo else { return nil }
        let qualifying = context.coldGrades.filter {
            $0.passageID == passageID && $0.grade == .clean && $0.tempo >= performanceTempo
        }
        let distinctDays = Set(qualifying.map { context.calendar.startOfDay(for: $0.date) })
        guard distinctDays.count >= context.settings.r10DistinctDays else { return nil }
        if context.settings.r10RequiresFirstInSession {
            guard qualifying.contains(where: { isFirstLoggedActivity(of: $0, context: context) }) else { return nil }
        }
        return Decision(ruleID: .r10PerformanceReady, pieceID: passage.pieceID, passageID: passageID,
                         reason: "Clean at tempo on \(distinctDays.count) different days. Performance-ready.",
                         firedAt: context.now, outcome: .performanceReady)
    }

    private static func isFirstLoggedActivity(of grade: ColdGradeRecord, context: RuleContext) -> Bool {
        let otherColdGrades = context.coldGrades
            .filter { $0.id != grade.id && context.calendar.isDate($0.date, inSameDayAs: grade.date) }
            .map(\.date)
        let attemptDates = (context.history + [context.activeSet].compactMap { $0 })
            .flatMap(\.attempts)
            .filter { $0.undoneAt == nil && context.calendar.isDate($0.date, inSameDayAs: grade.date) }
            .map(\.date)
        return (otherColdGrades + attemptDates).allSatisfy { grade.date <= $0 }
    }

    // MARK: - R11 performance date

    /// R11: within the final two weeks before a piece's nearest upcoming performance date, cap
    /// review intervals and add run-throughs; within the final week, treat every passage as due and
    /// flag any that are not yet performance-ready. The interval cap reuses R4's own ladder (its
    /// first rung within the final week, its second rung in the two weeks before that) rather than
    /// inventing a separate tunable.
    public static func evaluateR11PerformanceDate(pieceID: UUID, context: RuleContext) -> Decision? {
        guard context.settings.r11Enabled, let piece = context.pieces.first(where: { $0.id == pieceID }) else { return nil }
        let today = context.calendar.startOfDay(for: context.now)
        let upcomingDays = piece.performanceDates.map { context.calendar.startOfDay(for: $0) }.filter { $0 >= today }
        guard let performanceDay = upcomingDays.min() else { return nil }
        let daysUntil = context.calendar.dateComponents([.day], from: today, to: performanceDay).day ?? 0
        guard daysUntil <= context.settings.r11FinalTwoWeeksDays else { return nil }
        let intervals = context.settings.r4CleanIntervalsDays.sorted()
        let inFinalWeek = daysUntil <= context.settings.r11FinalWeekDays
        let cappedIntervalDays = inFinalWeek ? (intervals.first ?? 1) : (intervals.count > 1 ? intervals[1] : (intervals.first ?? 1))
        let piecePassages = context.passages.filter { $0.pieceID == pieceID && !$0.archived }
        let notReady = inFinalWeek ? piecePassages.filter { $0.learningState != .performanceReady }.map(\.id) : []
        let reason: String
        if inFinalWeek {
            reason = notReady.isEmpty
                ? "\(pluralize(daysUntil, "day")) out. Every passage due; run-throughs on."
                : "\(pluralize(daysUntil, "day")) out. \(pluralize(notReady.count, "passage")) not performance-ready."
        } else {
            reason = "Two weeks out. Run-throughs added; reviews capped at \(pluralize(cappedIntervalDays, "day"))."
        }
        return Decision(ruleID: .r11PerformanceDate, pieceID: pieceID, reason: reason, firedAt: context.now,
                         outcome: .performanceCaps(cappedIntervalDays: cappedIntervalDays, includeRunThroughs: true,
                                                    notReadyPassageIDs: notReady, inFinalWeek: inFinalWeek))
    }
}
