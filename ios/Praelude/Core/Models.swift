import Foundation

public enum PieceStatus: String, Codable, CaseIterable, Sendable { case active, completed, resting }
public enum CompletionBasis: String, Codable, CaseIterable, Sendable { case cleanStreak, totalPlays }
public enum Verdict: String, Codable, CaseIterable, Sendable { case clean, sloppy, again, reset }
public enum SetStatus: String, Codable, Sendable { case running, paused, completed, ended }

public struct Piece: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var title: String
    public var composer: String
    public var pdfFileName: String?
    public var pageCount: Int
    public var lastPage: Int
    public var status: PieceStatus
    public var notes: String
    public var createdAt: Date
    /// §6: the instrument this piece is practiced on; `nil` for legacy/unspecified pieces.
    public var instrumentID: UUID?
    /// §7: library organization.
    public var tagIDs: [UUID]
    public var folderIDs: [UUID]
    public var difficulty: Int?
    public var customCoverRef: String?
    /// §11: upcoming/past performance dates for this piece.
    public var performanceDates: [Date]
    /// Schema5 score organization; source page coordinates remain unchanged. Synced with the owner-scoped piece row.
    public var scoreSections: [ScoreSection]
    public var measureAnchors: [ScoreMeasureAnchor]
    public var defaultPracticeBPM: Double?
    /// Deliberate full-tempo reference, independent of the current practice/set tempo. Local metadata.
    public var fullTempoBPM: Double?
    public var practiceBalancePlan: PracticeBalancePlan
    /// Sync metadata (§4d) for everything except `lastPage`, which turning a page changes far more
    /// often than any of the above; it gets its own clock so ordinary reading never races a
    /// deliberate metadata edit made offline on another device (see "(C) Schema3.md").
    public var updatedAt: Date
    public var lastPageUpdatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), title: String, composer: String = "", pdfFileName: String? = nil,
                pageCount: Int = 0, lastPage: Int = 1, status: PieceStatus = .active,
                notes: String = "", createdAt: Date = Date(), instrumentID: UUID? = nil,
                tagIDs: [UUID] = [], folderIDs: [UUID] = [], difficulty: Int? = nil, customCoverRef: String? = nil,
                performanceDates: [Date] = [], scoreSections: [ScoreSection] = [], measureAnchors: [ScoreMeasureAnchor] = [],
                defaultPracticeBPM: Double? = nil, fullTempoBPM: Double? = nil,
                practiceBalancePlan: PracticeBalancePlan = PracticeBalancePlan(), updatedAt: Date = Date(), lastPageUpdatedAt: Date = Date(),
                deletedAt: Date? = nil) {
        self.id = id; self.title = title; self.composer = composer; self.pdfFileName = pdfFileName
        self.pageCount = pageCount; self.lastPage = lastPage; self.status = status
        self.notes = notes; self.createdAt = createdAt
        self.instrumentID = instrumentID; self.tagIDs = tagIDs; self.folderIDs = folderIDs
        self.difficulty = difficulty; self.customCoverRef = customCoverRef; self.performanceDates = performanceDates
        self.scoreSections = scoreSections; self.measureAnchors = measureAnchors; self.defaultPracticeBPM = defaultPracticeBPM
        self.fullTempoBPM = fullTempoBPM; self.practiceBalancePlan = practiceBalancePlan
        self.updatedAt = updatedAt; self.lastPageUpdatedAt = lastPageUpdatedAt; self.deletedAt = deletedAt
    }
    private enum CodingKeys: String, CodingKey {
        case id, title, composer, pdfFileName, pageCount, lastPage, status, notes, createdAt, instrumentID,
             tagIDs, folderIDs, difficulty, customCoverRef, performanceDates, scoreSections, measureAnchors, defaultPracticeBPM, fullTempoBPM, practiceBalancePlan, updatedAt, lastPageUpdatedAt, deletedAt
    }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        title = try values.decode(String.self, forKey: .title)
        composer = try values.decode(String.self, forKey: .composer)
        pdfFileName = try values.decodeIfPresent(String.self, forKey: .pdfFileName)
        pageCount = try values.decode(Int.self, forKey: .pageCount)
        lastPage = try values.decode(Int.self, forKey: .lastPage)
        status = try values.decode(PieceStatus.self, forKey: .status)
        notes = try values.decode(String.self, forKey: .notes)
        createdAt = try values.decode(Date.self, forKey: .createdAt)
        instrumentID = try values.decodeIfPresent(UUID.self, forKey: .instrumentID)
        tagIDs = try values.decodeIfPresent([UUID].self, forKey: .tagIDs) ?? []
        folderIDs = try values.decodeIfPresent([UUID].self, forKey: .folderIDs) ?? []
        difficulty = try values.decodeIfPresent(Int.self, forKey: .difficulty)
        customCoverRef = try values.decodeIfPresent(String.self, forKey: .customCoverRef)
        performanceDates = try values.decodeIfPresent([Date].self, forKey: .performanceDates) ?? []
        scoreSections = try values.decodeIfPresent([ScoreSection].self, forKey: .scoreSections) ?? []
        measureAnchors = try values.decodeIfPresent([ScoreMeasureAnchor].self, forKey: .measureAnchors) ?? []
        defaultPracticeBPM = try values.decodeIfPresent(Double.self, forKey: .defaultPracticeBPM)
        fullTempoBPM = try values.decodeIfPresent(Double.self, forKey: .fullTempoBPM)
        practiceBalancePlan = try values.decodeIfPresent(PracticeBalancePlan.self, forKey: .practiceBalancePlan) ?? PracticeBalancePlan()
        // Absent on schema1/2 data; SchemaMigration backfills the sentinel to the migration timestamp.
        updatedAt = try values.decodeIfPresent(Date.self, forKey: .updatedAt) ?? .praeludeEpochSentinel
        lastPageUpdatedAt = try values.decodeIfPresent(Date.self, forKey: .lastPageUpdatedAt) ?? .praeludeEpochSentinel
        deletedAt = try values.decodeIfPresent(Date.self, forKey: .deletedAt)
    }
}

