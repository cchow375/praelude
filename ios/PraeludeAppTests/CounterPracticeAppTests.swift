import Foundation
import UIKit
import XCTest
@testable import Praelude

final class CounterPracticeAppTests: XCTestCase {
    func testTempoPercentagesRespectSupportedBoundsAndDoNotMutateASet() {
        let set = ActiveSet(sessionID: UUID(), configuration: PracticeConfiguration(pieceID: UUID(), startBPM: 72, targetBPM: 120))
        XCTAssertEqual(CounterPracticeTools.percentageTempo(50, reference: 120), 60)
        XCTAssertEqual(CounterPracticeTools.percentageTempo(75, reference: 120), 90)
        XCTAssertEqual(CounterPracticeTools.percentageTempo(100, reference: 120), 120)
        XCTAssertEqual(CounterPracticeTools.percentageTempo(50, reference: 20), 20)
        XCTAssertEqual(CounterPracticeTools.percentageTempo(100, reference: 500), 300)
        XCTAssertEqual(CounterPracticeTools.boundedTempo(.infinity), 60)
        XCTAssertEqual(set.currentBPM, 72)
        XCTAssertTrue(set.attempts.isEmpty)
    }

    func testElapsedTimeCountsOnlyTheRunningTimeSinceTheLastDurableCheckpoint() {
        let now = Date(timeIntervalSince1970: 1_000)
        var set = ActiveSet(sessionID: UUID(), configuration: PracticeConfiguration(pieceID: UUID()), startedAt: now.addingTimeInterval(-100))
        set.activeSeconds = 65
        set.lastCheckpoint = now.addingTimeInterval(-5)
        XCTAssertEqual(CounterPracticeTools.elapsed(set, at: now), 70)
        set.status = .paused
        XCTAssertEqual(CounterPracticeTools.elapsed(set, at: now.addingTimeInterval(60)), 65)
        set.status = .completed
        XCTAssertEqual(CounterPracticeTools.elapsed(set, at: now.addingTimeInterval(120)), 65)
        set.status = .running
        set.lastCheckpoint = now.addingTimeInterval(10)
        XCTAssertEqual(CounterPracticeTools.elapsed(set, at: now), 65)
    }

    func testRestExpiresWithoutCreatingARepetitionOrResumingPractice() {
        let now = Date(timeIntervalSince1970: 1_000)
        var set = ActiveSet(sessionID: UUID(), configuration: PracticeConfiguration(pieceID: UUID()))
        set.status = .paused
        XCTAssertEqual(CounterPracticeTools.remainingRest(until: now.addingTimeInterval(30), at: now), 30)
        XCTAssertEqual(CounterPracticeTools.remainingRest(until: now.addingTimeInterval(30), at: now.addingTimeInterval(29.1)), 1)
        XCTAssertEqual(CounterPracticeTools.remainingRest(until: now.addingTimeInterval(30), at: now.addingTimeInterval(31)), 0)
        XCTAssertEqual(CounterPracticeTools.remainingRest(until: nil, at: now), 0)
        XCTAssertEqual(CounterPracticeTools.duration(125), "2:05")
        XCTAssertEqual(set.status, .paused)
        XCTAssertTrue(set.attempts.isEmpty)
    }

    func testExtremeRemoteDurationAndRestDatesCannotTrapIntegerConversion() {
        let now = Date(timeIntervalSince1970: 1_000)
        XCTAssertFalse(CounterPracticeTools.duration(.greatestFiniteMagnitude).isEmpty)
        XCTAssertFalse(CounterPracticeTools.duration(.infinity).isEmpty)
        XCTAssertFalse(CounterPracticeTools.duration(.nan).isEmpty)
        XCTAssertEqual(CounterPracticeTools.remainingRest(until: now.addingTimeInterval(-Double.greatestFiniteMagnitude), at: now), 0)
        XCTAssertGreaterThanOrEqual(CounterPracticeTools.remainingRest(until: Date(timeIntervalSince1970: .greatestFiniteMagnitude), at: now), 0)
        XCTAssertGreaterThanOrEqual(CounterPracticeTools.remainingRest(until: Date(timeIntervalSince1970: .infinity), at: now), 0)
    }

