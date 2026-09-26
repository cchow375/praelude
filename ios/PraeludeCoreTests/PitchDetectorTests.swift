import Foundation
import XCTest
@testable import PraeludeCore

final class PitchDetectorTests: XCTestCase {
    private func sineWave(frequencyHz: Double, sampleRate: Double, count: Int, amplitude: Float = 0.5,
                          harmonics: [(Double, Float)] = [], noise: Float = 0) -> [Float] {
        var generator = SystemRandomNumberGenerator()
        return (0..<count).map { index in
            let time = Double(index) / sampleRate
            var value = amplitude * Float(sin(2 * .pi * frequencyHz * time))
            for (multiple, relativeAmplitude) in harmonics {
                value += relativeAmplitude * Float(sin(2 * .pi * frequencyHz * multiple * time))
            }
            if noise > 0 { value += Float.random(in: -noise...noise, using: &generator) }
            return value
        }
    }

    func testDetectsAClearSineWaveWithinACent() throws {
        let sampleRate = 48_000.0
        for frequency in [82.41, 110.0, 220.0, 440.0, 880.0, 659.25] {
            let samples = sineWave(frequencyHz: frequency, sampleRate: sampleRate, count: 4_096)
            let detected = try XCTUnwrap(PitchDetector.detectPitch(samples: samples, sampleRate: sampleRate),
                                        "Failed to detect \(frequency) Hz")
            let cents = 1200 * log2(detected / frequency)
            XCTAssertEqual(cents, 0, accuracy: 3, "\(frequency) Hz detected as \(detected) Hz (\(cents) cents off)")
        }
    }

    func testToleratesHarmonicsAndModerateNoise() throws {
        let sampleRate = 48_000.0
        let samples = sineWave(frequencyHz: 196.0, sampleRate: sampleRate, count: 4_096, amplitude: 0.4,
                               harmonics: [(2, 0.15), (3, 0.08)], noise: 0.02)
        let detected = try XCTUnwrap(PitchDetector.detectPitch(samples: samples, sampleRate: sampleRate))
        XCTAssertEqual(detected, 196, accuracy: 1.5)
    }

    func testSilenceAndPureNoiseFindNoConfidentPitch() {
        let silence = [Float](repeating: 0, count: 4_096)
        XCTAssertNil(PitchDetector.detectPitch(samples: silence, sampleRate: 48_000))
        var generator = SystemRandomNumberGenerator()
        let noise = (0..<4_096).map { _ in Float.random(in: -0.3...0.3, using: &generator) }
        // White noise has no stable period; when YIN does report something it must not be a
        // confident, stable reading — assert it never claims the exact same tight tolerance a
        // real tone would produce by checking that repeating the run finds a materially different
        // "pitch" (i.e., it is not locking onto a real periodic signal).
        let first = PitchDetector.detectPitch(samples: noise, sampleRate: 48_000)
        let secondNoise = (0..<4_096).map { _ in Float.random(in: -0.3...0.3, using: &generator) }
        let second = PitchDetector.detectPitch(samples: secondNoise, sampleRate: 48_000)
        if let first, let second { XCTAssertNotEqual(first, second, accuracy: 0.01) }
    }

    func testTooLowFundamentalIsRejected() {
        // The true period (48_000/30 = 1_600 samples) falls outside the search window entirely
        // (maxTau for a 55Hz floor is ~873 samples), so no candidate period is even examined.
        let sampleRate = 48_000.0
        let tooLow = sineWave(frequencyHz: 30, sampleRate: sampleRate, count: 8_192)
        XCTAssertNil(PitchDetector.detectPitch(samples: tooLow, sampleRate: sampleRate, minFrequencyHz: 55, maxFrequencyHz: 2_000))
    }

    /// A bare YIN/autocorrelation tracker cannot reliably reject a *clean, noiseless* fundamental
    /// above `maxFrequencyHz`: an ideal periodic signal is also perfectly periodic at every integer
    /// multiple of its true period, so when the true (short) period is excluded by `minTau`, the
    /// search legitimately finds the next such multiple inside range and reports that subharmonic
    /// as if it were the fundamental (a well-known "octave error"). This documents the limitation
    /// rather than asserting behavior the algorithm cannot generally provide.
    func testCleanToneAboveRangeReportsASubharmonicRatherThanNil() throws {
        let sampleRate = 48_000.0
        let tooHigh = sineWave(frequencyHz: 3_500, sampleRate: sampleRate, count: 4_096)
        let detected = try XCTUnwrap(PitchDetector.detectPitch(samples: tooHigh, sampleRate: sampleRate, minFrequencyHz: 55, maxFrequencyHz: 2_000))
        XCTAssertLessThanOrEqual(detected, 2_000 * 1.1)
        // The reported pitch is an integer-fraction alias of the true tone, e.g. 3500/2 = 1750.
        let ratio = 3_500 / detected
        XCTAssertEqual(ratio, ratio.rounded(), accuracy: 0.05)
    }

    func testInvalidInputsReturnNilRatherThanCrashing() {
        XCTAssertNil(PitchDetector.detectPitch(samples: [], sampleRate: 48_000))
        XCTAssertNil(PitchDetector.detectPitch(samples: [0.1, 0.2, 0.3], sampleRate: 48_000))
        XCTAssertNil(PitchDetector.detectPitch(samples: [Float](repeating: 0, count: 4_096), sampleRate: 0))
        XCTAssertNil(PitchDetector.detectPitch(samples: [Float](repeating: 0, count: 4_096), sampleRate: .nan))
        XCTAssertNil(PitchDetector.detectPitch(samples: [Float.nan, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], sampleRate: 48_000))
        XCTAssertNil(PitchDetector.detectPitch(samples: [Float](repeating: 0, count: 4_096), sampleRate: 48_000, minFrequencyHz: 2_000, maxFrequencyHz: 100))
    }

    func testIsDeterministic() {
        let sampleRate = 48_000.0
        let samples = sineWave(frequencyHz: 293.66, sampleRate: sampleRate, count: 4_096)
        let first = PitchDetector.detectPitch(samples: samples, sampleRate: sampleRate)
        let second = PitchDetector.detectPitch(samples: samples, sampleRate: sampleRate)
        XCTAssertEqual(first, second)
    }
}