/// A rectangle in the unrotated page overlay, normalized from its top-left corner.
public struct PassageRegion: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var page: Int
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double
    public init(id: UUID = UUID(), page: Int, x: Double, y: Double, width: Double, height: Double) {
        self.id = id; self.page = page; self.x = x; self.y = y; self.width = width; self.height = height
    }
}

public struct Passage: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var pieceID: UUID
    public var title: String
    public var startMeasure: Int?
    public var endMeasure: Int?
    public var page: Int
    public var focus: String
    public var regions: [PassageRegion]
    /// §8: a user-chosen color, a parent for a drawn-while-practicing sub-passage, and the source
    /// passages an R2 join was built from (kept for provenance/undo, never silently discarded).
    public var color: String?
    public var parentPassageID: UUID?
    public var joinedFromPassageIDs: [UUID]
    /// §8: deleting archives history rather than erasing it.
    public var archived: Bool
    /// §8/§11: spaced-review state and schedule.
    public var learningState: LearningState
    public var schedule: PassageSchedule
    /// §11 R9: parked passages resurface after this date.
    public var parkedUntil: Date?
    /// §11 R10/R11: the tempo performance-readiness is graded against.
    public var performanceTempo: Double?
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), pieceID: UUID, title: String, startMeasure: Int? = nil,
                endMeasure: Int? = nil, page: Int = 1, focus: String = "Pulse", regions: [PassageRegion] = [],
                color: String? = nil, parentPassageID: UUID? = nil, joinedFromPassageIDs: [UUID] = [],
                archived: Bool = false, learningState: LearningState = .new, schedule: PassageSchedule = PassageSchedule(),
                parkedUntil: Date? = nil, performanceTempo: Double? = nil,
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.pieceID = pieceID; self.title = title; self.startMeasure = startMeasure
        self.endMeasure = endMeasure; self.page = page; self.focus = focus; self.regions = regions
        self.color = color; self.parentPassageID = parentPassageID; self.joinedFromPassageIDs = joinedFromPassageIDs
        self.archived = archived; self.learningState = learningState; self.schedule = schedule
        self.parkedUntil = parkedUntil; self.performanceTempo = performanceTempo
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
    public var measureLabel: String {
        guard let startMeasure, let endMeasure else { return "" }
        return startMeasure == endMeasure ? "m. \(startMeasure)" : "mm. \(startMeasure)–\(endMeasure)"
    }
    private enum CodingKeys: String, CodingKey {
        case id, pieceID, title, startMeasure, endMeasure, page, focus, regions, color, parentPassageID,
             joinedFromPassageIDs, archived, learningState, schedule, parkedUntil, performanceTempo,
             createdAt, updatedAt, deletedAt
    }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id); pieceID = try values.decode(UUID.self, forKey: .pieceID)
        title = try values.decode(String.self, forKey: .title)
        startMeasure = try values.decodeIfPresent(Int.self, forKey: .startMeasure)
        endMeasure = try values.decodeIfPresent(Int.self, forKey: .endMeasure)
        page = try values.decode(Int.self, forKey: .page); focus = try values.decode(String.self, forKey: .focus)
        regions = try values.decodeIfPresent([PassageRegion].self, forKey: .regions) ?? []
        color = try values.decodeIfPresent(String.self, forKey: .color)
        parentPassageID = try values.decodeIfPresent(UUID.self, forKey: .parentPassageID)
        joinedFromPassageIDs = try values.decodeIfPresent([UUID].self, forKey: .joinedFromPassageIDs) ?? []
        archived = try values.decodeIfPresent(Bool.self, forKey: .archived) ?? false
        learningState = try values.decodeIfPresent(LearningState.self, forKey: .learningState) ?? .new
        schedule = try values.decodeIfPresent(PassageSchedule.self, forKey: .schedule) ?? PassageSchedule()
        parkedUntil = try values.decodeIfPresent(Date.self, forKey: .parkedUntil)
        performanceTempo = try values.decodeIfPresent(Double.self, forKey: .performanceTempo)
        createdAt = try values.decodeIfPresent(Date.self, forKey: .createdAt) ?? .praeludeEpochSentinel
        updatedAt = try values.decodeIfPresent(Date.self, forKey: .updatedAt) ?? .praeludeEpochSentinel
        deletedAt = try values.decodeIfPresent(Date.self, forKey: .deletedAt)
    }
}

