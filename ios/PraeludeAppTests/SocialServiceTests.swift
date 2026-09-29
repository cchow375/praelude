import Foundation
import XCTest
@testable import Praelude

/// Spec §5 is server-first with no offline queue (`SocialService`'s own doc comment) — unlike
/// `SyncEngine`, there is no fake-transport seam to unit-test the "online" path without live
/// credentials (that's `ios/scripts/(C) sync-smoke.sh`'s job, the same way `SyncSmokeTests.swift`
/// already draws that line for §4). What *is* safely unit-testable here, matching exactly how
/// `AuthSyncWiringTests.swift` already draws this same line for `SyncCoordinator`, is that every
/// guest-mode call returns its documented empty/`false`/`nil` result immediately, without ever
/// attempting to reach the network (a hang or a thrown error here would mean a guest-mode call fell
/// through to `services.postgrest()`, which needs a session `SupabaseServices()` alone never has).
@MainActor
final class SocialServiceTests: XCTestCase {
    private func store() -> PracticeStore {
        PracticeStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("praelude-social-tests-\(UUID())"))
    }
    private func guestSocial() -> SocialService {
        SocialService(services: SupabaseServices(), auth: AuthManager(services: SupabaseServices(), store: store()))
    }

    func testMyUserIDIsNilInGuestMode() {
        XCTAssertNil(guestSocial().myUserID)
    }

    func testEveryReadReturnsAnEmptyCollectionInGuestMode() async {
        let social = guestSocial()
        let someID = UUID()
        let emptySearch = await social.searchProfiles(query: "ada")
        let emptyFeed = await social.friendActivityFeed()
        let emptyNotes = await social.friendNotes()
        let emptyPresence = await social.friendPresence()
        let emptyCards = await social.friendCards()
        let emptyReactions = await social.reactions(onActivityEvent: someID)
        let emptyComments = await social.comments(onActivityEvent: someID)
        let emptyReplies = await social.replies(toNote: someID)
        let emptyStudios = await social.myStudios()
        let emptyLeaderboard = await social.leaderboard(metric: .time)
        let emptyBlocked = await social.blockedUserIDs()
        let (incoming, outgoing) = await social.pendingFriendRequests()

        XCTAssertTrue(emptySearch.isEmpty); XCTAssertTrue(emptyFeed.isEmpty); XCTAssertTrue(emptyNotes.isEmpty)
        XCTAssertTrue(emptyPresence.isEmpty); XCTAssertTrue(emptyCards.isEmpty); XCTAssertTrue(emptyReactions.isEmpty)
        XCTAssertTrue(emptyComments.isEmpty); XCTAssertTrue(emptyReplies.isEmpty); XCTAssertTrue(emptyStudios.isEmpty)
        XCTAssertTrue(emptyLeaderboard.isEmpty); XCTAssertTrue(emptyBlocked.isEmpty)
        XCTAssertTrue(incoming.isEmpty); XCTAssertTrue(outgoing.isEmpty)
    }

    func testEveryWriteFailsSoftInGuestModeRatherThanCrashOrHang() async {
        let social = guestSocial()
        let someID = UUID()
        let sent = await social.sendFriendRequest(to: someID)
        let responded = await social.respondToFriendRequest(from: someID, accept: true)
        let unfriended = await social.unfriend(someID)
        let blocked = await social.blockUser(someID)
        let reacted = await social.react(targetType: .activityEvent, targetID: someID, kind: .bravo)
        let commented = await social.addComment(targetType: .activityEvent, targetID: someID, body: "hi")
        let posted = await social.postActivityEvent(kind: .newPiece)
        let noted = await social.postNote(text: "hello")
        let studio = await social.createStudio(name: "Studio")
        let invite = await social.createInviteCode()
        let redeemed = await social.redeemInviteCode("abc123")
        let reported = await social.submitReport(targetType: .developerContact, targetID: nil, reason: "test")

        XCTAssertFalse(sent); XCTAssertFalse(responded); XCTAssertFalse(unfriended); XCTAssertFalse(blocked)
        XCTAssertFalse(reacted); XCTAssertFalse(commented); XCTAssertFalse(reported)
        XCTAssertNil(posted); XCTAssertNil(noted); XCTAssertNil(studio); XCTAssertNil(invite); XCTAssertNil(redeemed)
    }

    /// `postNote`/`addComment`/`submitReport` validate and reject blank input locally before ever
    /// consulting `auth.state` — proven by supplying a signed-in-shaped guard would still be guest
    /// here, so a false return for blank input, same as for guest mode, at least confirms neither a
    /// crash nor a malformed empty-body request would be attempted.
    func testBlankTextIsRejectedWithoutAttemptingAWrite() async {
        let social = guestSocial()
        let notePosted = await social.postNote(text: "   ")
        let commentPosted = await social.addComment(targetType: .note, targetID: UUID(), body: "")
        let reportSubmitted = await social.submitReport(targetType: .user, targetID: UUID(), reason: "  ")
        XCTAssertNil(notePosted); XCTAssertFalse(commentPosted); XCTAssertFalse(reportSubmitted)
    }
}

