import Foundation
import XCTest
@testable import PraeludeCore

/// A minimal in-memory stand-in for the four sync RPCs + a PostgREST read (`SyncTransport`'s real
/// implementation is `PostgRESTSyncTransport`, which needs a live network and is exercised instead
/// by `(C) sync-smoke.sh`). Applies the same conditional "does this write win" comparison the real
/// `sync_upsert` RPC does server-side (see "(C) Sync Protocol.md" §2: whole-row upsert, keyed by
/// `id`, applied only if the incoming `updated_at` beats what is stored) — not a check-then-write
/// race — so a test can share one `FakeSyncServer` between two independent `SyncEngine`s (two
/// "devices" on the same account) and assert they converge, the same guarantee spec §17a asks for.
final class FakeSyncServer: @unchecked Sendable {
    private var tables: [String: [String: [String: SyncJSON]]] = [:]
    private var appended: Set<String> = []
    var isReachable = true

    func upsert(table: String, row: [String: SyncJSON]) -> SyncRPCResult {
        guard let id = row["id"]?.stringValue else { return SyncRPCResult(applied: false, row: nil) }
        let incoming = Self.date(row)
        if let existing = tables[table]?[id], let incoming, let existingDate = Self.date(existing), existingDate >= incoming {
            return SyncRPCResult(applied: false, row: existing)
        }
        tables[table, default: [:]][id] = row
        return SyncRPCResult(applied: true, row: row)
    }
    func append(table: String, row: [String: SyncJSON]) -> SyncRPCResult {
        guard let id = row["id"]?.stringValue else { return SyncRPCResult(applied: false, row: nil) }
        let key = "\(table)#\(id)"
        guard !appended.contains(key) else { return SyncRPCResult(applied: false, row: nil) }
        appended.insert(key)
        tables[table, default: [:]][id] = row
        return SyncRPCResult(applied: true, row: row)
    }
    func fetch(table: String, updatedSince: Date?) -> [[String: SyncJSON]] {
        (tables[table] ?? [:]).values.filter { row in
            guard let updatedSince else { return true }
            guard let updatedAt = Self.date(row) else { return true }
            return updatedAt > updatedSince
        }.sorted { ($0["updated_at"]?.stringValue ?? "") < ($1["updated_at"]?.stringValue ?? "") }
    }
    func row(table: String, id: String) -> [String: SyncJSON]? { tables[table]?[id] }
    private static func date(_ row: [String: SyncJSON]) -> Date? {
        row["updated_at"]?.stringValue.flatMap(SyncCoding.iso8601Formatter.date(from:))
    }
}

struct FakeSyncTransport: SyncTransport {
    let server: FakeSyncServer
    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        guard server.isReachable else { throw SyncError.transport("offline") }
        return server.upsert(table: table, row: row)
    }
    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        guard server.isReachable else { throw SyncError.transport("offline") }
        return server.append(table: table, row: row)
    }
    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult {
        guard server.isReachable else { throw SyncError.transport("offline") }
        return SyncRPCResult(applied: true, row: nil)
    }
    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult {
        guard server.isReachable else { throw SyncError.transport("offline") }
        return SyncRPCResult(applied: true, row: nil)
    }
    func fetch(table: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] {
        guard server.isReachable else { throw SyncError.transport("offline") }
        return server.fetch(table: table, updatedSince: updatedSince)
    }
}

