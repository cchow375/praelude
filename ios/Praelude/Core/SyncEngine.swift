import Foundation
import Observation

/// What the sync engine needs from a network layer (§2 of "(C) Sync Protocol.md"'s four RPCs), kept
/// Foundation-only so `SyncEngine` is unit-testable in `PraeludeCoreTests` with a fake transport —
/// no Supabase SDK dependency, matching spec §17a ("sync engine unit tests with a fake transport").
/// `PostgRESTSyncTransport` (`Services/`) is the real, SDK-backed conformance used at runtime.
public protocol SyncTransport: Sendable {
    /// Whole-row upsert for a `sync_tables` member. `row` must be every column the table has except
    /// `id`/`owner_id` (see `SyncDTO.swift`'s header comment for why those are omitted).
    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult
    /// Insert-only for an `append_only_tables` member. Safe to retry blindly after a dropped response.
    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult
    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult
    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult
    /// Every one of the caller's own rows in `table` with `updated_at > since` (`nil` pulls everything).
    func fetch(table: String, updatedSince: Date?) async throws -> [[String: SyncJSON]]
}

public struct SyncRPCResult: Equatable, Sendable {
    public var applied: Bool
    public var row: [String: SyncJSON]?
    public init(applied: Bool, row: [String: SyncJSON]?) { self.applied = applied; self.row = row }
}

/// A transport failure a queue entry can throw, distinct from "the network is fine but Postgres said
/// no" (which is a normal `SyncRPCResult`, not a `throw`). `SyncEngine` treats every thrown error the
/// same way (retry later, surface status) — this exists so a fake transport in tests can express
/// "offline" without inventing its own error type.
public enum SyncError: Error, Equatable, Sendable { case transport(String); case malformedQueueEntry(String) }

public enum SyncOpKind: String, Codable, Sendable { case upsert, append, updateLastPage, undoAttempt }

/// One persisted, not-yet-confirmed outbound write. `table`/`row` are used by `.upsert`/`.append`;
/// `pieceID`/`lastPage`/`attemptID`/`at` by the two dedicated RPCs. Flat and fully `Codable` so the
/// on-device queue file (`sync-queue.json`) survives a force-quit byte-for-byte, the same "persist
/// before anything reads it back as gone" discipline `PracticeStore` already uses for `library.json`.
public struct SyncQueueEntry: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var kind: SyncOpKind
    public var table: String
    public var row: [String: SyncJSON]
    public var pieceID: UUID?
    public var lastPage: Int?
    public var attemptID: UUID?
    public var at: Date
    public var enqueuedAt: Date

    public static func upsert(id: UUID = UUID(), table: String, row: [String: SyncJSON], enqueuedAt: Date = Date()) -> SyncQueueEntry {
        SyncQueueEntry(id: id, kind: .upsert, table: table, row: row, pieceID: nil, lastPage: nil, attemptID: nil, at: enqueuedAt, enqueuedAt: enqueuedAt)
    }
    public static func append(id: UUID = UUID(), table: String, row: [String: SyncJSON], enqueuedAt: Date = Date()) -> SyncQueueEntry {
        SyncQueueEntry(id: id, kind: .append, table: table, row: row, pieceID: nil, lastPage: nil, attemptID: nil, at: enqueuedAt, enqueuedAt: enqueuedAt)
    }
    public static func updateLastPage(pieceID: UUID, lastPage: Int, at: Date, enqueuedAt: Date = Date()) -> SyncQueueEntry {
        SyncQueueEntry(id: UUID(), kind: .updateLastPage, table: "", row: [:], pieceID: pieceID, lastPage: lastPage, attemptID: nil, at: at, enqueuedAt: enqueuedAt)
    }
    public static func undoAttempt(attemptID: UUID, undoneAt: Date, enqueuedAt: Date = Date()) -> SyncQueueEntry {
        SyncQueueEntry(id: UUID(), kind: .undoAttempt, table: "", row: [:], pieceID: nil, lastPage: nil, attemptID: attemptID, at: undoneAt, enqueuedAt: enqueuedAt)
    }
}

