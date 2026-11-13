import Foundation

/// The three notebook shapes (§15): a per-piece daily note, a lesson note, or a lesson-prep passage list.
public enum NotebookEntryKind: String, Codable, CaseIterable, Sendable { case daily, lessonNote, lessonPrep }

public struct NotebookEntry: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var kind: NotebookEntryKind
    public var pieceID: UUID?
    public var date: Date
    public var text: String
    /// The lesson-prep passage list, when `kind == .lessonPrep`; unused otherwise.
    public var passageIDs: [UUID]
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), kind: NotebookEntryKind, pieceID: UUID? = nil, date: Date = Date(),
                text: String = "", passageIDs: [UUID] = [],
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.kind = kind; self.pieceID = pieceID; self.date = date
        self.text = text; self.passageIDs = passageIDs
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}
