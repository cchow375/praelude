import Foundation

/// Metadata for one optional per-rep/per-set recording (§13). The audio file itself lives beside
/// `library.json` the same way score PDFs do; Core only tracks the filename and bookkeeping.
public struct AudioRecording: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var passageID: UUID?
    public var setID: UUID?
    public var date: Date
    public var fileName: String
    public var duration: TimeInterval
    public var byteSize: Int
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), passageID: UUID? = nil, setID: UUID? = nil, date: Date = Date(),
                fileName: String, duration: TimeInterval, byteSize: Int,
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.passageID = passageID; self.setID = setID; self.date = date
        self.fileName = fileName; self.duration = duration; self.byteSize = byteSize
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}
