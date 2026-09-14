import Foundation
import XCTest
@testable import PraeludeCore

final class PracticeCoreTests: XCTestCase {
    @MainActor private func fixture(target: Int = 3, basis: CompletionBasis = .cleanStreak,
                                    start: Double = 60, end: Double = 60,
                                    stages: [VariantStage] = []) throws -> (PracticeStore, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-tests-\(UUID())")
        let store = PracticeStore(directory: directory)
        let piece = Piece(title: "Test score", pageCount: 8)
        try store.addPiece(piece)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, basis: basis, targetCount: target,
                                                startBPM: start, targetBPM: end, stages: stages))
        return (store, directory)
    }

    @MainActor func testPlainStreakResetsOnBothSetbacks() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.record(.clean); try store.record(.clean); try store.record(.again)
        XCTAssertEqual(store.activeSet?.streak, 0)
        try store.record(.clean); try store.record(.sloppy)
        XCTAssertEqual(store.activeSet?.streak, 0)
        XCTAssertEqual(store.activeSet?.totalPlays, 5)
        XCTAssertEqual(store.progress.totalAttempts, 5)
        XCTAssertEqual(store.progress.cleanAttempts, 3)
    }

    @MainActor func testTotalPlaysIncludesAgainAndNeverLosesVolume() async throws {
        let (store, directory) = try fixture(target: 4, basis: .totalPlays)
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.record(.clean); try store.record(.again); try store.record(.sloppy)
        XCTAssertEqual(store.activeSet?.progressCount, 3)
        try store.reset()
        XCTAssertEqual(store.activeSet?.progressCount, 3)
        XCTAssertEqual(store.progress.totalAttempts, 3, "A reset is an action, not a judged play")
        try store.record(.again)
        XCTAssertEqual(store.activeSet?.status, .completed)
        XCTAssertEqual(store.activeSet?.currentBPM, 60)
        XCTAssertEqual(store.progress.completedSets, 1)
    }

    @MainActor func testVariantAgainPreservesCurrentStreakAndCompletedStages() async throws {
        let stages = [VariantStage(name: "Dotted", targetCount: 2), VariantStage(name: "Reverse dotted", targetCount: 3)]
        let (store, directory) = try fixture(stages: stages)
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.record(.clean); try store.record(.again)
        XCTAssertEqual(store.activeSet?.streak, 1)
        try store.record(.clean)
        XCTAssertEqual(store.activeSet?.stageIndex, 1)
        XCTAssertEqual(store.activeSet?.completedStages, 1)
        try store.record(.clean); try store.record(.again)
        XCTAssertEqual(store.activeSet?.streak, 1)
        XCTAssertEqual(store.activeSet?.attempts.last?.stageIndex, 1)
        try store.record(.sloppy)
        XCTAssertEqual(store.activeSet?.streak, 0)
        XCTAssertEqual(store.activeSet?.completedStages, 1)
        for _ in 0..<3 { try store.record(.clean) }
        XCTAssertEqual(store.activeSet?.status, .completed)
        XCTAssertEqual(store.activeSet?.completedStages, 2)
    }

    @MainActor func testLadderNeedsCompleteTargetRung() async throws {
        let (store, directory) = try fixture(target: 2, start: 60, end: 66)
        defer { try? FileManager.default.removeItem(at: directory) }
        for _ in 0..<2 { try store.record(.clean) }
        XCTAssertEqual(store.activeSet?.currentBPM, 64)
        XCTAssertEqual(store.activeSet?.streak, 0)
        for _ in 0..<2 { try store.record(.clean) }
        XCTAssertEqual(store.activeSet?.currentBPM, 66)
        XCTAssertEqual(store.activeSet?.status, .running)
        for _ in 0..<2 { try store.record(.clean) }
        XCTAssertEqual(store.activeSet?.status, .completed)
        XCTAssertEqual(store.activeSet?.attempts.map(\.bpm), [60, 60, 64, 64, 66, 66])
    }

    @MainActor func testVariantChainRestartsOnlyOnTempoStep() async throws {
        let stages = [VariantStage(name: "A", targetCount: 1), VariantStage(name: "B", targetCount: 1)]
        let (store, directory) = try fixture(start: 60, end: 64, stages: stages)
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.record(.clean); try store.record(.clean)
        XCTAssertEqual(store.activeSet?.currentBPM, 64)
        XCTAssertEqual(store.activeSet?.stageIndex, 0)
        XCTAssertEqual(store.activeSet?.completedStages, 0)
        XCTAssertEqual(store.activeSet?.status, .running)
        try store.record(.clean); try store.record(.clean)
        XCTAssertEqual(store.activeSet?.status, .completed)
    }

    func testPercentLadderMakesFiniteProgressAndCapsAtTarget() {
        XCTAssertEqual(TempoStep.percent(5).next(after: 61, target: 80), 65)
        XCTAssertEqual(TempoStep.percent(5).next(after: 79, target: 80), 80)
    }

    @MainActor func testDuplicateEventsAreIdempotentAcrossRestartAndUndo() async throws {
        let (store, directory) = try fixture(target: 5)
        defer { try? FileManager.default.removeItem(at: directory) }
        let eventID = UUID()
        XCTAssertTrue(try store.record(.clean, eventID: eventID))
        let revision = store.state.revision
        XCTAssertFalse(try store.record(.clean, eventID: eventID))
        XCTAssertEqual(store.state.revision, revision)
        XCTAssertThrowsError(try store.record(.sloppy, eventID: eventID))
        try store.undo()
        XCTAssertFalse(try store.record(.clean, eventID: eventID), "Reusing an undone event cannot grant it again")
        let reopened = PracticeStore(directory: directory)
        XCTAssertFalse(reopened.isReadOnly)
        XCTAssertFalse(try reopened.record(.clean, eventID: eventID))
        XCTAssertEqual(reopened.progress.totalAttempts, 0)
    }

    @MainActor func testUndoReprojectsTempoCompletionAndRewards() async throws {
        let (store, directory) = try fixture(target: 1, start: 60, end: 64)
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.record(.clean); try store.record(.clean)
        XCTAssertEqual(store.progress.completedSets, 1)
        try store.undo()
        XCTAssertEqual(store.activeSet?.status, .paused, "Undo after completion requires intentional resume")
        XCTAssertEqual(store.activeSet?.currentBPM, 64)
        XCTAssertEqual(store.progress.completedSets, 0)
        try store.undo()
        XCTAssertEqual(store.activeSet?.currentBPM, 60)
        XCTAssertEqual(store.progress.totalAttempts, 0)
        XCTAssertEqual(store.activeSet?.attempts.count, 2, "Undo preserves the durable evidence ledger")
    }

    @MainActor func testRestartRestoresPausedWithoutCreditingAbsence() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-tests-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        var clock = Date(timeIntervalSince1970: 1_800_000_000)
        let store = PracticeStore(directory: directory, now: { clock })
        let piece = Piece(title: "Test")
        try store.addPiece(piece); try store.startSet(PracticeConfiguration(pieceID: piece.id))
        clock.addTimeInterval(15); try store.checkpoint()
        clock.addTimeInterval(3600)
        let reopened = PracticeStore(directory: directory, now: { clock })
        XCTAssertFalse(reopened.isReadOnly)
        XCTAssertEqual(reopened.activeSet?.status, .paused)
        XCTAssertEqual(reopened.activeSet?.activeSeconds, 15)
        try reopened.resume(); clock.addTimeInterval(10); try reopened.pause()
        XCTAssertEqual(reopened.activeSet?.activeSeconds, 25)
        clock.addTimeInterval(100); try reopened.checkpoint()
        XCTAssertEqual(reopened.activeSet?.activeSeconds, 25)
    }

    @MainActor func testCheckpointNeverCreditsUnboundedSleep() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-tests-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        var clock = Date()
        let store = PracticeStore(directory: directory, now: { clock })
        let piece = Piece(title: "Test")
        try store.addPiece(piece); try store.startSet(PracticeConfiguration(pieceID: piece.id))
        clock.addTimeInterval(9000); try store.checkpoint()
        XCTAssertEqual(store.activeSet?.activeSeconds, 60)
    }

    @MainActor func testWriteFailureNeverPublishesUncommittedState() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-tests-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        var fail = false
        let store = PracticeStore(directory: directory, writeData: { data, url in
            if fail { throw PracticeError.unavailable("Disk full") }
            try data.write(to: url, options: .atomic)
        })
        let piece = Piece(title: "Test")
        try store.addPiece(piece); try store.startSet(PracticeConfiguration(pieceID: piece.id))
        let before = store.state; let bytes = try Data(contentsOf: store.fileURL)
        fail = true
        XCTAssertThrowsError(try store.record(.clean))
        XCTAssertEqual(store.state, before)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
        XCTAssertEqual(store.errorMessage, "Disk full")
        fail = false; try store.record(.clean)
        XCTAssertEqual(store.progress.totalAttempts, 1)
    }

    @MainActor func testCorruptDiskIsReadOnlyAndNeverBlanked() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-tests-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("library.json")
        let original = Data("{broken".utf8); try original.write(to: file)
        let store = PracticeStore(directory: directory)
        XCTAssertTrue(store.isReadOnly)
        XCTAssertThrowsError(try store.addPiece(Piece(title: "Must not save")))
        XCTAssertThrowsError(try store.backupData(), "An unreadable library must never be exported as an empty backup")
        XCTAssertEqual(try Data(contentsOf: file), original)
    }

    @MainActor func testValidatedRestorePreservesUnreadableAndFutureLibrariesBeforeReplacement() async throws {
        let (source, sourceDirectory) = try fixture()
        defer { try? FileManager.default.removeItem(at: sourceDirectory) }
        try source.record(.clean); try source.pause()
        var future = source.state; future.schemaVersion = 99
        for original in [Data("{unreadable original".utf8), try JSONEncoder().encode(future)] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-recovery-\(UUID())")
            defer { try? FileManager.default.removeItem(at: directory) }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent("library.json")
            try original.write(to: file)
            let store = PracticeStore(directory: directory)
            XCTAssertTrue(store.isReadOnly)
            try store.restoreBackup(source.state)

            XCTAssertFalse(store.isReadOnly)
            XCTAssertNil(store.errorMessage)
            let preserved = try XCTUnwrap(store.preservedOriginalURL)
            XCTAssertNotEqual(preserved, file)
            XCTAssertTrue(preserved.lastPathComponent.hasPrefix("library-preserved-"))
            XCTAssertEqual(try Data(contentsOf: preserved), original)
            XCTAssertEqual(store.pieces, source.pieces)
            XCTAssertEqual(store.activeSet?.status, .paused)
            XCTAssertEqual(store.progress.totalAttempts, 1)
            let reopened = PracticeStore(directory: directory)
            XCTAssertFalse(reopened.isReadOnly)
            XCTAssertEqual(reopened.state, store.state)
            XCTAssertNoThrow(try store.backupData())
        }
    }

    @MainActor func testRecoveryPreservationFailureCannotWriteOrUnlockOriginal() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-recovery-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("library.json")
        let original = Data("{broken original".utf8); try original.write(to: file)
        var writes = 0
        let store = PracticeStore(directory: directory, writeData: { _, _ in writes += 1 }, preserveFile: { _, _ in
            throw PracticeError.unavailable("Unable to preserve original")
        })
        var replacement = LibraryState(); replacement.pieces = [Piece(title: "Recovered score")]

        XCTAssertThrowsError(try store.restoreBackup(replacement))
        XCTAssertEqual(writes, 0)
        XCTAssertTrue(store.isReadOnly)
        XCTAssertTrue(store.pieces.isEmpty)
        XCTAssertNil(store.preservedOriginalURL)
        XCTAssertEqual(try Data(contentsOf: file), original)
        XCTAssertThrowsError(try store.backupData())
    }

    @MainActor func testRecoveryWriteFailureRetainsVerifiedOriginalAndAllowsSafeRetry() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-recovery-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("library.json")
        let original = Data("{broken original".utf8); try original.write(to: file)
        var fail = true
        let store = PracticeStore(directory: directory, writeData: { data, url in
            if fail { throw PracticeError.unavailable("Disk full") }
            try data.write(to: url, options: .atomic)
        })
        var replacement = LibraryState(); replacement.pieces = [Piece(title: "Recovered score")]

        XCTAssertThrowsError(try store.restoreBackup(replacement))
        XCTAssertTrue(store.isReadOnly)
        XCTAssertTrue(store.pieces.isEmpty)
        let firstPreserved = try XCTUnwrap(store.preservedOriginalURL)
        XCTAssertEqual(try Data(contentsOf: firstPreserved), original)
        XCTAssertEqual(try Data(contentsOf: file), original)

        fail = false
        try store.restoreBackup(replacement)
        XCTAssertFalse(store.isReadOnly)
        XCTAssertNotEqual(store.preservedOriginalURL, firstPreserved, "A retry must not overwrite the prior preservation copy")
        XCTAssertEqual(try Data(contentsOf: firstPreserved), original)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(store.preservedOriginalURL)), original)
        XCTAssertEqual(store.pieces, replacement.pieces)
    }

    @MainActor func testInvalidRecoverySnapshotIsRejectedBeforePreservingOrReplacingFiles() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-recovery-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("library.json")
        let original = Data("{broken original".utf8); try original.write(to: file)
        var copies = 0
        let store = PracticeStore(directory: directory, preserveFile: { _, _ in copies += 1 })
        var invalid = LibraryState(); invalid.schemaVersion = 99
        XCTAssertThrowsError(try store.restoreBackup(invalid))
        XCTAssertEqual(copies, 0)
        XCTAssertTrue(store.isReadOnly)
        XCTAssertEqual(try Data(contentsOf: file), original)
    }

    @MainActor func testBackupRejectsUnsafeReferencesAndInvalidProjection() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.pause()
        var unsafe = store.state
        unsafe.pieces[0].pdfFileName = "../score.pdf"
        XCTAssertThrowsError(try PracticeStore.validate(unsafe))
        unsafe = store.state; unsafe.activeSet?.totalPlays = 99
        XCTAssertThrowsError(try PracticeStore.validate(unsafe))
        unsafe = store.state; unsafe.pieces.append(unsafe.pieces[0])
        XCTAssertThrowsError(try PracticeStore.validate(unsafe))
        unsafe = store.state; unsafe.sessions.removeAll()
        XCTAssertThrowsError(try PracticeStore.validate(unsafe))
        let decoded = try PracticeStore.decodeBackup(store.backupData())
        XCTAssertEqual(decoded, store.state)
    }

    @MainActor func testBackupRestoreRequiresClosedCurrentSetAndPausedSource() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let running = store.state
        XCTAssertThrowsError(try store.restoreBackup(running))
        try store.pause(); let paused = store.state
        try store.endSession()
        XCTAssertThrowsError(try store.restoreBackup(running))
        try store.restoreBackup(paused)
        XCTAssertEqual(store.activeSet?.status, .paused)
    }

    @MainActor func testEarnedSessionBonusesAndHistorySurviveReopen() async throws {
        let (store, directory) = try fixture(target: 1)
        defer { try? FileManager.default.removeItem(at: directory) }
        let configuration = try XCTUnwrap(store.activeSet?.configuration)
        for index in 0..<3 {
            if index > 0 { try store.startSet(configuration) }
            try store.record(.clean)
        }
        XCTAssertEqual(store.progress.completedSets, 3)
        XCTAssertEqual(store.progress.xp, 1)
        try store.undo()
        XCTAssertEqual(store.progress.completedSets, 2)
        XCTAssertEqual(store.progress.xp, 0)
        try store.resume(); try store.record(.clean); try store.endSession()
        let reopened = PracticeStore(directory: directory)
        XCTAssertFalse(reopened.isReadOnly)
        XCTAssertEqual(reopened.state.history.count, 3)
        XCTAssertEqual(reopened.progress.xp, 1)
        XCTAssertEqual(reopened.sessions.count, 1)
        XCTAssertNotNil(reopened.sessions.first?.endedAt)
        XCTAssertThrowsError(try reopened.deletePiece(configuration.pieceID))
        try reopened.setPieceStatus(configuration.pieceID, status: .resting)
        XCTAssertEqual(reopened.pieces.first?.status, .resting)
        XCTAssertEqual(reopened.progress.totalAttempts, 3)
    }

    func testInvalidTempoAndTotalPlaysContractsAreRejected() {
        let id = UUID()
        for tempo in [Double.infinity, .nan, 0, 301] {
            XCTAssertThrowsError(try PracticeEngine.validate(PracticeConfiguration(pieceID: id, startBPM: tempo)))
        }
        XCTAssertThrowsError(try PracticeEngine.validate(PracticeConfiguration(pieceID: id, basis: .totalPlays, targetBPM: 80)))
        XCTAssertThrowsError(try PracticeEngine.validate(PracticeConfiguration(pieceID: id, basis: .totalPlays, stages: [VariantStage(name: "Dotted")])))
        XCTAssertNoThrow(try PracticeEngine.validate(PracticeConfiguration(pieceID: id, startBPM: 20, targetBPM: 300)))
        XCTAssertNoThrow(try PracticeEngine.validate(PracticeConfiguration(pieceID: id, startBPM: 300, targetBPM: 300)))
    }

    @MainActor func testSwitchingPiecesKeepsSessionAttributionCorrect() async throws {
        let (store, directory) = try fixture(target: 1)
        defer { try? FileManager.default.removeItem(at: directory) }
        let firstID = try XCTUnwrap(store.pieces.first?.id)
        try store.record(.clean)
        let second = Piece(title: "Second piece")
        try store.addPiece(second)
        try store.startSet(PracticeConfiguration(pieceID: second.id, targetCount: 1))
        try store.record(.clean)
        XCTAssertEqual(store.sessions.count, 2)
        XCTAssertEqual(store.sessions[0].pieceID, firstID)
        XCTAssertNotNil(store.sessions[0].endedAt)
        XCTAssertEqual(store.sessions[1].pieceID, second.id)
        XCTAssertEqual(store.sessions.map { $0.attempts.count }, [1, 1])
        XCTAssertFalse(PracticeStore(directory: directory).isReadOnly)
    }

    @MainActor func testUnsafeTimingAndMetadataAreRejectedBeforeRestore() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        var invalid = store.state
        invalid.activeSet?.activeSeconds = 1e100
        XCTAssertThrowsError(try PracticeStore.validate(invalid))
        invalid = store.state; invalid.activeSet?.startedAt = Date(timeIntervalSince1970: 1e100)
        XCTAssertThrowsError(try PracticeStore.validate(invalid))
        invalid = store.state; invalid.revision = Int.max
        XCTAssertThrowsError(try PracticeStore.validate(invalid))
        invalid = store.state; invalid.activeSet?.endedAt = Date()
        XCTAssertThrowsError(try PracticeStore.validate(invalid))
    }
}
