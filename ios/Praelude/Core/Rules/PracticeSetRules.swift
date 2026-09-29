import Foundation

/// R5's verdict → streak effect, kept as its own small enum rather than three magic-string cases
/// scattered through callers: exactly the vocabulary "(C) Rules Engine.md" and `r5StreakEffect(for:)`
/// use.
public enum StreakEffect: Equatable, Sendable { case increments, resets, neutral }

/// R5 streak targets, R6 slow down, R7 speed up, R12 variants when stuck, R14 pulse check — the
/// rules that read a practice set (live or just-finished) rather than a passage's long-term schedule.
extension PracticeRulesEngine {
    // MARK: - R5 streak goal by state

    /// R5 (§11): the goal streak by learning state — 5 while still Learning, 3 once in Review. A
    /// still-`.new` passage uses the Learning target (its very first cold grade is what moves it out
    /// of New; see R4/`advanceSchedule`), and a PerformanceReady passage keeps the Review target
    /// (maintaining an already-ready passage is the same steady state as Review).
    public static func r5StreakTarget(for learningState: LearningState, settings: RuleSettings) -> Int {
        switch learningState {
        case .new, .learning: return settings.r5LearningStreak
        case .review, .performanceReady: return settings.r5ReviewStreak
        }
    }

    public static func evaluateR5StreakTarget(passageID: UUID, context: RuleContext) -> Decision? {
        guard context.settings.r5Enabled,
              let passage = context.passages.first(where: { $0.id == passageID }), !passage.archived else { return nil }
        let target = r5StreakTarget(for: passage.learningState, settings: context.settings)
        let stateLabel = (passage.learningState == .review || passage.learningState == .performanceReady) ? "Review" : "Learning"
        return Decision(ruleID: .r5StreakGoal, pieceID: passage.pieceID, passageID: passageID,
                         reason: "\(stateLabel): streak to \(target).", firedAt: context.now, outcome: .streakTarget(target))
    }

    /// R5's "Sloppy resets; Again neutral": the documented source of truth for what each verdict
    /// does to a streak. `PracticeEngine.project` (the pre-existing practice-loop replay, outside
    /// this track) currently zeroes the streak on `.again` too whenever a set has no variant stages —
    /// a pre-existing mismatch with this rule; see "(C) Rules Engine.md" for why it is left for
    /// whichever track owns that wiring rather than changed here.
    public static func r5StreakEffect(for verdict: Verdict) -> StreakEffect {
        switch verdict {
        case .clean: return .increments
        case .sloppy, .reset: return .resets
        case .again: return .neutral
        }
    }

    // MARK: - R6 slow down

    /// R6 (§11): "3 resets in a row without half the goal." Replays `set`'s own attempts (undone ones
    /// excluded), tracking the in-progress streak toward that attempt's own stage goal: a Sloppy or
    /// manual Reset zeroes it and records the streak's peak (paired with the goal it was chasing)
    /// just before the zeroing (Again is neutral, per R5, and does nothing here); reaching that goal
    /// clears the "in a row" list entirely, since only *consecutive* failures with no intervening
    /// success should count toward the three. Fires when the most recent `r6ResetsBeforeStepDown`
    /// such resets each peaked below half of *their own* goal, and steps the tempo down by
    /// `r6StepDownPercent` (a percent-based tempo ladder) or by one fixed ladder step (a fixed-amount
    /// ladder) — the spec's "~6% or ladder step" mapped onto whichever `TempoStep` the set is already
    /// configured with.
    ///
    /// Each attempt's own goal is looked up from `attempt.stageIndex` (stamped by the store at record
    /// time) rather than assumed to be the set's *current* `requiredCount`: a variant chain (§10b)
    /// gives every stage its own `targetCount`, and a stage transition only ever happens by reaching
    /// that stage's goal, so replaying every historical attempt against one constant (the current,
    /// possibly later, stage's goal) could fail to recognize an earlier stage's own graduation as
    /// progress, or judge an earlier peak against the wrong half.
    public static func evaluateR6SlowDown(set: ActiveSet, context: RuleContext) -> Decision? {
        guard context.settings.r6Enabled, let passageID = set.configuration.passageID,
              let passage = context.passages.first(where: { $0.id == passageID }) else { return nil }
        func goal(atStage index: Int) -> Int {
            set.configuration.stages.indices.contains(index) ? set.configuration.stages[index].targetCount : set.configuration.targetCount
        }
        var streak = 0
        var peaksSinceProgress: [(streak: Int, goal: Int)] = []
        for attempt in set.attempts where attempt.undoneAt == nil {
            let stageGoal = goal(atStage: attempt.stageIndex)
            switch attempt.verdict {
            case .clean:
                streak += 1
                if streak >= stageGoal { peaksSinceProgress = []; streak = 0 }
            case .sloppy, .reset:
                peaksSinceProgress.append((streak, stageGoal)); streak = 0
            case .again:
                break
            }
        }
        let threshold = context.settings.r6ResetsBeforeStepDown
        guard peaksSinceProgress.count >= threshold else { return nil }
        let recent = peaksSinceProgress.suffix(threshold)
        guard recent.allSatisfy({ Double($0.streak) < Double($0.goal) / 2 }) else { return nil }
        let newBPM: Double
        switch set.configuration.tempoStep {
        case .percent: newBPM = max(1, (set.currentBPM * (1 - context.settings.r6StepDownPercent / 100)).rounded())
        case .fixed(let amount): newBPM = max(1, set.currentBPM - amount)
        }
        return Decision(ruleID: .r6SlowDown, pieceID: passage.pieceID, passageID: passageID,
                         reason: "\(pluralize(threshold, "reset")) under half the goal. Down to \(Int(newBPM)).",
                         firedAt: context.now, outcome: .tempoChange(newBPM: newBPM))
    }

