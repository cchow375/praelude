import CryptoKit
import Foundation

// MARK: - Social (spec §5) — pure, Foundation-only pieces
//
// `supabase/(C) Sync Protocol.md` is explicit that §5 (friendships, activity feed, notes, presence,
// studios, invites, reports, ...) has no Core-side mirror at all — it is a live, server-first
// feature set, not part of the offline-editable schema3 library `PracticeStore` owns. The real
// service layer therefore lives in `Services/Social/` (it needs the Supabase SDK), not here.
//
// What *does* belong in Core is the handful of genuinely pure, deterministic pieces this track
// needs that have zero SwiftUI/network dependency — the same reasoning `ProfileVisibility.isVisible`
// already used to mirror one piece of the backend's own logic client-side. Keeping them here means
// they run under the fast `swift test --package-path ios` loop instead of only a full simulator build.

// MARK: Activity feed / reaction / report vocabulary (spec §5a/§5c)
//
// Raw values are spelled out explicitly rather than left to rely on the Swift case name, matching
// exactly the plain-text `check (... in (...))` constraints in `20260926220006_social.sql` /
// `20260926220007_moderation_and_leaderboard.sql` (these columns are checked `text`, not a Postgres
// enum type, so — unlike `learning_state`/`instrument_family` — they were never subject to the
// snake_case-vs-camelCase bug corrected in that migration's preamble; they are snake_case on both
// sides on purpose, matching the spec's own event names).

public enum ActivityEventKind: String, Codable, CaseIterable, Sendable {
    case sessionFinished = "session_finished"
    case streakMilestone = "streak_milestone"
    case passagePerformanceReady = "passage_performance_ready"
    case newPiece = "new_piece"
    case performanceDateSet = "performance_date_set"
    case notePosted = "note_posted"
    case rankBadge = "rank_badge"
}

/// Music-flavored reactions (spec §5a), exactly `public.reactions.kind`'s check constraint.
public enum ReactionKind: String, Codable, CaseIterable, Sendable {
    case bravo, encore, applause, crescendo, fermata

    /// A short label for a reaction picker — no emoji anywhere (design system §3a).
    public var label: String {
        switch self {
        case .bravo: "Bravo"
        case .encore: "Encore"
        case .applause: "Applause"
        case .crescendo: "Crescendo"
        case .fermata: "Fermata"
        }
    }
}

/// What a reaction/comment can target — exactly `target_type`'s check constraint on `reactions`/`comments`.
public enum SocialTargetKind: String, Codable, Sendable {
    case activityEvent = "activity_event"
    case note
}

/// What a report can target — exactly `public.reports.target_type`'s check constraint.
public enum ReportTargetKind: String, Codable, CaseIterable, Sendable {
    case user, note, comment
    case activityEvent = "activity_event"
    case developerContact = "developer_contact"
}

public enum ContactHashKind: String, Codable, Sendable { case phone, email }

// MARK: Age gate (spec §5c "age gate at signup with stricter defaults for minors")

/// Matches `ProfileEditView`'s existing (untyped) `extras.ageBracket` raw strings exactly, so the
/// signup-time gate and the later profile editor agree on the same three values without either one
/// needing to change. `AccountView`'s signup flow is the one call site that needs `isMinor` — a
/// private, deterministic rule, not left to be re-derived ad hoc at each call site.
public enum AgeBracket: String, Codable, CaseIterable, Sendable {
    case under13, teen = "13-17", adult = "18plus"
    public var isMinor: Bool { self != .adult }
    public var label: String {
        switch self {
        case .under13: "Under 13"
        case .teen: "13–17"
        case .adult: "18+"
        }
    }
}

// MARK: Presence freshness (spec §5a "practicing now")

/// Mirrors `friend_presence()`'s own staleness rule (`supabase/(C) Backend.md`, "Presence: table +
/// Realtime, not table alone"): a row older than two minutes reads as "not currently practicing"
/// rather than stuck `true` forever after a force-quit skipped the final `set_presence(false)`. Kept
/// here so the client can apply the identical rule to a Realtime-delivered presence update (which
/// never passes through the server's own read path) without duplicating the threshold by hand at
/// each call site.
public enum PresenceFreshness {
    public static let staleAfter: TimeInterval = 120
    public static func isStale(updatedAt: Date, now: Date = Date()) -> Bool {
        now.timeIntervalSince(updatedAt) > staleAfter
    }
    public static func isCurrentlyPracticing(isPracticing: Bool, updatedAt: Date, now: Date = Date()) -> Bool {
        isPracticing && !isStale(updatedAt: updatedAt, now: now)
    }
}

// MARK: Invite links (spec §5b "invite links + QR")

/// Builds/parses `praelude://invite/<code>` — the one custom-URL-scheme deep link this track adds,
/// reusing the scheme `AuthManager`'s magic-link callback already registers (no paid Associated
/// Domains entitlement, per the project's hard constraints). A QR code is just this same URL string
/// rendered as an image (`QRCodeView` in `Views/Social/`) — no separate format of its own.
public enum InviteLink {
    public static let scheme = "praelude"
    public static let host = "invite"

    public static func url(code: String) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.path = "/" + code
        return components.url
    }

    /// `nil` unless `url` is exactly `praelude://invite/<non-empty-code>` — deliberately strict
    /// (exact scheme/host, one non-empty path component) so a malformed or foreign URL is never
    /// mistaken for an invite and silently ignored rather than misrouted.
    public static func code(from url: URL) -> String? {
        guard url.scheme?.lowercased() == scheme, url.host?.lowercased() == host else { return nil }
        let code = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return code.isEmpty ? nil : code
    }
}

// MARK: Contact hashing (spec §5b "opt-in contacts suggestions")

/// `discoverable_contact_hashes`/`uploaded_contact_hashes` (`supabase/(C) Backend.md`) do a plain
/// hash join: the raw phone/email never reaches the server, only a normalized SHA-256 hex digest.
/// Normalization must be deterministic and match on both the uploading and the discoverable side
/// (two different people hashing the same phone number must produce the same hash), so it lives here
/// as one pure function rather than being re-implemented at each call site.
public enum ContactHasher {
    /// Phone: strips everything but digits and a leading `+` (a light E.164-ish normalization — this
    /// app never validates a real E.164 number, it only needs two hashes of "the same number typed
    /// two different ways" to collide). Email: trimmed and lowercased. Empty input hashes to `nil`
    /// rather than a hash of the empty string, so an unfilled contact field is never uploaded as if
    /// it were meaningful.
    public static func hash(_ raw: String, kind: ContactHashKind) -> String? {
        let normalized: String
        switch kind {
        case .phone:
            normalized = "+" + raw.filter(\.isNumber)
        case .email:
            normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        }
        let bare = kind == .phone ? normalized.trimmingCharacters(in: CharacterSet(charactersIn: "+")) : normalized
        guard !bare.isEmpty else { return nil }
        let digest = SHA256.hash(data: Data(normalized.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
