import Foundation
import XCTest
@testable import PraeludeCore

private actor SuspendedPullTransport: SyncTransport {
    private var started = false
    private var startWaiter: CheckedContinuation<Void, Never>?
    private var releaseWaiter: CheckedContinuation<Void, Never>?
    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult { .init(applied: true, row: nil) }
    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult { .init(applied: true, row: nil) }
    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult { .init(applied: true, row: nil) }
    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult { .init(applied: true, row: nil) }
    func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] {
        started = true
        startWaiter?.resume(); startWaiter = nil
        await withCheckedContinuation { releaseWaiter = $0 }
        return [["id": .string(UUID().uuidString), field: .string("2026-10-06T00:00:00Z")]]
    }
    func waitForFetch() async { if !started { await withCheckedContinuation { startWaiter = $0 } } }
    func releaseFetch() { releaseWaiter?.resume(); releaseWaiter = nil }
}

@MainActor final class SyncPullLifecycleTests: XCTestCase {
    func testAllPullKindsRejectRowsAfterAccountReset() async throws {
        for kind in 0..<3 {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sync-pull-lifecycle-\(UUID())")
            defer { try? FileManager.default.removeItem(at: directory) }
            let transport = SuspendedPullTransport()
            let engine = SyncEngine(transport: transport, directory: directory)
            try engine.bindAccount(UUID())
            var applied = false
            let pull = Task {
                switch kind {
                case 0: try await engine.pull(table: "pieces") { _ in applied = true }
                case 1: try await engine.pullRows(table: "pieces") { _ in applied = true }
                default: try await engine.pullPracticeSnapshot { _ in applied = true }
                }
            }
            await transport.waitForFetch()
            try engine.resetLocalAccountState()
            await transport.releaseFetch()
            do { try await pull.value; XCTFail("Expected stale pull rejection for kind \(kind)") }
            catch { XCTAssertEqual(error as? SyncError, .transport("Account changed during sync.")) }
            XCTAssertFalse(applied)
            XCTAssertTrue(engine.state.cursors.isEmpty)
            XCTAssertNil(engine.state.accountOwnerID)
        }
    }

    func testCancelledPullDoesNotApplyRowsOrAdvanceCursor() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("sync-pull-cancel-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport = SuspendedPullTransport()
        let engine = SyncEngine(transport: transport, directory: directory)
        var applied = false
        let pull = Task { try await engine.pull(table: "pieces") { _ in applied = true } }
        await transport.waitForFetch()
        pull.cancel()
        await transport.releaseFetch()
        do { try await pull.value; XCTFail("Expected cancellation") } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertFalse(applied)
        XCTAssertTrue(engine.state.cursors.isEmpty)
    }
}
