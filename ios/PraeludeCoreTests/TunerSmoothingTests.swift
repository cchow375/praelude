import Foundation
import XCTest
@testable import PraeludeCore

final class TunerSmoothingTests: XCTestCase {
    func testStableToneReadsBackExactly() {
        var smoother = TunerSmoother()
        for _ in 0..<5 { XCTAssertEqual(smoother.ingest(440), 440) }
    }

    func testSingleBufferJitterIsDampedByTheMedian() {
        var smoother = TunerSmoother(historyLimit: 5, silenceGrace: 4)
        _ = smoother.ingest(440); _ = smoother.ingest(440); _ = smoother.ingest(440)
        // One wild outlier buffer (e.g. a transient) should not swing the displayed reading to it.
        let afterOutlier = smoother.ingest(220)
        XCTAssertEqual(afterOutlier, 440)
    }

    func testDoesNotClearOnASingleSilentBuffer() {
        var smoother = TunerSmoother(historyLimit: 5, silenceGrace: 4)
        _ = smoother.ingest(440)
        XCTAssertEqual(smoother.ingest(nil), 440, "One silent buffer between attacks should not blank the display")
        XCTAssertEqual(smoother.ingest(nil), 440)
        XCTAssertEqual(smoother.ingest(nil), 440)
    }

    func testClearsAfterSustainedSilence() {
        var smoother = TunerSmoother(historyLimit: 5, silenceGrace: 4)
        _ = smoother.ingest(440)
        for _ in 0..<3 { _ = smoother.ingest(nil) }
        XCTAssertEqual(smoother.currentFrequencyHz, 440, "Still within grace period")
        XCTAssertNil(smoother.ingest(nil), "Grace period exceeded")
        XCTAssertNil(smoother.currentFrequencyHz)
    }

    func testANewToneAfterSilenceIsNotBlendedWithTheOldOne() {
        var smoother = TunerSmoother(historyLimit: 5, silenceGrace: 2)
        _ = smoother.ingest(440)
        _ = smoother.ingest(nil); _ = smoother.ingest(nil) // clears
        XCTAssertNil(smoother.currentFrequencyHz)
        XCTAssertEqual(smoother.ingest(220), 220, "History was cleared, so the new note reads immediately, not averaged with 440")
    }

    func testGraduallyBendingPitchTracksTowardTheNewValue() {
        var smoother = TunerSmoother(historyLimit: 3, silenceGrace: 4)
        _ = smoother.ingest(440); _ = smoother.ingest(440)
        _ = smoother.ingest(445)
        let result = smoother.ingest(450)
        // history is now [440, 445, 450] (limit 3) -> median 445, moving toward the bend.
        XCTAssertEqual(result, 445)
    }

    func testResetClearsHistoryAndSilenceCounter() {
        var smoother = TunerSmoother()
        _ = smoother.ingest(440)
        smoother.reset()
        XCTAssertNil(smoother.currentFrequencyHz)
        XCTAssertEqual(smoother.ingest(220), 220, "A fresh reading right after reset should not be blended with pre-reset history")
    }

    func testNonFiniteInputIsTreatedAsSilence() {
        var smoother = TunerSmoother(historyLimit: 5, silenceGrace: 1)
        _ = smoother.ingest(440)
        XCTAssertNil(smoother.ingest(.nan))
    }
}
