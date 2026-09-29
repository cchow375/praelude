import Foundation
import XCTest
@testable import Praelude

/// `supabase/(C) Sync Protocol.md` §3's central warning — a field whose `CodingKeys` doesn't match
/// its actual column/jsonb-key spelling doesn't fail to compile, it just quietly never decodes — is
/// exactly as true for these hand-written §5 DTOs as it is for `SyncDTO.swift`'s. Each sample string
/// below is copied key-for-key from the matching `jsonb_build_object(...)` call in
/// `supabase/migrations/20260926220006_social.sql` / `..._moderation_and_leaderboard.sql`, not
/// invented, so a `CodingKeys` typo here fails a test instead of only surfacing against the live
/// hosted project (which this test suite has no credentials for — see `SyncSmokeTests.swift`'s own
/// header for why that's a separate, opt-in, credentialed check).
final class SocialModelsDecodingTests: XCTestCase {
    /// Matches how `PostgrestClient.Configuration.jsonDecoder` actually decodes (verified by reading
    /// `Helpers/Codable.swift`'s `JSONDecoder.supabase()`): no key-conversion strategy at all (exact
    /// key matching — the whole reason every DTO here hand-writes `CodingKeys`) and flexible
    /// timestamp parsing. Every sample date below is plain ISO 8601 with an explicit offset, which
    /// `.iso8601` parses identically to that flexible parser.
    private static let decoder: JSONDecoder = { let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d }()
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try Self.decoder.decode(T.self, from: Data(json.utf8))
    }

    // MARK: ProfileCard (get_profile_card / friend_cards) — every field but id/join_date/is_friend
    // is conditionally present; both shapes below are real (a fully-open friend vs. a locked-down one).

    func testProfileCardDecodesEveryFieldWhenAllArePrivacyVisible() throws {
        let json = """
        {"id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d","join_date":"2026-01-15T00:00:00Z","is_friend":true,
         "display_name":"Ada Lovelace","username":"ada","photo_path":"9b1.../avatar.jpg","bio":"Cellist",
         "teacher_or_school":"Royal Conservatory","location":"London",
         "currently_working_on_piece_ids":["3fa85f64-5717-4562-b3fc-2c963f66afa6"],
         "upcoming_performances":[{"title":"Recital","date":"2026-11-01T19:00:00Z","location":"Hall A"}],
         "stats":{"streak_days":12,"streak_freezes_available":1,"rank":"Silver","division":2,
           "total_practice_seconds":3600.0,"pieces_performance_ready":3,
           "badges":[{"key":"thirty_days_on_time","earned_at":"2026-08-01T00:00:00Z"}]},
         "instruments":[{"id":"3fa85f64-5717-4562-b3fc-2c963f66afa6","family":"strings","name":"Cello",
           "level":"advanced","transposition_semitones":null,"transposition_label":null,"is_primary":true,
           "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","deleted_at":null}]}
        """
        let card = try decode(ProfileCard.self, json)
        XCTAssertEqual(card.id.uuidString.lowercased(), "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d")
        XCTAssertTrue(card.isFriend)
        XCTAssertEqual(card.displayName, "Ada Lovelace")
        XCTAssertEqual(card.username, "ada")
        XCTAssertEqual(card.photoPath, "9b1.../avatar.jpg")
        XCTAssertEqual(card.bio, "Cellist")
        XCTAssertEqual(card.teacherOrSchool, "Royal Conservatory")
        XCTAssertEqual(card.location, "London")
        XCTAssertEqual(card.currentlyWorkingOnPieceIDs?.count, 1)
        XCTAssertEqual(card.upcomingPerformances?.first?.title, "Recital")
        XCTAssertEqual(card.stats?.streakDays, 12)
        XCTAssertEqual(card.stats?.rank, "Silver")
        XCTAssertEqual(card.stats?.totalPracticeSeconds, 3600.0)
        XCTAssertEqual(card.stats?.badges.first?.key, "thirty_days_on_time")
        XCTAssertEqual(card.instruments?.first?.coreValue?.name, "Cello")
        XCTAssertEqual(card.displayNameOrUsernameOrFallback, "Ada Lovelace")
    }

    func testProfileCardDecodesWithEveryOptionalFieldAbsent() throws {
        // The shape get_profile_card actually returns for a stranger whose every field is privacy-
        // hidden: only id/join_date/is_friend ever appear unconditionally.
        let json = #"{"id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d","join_date":"2026-01-15T00:00:00Z","is_friend":false}"#
        let card = try decode(ProfileCard.self, json)
        XCTAssertFalse(card.isFriend)
        XCTAssertNil(card.displayName)
        XCTAssertNil(card.username)
        XCTAssertNil(card.stats)
        XCTAssertNil(card.instruments)
        XCTAssertEqual(card.displayNameOrUsernameOrFallback, "Praelude musician", "Falls back gracefully rather than a blank row.")
    }

    func testProfileSearchResultDecodes() throws {
        // search_profiles / contact_suggestions shape.
        let json = #"{"id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d","username":"ada","display_name":"Ada Lovelace"}"#
        let result = try decode(ProfileSearchResult.self, json)
        XCTAssertEqual(result.username, "ada")
        XCTAssertEqual(result.displayName, "Ada Lovelace")
    }

    // MARK: Activity feed

    func testActivityEventDecodesAndMapsToAKnownKind() throws {
        let json = """
        {"id":"3fa85f64-5717-4562-b3fc-2c963f66afa6","owner_id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
         "kind":"passage_performance_ready","piece_id":null,"passage_id":"3fa85f64-5717-4562-b3fc-2c963f66afa6",
         "detail":"Chopin Nocturne","created_at":"2026-09-20T08:30:00Z"}
        """
        let event = try decode(ActivityEvent.self, json)
        XCTAssertEqual(event.eventKind, .passagePerformanceReady)
        XCTAssertEqual(event.detail, "Chopin Nocturne")
        XCTAssertNil(event.pieceID)
        XCTAssertNotNil(event.passageID)
    }
    func testActivityEventWithAnUnknownKindStillDecodesButEventKindIsNil() throws {
        // Forward compatibility: a future server-added kind this build doesn't know about yet must
        // not crash decoding the whole feed, only fail to classify that one row.
        let json = """
        {"id":"3fa85f64-5717-4562-b3fc-2c963f66afa6","owner_id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
         "kind":"some_future_kind","piece_id":null,"passage_id":null,"detail":"","created_at":"2026-09-20T08:30:00Z"}
        """
        let event = try decode(ActivityEvent.self, json)
        XCTAssertNil(event.eventKind)
    }
    func testReactionRowDecodes() throws {
        let json = #"{"owner_id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d","kind":"bravo","created_at":"2026-09-20T08:30:00Z"}"#
        let row = try decode(ReactionRow.self, json)
        XCTAssertEqual(row.kind, "bravo")
    }
    func testCommentRowDecodes() throws {
        let json = """
        {"id":"3fa85f64-5717-4562-b3fc-2c963f66afa6","owner_id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
         "body":"Sounded great!","created_at":"2026-09-20T08:30:00Z"}
        """
        let row = try decode(CommentRow.self, json)
        XCTAssertEqual(row.body, "Sounded great!")
    }

    // MARK: Notes

    func testNoteRowDecodesAndExpiryIsRelativeToCreatedAt() throws {
        let json = """
        {"id":"3fa85f64-5717-4562-b3fc-2c963f66afa6","owner_id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
         "text":"Slow practice today","piece_title":"Chopin Nocturne","created_at":"2026-09-20T08:30:00Z"}
        """
        let note = try decode(NoteRow.self, json)
        XCTAssertEqual(note.text, "Slow practice today")
        XCTAssertEqual(note.pieceTitle, "Chopin Nocturne")
        XCTAssertFalse(note.isExpired(now: note.createdAt.addingTimeInterval(3600)))
        XCTAssertTrue(note.isExpired(now: note.createdAt.addingTimeInterval(25 * 3600)))
    }
    func testNoteReplyRowDecodes() throws {
        let json = """
        {"id":"3fa85f64-5717-4562-b3fc-2c963f66afa6","note_id":"3fa85f64-5717-4562-b3fc-2c963f66afa6",
         "owner_id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d","body":"Nice!","created_at":"2026-09-20T08:30:00Z"}
        """
        let reply = try decode(NoteReplyRow.self, json)
        XCTAssertEqual(reply.body, "Nice!")
    }

    // MARK: Presence

    func testPresenceRowDecodesAndFreshnessMatchesCoreLogic() throws {
        let recent = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-30))
        let json = #"{"owner_id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d","is_practicing":true,"piece_id":null,"updated_at":"\#(recent)"}"#
        let row = try decode(PresenceRow.self, json)
        XCTAssertTrue(row.isCurrentlyPracticing)
    }
    func testStalePresenceRowIsNotCurrentlyPracticing() throws {
        let stale = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-999))
        let json = #"{"owner_id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d","is_practicing":true,"piece_id":null,"updated_at":"\#(stale)"}"#
        let row = try decode(PresenceRow.self, json)
        XCTAssertFalse(row.isCurrentlyPracticing)
    }

    // MARK: Friendships / studios / leaderboard

    func testFriendshipRowDecodes() throws {
        let json = """
        {"requester_id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d","addressee_id":"3fa85f64-5717-4562-b3fc-2c963f66afa6",
         "status":"pending","created_at":"2026-09-20T08:30:00Z","updated_at":"2026-09-20T08:30:00Z","responded_at":null}
        """
        let row = try decode(FriendshipRow.self, json)
        XCTAssertEqual(row.status, FriendshipStatus.pending.rawValue)
        XCTAssertNil(row.respondedAt)
    }
    func testStudioGoalRowDecodesADateOnlyColumn() throws {
        // studio_goals.target_date is a plain SQL `date`, not timestamptz — still just "YYYY-MM-DD"
        // over the wire for a `date` column with no time component; ISO8601DateFormatter (used at
        // the call site, not here) is the one that needs to be lenient, this only proves the type
        // round-trips once *a* valid ISO8601 string with a time component is present, since that's
        // what date-only columns cast up to when the client itself writes a full Date via
        // JSONEncoder.supabase() (see SocialService.addStudioGoal / Sync Protocol §3).
        let json = """
        {"id":"3fa85f64-5717-4562-b3fc-2c963f66afa6","studio_id":"3fa85f64-5717-4562-b3fc-2c963f66afa6",
         "title":"All 12 keys this month","target_date":"2026-10-31T00:00:00Z",
         "created_by":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"}
        """
        let goal = try decode(StudioGoalRow.self, json)
        XCTAssertEqual(goal.title, "All 12 keys this month")
        XCTAssertNotNil(goal.targetDate)
    }
    func testLeaderboardRowDecodes() throws {
        let json = """
        {"owner_id":"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d","username":"ada","display_name":"Ada Lovelace",
         "total_seconds":5400,"practice_days":4,"reviews_done":9,"is_you":true}
        """
        let row = try decode(LeaderboardRow.self, json)
        XCTAssertEqual(row.totalSeconds, 5400)
        XCTAssertEqual(row.practiceDays, 4)
        XCTAssertTrue(row.isYou)
    }
    func testSharedRepertoireItemDecodes() throws {
        let json = #"{"title":"Nocturne in E-flat","composer":"Chopin"}"#
        let item = try decode(SharedRepertoireItem.self, json)
        XCTAssertEqual(item.composer, "Chopin")
    }
}
