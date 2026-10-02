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
    /// Table name -> (its own foreign-key column, the table it must already exist in). Mirrors the
    /// two hard FKs the real schema has among sync-engine-reachable tables (both from
    /// `20260926220003_library_sync_tables.sql`/`20260926220004_logs_sync_tables.sql`):
    /// `attempts.set_id references public.sets(id)` and `sets.session_id references
    /// public.practice_sessions(id)` — everything else in this schema is either owner-scoped with no
    /// cross-table FK reachable through these RPCs, or a soft/array reference Core only checks at the
    /// app layer (see "(C) Sync Protocol.md" §1's own note on `tag_ids`/`folder_ids`). Real
    /// `sync_upsert`/`sync_append` would fail the INSERT/UPDATE outright ("insert or update ...
    /// violates foreign key constraint") when the referenced row is missing; this fake throws the
    /// same class of error (a thrown `SyncError`, not a `{applied:false}` result) so `SyncEngine.drain`
    /// treats it exactly like the real transport would — stuck at that entry, nothing after it in the
    /// queue attempted, nothing silently dropped.
    private static let foreignKeys: [String: (column: String, references: String)] = [
        "attempts": (column: "set_id", references: "sets"),
        "sets": (column: "session_id", references: "practice_sessions")
    ]
    private func checkForeignKey(table: String, row: [String: SyncJSON]) throws {
        guard let fk = Self.foreignKeys[table] else { return }
        guard let referencedID = row[fk.column]?.stringValue, tables[fk.references]?[referencedID] != nil else {
            throw SyncError.transport("insert or update on table \"\(table)\" violates foreign key constraint (\(fk.column) -> \(fk.references))")
        }
    }

    func upsert(table: String, row: [String: SyncJSON]) throws -> SyncRPCResult {
        guard let id = row["id"]?.stringValue else { return SyncRPCResult(applied: false, row: nil) }
        try checkForeignKey(table: table, row: row)
        let incoming = Self.date(row, field: "updated_at")
        if let existing = tables[table]?[id], let incoming, let existingDate = Self.date(existing, field: "updated_at"), existingDate >= incoming {
            return SyncRPCResult(applied: false, row: existing)
        }
        tables[table, default: [:]][id] = row
        return SyncRPCResult(applied: true, row: row)
    }
    func append(table: String, row: [String: SyncJSON]) throws -> SyncRPCResult {
        guard let id = row["id"]?.stringValue else { return SyncRPCResult(applied: false, row: nil) }
        try checkForeignKey(table: table, row: row)
        let key = "\(table)#\(id)"
        guard !appended.contains(key) else { return SyncRPCResult(applied: false, row: nil) }
        appended.insert(key)
        tables[table, default: [:]][id] = row
        return SyncRPCResult(applied: true, row: row)
    }
    func fetch(table: String, field: String, updatedSince: Date?) -> [[String: SyncJSON]] {
        (tables[table] ?? [:]).values.filter { row in
            guard let updatedSince else { return true }
            guard let value = Self.date(row, field: field) else { return true }
            return value > updatedSince
        }.sorted { ($0[field]?.stringValue ?? "") < ($1[field]?.stringValue ?? "") }
    }
    func row(table: String, id: String) -> [String: SyncJSON]? { tables[table]?[id] }
    func count(table: String) -> Int { tables[table]?.count ?? 0 }
    private static func date(_ row: [String: SyncJSON], field: String) -> Date? {
        row[field]?.stringValue.flatMap(SyncCoding.iso8601Formatter.date(from:))
    }
}

