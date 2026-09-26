import Foundation

/// The onboarding instrument families (§6), each adapting parts wording and variant defaults.
public enum InstrumentFamily: String, Codable, CaseIterable, Sendable {
    case keyboard, strings, woodwinds, brass, percussion, voice, pluckedStrings, other

    /// Instrument-appropriate parts wording, e.g. "Hands" for keyboard vs. "Bow only" for strings.
    /// A static, code-defined catalog rather than persisted data: it has no user state of its own.
    public var partsVocabulary: [String] {
        switch self {
        case .keyboard: return ["Both hands", "Right hand", "Left hand", "Hands separately"]
        case .strings: return ["Together", "Left hand only", "Bow only", "Open strings"]
        case .pluckedStrings: return ["Together", "Fretting hand only", "Picking hand only"]
        case .woodwinds, .brass: return ["Full", "Articulation", "Slurred", "Tongued", "Breath only"]
        case .voice: return ["Full", "Vowel", "\u{201c}Nee\u{201d}", "Rhythm only"]
        case .percussion: return ["Full", "Hands separately", "Sticking"]
        case .other: return ["Full"]
        }
    }
}

/// Concert-vs-written transposition for a non-concert-pitch instrument (e.g. B\u{266d} clarinet).
public struct Transposition: Codable, Equatable, Sendable {
    /// Semitones to add to a written pitch to reach concert pitch (0 for a concert-pitch instrument).
    public var writtenToConcertSemitones: Int
    /// Display label, e.g. "B\u{266d}", "E\u{266d}", "F", "Concert pitch".
    public var label: String
    public init(writtenToConcertSemitones: Int, label: String) {
        self.writtenToConcertSemitones = writtenToConcertSemitones; self.label = label
    }
}

/// One entry in the player's own instrument list (§6). A `Piece` links to one via `instrumentID`.
public struct Instrument: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var family: InstrumentFamily
    public var name: String
    public var level: String
    public var transposition: Transposition?
    public var isPrimary: Bool
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public init(id: UUID = UUID(), family: InstrumentFamily, name: String, level: String = "",
                transposition: Transposition? = nil, isPrimary: Bool = false,
                createdAt: Date = Date(), updatedAt: Date = Date(), deletedAt: Date? = nil) {
        self.id = id; self.family = family; self.name = name; self.level = level
        self.transposition = transposition; self.isPrimary = isPrimary
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
    }
}
