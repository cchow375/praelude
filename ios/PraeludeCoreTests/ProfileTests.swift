import Foundation
import XCTest
@testable import PraeludeCore

final class ProfileTests: XCTestCase {

    // MARK: ProfileVisibility.isVisible — mirrors the backend's private-account clamp (see
    // supabase/(C) Backend.md, "Private-account clamp": a `.publicVisibility` field is only shown to
    // a non-friend when the account itself is not private).

    func testOwnerAlwaysSeesEveryTier() {
        for tier in ProfileVisibility.allCases {
            XCTAssertTrue(tier.isVisible(to: .owner, isPrivateAccount: false))
            XCTAssertTrue(tier.isVisible(to: .owner, isPrivateAccount: true))
        }
    }
    func testOnlyMeIsNeverVisibleToAnyoneButTheOwner() {
        XCTAssertFalse(ProfileVisibility.onlyMe.isVisible(to: .friend, isPrivateAccount: false))
        XCTAssertFalse(ProfileVisibility.onlyMe.isVisible(to: .everyoneElse, isPrivateAccount: false))
    }
    func testFriendsTierIsVisibleToAFriendButNeverToEveryoneElse() {
        XCTAssertTrue(ProfileVisibility.friends.isVisible(to: .friend, isPrivateAccount: false))
        XCTAssertFalse(ProfileVisibility.friends.isVisible(to: .everyoneElse, isPrivateAccount: false))
        // A private account does not further restrict an already-friends-only field.
        XCTAssertTrue(ProfileVisibility.friends.isVisible(to: .friend, isPrivateAccount: true))
    }
    func testPublicTierClampsToFriendsOnlyOnAPrivateAccount() {
        XCTAssertTrue(ProfileVisibility.publicVisibility.isVisible(to: .everyoneElse, isPrivateAccount: false),
                      "An ordinary account's public field is visible to anyone.")
        XCTAssertFalse(ProfileVisibility.publicVisibility.isVisible(to: .everyoneElse, isPrivateAccount: true),
                       "A private account clamps its own public-flagged fields down to friends-only.")
        XCTAssertTrue(ProfileVisibility.publicVisibility.isVisible(to: .friend, isPrivateAccount: true),
                      "The clamp only affects non-friends; a friend still sees a public field either way.")
    }

    // MARK: PracticeStore.piecesPerformanceReadyCount (§4c stat)

    @MainActor private func store() -> PracticeStore {
        PracticeStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("praelude-profile-tests-\(UUID())"))
    }
    @MainActor private func passage(pieceID: UUID, state: LearningState, archived: Bool = false, deleted: Bool = false) -> Passage {
        var passage = Passage(pieceID: pieceID, title: "Passage", page: 1)
        passage.learningState = state
        passage.archived = archived
        if deleted { passage.deletedAt = Date() }
        return passage
    }

    @MainActor func testPieceWithNoPassagesDoesNotCount() throws {
        let store = store()
        let piece = Piece(title: "Untouched", pageCount: 4)
        try store.addPiece(piece)
        XCTAssertEqual(store.piecesPerformanceReadyCount, 0)
    }
    @MainActor func testPieceCountsOnlyWhenEveryLivePassageIsPerformanceReady() throws {
        let store = store()
        let ready = Piece(title: "Ready", pageCount: 4)
        let partial = Piece(title: "Partial", pageCount: 4)
        try store.addPiece(ready); try store.addPiece(partial)
        try store.savePassage(passage(pieceID: ready.id, state: .performanceReady))
        try store.savePassage(passage(pieceID: ready.id, state: .performanceReady))
        try store.savePassage(passage(pieceID: partial.id, state: .performanceReady))
        try store.savePassage(passage(pieceID: partial.id, state: .review))
        XCTAssertEqual(store.piecesPerformanceReadyCount, 1)
    }
    @MainActor func testArchivedOrTombstonedPassagesAreIgnoredNotCountedAgainstReadiness() throws {
        let store = store()
        let piece = Piece(title: "Mostly ready", pageCount: 4)
        try store.addPiece(piece)
        try store.savePassage(passage(pieceID: piece.id, state: .performanceReady))
        // A learning-stage passage that's archived, or was deleted, must not drag the piece back
        // below "ready" — it is no longer a live obligation.
        try store.savePassage(passage(pieceID: piece.id, state: .learning, archived: true))
        try store.savePassage(passage(pieceID: piece.id, state: .new, deleted: true))
        XCTAssertEqual(store.piecesPerformanceReadyCount, 1)
    }
}
