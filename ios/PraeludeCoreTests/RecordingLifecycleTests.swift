import Foundation
import XCTest
@testable import PraeludeCore

final class RecordingLifecycleTests: XCTestCase {
    private let setA = UUID()
    private let setB = UUID()
    private let passage = UUID()

    func testDisabledAndIdleDoesNothing() {
        XCTAssertEqual(RecordingLifecycle.action(enabled: false, activeSetID: nil, activeSetStatus: nil,
                                                  passageID: nil, recordingSetID: nil, isPaused: false), .none)
    }

    func testStartsWhenEnabledAndASetBeginsRunning() {
        XCTAssertEqual(RecordingLifecycle.action(enabled: true, activeSetID: setA, activeSetStatus: .running,
                                                  passageID: passage, recordingSetID: nil, isPaused: false),
                       .start(setID: setA, passageID: passage))
    }

    func testNeverStartsWhenDisabled() {
        XCTAssertEqual(RecordingLifecycle.action(enabled: false, activeSetID: setA, activeSetStatus: .running,
                                                  passageID: passage, recordingSetID: nil, isPaused: false), .none)
    }

    func testDoesNotRestartASetThatIsAlreadyBeingRecordedAndRunning() {
        XCTAssertEqual(RecordingLifecycle.action(enabled: true, activeSetID: setA, activeSetStatus: .running,
                                                  passageID: passage, recordingSetID: setA, isPaused: false), .none)
    }

    func testPausesWhenTheSetPauses() {
        XCTAssertEqual(RecordingLifecycle.action(enabled: true, activeSetID: setA, activeSetStatus: .paused,
                                                  passageID: passage, recordingSetID: setA, isPaused: false), .pause)
    }

    func testStaysPausedWhileTheSetStaysPaused() {
        XCTAssertEqual(RecordingLifecycle.action(enabled: true, activeSetID: setA, activeSetStatus: .paused,
                                                  passageID: passage, recordingSetID: setA, isPaused: true), .none)
    }

    func testResumesWhenTheSetResumes() {
        XCTAssertEqual(RecordingLifecycle.action(enabled: true, activeSetID: setA, activeSetStatus: .running,
                                                  passageID: passage, recordingSetID: setA, isPaused: true), .resume)
    }

    func testFinishesWhenTheSetCompletes() {
        XCTAssertEqual(RecordingLifecycle.action(enabled: true, activeSetID: setA, activeSetStatus: .completed,
                                                  passageID: passage, recordingSetID: setA, isPaused: false), .finish)
    }

    func testFinishesWhenTheSetIsEnded() {
        XCTAssertEqual(RecordingLifecycle.action(enabled: true, activeSetID: setA, activeSetStatus: .ended,
                                                  passageID: passage, recordingSetID: setA, isPaused: false), .finish)
    }

    func testFinishesTheOldTakeWhenADifferentSetBecomesActive() {
        // setA's take is in progress but setB is now the active set — keep setA's audio.
        XCTAssertEqual(RecordingLifecycle.action(enabled: true, activeSetID: setB, activeSetStatus: .running,
                                                  passageID: passage, recordingSetID: setA, isPaused: false), .finish)
    }

    func testFinishesWhenNoSetIsActiveAtAll() {
        XCTAssertEqual(RecordingLifecycle.action(enabled: true, activeSetID: nil, activeSetStatus: nil,
                                                  passageID: nil, recordingSetID: setA, isPaused: false), .finish)
    }

    func testFinishesRatherThanDiscardsWhenThePreferenceIsTurnedOffMidTake() {
        // The user disabled recording while a take was in progress for the still-active set:
        // keep what was captured so far rather than throwing it away.
        XCTAssertEqual(RecordingLifecycle.action(enabled: false, activeSetID: setA, activeSetStatus: .running,
                                                  passageID: passage, recordingSetID: setA, isPaused: false), .finish)
    }

    func testDiscardsWhenTheRecordedSetStatusItselfVanishes() {
        // Same set id is still "active" (e.g. a stale read) but its status is unexpectedly nil —
        // an edge case that should never persist audio it can no longer attribute cleanly.
        XCTAssertEqual(RecordingLifecycle.action(enabled: true, activeSetID: setA, activeSetStatus: nil,
                                                  passageID: passage, recordingSetID: setA, isPaused: false), .discard)
    }

    func testIsDeterministicAndPure() {
        for _ in 0..<100 {
            let a = RecordingLifecycle.action(enabled: true, activeSetID: setA, activeSetStatus: .running,
                                               passageID: passage, recordingSetID: setA, isPaused: true)
            XCTAssertEqual(a, .resume)
        }
    }
}
