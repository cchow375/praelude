import Foundation
import PostgREST

/// The real, network-backed `SyncTransport` (protocol defined in `Core/SyncEngine.swift`) — talks to
/// the four RPCs in `supabase/(C) Sync Protocol.md` §2 through `SupabaseServices.postgrest()`. Kept
/// out of `Core/` because it imports the Supabase SDK; `SyncEngine` itself only ever sees the
/// protocol, so it stays testable with a fake transport and no network.
public struct PostgRESTSyncTransport: SyncTransport {
    private let services: SupabaseServices
    private var expectedOwnerID: UUID?

    @MainActor public init(services: SupabaseServices) { self.services = services; expectedOwnerID = nil }

    public func scoped(to ownerID: UUID) -> any SyncTransport {
        var copy = self; copy.expectedOwnerID = ownerID; return copy
    }

    public func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        try await callRPC("sync_upsert", params: TableRowParams(p_table: table, p_row: .object(row)))
    }
    public func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        try await callRPC("sync_append", params: TableRowParams(p_table: table, p_row: .object(row)))
    }
    public func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult {
        try await callRPC("sync_update_last_page", params: LastPageParams(
            p_id: pieceID, p_last_page: lastPage, p_at: SyncCoding.string(from: at)))
    }
    public func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult {
        try await callRPC("sync_undo_attempt", params: UndoParams(
            p_id: attemptID, p_undone_at: SyncCoding.string(from: undoneAt)))
    }

    /// Every one of the caller's own rows in `table` with `field > since`. RLS already scopes
    /// every table to `auth.uid()` (see "(C) Sync Protocol.md" §2 — "the owner_id filter is for
    /// query-planning, not security"), so this deliberately does not add its own `owner_id` filter.
    /// `field` is `"updated_at"` for an ordinary table; `SyncEngine.pull`'s `cursorField` passes an
    /// append-only log's own event-date column instead (that family has no `updated_at` at all).
    public func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] {
        do {
            let postgrest = try await services.postgrest(expectedOwnerID: expectedOwnerID)
            return try await Self.fetchRows(client: postgrest, table: table, field: field, updatedSince: updatedSince)
        } catch {
            throw Self.mappedTransportError(error)
        }
    }

    /// Shared by the authorized path and request-level tests using the SDK's intercepted HTTP
    /// transport. Owner-keyed singleton tables have no `id` column, even when they are empty.
    static func fetchRows(client: PostgrestClient, table: String, field: String,
                          updatedSince: Date?) async throws -> [[String: SyncJSON]] {
        let ownerKeyedTables: Set<String> = ["rule_settings", "rewards_state", "account_preferences"]
        let orderColumn = ownerKeyedTables.contains(table) ? "owner_id" : "id"
        // Hosted PostgREST caps responses at 1,000 rows. Read ordered pages until an empty
        // response, including when a server cap is lower than our requested page size.
        return try await SyncPagination.collect { offset, pageSize in
            var query = client.from(table).select()
            if let updatedSince { query = query.gt(field, value: SyncCoding.string(from: updatedSince)) }
            let response: [SyncJSON] = try await query.order(orderColumn).range(from: offset, to: offset + pageSize - 1).execute().value
            return try response.map { value -> [String: SyncJSON] in
                guard let row = value.objectValue else { throw SyncError.invalidRemoteRow(table) }
                return row
            }
        }
    }

    private func callRPC<Params: Encodable>(_ name: String, params: Params) async throws -> SyncRPCResult {
        do {
            let postgrest = try await services.postgrest(expectedOwnerID: expectedOwnerID)
            let response: RPCEnvelope = try await postgrest.rpc(name, params: params).execute().value
            return SyncRPCResult(applied: response.applied, row: response.row?.objectValue)
        } catch {
            throw Self.mappedTransportError(error)
        }
    }

    /// Preserve typed connectivity failures so status can distinguish an offline connection from
    /// an online backend/schema rejection. NSError values from NSURLErrorDomain bridge here too.
    static func mappedTransportError(_ error: any Error) -> any Error {
        if let error = error as? SyncError { return error }
        if let error = error as? URLError { return error }
        let foundationError = error as NSError
        if foundationError.domain == NSURLErrorDomain {
            return URLError(URLError.Code(rawValue: foundationError.code), userInfo: foundationError.userInfo)
        }
        if let error = error as? PostgrestError { return SyncError.transport(backendErrorMessage(error)) }
        return SyncError.transport(error.localizedDescription)
    }

    /// Preserve the server code and concise message, without echoing optional row details, hints,
    /// request bodies, authorization headers or client credentials into the sync status.
    static func backendErrorMessage(_ error: PostgrestError) -> String {
        guard let code = error.code, !code.isEmpty else { return error.message }
        return "\(error.message) (\(code))"
    }
}

private struct RPCEnvelope: Decodable { let applied: Bool; let row: SyncJSON? }
private struct TableRowParams: Encodable { let p_table: String; let p_row: SyncJSON }
private struct LastPageParams: Encodable { let p_id: UUID; let p_last_page: Int; let p_at: String }
private struct UndoParams: Encodable { let p_id: UUID; let p_undone_at: String }
