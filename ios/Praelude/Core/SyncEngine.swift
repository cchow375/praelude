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
    /// Every one of the caller's own rows in `table` with `field > since` (`nil` pulls everything).
    /// `field` is `"updated_at"` for an ordinary `sync_tables` member; `SyncEngine.pull`'s
    /// `cursorField` passes an append-only table's own event-date column instead (that family has no
    /// `updated_at` column to filter on at all).
    func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]]
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
public enum SyncError: Error, Equatable, Sendable { case transport(String); case malformedQueueEntry(String); case invalidRemoteRow(String) }

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
    public var accountOwnerID: UUID?
    /// The account profile must be read before a fresh or upgraded queue publishes defaults.
    public var profileHydratedOwnerID: UUID?
    public var profileKnownOwnerID: UUID?
    public var pendingProfileCoreFields: [String: SyncJSON]?
    public var pendingProfileBackendFields: [String: SyncJSON]?
    public var pendingProfileIntentSources: [String: String]?
    /// Payloads already durably enqueued or received. Optional for older state-file compatibility.
    public var outboundSnapshots: [String: [String: SyncJSON]]?
    public init() { outboundSnapshots = [:] }

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
            entries = try JSONDecoder().decode([SyncQueueEntry].self, from: data)
        }
    }
    init(inMemory: Void) { fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("unused-sync-queue"); writeData = { _, _ in } }
    public func enqueue(_ entry: SyncQueueEntry) throws { try enqueue(contentsOf: [entry]) }
    public func enqueue(contentsOf values: [SyncQueueEntry]) throws { try replace(entries + values) }
    public func removeFirst(_ count: Int = 1) throws { guard !entries.isEmpty else { return }; try replace(Array(entries.dropFirst(count))) }
    public func removeAll() throws { try replace([]) }
    func removeUpserts(table: String) throws { try replace(entries.filter { $0.kind != .upsert || $0.table != table }) }
    private func replace(_ next: [SyncQueueEntry]) throws {
        try writeData(JSONEncoder().encode(next), fileURL)
        entries = next
    }
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
    private var storageIsUnavailable = false
    private var accountGeneration = 0

    public var pendingCount: Int { queue.entries.count }

    /// Never throws: a directory-creation failure under the app's own Application Support directory
    /// (already proven writable by the time this runs — `PracticeStore` creates a sibling directory
    /// first) is vanishingly unlikely, and this app must still launch and work fully offline even in
    /// that case, the same resilience `PracticeStore.init` already applies to its own storage. Falls
    /// back to a temporary-directory-backed queue (still persists within this launch, just not across
    /// reinstalls of a corrupted container) rather than fail to construct at all.
    public init(transport: any SyncTransport, directory: URL, now: @escaping () -> Date = Date.init,
                stuckThreshold: TimeInterval = 60,
                writeData: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }) {
        self.transport = transport
        self.now = now
        self.stuckThreshold = stuckThreshold
        self.writeData = writeData
        var queueFailure: Error?
        do { queue = try SyncQueue(directory: directory, writeData: writeData) }
        catch {
            // Preserve unreadable/persistently unwritable primary queue; never replace it with []
            // or replay another account's temporary fallback on a later launch.
            queueFailure = error
            queue = SyncQueue(inMemory: ())
        }
        stateFileURL = directory.appendingPathComponent("sync-state.json")
        if FileManager.default.fileExists(atPath: stateFileURL.path), let data = try? Data(contentsOf: stateFileURL),
           let decoded = try? JSONDecoder().decode(SyncEngineState.self, from: data) {
            state = decoded
        } else {
            state = SyncEngineState()
        }
        if queueFailure != nil {
            storageIsUnavailable = true
            status = .stuck("Sync storage could not be opened safely. Your local library and original sync queue are preserved.")
        }
    }

    // MARK: Enqueueing (persists immediately — safe to call right before the app is force-quit)

    public func enqueueUpsert(table: String, row: [String: SyncJSON]) throws { try enqueueSnapshot([.upsert(table: table, row: row, enqueuedAt: now())]) }
    public func enqueueAppend(table: String, row: [String: SyncJSON]) throws { try enqueueSnapshot([.append(table: table, row: row, enqueuedAt: now())]) }
    public func enqueueLastPage(pieceID: UUID, lastPage: Int, at: Date? = nil) throws {
        try enqueueSnapshot([.updateLastPage(pieceID: pieceID, lastPage: lastPage, at: at ?? now())])
    }
    public func enqueueUndoAttempt(attemptID: UUID, undoneAt: Date? = nil) throws {
        try enqueueSnapshot([.undoAttempt(attemptID: attemptID, undoneAt: undoneAt ?? now())])
    }

    /// Batch persistence avoids rewriting a thousands-rep queue once per historical rep.
    /// A signature is remembered only after its queue entries are durably written.
    public func enqueueSnapshot(_ entries: [SyncQueueEntry]) throws {
        guard !storageIsUnavailable else { throw SyncError.transport("Sync storage is unavailable.") }
        var snapshots = state.outboundSnapshots ?? [:]
        var pending: [SyncQueueEntry] = []
        for candidate in entries {
            var entry = candidate
            if entry.kind == .upsert { entry.row = Self.explicitNullableColumns(table: entry.table, row: entry.row) }
            let key = Self.snapshotKey(entry)
            let payload = Self.snapshotPayload(entry)
            guard snapshots[key] != payload else { continue }
            snapshots[key] = payload
            pending.append(entry)
        }
        guard !pending.isEmpty else { return }
        try queue.enqueue(contentsOf: pending)
        let old = state.outboundSnapshots
        state.outboundSnapshots = snapshots
        do { try persistState() }
        catch { state.outboundSnapshots = old; throw error }
    }
    public func acknowledgePulledRow(table: String, row: [String: SyncJSON]) throws {
        let entry = SyncQueueEntry.upsert(table: table, row: Self.explicitNullableColumns(table: table, row: row))
        // Event signatures use the append namespace, including for receiving remote attempts.
        let kind: SyncOpKind = Self.appendTables.contains(table) ? .append : .upsert
        var received = entry; received.kind = kind
        state.outboundSnapshots = state.outboundSnapshots ?? [:]
        state.outboundSnapshots?[Self.snapshotKey(received)] = Self.snapshotPayload(received)
        // The enclosing pull/drain persists once after successful local application. Replaying
        // acknowledged, idempotent rows after an interrupted pass is safe.
    }
    public func hasSnapshot(table: String) -> Bool {
        (state.outboundSnapshots ?? [:]).keys.contains { $0.hasPrefix("upsert#\(table)#") }
    }
    private func differsFromDefault<T: Encodable>(_ value: T, _ defaultValue: T, ignoring extraKeys: Set<String> = []) throws -> Bool {
        func content(_ object: T) throws -> [String: SyncJSON] {
            let row = try SyncJSON(encoding: object).objectValue ?? [:]
            return row.filter { !extraKeys.union(["created_at", "updated_at"]).contains($0.key) }
        }
        return try content(value) != content(defaultValue)
    }
    public func bindAccount(_ userID: UUID) throws {
        if let owner = state.accountOwnerID, owner != userID { throw SyncError.transport("This sync queue belongs to a different account.") }
        state.accountOwnerID = userID
        try persistState()
    }
    public var hasHydratedProfile: Bool {
        state.accountOwnerID != nil && state.profileHydratedOwnerID == state.accountOwnerID
    }
    /// Hydrate account identity/privacy before any pending profile write can reach the server.
    /// Save the resolved local profile first; a failed read/save retains all queued guest practice.
    public func initializeProfileIfNeeded(currentProfile: () -> Profile, applyProfile: (Profile) throws -> Void) async throws {
        guard !storageIsUnavailable else { throw SyncError.transport("Sync storage is unavailable.") }
        guard !hasHydratedProfile else { return }
        guard let ownerID = state.accountOwnerID else { throw SyncError.transport("Bind an account before reading its profile.") }
        let generation = accountGeneration
        let rows = try await transport.fetch(table: "profiles", field: "updated_at", updatedSince: nil)
        guard generation == accountGeneration, state.accountOwnerID == ownerID else { throw SyncError.transport("Account changed during profile sync.") }
        let local = currentProfile()
        guard local.ownerID == ownerID else { throw SyncError.transport("The local profile belongs to another account.") }
        let remote = try rows.first.map { row -> ProfileSyncRow in
            if let id = row["id"]?.stringValue, UUID(uuidString: id) != ownerID { throw SyncError.invalidRemoteRow("profiles") }
            return try SyncJSON.object(row).decoded(as: ProfileSyncRow.self)
        }
        var extras = remote?.backendFields ?? ProfileBackendFields()
        if let pending = state.pendingProfileBackendFields, !pending.isEmpty {
            var object = try Self.backendObject(extras)
            object.merge(pending) { _, edited in edited }
            extras = try SyncJSON.object(object).decoded(as: ProfileBackendFields.self)
        }
        let defaults = try ProfileSyncRow.coreObject(Profile())
        var explicit: [String: SyncJSON] = [:]
        for entry in queue.entries where entry.kind == .upsert && entry.table == "profiles" {
            guard let at = entry.row["updated_at"]?.stringValue.flatMap(SyncCoding.parseDate), at > (remote?.updated_at ?? .distantPast) else { continue }
            for key in ProfileSyncRow.coreEditableKeys where entry.row[key] != defaults[key] && entry.row[key] != nil { explicit[key] = entry.row[key] }
        }
        explicit.merge(state.pendingProfileCoreFields ?? [:]) { _, latest in latest }
        var resolved: Profile
        if let remote, (state.cursors["profiles"] != nil || state.profileKnownOwnerID == ownerID), local.updatedAt > remote.updated_at {
            // An older build already read this account: retain its ordinary offline LWW edits,
            // including intentional clears, rather than applying first-login default rules.
            resolved = try ProfileSyncRow(local, extras: extras).applyingCoreFields(explicit, ownerID: ownerID)
            if resolved != local { resolved.updatedAt = max(now(), local.updatedAt) }
            extras = state.profileBackendFields
        } else {
            resolved = try remote?.initialCoreProfile(local: local, explicitFields: explicit, at: now()) ?? local
        }
        if resolved.username.isEmpty {
            // Matches the signup trigger if its freshly provisioned row is not yet visible.
            resolved.username = "user_" + String(ownerID.uuidString.lowercased().replacingOccurrences(of: "-", with: "").prefix(12))
        }
        if state.pendingProfileBackendFields?.isEmpty == false {
            resolved.updatedAt = max(now(), (remote?.updated_at ?? local.updatedAt).addingTimeInterval(0.001))
        }
        try applyProfile(resolved)
        let previous = state
        // Keep explicit intent durably recoverable before retiring an older unsafe profile row.
        // A failure after queue replacement must retry hydration, never lose the staged edit.
        state.profileBackendFields = extras
        state.profileKnownOwnerID = ownerID
        state.pendingProfileCoreFields = explicit
        state.profileHydratedOwnerID = nil
        do { try persistState() } catch { state = previous; throw error }
        try queue.removeUpserts(table: "profiles")
        let staged = state
        state.pendingProfileCoreFields = nil
        state.pendingProfileBackendFields = nil
        // Keep the bounded field-to-editor ownership map after a receipt. An editor whose local
        // save failed can still retry/revert while this hydration has adopted its attempted edit.
        state.profileHydratedOwnerID = ownerID
        state.outboundSnapshots = state.outboundSnapshots?.filter { !$0.key.hasPrefix("upsert#profiles#") }
        if let remote, let canonical = try SyncJSON(encoding: remote).objectValue { try acknowledgePulledRow(table: "profiles", row: canonical) }
        do { try persistState() } catch { state = staged; throw error }
    }
    public func stageProfileEdit(_ profile: Profile) throws {
        guard !hasHydratedProfile else { return }
        let row = try ProfileSyncRow.coreObject(profile)
        let defaults = try ProfileSyncRow.coreObject(Profile())
        var pending: [String: SyncJSON] = [:]
        for key in ProfileSyncRow.coreEditableKeys {
            if row[key] != defaults[key], let value = row[key] { pending[key] = value }
            else if state.pendingProfileCoreFields?[key] != nil || queue.entries.contains(where: {
                $0.kind == .upsert && $0.table == "profiles" && $0.row[key] != nil && $0.row[key] != defaults[key]
            }) {
                // A staged edit reverted/cleared during hydration is still an explicit choice.
                pending[key] = row[key] ?? .null
            }
        }
        let previous = state.pendingProfileCoreFields
        state.pendingProfileCoreFields = pending
        do { try persistState() } catch { state.pendingProfileCoreFields = previous; throw error }
    }
    private static func backendObject(_ fields: ProfileBackendFields) throws -> [String: SyncJSON] {
        var object = try SyncJSON(encoding: fields).objectValue ?? [:]
        if object["ageBracket"] == nil { object["ageBracket"] = .null }
        return object
    }
    public func stageProfileBackendFields(_ fields: ProfileBackendFields) throws {
        let previous = state
        if !hasHydratedProfile {
            let old = try Self.backendObject(state.profileBackendFields)
            let new = try Self.backendObject(fields)
            var pending = state.pendingProfileBackendFields ?? [:]
            for (key, value) in new where old[key] != value { pending[key] = value }
            state.pendingProfileBackendFields = pending
        }
        state.profileBackendFields = fields
        do { try persistState() } catch { state = previous; throw error }
    }
    /// The editor's core and backend changes share one durable intent write before its local
    /// commit. A staging failure throws before changing the library; a later local-save failure
    /// leaves recoverable intent and keeps the editor open for retry.
    public func saveProfileEdit(_ draft: Profile, extras: ProfileBackendFields,
                                baselineProfile: Profile, baselineExtras: ProfileBackendFields,
                                currentProfile: Profile, sourceID: UUID? = nil,
                                persistProfile: (Profile) throws -> Void) throws {
        guard let ownerID = state.accountOwnerID, currentProfile.ownerID == ownerID, draft.ownerID == ownerID else {
            throw SyncError.transport("Sign into this library's account before saving its profile.")
        }
        let row = try ProfileSyncRow.coreObject(draft), baseline = try ProfileSyncRow.coreObject(baselineProfile)
        var coreChanges: [String: SyncJSON] = [:]
        for key in ProfileSyncRow.coreEditableKeys where row[key] != baseline[key] { coreChanges[key] = row[key] }
        let fields = try Self.backendObject(extras), oldFields = try Self.backendObject(baselineExtras)
        var backendChanges = fields.filter { oldFields[$0.key] != $0.value }
        let source = sourceID?.uuidString ?? "direct"
        // Retrying this editor after a local-save failure must replace its previous choices,
        // including a reversion to baseline. Other editors/age setup retain their own intent.
        for key in ProfileSyncRow.coreEditableKeys where state.pendingProfileIntentSources?["core/" + key] == source {
            coreChanges[key] = row[key] ?? .null
        }
        for (key, value) in fields where state.pendingProfileIntentSources?["backend/" + key] == source { backendChanges[key] = value }
        var mergedBackend = try Self.backendObject(state.profileBackendFields)
        mergedBackend.merge(backendChanges) { _, edit in edit }
        let previous = state
        if hasHydratedProfile { state.profileKnownOwnerID = ownerID }
        state.pendingProfileCoreFields = (state.pendingProfileCoreFields ?? [:]).merging(coreChanges) { _, edit in edit }
        state.pendingProfileBackendFields = (state.pendingProfileBackendFields ?? [:]).merging(backendChanges) { _, edit in edit }
        var sources = state.pendingProfileIntentSources ?? [:]
        coreChanges.keys.forEach { sources["core/" + $0] = source }
        backendChanges.keys.forEach { sources["backend/" + $0] = source }
        state.pendingProfileIntentSources = sources
        state.profileBackendFields = try SyncJSON.object(mergedBackend).decoded(as: ProfileBackendFields.self)
        state.profileHydratedOwnerID = nil
        do { try persistState() } catch { state = previous; throw error }
        var committed = try ProfileSyncRow(currentProfile, extras: state.profileBackendFields).applyingCoreFields(coreChanges, ownerID: ownerID)
        committed.updatedAt = now()
        try persistProfile(committed)
    }
    public func reportFailure(_ error: Error) {
        if firstFailureAt == nil { firstFailureAt = now() }
        status = now().timeIntervalSince(firstFailureAt!) >= stuckThreshold
            ? .stuck("Some practice data hasn't synced yet. It remains saved on this device. \(error.localizedDescription)")
            : .offline
    }
    public func blockAccountMismatch() {
        status = .stuck("This device's library belongs to another account. Sign back into that account to sync it safely.")
    }
    private static let appendTables: Set<String> = ["attempts", "rule_events", "reward_ledger", "badges", "milestone_events", "cold_grades", "break_point_taps"]
    /// Codable omits nil properties, but sync_upsert preserves absent columns for older clients.
    /// For every nullable column this client owns, nil therefore needs an explicit JSON null to
    /// clear a previously saved value. Newly optional piece fields keep their DTO presence flag:
    /// absent organization/default-tempo keys mean an older payload and must stay absent.
    private static let nullableColumns: [String: [String]] = [
        "instruments": ["transposition_semitones", "transposition_label", "deleted_at"],
        "pieces": ["pdf_file_name", "instrument_id", "difficulty", "custom_cover_ref", "deleted_at"],
        "passages": ["start_measure", "end_measure", "color", "parent_passage_id", "schedule_due_date", "parked_until", "performance_tempo", "deleted_at"],
        "ink_strokes": ["fingerprint", "deleted_at"],
        "rewards_state": ["last_practice_date"],
        "profiles": ["photo_path", "age_bracket"],
        "tags": ["deleted_at"],
        "folders": ["parent_folder_id", "deleted_at"],
        "setlists": ["deleted_at"],
        "bookmarks": ["deleted_at"],
        "page_edits": ["source_page", "crop_rect", "deleted_at"],
        "score_links": ["source_region", "target_region", "deleted_at"],
        "annotations": ["text", "stamp_kind", "stamp_label", "deleted_at"],
        "warmup_exercises": ["mode", "instrument_family", "custom_from_passage_id", "last_used_at", "deleted_at"],
        "audio_recordings": ["passage_id", "set_id", "deleted_at"],
        "notebook_entries": ["piece_id", "deleted_at"],
        "practice_goals": ["piece_id", "due_date", "deleted_at"],
        "practice_routines": ["deleted_at"],
        "practice_sessions": ["ended_at", "deleted_at"],
        "sets": ["passage_id", "passage_snapshot", "ended_at", "last_checkpoint", "deleted_at"]
    ]
    private static func explicitNullableColumns(table: String, row: [String: SyncJSON]) -> [String: SyncJSON] {
        var value = row
        for column in nullableColumns[table] ?? [] where value[column] == nil { value[column] = .null }
        return value
    }
    private static func snapshotKey(_ entry: SyncQueueEntry) -> String {
        switch entry.kind {
        case .upsert, .append: return "\(entry.kind.rawValue)#\(entry.table)#\(entry.row["id"]?.stringValue ?? entry.row["owner_id"]?.stringValue ?? "singleton")"
        case .updateLastPage: return "page#\(entry.pieceID?.uuidString ?? entry.id.uuidString)"
        case .undoAttempt: return "undo#\(entry.attemptID?.uuidString ?? entry.id.uuidString)"
        }
    }
    private static func snapshotPayload(_ entry: SyncQueueEntry) -> [String: SyncJSON] {
        switch entry.kind {
        case .upsert, .append:
            var row = entry.row
            row.removeValue(forKey: "owner_id")
            row.removeValue(forKey: "created_at")
            if entry.table == "attempts" { row.removeValue(forKey: "undone_at") }
            if entry.table == "sets" || entry.table == "practice_sessions" {
                row.removeValue(forKey: "updated_at")
            }
            return row
        case .updateLastPage: return ["last_page": .number(Double(entry.lastPage ?? 1)), "at": .string(SyncCoding.iso8601Formatter.string(from: entry.at))]
        case .undoAttempt: return ["undone_at": .string(SyncCoding.iso8601Formatter.string(from: entry.at))]
        }
    }

    /// Reconciles offline/guest/imported data as well as edits from views that do not push explicitly.
    /// Dependencies precede child rows and every rep; signatures prevent unchanged history writes.
    public func enqueueLibrarySnapshot(_ library: LibraryState) throws {
        var entries: [SyncQueueEntry] = []
        func upsert<T: Encodable>(_ table: String, _ value: T) throws {
            guard let row = try SyncJSON(encoding: value).objectValue else { throw SyncError.invalidRemoteRow(table) }
            entries.append(.upsert(table: table, row: row, enqueuedAt: now()))
        }
        func append<T: Encodable>(_ table: String, _ value: T) throws {
            guard let row = try SyncJSON(encoding: value).objectValue else { throw SyncError.invalidRemoteRow(table) }
            entries.append(.append(table: table, row: row, enqueuedAt: now()))
        }
        for value in library.instruments { try upsert("instruments", InstrumentSyncRow(value)) }
        for value in library.pieces { try upsert("pieces", PieceSyncRow(value)) }
        var remainingPassages = library.passages
        let allPassageIDs = Set(library.passages.map(\.id))
        var queuedPassageIDs: Set<UUID> = []
        while !remainingPassages.isEmpty {
            let ready = remainingPassages.filter { passage in
                passage.parentPassageID == nil || queuedPassageIDs.contains(passage.parentPassageID!)
            }
            guard !ready.isEmpty else { throw SyncError.invalidRemoteRow("Missing or cyclic parent passage.") }
            for value in ready {
                if let parent = value.parentPassageID, !allPassageIDs.contains(parent) { throw SyncError.invalidRemoteRow("Missing parent passage.") }
                try upsert("passages", PassageSyncRow(value)); queuedPassageIDs.insert(value.id)
            }
            remainingPassages.removeAll { queuedPassageIDs.contains($0.id) }
        }
        for value in library.inkStrokes { if let dto = InkStrokeSyncRow(value) { try upsert("ink_strokes", dto) } }
        for value in library.tags { try upsert("tags", TagSyncRow(value)) }
        for value in library.folders { try upsert("folders", FolderSyncRow(value)) }
        for value in library.setlists { try upsert("setlists", SetlistSyncRow(value)) }
        for value in library.bookmarks { try upsert("bookmarks", BookmarkSyncRow(value)) }
        for value in library.pageEdits { try upsert("page_edits", PageEditSyncRow(value)) }
        for value in library.scoreLinks { try upsert("score_links", ScoreLinkSyncRow(value)) }
        for value in library.textAnnotations { try upsert("annotations", AnnotationSyncRow(value)) }
        for value in library.stampAnnotations { try upsert("annotations", AnnotationSyncRow(value)) }
        for value in library.warmupExercises { try upsert("warmup_exercises", WarmupExerciseSyncRow(value)) }
        for value in library.recordings { try upsert("audio_recordings", AudioRecordingSyncRow(value)) }
        for value in library.notebookEntries { try upsert("notebook_entries", NotebookEntrySyncRow(value)) }
        for value in library.goals { try upsert("practice_goals", PracticeGoalSyncRow(value)) }
        for value in library.routines { try upsert("practice_routines", PracticeRoutineSyncRow(value)) }
        for value in library.sessions { try upsert("practice_sessions", PracticeSessionSyncRow(value, pushedAt: now())) }
        let sets = library.history + (library.activeSet.map { [$0] } ?? [])
        for value in sets { try upsert("sets", SetSyncRow(value, pushedAt: now())) }
        // Skip fresh-device defaults until the first server copy is received. User-customized
        // guest state and later changes still enqueue, including views without explicit hooks.
        let ruleSettings = RuleSettingsSyncRow(library.ruleSettings)
        if try hasSnapshot(table: "rule_settings") || differsFromDefault(ruleSettings, RuleSettingsSyncRow(RuleSettings())) {
            try upsert("rule_settings", ruleSettings)
        }
        let rewardsState = RewardsStateSyncRow(library.rewardsState)
        if try hasSnapshot(table: "rewards_state") || differsFromDefault(rewardsState, RewardsStateSyncRow(RewardsState())) {
            try upsert("rewards_state", rewardsState)
        }
        let preferences = AccountPreferencesSyncRow(library.preferences)
        if try hasSnapshot(table: "account_preferences") || differsFromDefault(preferences, AccountPreferencesSyncRow(Preferences())) {
            try upsert("account_preferences", preferences)
        }
        if library.profile.ownerID != nil {
            let profile = ProfileSyncRow(library.profile, extras: state.profileBackendFields)
            if try hasSnapshot(table: "profiles") || differsFromDefault(profile, ProfileSyncRow(Profile(), extras: ProfileBackendFields()), ignoring: ["join_date"]) {
                try upsert("profiles", profile)
            }
        }
        for set in sets {
            for attempt in set.attempts {
                try append("attempts", AttemptSyncRow(attempt, setID: set.id))
                if let undoneAt = attempt.undoneAt { entries.append(.undoAttempt(attemptID: attempt.id, undoneAt: undoneAt)) }
            }
        }
        for value in library.ruleEvents { try append("rule_events", RuleEventSyncRow(value)) }
        for value in library.rewardLedger { try append("reward_ledger", RewardLedgerEntrySyncRow(value)) }
        for value in library.badges { try append("badges", BadgeSyncRow(value)) }
        for value in library.milestoneEvents { try append("milestone_events", MilestoneEventSyncRow(value)) }
        for value in library.coldGrades { try append("cold_grades", ColdGradeRecordSyncRow(value)) }
        for value in library.breakPointTaps { try append("break_point_taps", BreakPointTapSyncRow(value)) }
        for piece in library.pieces {
            entries.append(.updateLastPage(pieceID: piece.id, lastPage: piece.lastPage, at: piece.lastPageUpdatedAt))
        }
        try enqueueSnapshot(entries)
    }

    /// Drops every queued write without sending it. Used only on sign-out: the queue is per-account
    /// local state, and a pending write from account A must never be replayed after signing into
    /// account B on the same device.
    public func discardPendingWrites() throws { accountGeneration += 1; try queue.removeAll(); firstFailureAt = nil; status = .idle }

    /// Clears every piece of local sync bookkeeping tied to whichever account was just signed out
    /// of: the outbound queue (see `discardPendingWrites`), every table's pull cursor, and the
    /// cached backend-only profile fields — called from `SyncCoordinator` on the same `.signedOut`
    /// auth event `AuthManager` reacts to (sign-out or a successful account deletion), so a stale
    /// cursor from account A can never suppress rows account B legitimately needs on its first pull,
    /// and a queued write from A can never reach B. Practice library content itself is untouched —
    /// this is sync bookkeeping, not library data (spec: never lose user data).
    public func resetLocalAccountState(preservingProfileFor ownerID: UUID? = nil) throws {
        let previous = state
        var reset = SyncEngineState()
        if let ownerID, previous.accountOwnerID == ownerID {
            // Local profile edits belong to the still-owned library. Re-login can recover them;
            // retaining this binding also rejects replay under a different account.
            reset.accountOwnerID = ownerID
            reset.profileKnownOwnerID = previous.profileKnownOwnerID ?? previous.profileHydratedOwnerID
                ?? (previous.cursors["profiles"] == nil ? nil : ownerID)
            reset.profileBackendFields = previous.profileBackendFields
            reset.pendingProfileCoreFields = previous.pendingProfileCoreFields
            reset.pendingProfileBackendFields = previous.pendingProfileBackendFields
            reset.pendingProfileIntentSources = previous.pendingProfileIntentSources
        }
        var protectedReset = reset
        // Until queue deletion is durable, retain its old binding even on account deletion.
        // A failed clear must never make old account A writes appear ownerless for account B.
        protectedReset.accountOwnerID = protectedReset.accountOwnerID ?? previous.accountOwnerID
        state = protectedReset
        do { try persistState() } catch { state = previous; throw error }
        try discardPendingWrites()
        state = reset
        do { try persistState() } catch { state = protectedReset; throw error }
    }

    // MARK: Draining the outbound queue

    /// Sends every queued entry in order, stopping at the first failure (offline, or a real server
    /// error) rather than reordering later entries ahead of a stuck one. `applyPulledRow` is called
    /// once per `.upsert` entry the server rejected as stale (`applied: false`) — the protocol doc is
    /// explicit that the client must adopt the returned row rather than retry the same payload, so
    /// this is not optional plumbing, it is how a losing write resolves instead of looping forever.
    @discardableResult
    public func drain(applyPulledRow: (_ table: String, _ row: [String: SyncJSON]) throws -> Void = { _, _ in },
                      adoptPracticeSnapshot: (() async throws -> Void)? = nil) async -> Bool {
        guard !storageIsUnavailable, status != .syncing else { return false }
        guard !queue.entries.isEmpty else { status = .idle; return true }
        status = .syncing
        let generation = accountGeneration
        var confirmed = 0
        var needsPracticeAdoption = false
        // A force-quit may replay up to 32 already-accepted idempotent RPCs, never lose one.
        // Persisting acknowledgments in bounded batches avoids quadratic JSON writes on import.
        let pending = queue.entries
        for entry in pending {
            guard generation == accountGeneration else { return false }
            do {
                let result = try await perform(entry)
                guard generation == accountGeneration else { return false }
                if entry.kind == .upsert, !result.applied, let row = result.row {
                    if adoptPracticeSnapshot != nil, entry.table == "sets" || entry.table == "practice_sessions" {
                        // Keep this rejection and every later entry durable while sending the
                        // rest of the graph. Only a successful atomic adoption acknowledges it.
                        needsPracticeAdoption = true
                    } else { try applyPulledRow(entry.table, row) }
                }
                confirmed += 1
                if confirmed == 32 && !needsPracticeAdoption { try queue.removeFirst(confirmed); confirmed = 0 }
                firstFailureAt = nil
            } catch {
                guard generation == accountGeneration else { return false }
                if confirmed > 0 && !needsPracticeAdoption { try? queue.removeFirst(confirmed) }
                reportFailure(error)
                return false
            }
        }
        do {
            if needsPracticeAdoption, let adoptPracticeSnapshot { try await adoptPracticeSnapshot() }
            guard generation == accountGeneration else { return false }
            if confirmed > 0 { try queue.removeFirst(confirmed) }
        } catch { reportFailure(error); return false }
        do { try persistState() } catch { reportFailure(error); return false }
        status = .idle
        lastSyncedAt = now()
        return true
    }

    private func perform(_ entry: SyncQueueEntry) async throws -> SyncRPCResult {
        switch entry.kind {
        case .upsert: return try await transport.upsert(table: entry.table, row: Self.explicitNullableColumns(table: entry.table, row: entry.row))
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
    /// advances the cursor to the latest value of `cursorField` actually seen, so a partial failure
    /// mid-table re-pulls from the old cursor next time rather than skipping rows.
    ///
    /// `cursorField` defaults to `"updated_at"` (every whole-row-LWW `sync_tables` member has one).
    /// An `append_only_tables` member has no `updated_at`/`deleted_at` at all (Schema3.md: "adding
    /// those to a log would be dead weight") but every one of them does have its own event-date
    /// column (`attempts.date`, `rule_events.fired_at`, `badges.earned_at`, ...) — pass that column
    /// name here so pulling a log still advances a real cursor instead of either re-fetching every
    /// row ever appended on every sync, or (worse) never establishing one and silently pulling
    /// nothing past the first page.
    public func pull(table: String, cursorField: String = "updated_at", applyRow: (_ row: [String: SyncJSON]) throws -> Void) async throws {
        let generation = accountGeneration
        let rows = try await transport.fetch(table: table, field: cursorField, updatedSince: nil)
        for (index, row) in rows.enumerated() {
            // Importing hundreds of annotations otherwise monopolizes the main actor until the
            // entire table has been decoded, validated and saved. Let drawing and taps run.
            if index.isMultiple(of: 16) { await Task.yield() }
            try requireCurrentPull(generation)
            try applyRow(row)
        }
        try requireCurrentPull(generation)
        try acknowledgeRows(rows, table: table, cursorField: cursorField)
    }
    /// Applies a whole fetched table before acknowledging its cursor, allowing the rep log to
    /// merge in one atomic library transaction instead of rewriting the library once per rep.
    public func pullRows(table: String, cursorField: String = "updated_at", applyRows: ([[String: SyncJSON]]) throws -> Void) async throws {
        let generation = accountGeneration
        let rows = try await transport.fetch(table: table, field: cursorField, updatedSince: nil)
        try requireCurrentPull(generation)
        try applyRows(rows)
        try requireCurrentPull(generation)
        try acknowledgeRows(rows, table: table, cursorField: cursorField)
    }

    private func requireCurrentPull(_ generation: Int) throws {
        try Task.checkCancellation()
        guard generation == accountGeneration else { throw SyncError.transport("Account changed during sync.") }
    }

    private func acknowledgeRows(_ rows: [[String: SyncJSON]], table: String, cursorField: String) throws {
        let cursorKey = cursorField == "updated_at" ? table : "\(table)#\(cursorField)"
        var latest = state.cursors[cursorKey]
        for row in rows {
            if let value = row[cursorField]?.stringValue.flatMap(SyncCoding.parseDate), latest == nil || value > latest! { latest = value }
        }
        if let latest { state.cursors[cursorKey] = latest }
        try persistState()
    }

    /// Fetch parent sessions, set metadata, and their rep log before acknowledging any of them.
    /// The callback commits one validated practice snapshot; failure leaves every cursor unchanged.
    public func pullPracticeSnapshot(applyRows: ([String: [[String: SyncJSON]]]) throws -> Void) async throws {
        let generation = accountGeneration
        let tables = [("practice_sessions", "updated_at"), ("sets", "updated_at"), ("attempts", "date")]
        var rows: [String: [[String: SyncJSON]]] = [:]
        for (table, field) in tables {
            rows[table] = try await transport.fetch(table: table, field: field, updatedSince: nil)
            try requireCurrentPull(generation)
        }
        try applyRows(rows)
        try requireCurrentPull(generation)
        for (table, field) in tables {
            let key = field == "updated_at" ? table : "\(table)#\(field)"
            let dates = (rows[table] ?? []).compactMap { $0[field]?.stringValue.flatMap(SyncCoding.parseDate) }
            if let latest = dates.max(), state.cursors[key] == nil || latest > state.cursors[key]! { state.cursors[key] = latest }
        }
        try persistState()
    }

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

/// Collects every ordered server page, advancing by the actual response size because a hosted
/// server may enforce a lower cap than the requested size. An empty page proves exhaustion.
public enum SyncPagination {
    public static func collect(pageSize: Int = 500, fetchPage: @Sendable (Int, Int) async throws -> [[String: SyncJSON]]) async throws -> [[String: SyncJSON]] {
        guard pageSize > 0 else { throw SyncError.transport("Invalid sync page size.") }
        var rows: [[String: SyncJSON]] = []
        var offset = 0
        while true {
            let page = try await fetchPage(offset, pageSize)
            guard !page.isEmpty else { return rows }
            rows.append(contentsOf: page)
            offset += page.count
        }
    }
}
