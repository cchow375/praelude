import Foundation
import Observation
import Auth

/// Owns the app's account lifecycle (spec §4b): email+password sign up/in, magic link (via
/// `onOpenURL` -> `handleAuthCallback`), password reset, sign out, in-app account deletion, and the
/// guest-mode -> account upgrade path. `PracticeStore` already works fully offline with
/// `Profile.ownerID == nil` (guest mode, Schema3.md); this type's only responsibility toward that
/// data is stamping `ownerID` once, the first time a guest successfully signs up or signs in — never
/// touching, migrating or deleting anything else in the library (spec: never lose user data).
@MainActor @Observable
public final class AuthManager {
    public enum State: Equatable, Sendable {
        case guest
        case authenticating
        case signedIn(userID: UUID, email: String?)
    }
    public private(set) var state: State = .guest
    public private(set) var lastError: String?
    /// Set right after `sendMagicLink`/`resetPassword` succeeds, so the UI can show "check your
    /// email" without a separate round trip.
    public private(set) var lastSentEmail: String?

    private let services: SupabaseServices
    private let store: PracticeStore
    private var observeTask: Task<Void, Never>?
    public static let authCallbackURLScheme = "praelude"
    public static let authCallbackHost = "auth-callback"

    public init(services: SupabaseServices, store: PracticeStore) {
        self.services = services
        self.store = store
        state = Self.sessionState(services.auth.currentSession)
        observeTask = Task { [weak self] in await self?.observeAuthState() }
    }
    deinit { observeTask?.cancel() }

    private func observeAuthState() async {
        for await (event, session) in services.auth.authStateChanges {
            switch event {
            case .initialSession, .signedIn, .tokenRefreshed, .userUpdated:
                guard let session else { continue }
                state = .signedIn(userID: session.user.id, email: session.user.email)
                // Idempotent (guards on ownerID == nil internally) - simplest to call on every event
                // that carries a session rather than track "was this transition actually the guest
                // -> account moment" separately from AuthManager's own `state`.
                attachAccountIfNeeded(userID: session.user.id)
            case .signedOut:
                state = .guest
            default:
                break
            }
        }
    }

    /// Zero-data-loss guest upgrade (spec §4b): the only write is `Profile.ownerID`. Every existing
    /// local record starts syncing on the very next `SyncCoordinator` pass because it now belongs to
    /// someone — nothing about the records themselves changes, and nothing is re-created or deleted.
    private func attachAccountIfNeeded(userID: UUID) {
        guard store.state.profile.ownerID == nil else { return }
        var profile = store.state.profile
        profile.ownerID = userID
        profile.updatedAt = Date()
        try? store.updateProfile(profile)
    }

    // MARK: Sign up / sign in

    public func signUp(email: String, password: String) async {
        state = .authenticating; lastError = nil
        do {
            try await services.auth.signUp(email: email, password: password)
        } catch {
            lastError = Self.message(for: error)
            state = Self.sessionState(services.auth.currentSession)
        }
    }
    public func signIn(email: String, password: String) async {
        state = .authenticating; lastError = nil
        do {
            _ = try await services.auth.signIn(email: email, password: password)
        } catch {
            lastError = Self.message(for: error)
            state = Self.sessionState(services.auth.currentSession)
        }
    }