public struct VariantStage: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var targetCount: Int
    public init(id: UUID = UUID(), name: String, targetCount: Int = 3) {
        self.id = id; self.name = name; self.targetCount = targetCount
    }
}

public enum TempoStep: Codable, Equatable, Sendable {
    case fixed(Double)
    case percent(Double)
    public func next(after bpm: Double, target: Double) -> Double {
        let proposed: Double
        switch self {
        case .fixed(let step): proposed = bpm + step
        case .percent(let step): proposed = (bpm * (1 + step / 100)).rounded(.up)
        }
        return min(target, proposed)
    }
    public var amount: Double {
        switch self { case .fixed(let amount), .percent(let amount): return amount }
    }
}

/// A deliberate change in the rep log, anchored to the number of original attempts already
/// recorded. Undo marks attempts rather than deleting them, so this boundary stays stable.
public struct SetTempoChange: Codable, Equatable, Sendable {
    public var bpm: Double
    public var afterAttemptCount: Int
    public init(bpm: Double, afterAttemptCount: Int) {
        self.bpm = bpm; self.afterAttemptCount = afterAttemptCount
    }
}

public struct PracticeConfiguration: Codable, Equatable, Sendable {
    public var pieceID: UUID
    public var passageID: UUID?
    public var focus: String
    /// §10b: what the set is for; non-tempo goals default the metronome off (a Views concern).
    public var goal: SetGoal
    public var basis: CompletionBasis
    public var targetCount: Int
    public var startBPM: Double
    public var targetBPM: Double
    public var tempoStep: TempoStep
    public var tempoChanges: [SetTempoChange]
    public var stages: [VariantStage]
    public var hands: String
    public var useMetronome: Bool
    public var passageSnapshot: Passage?
    /// Full-tempo reference captured at set creation; old sets keep nil.
    public var fullTempoBPM: Double?
    /// Immutable hand selection per NEW recorded event. Legacy events retain only set-contract hands.
    public var recordedHands: [String: String]
    public init(pieceID: UUID, passageID: UUID? = nil, focus: String = "Pulse", goal: SetGoal = .tempo,
                basis: CompletionBasis = .cleanStreak, targetCount: Int = 5,
                startBPM: Double = 60, targetBPM: Double = 60, tempoStep: TempoStep = .fixed(4),
                stages: [VariantStage] = [], hands: String = "Both hands", useMetronome: Bool = false,
                passageSnapshot: Passage? = nil, tempoChanges: [SetTempoChange] = [],
                fullTempoBPM: Double? = nil, recordedHands: [String: String] = [:]) {
        self.pieceID = pieceID; self.passageID = passageID; self.focus = focus; self.goal = goal; self.basis = basis
        self.targetCount = targetCount; self.startBPM = startBPM; self.targetBPM = targetBPM
        self.tempoStep = tempoStep; self.stages = stages; self.hands = hands; self.useMetronome = useMetronome
        self.passageSnapshot = passageSnapshot; self.tempoChanges = tempoChanges
        self.fullTempoBPM = fullTempoBPM; self.recordedHands = recordedHands
    }
    private enum CodingKeys: String, CodingKey {
        case pieceID, passageID, focus, goal, basis, targetCount, startBPM, targetBPM, tempoStep, tempoChanges, stages, hands, useMetronome, passageSnapshot, fullTempoBPM, recordedHands
    }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        pieceID = try values.decode(UUID.self, forKey: .pieceID)
        passageID = try values.decodeIfPresent(UUID.self, forKey: .passageID)
        focus = try values.decode(String.self, forKey: .focus)
        goal = try values.decodeIfPresent(SetGoal.self, forKey: .goal) ?? .tempo
        basis = try values.decode(CompletionBasis.self, forKey: .basis)
        targetCount = try values.decode(Int.self, forKey: .targetCount)
        startBPM = try values.decode(Double.self, forKey: .startBPM)
        targetBPM = try values.decode(Double.self, forKey: .targetBPM)
        tempoStep = try values.decode(TempoStep.self, forKey: .tempoStep)
        tempoChanges = try values.decodeIfPresent([SetTempoChange].self, forKey: .tempoChanges) ?? []
        stages = try values.decode([VariantStage].self, forKey: .stages)
        hands = try values.decode(String.self, forKey: .hands)
        useMetronome = try values.decode(Bool.self, forKey: .useMetronome)
        passageSnapshot = try values.decodeIfPresent(Passage.self, forKey: .passageSnapshot)
        fullTempoBPM = try values.decodeIfPresent(Double.self, forKey: .fullTempoBPM)
        recordedHands = try values.decodeIfPresent([String: String].self, forKey: .recordedHands) ?? [:]
    }
}

