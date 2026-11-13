import Foundation
import XCTest
@testable import PraeludeCore

@MainActor final class ScoreAsyncPracticePersistenceTests: XCTestCase {
    @MainActor private final class Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-async-practice-\(UUID())")
        let piece = Piece(title: "Prepared score", pdfFileName: "fixture.pdf", pageCount: 4)
        var store: PracticeStore!
        var date = Date(timeIntervalSince1970: 1_700_000_000)
        var afterSnapshot: (() -> Void)?
        var beforeWrite: (() -> Void)?
        var failWrites = false
        var writes = 0

        init(targetCount: Int = 5) throws {
            store = PracticeStore(directory: directory, now: { [unowned self] in
                let action = afterSnapshot; afterSnapshot = nil; action?()
                return date
            }, writeData: { [unowned self] data, url in
                writes += 1; beforeWrite?()
                if failWrites { throw PracticeError.unavailable("Synthetic disk full") }
                try data.write(to: url, options: .atomic)
            })
            try store.addPiece(piece)
            try store.startSet(PracticeConfiguration(pieceID: piece.id, targetCount: targetCount))
        }

        func cleanup() { try? FileManager.default.removeItem(at: directory) }
        func assertDurable(file: StaticString = #filePath, line: UInt = #line) throws {
            let saved = try PracticeStore.decodeBackup(Data(contentsOf: store.fileURL))
            XCTAssertEqual(saved, store.state, file: file, line: line)
            XCTAssertNoThrow(try PracticeStore.validate(saved), file: file, line: line)
        }
    }

    func testPreparedRecordIsDurableProjectedAndIdempotentIncludingCompletedSet() async throws {
        let f = try Fixture(targetCount: 1); defer { f.cleanup() }
        let id = UUID(), setID = try XCTUnwrap(f.store.activeSet?.id)
        let before = f.store.state
        f.beforeWrite = { XCTAssertEqual(f.store.state, before, "State must remain old until the write succeeds") }
        let recorded = try await f.store.recordPreparedAsync(.clean, hands: "Left hand", expectedActiveSetID: setID, eventID: id)
        XCTAssertTrue(recorded)
        f.beforeWrite = nil
        let set = try XCTUnwrap(f.store.activeSet)
        XCTAssertEqual(set.status, .completed)
        XCTAssertEqual(set.attempts.map(\.id), [id])
        XCTAssertEqual(set.attempts.first?.date, f.date)
        XCTAssertEqual(set.configuration.recordedHands[id.uuidString], "Left hand")
        XCTAssertEqual(f.store.sessions.last?.attempts, set.attempts)
        XCTAssertEqual(f.store.sessions.last?.completedSets, 1)
        try f.assertDurable()
        let writes = f.writes, bytes = try Data(contentsOf: f.store.fileURL)
        let retried = try await f.store.recordPreparedAsync(.clean, expectedActiveSetID: setID, eventID: id)
        XCTAssertFalse(retried)
        do {
            _ = try await f.store.recordPreparedAsync(.sloppy, expectedActiveSetID: setID, eventID: id)
            XCTFail("An event ID cannot change its verdict")
        } catch let error as PracticeError { guard case .conflict = error else { return XCTFail("\(error)") } }
        XCTAssertEqual(f.writes, writes)
        XCTAssertEqual(try Data(contentsOf: f.store.fileURL), bytes)
    }

    func testPreparedRecordCASRebasesOtherWritesAndKeepsOriginalEventDate() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        let setID = try XCTUnwrap(f.store.activeSet?.id), id = UUID(), originalDate = f.date
        var gates = 0
        var mutationError: Error?
        let committed = try await f.store.recordPreparedAsync(.clean, expectedActiveSetID: setID, eventID: id, canCommit: {
            gates += 1
            if gates == 2 {
                do {
                    f.date = originalDate.addingTimeInterval(10)
                    try f.store.checkpoint()
                    try f.store.updateLastPage(pieceID: f.piece.id, page: 3)
                    try f.store.setDefaultPracticeTempo(88, for: f.piece.id)
                    try f.store.replaceInk(pieceID: f.piece.id, page: 2, layer: .mine, strokes: [Data([9])])
                } catch { mutationError = error }
            }
            return true
        })
        XCTAssertTrue(committed)
        XCTAssertNil(mutationError)
        XCTAssertEqual(gates, 3, "The stale revision must prepare again rather than overwrite another writer")
        XCTAssertEqual(f.store.activeSet?.attempts.map(\.id), [id])
        XCTAssertEqual(f.store.activeSet?.attempts.first?.date, originalDate)
        XCTAssertEqual(f.store.activeSet?.activeSeconds, 10)
        XCTAssertEqual(f.store.activeSet?.lastCheckpoint, f.date, "Rebasing an older event must not move timing backwards")
        XCTAssertEqual(f.store.pieces.first?.lastPage, 3)
        XCTAssertEqual(f.store.pieces.first?.defaultPracticeBPM, 88)
        XCTAssertEqual(f.store.inkStrokes(pieceID: f.piece.id, page: 2).map(\.data), [Data([9])])
        try f.assertDurable()
    }

    func testPreparedRecordRejectsSetReplacementAndRetiredContext() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        let setID = try XCTUnwrap(f.store.activeSet?.id)
        var gates = 0
        var replacement: LibraryState?
        let rejectedID = UUID()
        do {
            _ = try await f.store.recordPreparedAsync(.clean, expectedActiveSetID: setID, eventID: rejectedID, canCommit: {
                gates += 1
                if gates == 2 {
                    try? f.store.endSet()
                    try? f.store.startSet(PracticeConfiguration(pieceID: f.piece.id))
                    replacement = f.store.state
                }
                return true
            })
            XCTFail("The original gesture cannot apply to a new set")
        } catch let error as PracticeError { guard case .conflict = error else { return XCTFail("\(error)") } }
        XCTAssertEqual(f.store.state, replacement)
        XCTAssertFalse(f.store.sessions.flatMap(\.attempts).contains { $0.id == rejectedID })
        let freshID = try XCTUnwrap(f.store.activeSet?.id), before = f.store.state, writes = f.writes
        gates = 0
        do {
            _ = try await f.store.recordPreparedAsync(.clean, expectedActiveSetID: freshID, canCommit: {
                gates += 1; return gates == 1
            })
            XCTFail("A closed score/scene gate must prevent commit after preparation")
        } catch let error as PracticeError { guard case .conflict = error else { return XCTFail("\(error)") } }
        XCTAssertEqual(f.store.state, before)
        XCTAssertEqual(f.writes, writes)
        try f.assertDurable()
    }

    func testPreparedRecordRejectsInterveningVerdictUndoTempoAndPause() async throws {
        for mutation in 0..<4 {
            let f = try Fixture(); defer { f.cleanup() }
            try f.store.record(.clean)
            let setID = try XCTUnwrap(f.store.activeSet?.id)
            var gates = 0
            var latest: LibraryState?
            do {
                _ = try await f.store.recordPreparedAsync(.clean, expectedActiveSetID: setID, canCommit: {
                    gates += 1
                    if gates == 2 {
                        switch mutation {
                        case 0: _ = try? f.store.record(.again)
                        case 1: try? f.store.undo()
                        case 2: try? f.store.adjustActiveTempo(72)
                        default: try? f.store.pause()
                        }
                        latest = f.store.state
                    }
                    return true
                })
                XCTFail("Semantic set change \(mutation) must retire the original gesture")
            } catch let error as PracticeError { guard case .conflict = error else { return XCTFail("\(error)") } }
            XCTAssertEqual(f.store.state, latest)
            try f.assertDurable()
        }
    }

    func testConcurrentSameEventRecordsOnceAndWriteFailureCanRetry() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        let setID = try XCTUnwrap(f.store.activeSet?.id), id = UUID()
        let before = f.store.state, bytes = try Data(contentsOf: f.store.fileURL)
        f.failWrites = true
        do {
            _ = try await f.store.recordPreparedAsync(.clean, expectedActiveSetID: setID, eventID: id)
            XCTFail("A failed write must not publish the event")
        } catch { }
        XCTAssertEqual(f.store.state, before)
        XCTAssertEqual(try Data(contentsOf: f.store.fileURL), bytes)
        XCTAssertEqual(f.store.errorMessage, "Synthetic disk full")
        f.failWrites = false
        async let first = f.store.recordPreparedAsync(.clean, expectedActiveSetID: setID, eventID: id)
        async let second = f.store.recordPreparedAsync(.clean, expectedActiveSetID: setID, eventID: id)
        let results = try await [first, second]
        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(f.store.activeSet?.attempts.map(\.id), [id])
        XCTAssertNil(f.store.errorMessage)
        try f.assertDurable()
    }

    func testPreparedRecordCancellationAndBusyRetryLimitDoNotPublishAttempt() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        let setID = try XCTUnwrap(f.store.activeSet?.id), before = f.store.state, writes = f.writes
        var task: Task<Bool, Error>?
        f.afterSnapshot = { task?.cancel() }
        task = Task { try await f.store.recordPreparedAsync(.clean, expectedActiveSetID: setID) }
        do { _ = try await task!.value; XCTFail("Cancelled preparation cannot commit") } catch is CancellationError { }
        XCTAssertEqual(f.store.state, before)
        XCTAssertEqual(f.writes, writes)
        var gates = 0
        do {
            _ = try await f.store.recordPreparedAsync(.clean, expectedActiveSetID: setID, canCommit: {
                gates += 1
                if gates > 1 { try? f.store.updateLastPage(pieceID: f.piece.id, page: gates.isMultiple(of: 2) ? 2 : 3) }
                return true
            })
            XCTFail("Contention must stop after four attempts")
        } catch let error as PracticeError { guard case .conflict = error else { return XCTFail("\(error)") } }
        XCTAssertEqual(gates, 5)
        XCTAssertEqual(f.store.activeSet?.attempts, [])
        try f.assertDurable()
    }

    func testPreparedBookmarkRebasesUnrelatedChangesButNeverOverwritesNewerTurn() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        f.afterSnapshot = {
            _ = try? f.store.record(.clean)
            try? f.store.setDefaultPracticeTempo(90, for: f.piece.id)
        }
        try await f.store.updateLastPagePreparedAsync(pieceID: f.piece.id, page: 2)
        XCTAssertEqual(f.store.pieces.first?.lastPage, 2)
        XCTAssertEqual(f.store.pieces.first?.defaultPracticeBPM, 90)
        XCTAssertEqual(f.store.activeSet?.attempts.count, 1)
        let writes = f.writes
        try await f.store.updateLastPagePreparedAsync(pieceID: f.piece.id, page: 2)
        XCTAssertEqual(f.writes, writes)
        var latest: LibraryState?
        f.afterSnapshot = { try? f.store.updateLastPage(pieceID: f.piece.id, page: 4); latest = f.store.state }
        do {
            try await f.store.updateLastPagePreparedAsync(pieceID: f.piece.id, page: 3)
            XCTFail("A newer reading position must win")
        } catch let error as PracticeError { guard case .conflict = error else { return XCTFail("\(error)") } }
        XCTAssertEqual(f.store.state, latest)
        try f.assertDurable()
    }

    func testPreparedBookmarkWriteFailureAndInvalidPageKeepStateAndBytes() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        let before = f.store.state, bytes = try Data(contentsOf: f.store.fileURL)
        f.failWrites = true
        do { try await f.store.updateLastPagePreparedAsync(pieceID: f.piece.id, page: 2); XCTFail("Write must fail") } catch { }
        XCTAssertEqual(f.store.state, before)
        XCTAssertEqual(try Data(contentsOf: f.store.fileURL), bytes)
        f.failWrites = false
        do { try await f.store.updateLastPagePreparedAsync(pieceID: f.piece.id, page: 99); XCTFail("Invalid page must fail") } catch { }
        XCTAssertEqual(f.store.state, before)
        XCTAssertEqual(try Data(contentsOf: f.store.fileURL), bytes)
        XCTAssertEqual(f.store.errorMessage, "A score contains an invalid page number.", "Preparation errors must replace stale disk errors rather than disappear in a runtime catch")
        try await f.store.updateLastPagePreparedAsync(pieceID: f.piece.id, page: 2)
        try f.assertDurable()
    }

    func testLargeInkRecordAndBookmarkPreparationAllowMainActorHeartbeat() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        // About the physical library's 2.5 MB of opaque ink, spread over realistic stroke rows.
        let inputs = (0..<550).map { index in
            PracticeStore.InkStrokeInput(data: Data(repeating: UInt8(index % 251), count: 4546),
                                         fingerprint: Data(String(index).utf8))
        }
        try f.store.replaceInk(pieceID: f.piece.id, page: 1, layer: .mine, strokes: inputs)
        let setID = try XCTUnwrap(f.store.activeSet?.id)
        var ticks = 0
        let heartbeat = Task { @MainActor in
            while !Task.isCancelled {
                ticks += 1
                try? await Task.sleep(for: .milliseconds(1))
            }
        }
        defer { heartbeat.cancel() }
        await Task.yield()
        var ticksAtWrite = 0
        f.beforeWrite = { ticksAtWrite = ticks }
        let beforeRecord = ticks
        _ = try await f.store.recordPreparedAsync(.clean, expectedActiveSetID: setID)
        XCTAssertGreaterThanOrEqual(ticksAtWrite - beforeRecord, 2, "MainActor heartbeat must run while the large snapshot prepares, before its write")
        let beforePage = ticks
        try await f.store.updateLastPagePreparedAsync(pieceID: f.piece.id, page: 2)
        XCTAssertGreaterThanOrEqual(ticksAtWrite - beforePage, 2)
        f.beforeWrite = nil
        try f.assertDurable()
    }

    func testPreparedRuleCommitsEventAndTempoTogetherAndIsIdempotent() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        let set = try XCTUnwrap(f.store.activeSet)
        let decision = Decision(ruleID: .r6SlowDown, pieceID: f.piece.id, reason: "Synthetic demotion", firedAt: f.date,
                                outcome: .tempoChange(newBPM: 56))
        let before = f.store.state
        f.beforeWrite = { XCTAssertEqual(f.store.state, before) }
        let applied = try await f.store.applyPracticeRulePreparedAsync(decision, expectedSet: set)
        XCTAssertTrue(applied)
        f.beforeWrite = nil
        XCTAssertEqual(f.store.activeSet?.currentBPM, 56)
        XCTAssertEqual(f.store.state.ruleEvents, [decision.asRuleEvent()])
        let writes = f.writes
        let repeated = try await f.store.applyPracticeRulePreparedAsync(decision, expectedSet: set)
        XCTAssertFalse(repeated)
        XCTAssertEqual(f.writes, writes)
        try f.assertDurable()
    }

    func testPreparedRuleRechecksGateAndSetBeforeCommit() async throws {
        for replaceSet in [false, true] {
            let f = try Fixture(); defer { f.cleanup() }
            let set = try XCTUnwrap(f.store.activeSet)
            let decision = Decision(ruleID: .r14PulseCheck, pieceID: f.piece.id, reason: "Synthetic pulse", firedAt: f.date,
                                    outcome: .pulseCheck(.init(leadInBars: 1, silentBars: 1, recoveryBars: 1)))
            var gates = 0
            var latest = f.store.state
            do {
                _ = try await f.store.applyPracticeRulePreparedAsync(decision, expectedSet: set, canCommit: {
                    gates += 1
                    if gates == 2, replaceSet {
                        try? f.store.endSet()
                        try? f.store.startSet(PracticeConfiguration(pieceID: f.piece.id))
                        latest = f.store.state
                    }
                    return gates == 1 || replaceSet
                })
                XCTFail("A retired gate or replacement set must prevent this rule")
            } catch let error as PracticeError { guard case .conflict = error else { return XCTFail("\(error)") } }
            XCTAssertEqual(f.store.state, latest)
            XCTAssertTrue(f.store.state.ruleEvents.isEmpty)
            try f.assertDurable()
        }
    }

    func testPreparedRuleWriteFailureCannotPublishPartialTempoOrEvent() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        let set = try XCTUnwrap(f.store.activeSet), before = f.store.state, bytes = try Data(contentsOf: f.store.fileURL)
        let decision = Decision(ruleID: .r6SlowDown, pieceID: f.piece.id, reason: "Synthetic demotion", firedAt: f.date,
                                outcome: .tempoChange(newBPM: 56))
        f.failWrites = true
        do { _ = try await f.store.applyPracticeRulePreparedAsync(decision, expectedSet: set); XCTFail("Write must fail") } catch { }
        XCTAssertEqual(f.store.state, before)
        XCTAssertEqual(try Data(contentsOf: f.store.fileURL), bytes)
        f.failWrites = false
        _ = try await f.store.applyPracticeRulePreparedAsync(decision, expectedSet: set)
        try f.assertDurable()
    }

    func testPreparedCheckpointMergesRepAndNeverCreditsPausedOrReplacementSet() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        f.date = f.date.addingTimeInterval(12)
        f.afterSnapshot = { _ = try? f.store.record(.clean) }
        try await f.store.checkpointPreparedAsync()
        XCTAssertEqual(f.store.activeSet?.activeSeconds, 12)
        XCTAssertEqual(f.store.activeSet?.attempts.count, 1)
        f.date = f.date.addingTimeInterval(20)
        f.afterSnapshot = { try? f.store.pause() }
        try await f.store.checkpointPreparedAsync()
        XCTAssertEqual(f.store.activeSet?.status, .paused)
        XCTAssertEqual(f.store.activeSet?.activeSeconds, 32)
        let before = f.store.state
        try await f.store.checkpointPreparedAsync()
        XCTAssertEqual(f.store.state, before)
        try f.assertDurable()
    }

    func testPreparedRewardsHighWaterAndConcurrentReconciliationPayOnlyOnce() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        try f.store.record(.clean); try f.store.record(.clean)
        let writes = f.writes
        async let first = f.store.reconcileRewardsPreparedAsync(asOf: f.date)
        async let second = f.store.reconcileRewardsPreparedAsync(asOf: f.date)
        let receipts = try await [first, second]
        XCTAssertEqual(f.writes, writes + 1, "The losing revision must recompute a no-op instead of duplicating awards")
        XCTAssertEqual(f.store.state.rewardLedger.filter { $0.reason == "Completed repetition" }.count, 2)
        XCTAssertEqual(f.store.state.rewardLedger.reduce(0) { $0 + $1.xpDelta }, 2)
        XCTAssertEqual(f.store.state.rewardsState.rank, RewardsEngine.rankProgress(totalXP: 2).rankName)
        XCTAssertTrue(receipts.allSatisfy { $0.badges.isEmpty && $0.milestones.isEmpty })
        try f.store.undo()
        _ = try await f.store.reconcileRewardsPreparedAsync(asOf: f.date)
        XCTAssertEqual(f.store.state.rewardLedger.count, 2, "Undo never claws back a previously paid coin")
        try f.store.record(.clean)
        _ = try await f.store.reconcileRewardsPreparedAsync(asOf: f.date)
        XCTAssertEqual(f.store.state.rewardLedger.count, 2, "Returning to the old high-water count never pays twice")
        try f.store.record(.again)
        _ = try await f.store.reconcileRewardsPreparedAsync(asOf: f.date)
        XCTAssertEqual(f.store.state.rewardLedger.count, 3)
        try f.assertDurable()
    }

    func testPreparedRewardsPreserveMilestoneIdentityStreakAndBadgesInOneCommit() async throws {
        let f = try Fixture(targetCount: 1); defer { f.cleanup() }
        try f.store.record(.clean); try f.store.endSet()
        var first = Passage(pieceID: f.piece.id, title: "Same title")
        var second = Passage(pieceID: f.piece.id, title: "Same title")
        first.learningState = .performanceReady; second.learningState = .performanceReady
        try f.store.savePassage(first); try f.store.savePassage(second)
        let before = f.store.state, writes = f.writes
        f.beforeWrite = { XCTAssertEqual(f.store.state, before) }
        let receipt = try await f.store.reconcileRewardsPreparedAsync(asOf: f.date)
        f.beforeWrite = nil
        XCTAssertEqual(f.writes, writes + 1)
        XCTAssertEqual(f.store.state.rewardLedger.filter { $0.reason == "Completed repetition" }.count, 1)
        XCTAssertEqual(f.store.state.rewardLedger.filter { $0.reason == "Completed set" }.count, 1)
        XCTAssertEqual(f.store.state.rewardLedger.filter { $0.reason == "Passage performance-ready" }.count, 2)
        XCTAssertEqual(f.store.state.rewardLedger.filter { $0.reason == "Piece fully ready" }.count, 1)
        XCTAssertEqual(Set(receipt.milestones.compactMap(\.passageID)), Set([first.id, second.id]))
        XCTAssertEqual(receipt.milestones.filter { $0.kind == MilestoneKind.pieceReady.rawValue }.count, 1)
        XCTAssertEqual(Set(receipt.badges.map(\.key)), ["first_set", "first_performance_ready"])
        XCTAssertEqual(f.store.state.rewardsState.streakDays, 1)
        XCTAssertEqual(f.store.state.rewardsState.lastPracticeDate, f.date)
        let saved = f.store.state
        let retried = try await f.store.reconcileRewardsPreparedAsync(asOf: f.date)
        XCTAssertTrue(retried.badges.isEmpty && retried.milestones.isEmpty)
        XCTAssertEqual(f.store.state, saved)
        try f.assertDurable()
    }

    func testPreparedRewardsMergeNavigationAndFailureProducesNoReceiptOrPublishedAwards() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        try f.store.record(.clean)
        let before = f.store.state, bytes = try Data(contentsOf: f.store.fileURL)
        f.failWrites = true
        do { _ = try await f.store.reconcileRewardsPreparedAsync(asOf: f.date); XCTFail("Failed write cannot return rewards") } catch { }
        XCTAssertEqual(f.store.state, before)
        XCTAssertEqual(try Data(contentsOf: f.store.fileURL), bytes)
        f.failWrites = false
        async let reward = f.store.reconcileRewardsPreparedAsync(asOf: f.date)
        async let navigation: Void = f.store.updateLastPagePreparedAsync(pieceID: f.piece.id, page: 3)
        _ = try await (reward, navigation)
        XCTAssertEqual(f.store.pieces.first?.lastPage, 3)
        XCTAssertEqual(f.store.state.rewardLedger.filter { $0.reason == "Completed repetition" }.count, 1)
        try f.assertDurable()
    }

    func testPreparedBookmarkRejectsInterveningPageOrderChange() async throws {
        let f = try Fixture(); defer { f.cleanup() }
        var latest: LibraryState?
        f.afterSnapshot = {
            let edits = PageLayout.seedEdits(existing: [], pieceID: f.piece.id, sourcePageCount: 4, now: f.date)
            try? f.store.savePageEdits(PageLayout.renumbered(Array(edits.reversed())))
            latest = f.store.state
        }
        do {
            try await f.store.updateLastPagePreparedAsync(pieceID: f.piece.id, page: 3)
            XCTFail("A position in the old page order cannot overwrite a newly ordered score")
        } catch let error as PracticeError { guard case .conflict = error else { return XCTFail("\(error)") } }
        XCTAssertEqual(f.store.state, latest)
        XCTAssertEqual(f.store.pieces.first?.lastPage, 1)
        try f.assertDurable()
    }
}
