import Foundation
import XCTest
@testable import PraeludeCore

final class PracticeCoreTests: XCTestCase {
    @MainActor private func fixture(target: Int = 3, basis: CompletionBasis = .cleanStreak,
                                    start: Double = 60, end: Double = 60,
                                    stages: [VariantStage] = [],
                                    now: @escaping () -> Date = Date.init) throws -> (PracticeStore, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-ios-tests-\(UUID())")
        let store = PracticeStore(directory: directory, now: now)
        let piece = Piece(title: "Test score", pageCount: 8)
        try store.addPiece(piece)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, basis: basis, targetCount: target,
                                                startBPM: start, targetBPM: end, stages: stages))
        return (store, directory)
    }

    /// R5 (§11): "Again" is neutral — it neither counts toward nor resets the streak, for a plain
    /// streak set exactly as much as for a variant chain (see `testVariantAgainPreservesCurrentStreakAndCompletedStages`
    /// below, which already covered the stages case). Regression test for the documented mismatch
    /// between `PracticeEngine.project` and `PracticeRulesEngine.r5StreakEffect`/R6's own attempt
    /// replay, both of which already treated Again as neutral unconditionally ("(C) Rules Engine.md",
    /// R5 section) — a target of 10 (rather than the fixture's default 3) keeps this five-attempt
    /// sequence well short of completing the set, so the streak assertions below reflect only the
    /// verdict-by-verdict replay, never an early completion's own streak reset.
    @MainActor func testPlainStreakStaysNeutralOnAgainButResetsOnSloppy() async throws {
        let (store, directory) = try fixture(target: 10)
        defer { try? FileManager.default.removeItem(at: directory) }
        try store.record(.clean); try store.record(.clean); try store.record(.again)
        XCTAssertEqual(store.activeSet?.streak, 2, "Again must neither increment nor reset the streak")
        try store.record(.clean); try store.record(.sloppy)
        XCTAssertEqual(store.activeSet?.streak, 0, "Sloppy still resets the streak")
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

    /// Strips every schema3-only field from an encoded schema3 state, leaving a genuine schema2
    /// shape (still has regions/ink/passageSnapshot) — schema2's own ink key, `scoreDrawings`, is
    /// rebuilt from `inkStrokes` since that is the one field schema3 actually reshaped.
    @MainActor private func schema2Shape(_ state: LibraryState) throws -> [String: Any] {
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
        json["schemaVersion"] = 2
        let strokes = try XCTUnwrap(json["inkStrokes"] as? [[String: Any]])
        json["scoreDrawings"] = strokes.map { ["pieceID": $0["pieceID"]!, "page": $0["page"]!, "data": $0["data"]!] }
        for key in ["inkStrokes", "instruments", "tags", "folders", "setlists", "bookmarks", "pageEdits", "scoreLinks",
                    "textAnnotations", "stampAnnotations", "coldGrades", "breakPointTaps", "ruleSettings", "ruleEvents",
                    "warmupExercises", "recordings", "rewardLedger", "badges", "milestoneEvents", "rewardsState",
                    "notebookEntries", "profile"] {
            json.removeValue(forKey: key)
        }
        let schema3OnlyPassageKeys = ["color", "parentPassageID", "joinedFromPassageIDs", "archived", "learningState",
                                      "schedule", "parkedUntil", "performanceTempo", "createdAt", "updatedAt", "deletedAt"]
        func stripSchema3PassageFields(_ passage: inout [String: Any]) {
            for key in schema3OnlyPassageKeys { passage.removeValue(forKey: key) }
        }
        // A `passageSnapshot` is a full `Passage` copy embedded inside `activeSet`/`history`, not
        // inside `passages` — a genuine schema2 file lacked the same schema3-only fields there too.
        func stripSnapshot(_ configuration: inout [String: Any]) {
            guard var snapshot = configuration["passageSnapshot"] as? [String: Any] else { return }
            stripSchema3PassageFields(&snapshot); configuration["passageSnapshot"] = snapshot
        }
        var passages = try XCTUnwrap(json["passages"] as? [[String: Any]])
        for index in passages.indices { stripSchema3PassageFields(&passages[index]) }
        json["passages"] = passages
        var pieces = try XCTUnwrap(json["pieces"] as? [[String: Any]])
        for index in pieces.indices {
            for key in ["instrumentID", "tagIDs", "folderIDs", "difficulty", "customCoverRef", "performanceDates",
                        "updatedAt", "lastPageUpdatedAt", "deletedAt"] {
                pieces[index].removeValue(forKey: key)
            }
        }
        json["pieces"] = pieces
        if var active = json["activeSet"] as? [String: Any], var config = active["configuration"] as? [String: Any] {
            config.removeValue(forKey: "goal"); stripSnapshot(&config); active["configuration"] = config; json["activeSet"] = active
        }
        if var history = json["history"] as? [[String: Any]] {
            for index in history.indices {
                guard var config = history[index]["configuration"] as? [String: Any] else { continue }
                stripSnapshot(&config); history[index]["configuration"] = config
            }
            json["history"] = history
        }
        return json
    }
    @MainActor private func schema2Data(_ state: LibraryState) throws -> Data {
        try JSONSerialization.data(withJSONObject: schema2Shape(state), options: [.sortedKeys])
    }
    /// A genuine schema1 payload, built the same way real schema1 files looked (see git history for
    /// `Models.swift`): additionally strips regions/ink/passageSnapshot, which schema1 never had.
    @MainActor private func legacyData(_ state: LibraryState) throws -> Data {
        var json = try schema2Shape(state)
        json["schemaVersion"] = 1; json.removeValue(forKey: "scoreDrawings")
        var passages = try XCTUnwrap(json["passages"] as? [[String: Any]])
        for index in passages.indices { passages[index].removeValue(forKey: "regions") }
        json["passages"] = passages
        if var active = json["activeSet"] as? [String: Any], var config = active["configuration"] as? [String: Any] {
            config.removeValue(forKey: "passageSnapshot"); active["configuration"] = config; json["activeSet"] = active
        }
        return try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
    }

    @MainActor func testLegacySchema1MigrationPreservesOriginalAndPracticeBeforePublishingSchema3() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let passage = Passage(pieceID: store.pieces[0].id, title: "Legacy measures", startMeasure: 9, endMeasure: 12, page: 2)
        try store.savePassage(passage); try store.record(.clean)
        let original = try legacyData(store.state)
        try original.write(to: store.fileURL, options: .atomic)
        let migrationDate = Date(timeIntervalSince1970: 1_800_000_000)
        let migrated = PracticeStore(directory: directory, now: { migrationDate })
        XCTAssertFalse(migrated.isReadOnly)
        XCTAssertEqual(migrated.state.schemaVersion, 3)
        XCTAssertEqual(migrated.state.revision, store.state.revision + 1)
        XCTAssertEqual(migrated.state.passages.count, 1)
        let migratedPassage = try XCTUnwrap(migrated.state.passages.first)
        XCTAssertEqual(migratedPassage.id, passage.id)
        XCTAssertEqual(migratedPassage.measureLabel, "mm. 9–12")
        XCTAssertEqual(migratedPassage.regions, [])
        XCTAssertEqual(migratedPassage.learningState, .new, "A migrated passage starts New, like one drawn today")
        XCTAssertEqual(migratedPassage.createdAt, migrationDate, "Schema1 never had a createdAt; migration backfills one")
        XCTAssertEqual(migratedPassage.updatedAt, migrationDate)
        // Minor: ruleSettings/rewardsState/profile are wholly new schema3 collections — a decoded
        // schema1/2 file always constructs them fresh via `= Date()` property defaults (the wall
        // clock), not the injected migration clock. Migration must restamp them so this is
        // deterministic, the same way it already backfills the sentinel-based fields above.
        XCTAssertEqual(migrated.state.ruleSettings.updatedAt, migrationDate)
        XCTAssertEqual(migrated.state.rewardsState.updatedAt, migrationDate)
        XCTAssertEqual(migrated.state.profile.updatedAt, migrationDate)
        XCTAssertEqual(migrated.state.profile.joinDate, migrationDate, "A migrated library must not invent a join date from wall-clock migration time")
        XCTAssertTrue(migrated.state.inkStrokes.isEmpty, "Schema1 predates ink entirely")
        XCTAssertEqual(migrated.activeSet?.attempts, store.activeSet?.attempts)
        XCTAssertEqual(migrated.activeSet?.status, .paused)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(migrated.preservedOriginalURL)), original)
        XCTAssertTrue(try XCTUnwrap(migrated.preservedOriginalURL).lastPathComponent.hasPrefix("library-schema1-"))
        let reopened = PracticeStore(directory: directory)
        XCTAssertEqual(reopened.state, migrated.state)
        XCTAssertNil(reopened.preservedOriginalURL, "Schema three must not migrate again")
        XCTAssertEqual(try PracticeStore.decodeBackup(original).schemaVersion, 3)
    }

    @MainActor func testSchema2MigrationConvertsScoreDrawingsToInkStrokesLosslessly() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        var piece = store.pieces[0]; piece.pdfFileName = "fixture.pdf"; try store.updatePiece(piece)
        let passage = Passage(pieceID: piece.id, title: "Bridge", page: 2,
                              regions: [PassageRegion(page: 2, x: 0.1, y: 0.2, width: 0.5, height: 0.1)])
        try store.savePassage(passage)
        let ink = Data([9, 9, 2, 6])
        try store.saveDrawing(pieceID: piece.id, page: 2, data: ink)
        let original = try schema2Data(store.state)
        try original.write(to: store.fileURL, options: .atomic)
        let migrationDate = Date(timeIntervalSince1970: 1_800_000_001)
        let migrated = PracticeStore(directory: directory, now: { migrationDate })
        XCTAssertFalse(migrated.isReadOnly)
        XCTAssertEqual(migrated.state.schemaVersion, 3)
        XCTAssertEqual(migrated.state.passages.count, 1)
        XCTAssertEqual(migrated.state.passages[0].regions.count, 1, "Schema2 regions survive untouched")
        XCTAssertEqual(migrated.state.passages[0].createdAt, migrationDate, "A schema2 passage never had a createdAt either")
        XCTAssertEqual(migrated.state.inkStrokes.count, 1)
        let stroke = try XCTUnwrap(migrated.state.inkStrokes.first)
        XCTAssertEqual(stroke.pieceID, piece.id); XCTAssertEqual(stroke.page, 2); XCTAssertEqual(stroke.layer, .mine)
        XCTAssertEqual(stroke.data, ink, "Ink bytes must survive migration unchanged")
        XCTAssertEqual(stroke.createdAt, migrationDate); XCTAssertEqual(stroke.updatedAt, migrationDate)
        XCTAssertNil(stroke.deletedAt)
        XCTAssertEqual(migrated.drawing(pieceID: piece.id, page: 2), ink, "The compatibility reader keeps working after migration")
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(migrated.preservedOriginalURL)), original)
        XCTAssertTrue(try XCTUnwrap(migrated.preservedOriginalURL).lastPathComponent.hasPrefix("library-schema2-"))
    }

    /// Blocker-adjacent regression (major, data-safety): `migrateToSchema3` must sweep the epoch
    /// sentinel out of every `passageSnapshot` it can reach, not just top-level `passages` — a
    /// snapshot lives inside `activeSet`/`history` instead, which the original sweep never visited,
    /// so a migrated library was written to disk with `createdAt`/`updatedAt` frozen at the Unix
    /// epoch inside every set's snapshot forever (schema3 never migrates twice).
    @MainActor func testSchema2MigrationSweepsEpochSentinelFromPassageSnapshotsInActiveSetAndHistory() async throws {
        let (store, directory) = try fixture(target: 1)
        defer { try? FileManager.default.removeItem(at: directory) }
        let piece = store.pieces[0]
        try store.record(.clean) // completes fixture()'s own snapshot-less set so it is out of the way
        let historyPassage = Passage(pieceID: piece.id, title: "Reviewed passage", page: 1)
        let activePassage = Passage(pieceID: piece.id, title: "Current passage", page: 2)
        try store.savePassage(historyPassage); try store.savePassage(activePassage)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: historyPassage.id, targetCount: 1))
        XCTAssertEqual(store.activeSet?.configuration.passageSnapshot?.id, historyPassage.id)
        try store.record(.clean) // completes it: the snapshot now travels into `history`
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: activePassage.id, targetCount: 1))
        XCTAssertEqual(store.activeSet?.configuration.passageSnapshot?.id, activePassage.id)
        XCTAssertTrue(store.state.history.contains { $0.configuration.passageSnapshot?.id == historyPassage.id })

        let original = try schema2Data(store.state)
        try original.write(to: store.fileURL, options: .atomic)
        let migrationDate = Date(timeIntervalSince1970: 1_800_000_002)
        let migrated = PracticeStore(directory: directory, now: { migrationDate })
        XCTAssertFalse(migrated.isReadOnly)
        XCTAssertEqual(migrated.state.schemaVersion, 3)

        let activeSnapshot = try XCTUnwrap(migrated.state.activeSet?.configuration.passageSnapshot)
        XCTAssertEqual(activeSnapshot.id, activePassage.id)
        XCTAssertEqual(activeSnapshot.createdAt, migrationDate, "A schema2 snapshot never had its own createdAt either")
        XCTAssertEqual(activeSnapshot.updatedAt, migrationDate)

        let historySnapshot = try XCTUnwrap(migrated.state.history.first { $0.configuration.passageSnapshot?.id == historyPassage.id }?.configuration.passageSnapshot)
        XCTAssertEqual(historySnapshot.createdAt, migrationDate, "A history entry's snapshot must be swept too, not only the live activeSet")
        XCTAssertEqual(historySnapshot.updatedAt, migrationDate)

        // Minor: the same determinism gap for the collections schema1/2 never had at all.
        XCTAssertEqual(migrated.state.ruleSettings.updatedAt, migrationDate)
        XCTAssertEqual(migrated.state.rewardsState.updatedAt, migrationDate)
        XCTAssertEqual(migrated.state.profile.updatedAt, migrationDate)
        XCTAssertEqual(migrated.state.profile.joinDate, migrationDate)

        // Idempotent: migrating the already-migrated state again must not move the timestamp.
        let remigrated = SchemaMigration.migrateToSchema3(migrated.state, at: migrationDate.addingTimeInterval(60))
        XCTAssertEqual(remigrated, migrated.state)
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
        XCTAssertFalse(retried.isReadOnly); XCTAssertEqual(retried.state.schemaVersion, 3)
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
        tooLarge.inkStrokes = (1...5).map { InkStroke(pieceID: piece.id, page: $0, data: Data(count: PracticeStore.maximumDrawingBytes)) }
        XCTAssertThrowsError(try PracticeStore.validate(tooLarge), "32 MB total ink is still enforced across many stroke rows")
        var duplicate = store.state; duplicate.inkStrokes.append(duplicate.inkStrokes[0])
        XCTAssertThrowsError(try PracticeStore.validate(duplicate), "Duplicate stroke identifiers must be rejected")
        try store.saveDrawing(pieceID: piece.id, page: 1, data: Data())
        XCTAssertNil(store.drawing(pieceID: piece.id, page: 1))
        XCTAssertTrue(store.state.inkStrokes.filter { $0.deletedAt == nil }.isEmpty)
    }

    @MainActor func testReplaceInkDiffsByContentKeepingUnchangedRowsStable() async throws {
        let (store, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        var piece = store.pieces[0]; piece.pdfFileName = "fixture.pdf"; try store.updatePiece(piece)
        let strokeA = Data([1]), strokeB = Data([2]), strokeC = Data([3])
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: [strokeA, strokeB])
        let firstPass = store.inkStrokes(pieceID: piece.id, page: 1, layer: .mine)
        XCTAssertEqual(Set(firstPass.map(\.data)), [strokeA, strokeB])
        let rowA = try XCTUnwrap(firstPass.first { $0.data == strokeA })
        // Keep A, drop B, add C.
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .mine, strokes: [strokeA, strokeC])
        let secondPass = store.inkStrokes(pieceID: piece.id, page: 1, layer: .mine)
        XCTAssertEqual(Set(secondPass.map(\.data)), [strokeA, strokeC])
        let rowAAgain = try XCTUnwrap(secondPass.first { $0.data == strokeA })
        XCTAssertEqual(rowAAgain.id, rowA.id, "An unchanged stroke keeps its identity across saves")
        XCTAssertEqual(rowAAgain.createdAt, rowA.createdAt, "An unchanged stroke's createdAt never moves")
        XCTAssertTrue(store.state.inkStrokes.contains { $0.data == strokeB && $0.deletedAt != nil }, "A removed stroke is tombstoned, not erased")
        XCTAssertEqual(store.state.inkStrokes.filter { $0.deletedAt == nil }.count, 2)
        // Different layers of the same page never interfere.
        try store.replaceInk(pieceID: piece.id, page: 1, layer: .teacher, strokes: [strokeA])
        XCTAssertEqual(store.inkStrokes(pieceID: piece.id, page: 1, layer: .mine).count, 2)
        XCTAssertEqual(store.inkStrokes(pieceID: piece.id, page: 1, layer: .teacher).count, 1)
        XCTAssertEqual(store.inkStrokes(pieceID: piece.id, page: 1, layer: nil).count, 3)
        try PracticeStore.validate(store.state)
    }

    @MainActor func testHonestyRejectsANegativeRewardLedgerEntry() async throws {
        let (store, _) = try fixture()
        try store.appendRewardLedgerEntry(RewardLedgerEntry(coinsDelta: 5, xpDelta: 2, reason: "Completed a set"))
        XCTAssertEqual(store.state.rewardLedger.count, 1)
        XCTAssertThrowsError(try store.appendRewardLedgerEntry(RewardLedgerEntry(coinsDelta: -1, reason: "A Sloppy verdict must never cost coins")))
        XCTAssertThrowsError(try store.appendRewardLedgerEntry(RewardLedgerEntry(xpDelta: -1, reason: "A Sloppy verdict must never cost xp")))
        XCTAssertEqual(store.state.rewardLedger.count, 1, "A rejected entry must not be partially recorded")
    }

    func testRuleSettingsDefaultsMatchTheSpecFlaggedValues() {
        let settings = RuleSettings()
        XCTAssertEqual(RuleID.allCases.count, 15)
        XCTAssertEqual(settings.r1MaxMeasures, 4); XCTAssertEqual(settings.r1MaxSystems, 2)
        XCTAssertEqual(settings.r4CleanIntervalsDays, [1, 3, 7, 14, 30]); XCTAssertEqual(settings.r4ShakyIntervalDays, 2)
        XCTAssertEqual(settings.r5LearningStreak, 5); XCTAssertEqual(settings.r5ReviewStreak, 3)
        XCTAssertEqual(settings.r6ResetsBeforeStepDown, 3); XCTAssertEqual(settings.r6StepDownPercent, 6)
        XCTAssertEqual(settings.r7MaxIncreasesPerDay, 2)
        XCTAssertEqual(settings.r8TapsToOfferSplit, 3)
        XCTAssertEqual(settings.r9Minutes, 10); XCTAssertEqual(settings.r9Sets, 3)
        XCTAssertEqual(settings.r10DistinctDays, 3); XCTAssertTrue(settings.r10RequiresFirstInSession)
        XCTAssertEqual(settings.r11FinalWeekDays, 7); XCTAssertEqual(settings.r11FinalTwoWeeksDays, 14)
        XCTAssertEqual(settings.r12SlowDownsPerDay, 2)
        XCTAssertEqual(settings.r13ConsecutiveMissed, 2)
        XCTAssertEqual(settings.r14DropoutBars, 2)
        XCTAssertEqual(settings.r15MaxNewPerSession, 3)
        XCTAssertTrue([settings.r1Enabled, settings.r2Enabled, settings.r3Enabled, settings.r4Enabled, settings.r5Enabled,
                       settings.r6Enabled, settings.r7Enabled, settings.r8Enabled, settings.r9Enabled, settings.r10Enabled,
                       settings.r11Enabled, settings.r12Enabled, settings.r13Enabled, settings.r14Enabled, settings.r15Enabled].allSatisfy { $0 },
                      "Every rule is on by default")
    }

    @MainActor func testPieceLastPageHasItsOwnSyncClockSeparateFromMetadataUpdates() async throws {
        let (store, _) = try fixture()
        let piece = store.pieces[0]
        try store.updateLastPage(pieceID: piece.id, page: 3)
        let afterPageTurn = try XCTUnwrap(store.pieces.first)
        XCTAssertEqual(afterPageTurn.lastPage, 3)
        XCTAssertNotEqual(afterPageTurn.lastPageUpdatedAt, piece.lastPageUpdatedAt)
        XCTAssertEqual(afterPageTurn.updatedAt, piece.updatedAt, "Turning a page must not look like a metadata edit to sync")
    }

    /// Major regression (data-safety): `setPieceStatus` takes no caller struct to trust (just an id
    /// and a status), so — like `updateLastPage`/`recordWarmupUse` — the store itself must stamp
    /// `updatedAt`, or an Active/Resting change loses to any older edit under last-write-wins.
    @MainActor func testSetPieceStatusBumpsUpdatedAtUnderTheStoreClock() async throws {
        var current = Date(timeIntervalSince1970: 1_800_000_000)
        let (store, directory) = try fixture(now: { current })
        defer { try? FileManager.default.removeItem(at: directory) }
        let originalUpdatedAt = store.pieces[0].updatedAt
        current = current.addingTimeInterval(60)
        try store.setPieceStatus(store.pieces[0].id, status: .resting)
        XCTAssertEqual(store.pieces[0].status, .resting)
        XCTAssertEqual(store.pieces[0].updatedAt, current, "A status change is a metadata edit and must bump the LWW clock")
        XCTAssertNotEqual(store.pieces[0].updatedAt, originalUpdatedAt)
    }

    @MainActor func testNewEntityCRUDUpsertsAndSoftDeletes() async throws {
        let (store, _) = try fixture()
        let instrument = Instrument(family: .keyboard, name: "Piano", level: "Intermediate")
        try store.saveInstrument(instrument)
        XCTAssertEqual(store.state.instruments.map(\.name), ["Piano"])
        var updated = instrument; updated.level = "Advanced"
        try store.saveInstrument(updated)
        XCTAssertEqual(store.state.instruments.count, 1)
        XCTAssertEqual(store.state.instruments[0].level, "Advanced")
        try store.deleteInstrument(instrument.id)
        XCTAssertEqual(store.state.instruments.count, 1, "A soft delete keeps the row so sync can propagate it")
        XCTAssertNotNil(store.state.instruments[0].deletedAt)
        let entry = NotebookEntry(kind: .lessonPrep, pieceID: store.pieces[0].id, text: "Warm up slowly")
        try store.saveNotebookEntry(entry)
        XCTAssertEqual(store.state.notebookEntries.count, 1)
        try PracticeStore.validate(store.state)
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
        // §8: delete archives (tombstones) rather than erasing — the row survives with `archived`/
        // `deletedAt` set, not removed from `state.passages`.
        XCTAssertEqual(store.state.passages.map(\.id), [newer.id])
        XCTAssertEqual(store.state.passages.first?.archived, true)
        XCTAssertNotNil(store.state.passages.first?.deletedAt)
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
