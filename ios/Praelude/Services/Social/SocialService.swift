import Foundation
import Observation
import PostgREST
import PraeludeCore

/// The client for every spec §5 feature: friends, blocks, activity feed, notes, presence (fallback
/// read/write — live updates are `PresenceService`), studios, invites, contacts, leaderboard, reports.
///
/// None of this goes through `SyncEngine`/`SyncCoordinator` — `supabase/(C) Sync Protocol.md` §1 is
/// explicit that §5 is server-first and has no offline queue of its own, so every method here talks
/// straight to Postgres (RLS-gated reads/writes, or the named `SECURITY DEFINER` RPCs in
/// `supabase/(C) Backend.md` §5) and returns the freshest server answer, the same way
/// `AuthManager`'s own network-calling methods do. Every method: (1) is a no-op returning an empty/
/// `false`/`nil` result in guest mode — there is no local fallback for a live social feature, unlike
/// practice data, so "offline" here means "nothing to show" rather than "show stale data", except
/// where a caller explicitly passes previously-fetched rows through; (2) never throws — errors land
/// in `lastError` and a safe empty/false result, matching `AuthManager`'s own shape, so a feed
/// refresh failing never crashes a view or needs a `do/catch` at every call site.
///
/// RPC parameter struct names below are copied one-by-one from each function's actual signature in
/// `supabase/migrations/20260926220006_social.sql` / `..._moderation_and_leaderboard.sql` — several
/// share a `uuid` argument but *not* the same argument name (`block_user`/`get_profile_card` take
/// `p_target`, `unfriend`/`shared_repertoire` take `p_friend`, `send_friend_request` takes
/// `p_addressee`), and PostgREST matches Postgres function arguments by name, so a single reused
/// "generic target" struct would silently 404 ("could not find the function") for whichever RPCs
/// don't actually use that name.
@MainActor @Observable
public final class SocialService {
    private let services: SupabaseServices
    private let auth: AuthManager
    public private(set) var lastError: String?

    public init(services: SupabaseServices, auth: AuthManager) {
        self.services = services
        self.auth = auth
    }

    public var myUserID: UUID? { if case .signedIn(let id, _) = auth.state { return id }; return nil }

    /// Every closure is handed the caller's own id, resolved once at the guard (not re-read from
    /// `auth.state` again mid-flight) — several call sites need it to stamp `owner_id`/`created_by`
    /// on a direct table insert (see the "Direct-table insert bodies" note below: unlike the generic
    /// sync RPCs, a plain PostgREST insert has nothing forcing that column server-side, only RLS's
    /// `with check` verifying whatever the client already sent).
    private func run<T>(_ body: (UUID) async throws -> T) async -> T? {
        guard let me = myUserID else { return nil }
        do { let value = try await body(me); lastError = nil; return value }
        catch { lastError = Self.message(for: error); return nil }
    }
    /// For an RPC/insert that returns nothing usable — just whether it succeeded.
    @discardableResult
    private func runVoid(_ body: (UUID) async throws -> Void) async -> Bool {
        guard let me = myUserID else { return false }
        do { try await body(me); lastError = nil; return true }
        catch { lastError = Self.message(for: error); return false }
    }
    private static func message(for error: Error) -> String {
        if let postgrest = error as? PostgrestError { return postgrest.message }
        return error.localizedDescription
    }

    // MARK: Friends (§5a/§5b)