/// Small per-device sync bookkeeping that is not itself library data: per-table pull cursors and the
/// backend-only profile fields `Profile.swift` deliberately does not mirror (see `SyncDTO.swift`).
/// Persisted separately from the outbound queue (`sync-state.json` next to `sync-queue.json`) so a
/// bug in one file's read/write path can never corrupt the other.
public struct SyncEngineState: Codable, Equatable, Sendable {
    public var cursors: [String: Date] = [:]
    public var profileBackendFields = ProfileBackendFields()
    public init() {}
}

/// Owns the on-device outbound queue: appends survive a force-quit (persisted atomically before the
/// caller is told the enqueue succeeded), and are drained strictly in FIFO order so two edits to the
/// same record are never reordered in flight.
@MainActor
public final class SyncQueue {
    public private(set) var entries: [SyncQueueEntry] = []
    private let fileURL: URL
    private let writeData: (Data, URL) throws -> Void

    public init(directory: URL, writeData: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("sync-queue.json")
        self.writeData = writeData
        if FileManager.default.fileExists(atPath: fileURL.path) {
            let data = try Data(contentsOf: fileURL)
            entries = (try? JSONDecoder().decode([SyncQueueEntry].self, from: data)) ?? []
        }
    }
    public func enqueue(_ entry: SyncQueueEntry) throws { entries.append(entry); try persist() }
    public func removeFirst() throws { guard !entries.isEmpty else { return }; entries.removeFirst(); try persist() }
    public func removeAll() throws { entries.removeAll(); try persist() }
    private func persist() throws { try writeData(JSONEncoder().encode(entries), fileURL) }
}

/// Drives the outbound queue against a `SyncTransport` and applies pulled rows through a caller-
/// supplied callback (kept generic — this file never imports `PracticeStore` so it stays testable
/// with a fake transport and no on-disk library). One instance per signed-in account; guest mode
/// never constructs one (there is nothing to sync to yet — see `AuthManager`).
@MainActor @Observable
public final class SyncEngine {
    public enum Status: Equatable, Sendable {
        case idle
        case syncing
        /// A quiet, specific message for the UI (spec §4d: "quiet sync status indicator + stuck
        /// message") — surfaced once the same failure has persisted past `stuckThreshold`, not on
        /// the first transient error (a dropped request on a subway is not "stuck").
        case stuck(String)
        case offline
    }
    public private(set) var status: Status = .idle
    public private(set) var lastSyncedAt: Date?
    public private(set) var state: SyncEngineState
    private let transport: any SyncTransport
    private let queue: SyncQueue
    private let stateFileURL: URL
    private let writeData: (Data, URL) throws -> Void
    private let now: () -> Date
    private let stuckThreshold: TimeInterval
    private var firstFailureAt: Date?

    public var pendingCount: Int { queue.entries.count }