public struct Attempt: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var verdict: Verdict
    public var date: Date
    public var bpm: Double
    public var stageIndex: Int
    public var undoneAt: Date?
    public init(id: UUID = UUID(), verdict: Verdict, date: Date = Date(), bpm: Double, stageIndex: Int = 0, undoneAt: Date? = nil) {
        self.id = id; self.verdict = verdict; self.date = date; self.bpm = bpm
        self.stageIndex = stageIndex; self.undoneAt = undoneAt
    }
    public var isEffective: Bool { undoneAt == nil && verdict != .reset }
}

public struct ActiveSet: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var sessionID: UUID
    public var configuration: PracticeConfiguration
    public var currentBPM: Double
    public var stageIndex: Int
    public var streak: Int
    public var totalPlays: Int
    public var completedStages: Int
    public var status: SetStatus
    public var startedAt: Date
    public var endedAt: Date?
    public var activeSeconds: TimeInterval
    public var lastCheckpoint: Date?
    public var attempts: [Attempt]
    public init(id: UUID = UUID(), sessionID: UUID, configuration: PracticeConfiguration, startedAt: Date = Date()) {
        self.id = id; self.sessionID = sessionID; self.configuration = configuration
        currentBPM = configuration.startBPM; stageIndex = 0; streak = 0; totalPlays = 0; completedStages = 0
        status = .running; self.startedAt = startedAt; endedAt = nil; activeSeconds = 0
        lastCheckpoint = startedAt; attempts = []
    }
    public var effectiveTargetBPM: Double { configuration.tempoChanges.reduce(configuration.targetBPM) { max($0, $1.bpm) } }
    public var currentStage: VariantStage? { configuration.stages.indices.contains(stageIndex) ? configuration.stages[stageIndex] : nil }
    public var requiredCount: Int { currentStage?.targetCount ?? configuration.targetCount }
    public var progressCount: Int { configuration.basis == .totalPlays ? totalPlays : streak }
    public var progressFraction: Double { min(1, Double(progressCount) / Double(max(1, requiredCount))) }
    public var effectiveAttempts: [Attempt] { attempts.filter(\.isEffective) }
    public var isComplete: Bool { status == .completed }
}

