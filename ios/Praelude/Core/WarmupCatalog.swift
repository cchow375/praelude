import Foundation

/// The built-in warmup library (§12): "major, all minor forms, modes, chromatic, thirds/sixths/
/// octaves where relevant" crossed with every key, seeded once per instrument family the player
/// onboards with. A static, code-defined catalog — like `InstrumentCatalog` — that becomes real,
/// persisted `WarmupExercise` rows only at seed time, so favorites/last-used/rotation state (which
/// lives on the row itself, see "Warmups.swift") has something stable to attach to.
public enum WarmupCatalog {
    /// The 12 keys in circle-of-fifths order, starting at C. `WarmupsView`'s key picker and
    /// `WarmupRotation`'s neglected-key detection both walk this same order.
    public static let circleOfFifths = ["C", "G", "D", "A", "E", "B", "F\u{266f}", "D\u{266d}", "A\u{266d}", "E\u{266d}", "B\u{266d}", "F"]

    public struct Template: Equatable, Sendable {
        public let kind: WarmupKind
        public let mode: ScaleMode?
        public let nameSuffix: String
    }

    /// One row's worth of scale/arpeggio/technique shapes for a key, before crossing with all 12 keys.
    public static func templates(for family: InstrumentFamily) -> [Template] {
        var templates: [Template] = [
            Template(kind: .scale, mode: .major, nameSuffix: "major"),
            Template(kind: .scale, mode: .naturalMinor, nameSuffix: "natural minor"),
            Template(kind: .scale, mode: .harmonicMinor, nameSuffix: "harmonic minor"),
            Template(kind: .scale, mode: .melodicMinor, nameSuffix: "melodic minor"),
            Template(kind: .scale, mode: .dorian, nameSuffix: "dorian"),
            Template(kind: .scale, mode: .phrygian, nameSuffix: "phrygian"),
            Template(kind: .scale, mode: .lydian, nameSuffix: "lydian"),
            Template(kind: .scale, mode: .mixolydian, nameSuffix: "mixolydian"),
            Template(kind: .scale, mode: .locrian, nameSuffix: "locrian"),
            Template(kind: .exercise, mode: .chromatic, nameSuffix: "chromatic"),
            Template(kind: .arpeggio, mode: .major, nameSuffix: "major arpeggio"),
            Template(kind: .arpeggio, mode: .naturalMinor, nameSuffix: "minor arpeggio"),
        ]
        switch family {
        case .keyboard:
            templates += [
                Template(kind: .exercise, mode: .thirds, nameSuffix: "in thirds"),
                Template(kind: .exercise, mode: .sixths, nameSuffix: "in sixths"),
                Template(kind: .exercise, mode: .octaves, nameSuffix: "in octaves"),
            ]
        case .strings:
            templates += [
                Template(kind: .exercise, mode: .thirds, nameSuffix: "in thirds"),
                Template(kind: .exercise, mode: .sixths, nameSuffix: "in sixths"),
            ]
        case .woodwinds, .brass, .percussion, .voice, .pluckedStrings, .other:
            break
        }
        return templates
    }

    /// Every built-in exercise for one family, crossed across all 12 keys — fresh `WarmupExercise`
    /// values (new random ids) ready to persist with `PracticeStore.saveWarmupExercise`. Callers
    /// seed once per family (see `PracticeStore.seedWarmupsIfNeeded`) so re-onboarding an already
    ///-seeded family never duplicates rows.
    /// A sensible starting tempo per exercise shape, so starting a warmup never needs a setup modal
    /// (§10a: "never a modal or keyboard") — the HUD's own tempo control can still be adjusted.
    public static func defaultBPM(for kind: WarmupKind) -> Double {
        switch kind {
        case .scale: return 72
        case .arpeggio: return 66
        case .exercise: return 60
        case .custom: return 60
        }
    }

    public static func seedDefaults(family: InstrumentFamily) -> [WarmupExercise] {
        circleOfFifths.flatMap { key in
            templates(for: family).map { template in
                WarmupExercise(kind: template.kind, key: key, mode: template.mode, instrumentFamily: family,
                                name: "\(key) \(template.nameSuffix)")
            }
        }
    }
}

extension PracticeStore {
    /// Seeds the built-in library for `family` the first time it is needed (onboarding, or adding a
    /// further instrument later) and is a no-op on every later call for that same family, so it is
    /// safe to call opportunistically rather than only once at a single call site.
    public func seedWarmupsIfNeeded(family: InstrumentFamily) throws {
        guard !state.warmupExercises.contains(where: { $0.instrumentFamily == family && $0.deletedAt == nil }) else { return }
        try saveWarmupExercises(WarmupCatalog.seedDefaults(family: family))
    }
}