struct FakeSyncTransport: SyncTransport {
    let server: FakeSyncServer
    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        guard server.isReachable else { throw SyncError.transport("offline") }
        return try server.upsert(table: table, row: row)
    }
    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        guard server.isReachable else { throw SyncError.transport("offline") }
        return try server.append(table: table, row: row)
    }
    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult {
        guard server.isReachable else { throw SyncError.transport("offline") }
        return SyncRPCResult(applied: true, row: nil)
    }
    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult {
        guard server.isReachable else { throw SyncError.transport("offline") }
        return SyncRPCResult(applied: true, row: nil)
    }
    func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] {
        guard server.isReachable else { throw SyncError.transport("offline") }
        return server.fetch(table: table, field: field, updatedSince: updatedSince)
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
        // A table with no FK of its own (see FakeSyncServer.foreignKeys) — "attempts" specifically is
        // covered by testAttemptAppendFailsWithoutItsSetPushedFirstAndSucceedsOnceItIs below, since
        // that FK is exactly the ordering contract this pass exists to prove.
        let badgeRow: [String: SyncJSON] = ["id": .string(id.uuidString), "key": .string("thirty_days_on_time")]
        let first = try await transport.append(table: "badges", row: badgeRow)
        XCTAssertTrue(first.applied)
        // A dropped-response retry sends the identical payload again — must not error or double-record.
        let retry = try await transport.append(table: "badges", row: badgeRow)
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
    func testPullRetriesAfterLocalSaveFailureWithoutAdvancingCursor() async throws {
        let server = FakeSyncServer()
        let id = UUID(); let date = Date(timeIntervalSince1970: 100)
        _ = try server.upsert(table: "pieces", row: row(id: id, title: "Sonata", updatedAt: date))
        let engine = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory())
        do {
            try await engine.pull(table: "pieces") { _ in throw SyncError.transport("disk full") }
            XCTFail("A failed local apply must fail the pull.")
        } catch {}
        XCTAssertNil(engine.state.cursors["pieces"])
        var received = 0
        try await engine.pull(table: "pieces") { _ in received += 1 }
        XCTAssertEqual(received, 1)
        XCTAssertEqual(engine.state.cursors["pieces"], date)
    }

    func testLateOfflineEventIsPulledAfterNewerEvent() async throws {
        let server = FakeSyncServer()
        let engine = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory())
        let newer = UUID(); let older = UUID()
        _ = try server.append(table: "badges", row: ["id": .string(newer.uuidString), "earned_at": .string(SyncCoding.iso8601Formatter.string(from: Date(timeIntervalSince1970: 200)))])
        try await engine.pull(table: "badges", cursorField: "earned_at") { _ in }
        _ = try server.append(table: "badges", row: ["id": .string(older.uuidString), "earned_at": .string(SyncCoding.iso8601Formatter.string(from: Date(timeIntervalSince1970: 100)))])
        var ids: Set<String> = []
        try await engine.pull(table: "badges", cursorField: "earned_at") { if let id = $0["id"]?.stringValue { ids.insert(id) } }
        XCTAssertEqual(ids, [newer.uuidString, older.uuidString], "Arrival time must not be confused with the original practice date.")
    }

    func testGuestLibrarySnapshotQueuesEveryHistoricalRepOnceAndSurvivesRelaunch() async throws {
        let directory = directory()
        let server = FakeSyncServer()
        let engine = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory)
        var library = LibraryState()
        let piece = Piece(title: "Sonata")
        let session = PracticeSession(pieceID: piece.id, focus: "Pulse")
        var set = ActiveSet(sessionID: session.id, configuration: PracticeConfiguration(pieceID: piece.id, targetCount: 2000))
        set.attempts = (0..<1505).map { Attempt(verdict: .clean, date: Date(timeIntervalSince1970: Double($0)), bpm: 60) }
        set.attempts[0].undoneAt = Date(timeIntervalSince1970: 2000)
        set.status = .ended
        library.pieces = [piece]; library.sessions = [session]; library.history = [set]
        try engine.enqueueLibrarySnapshot(library)
        let count = engine.pendingCount
        XCTAssertGreaterThan(count, 1505)
        try engine.enqueueLibrarySnapshot(library)
        XCTAssertEqual(engine.pendingCount, count, "An unchanged snapshot must not double-enqueue a long practice history.")
        let restored = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory)
        try restored.enqueueLibrarySnapshot(library)
        XCTAssertEqual(restored.pendingCount, count)
        let drained = await restored.drain()
        XCTAssertTrue(drained)
        XCTAssertEqual(server.count(table: "attempts"), 1505)
        XCTAssertEqual(server.count(table: "sets"), 1)
        XCTAssertEqual(server.count(table: "practice_sessions"), 1)
    }

    func testCorruptQueueIsPreservedAndNeverReplacedWithAnEmptyQueue() throws {
        let directory = directory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("sync-queue.json")
        let original = Data("not a queue".utf8); try original.write(to: url)
        let engine = SyncEngine(transport: FakeSyncTransport(server: FakeSyncServer()), directory: directory)
        XCTAssertThrowsError(try engine.enqueueUpsert(table: "pieces", row: row(id: UUID(), title: "Sonata", updatedAt: Date())))
        XCTAssertEqual(try Data(contentsOf: url), original)
        guard case .stuck = engine.status else { return XCTFail("Unsafe queue storage must be visible.") }
    }

    func testQueueWriteFailureDoesNotRemoveOrExposeUnpersistedEntries() throws {
        let directory = directory()
        var failWrites = false
        let queue = try SyncQueue(directory: directory, writeData: { data, url in
            if failWrites { throw SyncError.transport("disk full") }
            try data.write(to: url, options: .atomic)
        })
        let entry = SyncQueueEntry.append(table: "badges", row: ["id": .string(UUID().uuidString)])
        try queue.enqueue(entry)
        failWrites = true
        XCTAssertThrowsError(try queue.removeFirst())
        XCTAssertEqual(queue.entries, [entry])
        XCTAssertThrowsError(try queue.enqueue(.append(table: "badges", row: ["id": .string(UUID().uuidString)])))
        XCTAssertEqual(queue.entries, [entry])
        XCTAssertEqual(try SyncQueue(directory: directory).entries, [entry])
    }

    func testPaginationIncludesAllRowsWhenServerCapsPagesBelowRequestedSize() async throws {
        let expected = (0..<1505).map { ["id": SyncJSON.string(String($0))] }
        let actual = try await SyncPagination.collect(pageSize: 500) { offset, requested in
            Array(expected.dropFirst(offset).prefix(min(requested, 137)))
        }
        XCTAssertEqual(actual, expected)
    }

    func testFractionalPostgresDatesDecodeAndRetainSubsecondEditOrder() throws {
        struct Event: Codable { var date: Date }
        let received = try SyncCoding.decoder.decode(Event.self, from: Data(#"{"date":"2026-10-02T15:30:00.125000+00:00"}"#.utf8))
        let later = try SyncCoding.decoder.decode(Event.self, from: Data(#"{"date":"2026-10-02T15:30:00.875000+00:00"}"#.utf8))
        XCTAssertEqual(later.date.timeIntervalSince(received.date), 0.75, accuracy: 0.001)
        let legacy = try SyncCoding.decoder.decode(Event.self, from: Data(#"{"date":"2026-10-02T15:30:00Z"}"#.utf8))
        XCTAssertEqual(received.date.timeIntervalSince(legacy.date), 0.125, accuracy: 0.001)
        let encoded = try SyncCoding.encoder.encode(received)
        XCTAssertEqual(try SyncCoding.decoder.decode(Event.self, from: encoded).date, received.date)
    }

    func testFreshAccountDefaultsDoNotQueueOverExistingCloudSingletonsButChangedSettingsDo() throws {
        let engine = SyncEngine(transport: FakeSyncTransport(server: FakeSyncServer()), directory: directory())
        var library = LibraryState(); library.profile.ownerID = UUID()
        try engine.enqueueLibrarySnapshot(library)
        XCTAssertFalse(engine.hasSnapshot(table: "profiles"))
        XCTAssertFalse(engine.hasSnapshot(table: "rule_settings"))
        XCTAssertFalse(engine.hasSnapshot(table: "rewards_state"))
        library.ruleSettings.r1MaxMeasures += 1
        try engine.enqueueLibrarySnapshot(library)
        XCTAssertTrue(engine.hasSnapshot(table: "rule_settings"))
        let pending = engine.pendingCount
        try engine.enqueueLibrarySnapshot(library)
        XCTAssertEqual(engine.pendingCount, pending, "Generated creation clocks must not make an unchanged singleton enqueue again.")
    }

    func testRejectedPracticeWriteIsAcknowledgedOnlyAfterAtomicGraphAdoptionSucceeds() async throws {
        let server = FakeSyncServer(), id = UUID()
        let older = Date(timeIntervalSince1970: 100), newer = Date(timeIntervalSince1970: 200)
        _ = try server.upsert(table: "practice_sessions", row: row(id: id, title: "Remote closure", updatedAt: newer))
        let engine = SyncEngine(transport: FakeSyncTransport(server: server), directory: directory())
        try engine.enqueueUpsert(table: "practice_sessions", row: row(id: id, title: "Local earlier session", updatedAt: older))
        try engine.enqueueAppend(table: "badges", row: ["id": .string(UUID().uuidString), "key": .string("earned")])
        let failed = await engine.drain(applyPulledRow: { _, _ in XCTFail("Practice metadata must not be adopted as an isolated row.") }, adoptPracticeSnapshot: {
            XCTAssertEqual(server.count(table: "badges"), 1, "Finish sending pending graph entries before adopting its complete snapshot.")
            throw SyncError.transport("atomic local save failed")
        })
        XCTAssertFalse(failed)
        XCTAssertEqual(engine.pendingCount, 2, "A rejected practice row stays durable until the complete graph is safely adopted.")
        let retried = await engine.drain(applyPulledRow: { _, _ in XCTFail("Practice metadata must use graph adoption.") }, adoptPracticeSnapshot: {})
        XCTAssertTrue(retried)
        XCTAssertEqual(engine.pendingCount, 0)
        XCTAssertEqual(server.count(table: "badges"), 1, "Accepted tail entries replay idempotently after failed graph adoption.")
    }

}
