import Foundation
import XCTest
@testable import Praelude

private actor PracticeDependencyTransport: SyncTransport {
    let rows: [String: [[String: SyncJSON]]]
    private(set) var fetched: [String] = []
    var failTable: String?
    var pausedTable: String?
    private var started = false
    private var startWaiter: CheckedContinuation<Void, Never>?
    private var releaseWaiter: CheckedContinuation<Void, Never>?
    init(rows: [String: [[String: SyncJSON]]]) { self.rows = rows }
    func setFailure(_ table: String?) { failTable = table }
    func pause(on table: String) { pausedTable = table }
    func waitForPause() async { if !started { await withCheckedContinuation { startWaiter = $0 } } }
    func release() { releaseWaiter?.resume(); releaseWaiter = nil }
    func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] {
        fetched.append(table)
        if table == pausedTable {
            started = true; startWaiter?.resume(); startWaiter = nil
            await withCheckedContinuation { releaseWaiter = $0 }
        }
        if table == failTable { throw SyncError.transport("Synthetic metadata fetch failure") }
        return rows[table] ?? []
    }
    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        let stored = rows[table]?.first { $0["id"] == row["id"] }
        return .init(applied: false, row: stored)
    }
    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult { .init(applied: true, row: nil) }
    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult { .init(applied: true, row: nil) }
    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult { .init(applied: true, row: nil) }
}

