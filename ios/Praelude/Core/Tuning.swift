import Foundation

/// Pitch naming and frequency/MIDI conversions shared by the tuner and drone (§13). Pure math —
/// it only names a frequency that was already measured or chosen; it never judges playing.
public enum Tuning {
    public static let defaultReferenceA4 = 440.0
    private static let noteNames = ["C", "C\u{266f}", "D", "D\u{266f}", "E", "F", "F\u{266f}", "G", "G\u{266f}", "A", "A\u{266f}", "B"]

    /// A named, octave-labeled equal-tempered pitch plus how far a measured frequency sits from it.
    public struct NamedPitch: Equatable, Sendable {
        public var name: String
        public var octave: Int
        /// -50...50: cents above/below the nearest equal-tempered pitch (0 is perfectly in tune).
        public var cents: Double
        public var midi: Int
        public init(name: String, octave: Int, cents: Double, midi: Int) {
            self.name = name; self.octave = octave; self.cents = cents; self.midi = midi
        }
        public var label: String { "\(name)\(octave)" }
    }

    /// Fractional MIDI note number (A4 = 69) for a frequency; fractional so cents can be read off it.
    public static func midiNumber(forFrequency frequencyHz: Double, referenceA4: Double = defaultReferenceA4) -> Double? {
        guard frequencyHz.isFinite, frequencyHz > 0, referenceA4.isFinite, referenceA4 > 0 else { return nil }
        return 69 + 12 * log2(frequencyHz / referenceA4)
    }

    /// The frequency of an exact (integer or fractional) MIDI note number.
    public static func frequency(forMIDI midi: Double, referenceA4: Double = defaultReferenceA4) -> Double? {
        guard midi.isFinite, referenceA4.isFinite, referenceA4 > 0 else { return nil }
        return referenceA4 * pow(2, (midi - 69) / 12)
    }

    /// Names the nearest equal-tempered pitch to a measured frequency.
    public static func nearestPitch(forFrequency frequencyHz: Double, referenceA4: Double = defaultReferenceA4) -> NamedPitch? {
        guard let exact = midiNumber(forFrequency: frequencyHz, referenceA4: referenceA4), exact.isFinite,
              exact > Double(Int.min / 2), exact < Double(Int.max / 2) else { return nil }
        let rounded = exact.rounded()
        return namedPitch(forMIDI: Int(rounded), cents: (exact - rounded) * 100)
    }

    /// Names an exact MIDI note number, with a caller-supplied cents deviation.
    public static func namedPitch(forMIDI midi: Int, cents: Double = 0) -> NamedPitch {
        let name = noteNames[((midi % 12) + 12) % 12]
        let octave = Int(floor(Double(midi) / 12.0)) - 1
        return NamedPitch(name: name, octave: octave, cents: cents, midi: midi)
    }

    /// The "written" pitch name for a non-concert-pitch instrument, from an already-named concert
    /// pitch. Transposition shifts by whole semitones only, so the cents deviation (tuning
    /// accuracy) is identical for concert and written names — only the note name/octave differ.
    public static func writtenPitch(fromConcert concert: NamedPitch, transposition: Transposition) -> NamedPitch {
        namedPitch(forMIDI: concert.midi - transposition.writtenToConcertSemitones, cents: concert.cents)
    }
}