    @MainActor func testCounterClickOffSurvivesTempoChangesAndResumeUntilExplicitlyStarted() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Counter-Click-\(UUID().uuidString)")
        let suite = "Praelude-Counter-Click-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = PracticeStore(directory: directory)
        let feedback = FeedbackService(defaults: defaults)
        feedback.isEnabled = false
        let metronome = MetronomeService(defaults: defaults)
        let speech = SpeechCommandService()
        let recording = RecordingService(defaults: defaults)
        let runtime = PracticeRuntime(store: store, metronome: metronome, speech: speech, recording: recording, feedback: feedback)
        defer {
            feedback.stop(); metronome.stop(); speech.stop(); recording.stopPlayback()
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        let piece = Piece(title: "Synthetic click control")
        try store.addPiece(piece)
        let configuration = PracticeConfiguration(pieceID: piece.id, targetCount: 10, startBPM: 72, targetBPM: 120, useMetronome: true)
        try store.startSet(configuration)
        let originalSetID = try XCTUnwrap(store.activeSet?.id)
        runtime.refreshMetronome(for: store.activeSet, applicationIsActive: true)
        XCTAssertTrue(metronome.isPlaying, metronome.errorMessage ?? "The initial set click should start")
        let beforeToggle = try Data(contentsOf: store.fileURL)
        runtime.setMetronomePlaying(false, for: store.activeSet)
        XCTAssertFalse(metronome.isPlaying)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), beforeToggle, "A sound preference must not fabricate a repetition or rewrite history")

        try store.adjustActiveTempo(77)
        runtime.refreshMetronome(for: store.activeSet, applicationIsActive: true)
        XCTAssertEqual(metronome.bpm, 77)
        XCTAssertFalse(metronome.isPlaying, "Tempo nudges must respect the explicit click-off choice")
        try store.pause()
        runtime.refreshMetronome(for: store.activeSet, applicationIsActive: true)
        try store.resume()
        runtime.refreshMetronome(for: store.activeSet, applicationIsActive: true)
        XCTAssertFalse(metronome.isPlaying, "Pause/resume must preserve the current set's explicit click-off choice")

        runtime.setMetronomePlaying(true, for: store.activeSet)
        XCTAssertTrue(metronome.isPlaying, metronome.errorMessage ?? "An explicit start should clear the override")
        XCTAssertEqual(metronome.bpm, 77)
        XCTAssertTrue(store.activeSet?.attempts.isEmpty == true)
        runtime.setMetronomePlaying(false, for: store.activeSet)
        try store.endSet()
        runtime.refreshMetronome(for: nil, applicationIsActive: true)
        try store.startSet(configuration)
        XCTAssertNotEqual(store.activeSet?.id, originalSetID)
        runtime.refreshMetronome(for: store.activeSet, applicationIsActive: true)
        XCTAssertTrue(metronome.isPlaying, "A different set must not inherit the earlier set's temporary off override")
    }

    @MainActor func testCounterAwakePolicyIsOptInRunningOnlyAndReleasesItsOwnWindow() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Counter-\(UUID().uuidString)")
        let suite = "Praelude-Counter-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = PracticeStore(directory: directory)
        let feedback = FeedbackService(defaults: defaults)
        feedback.isEnabled = false
        let metronome = MetronomeService(defaults: defaults)
        let speech = SpeechCommandService()
        let recording = RecordingService(defaults: defaults)
        let runtime = PracticeRuntime(store: store, metronome: metronome, speech: speech, recording: recording, feedback: feedback)
        let prior = UIApplication.shared.isIdleTimerDisabled
        let counter = UUID(), score = UUID()
        let foreground = UIApplication.shared.applicationState == .active
        defer {
            runtime.scoreDisappeared(ownerID: counter); runtime.scoreDisappeared(ownerID: score)
            UIApplication.shared.isIdleTimerDisabled = prior
            feedback.stop(); metronome.stop(); speech.stop(); recording.stopPlayback()
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        UIApplication.shared.isIdleTimerDisabled = false
        runtime.scoreAppeared(ownerID: counter)
        runtime.setCounterScreenPolicy(ownerID: counter, enabled: false, isRunning: true)
        XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        runtime.setCounterScreenPolicy(ownerID: counter, enabled: true, isRunning: true)
        XCTAssertEqual(UIApplication.shared.isIdleTimerDisabled, foreground)
        runtime.setCounterScreenPolicy(ownerID: counter, enabled: true, isRunning: false)
        XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        runtime.scoreAppeared(ownerID: score)
        XCTAssertEqual(UIApplication.shared.isIdleTimerDisabled, foreground, "A paused counter cannot release another score window's awake request")
        runtime.scoreDisappeared(ownerID: score)
        XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled)
        runtime.scoreDisappeared(ownerID: counter)
        XCTAssertFalse(UIApplication.shared.isIdleTimerDisabled, "The original idle-timer value is restored after the last window exits")
        let bytes = try? Data(contentsOf: store.fileURL)
        XCTAssertNil(bytes, "Changing presentation or awake policy must not create practice data")
    }
}
