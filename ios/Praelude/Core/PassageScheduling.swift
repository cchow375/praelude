import Foundation

/// A passage's place in spaced review (§8, §11 R4): New passages have never been cold-graded;
/// Learning and Review track R4/R5 progress; PerformanceReady has cleared R10.
public enum LearningState: String, Codable, CaseIterable, Sendable { case new, learning, review, performanceReady }

/// The once-a-day cold-open verdict (§9, §11 R3) that drives `PassageSchedule`.
public enum ColdGrade: String, Codable, CaseIterable, Sendable { case clean, shaky, missed }

/// A passage's current spaced-review schedule (§11 R4), maintained by whatever future engine
/// evaluates the rules; Core only stores the result.
public struct PassageSchedule: Codable, Equatable, Sendable {
    public var dueDate: Date?
    public var intervalDays: Int
    public var reviewStep: Int
    public init(dueDate: Date? = nil, intervalDays: Int = 1, reviewStep: Int = 0) {
        self.dueDate = dueDate; self.intervalDays = intervalDays; self.reviewStep = reviewStep
    }
}

/// One append-only cold-grade history entry (§11 R3/R4). Never edited or deleted after creation,
/// so only a stable `id` and the event's own date are needed — replicas merge by set union.
public struct ColdGradeRecord: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var passageID: UUID
    public var date: Date
    public var grade: ColdGrade
    public var tempo: Double
    public init(id: UUID = UUID(), passageID: UUID, date: Date = Date(), grade: ColdGrade, tempo: Double) {
        self.id = id; self.passageID = passageID; self.date = date; self.grade = grade; self.tempo = tempo
    }
}

/// One append-only "it broke here" tap after a Sloppy verdict (§11 R8); three clustered taps offer
/// a sub-passage split. Append-only, like `ColdGradeRecord`.
public struct BreakPointTap: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var passageID: UUID
    public var date: Date
    public var location: NormalizedRect?
    public init(id: UUID = UUID(), passageID: UUID, date: Date = Date(), location: NormalizedRect? = nil) {
        self.id = id; self.passageID = passageID; self.date = date; self.location = location
    }
}
