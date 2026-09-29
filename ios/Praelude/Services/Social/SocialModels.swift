import Foundation
import PraeludeCore

// MARK: - Social (spec §5) wire-format DTOs
//
// `supabase/(C) Sync Protocol.md` §3 is explicit that an automatic camelCase<->snake_case
// conversion strategy is unsafe (it corrupts a pluralized acronym) and that every type crossing this
// boundary needs an explicit `CodingKeys` spelling out each column/jsonb-key name by hand. That rule
// applies here exactly as it does to `SyncDTO.swift` — these structs decode the jsonb every §5 RPC
// in `supabase/migrations/20260926220006_social.sql` / `20260926220007_moderation_and_leaderboard.sql`
// actually builds with `jsonb_build_object`, so every key below is copied from that SQL, not guessed.
//
// None of these are Core types: §5 has no Core-side mirror (Profile.swift's own comment says so) —
// this is a live, server-first read/write surface, not part of the offline-editable schema3 library.
// `PostgrestClient`'s default decoder (`JSONDecoder.supabase()`) already parses Postgres's timestamp
// format into `Date` and never applies a key-conversion strategy, so plain `Date` properties plus
// explicit `CodingKeys` are all that's needed — no custom decoder wiring here.

// MARK: Profiles / friends (§4c/§5a/§5b)

/// The redacted cross-user projection `get_profile_card(uuid)` and `friend_cards()` both return.
/// Every field but `id`/`joinDate`/`isFriend` is privacy-gated server-side and simply absent from the
/// jsonb when not visible — decoded as `nil` here (Swift's synthesized `Decodable` for an `Optional`
/// property already tolerates a fully-missing key, the same tolerance `ProfileBackendFields`-style
/// DTOs rely on elsewhere in this app). Never used for the caller's own profile — `Core.Profile` /
/// `ProfileEditView` already own that locally; this type is only ever "someone else's card".
public struct ProfileCard: Decodable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var joinDate: Date
    public var isFriend: Bool
    public var displayName: String?
    public var username: String?
    public var photoPath: String?
    public var bio: String?
    public var teacherOrSchool: String?
    public var location: String?
    public var currentlyWorkingOnPieceIDs: [UUID]?
    public var upcomingPerformances: [BackendPerformance]?
    public var stats: ProfileCardStats?
    public var instruments: [InstrumentSyncRow]?

    enum CodingKeys: String, CodingKey {
        case id, bio, location, stats, instruments, username
        case joinDate = "join_date"
        case isFriend = "is_friend"
        case displayName = "display_name"
        case photoPath = "photo_path"
        case teacherOrSchool = "teacher_or_school"
        case currentlyWorkingOnPieceIDs = "currently_working_on_piece_ids"
        case upcomingPerformances = "upcoming_performances"
    }

    /// A friend card's headline text — the best name this viewer is allowed to see, falling back
    /// gracefully rather than showing a blank row when a field is privacy-hidden.
    public var displayNameOrUsernameOrFallback: String {
        if let displayName, !displayName.isEmpty { return displayName }
        if let username, !username.isEmpty { return "@\(username)" }
        return "Praelude musician"
    }
}

public struct ProfileCardStats: Decodable, Equatable, Sendable {
    public var streakDays: Int
    public var streakFreezesAvailable: Int
    public var rank: String
    public var division: Int
    public var totalPracticeSeconds: Double
    public var piecesPerformanceReady: Int
    public var badges: [BadgeSummary]

    enum CodingKeys: String, CodingKey {
        case rank, division, badges
        case streakDays = "streak_days"
        case streakFreezesAvailable = "streak_freezes_available"
        case totalPracticeSeconds = "total_practice_seconds"
        case piecesPerformanceReady = "pieces_performance_ready"
    }
}

public struct BadgeSummary: Decodable, Equatable, Sendable {
    public var key: String
    public var earnedAt: Date
    enum CodingKeys: String, CodingKey { case key; case earnedAt = "earned_at" }
}

/// `search_profiles(text)` / `contact_suggestions()` — both return the same minimal shape.
public struct ProfileSearchResult: Decodable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var username: String
    public var displayName: String?
    enum CodingKeys: String, CodingKey { case id, username; case displayName = "display_name" }
}

/// A direct `friendships` row (own rows only — RLS). `status` is deliberately a raw `String`, not an
/// enum with a fixed `CaseIterable` set, matching how this codebase already treats server-owned enum
/// columns it doesn't control the vocabulary of elsewhere (e.g. `Instrument.level`); the three values
/// this app currently acts on are exposed via `FriendshipStatus`.
public struct FriendshipRow: Decodable, Equatable, Sendable {
    public var requesterID: UUID
    public var addresseeID: UUID
    public var status: String
    public var createdAt: Date
    public var updatedAt: Date
    public var respondedAt: Date?
    enum CodingKeys: String, CodingKey {
        case status
        case requesterID = "requester_id"
        case addresseeID = "addressee_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case respondedAt = "responded_at"
    }
}
public enum FriendshipStatus: String { case pending, accepted, declined }

struct SendFriendRequestResult: Decodable { let status: String; let autoAccepted: Bool
    enum CodingKeys: String, CodingKey { case status; case autoAccepted = "auto_accepted" } }
struct RespondFriendRequestResult: Decodable { let status: String }

