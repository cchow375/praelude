import Foundation

/// Per-field profile visibility (§4c).
public enum ProfileVisibility: String, Codable, CaseIterable, Sendable {
    case publicVisibility = "public", friends, onlyMe
}

/// Who is looking at a profile, for local "preview as others" rendering (§4c) — deliberately just
/// three cases, not a friend graph: `.owner` always sees everything, `.friend`/`.everyoneElse` are
/// the only two perspectives a field's privacy tier can actually distinguish between.
public enum ProfileViewer: Sendable, CaseIterable { case owner, friend, everyoneElse }

extension ProfileVisibility {
    /// Mirrors the backend's own `_profile_field_visible`/`get_profile_card` rule (see
    /// `supabase/(C) Backend.md`, "Private-account clamp"): a field marked `.publicVisibility` is
    /// only actually shown to a non-friend when the account itself is not private — a private
    /// account clamps its own public-flagged fields down to friends-only in practice. Kept here,
    /// not just on the server, so `ProfileEditView`'s "preview as others" can render the same
    /// answer locally without a round trip.
    public func isVisible(to viewer: ProfileViewer, isPrivateAccount: Bool) -> Bool {
        switch viewer {
        case .owner: return true
        case .friend: return self != .onlyMe
        case .everyoneElse:
            switch self {
            case .onlyMe, .friends: return false
            case .publicVisibility: return !isPrivateAccount
            }
        }
    }
}

/// Defaults to Friends for every field except name/username/photo, which default to Public so a
/// person can be found and recognized before they choose to open up further.
public struct ProfileFieldPrivacy: Codable, Equatable, Sendable {
    public var name = ProfileVisibility.publicVisibility
    public var username = ProfileVisibility.publicVisibility
    public var photo = ProfileVisibility.publicVisibility
    public var bio = ProfileVisibility.friends
    public var instruments = ProfileVisibility.friends
    public var teacherOrSchool = ProfileVisibility.friends
    public var location = ProfileVisibility.friends
    public var currentlyWorkingOn = ProfileVisibility.friends
    public var upcomingPerformances = ProfileVisibility.friends
    public var stats = ProfileVisibility.friends
    public init() {}
}

/// The local profile cache (§4c/§5). Minimal by design — the backend/sync track owns the
/// authoritative copy, friend graph and moderation; this is what Core needs to render "your own
/// profile" offline and to carry sync-readiness (`ownerID`) before an account exists.
public struct Profile: Codable, Equatable, Sendable {
    /// The account this library belongs to. Stays `nil` through guest mode; set once when the
    /// player signs in or creates an account (a backend-track concern, not Core's).
    public var ownerID: UUID?
    public var displayName: String = ""
    public var username: String = ""
    public var photoRef: String?
    public var bio: String = ""
    public var teacherOrSchool: String = ""
    public var location: String = ""
    public var currentlyWorkingOnPieceIDs: [UUID] = []
    public var joinDate: Date = Date()
    public var privacy = ProfileFieldPrivacy()
    public var updatedAt: Date = Date()
    public init() {}
}
