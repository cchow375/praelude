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

    @MainActor private func legacyData(_ state: LibraryState) throws -> Data {
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
        json["schemaVersion"] = 1; json.removeValue(forKey: "scoreDrawings")
        var passages = try XCTUnwrap(json["passages"] as? [[String: Any]])
        for index in passages.indices { passages[index].removeValue(forKey: "regions") }
        json["passages"] = passages
        if var active = json["activeSet"] as? [String: Any], var config = active["configuration"] as? [String: Any] {
            config.removeValue(forKey: "passageSnapshot"); active["configuration"] = config; json["activeSet"] = active
        }
        return try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
    }

    @MainActor func testLegacyMigrationPreservesOriginalAndPracticeBeforePublishingSchemaTwo() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let passage = Passage(pieceID: store.pieces[0].id, title: "Legacy measures", startMeasure: 9, endMeasure: 12, page: 2)
        try store.savePassage(passage); try store.record(.clean)
        let original = try legacyData(store.state)
        try original.write(to: store.fileURL, options: .atomic)
        let migrated = PracticeStore(directory: directory)
        XCTAssertFalse(migrated.isReadOnly)
        XCTAssertEqual(migrated.state.schemaVersion, 2)
        XCTAssertEqual(migrated.state.revision, store.state.revision + 1)
        XCTAssertEqual(migrated.state.passages, [passage])
        XCTAssertEqual(migrated.state.passages[0].measureLabel, "mm. 9–12")
        XCTAssertEqual(migrated.activeSet?.attempts, store.activeSet?.attempts)
        XCTAssertEqual(migrated.activeSet?.status, .paused)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(migrated.preservedOriginalURL)), original)
        XCTAssertTrue(try XCTUnwrap(migrated.preservedOriginalURL).lastPathComponent.hasPrefix("library-schema1-"))
        let reopened = PracticeStore(directory: directory)
        XCTAssertEqual(reopened.state, migrated.state)
        XCTAssertNil(reopened.preservedOriginalURL, "Schema two must not migrate again")
        XCTAssertEqual(try PracticeStore.decodeBackup(original).schemaVersion, 2)
    }

    @MainActor func testLegacyMigrationPreserveAndWriteFailuresNeverOverwriteOriginal() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let original = try legacyData(store.state)
        try original.write(to: store.fileURL, options: .atomic)
        var writes = 0
        let preserveFailure = PracticeStore(directory: directory, writeData: { _, _ in writes += 1 },
                                            preserveFile: { _, _ in throw CocoaError(.fileWriteNoPermission) })
        XCTAssertTrue(preserveFailure.isReadOnly); XCTAssertEqual(writes, 0)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), original)
        let writeFailure = PracticeStore(directory: directory, writeData: { _, _ in throw CocoaError(.fileWriteOutOfSpace) })
        XCTAssertTrue(writeFailure.isReadOnly)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), original)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(writeFailure.preservedOriginalURL)), original)
        XCTAssertThrowsError(try writeFailure.addPiece(Piece(title: "Cannot overwrite")))
        let retried = PracticeStore(directory: directory)
        XCTAssertFalse(retried.isReadOnly); XCTAssertEqual(retried.state.schemaVersion, 2)
    }

    @MainActor func testOptionalMeasuresAndVisualRegionBoundsRejectWithoutChangingDisk() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        var piece = store.pieces[0]; piece.pdfFileName = "fixture.pdf"; try store.updatePiece(piece)
        let region = PassageRegion(page: 2, x: 0.1, y: 0.2, width: 0.8, height: 0.1)
        let passage = Passage(pieceID: piece.id, title: "This phrase", page: 2, regions: [region])
        try store.savePassage(passage)
        XCTAssertEqual(passage.measureLabel, "")
        let before = store.state; let bytes = try Data(contentsOf: store.fileURL)
        var badMeasure = passage; badMeasure.startMeasure = 3
        XCTAssertThrowsError(try store.savePassage(badMeasure))
        badMeasure.endMeasure = 2
        XCTAssertThrowsError(try store.savePassage(badMeasure))
        var invalidRegions = [PassageRegion]()
        var invalid = region; invalid.x = .nan; invalidRegions.append(invalid)
        invalid = region; invalid.y = .infinity; invalidRegions.append(invalid)
        invalid = region; invalid.width = 0; invalidRegions.append(invalid)
        invalid = region; invalid.x = -0.1; invalidRegions.append(invalid)
        invalid = region; invalid.height = 1; invalidRegions.append(invalid)
        invalid = region; invalid.page = 9; invalidRegions.append(invalid)
        for region in invalidRegions {
            var invalidPassage = passage; invalidPassage.regions = [region]
            XCTAssertThrowsError(try store.savePassage(invalidPassage))
        }
        var duplicate = passage; duplicate.regions = [region, region]
        XCTAssertThrowsError(try store.savePassage(duplicate))
        duplicate = passage; duplicate.id = UUID()
        XCTAssertThrowsError(try store.savePassage(duplicate), "Two saved passages must not share a mark identifier used by score tap routing")
        XCTAssertEqual(store.state, before); XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
    }

    @MainActor func testDrawingPersistenceRemovalAndSizeBounds() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        var piece = store.pieces[0]; piece.pdfFileName = "fixture.pdf"; try store.updatePiece(piece)
        let ink = Data([1, 2, 3, 4]) // Core stores opaque data; the native boundary validates PencilKit.
        try store.saveDrawing(pieceID: piece.id, page: 1, data: ink)
        XCTAssertEqual(PracticeStore(directory: directory).drawing(pieceID: piece.id, page: 1), ink)
        XCTAssertThrowsError(try store.saveDrawing(pieceID: piece.id, page: 9, data: ink))
        XCTAssertThrowsError(try store.saveDrawing(pieceID: UUID(), page: 1, data: ink))
        let before = store.state
        XCTAssertThrowsError(try store.saveDrawing(pieceID: piece.id, page: 1, data: Data(count: PracticeStore.maximumDrawingBytes + 1)))
        XCTAssertEqual(store.state, before)
        var tooLarge = store.state
        tooLarge.scoreDrawings = (1...5).map { ScoreDrawing(pieceID: piece.id, page: $0, data: Data(count: PracticeStore.maximumDrawingBytes)) }
        XCTAssertThrowsError(try PracticeStore.validate(tooLarge))
        var duplicate = store.state; duplicate.scoreDrawings.append(duplicate.scoreDrawings[0])
        XCTAssertThrowsError(try PracticeStore.validate(duplicate))
        try store.saveDrawing(pieceID: piece.id, page: 1, data: Data())
        XCTAssertNil(store.drawing(pieceID: piece.id, page: 1))
        XCTAssertTrue(store.state.scoreDrawings.isEmpty)
    }

    @MainActor func testDrawingWriteFailureRetainsPriorInkInMemoryAndOnDisk() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.pause()
        var piece = store.pieces[0]; piece.pdfFileName = "fixture.pdf"; try store.updatePiece(piece)
        try store.saveDrawing(pieceID: piece.id, page: 1, data: Data([1]))
        let bytes = try Data(contentsOf: store.fileURL)
        let failing = PracticeStore(directory: directory, writeData: { _, _ in throw CocoaError(.fileWriteOutOfSpace) })
        XCTAssertThrowsError(try failing.saveDrawing(pieceID: piece.id, page: 1, data: Data([2])))
        XCTAssertEqual(failing.drawing(pieceID: piece.id, page: 1), Data([1]))
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
    }

    @MainActor func testPassageCompareAndSwapRejectsStaleEditsDeletionAndDuplicateCreation() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let original = Passage(pieceID: store.pieces[0].id, title: "Original")
        try store.savePassage(original, replacing: nil)
        var newer = original; newer.title = "Edited in the other window"
        try store.savePassage(newer, replacing: original)
        var stale = original; stale.focus = "Balance"
        let bytes = try Data(contentsOf: store.fileURL)
        XCTAssertThrowsError(try store.savePassage(stale, replacing: original))
        XCTAssertThrowsError(try store.savePassage(stale, replacing: nil))
        XCTAssertEqual(store.state.passages, [newer])
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
        try store.deletePassage(newer.id)
        XCTAssertThrowsError(try store.savePassage(stale, replacing: newer), "Saving a stale editor must not resurrect a deleted passage")
        var unrelated = original; unrelated.id = UUID()
        XCTAssertThrowsError(try store.savePassage(unrelated, replacing: original))
        XCTAssertTrue(store.state.passages.isEmpty)
    }

    @MainActor func testPracticeKeepsOriginalVisualPassageAfterEditingAndDeleting() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.endSession()
        var piece = store.pieces[0]; piece.pdfFileName = "fixture.pdf"; try store.updatePiece(piece)
        let original = Passage(pieceID: piece.id, title: "Opening phrase", page: 2,
                               regions: [PassageRegion(page: 2, x: 0.1, y: 0.2, width: 0.7, height: 0.1)])
        try store.savePassage(original)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: original.id))
        XCTAssertEqual(store.activeSet?.configuration.passageSnapshot, original)
        var edited = original; edited.title = "Renamed"; edited.regions[0].y = 0.5
        try store.savePassage(edited); try store.record(.clean); try store.endSession(); try store.deletePassage(original.id)
        XCTAssertNil(store.state.history.last?.configuration.passageID)
        XCTAssertEqual(store.state.history.last?.configuration.passageSnapshot, original)
        XCTAssertEqual(PracticeStore(directory: directory).state.history.last?.configuration.passageSnapshot, original)
        piece.pdfFileName = "replacement.pdf"
        XCTAssertThrowsError(try store.updatePiece(piece), "Historic marked regions still belong to the original PDF")
        var corrupt = store.state
        corrupt.history[corrupt.history.count - 1].configuration.passageSnapshot?.pieceID = UUID()
        XCTAssertThrowsError(try PracticeStore.validate(corrupt))
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
