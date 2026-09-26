import Foundation
import XCTest
@testable import PraeludeCore

final class MetronomeTimingTests: XCTestCase {
    /// The exact bar length `MetronomeService`/`MetronomePattern` compute for a bar buffer.
    private func barFrames(bpm: Double, beatsPerBar: Int, sampleRate: Double) -> Int64 {
        Int64((sampleRate * 60 / bpm * Double(beatsPerBar)).rounded())
    }

    // MARK: - §13/§17a: 10 minutes at 120 BPM, zero cumulative drift.

    func testTenMinutesAt120BPMNeverDriftsFromExactBarBoundaries() {
        let sampleRate = 48_000.0
        let bpm = 120.0, beatsPerBar = 4, subdivision = 1
        let frames = barFrames(bpm: bpm, beatsPerBar: beatsPerBar, sampleRate: sampleRate)
        let totalSamples = Int64(sampleRate * 600) // 10 minutes
        let expectedBars = totalSamples / frames

        // Every exact bar boundary must read as beat 1, bar k — for every one of ~600 bars, not
        // just the first few. A drifting implementation would accumulate rounding error and this
        // would eventually disagree; this one recomputes from the absolute sample count every time.
        for bar in stride(from: Int64(0), to: expectedBars, by: 1) {
            let position = try! XCTUnwrap(MetronomeClock.position(sampleTime: bar * frames, barFrames: frames,
                                                                   beatsPerBar: beatsPerBar, subdivision: subdivision))
            XCTAssertEqual(position.barIndex, bar)
            XCTAssertEqual(position.beat, 1)
            XCTAssertEqual(position.beatProgress, 0, accuracy: 1e-9)
        }
        // One sample before the next bar boundary is still the last bar, at its last beat.
        let lastBoundary = expectedBars * frames
        let justBefore = try! XCTUnwrap(MetronomeClock.position(sampleTime: lastBoundary - 1, barFrames: frames,
                                                                 beatsPerBar: beatsPerBar, subdivision: subdivision))
        XCTAssertEqual(justBefore.barIndex, expectedBars - 1)
        XCTAssertEqual(justBefore.beat, beatsPerBar)
    }

    func testPositionIsAPureFunctionOfSampleTimeUnderSimulatedIrregularPolling() {
        // Simulate a busy main thread: poll at wildly irregular, sometimes-late sample times
        // (never the clean 33ms cadence `MetronomeService` normally uses) across the full 10
        // minutes, and assert every reading still agrees exactly with the direct formula. A
        // design that accumulated state between polls (rather than recomputing from `sampleTime`)
        // would disagree once polls stopped landing on a regular grid.
        let sampleRate = 48_000.0
        let frames = barFrames(bpm: 120, beatsPerBar: 4, sampleRate: sampleRate)
        var generator = SplitMix64(seed: 42)
        var sampleTime: Int64 = 0
        let totalSamples = Int64(sampleRate * 600)
        var checks = 0
        while sampleTime < totalSamples {
            // A "frame" of irregular, sometimes-large jitter standing in for scheduling delay.
            let jitterMs = Int64.random(in: 5...400, using: &generator)
            sampleTime += Int64(Double(jitterMs) * sampleRate / 1000)
            guard sampleTime < totalSamples else { break }
            let position = try! XCTUnwrap(MetronomeClock.position(sampleTime: sampleTime, barFrames: frames, beatsPerBar: 4, subdivision: 2))
            let expectedBar = sampleTime / frames
            XCTAssertEqual(position.barIndex, expectedBar)
            let withinBar = sampleTime % frames
            let expectedBeat = min(4, Int(Double(withinBar) / Double(frames) * 4) + 1)
            XCTAssertEqual(position.beat, expectedBeat)
            checks += 1
        }
        XCTAssertGreaterThan(checks, 1_000, "The jitter simulation should exercise a large number of polls")
    }

    func testSubdivisionAndPulseCounting() throws {
        let frames = barFrames(bpm: 90, beatsPerBar: 3, sampleRate: 44_100)
        // Exactly halfway through the bar, at 2 pulses/beat and 3 beats/bar: exactly the boundary
        // between beat 2's two pulses, which (like `beat` itself) reads as the pulse just entered.
        let midBar = try XCTUnwrap(MetronomeClock.position(sampleTime: frames / 2, barFrames: frames, beatsPerBar: 3, subdivision: 2))
        XCTAssertEqual(midBar.beat, 2)
        XCTAssertEqual(midBar.pulse, 4)
        // A point clearly inside beat 2's first pulse (continuous position 1.25 of 3).
        let earlyInBeat2 = try XCTUnwrap(MetronomeClock.position(sampleTime: Int64(Double(frames) * 1.25 / 3), barFrames: frames, beatsPerBar: 3, subdivision: 2))
        XCTAssertEqual(earlyInBeat2.beat, 2)
        XCTAssertEqual(earlyInBeat2.pulse, 3)
    }

