import Foundation

/// Everything a practice rule might read, gathered in one place so a test can stage exactly the
/// slice it needs (a "staged-data test", §17a) without constructing a whole `LibraryState`. A real
/// caller builds one from the live store with `RuleContext(state:now:calendar:)`. `calendar` is
/// injected (not `.current`) so day-boundary/timezone/DST behavior is deterministic and testable —
/// see "(C) Rules Engine.md" for why every day-bucketed rule takes a calendar instead of assuming one.
public struct RuleContext: Sendable {
    public var now: Date
    public var calendar: Calendar
    public var settings: RuleSettings
    public var pieces: [Piece]
    public var passages: [Passage]
    public var instruments: [Instrument]
    public var coldGrades: [ColdGradeRecord]
    public var breakPointTaps: [BreakPointTap]
    public var ruleEvents: [RuleEvent]
    public var sessions: [PracticeSession]
    public var history: [ActiveSet]
    public var activeSet: ActiveSet?
    public var warmupExercises: [WarmupExercise]

    public init(now: Date = Date(), calendar: Calendar = .current, settings: RuleSettings = RuleSettings(),
                pieces: [Piece] = [], passages: [Passage] = [], instruments: [Instrument] = [],
                coldGrades: [ColdGradeRecord] = [], breakPointTaps: [BreakPointTap] = [], ruleEvents: [RuleEvent] = [],
                sessions: [PracticeSession] = [], history: [ActiveSet] = [], activeSet: ActiveSet? = nil,
                warmupExercises: [WarmupExercise] = []) {
        self.now = now; self.calendar = calendar; self.settings = settings
        self.pieces = pieces; self.passages = passages; self.instruments = instruments
        self.coldGrades = coldGrades; self.breakPointTaps = breakPointTaps; self.ruleEvents = ruleEvents
        self.sessions = sessions; self.history = history; self.activeSet = activeSet
        self.warmupExercises = warmupExercises
    }

    /// Convenience for a real caller: every collection a rule could need, straight from the store's
    /// published state. Tests generally use the memberwise initializer instead, staging only what
    /// the rule under test reads.
    public init(state: LibraryState, now: Date = Date(), calendar: Calendar = .current) {
        self.init(now: now, calendar: calendar, settings: state.ruleSettings, pieces: state.pieces, passages: state.passages,
                  instruments: state.instruments, coldGrades: state.coldGrades, breakPointTaps: state.breakPointTaps,
                  ruleEvents: state.ruleEvents, sessions: state.sessions, history: state.history, activeSet: state.activeSet,
                  warmupExercises: state.warmupExercises)
    }
}

/// The rule-specific payload a `Decision` carries, beyond its human-readable reason, so a caller can
/// actually act on a suggestion (or ignore it) without re-deriving the outcome itself.
public enum DecisionOutcome: Equatable, Sendable {
    case none
    /// R1: offer to split this region (or the passage generally, if no single region stands out).
    case suggestSplit(regionID: UUID?)
    /// R2: offer to join these two (neighboring, Review-state) passages into one.
    case suggestJoin(passageIDs: [UUID])
    /// R3/R4: the passage's new schedule and learning state after grading a cold attempt.
    case schedule(PassageSchedule, learningState: LearningState)
    /// R5: the clean-streak target the next set should use.
    case streakTarget(Int)
    /// R6/R7: the tempo the next attempt (R6) or next set (R7) should use.
    case tempoChange(newBPM: Double)
    /// R8: offer a sub-passage around this clustered region.
    case suggestSubPassage(region: NormalizedRect)
    /// R9: park the passage until this date ("Back tomorrow.").
    case park(until: Date)
    /// R10: the passage has cleared performance-readiness.
    case performanceReady
    /// R11: caps/flags as a performance date approaches. `inFinalWeek` is what tells R15 whether to
    /// treat every one of this piece's passages as due today (final week) or only cap intervals and
    /// add run-throughs (the two weeks before that) — both leave `notReadyPassageIDs` at `[]` when
    /// nothing is flagged, so that array alone cannot carry this distinction.
    case performanceCaps(cappedIntervalDays: Int, includeRunThroughs: Bool, notReadyPassageIDs: [UUID], inFinalWeek: Bool)
    /// R12: suggest building (or resuming) a variant chain.
    case suggestVariants
    /// R13: suggest practicing this part/hand alone (from the instrument's own parts vocabulary).
    case suggestParts(String)
    /// R14: the metronome dropout plan for a pulse check.
    case pulseCheck(PulseCheckPlan)
    /// R15: the built session plan.
    case sessionPlan(SessionPlan)
}

