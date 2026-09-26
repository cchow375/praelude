import Foundation
import XCTest
@testable import PraeludeCore

final class DronePatternTests: XCTestCase {
    func testActualFrequencyStaysWithinAFractionOfACentOfRequested() throws {
        for frequency in [27.5, 55, 110, 196, 261.63, 440, 880, 1_760, 3_000] {
            for timbre in DroneTimbre.allCases {
                let pattern = try DronePattern(frequencyHz: frequency, sampleRate: 48_000, timbre: timbre)
                let cents = 1200 * log2(pattern.actualFrequencyHz / frequency)
                XCTAssertEqual(cents, 0, accuracy: 0.05, "\(timbre) at \(frequency) Hz drifted \(cents) cents")
            }
        }
    }

    func testLoopBoundaryIsContinuousForEveryTimbre() throws {
        // The buffer must be able to repeat with no seam: the sample the render formula would
        // produce one frame past the end must equal the sample at frame 0, for every timbre.
        for timbre in DroneTimbre.allCases {
            let pattern = try DronePattern(frequencyHz: 220, sampleRate: 48_000, timbre: timbre)
            let samples = pattern.renderSamples()
            // Re-derive the sample at `frameCount` (one past the buffer) the same way renderSamples does.
            let harmonics: [(Int, Double)]
            switch timbre {
            case .sine: harmonics = [(1, 0.62)]
            case .warm: harmonics = [(1, 0.56), (2, 0.22), (3, 0.09), (4, 0.05)]
            case .reed: harmonics = [(1, 0.42), (2, 0.06), (3, 0.22), (5, 0.12), (7, 0.06)]
            }
            let phase = 2 * Double.pi * pattern.actualFrequencyHz * Double(pattern.frameCount) / pattern.sampleRate
            var expectedWrap = 0.0
            for (multiple, amplitude) in harmonics { expectedWrap += amplitude * sin(phase * Double(multiple)) }
            XCTAssertEqual(Double(samples[0]), expectedWrap, accuracy: 0.0005,
                           "\(timbre)'s loop boundary is discontinuous (would click every repeat)")
        }
    }

    func testNeverClips() throws {
        for frequency in [30.0, 110, 440, 1_500, 3_800] {
            for timbre in DroneTimbre.allCases {
                let pattern = try DronePattern(frequencyHz: frequency, sampleRate: 44_100, timbre: timbre)
                let samples = pattern.renderSamples()
                XCTAssertTrue(samples.allSatisfy { $0.isFinite && abs($0) < 1 }, "\(timbre) at \(frequency) Hz clips or is non-finite")
            }
        }
    }

    func testTimbresAudiblyDiffer() throws {
        let base = try DronePattern(frequencyHz: 440, sampleRate: 48_000, timbre: .sine).renderSamples()
        let warm = try DronePattern(frequencyHz: 440, sampleRate: 48_000, timbre: .warm).renderSamples()
        let reed = try DronePattern(frequencyHz: 440, sampleRate: 48_000, timbre: .reed).renderSamples()
        XCTAssertNotEqual(base, warm)
        XCTAssertNotEqual(warm, reed)
        XCTAssertNotEqual(base, reed)
    }

    func testRenderIsDeterministic() throws {
        let pattern = try DronePattern(frequencyHz: 329.63, sampleRate: 48_000, timbre: .warm)
        XCTAssertEqual(pattern.renderSamples(), pattern.renderSamples())
    }

    func testRejectsInvalidConfiguration() {
        for frequency in [Double.nan, .infinity, 0, 10, 5_000] {
            XCTAssertThrowsError(try DronePattern(frequencyHz: frequency, sampleRate: 48_000))
        }
        for rate in [Double.nan, .infinity, 0, 7_999, 192_001] {
            XCTAssertThrowsError(try DronePattern(frequencyHz: 440, sampleRate: rate))
        }
        for duration in [Double.nan, .infinity, 0, 0.01, 20] {
            XCTAssertThrowsError(try DronePattern(frequencyHz: 440, sampleRate: 48_000, targetDurationSeconds: duration))
        }
    }

    func testHighPitchStillProducesAReasonablySizedBuffer() throws {
        let pattern = try DronePattern(frequencyHz: 3_800, sampleRate: 48_000, timbre: .sine)
        XCTAssertLessThan(pattern.frameCount, 60_000)
        XCTAssertGreaterThan(pattern.frameCount, 100)
    }
}