    public func searchProfiles(query: String) async -> [ProfileSearchResult] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        return await run { _ in
            try await services.postgrest().rpc("search_profiles", params: QueryParam(p_query: trimmed)).execute().value
        } ?? []
    }

    /// `.autoAccepted == true` means the other person had already sent a request the caller hadn't
    /// answered yet — `send_friend_request` auto-accepts that mutual case instead of leaving two
    /// pending rows pointed at each other (see `20260926220006_social.sql`).
    @discardableResult
    public func sendFriendRequest(to userID: UUID) async -> Bool {
        await run { _ in
            try await services.postgrest().rpc("send_friend_request", params: AddresseeParam(p_addressee: userID)).execute().value as SendFriendRequestResult
        } != nil
    }
    @discardableResult
    public func respondToFriendRequest(from requesterID: UUID, accept: Bool) async -> Bool {
        await run { _ in
            try await services.postgrest().rpc("respond_friend_request", params: RespondParams(p_requester: requesterID, p_accept: accept)).execute().value as RespondFriendRequestResult
        } != nil
    }
    @discardableResult
    public func unfriend(_ userID: UUID) async -> Bool {
        await runVoid { _ in try await services.postgrest().rpc("unfriend", params: FriendParam(p_friend: userID)).execute() }
    }

    public func friendCards() async -> [ProfileCard] {
        await run { _ in try await services.postgrest().rpc("friend_cards").execute().value } ?? []
    }
    public func profileCard(for userID: UUID) async -> ProfileCard? {
        await run { _ in try await services.postgrest().rpc("get_profile_card", params: TargetUserParam(p_target: userID)).execute().value }
    }

    /// Every pending request touching the caller, split by direction. A direct `friendships` read
    /// (RLS already scopes it to rows the caller is a party to), not an RPC — there is no privacy
    /// redaction to apply to your own pending requests the way a stranger's profile card needs.
    public func pendingFriendRequests() async -> (incoming: [FriendshipRow], outgoing: [FriendshipRow]) {
        let rows: [FriendshipRow] = await run { _ in
            try await services.postgrest().from("friendships").select().eq("status", value: "pending").execute().value
        } ?? []
        guard let me = myUserID else { return ([], []) }
        let sorted = rows.sorted { $0.createdAt > $1.createdAt }
        return (sorted.filter { $0.addresseeID == me }, sorted.filter { $0.requesterID == me })
    }

    // MARK: Blocks (§5c)

    @discardableResult
    public func blockUser(_ userID: UUID) async -> Bool {
        await runVoid { _ in try await services.postgrest().rpc("block_user", params: TargetUserParam(p_target: userID)).execute() }
    }
    @discardableResult
    public func unblockUser(_ userID: UUID) async -> Bool {
        await runVoid { _ in try await services.postgrest().rpc("unblock_user", params: TargetUserParam(p_target: userID)).execute() }
    }
    public func blockedUserIDs() async -> [UUID] {
        struct Row: Decodable { let blocked_id: UUID }
        let rows: [Row] = await run { _ in try await services.postgrest().from("blocks").select("blocked_id").execute().value } ?? []
        return rows.map(\.blocked_id)
    }

    // MARK: Shared repertoire (§5b)

    public func sharedRepertoire(with friendID: UUID) async -> [SharedRepertoireItem] {
        await run { _ in try await services.postgrest().rpc("shared_repertoire", params: FriendParam(p_friend: friendID)).execute().value } ?? []
    }

    // MARK: Activity feed (§5a)

    public func friendActivityFeed(since: Date = Date().addingTimeInterval(-30 * 86_400), limit: Int = 100) async -> [ActivityEvent] {
        await run { _ in
            try await services.postgrest().rpc("friend_activity_feed", params: FeedParams(p_since: since, p_limit: limit)).execute().value
        } ?? []
    }
    /// Fire-and-forget from the caller's point of view is `SocialHooks`' job, not this method's —
    /// this one still reports success/failure so `SocialHooks` can decide whether to log it.
    /// `pieceID`/`passageID` must already exist on the server under this same account (the
    /// `activity_events_ownership` trigger checks it) — a piece/passage created and shared in the
    /// same breath can lose this race if it hasn't synced yet; `SocialHooks` mitigates by nudging a
    /// sync pass first, and this call simply fails softly (into `lastError`) if it still loses it.
    @discardableResult
    public func postActivityEvent(kind: ActivityEventKind, pieceID: UUID? = nil, passageID: UUID? = nil, detail: String = "") async -> UUID? {
        await run { _ in
            try await services.postgrest().rpc("post_activity_event", params: PostEventParams(
                p_kind: kind.rawValue, p_piece_id: pieceID, p_passage_id: passageID, p_detail: detail
            )).execute().value
        }
    }
    public func reactions(onActivityEvent eventID: UUID) async -> [ReactionRow] {
        await run { _ in try await services.postgrest().rpc("activity_event_reactions", params: TargetEventParam(p_event_id: eventID)).execute().value } ?? []
    }
    public func comments(onActivityEvent eventID: UUID) async -> [CommentRow] {
        (await run { _ in try await services.postgrest().rpc("activity_event_comments", params: TargetEventParam(p_event_id: eventID)).execute().value } ?? [])
            .sorted { $0.createdAt < $1.createdAt }
    }
    @discardableResult
    public func react(targetType: SocialTargetKind, targetID: UUID, kind: ReactionKind) async -> Bool {
        await runVoid { me in
            try await services.postgrest().from("reactions").insert(ReactionInsert(
                owner_id: me, target_type: targetType.rawValue, target_id: targetID, kind: kind.rawValue
            )).execute()
        }
    }
    @discardableResult
    public func removeReaction(targetType: SocialTargetKind, targetID: UUID, kind: ReactionKind) async -> Bool {
        await runVoid { _ in
            try await services.postgrest().from("reactions")
                .delete()
                .eq("target_type", value: targetType.rawValue).eq("target_id", value: targetID.uuidString).eq("kind", value: kind.rawValue)
                .execute()
        }
    }
    @discardableResult
    public func addComment(targetType: SocialTargetKind, targetID: UUID, body: String) async -> Bool {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        return await runVoid { me in
            try await services.postgrest().from("comments").insert(CommentInsert(
                owner_id: me, target_type: targetType.rawValue, target_id: targetID, body: trimmed
            )).execute()
        }
    }

    // MARK: Notes (§5a)

    public func friendNotes() async -> [NoteRow] {
        (await run { _ in try await services.postgrest().rpc("friend_notes").execute().value } ?? [])
            .filter { !$0.isExpired() }
            .sorted { $0.createdAt > $1.createdAt }
    }
    @discardableResult
    public func postNote(text: String, pieceID: UUID? = nil, pieceTitle: String? = nil) async -> UUID? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        struct Inserted: Decodable { let id: UUID }
        let inserted: [Inserted]? = await run { me in
            try await services.postgrest().from("notes")
                .insert(NoteInsert(owner_id: me, text: trimmed, piece_id: pieceID, piece_title: pieceTitle))
                .select("id")
                .execute().value
        }
        return inserted?.first?.id
    }
    public func replies(toNote noteID: UUID) async -> [NoteReplyRow] {
        (await run { _ in
            try await services.postgrest().from("note_replies").select().eq("note_id", value: noteID.uuidString).execute().value
        } ?? []).sorted { $0.createdAt < $1.createdAt }
    }
    @discardableResult
    public func replyToNote(_ noteID: UUID, body: String) async -> Bool {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        return await runVoid { me in
            try await services.postgrest().from("note_replies").insert(NoteReplyInsert(note_id: noteID, owner_id: me, body: trimmed)).execute()
        }
    }

    // MARK: Presence fallback (§5a "practicing now" — live updates are `PresenceService`)

    public func setPresence(isPracticing: Bool, pieceID: UUID?) async {
        await runVoid { _ in try await services.postgrest().rpc("set_presence", params: PresenceParams(p_is_practicing: isPracticing, p_piece_id: pieceID)).execute() }
    }
    public func friendPresence() async -> [PresenceRow] {
        await run { _ in try await services.postgrest().rpc("friend_presence").execute().value } ?? []
    }

    // MARK: Studios / groups (§5b)

    @discardableResult
    public func createStudio(name: String) async -> UUID? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return await run { _ in try await services.postgrest().rpc("create_studio", params: StudioNameParam(p_name: trimmed)).execute().value }
    }
    public func myStudios() async -> [StudioRow] {
        await run { _ in try await services.postgrest().from("studios").select().execute().value } ?? []
    }
    public func studioMembers(_ studioID: UUID) async -> [StudioMemberRow] {
        await run { _ in try await services.postgrest().from("studio_members").select().eq("studio_id", value: studioID.uuidString).execute().value } ?? []
    }
    public func studioGoals(_ studioID: UUID) async -> [StudioGoalRow] {
        await run { _ in try await services.postgrest().from("studio_goals").select().eq("studio_id", value: studioID.uuidString).execute().value } ?? []
    }
    @discardableResult
    public func addStudioGoal(studioID: UUID, title: String, targetDate: Date?) async -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        return await runVoid { me in
            try await services.postgrest().from("studio_goals").insert(StudioGoalInsert(studio_id: studioID, title: trimmed, target_date: targetDate, created_by: me)).execute()
        }
    }
    @discardableResult
    public func addStudioMember(studioID: UUID, userID: UUID) async -> Bool {
        await runVoid { _ in try await services.postgrest().rpc("add_studio_member", params: StudioMemberParam(p_studio: studioID, p_member: userID)).execute() }
    }
    @discardableResult
    public func removeStudioMember(studioID: UUID, userID: UUID) async -> Bool {
        await runVoid { _ in try await services.postgrest().rpc("remove_studio_member", params: StudioMemberParam(p_studio: studioID, p_member: userID)).execute() }
    }

    // MARK: Invites (§5b)

    public func createInviteCode() async -> String? {
        await run { _ in try await services.postgrest().rpc("create_invite_code").execute().value }
    }
    /// The new friend's id on success — the caller (`SocialHooks`) decides what to show next.
    public func redeemInviteCode(_ code: String) async -> UUID? {
        await run { _ in (try await services.postgrest().rpc("redeem_invite_code", params: CodeParam(p_code: code)).execute().value as RedeemInviteResult).friendID }
    }

    // MARK: Contacts (§5b, opt-in)

    @discardableResult
    public func uploadContactHashes(_ hashes: [(hash: String, kind: ContactHashKind)]) async -> Bool {
        guard !hashes.isEmpty else { return true }
        return await runVoid { me in
            try await services.postgrest().from("uploaded_contact_hashes")
                .upsert(hashes.map { ContactHashInsert(owner_id: me, hash: $0.hash, hash_kind: $0.kind.rawValue) }, onConflict: "owner_id,hash")
                .execute()
        }
    }
    /// Opts the caller *in* to being discoverable by their own hashed contact info (phone/email they
    /// verified as their own, e.g. their signed-in email) — a separate, explicit action from
    /// uploading other people's contacts, matching the two-sided opt-in `supabase/(C) Backend.md`
    /// documents ("a user only appears as a suggestion once they've written a hash identifying
    /// themself").
    @discardableResult
    public func makeDiscoverable(hash: String, kind: ContactHashKind) async -> Bool {
        await runVoid { me in
            try await services.postgrest().from("discoverable_contact_hashes")
                .upsert(ContactHashInsert(owner_id: me, hash: hash, hash_kind: kind.rawValue), onConflict: "owner_id,hash")
                .execute()
        }
    }
    public func contactSuggestions() async -> [ProfileSearchResult] {
        await run { _ in try await services.postgrest().rpc("contact_suggestions").execute().value } ?? []
    }

    // MARK: Leaderboard (§5b)

    public func leaderboard(metric: LeaderboardMetric) async -> [LeaderboardRow] {
        await run { _ in try await services.postgrest().rpc("leaderboard_friends", params: MetricParam(p_metric: metric.rawValue)).execute().value } ?? []
    }

    // MARK: Reports (§5c) — also doubles as "contact the developer" (target .developerContact, nil id).

    @discardableResult
    public func submitReport(targetType: ReportTargetKind, targetID: UUID?, reason: String) async -> Bool {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        return await run { _ in
            try await services.postgrest().rpc("submit_report", params: ReportParams(p_target_type: targetType.rawValue, p_target_id: targetID, p_reason: trimmed)).execute().value as UUID
        } != nil
    }
}

