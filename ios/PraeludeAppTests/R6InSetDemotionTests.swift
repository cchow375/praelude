import Foundation
import XCTest
@testable import Praelude

/// §11 R6 app-level wiring: `PracticeRuntime.checkR6SlowDown` connects
/// `PracticeRulesEngine.evaluateR6SlowDown` to `PracticeStore.adjustActiveTempo` so the set a player
/// is actually *in* gets slower, not only a suggestion offered after they stop (ios/(C) Audit.md).
/// Mirrors `PulseCheckWiringTests`' fixture: no real audio-hardware service is ever started.
final class R6InSetDemotionTests: XCTestCase {
    @MainActor
    private struct Fixture {
        let store: PracticeStore
        let runtime: PracticeRuntime
        let piece: Piece
        let passage: Passage
    }

    @MainActor
    private func fixture(startBPM: Double = 100, tempoStep: TempoStep = .fixed(4)) throws -> Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-R6-\(UUID().uuidString)", isDirectory: true)
        let suite = "Praelude-R6-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = PracticeStore(directory: directory)
        let piece = Piece(title: "R6 study")
        try store.addPiece(piece)
        let passage = Passage(pieceID: piece.id, title: "Opening")
        try store.savePassage(passage)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: passage.id, targetCount: 10,
                                                  startBPM: startBPM, targetBPM: startBPM, tempoStep: tempoStep))
        let metronome = MetronomeService(defaults: defaults)
        let speech = SpeechCommandService()
        let recording = RecordingService(defaults: defaults)
        let runtime = PracticeRuntime(store: store, metronome: metronome, speech: speech, recording: recording)
        addTeardownBlock {
            await MainActor.run { metronome.stop(); speech.stop() }
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        return Fixture(store: store, runtime: runtime, piece: piece, passage: passage)
    }

    /// Three resets in a row, each peaking under half the goal, must slow the *running* set down —
    /// not merely be computable after the fact — and log exactly one applied R6 event.
    @MainActor
    func testThreeUnderHalfResetsSlowsTheRunningSetImmediately() throws {
        let fixture = try fixture(startBPM: 100, tempoStep: .fixed(4))
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID())) // streak 1, peak below half of 10
        XCTAssertTrue(try fixture.runtime.record(.sloppy, eventID: UUID())) // peak 1 < 5
        XCTAssertTrue(try fixture.runtime.record(.again, eventID: UUID())) // neutral, must not break the run
        XCTAssertTrue(try fixture.runtime.record(.sloppy, eventID: UUID())) // peak 0 < 5
        XCTAssertEqual(fixture.store.activeSet?.currentBPM, 100, "Not yet three qualifying resets")

        XCTAssertTrue(try fixture.runtime.record(.reset, eventID: UUID())) // peak 0 < 5: third in a row
        XCTAssertEqual(fixture.store.activeSet?.status, .running, "R6 must slow the set down, never end it")
        XCTAssertEqual(fixture.store.activeSet?.currentBPM, 96, "Down by the fixed tempo step, exactly as the end-of-set suggestion would compute")
        XCTAssertEqual(fixture.store.state.ruleEvents.filter { $0.ruleID == .r6SlowDown }.count, 1)
        XCTAssertEqual(fixture.store.state.ruleEvents.last?.overridden, false)
    }

    /// A run that never reaches three consecutive under-half resets (an intervening Clean streak that
    /// clears the window) must never touch the tempo.
    @MainActor
    func testDoesNotSlowDownBelowThreshold() throws {
        let fixture = try fixture(startBPM: 100)
        XCTAssertTrue(try fixture.runtime.record(.sloppy, eventID: UUID()))
        XCTAssertTrue(try fixture.runtime.record(.sloppy, eventID: UUID()))
        XCTAssertEqual(fixture.store.activeSet?.currentBPM, 100)
        XCTAssertTrue(fixture.store.state.ruleEvents.filter { $0.ruleID == .r6SlowDown }.isEmpty)
    }

    /// A Clean verdict can only ever clear or extend a streak, never itself append to R6's
    /// under-half-goal window — recording one after the window is already at the threshold must not
    /// re-trigger a second demotion off the same three resets.
    @MainActor
    func testACleanVerdictAfterADemotionDoesNotReDemote() throws {
        let fixture = try fixture(startBPM: 100)
        for _ in 0..<3 { XCTAssertTrue(try fixture.runtime.record(.sloppy, eventID: UUID())) }
        XCTAssertEqual(fixture.store.activeSet?.currentBPM, 96)
        XCTAssertEqual(fixture.store.state.ruleEvents.filter { $0.ruleID == .r6SlowDown }.count, 1)

        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))
        XCTAssertEqual(fixture.store.activeSet?.currentBPM, 96, "A single Clean does not touch the tempo R6 already set")
        XCTAssertEqual(fixture.store.state.ruleEvents.filter { $0.ruleID == .r6SlowDown }.count, 1, "Must not re-fire off the same three resets")
    }

    /// A further qualifying reset after an already-demoted tempo must compound from the *new*
    /// (lower) tempo, not recompute from the original starting tempo.
    @MainActor
    func testASecondQualifyingRunCompoundsFromTheAlreadyDemotedTempo() throws {
        let fixture = try fixture(startBPM: 100, tempoStep: .fixed(4))
        for _ in 0..<3 { XCTAssertTrue(try fixture.runtime.record(.sloppy, eventID: UUID())) }
        XCTAssertEqual(fixture.store.activeSet?.currentBPM, 96)

        XCTAssertTrue(try fixture.runtime.record(.sloppy, eventID: UUID()))
        XCTAssertEqual(fixture.store.activeSet?.currentBPM, 92, "A new qualifying reset must step down again, from the already-lowered tempo")
        XCTAssertEqual(fixture.store.state.ruleEvents.filter { $0.ruleID == .r6SlowDown }.count, 2)
    }
}
