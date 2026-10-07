import Foundation
import UIKit
import XCTest
@testable import Praelude

final class RuntimeFeedbackTests: XCTestCase {
    @MainActor
    private final class WriteProbe {
        var shouldFail = false
        var feedbackIDsAtWrite: [UUID?] = []
        var committedAttemptIDs: [UUID] = []
    }

    @MainActor
    private struct Fixture {
        let store: PracticeStore
        let runtime: PracticeRuntime
        let feedback: FeedbackService
        let metronome: MetronomeService
        let recording: RecordingService
        let defaults: UserDefaults
        let probe: WriteProbe
    }

    @MainActor
    private func fixture(targetCount: Int = 2, useMetronome: Bool = false) throws -> Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Runtime-\(UUID().uuidString)", isDirectory: true)
        let suite = "Praelude-Runtime-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let feedback = FeedbackService(defaults: defaults)
        feedback.isEnabled = true
        feedback.soundsEnabled = false
        feedback.hapticsEnabled = false
        let probe = WriteProbe()
        let store = PracticeStore(directory: directory, now: { Date(timeIntervalSince1970: 1_700_000_000) }, writeData: { data, url in
            probe.feedbackIDsAtWrite.append(feedback.latest?.id)
            if probe.shouldFail { throw CocoaError(.fileWriteOutOfSpace) }
            try data.write(to: url, options: .atomic)
            // Read the bytes that actually reached disk; the feedback must still be unchanged.
            let persisted = try JSONDecoder().decode(LibraryState.self, from: Data(contentsOf: url))
            probe.committedAttemptIDs = persisted.activeSet?.attempts.map(\.id) ?? []
        })
        let piece = Piece(title: "Synthetic runtime study")
        try store.addPiece(piece)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: targetCount, useMetronome: useMetronome))
        let metronome = MetronomeService(defaults: defaults)
        let speech = SpeechCommandService()
        let recording = RecordingService(defaults: defaults)
        let runtime = PracticeRuntime(store: store, metronome: metronome, speech: speech, recording: recording, feedback: feedback)
        addTeardownBlock {
            await MainActor.run { feedback.stop(); metronome.stop(); speech.stop(); recording.stopPlayback() }
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        return Fixture(store: store, runtime: runtime, feedback: feedback, metronome: metronome, recording: recording, defaults: defaults, probe: probe)
    }

    @MainActor
    func testFeedbackAppearsOnlyAfterTheExactAttemptIsDurablyWritten() async throws {
        let fixture = try fixture()
        let eventID = UUID()
        XCTAssertNil(fixture.feedback.latest)
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: eventID))

        XCTAssertNil(try XCTUnwrap(fixture.probe.feedbackIDsAtWrite.last), "Feedback appeared before the durable write finished")
        XCTAssertEqual(fixture.probe.committedAttemptIDs, [eventID])
        let event = try XCTUnwrap(fixture.feedback.latest)
        let saved = try JSONDecoder().decode(LibraryState.self, from: Data(contentsOf: fixture.store.fileURL))
        XCTAssertEqual(event.id, saved.activeSet?.attempts.last?.id)
        XCTAssertEqual(event.setID, saved.activeSet?.id)
        XCTAssertEqual(event.kind, .clean)
        XCTAssertEqual(event.progress, 0.5)
        XCTAssertFalse(fixture.metronome.isPlaying, "Recording a verdict must not activate audio")
        XCTAssertNil(fixture.feedback.soundError)
    }

    @MainActor
    func testDuplicateIDsAndReopeningRemainSilentWithoutWritingAnotherAttempt() async throws {
        let fixture = try fixture()
        let eventID = UUID()
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: eventID))
        fixture.feedback.stop()
        let beforeRetry = try Data(contentsOf: fixture.store.fileURL)
        XCTAssertFalse(try fixture.runtime.record(.clean, eventID: eventID))
        XCTAssertNil(fixture.feedback.latest)
        XCTAssertEqual(try Data(contentsOf: fixture.store.fileURL), beforeRetry)

        let reopened = PracticeStore(directory: fixture.store.directory)
        let freshFeedback = FeedbackService(defaults: fixture.defaults)
        let speech = SpeechCommandService()
        let runtime = PracticeRuntime(store: reopened, metronome: fixture.metronome, speech: speech, recording: fixture.recording, feedback: freshFeedback)
        defer { freshFeedback.stop(); speech.stop() }
        XCTAssertEqual(reopened.activeSet?.status, .paused)
        XCTAssertNil(freshFeedback.latest, "Reading saved progress must not reward it again")
        let afterReopen = try Data(contentsOf: reopened.fileURL)
        XCTAssertFalse(try runtime.record(.clean, eventID: eventID))
        XCTAssertThrowsError(try runtime.record(.sloppy, eventID: eventID), "A reused event ID cannot change its human verdict")
        XCTAssertNil(freshFeedback.latest)
        XCTAssertEqual(try Data(contentsOf: reopened.fileURL), afterReopen)
        freshFeedback.emit(PracticeFeedbackInput(attemptID: eventID, setID: try XCTUnwrap(reopened.activeSet?.id),
                                               verdict: .clean, progressCount: 1, targetCount: 2, ordinal: 1))
        XCTAssertNil(freshFeedback.latest, "The runtime primes the secondary feedback gate from durable history")
    }

    @MainActor
    func testUndoCancelsCompletionAndResetDoesNotProduceAReward() async throws {
        let fixture = try fixture(targetCount: 1)
        let eventID = UUID()
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: eventID))
        XCTAssertEqual(fixture.feedback.latest?.kind, .set)
        try fixture.runtime.undo()
        XCTAssertNil(fixture.feedback.latest, "Undo must immediately remove the now-invalid completion acknowledgement")
        XCTAssertEqual(fixture.store.activeSet?.status, .paused)
        let saved = try JSONDecoder().decode(LibraryState.self, from: Data(contentsOf: fixture.store.fileURL))
        XCTAssertNotNil(saved.activeSet?.attempts.first?.undoneAt)
        XCTAssertFalse(try fixture.runtime.record(.clean, eventID: eventID))
        XCTAssertNil(fixture.feedback.latest)
        try fixture.store.resume()
        try fixture.runtime.reset()
        XCTAssertNil(fixture.feedback.latest)
        XCTAssertEqual(fixture.store.activeSet?.attempts.last?.verdict, .reset)
        let newID = UUID()
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: newID))
        XCTAssertEqual(fixture.feedback.latest?.id, newID, "A new saved attempt after correction still earns its own acknowledgement")
    }

    @MainActor
    func testFailedSaveIsSilentAndCanRetryTheSameIDWithoutLosingData() async throws {
        let fixture = try fixture()
        let eventID = UUID()
        let beforeState = fixture.store.state
        let beforeBytes = try Data(contentsOf: fixture.store.fileURL)
        fixture.probe.shouldFail = true
        XCTAssertThrowsError(try fixture.runtime.record(.clean, eventID: eventID))
        XCTAssertNil(fixture.feedback.latest)
        XCTAssertEqual(fixture.store.state, beforeState)
        XCTAssertEqual(try Data(contentsOf: fixture.store.fileURL), beforeBytes)
        fixture.probe.shouldFail = false
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: eventID), "A failed write must not consume the reward ID")
        XCTAssertEqual(fixture.feedback.latest?.id, eventID)
        let savedState = fixture.store.state
        fixture.probe.shouldFail = true
        XCTAssertThrowsError(try fixture.runtime.undo())
        XCTAssertEqual(fixture.feedback.latest?.id, eventID, "A failed undo must not claim the saved attempt was removed")
        XCTAssertEqual(fixture.store.state, savedState)
    }

    @MainActor
    func testMetronomeSettingsPersistAndMalformedDefaultsCannotCreateUnsafeAudio() async throws {
        let fixture = try fixture()
        let metronome = fixture.metronome
        metronome.setTempo(96.5)
        metronome.setMeter(beats: 6, denominator: 8)
        metronome.subdivision = 3
        metronome.cycleAccent(at: 2)
        metronome.sound = .bell
        metronome.volume = 0.23
        metronome.hapticsEnabled = true
        let reopened = MetronomeService(defaults: fixture.defaults)
        defer { reopened.stop() }
        XCTAssertEqual(reopened.bpm, 96.5)
        XCTAssertEqual(reopened.beatsPerBar, 6)
        XCTAssertEqual(reopened.denominator, 8)
        XCTAssertEqual(reopened.subdivision, 3)
        XCTAssertEqual(reopened.accents, [.accented, .regular, .accented, .accented, .regular, .regular])
        XCTAssertEqual(reopened.sound, .bell)
        XCTAssertEqual(reopened.volume, 0.23)
        XCTAssertTrue(reopened.hapticsEnabled)
        XCTAssertFalse(reopened.isPlaying, "Persisted settings must never restart the click on launch")
        reopened.bpm = .infinity; reopened.volume = .nan
        XCTAssertEqual(reopened.bpm, 96.5); XCTAssertEqual(reopened.volume, 0.23)
        reopened.bpm = 900; XCTAssertEqual(reopened.bpm, 300)
        reopened.bpm = -5; XCTAssertEqual(reopened.bpm, 20)
        var future = MetronomeSettings(); future.version = 99
        let original = try JSONEncoder().encode(future)
        fixture.defaults.set(original, forKey: "praelude.ios.metronome.v1")
        let fallback = MetronomeService(defaults: fixture.defaults)
        defer { fallback.stop() }
        XCTAssertEqual(fallback.bpm, 80)
        XCTAssertEqual(fallback.beatsPerBar, 4)
        XCTAssertFalse(fallback.isPlaying)
        XCTAssertEqual(fixture.defaults.data(forKey: "praelude.ios.metronome.v1"), original, "Reading unsupported settings must not overwrite them")
    }

    @MainActor
    func testCompoundMetronomePreferencesPersistAndSimpleMeterResetsGrouping() async throws {
        let fixture = try fixture()
        let meter = fixture.metronome
        meter.setMeter(beats: 6, denominator: 8)
        meter.groupedCompoundPulse = true
        meter.setTempo(80)
        meter.countInBars = 2
        meter.keepRunningWhenLocked = true
        meter.subdivision = 3
        XCTAssertEqual(meter.pulsesPerBar, 2)
        XCTAssertEqual(meter.barDurationSeconds, 1.5)
        XCTAssertEqual(meter.pulseAccents, [.accented, .regular])
        let reopened = MetronomeService(defaults: fixture.defaults)
        defer { reopened.stop() }
        XCTAssertTrue(reopened.groupedCompoundPulse)
        XCTAssertEqual(reopened.countInBars, 2)
        XCTAssertTrue(reopened.keepRunningWhenLocked)
        XCTAssertFalse(reopened.isPlaying)
        reopened.setMeter(beats: 4, denominator: 4)
        XCTAssertFalse(reopened.groupedCompoundPulse)
        XCTAssertEqual(reopened.pulsesPerBar, 4)
        XCTAssertEqual(reopened.barDurationSeconds, 3)
    }

    @MainActor
    func testInstrumentCatalogUsesAvailableSystemSymbols() {
        for family in InstrumentFamily.allCases {
            XCTAssertNotNil(UIImage(systemName: family.symbolName), "Missing system symbol for \(family.displayName): \(family.symbolName)")
        }
    }

    // MARK: - §13 recording lifecycle sync
    //
    // These deliberately never call `recording.startTake` with the preference *enabled*: that path
    // exercises a real AVAudioRecorder, which the rest of this suite avoids for any audio-hardware
    // service (see `SpeechCommandService` above — constructed and stopped, never actually started).
    // The disabled/no-op path below is still a genuine integration test of the wiring: it fails if
    // `PracticeRuntime.syncRecording` stops reading `recording.takesEnabled`/`store.activeSet`
    // correctly, or if a future change makes it start recording despite the preference being off.

    @MainActor
    func testRecordingNeverStartsWhileTheTakesPreferenceIsOff() async throws {
        let fixture = try fixture(targetCount: 1)
        XCTAssertFalse(fixture.recording.takesEnabled, "Recording is opt-in; default is off")
        fixture.runtime.syncRecording()
        XCTAssertFalse(fixture.recording.isRecording)
        _ = try fixture.runtime.record(.clean, eventID: UUID())
        fixture.runtime.syncRecording()
        XCTAssertFalse(fixture.recording.isRecording)
        XCTAssertNil(fixture.recording.recordingSetID)
        XCTAssertTrue(fixture.store.recordings.isEmpty)
    }

    @MainActor
    func testTakesEnabledPersistsAcrossRelaunchLikeMetronomeSettings() async throws {
        let fixture = try fixture()
        fixture.recording.takesEnabled = true
        let reopened = RecordingService(defaults: fixture.defaults)
        XCTAssertTrue(reopened.takesEnabled)
        fixture.recording.takesEnabled = false
        XCTAssertFalse(RecordingService(defaults: fixture.defaults).takesEnabled)
    }

    @MainActor
    func testSyncRecordingWithNoActiveSetIsHarmlessAndIdempotent() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-Runtime-\(UUID().uuidString)", isDirectory: true)
        let store = PracticeStore(directory: directory)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "Praelude-Runtime-\(UUID().uuidString)"))
        let metronome = MetronomeService(defaults: defaults)
        let speech = SpeechCommandService()
        let recording = RecordingService(defaults: defaults)
        let runtime = PracticeRuntime(store: store, metronome: metronome, speech: speech, recording: recording)
        defer { metronome.stop(); speech.stop(); try? FileManager.default.removeItem(at: directory) }
        XCTAssertNil(store.activeSet)
        runtime.syncRecording(); runtime.syncRecording(); runtime.syncRecording()
        XCTAssertFalse(recording.isRecording)
        XCTAssertNil(recording.recordingSetID)
    }
    @MainActor func testBackgroundCheckpointPreservesRequestedClickAcrossDelayedForegroundRefresh() async throws {
        let fixture = try fixture(useMetronome: true)
        fixture.metronome.keepRunningWhenLocked = true
        fixture.metronome.start()
        XCTAssertTrue(fixture.metronome.isPlaying, fixture.metronome.errorMessage ?? "Native metronome must start for this lifecycle test")
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        await Task.yield()
        XCTAssertEqual(fixture.store.activeSet?.status, .paused)
        fixture.runtime.refreshMetronome(for: fixture.store.activeSet, applicationIsActive: false)
        XCTAssertTrue(fixture.metronome.isPlaying, "The score observer must retain the explicitly requested click after the runtime checkpoints practice.")
        fixture.runtime.refreshMetronome(for: fixture.store.activeSet, applicationIsActive: true)
        XCTAssertTrue(fixture.metronome.isPlaying, "The background pause observer can arrive after foregrounding; the requested click must survive.")
        try fixture.store.resume()
        fixture.runtime.refreshMetronome(for: fixture.store.activeSet, applicationIsActive: true)
        try fixture.store.pause()
        fixture.runtime.refreshMetronome(for: fixture.store.activeSet, applicationIsActive: true)
        XCTAssertFalse(fixture.metronome.isPlaying, "A later manual foreground pause still stops normally.")
    }

    @MainActor func testBackgroundRefreshNeverStartsAudioAndFinishedPracticeAlwaysStops() throws {
        let fixture = try fixture(useMetronome: true)
        fixture.metronome.keepRunningWhenLocked = true
        try fixture.store.pause()
        fixture.runtime.refreshMetronome(for: fixture.store.activeSet, applicationIsActive: false)
        XCTAssertFalse(fixture.metronome.isPlaying)
        fixture.metronome.start()
        XCTAssertTrue(fixture.metronome.isPlaying, fixture.metronome.errorMessage ?? "Metronome start")
        try fixture.store.endSet()
        fixture.runtime.refreshMetronome(for: fixture.store.activeSet, applicationIsActive: false)
        XCTAssertFalse(fixture.metronome.isPlaying, "End always stops, even while inactive and with keep-playing enabled.")
    }

    @MainActor func testRetainedBackgroundClickDoesNotRestartAfterStopOrSurviveEndedPractice() async throws {
        let fixture = try fixture(useMetronome: true)
        fixture.metronome.keepRunningWhenLocked = true
        fixture.metronome.start()
        XCTAssertTrue(fixture.metronome.isPlaying, fixture.metronome.errorMessage ?? "Metronome start")
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        await Task.yield()
        fixture.metronome.stop()
        fixture.runtime.refreshMetronome(for: fixture.store.activeSet, applicationIsActive: true)
        XCTAssertFalse(fixture.metronome.isPlaying, "Retaining an existing click never restarts an explicitly stopped one.")

        fixture.metronome.start()
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        await Task.yield()
        var switched = try XCTUnwrap(fixture.store.activeSet)
        switched.id = UUID()
        fixture.runtime.refreshMetronome(for: switched, applicationIsActive: false)
        XCTAssertFalse(fixture.metronome.isPlaying, "A different paused set cannot inherit the old set's background click.")

        fixture.metronome.start()
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        await Task.yield()
        try fixture.store.endSet()
        fixture.runtime.refreshMetronome(for: fixture.store.activeSet, applicationIsActive: true)
        XCTAssertFalse(fixture.metronome.isPlaying, "Ending the set clears its retained background click.")
    }

}