public struct PracticeSession: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var pieceID: UUID
    public var focus: String
    public var startedAt: Date
    public var endedAt: Date?
    public var activeSeconds: TimeInterval
    public var attempts: [Attempt]
    public var completedSets: Int
    public init(id: UUID = UUID(), pieceID: UUID, focus: String, startedAt: Date = Date()) {
        self.id = id; self.pieceID = pieceID; self.focus = focus; self.startedAt = startedAt
        endedAt = nil; activeSeconds = 0; attempts = []; completedSets = 0
    }
}

public struct PracticeGoal: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var title: String
    public var pieceID: UUID?
    public var dueDate: Date?
    public var isComplete: Bool
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), title: String, pieceID: UUID? = nil, dueDate: Date? = nil, isComplete: Bool = false,
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.title = title; self.pieceID = pieceID; self.dueDate = dueDate; self.isComplete = isComplete
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
    private enum CodingKeys: String, CodingKey { case id, title, pieceID, dueDate, isComplete, createdAt, updatedAt, deletedAt }
    public init(from decoder: Decoder) throws {
        let v = try decoder.container(keyedBy: CodingKeys.self)
        id = try v.decode(UUID.self, forKey: .id); title = try v.decode(String.self, forKey: .title)
        pieceID = try v.decodeIfPresent(UUID.self, forKey: .pieceID); dueDate = try v.decodeIfPresent(Date.self, forKey: .dueDate)
        isComplete = try v.decode(Bool.self, forKey: .isComplete)
        createdAt = try v.decodeIfPresent(Date.self, forKey: .createdAt) ?? .praeludeEpochSentinel
        updatedAt = try v.decodeIfPresent(Date.self, forKey: .updatedAt) ?? .praeludeEpochSentinel
        deletedAt = try v.decodeIfPresent(Date.self, forKey: .deletedAt)
    }
}

public struct PracticeRoutine: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var stages: [VariantStage]
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), name: String, stages: [VariantStage], createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.name = name; self.stages = stages; self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
    private enum CodingKeys: String, CodingKey { case id, name, stages, createdAt, updatedAt, deletedAt }
    public init(from decoder: Decoder) throws {
        let v = try decoder.container(keyedBy: CodingKeys.self)
        id = try v.decode(UUID.self, forKey: .id); name = try v.decode(String.self, forKey: .name)
        stages = try v.decode([VariantStage].self, forKey: .stages)
        createdAt = try v.decodeIfPresent(Date.self, forKey: .createdAt) ?? .praeludeEpochSentinel
        updatedAt = try v.decodeIfPresent(Date.self, forKey: .updatedAt) ?? .praeludeEpochSentinel
        deletedAt = try v.decodeIfPresent(Date.self, forKey: .deletedAt)
    }
}

