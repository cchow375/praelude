import Foundation

public enum PieceStatus: String, Codable, CaseIterable, Sendable { case active, resting }
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
    public init(id: UUID = UUID(), title: String, composer: String = "", pdfFileName: String? = nil,
                pageCount: Int = 0, lastPage: Int = 1, status: PieceStatus = .active,
                notes: String = "", createdAt: Date = Date()) {
        self.id = id; self.title = title; self.composer = composer; self.pdfFileName = pdfFileName
        self.pageCount = pageCount; self.lastPage = lastPage; self.status = status
        self.notes = notes; self.createdAt = createdAt
    }
}

public struct Passage: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var pieceID: UUID
    public var title: String
    public var startMeasure: Int
    public var endMeasure: Int
    public var page: Int
    public var focus: String
    public init(id: UUID = UUID(), pieceID: UUID, title: String, startMeasure: Int = 1,
                endMeasure: Int = 4, page: Int = 1, focus: String = "Pulse") {
        self.id = id; self.pieceID = pieceID; self.title = title; self.startMeasure = startMeasure
        self.endMeasure = endMeasure; self.page = page; self.focus = focus
    }
    public var measureLabel: String { startMeasure == endMeasure ? "m. \(startMeasure)" : "mm. \(startMeasure)–\(endMeasure)" }
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

public struct PracticeConfiguration: Codable, Equatable, Sendable {
    public var pieceID: UUID
    public var passageID: UUID?
    public var focus: String
    public var basis: CompletionBasis
    public var targetCount: Int
    public var startBPM: Double
    public var targetBPM: Double
    public var tempoStep: TempoStep
    public var stages: [VariantStage]
    public var hands: String
    public var useMetronome: Bool
    public init(pieceID: UUID, passageID: UUID? = nil, focus: String = "Pulse",
                basis: CompletionBasis = .cleanStreak, targetCount: Int = 5,
                startBPM: Double = 60, targetBPM: Double = 60, tempoStep: TempoStep = .fixed(4),
                stages: [VariantStage] = [], hands: String = "Both hands", useMetronome: Bool = false) {
        self.pieceID = pieceID; self.passageID = passageID; self.focus = focus; self.basis = basis
        self.targetCount = targetCount; self.startBPM = startBPM; self.targetBPM = targetBPM
        self.tempoStep = tempoStep; self.stages = stages; self.hands = hands; self.useMetronome = useMetronome
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
    public init(id: UUID = UUID(), title: String, pieceID: UUID? = nil, dueDate: Date? = nil, isComplete: Bool = false) {
        self.id = id; self.title = title; self.pieceID = pieceID; self.dueDate = dueDate; self.isComplete = isComplete
    }
}

public struct PracticeRoutine: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var stages: [VariantStage]
    public init(id: UUID = UUID(), name: String, stages: [VariantStage]) { self.id = id; self.name = name; self.stages = stages }
}

public struct Preferences: Codable, Equatable, Sendable {
    public var keepScreenAwake: Bool = true
    public var metronomeHaptics: Bool = false
    public var voiceEnabled: Bool = false
    public var theme: String = "system"
    public init() {}
}

public struct LibraryState: Codable, Equatable, Sendable {
    public var schemaVersion: Int = 1
    public var revision: Int = 0
    public var pieces: [Piece] = []
    public var passages: [Passage] = []
    public var activeSet: ActiveSet?
    public var history: [ActiveSet] = []
    public var sessions: [PracticeSession] = []
    public var goals: [PracticeGoal] = []
    public var routines: [PracticeRoutine] = []
    public var preferences = Preferences()
    public init() {}
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
