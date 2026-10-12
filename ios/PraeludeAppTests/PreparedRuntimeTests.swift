import Foundation
import XCTest
@testable import Praelude

/// Exercises the camera's asynchronous runtime path with real atomic files and deterministic
/// final commit gates. No camera, speech recognition or audio hardware is started.
final class PreparedRuntimeTests: XCTestCase {
    @MainActor private final class WriteProbe {
        weak var store: PracticeStore?
        var shouldFail = false
        var feedbackAtWrite: [UUID?] = []
        var publishedAttemptsAtWrite: [[UUID]] = []
        var savedAttempts: [UUID] = []
        var writes = 0
        func clear() {
            feedbackAtWrite = []; publishedAttemptsAtWrite = []; savedAttempts = []; writes = 0
        }
    }
    @MainActor private struct Fixture {
        let store: PracticeStore
        let runtime: PracticeRuntime
        let feedback: FeedbackService
        let metronome: MetronomeService
        let defaults: UserDefaults
        let probe: WriteProbe
        let piece: Piece
        let passage: Passage
    }
    @MainActor private func fixture(startBPM: Double = 100, useMetronome: Bool = false) throws -> Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-PreparedRuntime-\(UUID())", isDirectory: true)
        let suite = "Praelude-PreparedRuntime-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let feedback = FeedbackService(defaults: defaults)
        feedback.isEnabled = true; feedback.soundsEnabled = false; feedback.hapticsEnabled = false
        let probe = WriteProbe()
        let store = PracticeStore(directory: directory, writeData: { data, url in
            probe.writes += 1
            probe.feedbackAtWrite.append(feedback.latest?.id)
            probe.publishedAttemptsAtWrite.append(probe.store?.activeSet?.attempts.map(\.id) ?? [])
            if probe.shouldFail { throw CocoaError(.fileWriteOutOfSpace) }
            try data.write(to: url, options: .atomic)
            let saved = try JSONDecoder().decode(LibraryState.self, from: Data(contentsOf: url))
            probe.savedAttempts = saved.activeSet?.attempts.map(\.id) ?? []
        })
        probe.store = store
        let piece = Piece(title: "Prepared runtime study")
        let passage = Passage(pieceID: piece.id, title: "Opening", performanceTempo: 120)
        try store.addPiece(piece); try store.savePassage(passage)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: passage.id, targetCount: 10,
            startBPM: startBPM, targetBPM: startBPM, tempoStep: .fixed(4), useMetronome: useMetronome))
        let metronome = MetronomeService(defaults: defaults)
        let speech = SpeechCommandService()
        let recording = RecordingService(defaults: defaults)
        let runtime = PracticeRuntime(store: store, metronome: metronome, speech: speech, recording: recording, feedback: feedback)
        probe.clear()
        addTeardownBlock {
            await MainActor.run { runtime.dismissPulseCheck(); feedback.stop(); metronome.stop(); speech.stop(); recording.stopPlayback() }
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        return Fixture(store: store, runtime: runtime, feedback: feedback, metronome: metronome,
                       defaults: defaults, probe: probe, piece: piece, passage: passage)
    }
    @MainActor private func saved(_ store: PracticeStore) throws -> LibraryState {
        try JSONDecoder().decode(LibraryState.self, from: Data(contentsOf: store.fileURL))
    }

    @MainActor func testPreparedAttemptPublishesFeedbackOnlyAfterDurabilityAndRetriesStayHonest() async throws {
        let f = try fixture(), first = UUID()
        let recorded = try await f.runtime.recordPreparedAsync(.clean, eventID: first)
        XCTAssertTrue(recorded)
        XCTAssertEqual(f.probe.writes, 1)
        XCTAssertNil(try XCTUnwrap(f.probe.feedbackAtWrite.last))
        XCTAssertEqual(f.probe.publishedAttemptsAtWrite, [[]], "Store must publish only after its atomic write")
        XCTAssertEqual(f.probe.savedAttempts, [first])
        XCTAssertEqual(f.feedback.latest?.id, try saved(f.store).activeSet?.attempts.last?.id)

        f.feedback.stop()
        let beforeDuplicate = try Data(contentsOf: f.store.fileURL)
        let duplicate = try await f.runtime.recordPreparedAsync(.clean, eventID: first)
        XCTAssertFalse(duplicate)
        XCTAssertEqual(f.probe.writes, 1)
        XCTAssertNil(f.feedback.latest)
        XCTAssertEqual(try Data(contentsOf: f.store.fileURL), beforeDuplicate)

        let second = UUID(), beforeFailure = f.store.state
        f.probe.shouldFail = true
        do { _ = try await f.runtime.recordPreparedAsync(.clean, eventID: second); XCTFail("Expected failed atomic write") }
        catch { XCTAssertNotNil(f.store.errorMessage) }
        XCTAssertEqual(f.store.state, beforeFailure)
        XCTAssertEqual(try Data(contentsOf: f.store.fileURL), beforeDuplicate)
        XCTAssertNil(f.feedback.latest)
        f.probe.shouldFail = false
        let retried = try await f.runtime.recordPreparedAsync(.clean, eventID: second)
        XCTAssertTrue(retried)
        XCTAssertEqual(f.feedback.latest?.id, second)
        XCTAssertEqual(try saved(f.store).activeSet?.attempts.map(\.id), [first, second])
    }

    @MainActor func testPreparedAttemptRejectsReplacementSetAndGateClosedAfterPreparation() async throws {
        let f = try fixture()
        let originatingSetID = try XCTUnwrap(f.store.activeSet?.id)
        try f.store.endSet()
        try f.store.startSet(PracticeConfiguration(pieceID: f.piece.id, passageID: f.passage.id, targetCount: 10))
        let replacement = try XCTUnwrap(f.store.activeSet?.id), before = try Data(contentsOf: f.store.fileURL)
        do {
            _ = try await f.runtime.recordPreparedAsync(.clean, canCommit: { f.store.activeSet?.id == originatingSetID })
            XCTFail("A task created for the previous set must not record into its replacement")
        } catch {}
        XCTAssertEqual(f.store.activeSet?.id, replacement)
        XCTAssertTrue(f.store.activeSet?.attempts.isEmpty == true)
        XCTAssertEqual(try Data(contentsOf: f.store.fileURL), before)

        var checks = 0
        do {
            _ = try await f.runtime.recordPreparedAsync(.clean, canCommit: { checks += 1; return checks == 1 })
            XCTFail("A gate closed across preparation must reject the repetition")
        } catch {}
        XCTAssertEqual(checks, 2, "Both the pre-prepare and final commit gates must run")
        XCTAssertEqual(try Data(contentsOf: f.store.fileURL), before)
        XCTAssertNil(f.feedback.latest)
    }

    @MainActor func testPreparedR6CannotDemoteOrRewardAReplacementSetAfterItsAwait() async throws {
        let f = try fixture()
        try f.store.record(.sloppy); try f.store.record(.sloppy)
        let original = try XCTUnwrap(f.store.activeSet?.id), eventID = UUID()
        var ruleChecks = 0
        var replacementID: UUID?
        var replacementError: Error?
        let recorded = try await f.runtime.recordPreparedAsync(.sloppy, eventID: eventID, canCommit: {
            if f.store.activeSet?.id == original, f.store.activeSet?.attempts.contains(where: { $0.id == eventID }) == true {
                ruleChecks += 1
                if ruleChecks == 2 {
                    do {
                        try f.store.endSet()
                        try f.store.startSet(PracticeConfiguration(pieceID: f.piece.id, passageID: f.passage.id,
                            targetCount: 10, startBPM: 72, targetBPM: 72))
                        replacementID = f.store.activeSet?.id
                    } catch { replacementError = error }
                }
            }
            return true
        })
        XCTAssertTrue(recorded, "The original repetition reached disk before the rule await")
        XCTAssertNil(replacementError)
        XCTAssertEqual(ruleChecks, 2, "Replacement must occur at the rule's post-prepare gate")
        XCTAssertEqual(f.store.activeSet?.id, try XCTUnwrap(replacementID))
        XCTAssertEqual(f.store.activeSet?.currentBPM, 72)
        XCTAssertTrue(f.store.activeSet?.attempts.isEmpty == true)
        XCTAssertFalse(f.store.state.ruleEvents.contains { $0.ruleID == .r6SlowDown })
        XCTAssertEqual(f.store.state.history.first { $0.id == original }?.attempts.last?.id, eventID)
        XCTAssertNil(f.feedback.latest, "The replacement set cannot acknowledge an old set's repetition")
        XCTAssertEqual(try saved(f.store), f.store.state)
    }

    @MainActor func testPreparedR14ClosedFinalGateNeverPublishesDropoutAndLaterValidAttemptCan() async throws {
        let f = try fixture(startBPM: 110, useMetronome: true), eventID = UUID()
        var ruleChecks = 0
        let recorded = try await f.runtime.recordPreparedAsync(.clean, eventID: eventID, canCommit: {
            guard f.store.activeSet?.attempts.contains(where: { $0.id == eventID }) == true else { return true }
            ruleChecks += 1
            return ruleChecks == 1
        })
        XCTAssertTrue(recorded)
        XCTAssertEqual(ruleChecks, 2)
        XCTAssertFalse(f.store.state.ruleEvents.contains { $0.ruleID == .r14PulseCheck })
        XCTAssertNil(f.runtime.activePulseCheck)
        XCTAssertNil(f.metronome.dropoutPlan)
        XCTAssertEqual(f.feedback.latest?.id, eventID, "The saved repetition still earns its own feedback")
        XCTAssertEqual(try saved(f.store).activeSet?.attempts.last?.id, eventID)

        let next = try await f.runtime.recordPreparedAsync(.clean)
        XCTAssertTrue(next)
        XCTAssertEqual(f.store.state.ruleEvents.filter { $0.ruleID == .r14PulseCheck }.count, 1)
        XCTAssertNotNil(f.runtime.activePulseCheck)
        XCTAssertNotNil(f.metronome.dropoutPlan)
        XCTAssertFalse(f.metronome.isPlaying)
    }

    @MainActor func testNewerTouchFeedbackSurvivesAnOlderPreparedAttemptReturningFromRuleAwait() async throws {
        let f = try fixture()
        try f.store.record(.sloppy); try f.store.record(.sloppy)
        let cameraID = UUID(), touchID = UUID()
        var ruleChecks = 0
        var injected = false
        var touchError: Error?
        let recorded = try await f.runtime.recordPreparedAsync(.sloppy, eventID: cameraID, canCommit: {
            if f.store.activeSet?.attempts.contains(where: { $0.id == cameraID }) == true {
                ruleChecks += 1
                if ruleChecks == 2 {
                    do { injected = try f.runtime.record(.clean, eventID: touchID) }
                    catch { touchError = error }
                }
            }
            return true
        })
        XCTAssertTrue(recorded)
        XCTAssertTrue(injected, "Inject the newer touch at R6's post-prepare gate")
        XCTAssertNil(touchError)
        XCTAssertGreaterThanOrEqual(ruleChecks, 2)
        XCTAssertEqual(f.feedback.latest?.id, touchID, "Returning old camera work cannot replace the newer touch acknowledgement")
        XCTAssertEqual(f.feedback.latest?.kind, .clean)
        let persisted = try saved(f.store)
        XCTAssertEqual(persisted.activeSet?.attempts.suffix(2).map(\.id), [cameraID, touchID])
        XCTAssertEqual(persisted.activeSet?.attempts.suffix(2).map(\.verdict), [.sloppy, .clean])
        XCTAssertEqual(persisted, f.store.state)
        XCTAssertFalse(persisted.ruleEvents.contains { $0.ruleID == .r6SlowDown }, "The old rule decision also lost its original attempt context")
    }

    @MainActor func testPreparedRewardsFailuresAndConcurrentReceiptsNeverDuplicateCelebrations() async throws {
        let f = try fixture()
        var ready = f.passage; ready.learningState = .performanceReady
        try f.store.savePassage(ready)
        let sound = RewardSoundService(defaults: f.defaults); sound.isEnabled = false
        let first = RewardsRuntime(store: f.store, sound: sound), second = RewardsRuntime(store: f.store, sound: sound)
        let before = f.store.state, bytes = try Data(contentsOf: f.store.fileURL), date = Date()
        f.probe.shouldFail = true
        await first.reconcilePreparedAsync(asOf: date)
        XCTAssertEqual(f.store.state, before)
        XCTAssertEqual(try Data(contentsOf: f.store.fileURL), bytes)
        XCTAssertTrue(first.celebrationQueue.isEmpty)
        f.probe.shouldFail = false
        async let a: Void = first.reconcilePreparedAsync(asOf: date)
        async let b: Void = second.reconcilePreparedAsync(asOf: date)
        _ = await (a, b)
        let committed = f.store.state.milestoneEvents.filter { event in !before.milestoneEvents.contains(where: { $0.id == event.id }) }
        let queued = first.celebrationQueue + second.celebrationQueue
        XCTAssertEqual(committed.count, 2, "One passage and its fully ready piece earn one milestone each")
        XCTAssertEqual(queued.count, committed.count)
        XCTAssertEqual(Set(queued.map(\.id)), Set(committed.map(\.id)))
        XCTAssertEqual(f.store.state.rewardLedger.filter { $0.reason == "Passage performance-ready" }.count, 1)
        XCTAssertEqual(f.store.state.rewardLedger.filter { $0.reason == "Piece fully ready" }.count, 1)
        let paid = f.store.state
        await first.reconcilePreparedAsync(asOf: date)
        XCTAssertEqual(f.store.state, paid)
        XCTAssertEqual((first.celebrationQueue + second.celebrationQueue).count, committed.count)
        XCTAssertEqual(try saved(f.store), f.store.state)
    }
}
