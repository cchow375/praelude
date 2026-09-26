import Foundation

/// The warmup library's exercise shapes (§12).
public enum WarmupKind: String, Codable, CaseIterable, Sendable { case scale, arpeggio, exercise, custom }

/// Scale/arpeggio forms and common patterned variants (§12); free-form for anything else.
public enum ScaleMode: String, Codable, CaseIterable, Sendable {
    case major, naturalMinor, harmonicMinor, melodicMinor
    case dorian, phrygian, lydian, mixolydian, locrian
    case chromatic, thirds, sixths, octaves
}

/// One warmup library entry (§12): a built-in scale/arpeggio/exercise, or one drawn from a passage.
/// Favorites, last-used and rotation state live directly on the entry, mirroring `Piece.lastPage`:
/// mutable state updated in place rather than a separate usage log, since only the current value
/// (not the history) drives "Next in rotation" and "neglected keys".
public struct WarmupExercise: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var kind: WarmupKind
    /// Tonic/key name (e.g. "C", "F#"), free text so it stays instrument-agnostic.
    public var key: String
    public var mode: ScaleMode?
    public var instrumentFamily: InstrumentFamily?
    public var customFromPassageID: UUID?
    public var name: String
    public var isFavorite: Bool
    public var lastUsedAt: Date?
    public var useCount: Int
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), kind: WarmupKind, key: String, mode: ScaleMode? = nil,
                instrumentFamily: InstrumentFamily? = nil, customFromPassageID: UUID? = nil, name: String,
                isFavorite: Bool = false, lastUsedAt: Date? = nil, useCount: Int = 0,
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.kind = kind; self.key = key; self.mode = mode; self.instrumentFamily = instrumentFamily
        self.customFromPassageID = customFromPassageID; self.name = name; self.isFavorite = isFavorite
        self.lastUsedAt = lastUsedAt; self.useCount = useCount
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}