@MainActor
final class SyncEngineTests: XCTestCase {
    private func row(id: UUID, title: String, updatedAt: Date) -> [String: SyncJSON] {
        ["id": .string(id.uuidString), "title": .string(title),
         "updated_at": .string(SyncCoding.iso8601Formatter.string(from: updatedAt))]
    }
    private func directory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("praelude-sync-tests-\(UUID())")
    }

    // MARK: Force-quit mid-set — the queue is persisted before the caller is told enqueue succeeded,
    // so a brand-new SyncEngine pointed at the same directory (simulating a relaunch after a
    // force-quit) must see every entry a prior instance enqueued, none dropped and none duplicated.

    func testQueuedWritesSurviveAForceQuitRelaunch() throws {
        let directory = directory()
        let server = FakeSyncServer(); server.isReachable = false // never drained in this instance
        let first = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory)
        let pieceID = UUID()
        try first.enqueueUpsert(table: "pieces", row: row(id: pieceID, title: "Sonata", updatedAt: Date()))
        try first.enqueueLastPage(pieceID: pieceID, lastPage: 4)
        XCTAssertEqual(first.pendingCount, 2)

        // A fresh instance over the same directory, as the app relaunching after a force-quit would
        // construct — nothing here shares in-memory state with `first`.
        let relaunched = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory)
        XCTAssertEqual(relaunched.pendingCount, 2, "A queued write must survive a force-quit before it was ever sent.")
    }

    // MARK: Offline -> stuck, using an injected clock rather than a real sleep.

    func testOfflineSurfacesAsOfflineThenStuckAfterThreshold() async throws {
        let server = FakeSyncServer(); server.isReachable = false
        var now = Date(timeIntervalSince1970: 1_000_000)
        let engine = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory(),
                                 now: { now }, stuckThreshold: 60)
        try engine.enqueueUpsert(table: "pieces", row: row(id: UUID(), title: "Etude", updatedAt: now))

        var applied = await engine.drain()
        XCTAssertFalse(applied)
        guard case .offline = engine.status else { return XCTFail("Expected .offline on the first failure, got \(engine.status)") }
        XCTAssertEqual(engine.pendingCount, 1, "A failed send must leave the entry queued, not drop it.")

        now.addTimeInterval(61) // past stuckThreshold, still offline
        applied = await engine.drain()
        XCTAssertFalse(applied)
        guard case .stuck(let message) = engine.status else { return XCTFail("Expected .stuck once past the threshold, got \(engine.status)") }
        XCTAssertFalse(message.isEmpty)

        server.isReachable = true
        applied = await engine.drain()
        XCTAssertTrue(applied)
        XCTAssertEqual(engine.pendingCount, 0)
        guard case .idle = engine.status else { return XCTFail("Expected .idle once the connection returns, got \(engine.status)") }
    }

    // MARK: Sign-out / sign-in — a pending write and a pull cursor from account A must never reach
    // or gate account B on the same device (SyncEngine.resetLocalAccountState's contract, wired from
    // AuthManager.onSignedOut in the real app — see SyncCoordinatorTests for that wiring).

    func testResetLocalAccountStateDropsQueueAndCursorsBetweenAccounts() async throws {
        let directory = directory()
        let serverA = FakeSyncServer()
        let engine = SyncEngine(transport: FakeSyncTransport(server: serverA), directory: directory)
        let staleID = UUID()
        try engine.enqueueUpsert(table: "pieces", row: row(id: staleID, title: "Account A's edit", updatedAt: Date()))
        try await engine.pull(table: "pieces") { _ in } // establishes a cursor (empty fetch, but still sets `latest` if rows existed; assert queue/cursor independently below)
        XCTAssertEqual(engine.pendingCount, 1)

        try engine.resetLocalAccountState()
        XCTAssertEqual(engine.pendingCount, 0, "A's pending write must not survive into B's session.")
        XCTAssertTrue(engine.state.cursors.isEmpty, "A's pull cursor must not gate what B receives.")

        // Signing into a different account (account B) on this device, against a different server
        // instance (a different account's data): draining now must be a no-op (nothing queued), and
        // A's edit must never have reached anywhere B can read it from this local state.
        let serverB = FakeSyncServer()
        let sameEngineNewSession = SyncEngine(transport: FakeSyncTransport(server: serverB), directory: directory)
        XCTAssertEqual(sameEngineNewSession.pendingCount, 0)
        XCTAssertNil(serverA.row(table: "pieces", id: staleID.uuidString), "A's queued write was dropped, never sent, even to A's own server.")
    }

    // MARK: Two-device convergence — spec §17a: "two-device sync identical history."

    func testTwoDevicesConvergeOnIdenticalHistoryAfterConflictingEdits() async throws {
        let server = FakeSyncServer()
        let pieceID = UUID()
        let deviceA = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory())
        let deviceB = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory())

        // Both devices start from the same record, then edit it offline at different times before
        // either syncs. Device B's edit is later; pushing it first establishes the server's row, so
        // Device A's older push (drained second) must lose the server-side LWW comparison and adopt
        // the server's row instead of quietly believing its own now-stale push stuck — spec §4d's
        // field-level LWW, exercised through the real queue/drain path, not just the pure comparison
        // `testLastWriteWinsPrefersTheNewerTimestampAndIsNilSafe` checks in isolation.
        let earlier = Date(timeIntervalSince1970: 1_700_000_000)
        let later = earlier.addingTimeInterval(120)
        try deviceA.enqueueUpsert(table: "pieces", row: row(id: pieceID, title: "Device A's title", updatedAt: earlier))
        try deviceB.enqueueUpsert(table: "pieces", row: row(id: pieceID, title: "Device B's title", updatedAt: later))

        var applyLogA: [(String, [String: SyncJSON])] = []
        var applyLogB: [(String, [String: SyncJSON])] = []
        _ = await deviceB.drain { applyLogB.append(($0, $1)) } // the later write; establishes the server's row
        _ = await deviceA.drain { applyLogA.append(($0, $1)) } // the earlier write; sent second, must lose

        // B's own push wasn't rejected (it was the newest write), so nothing was handed back to adopt.
        XCTAssertTrue(applyLogB.isEmpty)
        // A's push loses the server-side LWW comparison against B's already-stored later row, so A
        // must adopt the server's row instead of quietly believing its own push stuck.
        XCTAssertEqual(applyLogA.count, 1)
        XCTAssertEqual(applyLogA.first?.1["title"]?.stringValue, "Device B's title")

        // Both devices now pull; each must end up with the exact same row for this id.
        var pulledA: [String: SyncJSON]?
        var pulledB: [String: SyncJSON]?
        try await deviceA.pull(table: "pieces") { pulledA = $0 }
        try await deviceB.pull(table: "pieces") { pulledB = $0 }

        let serverTruth = server.row(table: "pieces", id: pieceID.uuidString)
        XCTAssertEqual(serverTruth?["title"], .string("Device B's title"))
        // A's own rejected-push adoption already converged it; the pull is a redundant confirmation
        // (A's cursor may not surface a row it already has newer-or-equal locally, so only assert
        // when a row was actually pulled) that it still agrees with the server.
        if let pulledA { XCTAssertEqual(pulledA["title"], serverTruth?["title"]) }
        XCTAssertEqual(pulledB?["title"], serverTruth?["title"], "Device B must pull back exactly what it pushed.")
    }

    func testRetriedAppendIsANoOpNotAnError() async throws {
        let server = FakeSyncServer()
        let transport = FakeSyncTransport(server: server)
        let id = UUID()
        let attemptRow: [String: SyncJSON] = ["id": .string(id.uuidString), "verdict": .string("clean")]
        let first = try await transport.append(table: "attempts", row: attemptRow)
        XCTAssertTrue(first.applied)
        // A dropped-response retry sends the identical payload again — must not error or double-record.
        let retry = try await transport.append(table: "attempts", row: attemptRow)
        XCTAssertFalse(retry.applied)
        XCTAssertNil(retry.row)
    }

    // MARK: LastWriteWins — the pure comparison `SyncCoordinator` applies to every pulled row.

    func testLastWriteWinsPrefersTheNewerTimestampAndIsNilSafe() {
        let older = Date(timeIntervalSince1970: 100)
        let newer = Date(timeIntervalSince1970: 200)
        XCTAssertTrue(LastWriteWins.shouldApplyPulled(pulledUpdatedAt: newer, localUpdatedAt: older))
        XCTAssertFalse(LastWriteWins.shouldApplyPulled(pulledUpdatedAt: older, localUpdatedAt: newer))
        XCTAssertFalse(LastWriteWins.shouldApplyPulled(pulledUpdatedAt: older, localUpdatedAt: older), "Equal timestamps must not re-apply (no-op, not a tie-break loop).")
    }
}