// MARK: - RPC param shapes (mirrors `PostgRESTSyncTransport.swift`'s own small private structs —
// PostgREST needs the Postgres function's exact `p_...` argument names, not Swift-idiomatic ones;
// see the type doc comment above for why several near-identical shapes are NOT collapsed into one).

private struct QueryParam: Encodable { let p_query: String }
private struct AddresseeParam: Encodable { let p_addressee: UUID }
private struct FriendParam: Encodable { let p_friend: UUID }
private struct TargetUserParam: Encodable { let p_target: UUID }
private struct RespondParams: Encodable { let p_requester: UUID; let p_accept: Bool }
private struct FeedParams: Encodable { let p_since: Date; let p_limit: Int }
private struct PostEventParams: Encodable { let p_kind: String; let p_piece_id: UUID?; let p_passage_id: UUID?; let p_detail: String }
private struct TargetEventParam: Encodable { let p_event_id: UUID }
private struct PresenceParams: Encodable { let p_is_practicing: Bool; let p_piece_id: UUID? }
private struct StudioNameParam: Encodable { let p_name: String }
private struct StudioMemberParam: Encodable { let p_studio: UUID; let p_member: UUID }
private struct CodeParam: Encodable { let p_code: String }
private struct MetricParam: Encodable { let p_metric: String }
private struct ReportParams: Encodable { let p_target_type: String; let p_target_id: UUID?; let p_reason: String }

// MARK: - Direct-table insert bodies (column names, not RPC argument names). Unlike the generic sync
// RPCs (`sync_upsert` et al., which force `owner_id` server-side — see `SyncDTO.swift`'s header),
// these tables have no default on `owner_id`/`created_by` and no RPC wrapping the insert, so the
// client must supply it explicitly; RLS's `with check` only verifies it matches the caller, it does
// not fill it in.

private struct ReactionInsert: Encodable { let owner_id: UUID; let target_type: String; let target_id: UUID; let kind: String }
private struct CommentInsert: Encodable { let owner_id: UUID; let target_type: String; let target_id: UUID; let body: String }
private struct NoteInsert: Encodable { let owner_id: UUID; let text: String; let piece_id: UUID?; let piece_title: String? }
private struct NoteReplyInsert: Encodable { let note_id: UUID; let owner_id: UUID; let body: String }
private struct StudioGoalInsert: Encodable { let studio_id: UUID; let title: String; let target_date: Date?; let created_by: UUID }
private struct ContactHashInsert: Encodable { let owner_id: UUID; let hash: String; let hash_kind: String }