public struct Preferences: Codable, Equatable, Sendable {
    public var keepScreenAwake: Bool = true
    public var metronomeHaptics: Bool = false
    public var voiceEnabled: Bool = false
    public var theme: String = "system"
    public var showPassageBoxes: Bool = true
    public var compactScoreControls: Bool = true
    public var autoTurnPassageAfterVerdict: Bool = false
    public var updatedAt: Date = .distantPast
    public init() {}
    private enum CodingKeys: String, CodingKey {
        case keepScreenAwake, metronomeHaptics, voiceEnabled, theme, showPassageBoxes,
             compactScoreControls, autoTurnPassageAfterVerdict, updatedAt
    }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        keepScreenAwake = try values.decodeIfPresent(Bool.self, forKey: .keepScreenAwake) ?? true
        metronomeHaptics = try values.decodeIfPresent(Bool.self, forKey: .metronomeHaptics) ?? false
        voiceEnabled = try values.decodeIfPresent(Bool.self, forKey: .voiceEnabled) ?? false
        theme = try values.decodeIfPresent(String.self, forKey: .theme) ?? "system"
        showPassageBoxes = try values.decodeIfPresent(Bool.self, forKey: .showPassageBoxes) ?? true
        compactScoreControls = try values.decodeIfPresent(Bool.self, forKey: .compactScoreControls) ?? true
        autoTurnPassageAfterVerdict = try values.decodeIfPresent(Bool.self, forKey: .autoTurnPassageAfterVerdict) ?? false
        updatedAt = try values.decodeIfPresent(Date.self, forKey: .updatedAt) ?? .distantPast
    }
}