@MainActor final class SyncPracticeDependencyTests: XCTestCase {
    private struct Fixture {
        let store: PracticeStore
        let engine: SyncEngine
        let coordinator: SyncCoordinator
        let transport: PracticeDependencyTransport
        let newPassageID: UUID
        let newSetID: UUID
        let before: LibraryState
        let queueBytes: Data
    }
    private func row<T: Encodable>(_ value: T) throws -> [String: SyncJSON] {
        try XCTUnwrap(SyncJSON(encoding: value).objectValue)
    }
    private func fixture() throws -> Fixture {
        let date = Date(timeIntervalSince1970: 1_790_000_000)
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("sync-practice-parents-\(UUID())")
        addTeardownBlock { try? FileManager.default.removeItem(at: path) }
        let store = PracticeStore(directory: path, now: { date.addingTimeInterval(50) })
        let piece = Piece(title: "Newer local score title", pdfFileName: "fixture.pdf", pageCount: 2, createdAt: date, updatedAt: date.addingTimeInterval(50))
        try store.addPiece(piece)
        let passage = Passage(pieceID: piece.id, title: "Newer local passage", createdAt: date, updatedAt: date.addingTimeInterval(50))
        try store.savePassage(passage)
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: passage.id, targetCount: 10, useMetronome: false))
        try store.record(.clean); try store.record(.again); try store.undo(); try store.endSession()
        let old = try XCTUnwrap(store.state.history.last)
        let oldSession = try XCTUnwrap(store.state.sessions.first { $0.id == old.sessionID })
        // This separate active session must survive adopting older history from another device.
        try store.startSet(PracticeConfiguration(pieceID: piece.id, passageID: passage.id, targetCount: 10, useMetronome: false))
        try store.record(.clean)
        let newPassage = Passage(pieceID: piece.id, title: "New remote passage", page: 2,
                                 regions: [PassageRegion(page: 2, x: 0.1, y: 0.2, width: 0.5, height: 0.2)],
                                 parentPassageID: passage.id, createdAt: date, updatedAt: date.addingTimeInterval(100))
        var remoteSession = PracticeSession(pieceID: piece.id, focus: "Pulse", startedAt: date.addingTimeInterval(20))
        remoteSession.endedAt = date.addingTimeInterval(30)
        var newSet = ActiveSet(sessionID: remoteSession.id,
                               configuration: PracticeConfiguration(pieceID: piece.id, passageID: newPassage.id, targetCount: 10,
                                                                    useMetronome: false, passageSnapshot: newPassage),
                               startedAt: remoteSession.startedAt)
        newSet.attempts = [Attempt(verdict: .clean, date: date.addingTimeInterval(25), bpm: newSet.currentBPM)]
        newSet = PracticeEngine.project(newSet); newSet.status = .ended
        newSet.endedAt = remoteSession.endedAt; newSet.lastCheckpoint = nil
        var olderPiece = piece; olderPiece.title = "Older remote score"; olderPiece.updatedAt = date
        var olderPassage = passage; olderPassage.title = "Older remote passage"; olderPassage.updatedAt = date
        let tag = Tag(name: "Synthetic tag", createdAt: date, updatedAt: date)
        let parent = Folder(name: "Synthetic book", createdAt: date, updatedAt: date)
        let child = Folder(name: "Synthetic movement", parentFolderID: parent.id, createdAt: date, updatedAt: date)
        let clock = date.addingTimeInterval(100)
        var attempts: [[String: SyncJSON]] = []
        for set in [old, newSet] {
            for attempt in set.attempts {
                var dto = AttemptSyncRow(attempt, setID: set.id); dto.undone_at = attempt.undoneAt
                attempts.append(try row(dto))
            }
        }
        let rows = try ["practice_sessions": [row(PracticeSessionSyncRow(oldSession, pushedAt: clock)), row(PracticeSessionSyncRow(remoteSession, pushedAt: clock))],
                        "sets": [row(SetSyncRow(old, pushedAt: clock)), row(SetSyncRow(newSet, pushedAt: clock))],
                        "attempts": attempts, "tags": [row(TagSyncRow(tag))],
                        "folders": [row(FolderSyncRow(child)), row(FolderSyncRow(parent))],
                        "pieces": [row(PieceSyncRow(olderPiece))],
                        "passages": [row(PassageSyncRow(newPassage)), row(PassageSyncRow(olderPassage))]]
        let transport = PracticeDependencyTransport(rows: rows)
        let engine = SyncEngine(transport: transport, directory: path.appendingPathComponent("Sync"))
        try engine.bindAccount(UUID())
        try engine.enqueueUpsert(table: "sets", row: row(SetSyncRow(old, pushedAt: date)))
        let coordinator = SyncCoordinator(engine: engine, auth: AuthManager(services: SupabaseServices(), store: store), store: store)
        return Fixture(store: store, engine: engine, coordinator: coordinator, transport: transport,
                       newPassageID: newPassage.id, newSetID: newSet.id, before: store.state,
                       queueBytes: try Data(contentsOf: path.appendingPathComponent("Sync/sync-queue.json")))
    }
    private func drain(_ fixture: Fixture, validate: @escaping () throws -> Void = {}) async -> Bool {
        await fixture.engine.drain(adoptPracticeSnapshot: {
            try await fixture.engine.pullPracticeSnapshot(prepareRows: {
                try await fixture.coordinator.preparePracticeDependencies($0, validateAccount: validate)
            }) { try fixture.coordinator.applyPulledPracticeSnapshot($0) }
        })
    }

    func testStaleSetDrainHydratesNewPassageBeforeAdoptionAndAcknowledgesOriginalQueue() async throws {
        let f = try fixture()
        let blocked = await f.engine.drain(adoptPracticeSnapshot: {
            try await f.engine.pullPracticeSnapshot { try f.coordinator.applyPulledPracticeSnapshot($0) }
        })
        XCTAssertFalse(blocked, "Control: the old order fails on the remote set's missing passage")
        XCTAssertEqual(f.store.errorMessage, "A practice set references a missing passage.")
        XCTAssertEqual(f.engine.pendingCount, 1)
        XCTAssertEqual(f.store.state, f.before)
        let recovered = await drain(f)
        XCTAssertTrue(recovered)
        XCTAssertEqual(f.engine.pendingCount, 0)
        XCTAssertTrue(f.store.state.passages.contains { $0.id == f.newPassageID })
        XCTAssertTrue(f.store.state.history.contains { $0.id == f.newSetID })
        XCTAssertEqual(f.store.activeSet, f.before.activeSet)
        XCTAssertEqual(f.store.state.history.first { $0.id == f.before.history[0].id }?.attempts, f.before.history[0].attempts)
        XCTAssertEqual(f.store.state.pieces[0].title, "Newer local score title")
        XCTAssertEqual(f.store.state.passages.first { $0.id == f.before.passages[0].id }?.title, "Newer local passage")
        XCTAssertNotNil(f.engine.state.cursors["sets"])
        let calls = await f.transport.fetched
        XCTAssertEqual(Array(calls.suffix(9)), ["practice_sessions", "sets", "attempts", "instruments", "tags", "folders", "pieces", "page_edits", "passages"])
        let count = calls.count
        try await f.engine.pullPracticeSnapshot(prepareRows: { try await f.coordinator.preparePracticeDependencies($0, validateAccount: {}) }) {
            try f.coordinator.applyPulledPracticeSnapshot($0)
        }
        let repeatCalls = await f.transport.fetched
        XCTAssertEqual(Array(repeatCalls.dropFirst(count)), ["practice_sessions", "sets", "attempts"], "Known parents need no metadata hydration")
    }

    func testFailedMetadataHydrationKeepsQueueAndPracticeReceiptsForRetry() async throws {
        let f = try fixture()
        await f.transport.setFailure("passages")
        let failed = await drain(f)
        XCTAssertFalse(failed)
        XCTAssertEqual(f.engine.pendingCount, 1)
        XCTAssertEqual(try Data(contentsOf: f.store.directory.appendingPathComponent("Sync/sync-queue.json")), f.queueBytes)
        for key in ["practice_sessions", "sets", "attempts#date"] { XCTAssertNil(f.engine.state.cursors[key]) }
        XCTAssertEqual(f.store.state.history, f.before.history)
        XCTAssertEqual(f.store.activeSet, f.before.activeSet)
        await f.transport.setFailure(nil)
        let retried = await drain(f)
        XCTAssertTrue(retried)
        XCTAssertEqual(f.engine.pendingCount, 0)
    }

    func testAccountChangeDuringMetadataFetchCannotAdoptOrAcknowledgePractice() async throws {
        let f = try fixture()
        await f.transport.pause(on: "passages")
        var accountStillMatches = true
        let work = Task { await drain(f) {
            guard accountStillMatches else { throw SyncError.transport("Account changed during sync.") }
        } }
        await f.transport.waitForPause()
        accountStillMatches = false
        await f.transport.release()
        let result = await work.value
        XCTAssertFalse(result)
        XCTAssertEqual(f.engine.pendingCount, 1)
        XCTAssertEqual(try Data(contentsOf: f.store.directory.appendingPathComponent("Sync/sync-queue.json")), f.queueBytes)
        for key in ["practice_sessions", "sets", "attempts#date"] { XCTAssertNil(f.engine.state.cursors[key]) }
        XCTAssertFalse(f.store.state.passages.contains { $0.id == f.newPassageID })
        XCTAssertEqual(f.store.state.history, f.before.history)
        XCTAssertEqual(f.store.activeSet, f.before.activeSet)
    }

    func testRepAndUndoDuringSuspendedHydrationKeepNewProgressAndQueueTail() async throws {
        let f = try fixture()
        await f.transport.pause(on: "passages")
        let work = Task { await drain(f) }
        await f.transport.waitForPause()
        try f.store.record(.again)
        try f.store.undo()
        let active = try XCTUnwrap(f.store.activeSet)
        try f.coordinator.enqueuePracticeProgress(active, session: f.store.state.sessions.first { $0.id == active.sessionID })
        let pending = try JSONDecoder().decode([SyncQueueEntry].self,
            from: Data(contentsOf: f.store.directory.appendingPathComponent("Sync/sync-queue.json")))
        let appended = Array(pending.dropFirst())
        XCTAssertFalse(appended.isEmpty)
        XCTAssertTrue(appended.contains { $0.kind == .undoAttempt })
        await f.transport.release()
        let result = await work.value
        XCTAssertTrue(result)
        XCTAssertEqual(f.store.activeSet, active)
        let retained = try JSONDecoder().decode([SyncQueueEntry].self,
            from: Data(contentsOf: f.store.directory.appendingPathComponent("Sync/sync-queue.json")))
        XCTAssertEqual(retained, appended, "Only the captured stale entry is acknowledged; concurrent progress remains queued")
        XCTAssertTrue(f.store.state.history.contains { $0.id == f.newSetID })
    }
}
