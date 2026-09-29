import Foundation

/// CSV/JSON export for the History screen (§15/§17a): one row per recorded attempt, the most granular
/// evidence the store already keeps, joined with piece/passage/session context for a report a
/// musician (or a teacher) can read in a spreadsheet — not `PracticeStore.backupData()`'s full-fidelity
/// app backup, which is a different, restorable format this app alone reads back.
public enum HistoryExport {
    public struct Row: Equatable, Sendable {
        public var sessionID: UUID
        public var pieceTitle: String
        public var passageTitle: String?
        public var date: Date
        public var verdict: Verdict
        public var bpm: Double
        public var focus: String
    }

    /// Every effective attempt across every session, oldest first by the attempt's own recorded date
    /// (not insertion order — an `undo` followed by a fresh attempt, or a resumed set, can otherwise
    /// leave a set's `attempts` array out of strict chronological order), with piece/passage titles
    /// resolved at export time (a passage snapshot's title still resolves even after the live passage
    /// is edited or removed, so a set's history keeps reading correctly).
    public static func rows(state: LibraryState) -> [Row] {
        let sets = state.history + [state.activeSet].compactMap { $0 }
        let rows = sets.flatMap { set -> [Row] in
            let pieceTitle = state.pieces.first { $0.id == set.configuration.pieceID }?.title ?? "Untitled piece"
            let passageTitle = set.configuration.passageSnapshot?.title
                ?? state.passages.first { $0.id == set.configuration.passageID }?.title
            return set.attempts.filter(\.isEffective).map {
                Row(sessionID: set.sessionID, pieceTitle: pieceTitle, passageTitle: passageTitle,
                    date: $0.date, verdict: $0.verdict, bpm: $0.bpm, focus: set.configuration.focus)
            }
        }
        return rows.sorted { $0.date < $1.date }
    }

    private static func csvField(_ value: String) -> String {
        guard value.contains(",") || value.contains("\"") || value.contains("\n") else { return value }
        return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    /// RFC 4180-style CSV, one row per attempt, CRLF line endings — the shape a spreadsheet expects,
    /// so §15's "export CSV ... via share sheet/Files" reads directly into Numbers/Excel/Sheets.
    public static func csv(state: LibraryState) -> String {
        // Built locally per call, not a shared `static let`: `ISO8601DateFormatter` is not `Sendable`,
        // and this keeps the module free of global mutable state under strict concurrency.
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime]
        var lines = ["Date,Piece,Passage,Focus,Verdict,BPM"]
        for row in rows(state: state) {
            let fields = [isoFormatter.string(from: row.date), row.pieceTitle, row.passageTitle ?? "",
                          row.focus, row.verdict.rawValue, String(Int(row.bpm.rounded()))]
            lines.append(fields.map(csvField).joined(separator: ","))
        }
        return lines.joined(separator: "\r\n") + "\r\n"
    }

    private struct JSONRow: Codable {
        var date: Date; var piece: String; var passage: String?; var focus: String; var verdict: String; var bpm: Double
    }

    /// The same rows, machine-readable, for a musician's own tooling or a teacher's import.
    public static func json(state: LibraryState) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let payload = rows(state: state).map {
            JSONRow(date: $0.date, piece: $0.pieceTitle, passage: $0.passageTitle, focus: $0.focus,
                    verdict: $0.verdict.rawValue, bpm: $0.bpm)
        }
        return try encoder.encode(payload)
    }
}
