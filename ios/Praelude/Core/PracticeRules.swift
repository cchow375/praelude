import Foundation

/// What a practice set is for (§10b); non-tempo goals default the metronome off.
public enum SetGoal: String, Codable, CaseIterable, Sendable {
    case tempo, notesAndAccuracy, phrasing, dynamics, memory, partsCoordination, other
}

/// The fifteen practice rules (§11), identified stably for `RuleSettings` and `RuleEvent`.
public enum RuleID: String, Codable, CaseIterable, Sendable {
    case r1SmallChunks, r2JoinSeams, r3ColdAttempt, r4SpacedReview, r5StreakGoal, r6SlowDown, r7SpeedUp,
         r8SplitWeakSpot, r9StopGrinding, r10PerformanceReady, r11PerformanceDate, r12VariantsWhenStuck,
         r13PartsSeparately, r14PulseCheck, r15SessionBuilder
}

/// One append-only firing of a rule (§11): "one-line reason when fire, one-tap override, overrides
/// logged". Never edited after creation, so no `updatedAt`/`deletedAt` — replicas merge by union.
public struct RuleEvent: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var ruleID: RuleID
    public var pieceID: UUID?
    public var passageID: UUID?
    public var reasonText: String
    public var firedAt: Date
    public var overridden: Bool
    public init(id: UUID = UUID(), ruleID: RuleID, pieceID: UUID? = nil, passageID: UUID? = nil,
                reasonText: String, firedAt: Date = Date(), overridden: Bool = false) {
        self.id = id; self.ruleID = ruleID; self.pieceID = pieceID; self.passageID = passageID
        self.reasonText = reasonText; self.firedAt = firedAt; self.overridden = overridden
    }
}

/// Every rule's enable toggle and tunable parameters, defaulted to the spec's flagged values.
/// A single settings record edited directly by the player: whole-record last-write-wins is the
/// right sync granularity here (see "(C) Schema3.md" for the field-level-vs-record-level rationale).
public struct RuleSettings: Codable, Equatable, Sendable {
    // R1 small chunks: a box over ~2 systems (or this many measures) is offered a split.
    public var r1Enabled = true
    public var r1MaxMeasures = 4
    public var r1MaxSystems = 2.0
    // R2 join the seams: two neighboring Review passages may be offered as one joined passage.
    public var r2Enabled = true
    // R3 cold attempt: the first attempt of the day is graded Clean/Shaky/Missed and drives R4.
    public var r3Enabled = true
    // R4 spaced review: Clean grows the gap along this ladder; Shaky/Missed reset it.
    public var r4Enabled = true
    public var r4CleanIntervalsDays = [1, 3, 7, 14, 30]
    public var r4ShakyIntervalDays = 2
    // R5 streak goal by learning state.
    public var r5Enabled = true
    public var r5LearningStreak = 5
    public var r5ReviewStreak = 3
    // R6 slow down after resets without reaching half the goal.
    public var r6Enabled = true
    public var r6ResetsBeforeStepDown = 3
    public var r6StepDownPercent = 6.0
    // R7 speed up on a finished set, bounded per day.
    public var r7Enabled = true
    public var r7MaxIncreasesPerDay = 2
    // R8 split weak spot after clustered break-point taps.
    public var r8Enabled = true
    public var r8TapsToOfferSplit = 3
    // R9 stop grinding: park the passage after time or sets without progress.
    public var r9Enabled = true
    public var r9Minutes = 10
    public var r9Sets = 3
    // R10 performance-ready: clean cold attempts at performance tempo on distinct days.
    public var r10Enabled = true
    public var r10DistinctDays = 3
    public var r10RequiresFirstInSession = true
    // R11 performance date: cap review intervals as the date approaches.
    public var r11Enabled = true
    public var r11FinalWeekDays = 7
    public var r11FinalTwoWeeksDays = 14
    // R12 suggest a variant chain after repeated same-day slow-downs.
    public var r12Enabled = true
    public var r12SlowDownsPerDay = 2
    // R13 suggest parts separately after consecutive missed cold attempts.
    public var r13Enabled = true
    public var r13ConsecutiveMissed = 2
    // R14 pulse check: the metronome drops out for this many bars near target tempo.
    public var r14Enabled = true
    public var r14DropoutBars = 2
    // R15 session builder: caps new passages introduced in one session.
    public var r15Enabled = true
    public var r15MaxNewPerSession = 3
    public var updatedAt: Date = Date()
    public init() {}
}