public struct LibraryState: Codable, Equatable, Sendable {
    public var desktopImports: [DesktopImportReceipt] = []
    public static let currentSchemaVersion = 5
    public var schemaVersion: Int = Self.currentSchemaVersion
    public var revision: Int = 0
    public var pieces: [Piece] = []
    public var passages: [Passage] = []
    /// §4d/§7: per-stroke ink, replacing schema2's per-page `scoreDrawings`. See "(C) Schema3.md".
    public var inkStrokes: [InkStroke] = []
    public var activeSet: ActiveSet?
    public var history: [ActiveSet] = []
    public var sessions: [PracticeSession] = []
    public var goals: [PracticeGoal] = []
    public var routines: [PracticeRoutine] = []
    public var preferences = Preferences()
    /// §6
    public var instruments: [Instrument] = []
    /// §7
    public var tags: [Tag] = []
    public var folders: [Folder] = []
    public var setlists: [Setlist] = []
    public var bookmarks: [Bookmark] = []
    public var pageEdits: [PageEdit] = []
    public var scoreLinks: [ScoreLink] = []
    public var textAnnotations: [TextBoxAnnotation] = []
    public var stampAnnotations: [StampAnnotation] = []
    /// §8/§11
    public var coldGrades: [ColdGradeRecord] = []
    public var breakPointTaps: [BreakPointTap] = []
    /// §11
    public var ruleSettings = RuleSettings()
    public var ruleEvents: [RuleEvent] = []
    /// §12
    public var warmupExercises: [WarmupExercise] = []
    /// §13
    public var recordings: [AudioRecording] = []
    /// §14
    public var rewardLedger: [RewardLedgerEntry] = []
    public var badges: [Badge] = []
    public var milestoneEvents: [MilestoneEvent] = []
    public var rewardsState = RewardsState()
    /// §15
    public var notebookEntries: [NotebookEntry] = []
    /// §4c/§5
    public var profile = Profile()
    public init() {}
    private enum CodingKeys: String, CodingKey {
        case desktopImports, schemaVersion, revision, pieces, passages, inkStrokes, activeSet, history, sessions, goals, routines, preferences,
             instruments, tags, folders, setlists, bookmarks, pageEdits, scoreLinks, textAnnotations, stampAnnotations,
             coldGrades, breakPointTaps, ruleSettings, ruleEvents, warmupExercises, recordings, rewardLedger, badges,
             milestoneEvents, rewardsState, notebookEntries, profile
    }
    /// Schema2's ink key, read only as a migration fallback and kept out of `CodingKeys` so it never
    /// participates in (auto-synthesized) encoding.
    private enum LegacyCodingKeys: String, CodingKey { case scoreDrawings }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        desktopImports = try values.decodeIfPresent([DesktopImportReceipt].self, forKey: .desktopImports) ?? []
        schemaVersion = try values.decode(Int.self, forKey: .schemaVersion)
        revision = try values.decode(Int.self, forKey: .revision)
        pieces = try values.decode([Piece].self, forKey: .pieces)
        passages = try values.decode([Passage].self, forKey: .passages)
        if let strokes = try values.decodeIfPresent([InkStroke].self, forKey: .inkStrokes) {
            inkStrokes = strokes
        } else {
            let legacyValues = try decoder.container(keyedBy: LegacyCodingKeys.self)
            let legacy = try legacyValues.decodeIfPresent([LegacyScoreDrawing].self, forKey: .scoreDrawings) ?? []
            inkStrokes = legacy.map {
                InkStroke(pieceID: $0.pieceID, page: $0.page, layer: .mine, data: $0.data,
                          createdAt: .praeludeEpochSentinel, updatedAt: .praeludeEpochSentinel)
            }
        }
        activeSet = try values.decodeIfPresent(ActiveSet.self, forKey: .activeSet)
        history = try values.decode([ActiveSet].self, forKey: .history)
        sessions = try values.decode([PracticeSession].self, forKey: .sessions)
        goals = try values.decode([PracticeGoal].self, forKey: .goals)
        routines = try values.decode([PracticeRoutine].self, forKey: .routines)
        preferences = try values.decode(Preferences.self, forKey: .preferences)
        instruments = try values.decodeIfPresent([Instrument].self, forKey: .instruments) ?? []
        tags = try values.decodeIfPresent([Tag].self, forKey: .tags) ?? []
        folders = try values.decodeIfPresent([Folder].self, forKey: .folders) ?? []
        setlists = try values.decodeIfPresent([Setlist].self, forKey: .setlists) ?? []
        bookmarks = try values.decodeIfPresent([Bookmark].self, forKey: .bookmarks) ?? []
        pageEdits = try values.decodeIfPresent([PageEdit].self, forKey: .pageEdits) ?? []
        scoreLinks = try values.decodeIfPresent([ScoreLink].self, forKey: .scoreLinks) ?? []
        textAnnotations = try values.decodeIfPresent([TextBoxAnnotation].self, forKey: .textAnnotations) ?? []
        stampAnnotations = try values.decodeIfPresent([StampAnnotation].self, forKey: .stampAnnotations) ?? []
        coldGrades = try values.decodeIfPresent([ColdGradeRecord].self, forKey: .coldGrades) ?? []
        breakPointTaps = try values.decodeIfPresent([BreakPointTap].self, forKey: .breakPointTaps) ?? []
        ruleSettings = try values.decodeIfPresent(RuleSettings.self, forKey: .ruleSettings) ?? RuleSettings()
        ruleEvents = try values.decodeIfPresent([RuleEvent].self, forKey: .ruleEvents) ?? []
        warmupExercises = try values.decodeIfPresent([WarmupExercise].self, forKey: .warmupExercises) ?? []
        recordings = try values.decodeIfPresent([AudioRecording].self, forKey: .recordings) ?? []
        rewardLedger = try values.decodeIfPresent([RewardLedgerEntry].self, forKey: .rewardLedger) ?? []
        badges = try values.decodeIfPresent([Badge].self, forKey: .badges) ?? []
        milestoneEvents = try values.decodeIfPresent([MilestoneEvent].self, forKey: .milestoneEvents) ?? []
        rewardsState = try values.decodeIfPresent(RewardsState.self, forKey: .rewardsState) ?? RewardsState()
        notebookEntries = try values.decodeIfPresent([NotebookEntry].self, forKey: .notebookEntries) ?? []
        profile = try values.decodeIfPresent(Profile.self, forKey: .profile) ?? Profile()
    }
}

public struct PracticeProgress: Equatable, Sendable {
    public var totalAttempts: Int
    public var cleanAttempts: Int
    public var completedSets: Int
    public var activeSeconds: TimeInterval
    public var xp: Int
    public var practicedDays: Int
}

public enum PracticeError: LocalizedError, Equatable {
    case invalid(String), unavailable(String), conflict(String)
    public var errorDescription: String? {
        switch self { case .invalid(let message), .unavailable(let message), .conflict(let message): return message }
    }
}
