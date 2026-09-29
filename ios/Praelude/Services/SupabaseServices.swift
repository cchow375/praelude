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

    public init() {
        apiKeyHeader = ["apikey": SupabaseConfig.publishableKey]
        auth = AuthClient(configuration: AuthClient.Configuration(
            url: SupabaseConfig.projectURL.appendingPathComponent("auth/v1"),
            headers: apiKeyHeader,
            redirectToURL: URL(string: "praelude://auth-callback"),
            localStorage: AuthClient.Configuration.defaultLocalStorage
        ))
        restURL = SupabaseConfig.projectURL.appendingPathComponent("rest/v1")
        storageURL = SupabaseConfig.projectURL.appendingPathComponent("storage/v1")
    }

    /// A `PostgrestClient` authorized with the caller's current (refreshed-if-needed) access token.
    /// Throws `AuthError.sessionMissing` when signed out or in guest mode — callers only reach this
    /// while signed in (see `AuthManager`/`SyncCoordinator`).
    public func postgrest() async throws -> PostgrestClient {
        let token = try await auth.session.accessToken
        var headers = apiKeyHeader
        headers["Authorization"] = "Bearer \(token)"
        return PostgrestClient(url: restURL, headers: headers)
    }
    public func storage() async throws -> SupabaseStorageClient {
        let token = try await auth.session.accessToken
        var headers = apiKeyHeader
        headers["Authorization"] = "Bearer \(token)"
        return SupabaseStorageClient(configuration: StorageClientConfiguration(url: storageURL, headers: headers))
    }
}
