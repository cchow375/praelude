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
    /// Two taps "cluster" (§11 R8) when their normalized-page centers are within this distance of
    /// one another — see "(C) Rules Engine.md" for the full clustering definition.
    public var r8ClusterRadius = 0.06
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
    /// Minutes budgeted per warmup/review/learning/new item when R15 fits items into the available
    /// time; a run-through budgets a multiple of this (see "(C) Rules Engine.md").
    public var r15EstimatedMinutesPerItem = 3
    public var updatedAt: Date = Date()
    public init() {}

    // MARK: - Codable
    //
    // A hand-written `init(from:)` (schema3's own convention — see `Piece`/`Passage`/`LibraryState` in
    // Models.swift) rather than the synthesized one: Swift's synthesized `Decodable` requires every
    // key to be present, so a plain `= true`/`= 3` default is invisible to it. Without this, a future
    // build adding a field here — exactly what `r8ClusterRadius`/`r15EstimatedMinutesPerItem` just did —
    // would fail to decode any `library.json` written before that field existed, which is the one thing
    // this codebase must never do (see "never lose user data" in Schema3.md). `encode(to:)` stays
    // synthesized; only decoding needs the fallback.
    private enum CodingKeys: String, CodingKey {
        case r1Enabled, r1MaxMeasures, r1MaxSystems, r2Enabled, r3Enabled, r4Enabled, r4CleanIntervalsDays,
             r4ShakyIntervalDays, r5Enabled, r5LearningStreak, r5ReviewStreak, r6Enabled, r6ResetsBeforeStepDown,
             r6StepDownPercent, r7Enabled, r7MaxIncreasesPerDay, r8Enabled, r8TapsToOfferSplit, r8ClusterRadius,
             r9Enabled, r9Minutes, r9Sets, r10Enabled, r10DistinctDays, r10RequiresFirstInSession, r11Enabled,
             r11FinalWeekDays, r11FinalTwoWeeksDays, r12Enabled, r12SlowDownsPerDay, r13Enabled, r13ConsecutiveMissed,
             r14Enabled, r14DropoutBars, r15Enabled, r15MaxNewPerSession, r15EstimatedMinutesPerItem, updatedAt
    }
    public init(from decoder: Decoder) throws {
        let v = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = RuleSettings()
        r1Enabled = try v.decodeIfPresent(Bool.self, forKey: .r1Enabled) ?? defaults.r1Enabled
        r1MaxMeasures = try v.decodeIfPresent(Int.self, forKey: .r1MaxMeasures) ?? defaults.r1MaxMeasures
        r1MaxSystems = try v.decodeIfPresent(Double.self, forKey: .r1MaxSystems) ?? defaults.r1MaxSystems
        r2Enabled = try v.decodeIfPresent(Bool.self, forKey: .r2Enabled) ?? defaults.r2Enabled
        r3Enabled = try v.decodeIfPresent(Bool.self, forKey: .r3Enabled) ?? defaults.r3Enabled
        r4Enabled = try v.decodeIfPresent(Bool.self, forKey: .r4Enabled) ?? defaults.r4Enabled
        r4CleanIntervalsDays = try v.decodeIfPresent([Int].self, forKey: .r4CleanIntervalsDays) ?? defaults.r4CleanIntervalsDays
        r4ShakyIntervalDays = try v.decodeIfPresent(Int.self, forKey: .r4ShakyIntervalDays) ?? defaults.r4ShakyIntervalDays
        r5Enabled = try v.decodeIfPresent(Bool.self, forKey: .r5Enabled) ?? defaults.r5Enabled
        r5LearningStreak = try v.decodeIfPresent(Int.self, forKey: .r5LearningStreak) ?? defaults.r5LearningStreak
        r5ReviewStreak = try v.decodeIfPresent(Int.self, forKey: .r5ReviewStreak) ?? defaults.r5ReviewStreak
        r6Enabled = try v.decodeIfPresent(Bool.self, forKey: .r6Enabled) ?? defaults.r6Enabled
        r6ResetsBeforeStepDown = try v.decodeIfPresent(Int.self, forKey: .r6ResetsBeforeStepDown) ?? defaults.r6ResetsBeforeStepDown
        r6StepDownPercent = try v.decodeIfPresent(Double.self, forKey: .r6StepDownPercent) ?? defaults.r6StepDownPercent
        r7Enabled = try v.decodeIfPresent(Bool.self, forKey: .r7Enabled) ?? defaults.r7Enabled
        r7MaxIncreasesPerDay = try v.decodeIfPresent(Int.self, forKey: .r7MaxIncreasesPerDay) ?? defaults.r7MaxIncreasesPerDay
        r8Enabled = try v.decodeIfPresent(Bool.self, forKey: .r8Enabled) ?? defaults.r8Enabled
        r8TapsToOfferSplit = try v.decodeIfPresent(Int.self, forKey: .r8TapsToOfferSplit) ?? defaults.r8TapsToOfferSplit
        r8ClusterRadius = try v.decodeIfPresent(Double.self, forKey: .r8ClusterRadius) ?? defaults.r8ClusterRadius
        r9Enabled = try v.decodeIfPresent(Bool.self, forKey: .r9Enabled) ?? defaults.r9Enabled
        r9Minutes = try v.decodeIfPresent(Int.self, forKey: .r9Minutes) ?? defaults.r9Minutes
        r9Sets = try v.decodeIfPresent(Int.self, forKey: .r9Sets) ?? defaults.r9Sets
        r10Enabled = try v.decodeIfPresent(Bool.self, forKey: .r10Enabled) ?? defaults.r10Enabled
        r10DistinctDays = try v.decodeIfPresent(Int.self, forKey: .r10DistinctDays) ?? defaults.r10DistinctDays
        r10RequiresFirstInSession = try v.decodeIfPresent(Bool.self, forKey: .r10RequiresFirstInSession) ?? defaults.r10RequiresFirstInSession
        r11Enabled = try v.decodeIfPresent(Bool.self, forKey: .r11Enabled) ?? defaults.r11Enabled
        r11FinalWeekDays = try v.decodeIfPresent(Int.self, forKey: .r11FinalWeekDays) ?? defaults.r11FinalWeekDays
        r11FinalTwoWeeksDays = try v.decodeIfPresent(Int.self, forKey: .r11FinalTwoWeeksDays) ?? defaults.r11FinalTwoWeeksDays
        r12Enabled = try v.decodeIfPresent(Bool.self, forKey: .r12Enabled) ?? defaults.r12Enabled
        r12SlowDownsPerDay = try v.decodeIfPresent(Int.self, forKey: .r12SlowDownsPerDay) ?? defaults.r12SlowDownsPerDay
        r13Enabled = try v.decodeIfPresent(Bool.self, forKey: .r13Enabled) ?? defaults.r13Enabled
        r13ConsecutiveMissed = try v.decodeIfPresent(Int.self, forKey: .r13ConsecutiveMissed) ?? defaults.r13ConsecutiveMissed
        r14Enabled = try v.decodeIfPresent(Bool.self, forKey: .r14Enabled) ?? defaults.r14Enabled
        r14DropoutBars = try v.decodeIfPresent(Int.self, forKey: .r14DropoutBars) ?? defaults.r14DropoutBars
        r15Enabled = try v.decodeIfPresent(Bool.self, forKey: .r15Enabled) ?? defaults.r15Enabled
        r15MaxNewPerSession = try v.decodeIfPresent(Int.self, forKey: .r15MaxNewPerSession) ?? defaults.r15MaxNewPerSession
        r15EstimatedMinutesPerItem = try v.decodeIfPresent(Int.self, forKey: .r15EstimatedMinutesPerItem) ?? defaults.r15EstimatedMinutesPerItem
        updatedAt = try v.decodeIfPresent(Date.self, forKey: .updatedAt) ?? .praeludeEpochSentinel
    }
}
