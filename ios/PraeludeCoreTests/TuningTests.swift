import Foundation
import XCTest
@testable import PraeludeCore

final class TuningTests: XCTestCase {
    func testConcertA4IsExactlyInTune() throws {
        let pitch = try XCTUnwrap(Tuning.nearestPitch(forFrequency: 440))
        XCTAssertEqual(pitch.name, "A")
        XCTAssertEqual(pitch.octave, 4)
        XCTAssertEqual(pitch.cents, 0, accuracy: 0.001)
        XCTAssertEqual(pitch.midi, 69)
    }

    func testMiddleCAndOctaveNumbering() throws {
        let c4 = try XCTUnwrap(Tuning.frequency(forMIDI: 60))
        let pitch = try XCTUnwrap(Tuning.nearestPitch(forFrequency: c4))
        XCTAssertEqual(pitch.name, "C")
        XCTAssertEqual(pitch.octave, 4)
        // A0 (lowest piano key) is MIDI 21.
        let a0 = try XCTUnwrap(Tuning.nearestPitch(forFrequency: try XCTUnwrap(Tuning.frequency(forMIDI: 21))))
        XCTAssertEqual(a0.name, "A"); XCTAssertEqual(a0.octave, 0)
    }

    func testSharpFrequencyReadsPositiveCents() throws {
        // 5 cents sharp of A4.
        let sharp = 440.0 * pow(2, 5.0 / 1200.0)
        let pitch = try XCTUnwrap(Tuning.nearestPitch(forFrequency: sharp))
        XCTAssertEqual(pitch.name, "A"); XCTAssertEqual(pitch.octave, 4)
        XCTAssertEqual(pitch.cents, 5, accuracy: 0.01)
    }

    func testFlatFrequencyReadsNegativeCents() throws {
        let flat = 440.0 * pow(2, -12.0 / 1200.0)
        let pitch = try XCTUnwrap(Tuning.nearestPitch(forFrequency: flat))
        XCTAssertEqual(pitch.name, "A"); XCTAssertEqual(pitch.octave, 4)
        XCTAssertEqual(pitch.cents, -12, accuracy: 0.01)
    }

    func testAlternateReferenceA4() throws {
        // At A4=442, concert A played at 442Hz reads exactly in tune again.
        let pitch = try XCTUnwrap(Tuning.nearestPitch(forFrequency: 442, referenceA4: 442))
        XCTAssertEqual(pitch.name, "A"); XCTAssertEqual(pitch.cents, 0, accuracy: 0.001)
        // The same 442Hz read against a 440 reference is a few cents sharp, not in tune.
        let against440 = try XCTUnwrap(Tuning.nearestPitch(forFrequency: 442, referenceA4: 440))
        XCTAssertGreaterThan(against440.cents, 0)
    }

    func testTranspositionPreservesCentsButShiftsNameAndOctave() throws {
        // B-flat trumpet: written pitch sounds a major second (2 semitones) lower in concert pitch.
        let bFlatTrumpet = Transposition(writtenToConcertSemitones: -2, label: "B\u{266d}")
        // Player sounds a concert A4 (440Hz, 3 cents sharp); written note is a major second higher: B4.
        let concert = try XCTUnwrap(Tuning.nearestPitch(forFrequency: 440 * pow(2, 3.0 / 1200.0)))
        let written = Tuning.writtenPitch(fromConcert: concert, transposition: bFlatTrumpet)
        XCTAssertEqual(written.name, "B"); XCTAssertEqual(written.octave, 4)
        XCTAssertEqual(written.cents, concert.cents, "Transposition never changes tuning accuracy, only the name")
        XCTAssertNotEqual(written.label, concert.label)
    }

    func testConcertPitchInstrumentTranspositionIsIdentity() throws {
        let concert = try XCTUnwrap(Tuning.nearestPitch(forFrequency: 261.63))
        let written = Tuning.writtenPitch(fromConcert: concert, transposition: Transposition(writtenToConcertSemitones: 0, label: "Concert"))
        XCTAssertEqual(written, concert)
    }

    func testInvalidInputsReturnNil() {
        XCTAssertNil(Tuning.nearestPitch(forFrequency: 0))
        XCTAssertNil(Tuning.nearestPitch(forFrequency: -10))
        XCTAssertNil(Tuning.nearestPitch(forFrequency: .nan))
        XCTAssertNil(Tuning.nearestPitch(forFrequency: .infinity))
        XCTAssertNil(Tuning.midiNumber(forFrequency: 440, referenceA4: 0))
        XCTAssertNil(Tuning.frequency(forMIDI: .nan))
    }

    func testFrequencyAndMIDIRoundTrip() throws {
        for midi in stride(from: 24, through: 96, by: 3) {
            let frequency = try XCTUnwrap(Tuning.frequency(forMIDI: Double(midi)))
            let back = try XCTUnwrap(Tuning.midiNumber(forFrequency: frequency))
            XCTAssertEqual(back, Double(midi), accuracy: 0.0001)
        }
    }
}
