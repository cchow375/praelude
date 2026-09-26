import Foundation

/// `Transposition` only declared `Equatable` (Codable model types keep the minimum the store
/// needs); onboarding's picker needs `Hashable` to bind a `Picker` selection to it, so this catalog
/// — the one place a `Transposition` becomes a UI selection value — adds the conformance here rather
/// than editing "Instruments.swift"'s model declaration.
extension Transposition: Hashable {
    public func hash(into hasher: inout Hasher) {
        hasher.combine(writtenToConcertSemitones)
        hasher.combine(label)
    }
}

extension InstrumentFamily {
    /// Display name for onboarding's family grid and every instrument-management list.
    public var displayName: String {
        switch self {
        case .keyboard: return "Keyboard"
        case .strings: return "Strings"
        case .woodwinds: return "Woodwinds"
        case .brass: return "Brass"
        case .percussion: return "Percussion"
        case .voice: return "Voice"
        case .pluckedStrings: return "Guitar/plucked"
        case .other: return "Other"
        }
    }

    /// An SF Symbol for chrome/menus/onboarding tiles — generic system iconography, not one of the
    /// bespoke `PraeludeIcon` glyphs, which stay scoped to this app's core practice actions (see
    /// "(C) Design System.md"'s "Overflow-menu rows and generic chrome... keep SF Symbols").
    public var symbolName: String {
        switch self {
        case .keyboard: return "pianokeys"
        case .strings: return "waveform"
        case .woodwinds: return "wind"
        case .brass: return "megaphone"
        case .percussion: return "drum"
        case .voice: return "music.mic"
        case .pluckedStrings: return "guitars"
        case .other: return "ellipsis.circle"
        }
    }
}

/// Onboarding/instrument-editor catalogs (§6): static, code-defined suggestions with no user state
/// of their own, the same shape as `InstrumentFamily.partsVocabulary`. Kept separate from
/// `Instruments.swift` (schema3's home for the persisted `Instrument`/`Transposition` types) so
/// that file never needs to change for a catalog edit.
public enum InstrumentCatalog {
    /// Specific instrument names offered once a family is chosen. Free text remains available in
    /// every family via `.other` or a custom entry, so this list only needs to cover the common case.
    public static func instrumentNames(for family: InstrumentFamily) -> [String] {
        switch family {
        case .keyboard: return ["Piano", "Digital piano", "Organ", "Harpsichord", "Keyboard"]
        case .strings: return ["Violin", "Viola", "Cello", "Double bass"]
        case .woodwinds: return ["Flute", "Piccolo", "Oboe", "Clarinet", "Bass clarinet", "Bassoon", "Saxophone"]
        case .brass: return ["Trumpet", "French horn", "Trombone", "Euphonium", "Tuba"]
        case .percussion: return ["Snare drum", "Drum kit", "Marimba", "Vibraphone", "Timpani"]
        case .voice: return ["Soprano", "Mezzo-soprano", "Alto", "Tenor", "Baritone", "Bass"]
        case .pluckedStrings: return ["Guitar", "Classical guitar", "Bass guitar", "Ukulele", "Banjo", "Harp"]
        case .other: return []
        }
    }

    /// Practice-level suggestions. Deliberately the same list for every family — the spec asks
    /// onboarding to capture a level, not a family-specific rubric.
    public static let levels = ["Beginner", "Intermediate", "Advanced"]

    /// Common written-vs-concert transpositions offered when a family/instrument is not fixed-pitch
    /// (concert pitch instruments, and most keyboards/percussion, simply skip this step).
    public static func suggestedTranspositions(for family: InstrumentFamily) -> [Transposition] {
        let concert = Transposition(writtenToConcertSemitones: 0, label: "Concert pitch")
        switch family {
        case .woodwinds:
            return [concert,
                    Transposition(writtenToConcertSemitones: -2, label: "B♭ (clarinet, soprano sax, trumpet)"),
                    Transposition(writtenToConcertSemitones: -3, label: "E♭ (alto/baritone sax, clarinet)"),
                    Transposition(writtenToConcertSemitones: -14, label: "B♭ bass (bass clarinet, tenor sax, 8vb)")]
        case .brass:
            return [concert,
                    Transposition(writtenToConcertSemitones: -2, label: "B♭ (trumpet, cornet, tenor voice)"),
                    Transposition(writtenToConcertSemitones: -9, label: "F (horn)"),
                    Transposition(writtenToConcertSemitones: -3, label: "E♭ (alto/tenor horn)")]
        case .keyboard, .strings, .percussion, .voice, .pluckedStrings, .other:
            return [concert]
        }
    }

    /// Whether onboarding should even offer the transposition step for this family — most families
    /// never need it, so skipping the step keeps onboarding to its ≤2-taps-per-choice spirit.
    public static func transpositionIsRelevant(for family: InstrumentFamily) -> Bool {
        family == .woodwinds || family == .brass
    }

    /// Instrument-appropriate default variant chain for a new practice set (§6/§10b): "keyboard
    /// dotted rhythms, hands separate, blocked chords; strings open strings, bowing patterns,
    /// slurred/separate; winds/brass articulation patterns, slurred/tongued, breath planning; voice
    /// on vowel, on 'nee', rhythm only." Suggestions only — never applied without the player choosing
    /// them, matching how `SetComposerView`'s existing variant suggestions already behave.
    public static func defaultVariantNames(for family: InstrumentFamily) -> [String] {
        switch family {
        case .keyboard: return ["Hands separately", "Dotted rhythm", "Reverse dotted", "Blocked chords"]
        case .strings: return ["Open strings", "Bowing pattern", "Slurred", "Separate bows"]
        case .pluckedStrings: return ["Fretting hand only", "Picking hand only", "Slurred"]
        case .woodwinds, .brass: return ["Articulation pattern", "Slurred", "Tongued", "Breath planning"]
        case .voice: return ["On a vowel", "On \u{201c}nee\u{201d}", "Rhythm only"]
        case .percussion: return ["Hands separately", "Sticking pattern"]
        case .other: return []
        }
    }
}

extension PracticeStore {
    /// One-tap instrument switch (§6): exactly one non-deleted instrument is primary at a time.
    /// `TodayView`/`WarmupsView` read `primaryInstrument` to decide which family's defaults/warmups
    /// to show; a piece keeps its own `instrumentID` independently and is never changed by this.
    public func setPrimaryInstrument(_ id: UUID) throws {
        for instrument in state.instruments where instrument.deletedAt == nil {
            let shouldBePrimary = instrument.id == id
            if instrument.isPrimary != shouldBePrimary {
                var updated = instrument; updated.isPrimary = shouldBePrimary
                try saveInstrument(updated)
            }
        }
    }

    public var primaryInstrument: Instrument? {
        let live = state.instruments.filter { $0.deletedAt == nil }
        return live.first { $0.isPrimary } ?? live.first
    }
}
