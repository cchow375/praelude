import Foundation
import XCTest
import Auth
@testable import Praelude

/// Isolated per-"device" session storage — the real app always uses the Keychain-backed
/// `AuthClient.Configuration.defaultLocalStorage`, which is exactly what two *actual* devices never
/// share. Signing the same account in twice in one test process needs the same isolation, or the
/// second sign-in would silently clobber the first's cached session.
private final class InMemoryAuthStorage: AuthLocalStorage, @unchecked Sendable {
    private var values: [String: Data] = [:]
    private let lock = NSLock()
    func store(key: String, value: Data) throws { lock.lock(); defer { lock.unlock() }; values[key] = value }
    func retrieve(key: String) throws -> Data? { lock.lock(); defer { lock.unlock() }; return values[key] }
    func remove(key: String) throws { lock.lock(); defer { lock.unlock() }; values.removeValue(forKey: key) }
}

/// Live two-device sync smoke test (spec §17a: "two-device sync identical history") — the one thing
/// `SyncEngineTests`' fake transport cannot prove, because it never touches the real hosted project,
/// the real `sync_upsert` RPC, or a real access token. Gated entirely on environment variables so
/// this never runs (and never needs credentials) as part of `swift test`/ordinary `xcodebuild test`;
/// see `ios/scripts/(C) sync-smoke.sh` for how to run it and how to obtain a throwaway account.
///
/// Why this needs a pre-confirmed account rather than signing one up itself: this project's
/// `auth.email.enable_confirmations` is on (supabase/(C) Backend.md, "Auth configuration"), so a
/// fresh signup has no usable session until its email is confirmed — this test authenticates for
/// real (it exercises the actual `PostgRESTSyncTransport`/RLS path, not SQL impersonation), and
/// neither a real inbox nor a temporary confirmations-off flip on the shared hosted project is this
/// test's call to make. `supabase/tests/run.sh` documents the identical constraint for its own
/// throwaway users.
@MainActor
final class SyncSmokeTests: XCTestCase {
    private struct Device {
        let auth: AuthManager
        let store: PracticeStore
        let coordinator: SyncCoordinator
    }

    private func requireCredentials() throws -> (email: String, password: String) {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["PRAELUDE_SMOKE_EMAIL"], let password = env["PRAELUDE_SMOKE_PASSWORD"],
              !email.isEmpty, !password.isEmpty else {
            throw XCTSkip("""
                Set PRAELUDE_SMOKE_EMAIL / PRAELUDE_SMOKE_PASSWORD to a confirmed throwaway \
                account to run this live test against the hosted project. See \
                ios/scripts/(C) sync-smoke.sh.
                """)
        }
        return (email, password)
    }

    private func device(_ label: String) -> Device {
        let services = SupabaseServices(localStorage: InMemoryAuthStorage())
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("praelude-smoke-\(label)-\(UUID())")
        let store = PracticeStore(directory: directory)
        let auth = AuthManager(services: services, store: store)
        let engine = SyncEngine(transport: PostgRESTSyncTransport(services: services), directory: directory.appendingPathComponent("Sync"))
        return Device(auth: auth, store: store, coordinator: SyncCoordinator(engine: engine, auth: auth, store: store))
    }

    private func signIn(_ device: Device, email: String, password: String) async throws {
        await device.auth.signIn(email: email, password: password)
        guard case .signedIn = device.auth.state else {
            throw XCTSkip("Could not sign in with the supplied smoke-test credentials: \(device.auth.lastError ?? "unknown error"). Is the account confirmed?")
        }
    }

    /// Repeatedly calls `syncAll()` until the queue is actually empty or `timeout` elapses, rather
    /// than trusting one call: `SyncCoordinator.pushX` already fires its own untracked
    /// `Task { await syncAll() }`, and `SyncEngine.drain` is a deliberate no-op while a drain is
    /// already in flight (see its doc comment) — so a single explicit call racing that background
    /// task can return having sent nothing. Polling converges regardless of which call actually wins.
    private func waitForDrain(_ device: Device, timeout: TimeInterval = 20) async {
        let deadline = Date().addingTimeInterval(timeout)
        while device.coordinator.pendingCount > 0, Date() < deadline {
            await device.coordinator.syncAll()
            if device.coordinator.pendingCount > 0 { try? await Task.sleep(for: .milliseconds(300)) }
        }
    }

    func testTwoDevicesOnTheSameAccountConvergeAgainstTheLiveBackend() async throws {
        let (email, password) = try requireCredentials()
        let deviceA = device("A")
        let deviceB = device("B")
        try await signIn(deviceA, email: email, password: password)
        try await signIn(deviceB, email: email, password: password)

        let pieceID = UUID()
        let original = Piece(id: pieceID, title: "Praelude sync smoke test", pageCount: 1)
        try deviceA.store.addPiece(original)
        deviceA.coordinator.pushPiece(original)
        await waitForDrain(deviceA)

        await deviceB.coordinator.syncAll()
        guard deviceB.store.state.pieces.first(where: { $0.id == pieceID }) != nil else {
            return XCTFail("Device B never received device A's push after a pull — sync is not actually reaching the live backend.")
        }

        // Conflicting edits made "offline" on each device, B's strictly later; converge and assert
        // both devices land on exactly the same winner (spec §17a: "identical history").
        let base = Date()
        var editedByA = original
        editedByA.title = "Edited on device A"
        editedByA.updatedAt = base
        try deviceA.store.updatePiece(editedByA)
        deviceA.coordinator.pushPiece(editedByA)
        await waitForDrain(deviceA)

        var editedByB = deviceB.store.state.pieces.first { $0.id == pieceID } ?? original
        editedByB.title = "Edited on device B, later"
        editedByB.updatedAt = base.addingTimeInterval(5)
        try deviceB.store.updatePiece(editedByB)
        deviceB.coordinator.pushPiece(editedByB)
        await waitForDrain(deviceB)

        // A final pull on each side settles whichever side did not already adopt the winner via its
        // own rejected-push response.
        await deviceA.coordinator.syncAll()
        await deviceB.coordinator.syncAll()

        let finalA = deviceA.store.state.pieces.first { $0.id == pieceID }?.title
        let finalB = deviceB.store.state.pieces.first { $0.id == pieceID }?.title
        XCTAssertEqual(finalA, "Edited on device B, later")
        XCTAssertEqual(finalA, finalB, "Both devices must converge on identical history.")

        // Best-effort cleanup: this schema tombstones rather than hard-deletes from the client (no
        // delete policy — supabase/tests/01_rls_policy_coverage.sql), so mark the test piece deleted
        // rather than leave it visible in the account's library.
        var tombstoned = editedByB
        tombstoned.deletedAt = Date(); tombstoned.updatedAt = tombstoned.deletedAt!
        try? deviceB.store.updatePiece(tombstoned)
        deviceB.coordinator.pushPiece(tombstoned)
        await waitForDrain(deviceB)
    }
}