/// `shared_repertoire(uuid)` — matched, not owned; no `id` of its own.
public struct SharedRepertoireItem: Decodable, Equatable, Sendable, Identifiable {
    public var title: String
    public var composer: String
    public var id: String { title + "—" + composer }
}

// MARK: Activity feed (§5a)

public struct ActivityEvent: Decodable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var ownerID: UUID
    public var kind: String
    public var pieceID: UUID?
    public var passageID: UUID?
    public var detail: String
    public var createdAt: Date
    enum CodingKeys: String, CodingKey {
        case id, kind, detail
        case ownerID = "owner_id"
        case pieceID = "piece_id"
        case passageID = "passage_id"
        case createdAt = "created_at"
    }
    public var eventKind: ActivityEventKind? { ActivityEventKind(rawValue: kind) }
}

public struct ReactionRow: Decodable, Equatable, Sendable {
    public var ownerID: UUID
    public var kind: String
    public var createdAt: Date
    enum CodingKeys: String, CodingKey { case kind; case ownerID = "owner_id"; case createdAt = "created_at" }
}

public struct CommentRow: Decodable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var ownerID: UUID
    public var body: String
    public var createdAt: Date
    enum CodingKeys: String, CodingKey { case id, body; case ownerID = "owner_id"; case createdAt = "created_at" }
}

// MARK: Notes (§5a) — Instagram-Notes style, 24h, optional piece, private replies.

public struct NoteRow: Decodable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var ownerID: UUID
    public var text: String
    public var pieceTitle: String?
    public var createdAt: Date
    enum CodingKeys: String, CodingKey {
        case id, text
        case ownerID = "owner_id"
        case pieceTitle = "piece_title"
        case createdAt = "created_at"
    }
    /// Notes expire visually at 24h even between polls; the server already filters this on every
    /// read, but a client that fetched a few seconds before the boundary should not keep showing a
    /// now-expired note until the next refresh.
    public func isExpired(now: Date = Date()) -> Bool { now.timeIntervalSince(createdAt) > 24 * 3600 }
}

public struct NoteReplyRow: Decodable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var noteID: UUID
    public var ownerID: UUID
    public var body: String
    public var createdAt: Date
    enum CodingKeys: String, CodingKey {
        case id, body
        case noteID = "note_id"
        case ownerID = "owner_id"
        case createdAt = "created_at"
    }
}

// MARK: Presence (§5a "practicing now")

public struct PresenceRow: Decodable, Equatable, Sendable {
    public var ownerID: UUID
    public var isPracticing: Bool
    public var pieceID: UUID?
    public var updatedAt: Date
    enum CodingKeys: String, CodingKey {
        case ownerID = "owner_id"
        case isPracticing = "is_practicing"
        case pieceID = "piece_id"
        case updatedAt = "updated_at"
    }
    public var isCurrentlyPracticing: Bool { PresenceFreshness.isCurrentlyPracticing(isPracticing: isPracticing, updatedAt: updatedAt) }
}

/// The state this device tracks on its own Realtime presence channel (`PresenceService`) — a small
/// Codable payload, not the whole `PresenceRow` shape (no `owner_id`/`updated_at`: the channel/
/// presence-key already identify the owner, and Realtime stamps its own timing).
struct LivePresenceState: Codable, Equatable { var isPracticing: Bool; var pieceID: UUID? }

// MARK: Studios / groups (§5b)

public struct StudioRow: Decodable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var createdBy: UUID?
    public var createdAt: Date
    enum CodingKeys: String, CodingKey { case id, name; case createdBy = "created_by"; case createdAt = "created_at" }
}
public struct StudioMemberRow: Decodable, Equatable, Sendable {
    public var studioID: UUID
    public var memberID: UUID
    public var role: String
    public var joinedAt: Date
    enum CodingKeys: String, CodingKey {
        case role
        case studioID = "studio_id"
        case memberID = "member_id"
        case joinedAt = "joined_at"
    }
}
public struct StudioGoalRow: Decodable, Identifiable, Equatable, Sendable {
    public var id: UUID
    public var studioID: UUID
    public var title: String
    public var targetDate: Date?
    public var createdBy: UUID?
    enum CodingKeys: String, CodingKey {
        case id, title
        case studioID = "studio_id"
        case targetDate = "target_date"
        case createdBy = "created_by"
    }
}

// MARK: Invites (§5b)

struct RedeemInviteResult: Decodable { let friendID: UUID
    enum CodingKeys: String, CodingKey { case friendID = "friend_id" } }

// MARK: Leaderboard (§5b)

public enum LeaderboardMetric: String, CaseIterable, Sendable {
    case time, days, reviews
    public var label: String {
        switch self { case .time: "Time"; case .days: "Days"; case .reviews: "Reviews" }
    }
}

public struct LeaderboardRow: Decodable, Identifiable, Equatable, Sendable {
    public var ownerID: UUID
    public var username: String?
    public var displayName: String?
    public var totalSeconds: Double
    public var practiceDays: Int
    public var reviewsDone: Int
    public var isYou: Bool
    public var id: UUID { ownerID }
    enum CodingKeys: String, CodingKey {
        case username
        case ownerID = "owner_id"
        case displayName = "display_name"
        case totalSeconds = "total_seconds"
        case practiceDays = "practice_days"
        case reviewsDone = "reviews_done"
        case isYou = "is_you"
    }
}