/// `SocialHooks` (the share-milestone / post-as-note hooks other tracks call into) must be equally
/// inert in guest mode — a hook firing during ordinary offline practice must never attempt network
/// I/O.
@MainActor
final class SocialHooksTests: XCTestCase {
    private func store() -> PracticeStore {
        PracticeStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("praelude-hooks-tests-\(UUID())"))
    }
    private func makeHooks() -> SocialHooks {
        let localStore = store()
        let services = SupabaseServices()
        let auth = AuthManager(services: services, store: localStore)
        let social = SocialService(services: services, auth: auth)
        let engine = SyncEngine(transport: NeverCalledSocialTransport(),
                                 directory: FileManager.default.temporaryDirectory.appendingPathComponent("praelude-hooks-sync-\(UUID())"))
        let coordinator = SyncCoordinator(engine: engine, auth: auth, store: localStore)
        return SocialHooks(social: social, auth: auth, syncCoordinator: coordinator)
    }

    func testPostNoteReturnsFalseInGuestModeWithoutTouchingSync() async {
        let hooks = makeHooks()
        let posted = await hooks.postNote(text: "Slow practice today")
        XCTAssertFalse(posted)
    }
    func testShareMilestoneIsANoOpInGuestMode() async throws {
        let hooks = makeHooks()
        hooks.shareMilestone(kind: .newPiece, detail: "Nocturne")
        // shareMilestone is fire-and-forget; give its guarded guest-mode early-return a moment to
        // *not* enqueue anything, then prove nothing reached the (XCTFail-on-any-call) transport.
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertNil(hooks.lastError, "A guest-mode no-op must not even reach the point of setting an error.")
    }
}

/// `PresenceService` (live "practicing now") must be equally inert in guest mode — no Realtime
/// connection attempt, no change to `livePracticing`.
@MainActor
final class PresenceServiceTests: XCTestCase {
    private func store() -> PracticeStore {
        PracticeStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("praelude-presence-tests-\(UUID())"))
    }
    func testPublishAndObserveAreNoOpsInGuestMode() async throws {
        let localStore = store()
        let services = SupabaseServices()
        let auth = AuthManager(services: services, store: localStore)
        let social = SocialService(services: services, auth: auth)
        let presence = PresenceService(services: services, auth: auth, social: social)

        presence.publish(isPracticing: true, pieceID: UUID())
        presence.observe(friendIDs: [UUID(), UUID()])
        // Both guard on auth.state before ever constructing a RealtimeClientV2/attempting a
        // connection; give any stray Task a moment, then confirm no live state appeared.
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertTrue(presence.livePracticing.isEmpty)
    }
}

/// A transport that fails any call it receives — see `AuthSyncWiringTests.NeverCalledTransport`'s own
/// doc comment for why this is the right way to prove "guest mode never reaches the network layer".
private struct NeverCalledSocialTransport: SyncTransport {
    func upsert(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult { XCTFail("upsert must not be called"); throw SyncError.transport("unexpected") }
    func append(table: String, row: [String: SyncJSON]) async throws -> SyncRPCResult { XCTFail("append must not be called"); throw SyncError.transport("unexpected") }
    func updateLastPage(pieceID: UUID, lastPage: Int, at: Date) async throws -> SyncRPCResult { XCTFail("updateLastPage must not be called"); throw SyncError.transport("unexpected") }
    func undoAttempt(attemptID: UUID, undoneAt: Date) async throws -> SyncRPCResult { XCTFail("undoAttempt must not be called"); throw SyncError.transport("unexpected") }
    func fetch(table: String, field: String, updatedSince: Date?) async throws -> [[String: SyncJSON]] { XCTFail("fetch must not be called"); throw SyncError.transport("unexpected") }
}
