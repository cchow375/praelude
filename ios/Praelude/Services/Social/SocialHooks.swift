import Foundation
import Observation
import PraeludeCore

/// The two integration points spec §5a asks other feature tracks to fire into: sharing a milestone
/// to the activity feed (session finished, streak milestone, passage performance-ready, new piece,
/// performance date set, rank/badge — the feed kinds `ActivityEventKind` lists), and posting a Note.
/// Nothing on `build/client` already defined this protocol (searched for `SocialHook`/`shareMilestone`/
/// `postAsNote`/any call site of `post_activity_event` — none existed), so this track defines it here,
/// small and self-contained, for whichever future track wires up rules/rewards/notebook to call it.
///
/// Every method is fire-and-forget from the caller's perspective — matching `SyncCoordinator.pushX`'s
/// own shape (a plain synchronous method that enqueues a background `Task`) so a hook can be called
/// from an ordinary synchronous `perform { ... }` action closure (see `ScoreWorkspace.swift`) without
/// making that closure `async`. A failed share is never surfaced to the person practicing — missing
/// one feed post is not the kind of failure "never lose user data" is about, unlike the practice
/// record itself, which is already durably saved before this is ever called.
@MainActor @Observable
public final class SocialHooks {
    private let social: SocialService
    private let auth: AuthManager
    private let syncCoordinator: SyncCoordinator

    public init(social: SocialService, auth: AuthManager, syncCoordinator: SyncCoordinator) {
        self.social = social
        self.auth = auth
        self.syncCoordinator = syncCoordinator
    }

    /// Posts one activity-feed event (spec §5a). No-ops silently in guest mode — there is no feed to
    /// post to before an account exists. When `pieceID`/`passageID` is given, nudges one sync pass
    /// first: `post_activity_event`'s own ownership trigger requires that record to already exist
    /// server-side, and a piece/passage created moments ago may not have reached the server yet
    /// (`SyncCoordinator`'s pushes are themselves fire-and-forget). This does not guarantee the row
    /// has landed — offline, it still won't have — it only closes the common same-session race; a
    /// loss beyond that fails soft, same as always.
    public func shareMilestone(kind: ActivityEventKind, pieceID: UUID? = nil, passageID: UUID? = nil, detail: String = "") {
        guard case .signedIn = auth.state else { return }
        Task {
            if pieceID != nil || passageID != nil { await syncCoordinator.syncAll() }
            await social.postActivityEvent(kind: kind, pieceID: pieceID, passageID: passageID, detail: detail)
        }
    }

    /// Posts a Note (spec §5a: "Instagram-Notes style, 24h, optional piece, private replies") and
    /// shares it to the feed as a `.notePosted` event — the one activity kind the spec ties directly
    /// to another §5a feature rather than to a practice moment, so posting a note *is* "sharing a
    /// milestone" of a kind, not a separate action a caller has to remember to also do.
    /// Not fire-and-forget like `shareMilestone`: the compose sheet needs to know whether the note
    /// actually landed (the server rejects a blocked-word violation, for instance) before dismissing.
    @discardableResult
    public func postNote(text: String, pieceID: UUID? = nil, pieceTitle: String? = nil) async -> Bool {
        guard case .signedIn = auth.state else { return false }
        if pieceID != nil { await syncCoordinator.syncAll() }
        guard let noteID = await social.postNote(text: text, pieceID: pieceID, pieceTitle: pieceTitle) else { return false }
        _ = noteID
        let preview = text.count > 80 ? String(text.prefix(80)) + "…" : text
        Task { await social.postActivityEvent(kind: .notePosted, pieceID: pieceID, detail: preview) }
        return true
    }

    /// `lastError` after a `postNote`/failed `shareMilestone` call — `SocialService.lastError` itself
    /// (not duplicated here), so a compose sheet can show why a post was rejected (e.g. the offensive-
    /// text filter) without this type re-threading every underlying error itself.
    public var lastError: String? { social.lastError }
}
