import Foundation
import XCTest
@testable import PraeludeCore

final class PracticeBalanceTests: XCTestCase {
    private let date = Date(timeIntervalSince1970: 1_780_000_000)
    @MainActor private func store(fullTempo: Double? = 160) throws -> PracticeStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let result = PracticeStore(directory: directory, now: { self.date })
        try result.addPiece(Piece(title: "Synthetic score", fullTempoBPM: fullTempo))
        return result
    }
    private func state(plan: PracticeBalancePlan = PracticeBalancePlan(), fullTempo: Double? = 160,
                       snapshot: Double? = nil, count: Int = 20, hands: String = "Both hands", variants: Bool = false, capturedHands: Bool = false) -> LibraryState {
        var state = LibraryState()
        let piece = Piece(title: "Synthetic score", fullTempoBPM: fullTempo, practiceBalancePlan: plan)
        state.pieces = [piece]
        for sessionIndex in 0..<2 {
            var session = PracticeSession(pieceID: piece.id, focus: "Pulse", startedAt: date.addingTimeInterval(Double(sessionIndex * 1000)))
            var set = ActiveSet(sessionID: session.id,
                                configuration: PracticeConfiguration(pieceID: piece.id, targetCount: 100, startBPM: 40, targetBPM: 40,
                                                                     stages: variants ? [VariantStage(name: "Dotted", targetCount: 100)] : [],
                                                                     hands: hands, fullTempoBPM: snapshot), startedAt: session.startedAt)
            set.attempts = (0..<(count / 2)).map { Attempt(verdict: .clean, date: session.startedAt.addingTimeInterval(Double($0)), bpm: 40) }
            if capturedHands, let selection = PracticeHand.canonicalSelection(hands) {
                for attempt in set.attempts { set.configuration.recordedHands[attempt.id.uuidString] = selection }
            }
            set = PracticeEngine.project(set); set.status = .ended; set.endedAt = session.startedAt.addingTimeInterval(100); set.lastCheckpoint = nil
            session.attempts = set.effectiveAttempts; session.endedAt = set.endedAt
            state.sessions.append(session); state.history.append(set)
        }
        return state
    }
    func testTempoBandsExplicitlySeparateQuarterTempoFromHalfSpeed() {
        XCTAssertEqual(TempoPracticeBand.classify(bpm: 40, fullTempoBPM: 160), .quarter)
        XCTAssertEqual(TempoPracticeBand.classify(bpm: 48, fullTempoBPM: 160), .quarter)
        XCTAssertEqual(TempoPracticeBand.classify(bpm: 20, fullTempoBPM: 160), .belowQuarter)
        XCTAssertEqual(TempoPracticeBand.classify(bpm: 80, fullTempoBPM: 160), .moderate)
        XCTAssertEqual(TempoPracticeBand.classify(bpm: 96, fullTempoBPM: 160), .moderate)
        XCTAssertEqual(TempoPracticeBand.classify(bpm: 40, fullTempoBPM: nil), .unknown)
        XCTAssertEqual(TempoPracticeBand.classify(bpm: 40, fullTempoBPM: .nan), .unknown)
    }
    func testMissingReferenceAndLegacySetHandsRemainExplicitWithoutMutation() {
        let state = state(fullTempo: nil)
        let before = state
        let summary = PracticeBalance.summarize(pieceID: state.pieces[0].id, state: state)
        XCTAssertEqual(summary.repetitions, 20); XCTAssertEqual(summary.sessions, 2)
        XCTAssertEqual(summary.missingTempoRepetitions, 20); XCTAssertEqual(summary.verySlowRepetitions, 0)
        XCTAssertEqual(summary.legacyHandsRepetitions, 20)
        XCTAssertEqual(summary.signal, .notConfigured); XCTAssertEqual(state, before)
    }
    func testCurrentReferenceComparisonDoesNotBackfillRecordedTarget() {
        var state = state()
        let id = state.pieces[0].id
        let original = state.history
        XCTAssertEqual(PracticeBalance.summarize(pieceID: id, state: state).verySlowRepetitions, 20)
        XCTAssertEqual(PracticeBalance.summarize(pieceID: id, state: state).currentReferenceRepetitions, 20)
        state.pieces[0].fullTempoBPM = 80
        XCTAssertEqual(PracticeBalance.summarize(pieceID: id, state: state).verySlowRepetitions, 0)
        XCTAssertEqual(state.history, original)
    }
    func testRecordedReferenceSurvivesLaterPieceTargetEdit() {
        var state = state(snapshot: 160)
        state.pieces[0].fullTempoBPM = 80
        let summary = PracticeBalance.summarize(pieceID: state.pieces[0].id, state: state)
        XCTAssertEqual(summary.verySlowRepetitions, 20); XCTAssertEqual(summary.currentReferenceRepetitions, 0)
        XCTAssertEqual(summary.observations.first?.relativeTempoPercent, 25)
    }
    func testSnapshotHandsAndVariantsBreakDownWithoutDoubleCountingSessionMirror() {
        var state = state(variants: true)
        let first = state.history[0].attempts[0].id
        state.history[0].configuration.recordedHands[first.uuidString] = "Left hand"
        let summary = PracticeBalance.summarize(pieceID: state.pieces[0].id, state: state)
        XCTAssertEqual(summary.repetitions, 20)
        XCTAssertEqual(summary.hands.first { $0.id == "left" }?.repetitions, 1)
        XCTAssertEqual(summary.hands.first { $0.id == "left" }?.sessions, 1)
        XCTAssertEqual(summary.hands.first { $0.id == "both" }?.repetitions, 19)
        XCTAssertEqual(summary.variants.first?.title, "Dotted"); XCTAssertEqual(summary.variants.first?.sessions, 2)
    }
    func testUndoResetDateAndSessionFiltersAreRespected() {
        var state = state()
        state.history[0].attempts[0].undoneAt = date.addingTimeInterval(100)
        state.history[0].attempts.append(Attempt(verdict: .reset, date: date, bpm: 40))
        let id = state.pieces[0].id
        XCTAssertEqual(PracticeBalance.summarize(pieceID: id, state: state).repetitions, 19)
        XCTAssertEqual(PracticeBalance.summarize(pieceID: id, state: state, since: date.addingTimeInterval(500)).repetitions, 10)
        XCTAssertEqual(PracticeBalance.summarize(pieceID: id, state: state, sessionID: state.sessions[0].id).repetitions, 9)
    }
    func testSignalsAreOptInExplainableAndWaitForSufficientKnownData() {
        let plan = PracticeBalancePlan(leftHandPercent: 10, verySlowPercent: 20)
        let none = state(plan: plan, fullTempo: 80, capturedHands: true)
        XCTAssertEqual(PracticeBalance.summarize(pieceID: none.pieces[0].id, state: none).signal, .bad)
        let some = state(plan: plan, capturedHands: true)
        XCTAssertEqual(PracticeBalance.summarize(pieceID: some.pieces[0].id, state: some).signal, .middle)
        let all = state(plan: plan, hands: "Left hand", capturedHands: true)
        XCTAssertEqual(PracticeBalance.summarize(pieceID: all.pieces[0].id, state: all).signal, .good)
        let sparse = state(plan: plan, count: 10)
        XCTAssertEqual(PracticeBalance.summarize(pieceID: sparse.pieces[0].id, state: sparse).signal, .insufficient)
        let missing = state(plan: plan, fullTempo: nil)
        XCTAssertEqual(PracticeBalance.summarize(pieceID: missing.pieces[0].id, state: missing).signal, .insufficient)
        let unknown = state(plan: plan, hands: "Unrecorded")
        XCTAssertEqual(PracticeBalance.summarize(pieceID: unknown.pieces[0].id, state: unknown).signal, .insufficient)
    }
    func testLegacyContractHandsCannotProduceNegativeHandCoverageSignal() {
        let plan = PracticeBalancePlan(leftHandPercent: 10)
        let legacy = state(plan: plan)
        let summary = PracticeBalance.summarize(pieceID: legacy.pieces[0].id, state: legacy)
        XCTAssertEqual(summary.signal, .insufficient)
        XCTAssertFalse(summary.checks[0].hasCompleteAttribution)
        XCTAssertFalse(summary.checks[0].isMet)
        XCTAssertTrue(summary.missingSignalReasons.contains { $0.contains("per-repetition") })
        let captured = state(plan: plan, capturedHands: true)
        XCTAssertEqual(PracticeBalance.summarize(pieceID: captured.pieces[0].id, state: captured).signal, .bad,
                       "Explicit Both-hands repetitions establish zero recorded left-only coverage.")
    }
    func testUnspecifiedVariantsCannotProduceNegativeVariantCoverageSignal() {
        let plan = PracticeBalancePlan(variantPercent: 10)
        let unspecified = state(plan: plan)
        let summary = PracticeBalance.summarize(pieceID: unspecified.pieces[0].id, state: unspecified)
        XCTAssertEqual(summary.signal, .insufficient)
        XCTAssertEqual(summary.missingVariantRepetitions, 20)
        XCTAssertFalse(summary.checks[0].hasCompleteAttribution)
        XCTAssertTrue(summary.missingSignalReasons.contains { $0.contains("Missing variant data") })
        var partlyKnown = state(plan: plan, variants: true)
        partlyKnown.history[0].configuration.stages = []
        XCTAssertEqual(PracticeBalance.summarize(pieceID: partlyKnown.pieces[0].id, state: partlyKnown).signal, .insufficient,
                       "Enough named variants to meet the quota cannot hide unspecified attribution.")
        let known = state(plan: plan, variants: true)
        XCTAssertEqual(PracticeBalance.summarize(pieceID: known.pieces[0].id, state: known).signal, .good)
    }
    @MainActor func testNewSetCapturesTargetAndEachVerdictHandsWithoutChangingPriorEvents() throws {
        let store = try store(); let id = store.pieces[0].id
        try store.startSet(PracticeConfiguration(pieceID: id, targetCount: 10, startBPM: 40, targetBPM: 40))
        let first = UUID(), second = UUID()
        try store.record(.clean, hands: "Left hand", eventID: first)
        try store.record(.sloppy, hands: "Right hand", eventID: second)
        let before = try XCTUnwrap(store.activeSet)
        XCTAssertEqual(before.configuration.hands, "Both hands")
        XCTAssertEqual(before.configuration.recordedHands[first.uuidString], "Left hand")
        XCTAssertEqual(before.configuration.recordedHands[second.uuidString], "Right hand")
        try store.setPracticeReference(120, plan: PracticeBalancePlan(), for: id)
        XCTAssertEqual(store.activeSet?.configuration.fullTempoBPM, 160)
        XCTAssertEqual(store.activeSet?.attempts, before.attempts)
        try store.pause() // Reopening intentionally pauses a running set.
        let reopened = PracticeStore(directory: store.directory)
        XCTAssertEqual(reopened.activeSet, store.activeSet)
        XCTAssertEqual(reopened.pieces[0].fullTempoBPM, 120)
        XCTAssertEqual(try PracticeStore.decodeBackup(store.backupData()), store.state)
    }
    @MainActor func testInvalidHandsAndTargetsAreRejectedAtomically() throws {
        let store = try store(); let id = store.pieces[0].id
        try store.startSet(PracticeConfiguration(pieceID: id, targetCount: 10))
        let before = store.state
        XCTAssertThrowsError(try store.record(.clean, hands: "Perhaps left"))
        XCTAssertThrowsError(try store.setPracticeReference(.infinity, plan: PracticeBalancePlan(), for: id))
        XCTAssertThrowsError(try store.setPracticeReference(160, plan: PracticeBalancePlan(leftHandPercent: 60, rightHandPercent: 60), for: id))
        XCTAssertEqual(store.state, before)
    }
    func testWireUsesExistingJSONAndPieceTargetRemainsLocalOnRemoteMetadataPull() throws {
        var state = state(snapshot: 160)
        let attemptID = state.history[0].attempts[0].id.uuidString
        state.history[0].configuration.recordedHands[attemptID] = "Left hand"
        let set = state.history[0]
        let object = try XCTUnwrap(SyncJSON(encoding: SetSyncRow(set)).objectValue)
        XCTAssertNil(object["full_tempo_bpm"]); XCTAssertNil(object["recorded_hands"])
        let payload = try XCTUnwrap(object["tempo_step"]?.objectValue)
        XCTAssertEqual(payload["fullTempoBPM"], .number(160))
        XCTAssertNotNil(payload["recordedHands"])
        let decoded = try XCTUnwrap(SyncJSON.object(object).decoded(as: SetSyncRow.self).coreValue)
        XCTAssertEqual(decoded.configuration.fullTempoBPM, 160)
        XCTAssertEqual(decoded.configuration.recordedHands[attemptID], "Left hand")
        let piece = state.pieces[0]
        let row = PieceSyncRow(piece)
        XCTAssertNil(try SyncJSON(encoding: row).objectValue?["full_tempo_bpm"])
        XCTAssertEqual(row.coreValue(preserving: piece)?.fullTempoBPM, 160)
        XCTAssertNil(row.coreValue?.fullTempoBPM)
    }
    @MainActor func testLegacySetSyncCannotEraseLocalCapturedContext() throws {
        let store = try store(); let id = store.pieces[0].id
        try store.startSet(PracticeConfiguration(pieceID: id, targetCount: 10))
        let eventID = UUID(); try store.record(.clean, hands: "Left hand", eventID: eventID)
        var legacy = try XCTUnwrap(store.activeSet)
        legacy.configuration.fullTempoBPM = nil; legacy.configuration.recordedHands = [:]
        try store.applySyncedSet(legacy)
        XCTAssertEqual(store.activeSet?.configuration.fullTempoBPM, 160)
        XCTAssertEqual(store.activeSet?.configuration.recordedHands[eventID.uuidString], "Left hand")
        var conflicting = legacy; conflicting.configuration.recordedHands[eventID.uuidString] = "Right hand"
        XCTAssertThrowsError(try store.applySyncedSet(conflicting))
    }
    func testExportsExplainLegacyAndCurrentReferenceWithoutChangingRecordedBPM() throws {
        let state = state()
        let row = try XCTUnwrap(HistoryExport.rows(state: state).first)
        XCTAssertEqual(row.bpm, 40); XCTAssertEqual(row.fullTempoBPM, 160)
        XCTAssertEqual(row.relativeTempoPercent, 25)
        XCTAssertEqual(row.fullTempoSource, "current piece reference")
        XCTAssertEqual(row.handsSource, "set contract")
        XCTAssertTrue(HistoryExport.csv(state: state).contains("Relative tempo percent"))
    }
}
