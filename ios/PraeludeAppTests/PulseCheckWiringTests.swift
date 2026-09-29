import Foundation
import XCTest
@testable import Praelude

/// R14 (§11) app-level wiring: `PracticeRuntime.checkPulseCheck`/`endPulseCheck`/`syncPulseCheck`
/// connect `PracticeRulesEngine.evaluateR14PulseCheck` to `MetronomeService.applyDropoutPlan`, which
/// nothing called before this track (ios/(C) Audit.md). Like `RuntimeFeedbackTests`, this never calls
/// `metronome.start()` — the rest of this app's test suite deliberately avoids starting any real
/// audio-hardware service, and `MetronomeService.applyDropoutPlan`'s own doc comment guarantees the
/// stored `dropoutPlan` updates whether or not the engine happens to be playing, so every assertion
/// below is a genuine check of this wiring without needing real playback.
final class PulseCheckWiringTests: XCTestCase {
    @MainActor
    private struct Fixture {
        let store: PracticeStore
        let runtime: PracticeRuntime
        let metronome: MetronomeService
        let piece: Piece
        let passage: Passage
    }

    /// `performanceTempo: 120`/`startBPM: 110` matches `PracticeRulesEngineTests.testR14PulseCheckPlanNearPerformanceTempo`
    /// (110 >= 120 * 0.9) so this suite's expected plan shape (lead-in 4, drop-out 2, recovery 2) is
    /// the same documented default, not a fixture-specific number.
    @MainActor
    private func fixture(useMetronome: Bool = true, startBPM: Double = 110, performanceTempo: Double? = 120) throws -> Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Praelude-PulseCheck-\(UUID().uuidString)", isDirectory: true)
        let suite = "Praelude-PulseCheck-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = PracticeStore(directory: directory)
        let piece = Piece(title: "Pulse check study")
        try store.addPiece(piece)
        let passage = Passage(pieceID: piece.id, title: "Opening", performanceTempo: performanceTempo)
        try store.savePassage(passage)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: passage.id, targetCount: 10,
                                                  startBPM: startBPM, targetBPM: startBPM, useMetronome: useMetronome))
        let metronome = MetronomeService(defaults: defaults)
        let speech = SpeechCommandService()
        let recording = RecordingService(defaults: defaults)
        let runtime = PracticeRuntime(store: store, metronome: metronome, speech: speech, recording: recording)
        addTeardownBlock {
            await MainActor.run { metronome.stop(); speech.stop() }
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        return Fixture(store: store, runtime: runtime, metronome: metronome, piece: piece, passage: passage)
    }

    @MainActor
    func testEligibleAttemptAppliesTheConvertedDropoutPlanAndPublishesTheDecision() async throws {
        let fixture = try fixture()
        XCTAssertNil(fixture.runtime.activePulseCheck)
        XCTAssertNil(fixture.metronome.dropoutPlan)

        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))

        let decision = try XCTUnwrap(fixture.runtime.activePulseCheck)
        XCTAssertEqual(decision.ruleID, .r14PulseCheck)
        XCTAssertEqual(decision.reason, "Near tempo. Metronome drops out for 2 bars.")
        XCTAssertEqual(fixture.metronome.dropoutPlan, MetronomeDropoutPlan(barsOn: 4, barsOff: 2),
                        "PulseCheckPlan(leadInBars: 4, silentBars: 2, ...) must convert to barsOn: 4, barsOff: 2")
        XCTAssertEqual(fixture.store.state.ruleEvents.count, 1)
        XCTAssertEqual(fixture.store.state.ruleEvents.first?.ruleID, .r14PulseCheck)
        XCTAssertEqual(fixture.store.state.ruleEvents.first?.overridden, false)
    }

    @MainActor
    func testFiresAtMostOncePerRunningSetNotOncePerAttempt() async throws {
        let fixture = try fixture()
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))
        let firstDecisionID = try XCTUnwrap(fixture.runtime.activePulseCheck).id

        // Several more near-tempo attempts on the *same* set must not re-fire R14 or replace the
        // decision already showing — see `checkPulseCheck`'s own doc comment for why.
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))
        XCTAssertTrue(try fixture.runtime.record(.sloppy, eventID: UUID()))
        XCTAssertEqual(fixture.runtime.activePulseCheck?.id, firstDecisionID)
        XCTAssertEqual(fixture.store.state.ruleEvents.filter { $0.ruleID == .r14PulseCheck }.count, 1)
    }

    @MainActor
    func testNeverFiresWithoutTheMetronomeInUse() async throws {
        let fixture = try fixture(useMetronome: false)
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))
        XCTAssertNil(fixture.runtime.activePulseCheck, "A set with no click has nothing for R14 to drop out of")
        XCTAssertNil(fixture.metronome.dropoutPlan)
        XCTAssertTrue(fixture.store.state.ruleEvents.isEmpty)
    }

    @MainActor
    func testNeverFiresBelowTheNearTempoThresholdOrWithoutAPerformanceTempo() async throws {
        let farFromTempo = try fixture(startBPM: 60)
        XCTAssertTrue(try farFromTempo.runtime.record(.clean, eventID: UUID()))
        XCTAssertNil(farFromTempo.runtime.activePulseCheck)

        let noPerformanceTempo = try fixture(performanceTempo: nil)
        XCTAssertTrue(try noPerformanceTempo.runtime.record(.clean, eventID: UUID()))
        XCTAssertNil(noPerformanceTempo.runtime.activePulseCheck)
    }

    /// §11 R14's own contract is "at most once per running set" — not only "at most once while a
    /// check is still showing" (`testFiresAtMostOncePerRunningSetNotOncePerAttempt` above only ever
    /// records while the first check is still active). This drives the check to its own natural end
    /// on its timer, then records another still-qualifying attempt on the *same* running set, and
    /// confirms it does not fire a second time — see "(C) Audit.md".
    @MainActor
    func testDoesNotRefireOnTheSameSetAfterItsOwnCheckEndsOnATimer() async throws {
        let fixture = try fixture()
        fixture.metronome.bpm = 300
        fixture.metronome.setMeter(beats: 1, denominator: 4)
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))
        XCTAssertNotNil(fixture.runtime.activePulseCheck)

        try await Task.sleep(for: .seconds(3))
        XCTAssertNil(fixture.runtime.activePulseCheck, "The pulse check must end on its own once its bars have elapsed")

        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))
        XCTAssertNil(fixture.runtime.activePulseCheck, "R14 fires at most once per running set, even after its own check already ended")
        XCTAssertEqual(fixture.store.state.ruleEvents.filter { $0.ruleID == .r14PulseCheck }.count, 1)
    }

    /// The same "already consumed" memory must also survive a check ending early via `syncPulseCheck`
    /// (a pause mid-check), not just its own timer — both paths go through the same `endPulseCheck`.
    @MainActor
    func testDoesNotRefireOnTheSameSetAfterAPauseEndsAnInFlightCheck() async throws {
        let fixture = try fixture()
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))
        XCTAssertNotNil(fixture.runtime.activePulseCheck)

        try fixture.store.pause()
        fixture.runtime.syncPulseCheck()
        XCTAssertNil(fixture.runtime.activePulseCheck)
        try fixture.store.resume()

        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))
        XCTAssertNil(fixture.runtime.activePulseCheck, "Still the same running set — must not re-offer a second check")
        XCTAssertEqual(fixture.store.state.ruleEvents.filter { $0.ruleID == .r14PulseCheck }.count, 1)
    }

    /// §11 "one-tap override, logged": a player-initiated end to an in-flight check must restore the
    /// click immediately (not wait out the remaining silent bars) and log a second, overridden entry
    /// for the same decision — the pulse check's own banner previously had no dismiss control at all.
    @MainActor
    func testDismissPulseCheckEndsItImmediatelyAndLogsAnOverriddenFollowUp() async throws {
        let fixture = try fixture()
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))
        let decision = try XCTUnwrap(fixture.runtime.activePulseCheck)
        XCTAssertNotNil(fixture.metronome.dropoutPlan)

        fixture.runtime.dismissPulseCheck()
        XCTAssertNil(fixture.runtime.activePulseCheck)
        XCTAssertNil(fixture.metronome.dropoutPlan, "The click must be restored immediately, not wait out its remaining silent bars")
        let events = fixture.store.state.ruleEvents.filter { $0.ruleID == .r14PulseCheck }
        XCTAssertEqual(events.count, 2, "The original fire-time log survives, plus a follow-up for the dismiss")
        XCTAssertEqual(events.first?.id, decision.id); XCTAssertEqual(events.first?.overridden, false)
        // The follow-up needs its own fresh id — `validate(_:)` requires every `ruleEvents` id to be
        // unique, and `decision.id` was already spent by the fire-time log above.
        XCTAssertNotEqual(events.last?.id, decision.id)
        XCTAssertEqual(events.last?.overridden, true)
        XCTAssertEqual(events.last?.reasonText, decision.reason)
    }

    @MainActor
    func testDismissPulseCheckIsHarmlessWithNothingInFlight() async throws {
        let fixture = try fixture()
        fixture.runtime.dismissPulseCheck()
        XCTAssertNil(fixture.runtime.activePulseCheck)
        XCTAssertTrue(fixture.store.state.ruleEvents.isEmpty)
    }

    @MainActor
    func testSyncPulseCheckClearsImmediatelyOnceTheSetStopsRunning() async throws {
        let fixture = try fixture()
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))
        XCTAssertNotNil(fixture.runtime.activePulseCheck)
        XCTAssertNotNil(fixture.metronome.dropoutPlan)

        try fixture.store.pause()
        XCTAssertEqual(fixture.store.activeSet?.status, .paused)
        fixture.runtime.syncPulseCheck()
        XCTAssertNil(fixture.runtime.activePulseCheck, "Pausing the set must end an in-flight pulse check")
        XCTAssertNil(fixture.metronome.dropoutPlan)
    }

    @MainActor
    func testSyncPulseCheckIsHarmlessWithNothingInFlight() async throws {
        let fixture = try fixture()
        fixture.runtime.syncPulseCheck(); fixture.runtime.syncPulseCheck()
        XCTAssertNil(fixture.runtime.activePulseCheck)
        XCTAssertNil(fixture.metronome.dropoutPlan)
    }

    /// The auto-clear timer is real (`Task.sleep`), so this drives it with the smallest duration
    /// reachable through public API — fastest tempo (300 bpm) and fewest beats per bar (1) — rather
    /// than asserting on `startPulseCheck`'s private implementation. `PulseCheckPlan.totalBars` is 8
    /// by default (leadIn 4 + silent 2 + recovery 2), so 8 bars * (60 / 300 bpm) ≈ 1.6s; the 3s wait
    /// leaves comfortable headroom for `Task` scheduling jitter without making this test slow.
    @MainActor
    func testPulseCheckClearsItselfAfterItsOwnDuration() async throws {
        let fixture = try fixture()
        fixture.metronome.bpm = 300
        fixture.metronome.setMeter(beats: 1, denominator: 4)
        XCTAssertTrue(try fixture.runtime.record(.clean, eventID: UUID()))
        XCTAssertNotNil(fixture.runtime.activePulseCheck)

        try await Task.sleep(for: .seconds(3))
        XCTAssertNil(fixture.runtime.activePulseCheck, "The pulse check must end on its own once its bars have elapsed")
        XCTAssertNil(fixture.metronome.dropoutPlan)
    }
}