    /// Sends the magic-link email. The actual sign-in completes in `handleAuthCallback` once
    /// `praelude://auth-callback` reopens the app (wired via `onOpenURL` in `PraeludeApp`).
    @discardableResult
    public func sendMagicLink(email: String) async -> Bool {
        lastError = nil
        do {
            try await services.auth.signInWithOTP(
                email: email,
                redirectTo: URL(string: "\(Self.authCallbackURLScheme)://\(Self.authCallbackHost)"),
                shouldCreateUser: true
            )
            lastSentEmail = email
            return true
        } catch {
            lastError = Self.message(for: error)
            return false
        }
    }
    /// Call from `onOpenURL` for any URL whose scheme/host match `authCallbackURLScheme`/`authCallbackHost`.
    public func handleAuthCallback(url: URL) async {
        do { _ = try await services.auth.session(from: url) } catch { lastError = Self.message(for: error) }
    }
    @discardableResult
    public func resetPassword(email: String) async -> Bool {
        lastError = nil
        do {
            try await services.auth.resetPasswordForEmail(
                email, redirectTo: URL(string: "\(Self.authCallbackURLScheme)://\(Self.authCallbackHost)"))
            lastSentEmail = email
            return true
        } catch {
            lastError = Self.message(for: error)
            return false
        }
    }
    /// After the reset-link email lands the user back on `session(from:)` (handled the same as magic
    /// link), the session is valid but the password itself is unchanged until this is called.
    @discardableResult
    public func setNewPassword(_ password: String) async -> Bool {
        lastError = nil
        do {
            _ = try await services.auth.update(user: UserAttributes(password: password))
            return true
        } catch {
            lastError = Self.message(for: error)
            return false
        }
    }

    public func signOut() async {
        do { try await services.auth.signOut() } catch { lastError = Self.message(for: error) }
        // The .signedOut event (observeAuthState) flips state back to .guest. Local library data is
        // left exactly as it is: signing out never deletes anything (spec: never lose user data);
        // it only stops pushing/pulling until someone signs in again on this device.
    }

    // MARK: Account deletion (spec §4b) — storage first, then the RPC.
    //
    // supabase/(C) Backend.md correction 4: `delete_my_account()` cannot delete `storage.objects`
    // itself (the platform blocks any direct SQL DELETE against it, even from SECURITY DEFINER); the
    // client must clear its own objects in all four buckets via the Storage API first, or the RPC
    // raises a clear, named error instead of silently orphaning files.

    private static let ownedBuckets = ["avatars", "scores", "recordings", "note-media"]

    /// Caller confirms twice in the UI (spec §4b) before this is ever invoked — this method itself
    /// performs the deletion unconditionally once called, no further confirmation gate here.
    @discardableResult
    public func deleteAccount() async -> Bool {
        guard case .signedIn(let userID, _) = state else { return false }
        lastError = nil
        do {
            let storage = try await services.storage()
            for bucket in Self.ownedBuckets {
                let paths = try await allFilePaths(storage: storage, bucket: bucket, prefix: userID.uuidString)
                if !paths.isEmpty { _ = try await storage.from(bucket).remove(paths: paths) }
            }
            let postgrest = try await services.postgrest()
            _ = try await postgrest.rpc("delete_my_account").execute()
            state = .guest
            return true
        } catch {
            lastError = Self.message(for: error)
            return false
        }
    }

    /// Storage `list(path:)` is one level deep, like `ls`; a real object always has a non-nil `id`
    /// (Supabase stamps every stored file with one), while a "folder" is a synthesized placeholder
    /// entry with `id == nil` — so this recurses into those and only collects real object paths.
    /// Bounded to a shallow depth: this app's own upload paths are at most two levels under the
    /// owner prefix (`scores/{uid}/{pieceID}/{file}`), so a runaway recursion would itself indicate a
    /// server response this method does not understand, not a legitimately deep tree.
    private func allFilePaths(storage: SupabaseStorageClient, bucket: String, prefix: String, depth: Int = 0) async throws -> [String] {
        guard depth < 6 else { return [] }
        let entries = try await storage.from(bucket).list(path: prefix)
        var paths: [String] = []
        for entry in entries {
            let entryPath = "\(prefix)/\(entry.name)"
            if entry.id != nil {
                paths.append(entryPath)
            } else {
                paths += try await allFilePaths(storage: storage, bucket: bucket, prefix: entryPath, depth: depth + 1)
            }
        }
        return paths
    }

    private static func sessionState(_ session: Session?) -> State {
        guard let session else { return .guest }
        return .signedIn(userID: session.user.id, email: session.user.email)
    }
    private static func message(for error: Error) -> String {
        if let authError = error as? AuthError { return authError.errorDescription ?? authError.localizedDescription }
        return error.localizedDescription
    }
}