    public init(transport: any SyncTransport, directory: URL, now: @escaping () -> Date = Date.init,
                stuckThreshold: TimeInterval = 60,
                writeData: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }) throws {
        self.transport = transport
        self.now = now
        self.stuckThreshold = stuckThreshold
        self.writeData = writeData
        queue = try SyncQueue(directory: directory, writeData: writeData)
        stateFileURL = directory.appendingPathComponent("sync-state.json")
        if FileManager.default.fileExists(atPath: stateFileURL.path), let data = try? Data(contentsOf: stateFileURL),
           let decoded = try? JSONDecoder().decode(SyncEngineState.self, from: data) {
            state = decoded
        } else {
            state = SyncEngineState()
        }
    }

    // MARK: Enqueueing (persists immediately — safe to call right before the app is force-quit)

    public func enqueueUpsert(table: String, row: [String: SyncJSON]) throws { try queue.enqueue(.upsert(table: table, row: row, enqueuedAt: now())) }
    public func enqueueAppend(table: String, row: [String: SyncJSON]) throws { try queue.enqueue(.append(table: table, row: row, enqueuedAt: now())) }
    public func enqueueLastPage(pieceID: UUID, lastPage: Int) throws { try queue.enqueue(.updateLastPage(pieceID: pieceID, lastPage: lastPage, at: now())) }
    public func enqueueUndoAttempt(attemptID: UUID) throws { try queue.enqueue(.undoAttempt(attemptID: attemptID, undoneAt: now())) }

    /// Drops every queued write without sending it. Used only on sign-out: the queue is per-account
    /// local state, and a pending write from account A must never be replayed after signing into
    /// account B on the same device.
    public func discardPendingWrites() throws { try queue.removeAll(); firstFailureAt = nil; status = .idle }

    // MARK: Draining the outbound queue

    /// Sends every queued entry in order, stopping at the first failure (offline, or a real server
    /// error) rather than reordering later entries ahead of a stuck one. `applyPulledRow` is called
    /// once per `.upsert` entry the server rejected as stale (`applied: false`) — the protocol doc is
    /// explicit that the client must adopt the returned row rather than retry the same payload, so
    /// this is not optional plumbing, it is how a losing write resolves instead of looping forever.
    @discardableResult
    public func drain(applyPulledRow: (_ table: String, _ row: [String: SyncJSON]) -> Void = { _, _ in }) async -> Bool {
        guard status != .syncing else { return false }
        guard !queue.entries.isEmpty else { status = .idle; return true }
        status = .syncing
        while let entry = queue.entries.first {
            do {
                let result = try await perform(entry)
                if entry.kind == .upsert, !result.applied, let row = result.row { applyPulledRow(entry.table, row) }
                try queue.removeFirst()
                firstFailureAt = nil
            } catch {
                if firstFailureAt == nil { firstFailureAt = now() }
                let stuckFor = now().timeIntervalSince(firstFailureAt!)
                status = stuckFor >= stuckThreshold
                    ? .stuck("Some practice history hasn't synced yet. It's saved on this device and will go through when the connection is back.")
                    : .offline
                return false
            }
        }
        status = .idle
        lastSyncedAt = now()
        return true
    }

    private func perform(_ entry: SyncQueueEntry) async throws -> SyncRPCResult {
        switch entry.kind {
        case .upsert: return try await transport.upsert(table: entry.table, row: entry.row)
        case .append: return try await transport.append(table: entry.table, row: entry.row)
        case .updateLastPage:
            guard let pieceID = entry.pieceID, let lastPage = entry.lastPage else {
                throw SyncError.malformedQueueEntry("updateLastPage entry missing pieceID/lastPage")
            }
            return try await transport.updateLastPage(pieceID: pieceID, lastPage: lastPage, at: entry.at)
        case .undoAttempt:
            guard let attemptID = entry.attemptID else { throw SyncError.malformedQueueEntry("undoAttempt entry missing attemptID") }
            return try await transport.undoAttempt(attemptID: attemptID, undoneAt: entry.at)
        }
    }

    // MARK: Pulling

    /// Fetches every row changed in `table` since this device's last cursor for it, hands each to
    /// `applyRow` (LWW-merging into local storage is the caller's job — see `SyncCoordinator`), then
    /// advances the cursor to the latest `updated_at` actually seen, so a partial failure mid-table
    /// re-pulls from the old cursor next time rather than skipping rows.
    public func pull(table: String, applyRow: (_ row: [String: SyncJSON]) -> Void) async throws {
        let rows = try await transport.fetch(table: table, updatedSince: state.cursors[table])
        var latest = state.cursors[table]
        for row in rows {
            applyRow(row)
            if let updatedAt = row["updated_at"]?.stringValue.flatMap(SyncEngine.iso8601.date(from:)), latest == nil || updatedAt > latest! {
                latest = updatedAt
            }
        }
        if let latest { state.cursors[table] = latest; try persistState() }
    }
    private static let iso8601 = ISO8601DateFormatter()

    public func updateProfileBackendFields(_ fields: ProfileBackendFields) throws {
        state.profileBackendFields = fields
        try persistState()
    }
    private func persistState() throws { try writeData(JSONEncoder().encode(state), stateFileURL) }
}

/// Compares two records' `updatedAt` and returns the one that should win locally after a pull —
/// whole-record LWW (Schema3.md), the same granularity `sync_upsert` already enforces server-side.
/// A pulled row already survived that server-side comparison against whatever *this* device last
/// pushed, so the only remaining question on pull is whether *this* device has since made an even
/// newer local edit that has not reached the queue's front yet.
public enum LastWriteWins {
    public static func shouldApplyPulled(pulledUpdatedAt: Date, localUpdatedAt: Date) -> Bool {
        pulledUpdatedAt > localUpdatedAt
    }
}