/// One rule's verdict (§11): a stable rule id, who it's about, one dry human-readable line, and
/// whatever the caller needs to actually apply it. Never persisted directly — logging a fired or
/// overridden decision means turning it into a `RuleEvent` (see `asRuleEvent`) and calling
/// `PracticeStore.recordRuleEvent`.
public struct Decision: Identifiable, Equatable, Sendable {
    public var id: UUID
    public var ruleID: RuleID
    public var pieceID: UUID?
    public var passageID: UUID?
    public var reason: String
    public var firedAt: Date
    public var outcome: DecisionOutcome
    public init(id: UUID = UUID(), ruleID: RuleID, pieceID: UUID? = nil, passageID: UUID? = nil,
                reason: String, firedAt: Date = Date(), outcome: DecisionOutcome = .none) {
        self.id = id; self.ruleID = ruleID; self.pieceID = pieceID; self.passageID = passageID
        self.reason = reason; self.firedAt = firedAt; self.outcome = outcome
    }
}

public extension Decision {
    /// Every decision "supports one-tap override, which is logged" (§11): this is that log entry,
    /// whether the player accepted the suggestion (`overridden: false`) or dismissed it
    /// (`overridden: true`). Keeps the same `id` as the decision so a caller can trace one back to
    /// the other; `RuleEvent` is append-only, so logging never edits a previous entry.
    func asRuleEvent(overridden: Bool = false) -> RuleEvent {
        RuleEvent(id: id, ruleID: ruleID, pieceID: pieceID, passageID: passageID,
                  reasonText: reason, firedAt: firedAt, overridden: overridden)
    }
}

/// R3/R4: the result of grading one cold attempt — both rules fire from the same event, since R3
/// ("first attempt of the day, graded") is what makes R4 ("drives schedule") possible.
public struct ColdGradeApplication: Equatable, Sendable {
    public var record: ColdGradeRecord
    public var newLearningState: LearningState
    public var newSchedule: PassageSchedule
    /// In order: the R3 decision, then (if R4 is enabled) the R4 decision.
    public var decisions: [Decision]
}

/// R14: a deterministic, metronome-consumable dropout plan. No randomness — "deterministic rules"
/// (§2) applies to the metronome's behavior too, not just to whether a rule fires.
public struct PulseCheckPlan: Equatable, Sendable {
    public var leadInBars: Int
    public var silentBars: Int
    public var recoveryBars: Int
}

/// R15: one line of a built session.
public enum SessionItemKind: String, Equatable, Sendable { case warmup, review, learning, new, runThrough }

public struct SessionItem: Identifiable, Equatable, Sendable {
    /// The warmup's or passage's own id; for `.runThrough`, the piece's id (a run-through has no
    /// single passage).
    public var id: UUID
    public var kind: SessionItemKind
    public var pieceID: UUID?
    public var passageID: UUID?
    public var estimatedMinutes: Int
    public var reason: String
    public init(id: UUID, kind: SessionItemKind, pieceID: UUID?, passageID: UUID?, estimatedMinutes: Int, reason: String) {
        self.id = id; self.kind = kind; self.pieceID = pieceID; self.passageID = passageID
        self.estimatedMinutes = estimatedMinutes; self.reason = reason
    }
}

public struct SessionPlan: Equatable, Sendable {
    public var items: [SessionItem]
    public var totalEstimatedMinutes: Int
}

extension ColdGrade {
    /// "Clean"/"Shaky"/"Missed" for reason text; not the raw lowercase Codable value.
    var label: String { rawValue.capitalized }
}
