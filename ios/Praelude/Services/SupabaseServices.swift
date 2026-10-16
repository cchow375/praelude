import Foundation
import Auth
import PostgREST
import Storage

/// Builds the Supabase SDK clients this app talks to (spec §4a-§4d): one long-lived `AuthClient`
/// (it owns the session/auto-refresh lifecycle and its own Keychain-backed storage, so it must be a
/// singleton), and a fresh, correctly-authorized `PostgrestClient`/`SupabaseStorageClient` per call
/// rather than one mutable shared instance — simpler than tracking "has the access token rotated
/// since I built this client" by hand, and `AuthClient.session` already does the "refresh if needed"
/// work for free. Only the publishable key (`SupabaseConfig`) ever appears here — see
/// `supabase/(C) Backend.md`'s "iOS-side config" section.
@MainActor
public final class SupabaseServices {
    public let auth: AuthClient
    private let apiKeyHeader: [String: String]
    private let restURL: URL
    private let storageURL: URL

    /// `localStorage` defaults to the real Keychain-backed store every actual launch of this app
    /// uses; `(C) sync-smoke.sh`'s test overrides it with an isolated in-memory store per simulated
    /// "device" so two sign-ins to the same account in one test process never share (or clobber)
    /// each other's session, the way two *actual* devices never do either.
    public init(localStorage: any AuthLocalStorage = AuthClient.Configuration.defaultLocalStorage) {
        apiKeyHeader = ["apikey": SupabaseConfig.publishableKey]
        auth = AuthClient(configuration: AuthClient.Configuration(
            url: SupabaseConfig.projectURL.appendingPathComponent("auth/v1"),
            headers: apiKeyHeader,
            redirectToURL: URL(string: "praelude://auth-callback"),
            localStorage: localStorage
        ))
        restURL = SupabaseConfig.projectURL.appendingPathComponent("rest/v1")
        storageURL = SupabaseConfig.projectURL.appendingPathComponent("storage/v1")
    }

    /// A `PostgrestClient` authorized with the caller's current (refreshed-if-needed) access token.
    /// Throws `AuthError.sessionMissing` when signed out or in guest mode — callers only reach this
    /// while signed in (see `AuthManager`/`SyncCoordinator`).
    public func postgrest(expectedOwnerID: UUID? = nil) async throws -> PostgrestClient {
        let session = try await auth.session
        try Self.requireExpectedOwner(expectedOwnerID, actualOwnerID: session.user.id)
        var headers = apiKeyHeader
        headers["Authorization"] = "Bearer \(session.accessToken)"
        // `logger: nil` is already this initializer's default; passing it explicitly disambiguates
        // toward the current init(url:schema:headers:logger:fetch:encoder:decoder:retryEnabled:)
        // instead of the deprecated pre-logger overload, which otherwise resolves first.
        return PostgrestClient(url: restURL, headers: headers, logger: nil)
    }
    public func storage(expectedOwnerID: UUID? = nil) async throws -> SupabaseStorageClient {
        let session = try await auth.session
        try Self.requireExpectedOwner(expectedOwnerID, actualOwnerID: session.user.id)
        var headers = apiKeyHeader
        headers["Authorization"] = "Bearer \(session.accessToken)"
        return SupabaseStorageClient(configuration: StorageClientConfiguration(url: storageURL, headers: headers, logger: nil))
    }
    nonisolated static func requireExpectedOwner(_ expectedOwnerID: UUID?, actualOwnerID: UUID) throws {
        if let expectedOwnerID, expectedOwnerID != actualOwnerID {
            throw SyncError.transport("Account changed while authorizing sync. Your local changes are retained.")
        }
    }
}