    // MARK: - R7 speed up

    /// R7 (§11): once a set on this passage has finished today (reached `.completed`) at its current
    /// target, the next set is offered one tempo step closer to the passage's performance tempo,
    /// capped at `r7MaxIncreasesPerDay` *applied* increases per passage per day — counted from
    /// `context.ruleEvents` where `overridden == false`, since a declined suggestion never actually
    /// raised the tempo and so should not count against the cap.
    public static func evaluateR7SpeedUp(passageID: UUID, context: RuleContext) -> Decision? {
        guard context.settings.r7Enabled,
              let passage = context.passages.first(where: { $0.id == passageID }), !passage.archived,
              let performanceTempo = passage.performanceTempo else { return nil }
        let todaysSets = allSets(forPassage: passageID, context: context)
            .filter { context.calendar.isDate($0.startedAt, inSameDayAs: context.now) }
        guard let lastCompleted = todaysSets.last(where: { $0.status == .completed }) else { return nil }
        guard lastCompleted.currentBPM < performanceTempo else { return nil }
        let increasesToday = context.ruleEvents.filter {
            $0.ruleID == .r7SpeedUp && $0.passageID == passageID && !$0.overridden
                && context.calendar.isDate($0.firedAt, inSameDayAs: context.now)
        }.count
        guard increasesToday < context.settings.r7MaxIncreasesPerDay else { return nil }
        let newBPM = lastCompleted.configuration.tempoStep.next(after: lastCompleted.currentBPM, target: performanceTempo)
        guard newBPM > lastCompleted.currentBPM else { return nil }
        return Decision(ruleID: .r7SpeedUp, pieceID: passage.pieceID, passageID: passageID,
                         reason: "Nice work. Up to \(Int(newBPM)) next time.", firedAt: context.now,
                         outcome: .tempoChange(newBPM: newBPM))
    }

    // MARK: - R12 variants when stuck

    /// R12 (§11): `r12SlowDownsPerDay` (default 2) *applied* R6 slow-downs today on this passage
    /// suggest building or resuming a variant chain instead of continuing to grind at tempo.
    public static func evaluateR12VariantsWhenStuck(passageID: UUID, context: RuleContext) -> Decision? {
        guard context.settings.r12Enabled,
              let passage = context.passages.first(where: { $0.id == passageID }), !passage.archived else { return nil }
        let slowDownsToday = context.ruleEvents.filter {
            $0.ruleID == .r6SlowDown && $0.passageID == passageID && !$0.overridden
                && context.calendar.isDate($0.firedAt, inSameDayAs: context.now)
        }.count
        guard slowDownsToday >= context.settings.r12SlowDownsPerDay else { return nil }
        return Decision(ruleID: .r12VariantsWhenStuck, pieceID: passage.pieceID, passageID: passageID,
                         reason: "\(pluralize(context.settings.r12SlowDownsPerDay, "slow-down")) today. Try a variant chain.",
                         firedAt: context.now, outcome: .suggestVariants)
    }

    // MARK: - R14 pulse check

    /// "Near target tempo" is not pinned by the spec: this engine's documented threshold is 90% of
    /// the passage's performance tempo. Lead-in/recovery bar counts are likewise undocumented by the
    /// spec and fixed here; only the dropout length itself (`r14DropoutBars`) is a tunable, per spec.
    public static let pulseCheckNearTempoFraction: Double = 0.9
    public static let pulseCheckLeadInBars = 4
    public static let pulseCheckRecoveryBars = 2

    public static func isPulseCheckEligible(set: ActiveSet, context: RuleContext) -> Bool {
        guard context.settings.r14Enabled, let passageID = set.configuration.passageID,
              let passage = context.passages.first(where: { $0.id == passageID }),
              let performanceTempo = passage.performanceTempo else { return false }
        return set.currentBPM >= performanceTempo * pulseCheckNearTempoFraction
    }

    /// R14: near performance tempo, offer a deterministic metronome dropout plan — lead in, go
    /// silent for `r14DropoutBars` bars, then resume — so the player checks their own internal pulse.
    public static func evaluateR14PulseCheck(set: ActiveSet, context: RuleContext) -> Decision? {
        guard isPulseCheckEligible(set: set, context: context), let passageID = set.configuration.passageID,
              let passage = context.passages.first(where: { $0.id == passageID }) else { return nil }
        let plan = PulseCheckPlan(leadInBars: pulseCheckLeadInBars, silentBars: context.settings.r14DropoutBars,
                                   recoveryBars: pulseCheckRecoveryBars)
        return Decision(ruleID: .r14PulseCheck, pieceID: passage.pieceID, passageID: passageID,
                         reason: "Near tempo. Metronome drops out for \(pluralize(context.settings.r14DropoutBars, "bar")).",
                         firedAt: context.now, outcome: .pulseCheck(plan))
    }
}