    func testInvalidInputsReturnNil() {
        XCTAssertNil(MetronomeClock.position(sampleTime: -1, barFrames: 1000, beatsPerBar: 4, subdivision: 1))
        XCTAssertNil(MetronomeClock.position(sampleTime: 0, barFrames: 0, beatsPerBar: 4, subdivision: 1))
        XCTAssertNil(MetronomeClock.position(sampleTime: 0, barFrames: 1000, beatsPerBar: 0, subdivision: 1))
        XCTAssertNil(MetronomeClock.position(sampleTime: 0, barFrames: 1000, beatsPerBar: 4, subdivision: 0))
    }

    // MARK: - Count-in

    func testCountInBarsPrecedeTheMusicAndAreFlagged() throws {
        let frames = barFrames(bpm: 100, beatsPerBar: 4, sampleRate: 48_000)
        let duringCountIn = try XCTUnwrap(MetronomeClock.position(sampleTime: frames / 2, barFrames: frames,
                                                                  beatsPerBar: 4, subdivision: 1, countInBars: 2))
        XCTAssertTrue(duringCountIn.isCountIn)
        XCTAssertEqual(duringCountIn.barIndex, 0)

        let stillCountIn = try XCTUnwrap(MetronomeClock.position(sampleTime: frames + frames / 2, barFrames: frames,
                                                                  beatsPerBar: 4, subdivision: 1, countInBars: 2))
        XCTAssertTrue(stillCountIn.isCountIn)
        XCTAssertEqual(stillCountIn.barIndex, 1)

        let afterCountIn = try XCTUnwrap(MetronomeClock.position(sampleTime: 2 * frames, barFrames: frames,
                                                                  beatsPerBar: 4, subdivision: 1, countInBars: 2))
        XCTAssertFalse(afterCountIn.isCountIn)
        XCTAssertEqual(afterCountIn.barIndex, 0, "The music's own bar count restarts from zero after count-in")
        XCTAssertEqual(afterCountIn.beat, 1)
    }

    func testZeroCountInStartsMusicImmediately() throws {
        let frames = barFrames(bpm: 100, beatsPerBar: 4, sampleRate: 48_000)
        let position = try XCTUnwrap(MetronomeClock.position(sampleTime: 0, barFrames: frames, beatsPerBar: 4, subdivision: 1, countInBars: 0))
        XCTAssertFalse(position.isCountIn)
    }

    // MARK: - R14 pulse-check dropout plan

    func testDropoutPlanMarksExactlyTheOffBarsInEachCycle() {
        let plan = MetronomeDropoutPlan(barsOn: 4, barsOff: 2)
        let expectedSilence = (0..<12).map(plan.isSilent(barIndex:))
        XCTAssertEqual(expectedSilence, [false, false, false, false, true, true,
                                        false, false, false, false, true, true])
    }

    func testDropoutPlanValidity() {
        XCTAssertTrue(MetronomeDropoutPlan(barsOn: 2, barsOff: 2).isValid)
        XCTAssertFalse(MetronomeDropoutPlan(barsOn: 0, barsOff: 2).isValid)
        XCTAssertFalse(MetronomeDropoutPlan(barsOn: 2, barsOff: 0).isValid)
        XCTAssertFalse(MetronomeDropoutPlan(barsOn: 100, barsOff: 2).isValid)
    }

    func testPositionAppliesDropoutPlanAfterCountIn() throws {
        let frames = barFrames(bpm: 120, beatsPerBar: 4, sampleRate: 48_000)
        let plan = MetronomeDropoutPlan(barsOn: 1, barsOff: 1)
        let bar0 = try XCTUnwrap(MetronomeClock.position(sampleTime: 0, barFrames: frames, beatsPerBar: 4, subdivision: 1,
                                                          countInBars: 1, dropoutPlan: plan))
        XCTAssertTrue(bar0.isCountIn)
        XCTAssertFalse(bar0.isSilentBar, "Count-in is never silenced by the dropout plan")

        let musicBar0 = try XCTUnwrap(MetronomeClock.position(sampleTime: frames, barFrames: frames, beatsPerBar: 4, subdivision: 1,
                                                               countInBars: 1, dropoutPlan: plan))
        XCTAssertFalse(musicBar0.isSilentBar)
        let musicBar1 = try XCTUnwrap(MetronomeClock.position(sampleTime: 2 * frames, barFrames: frames, beatsPerBar: 4, subdivision: 1,
                                                               countInBars: 1, dropoutPlan: plan))
        XCTAssertTrue(musicBar1.isSilentBar)
    }

    func testInvalidDropoutPlanNeverSilences() {
        let invalid = MetronomeDropoutPlan(barsOn: 0, barsOff: 5)
        for bar in Int64(0)..<20 { XCTAssertFalse(invalid.isSilent(barIndex: bar)) }
    }
}

/// A tiny deterministic PRNG so the jitter test is reproducible across runs and platforms.
private struct SplitMix64: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state = state &+ 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}
