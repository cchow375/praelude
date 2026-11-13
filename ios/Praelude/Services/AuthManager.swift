import Foundation
import Observation
import Auth
import Storage

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
    /// Local practice belongs to one account. Preserve it and reject a different session until
    /// separate per-account libraries exist; no upload may adopt another account's private files.
    public var canSyncLocalLibrary: Bool {
        guard case .signedIn(let userID, _) = state else { return false }
        return store.state.profile.ownerID == userID
    }
    /// Set right after `sendMagicLink`/`resetPassword` succeeds, so the UI can show "check your
    /// email" without a separate round trip.
    public private(set) var lastSentEmail: String?
    /// Fired on every `.signedOut` auth event — ordinary sign-out and a successful account deletion
    /// both end here (see `deleteAccount`). `SyncCoordinator` hooks this in `PraeludeApp.init` to
    /// clear its own local bookkeeping (`SyncEngine.resetLocalAccountState`); `AuthManager` itself
    /// has no sync state to clear and stays unaware of `SyncCoordinator` to avoid a circular
    /// dependency between the two.
    public var onSignedOut: (() -> Void)?

    private let services: SupabaseServices
    private let store: PracticeStore
    // `deinit` runs nonisolated even on a @MainActor class (it may run from any thread), so under
    // Swift 6 strict concurrency it cannot touch a main-actor-isolated stored property. `Task<Void,
    // Never>?` is itself Sendable (Task is a Sendable reference and Optional of a Sendable type is
    // Sendable), so `deinit` reading/cancelling it is genuinely race-free — but this toolchain
    // (verified against an actual simulator build, not just reasoned about — this file is only ever
    // reached that way; `swift test --package-path ios` builds just the Foundation-only Core
    // package) rejects plain `nonisolated` on *any* mutable stored `var` outright ("'nonisolated'
    // cannot be applied to mutable stored properties"), full stop — `nonisolated(unsafe)` is the one
    // spelling this version of Swift accepts for that, not a further-relaxed alternative to it.
    // `@ObservationIgnored` on top: this is pure internal bookkeeping no view ever reads, so it
    // should not be part of `@Observable`'s tracked state regardless of which spelling compiles.
    @ObservationIgnored private nonisolated(unsafe) var observeTask: Task<Void, Never>?
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
                if let ownerID = store.state.profile.ownerID, ownerID != session.user.id {
                    lastError = "This device's practice library belongs to another account. Sign back into that account to sync it. Your local practice is preserved."
                    state = .guest
                    try? await services.auth.signOut()
                    continue
                }
                state = .signedIn(userID: session.user.id, email: session.user.email)
                // Idempotent (guards on ownerID == nil internally) - simplest to call on every event
                // that carries a session rather than track "was this transition actually the guest
                // -> account moment" separately from AuthManager's own `state`.
                attachAccountIfNeeded(userID: session.user.id)
            case .signedOut:
                state = .guest
                onSignedOut?()
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
        // Attaching an account is not a profile edit; hydrate its identity before publishing.
        try? store.applySyncedProfile(profile)
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
    // client must clear its own objects in all five buckets via the Storage API first, or the RPC
    // raises a clear, named error instead of silently orphaning files.

    private static let ownedBuckets = ["avatars", "scores", "recordings", "note-media", "covers"]

    /// Caller confirms twice in the UI (spec §4b) before this is ever invoked — this method itself
    /// performs the deletion unconditionally once called, no further confirmation gate here.
    ///
    /// Local library data (reps, passages, annotations, scores, profile) is deliberately **not**
    /// wiped by this method — only this device's *account association* is (this device's copy
    /// reverts to an ordinary offline guest library, the same shape guest mode already is; see
    /// `detachLocalProfile`). Wiping practice content on top of a server-side account delete would
    /// turn one irreversible action into two, and "never lose user data" makes no carve-out for
    /// this path. The UI's own copy already states this local library is untouched.
    @discardableResult
    public func deleteAccount() async -> Bool {
        guard case .signedIn(let userID, _) = state else { return false }
        lastError = nil
        do {
            let storage = try await services.storage()
            for bucket in Self.ownedBuckets {
                let paths = try await allFilePaths(storage: storage, bucket: bucket, prefix: userID.uuidString.lowercased())
                if !paths.isEmpty { _ = try await storage.from(bucket).remove(paths: paths) }
            }
            let postgrest = try await services.postgrest()
            // Only after both storage and the RPC itself succeed does anything local change — a
            // failure at either step above throws before this line, leaving state/local data alone
            // so the caller sees an error and nothing was touched (spec: wipe local account data
            // only after server success).
            _ = try await postgrest.rpc("delete_my_account").execute()
            detachLocalProfile()
            // The account (and its GoTrue session rows) is already gone server-side; this clears
            // the local Keychain-cached session to match and fires the same `.signedOut` event an
            // ordinary sign-out does (-> `onSignedOut` -> SyncCoordinator resets its local sync
            // bookkeeping). Best-effort: a session the server already invalidated can itself error
            // here, which must not be reported as "account deletion failed" when it already succeeded.
            try? await services.auth.signOut()
            state = .guest
            return true
        } catch {
            lastError = Self.message(for: error)
            return false
        }
    }

    /// The one local write account deletion makes: detaches this device's library from the deleted
    /// account (`ownerID` back to `nil`, the same "no account yet" value guest mode always used) so
    /// a future sign-up/sign-in on this device starts a fresh sync relationship rather than silently
    /// re-attaching (and re-pushing) a profile row for an account that no longer exists server-side.
    /// Every other field is left exactly as it was — this is a detach, not a reset.
    private func detachLocalProfile() {
        var profile = store.state.profile
        profile.ownerID = nil
        try? store.updateProfile(profile)
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

    // MARK: Profile photo (spec §4c) — `avatars` bucket, owner-prefixed path (see
    // supabase/(C) Backend.md's storage-buckets note: RLS is owner-only write, privacy-gated read,
    // never a public bucket). `Profile.photoRef` stores the relative path, not a URL (the sync
    // protocol's `photo_path` column), so a signed URL is minted on demand for display.

    private static let avatarFileName = "avatar.jpg"

    /// Uploads (replacing any existing) JPEG avatar data and returns the storage path to save on
    /// `Profile.photoRef`. `nil` on failure (`lastError` is set); guest mode has nowhere to upload
    /// to and also returns `nil`.
    public func uploadAvatar(jpegData: Data) async -> String? {
        guard case .signedIn(let userID, _) = state else { return nil }
        do {
            let storage = try await services.storage()
            let path = "\(userID.uuidString.lowercased())/\(Self.avatarFileName)"
            _ = try await storage.from("avatars").upload(path, data: jpegData, options: FileOptions(contentType: "image/jpeg", upsert: true))
            return path
        } catch {
            lastError = Self.message(for: error)
            return nil
        }
    }
    /// A short-lived signed URL for a `Profile.photoRef` path, for display only — the `avatars`
    /// bucket is private, so the raw path is never directly fetchable. `nil` (silently — this is
    /// used for best-effort display, not a user-facing action) if signing fails, e.g. offline.
    public func avatarSignedURL(path: String) async -> URL? {
        guard case .signedIn = state else { return nil }
        return try? await services.storage().from("avatars").createSignedURL(path: path, expiresIn: 3600)
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
