import Foundation

/// Per-passage grade/tempo history over time (§15 History): merges the cold-grade ledger with every
/// recorded attempt on that passage's sets into one chronological timeline, for a history screen and
/// for CSV/JSON export (see `HistoryExport`).
public enum PassageHistory {
    public enum PointKind: Equatable, Sendable {
        case coldGrade(ColdGrade)
        case attempt(Verdict)
    }

    public struct Point: Identifiable, Equatable, Sendable {
        public var id: UUID
        public var passageID: UUID
        public var date: Date
        public var kind: PointKind
        public var tempo: Double
    }

    /// Every cold grade and every effective (not undone, not `.reset`) attempt recorded against this
    /// passage, oldest first. An attempt is attributed to a passage through its own set's
    /// `configuration.passageID` — including the live `activeSet`, so a still-running set's already
    /// recorded reps show up immediately rather than only once the set ends.
    public static func timeline(passageID: UUID, state: LibraryState) -> [Point] {
        let coldPoints = state.coldGrades.filter { $0.passageID == passageID }
            .map { Point(id: $0.id, passageID: passageID, date: $0.date, kind: .coldGrade($0.grade), tempo: $0.tempo) }
        let sets = (state.history + [state.activeSet].compactMap { $0 }).filter { $0.configuration.passageID == passageID }
        let attemptPoints = sets.flatMap(\.attempts).filter(\.isEffective)
            .map { Point(id: $0.id, passageID: passageID, date: $0.date, kind: .attempt($0.verdict), tempo: $0.bpm) }
        return (coldPoints + attemptPoints).sorted { $0.date < $1.date }
    }
}
