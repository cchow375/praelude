import Foundation
import XCTest
@testable import Praelude

/// A transport that fails every call — proves guest mode never reaches the network layer at all
/// (spec §4b: "fully offline guest mode"), not just that a push happens to no-op against a fake
/// tolerant of being called. `AuthManager`'s own network-calling methods (signUp/signIn/signOut/
/// deleteAccount) talk to the concrete Supabase SDK clients directly with no protocol seam, so they
/// are integration surface, not unit-test surface — covered instead by
/// `ios/scripts/(C) sync-smoke.sh` against the real hosted project. What *is* safely unit-testable
/// here, without any network access, is the wiring this track added around that boundary: guest mode
/// never touching sync, and the sign-out -> reset-local-state hook actually firing.
private struct NeverCalledTransport: SyncTransport {
    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        XCTFail("upsert must not be called while signed out"); throw SyncError.transport("unexpected call")
    }
    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult {
        XCTFail("append must not be called while signed out"); throw SyncError.transport("unexpected call")
    }
    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult {
        XCTFail("updateLastPage must not be called while signed out"); throw SyncError.transport("unexpected call")
    }
    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult {
        XCTFail("undoAttempt must not be called while signed out"); throw SyncError.transport("unexpected call")
    }
    func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] {
        XCTFail("fetch must not be called while signed out"); throw SyncError.transport("unexpected call")
    }
}

@MainActor
final class AuthSyncWiringTests: XCTestCase {
    private func store() -> PracticeStore {
        PracticeStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("praelude-app-tests-\(UUID())"))
    }
    private func engine() -> SyncEngine {
        SyncEngine(transport: NeverCalledTransport(),
                   directory: FileManager.default.temporaryDirectory.appendingPathComponent("praelude-app-tests-sync-\(UUID())"))
    }

    /// `SupabaseServices()`/`AuthManager(services:store:)` construct real SDK client objects but make
    /// no network call to do so; `AuthManager.state` starts from whatever `AuthClient.currentSession`
    /// reads locally, which is empty for a device that has never signed in — true for a fresh
    /// simulator/test process. No test in this file calls signUp/signIn/signOut/deleteAccount, so
    /// none of them ever reaches the network regardless.
    func testFreshAuthManagerStartsInGuestMode() {
        let auth = AuthManager(services: SupabaseServices(), store: store())
        XCTAssertEqual(auth.state, .guest)
    }

    func testGuestModeNeverEnqueuesOrTouchesTheTransport() async throws {
        let localStore = store()
        let piece = Piece(title: "Guest piece", pageCount: 1)
        try localStore.addPiece(piece)
        let auth = AuthManager(services: SupabaseServices(), store: localStore)
        XCTAssertEqual(auth.state, .guest)

        let coordinator = SyncCoordinator(engine: engine(), auth: auth, store: localStore)
        coordinator.pushPiece(piece)
        coordinator.pushProfile()
        XCTAssertEqual(coordinator.pendingCount, 0, "Nothing is queued while signed out.")
        await coordinator.syncAll() // must return immediately; NeverCalledTransport XCTFails if reached
    }

    /// Replicates the exact wiring `PraeludeApp.init` performs (`auth.onSignedOut = { ... }`) and
    /// fires it directly — the real `.signedOut` auth event itself is integration surface (needs a
    /// live session), but once fired, this hook's own effect is pure local state and belongs here.
    func testOnSignedOutHookClearsWhateverWasLeftQueued() throws {
        let localStore = store()
        let auth = AuthManager(services: SupabaseServices(), store: localStore)
        let syncEngine = engine()
        let coordinator = SyncCoordinator(engine: syncEngine, auth: auth, store: localStore)
        auth.onSignedOut = { [weak coordinator] in coordinator?.resetLocalAccountState() }

        // Something was left queued from just before the session ended (however it got there).
        try syncEngine.enqueueUpsert(table: "pieces", row: ["id": .string(UUID().uuidString)])
        XCTAssertEqual(coordinator.pendingCount, 1)

        auth.onSignedOut?()

        XCTAssertEqual(coordinator.pendingCount, 0, "The hook must drop a pending write from the account that just signed out.")
    }
}
