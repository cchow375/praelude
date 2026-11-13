import Foundation
import XCTest
@testable import PraeludeCore

private actor PracticePreparationTransport: SyncTransport {
    private(set) var fetches: [String] = []
    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult { .init(applied: true, row: nil) }
    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult { .init(applied: true, row: nil) }
    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult { .init(applied: true, row: nil) }
    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult { .init(applied: true, row: nil) }
    func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] {
        fetches.append(table)
        return [["id": .string(table), field: .string("2026-10-18T10:00:00Z")]]
    }
}

private actor PracticePreparationGate {
    private var started = false
    private var startWaiter: CheckedContinuation<Void, Never>?
    private var releaseWaiter: CheckedContinuation<Void, Never>?
    func suspend() async {
        started = true; startWaiter?.resume(); startWaiter = nil
        await withCheckedContinuation { releaseWaiter = $0 }
    }
    func waitForStart() async { if !started { await withCheckedContinuation { startWaiter = $0 } } }
    func release() { releaseWaiter?.resume(); releaseWaiter = nil }
}

@MainActor final class SyncPracticePreparationTests: XCTestCase {
    private func directory() -> URL {
        let value = FileManager.default.temporaryDirectory.appendingPathComponent("sync-practice-preparation-\(UUID())")
        addTeardownBlock { try? FileManager.default.removeItem(at: value) }
        return value
    }

    func testPreparationSuspendsPublicationAndReceiptsUsingOneFetchedGraph() async throws {
        let path = directory(), transport = PracticePreparationTransport(), gate = PracticePreparationGate()
        let engine = SyncEngine(transport: transport, directory: path)
        var prepared: [String: [[String: SyncJSON]]]?
        var committed: [String: [[String: SyncJSON]]]?
        let pull = Task {
            try await engine.pullPracticeSnapshot(prepareRows: { rows in
                prepared = rows
                await gate.suspend()
            }) { committed = $0 }
        }
        await gate.waitForStart()
        XCTAssertNotNil(prepared)
        XCTAssertNil(committed)
        XCTAssertTrue(engine.state.cursors.isEmpty)
        let calls = await transport.fetches
        XCTAssertEqual(calls, ["practice_sessions", "sets", "attempts"])
        await gate.release()
        try await pull.value
        XCTAssertEqual(committed, prepared, "Publish exactly the graph whose parents were prepared")
        let expected = SyncCoding.parseDate("2026-10-18T10:00:00Z")
        let reopened = SyncEngine(transport: transport, directory: path)
        for key in ["practice_sessions", "sets", "attempts#date"] { XCTAssertEqual(reopened.state.cursors[key], expected) }
        let finalCalls = await transport.fetches
        XCTAssertEqual(finalCalls, calls, "Preparation must not refetch the practice graph")
    }

    func testPreparationFailurePreservesQueueAndDurablePracticeReceipts() async throws {
        let path = directory(), transport = PracticePreparationTransport()
        let engine = SyncEngine(transport: transport, directory: path)
        try engine.enqueueUpsert(table: "sets", row: ["id": .string(UUID().uuidString)])
        let queueURL = path.appendingPathComponent("sync-queue.json")
        let originalQueue = try Data(contentsOf: queueURL)
        var applied = false
        do {
            try await engine.pullPracticeSnapshot(prepareRows: { _ in
                throw SyncError.transport("Synthetic parent hydration failure")
            }) { _ in applied = true }
            XCTFail("Preparation failure must abort practice adoption")
        } catch { XCTAssertEqual(error as? SyncError, .transport("Synthetic parent hydration failure")) }
        XCTAssertFalse(applied)
        XCTAssertEqual(try Data(contentsOf: queueURL), originalQueue)
        let reopened = SyncEngine(transport: transport, directory: path)
        XCTAssertEqual(reopened.pendingCount, 1)
        XCTAssertTrue(reopened.state.cursors.isEmpty)
    }

    func testAccountResetDuringPreparationRejectsPublicationAndPracticeReceipts() async throws {
        let path = directory(), transport = PracticePreparationTransport(), gate = PracticePreparationGate()
        let engine = SyncEngine(transport: transport, directory: path)
        try engine.bindAccount(UUID())
        var applied = false
        let pull = Task {
            try await engine.pullPracticeSnapshot(prepareRows: { _ in await gate.suspend() }) { _ in applied = true }
        }
        await gate.waitForStart()
        try engine.resetLocalAccountState()
        try engine.bindAccount(UUID())
        await gate.release()
        do { try await pull.value; XCTFail("Old account's prepared graph cannot publish") }
        catch { XCTAssertEqual(error as? SyncError, .transport("Account changed during sync.")) }
        XCTAssertFalse(applied)
        XCTAssertTrue(engine.state.cursors.isEmpty)
    }

    func testCancellationDuringPreparationKeepsQueueAndReceiptsUnacknowledged() async throws {
        let path = directory(), transport = PracticePreparationTransport(), gate = PracticePreparationGate()
        let engine = SyncEngine(transport: transport, directory: path)
        try engine.enqueueUpsert(table: "sets", row: ["id": .string(UUID().uuidString)])
        let queueURL = path.appendingPathComponent("sync-queue.json")
        let originalQueue = try Data(contentsOf: queueURL)
        var applied = false
        let pull = Task {
            try await engine.pullPracticeSnapshot(prepareRows: { _ in await gate.suspend() }) { _ in applied = true }
        }
        await gate.waitForStart()
        pull.cancel()
        await gate.release()
        do { try await pull.value; XCTFail("Cancelled preparation cannot publish") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertFalse(applied)
        XCTAssertEqual(try Data(contentsOf: queueURL), originalQueue)
        XCTAssertTrue(engine.state.cursors.isEmpty)
    }
}
